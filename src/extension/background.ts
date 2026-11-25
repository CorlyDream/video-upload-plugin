import {readBilibiliDrafts, findBilibiliDraft, verifyBilibiliDraft} from './bilibili-draft';
import {inspectBilibiliEditor, triggerBilibiliUpload} from './bilibili';
import {clickWeixinCoverControl, clickWeixinOriginalConfirm} from './weixin';
import {inspectCover,selectKuaishouCovers} from '../core/covers';
import { platforms, isActive, acceptCheckpoint, type Batch, type Task, type SenderIdentity } from '../core/model';
import { authorizeClaim, approveBridge, consumeGrant, type Grant, type Claim } from '../core/authorization';
import { readAsset, deleteBatchAssets, purgeExpiredAssets } from '../core/assets';
import type { Request, PageMessage, WorkbenchCommand } from '../core/protocol';
import { normalizePublication, hasPublication, normalizeDouyinPublication } from '../core/publication';
import { MAX_LOCAL_COVERS } from '../core/cover-order';
import { importBatch } from '../core/external-import';

import { createDiagnostics, diagnosticCode } from '../core/diagnostics';
const diagnostics = createDiagnostics('background',chrome.storage.local);
void diagnostics.record('worker.started');

type State = { batch?: Batch; grants: Grant[]; claims: Claim[] };
const workbenchUrl = chrome.runtime.getURL('workbench.html');
const bridgeUrl = chrome.runtime.getURL('bridge.html');
let state: State = { grants: [], claims: [] };
let controller: chrome.runtime.Port | undefined;
let pagePort: chrome.runtime.Port | undefined;
const navigations = new Map<number, { url: string; loading: boolean }>();
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
}
const ready = (async () => {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const saved = (await chrome.storage.local.get('state')).state as State | undefined;
  if (saved) state = { batch: saved.batch, grants: [], claims: [] };
  for (const task of state.batch?.tasks ?? []) {
    if (task.platform === 'bilibili' && !task.completedStages && task.reason.includes('视频已直传并创建稿件草稿')) {
      task.reason = task.reason.replace('视频已直传并创建稿件草稿', '旧版已调用投稿接口创建稿件') + ' 旧记录不代表草稿，请到稿件管理核对实际投稿状态。';
    }
    if (isActive(task.status)) { task.status = 'paused'; task.reason = '连接中断，已停止操作；请检查原页面，不会自动重复上传'; }
  }
  await persist();
})();
function send(port: chrome.runtime.Port | undefined, message: unknown) {
  try { port?.postMessage(message); } catch { /* Disconnection is handled by lifecycle listeners. */ }
}
async function persist() { await chrome.storage.local.set({ state }); }
function snapshot() { return { batch: state.batch }; }
function notify() { const task=state.batch?.tasks.at(-1); if(task)void diagnostics.record('task.state',{status:task.status,step:task.step,platform:task.platform}); send(controller, { type: 'snapshot', snapshot: snapshot() }); }
function active() { return state.batch?.tasks.find(task => isActive(task.status)); }
function identity(sender?: chrome.runtime.MessageSender): SenderIdentity {
  if (sender?.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.frameId === undefined || !sender.documentId || !sender.url) throw new Error('缺少页面身份');
  return { tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId, url: sender.url };
}
function trustedWorkbench(sender?: chrome.runtime.MessageSender) {
  return sender?.id === chrome.runtime.id && sender.url === workbenchUrl && sender.frameId === 0 && sender.tab?.id !== undefined;
}
function halt(reason: string, status: 'paused' | 'aborted' = 'aborted') {
  // Stop delivery immediately, before awaiting storage writes.
  send(pagePort, { type: 'stop' });
  pagePort?.disconnect(); pagePort = undefined;
  const task = active();
  if (task) { task.status = status; task.reason = reason; }
  state.grants = []; state.claims = []; navigations.clear();
}
async function stop(reason: string, status: 'paused' | 'aborted' = 'aborted') {
  halt(reason, status);
  await persist(); notify();
}
function interrupt(reason: string) {
  halt(reason, 'paused');
  void serial(async () => { await persist(); notify(); });
}
async function finish(task: Task, status: 'failed' | 'needs_attention', reason: string) {
  if (!isActive(task.status)) return;
  void diagnostics.record('task.failed',{taskId:task.taskId,tabId:task.tabId,phase:task.diagnosticPhase,code:diagnosticCode(reason)});
  task.status = status; task.reason = reason;
  state.grants = []; state.claims = [];
  send(pagePort, { type: 'stop' }); pagePort?.disconnect(); pagePort = undefined;
  await persist(); notify();
}
async function loaded(tabId:number,origin:string,expectedUrl?:string):Promise<void>{
 const matches=(tab:chrome.tabs.Tab,allowLoading=false)=>!!tab.url&&tab.url!=='about:blank'&&new URL(tab.url).origin===origin&&(!expectedUrl||tab.url===expectedUrl)&&(tab.status==='complete'||(allowLoading&&tab.status==='loading'));
 const current = await chrome.tabs.get(tabId);
 if(matches(current, navigations.get(tabId)?.loading === false))return;
 await new Promise<void>((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timeout);chrome.tabs.onUpdated.removeListener(listener);chrome.tabs.onRemoved.removeListener(removed);};
  const check=()=>{void chrome.tabs.get(tabId).then(tab=>{if(matches(tab)){cleanup();resolve();}},error=>{cleanup();reject(error);});};
  const listener=(id:number)=>{if(id===tabId)check();};
  const removed=(id:number)=>{if(id===tabId){cleanup();reject(new Error('平台页面已关闭'));}};
  const timeout=setTimeout(()=>{void chrome.tabs.get(tabId).then(tab=>{if(matches(tab,true)){cleanup();resolve();}else{cleanup();reject(new Error('平台页面加载超时，请手动检查'));}},error=>{cleanup();reject(error);});},30000);
  chrome.tabs.onUpdated.addListener(listener);chrome.tabs.onRemoved.addListener(removed);check();
 });
}

function stage(task: Task, phase: string) {task.diagnosticPhase=phase;void diagnostics.record('task.stage',{taskId:task.taskId,tabId:task.tabId,phase,platform:task.platform});}
async function launch(task: Task, owner: chrome.runtime.Port) {
  try {
    const platform = platforms.find(item => item.id === task.platform)!;
    stage(task,'wait_tab_loaded');
    // A resume is explicitly bound to the existing platform tab. Requiring a
    // fresh navigation/load event here can time out even while that tab is
    // already complete, which would turn a valid breakpoint into a dead end.
    // Verify the current tab origin and continue directly; new attempts still
    // use the normal load wait below.
    if (task.videoAlreadyTransferred) {
      const current = await chrome.tabs.get(task.tabId);
      if (!current.url || new URL(current.url).origin !== platform.origin) throw new Error('页面已跳转，请先登录并检查；本次不会继续');
    } else {
      await loaded(task.tabId,platform.origin,undefined);
    }
    if (!isActive(task.status) || controller !== owner) return;
    stage(task,'read_tab');
    const tab = await chrome.tabs.get(task.tabId);
    if (!tab.url || new URL(tab.url).origin !== platform.origin) throw new Error('页面已跳转，请先登录并检查；本次不会继续');
    stage(task,'inject_content');
    const [injected] = await chrome.scripting.executeScript({ target: { tabId: task.tabId }, files: ['content.js'] });
    await serial(async () => {
      if (!isActive(task.status) || controller !== owner) return;
      if (!injected?.documentId) throw new Error('无法识别页面文档');
      task.documentId = injected.documentId;
      navigations.delete(task.tabId);
      const grant: Grant = { ...task, origin: platform.origin, token: crypto.randomUUID(), expiresAt: Date.now() + 60000, consumed: false };
      state.grants = [grant]; state.claims = [];
      await persist();
      if (!isActive(task.status) || controller !== owner) return;
      stage(task,'connect_content');
      pagePort = chrome.tabs.connect(task.tabId, { name: 'upload-page', documentId: task.documentId });
      const port = pagePort;
      port.onMessage.addListener(message => { void serial(() => handlePage(task, port, message)).catch(() => stop('页面消息校验失败', 'paused')); });
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; void serial(async () => { if (pagePort === port) await stop('平台页面连接中断，请检查原页面', 'paused'); }); });
      send(port, { type: 'run', task, token: grant.token, origin: platform.origin });
      notify();
    });
  } catch (error) { await serial(() => finish(task, 'needs_attention', errorText(error))); }
}
async function draftRead(task: Task, id?: number) {
  const [result] = await chrome.scripting.executeScript({target:{tabId:task.tabId}, func:readBilibiliDrafts, args:id === undefined ? [] : [id]});
  if (!result?.result) throw new Error('无法从 B 站页面回读草稿');
  return result.result;
}
async function reconcileBilibiliDraft(task: Task, owner: chrome.runtime.Port) {
  const checkpoint = task.bilibiliDraft!;
  try {
    const started = Date.now();
    while (isActive(task.status) && controller === owner && state.batch?.tasks.includes(task)) {
      let drafts;
      try { drafts = checkpoint.draftId ? [] : await draftRead(task); }
      catch(error) {
        if (Date.now() - started >= 20000) throw error;
        await new Promise(resolve=>setTimeout(resolve,500));continue;
      }
      const id = findBilibiliDraft(checkpoint, drafts);
      if (id) {
        checkpoint.draftId = id;
        await persist();
        const draft = await draftRead(task, id);
        verifyBilibiliDraft(checkpoint, draft, normalizePublication(task.publication, false), !!task.coverAssetId);
        if (!isActive(task.status) || controller !== owner) return;
        checkpoint.phase = 'saved';
        task.completedStages = [...new Set([...(task.completedStages ?? []), 'draft'])];
        task.pipelineStage = 'review'; task.status = 'needs_attention';
        const skipped=checkpoint.rejectedTags?.length ? `已跳过平台拒绝的标签：${checkpoint.rejectedTags.map(item=>item.tag).join('、')}；` : '';
        task.reason = `B 站草稿已保存并回读核验（${id}）；视频、标题、简介和其余标签已核验；${checkpoint.categoryTid ? '亲子分区已核验；' : ''}${skipped}请在草稿页检查封面、声明与其他设置。未投稿。`;
        state.grants=[];state.claims=[];
        await persist();notify();return;
      }
      if (Date.now() - started >= 20000) throw new Error('未查到唯一匹配草稿');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  } catch(error) {
    if (!isActive(task.status) || controller !== owner) return;
    checkpoint.phase = 'unverified';
    await finish(task,'needs_attention',`草稿保存结果尚未核验：${errorText(error)}；请先核验草稿箱，不会自动再次保存或上传。`);
  }
}
async function handlePage(task: Task, port: chrome.runtime.Port, message: PageMessage) {
  if (pagePort !== port || !isActive(task.status) || !controller) return;
  if (message.type === 'heartbeat') return;
  if (message.type === 'checkpoint') {
    const event = acceptCheckpoint(task, message.checkpoint);
    if (!event || typeof event.reason !== 'string' || event.reason.length > 2000) return;
    Object.assign(task, event);
    if (!isActive(task.status)) {
      state.grants = []; state.claims = []; navigations.delete(task.tabId);
      send(port, { type: 'stop' }); pagePort = undefined; port.disconnect();
    }
    await persist(); notify();
  } else if (message.type === 'approve') {
    const grant = state.grants.find(g => g.token === message.token);
    const index = state.claims.findIndex(c => c.id === message.claimId);
    const claim = state.claims[index];
    if (!grant || !claim) throw new Error('桥接授权不存在');
    state.claims[index] = approveBridge(grant, claim, { tabId: task.tabId, frameId: 0, documentId: task.documentId, url: grant.origin }, Date.now());
    await persist();
    if (pagePort === port && isActive(task.status) && controller) send(port, { type: 'approved', claimId: claim.id });
  }
}
function errorText(error: unknown) {
  if(diagnosticCode(error)==='tab_not_found')return '浏览器返回了无法访问的标签页编号（No tab with id）。已停止自动上传，素材和文案仍保留；请使用支持扩展标签控制的浏览器。';
  return error instanceof Error ? error.message : '操作失败，请检查页面';
}
async function command(command: WorkbenchCommand, owner: chrome.runtime.Port) {
  if (controller !== owner) throw new Error('工作台连接已失效');
  switch (command.type) {
    case 'get':
      await purgeExpiredAssets(Date.now(), active() ? state.batch?.id : undefined);
      return;
    case 'prepare': {
      if (active()) throw new Error('请先停止当前任务');
      const asset = await readAsset(command.asset.batchId, command.asset.id);
      if (!asset.type.startsWith('video/')) throw new Error('请选择视频文件');
      if (state.batch && state.batch.id !== asset.batchId) throw new Error('请先结束并清理上一批');
      const { blob: _, ...meta } = asset;
      const previous = state.batch;
      state.batch = { id: asset.batchId, asset: meta, tasks: [], createdAt: Date.now() };
      try { await persist(); } catch (error) { state.batch = previous; throw error; }
      return;
    }
    case 'configure': {
      const batch = state.batch;
      if (!batch || active() || batch.tasks.length) throw new Error('请在开始任务前设置文案和封面');
      const publication = normalizePublication(command.publication, false);
      let cover: Batch['cover'];
      if (command.coverAssetId) {
        const asset = await readAsset(batch.id, command.coverAssetId);
        if (asset.batchId !== batch.id || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.type) || !asset.size || asset.size > 20 * 1024 * 1024) throw new Error('封面须为本批次的 JPG、PNG 或 WebP 图片，最大 20 MiB');
        await inspectCover(asset.blob);
        const { blob: _, ...meta } = asset; cover = meta;
      }
      if (controller !== owner) throw new Error('工作台连接已失效');
      const ids = command.pkCoverAssetIds ?? [];
      const importedPkCount = batch.externalImport ? batch.pkCovers?.length ?? 0 : 0;
      const maxPkCovers = Math.max(MAX_LOCAL_COVERS - 1, importedPkCount);
      if (!Array.isArray(ids) || ids.length > maxPkCovers || ids.some(id=>typeof id !== 'string') || new Set([command.coverAssetId, ...ids].filter(Boolean)).size !== ids.length + (command.coverAssetId ? 1 : 0)) throw new Error(`最多选择 1 张主封面和 ${maxPkCovers} 张不重复的 PK 封面`);
      if (ids.length && (!command.coverAssetId || command.coverPk !== true)) throw new Error('多封面需要主封面并开启 PK');
      if (command.coverPk !== undefined && typeof command.coverPk !== 'boolean') throw new Error('PK 设置无效');
      const pkCovers: NonNullable<Batch['pkCovers']> = [];
      for (const id of ids) {
        const asset = await readAsset(batch.id, id);
        if (asset.batchId !== batch.id || !['image/jpeg','image/png'].includes(asset.type) || !asset.size || asset.size > 20*1024*1024) throw new Error('PK 封面须为本批次 JPG/PNG，最大 20 MiB');
        await inspectCover(asset.blob);
        const {blob: _, ...meta} = asset; pkCovers.push(meta);
      }
      if (controller !== owner) throw new Error('工作台连接已失效');
      const previous = { publication: batch.publication, cover: batch.cover, pkCovers:batch.pkCovers, coverPk:batch.coverPk };
      batch.publication = publication; batch.cover = cover; batch.pkCovers = pkCovers; batch.coverPk = command.coverPk;
      try { await persist(); } catch (error) { Object.assign(batch, previous); throw error; }
      return;
    }
    case 'schedule': {
      const batch = state.batch;
      if (!batch || batch.id !== command.batchId || active()) throw new Error('当前批次不可修改定时时间');
      const previous = batch.publication;
      batch.publication = normalizePublication({...previous, scheduleAt: command.scheduleAt}, false);
      try { await persist(); } catch (error) { batch.publication = previous; throw error; }
      return;
    }
    case 'resume': {
      if (active()) throw new Error('已有任务正在处理');
      const task = state.batch?.tasks.find(item => item.taskId === command.taskId);
      if (!task) throw new Error('找不到任务');
      if (!['needs_attention','paused','aborted','failed'].includes(task.status)) throw new Error('当前任务不能继续同步');
      if (task.platform === 'bilibili' && task.bilibiliDraft) {
        const draft = task.bilibiliDraft;
        if (draft.phase === 'saved') throw new Error('草稿已保存，请使用“打开草稿”检查');
        const tab = await chrome.tabs.get(task.tabId).catch(()=>undefined);
        if (!tab) {
          const created = await chrome.tabs.create({url:'https://member.bilibili.com/platform/upload-manager/article?group=draft',active:true});
          if (created.id === undefined) throw new Error('无法打开 B 站草稿箱');
          task.tabId=created.id;
          await loaded(task.tabId,'https://member.bilibili.com');
        } else if (!tab.url || new URL(tab.url).origin !== 'https://member.bilibili.com') throw new Error('原页面已离开 B 站，请打开草稿箱后核验');
        task.status='checking';task.pipelineStage='draft';task.reason='正在只读核验 B 站草稿保存结果';
        await persist();void reconcileBilibiliDraft(task,owner);return;
      }
      if (task.platform === 'bilibili' && !task.completedStages) throw new Error('这是旧版 B 站投稿记录，请先检查已投稿稿件；不能作为草稿继续');
      if (task.publication?.scheduleAt !== state.batch?.publication?.scheduleAt) throw new Error('定时时间已修改，请关闭原平台页面后使用“保留素材重新打开”');
      if (task.tabId === undefined || task.documentId === '') throw new Error('当前页面身份已失效，请重新打开平台页面');
      const tab = await chrome.tabs.get(task.tabId);
      const platform = platforms.find(item => item.id === task.platform)!;
      if (!tab.url || new URL(tab.url).origin !== platform.origin) throw new Error('当前平台页面已离开，请检查页面');
      // Continuation runs against the concrete platform page. Bring that
      // existing tab forward so page-owned waits and modal controls observe
      // the same visible document the operator is continuing from.
      await chrome.tabs.update(task.tabId, { active: true });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      task.videoAlreadyTransferred = true;
      task.status = 'checking'; task.reason = '正在原页面继续同步文案和封面'; task.pipelineStage = 'upload';
      try { await persist(); } catch (error) { task.status='paused'; task.reason='检查点保存失败，未继续同步'; throw error; }
      void launch(task, owner); return;
    }
    case 'retry':
    case 'start': {
      if (active()) throw new Error('已有任务正在处理');
      const batch = state.batch;
      if (!batch) throw new Error('请先选择视频');
      const previous = command.type === 'retry' ? batch.tasks.find(task=>task.taskId===command.taskId) : undefined;
      if (command.type === 'retry' && !previous) throw new Error('找不到原任务，未重新上传');
      const platformId = command.type === 'start' ? command.platform : previous!.platform;
      const attempts = batch.tasks.filter(task=>task.platform===platformId);
      if(command.type === 'start' && attempts.length) throw new Error('这个平台已尝试，请检查原页面；关闭后可使用保留素材重新打开');
      if (previous?.platform === 'bilibili' && previous.bilibiliDraft) throw new Error('已有 B 站草稿保存记录，请先打开或核验草稿，不会重复上传');
      if(command.type === 'retry') {
        if(attempts.at(-1)?.taskId !== previous!.taskId) throw new Error('已有更新的尝试，请使用最新记录');
        const openTabs = await chrome.tabs.query({});
        if(attempts.some(task=>openTabs.some(tab=>tab.id===task.tabId))) throw new Error('原平台页面仍然打开，请先检查原页面，不会重复上传');
        void diagnostics.record('retry.accepted',{platform:platformId});
      }
      const platform = platforms.find(item => item.id === platformId);
      if (!platform) throw new Error('未知平台');
      if (!['xiaohongshu','kuaishou','douyin','weixin','bilibili'].includes(platform.id) && (hasPublication(batch.publication) || batch.publication?.collection || batch.cover)) throw new Error('文案、合集和封面自动填写目前仅支持小红书、快手、抖音、视频号和 B 站');
      normalizePublication(batch.publication, false);
      if (platform.id === 'xiaohongshu') normalizePublication(batch.publication);
      if (platform.id === 'douyin') normalizeDouyinPublication(batch.publication);
      if (!await chrome.permissions.contains({ origins: [`${platform.origin}/*`] })) throw new Error('未获得该平台访问权限');
      await readAsset(batch.id, batch.asset.id);
      const selectedAssets: {id:string;ratio:import('../core/covers').CoverRatio}[] = [];
      for(const cover of [batch.cover,...(batch.pkCovers??[])]) {
        if(!cover)continue;
        const asset=await readAsset(batch.id,cover.id);
        selectedAssets.push({id:asset.id,ratio:await inspectCover(asset.blob)});
      }
      let coverIds=selectedAssets.map(c=>c.id);
      if(platform.id==='douyin') coverIds=selectedAssets.filter((asset,i,all)=>all.findIndex(a=>a.ratio===asset.ratio)===i).map(a=>a.id);
      if(platform.id==='kuaishou') {
        if(previous) {
          coverIds=[previous.coverAssetId,...(previous.pkCoverAssetIds??[])].filter((id):id is string=>!!id);
          if(coverIds.some(id=>!selectedAssets.some(asset=>asset.id===id)))throw new Error('原任务封面不存在，未重新选择');
        } else coverIds=selectKuaishouCovers(selectedAssets).map(c=>c.id).slice(0,batch.coverPk?2:1);
      }
      // Video Channels has two fixed cover slots (3:4 and 4:3). Keep the
      // main cover and the first selected cover with the other ratio so the
      // page adapter can map each asset to its matching slot. Bilibili has
      // one cover slot and therefore still receives only the main cover.
      if(platform.id==='weixin') {
        const main = selectedAssets[0];
        const alternate = main && selectedAssets.slice(1).find(asset => asset.ratio !== main.ratio);
        coverIds = [main?.id, alternate?.id].filter((id): id is string => Boolean(id));
      } else if(platform.id==='bilibili') coverIds=coverIds.slice(0,1);
      else if(platform.id==='xiaohongshu') coverIds=coverIds.slice(0,4);
      if (controller !== owner) throw new Error('工作台连接已失效');
      // Some embedded browsers cannot update the id returned by tabs.create.
      // Open the actual destination once, observing early navigations before create resolves.
      const destination = platform.origin + platform.path;
      const earlyNavigations = new Map<number,string[]>();
      const observeCreation = (event: {tabId:number;frameId:number;url:string}) => {
        if(event.frameId !== 0 || event.url === 'about:blank')return;
        const events=earlyNavigations.get(event.tabId) ?? [];
        events.push(event.url);earlyNavigations.set(event.tabId,events);
      };
      chrome.webNavigation.onBeforeNavigate.addListener(observeCreation);
      void diagnostics.record('tab.create.request',{platform:platform.id});
      let tab: chrome.tabs.Tab;
      try { tab = await chrome.tabs.create({ url: destination, active: true }); }
      finally { chrome.webNavigation.onBeforeNavigate.removeListener(observeCreation); }
      void diagnostics.record('tab.create.result',{tabId:tab.id,platform:platform.id});
      if (controller !== owner) throw new Error('工作台连接已失效');
      if (tab.id === undefined) throw new Error('无法创建平台页面');
      const task: Task = previous ?? { batchId: batch.id, taskId: crypto.randomUUID(), attemptId: crypto.randomUUID(), tabId: tab.id, documentId: '', step: 0, pipelineStage: 'page', status: 'checking', reason: '等待页面加载并检查唯一视频入口', platform: platform.id, assetId: batch.asset.id, createdAt: Date.now() };
      if (previous) Object.assign(task, {
        batchId: batch.id,
        attemptId: crypto.randomUUID(),
        tabId: tab.id,
        documentId: '',
        step: 0,
        pipelineStage: 'page',
        status: 'checking',
        reason: '等待页面加载并检查唯一视频入口',
        diagnosticPhase: undefined,
        videoAlreadyTransferred: undefined,
        uploadTabId: undefined,
        platform: platform.id,
        assetId: batch.asset.id,
      });
      if (platform.id === 'bilibili') { task.completedStages=[];task.bilibiliDraft=undefined;task.bilibiliRejectedTags=[]; }
      task.publication = batch.publication ? normalizePublication(batch.publication, platform.id === 'xiaohongshu') : undefined;
      task.coverAssetId = coverIds[0]; task.pkCoverAssetIds = coverIds.slice(1); task.coverPk = (platform.id==='xiaohongshu' || platform.id==='kuaishou') ? batch.coverPk : undefined;
      if (!previous) batch.tasks.push(task);
      const initialNavigations=earlyNavigations.get(task.tabId) ?? [];
      navigations.set(task.tabId, { url: destination, loading: initialNavigations.length > 0 });
      if(initialNavigations.length > 1 || initialNavigations.some(url=>url !== destination)) {task.status='paused';task.reason='平台页面在创建期间发生额外导航，未开始上传';}
      try { await persist(); } catch (error) { halt('检查点保存失败，未开始上传', 'paused'); throw error; }
      if (controller !== owner || !isActive(task.status)) return;
      void launch(task, owner); return;
    }
    case 'stop': await stop('已由你接管；平台上传可能继续，插件已停止操作'); return;
    case 'open': {
      const task = state.batch?.tasks.find(item => item.taskId === command.taskId);
      if (!task) throw new Error('找不到任务');
      if (task.platform === 'bilibili' && task.bilibiliDraft?.draftId) {
        const url=`https://member.bilibili.com/platform/upload/video/frame?type=draft&draftId=${task.bilibiliDraft.draftId}`;
        const existing=await chrome.tabs.get(task.tabId).catch(()=>undefined);
        if (existing) await chrome.tabs.update(task.tabId,{url,active:true});
        else { const created=await chrome.tabs.create({url,active:true});if(created.id===undefined)throw new Error('无法打开草稿');task.tabId=created.id;await persist(); }
        return;
      }
      let tab: chrome.tabs.Tab;
      try { tab = await chrome.tabs.get(task.tabId); } catch { throw new Error('原平台标签页已关闭。点击“保留素材重新打开”，无需重新填写'); }
      const platform = platforms.find(item => item.id === task.platform)!;
      if (!tab.url || new URL(tab.url).origin !== platform.origin) throw new Error('原页面已关闭或离开平台，不会新建上传页面');
      await chrome.tabs.update(task.tabId, { active: true });
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
    case 'clear':
      await stop('任务结束');
      if (state.batch) await deleteBatchAssets(state.batch.id);
      state.batch = undefined; await persist(); return;
    default: throw new Error('不支持的操作');
  }
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'workbench' || !trustedWorkbench(port.sender)) { port.disconnect(); return; }
  let disconnected = false;
  let heartbeatAt = Date.now();
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? 'port_closed';
    disconnected = true;
    void diagnostics.record('connection.disconnected', { code: reason, active: !!active(), elapsedMs: Date.now() - heartbeatAt, tabId: port.sender?.tab?.id });
    if (controller === port) { controller = undefined; interrupt('工作台关闭或连接中断，已停止操作'); }
  });
  void serial(async () => {
    await ready;
    if (disconnected) return;
    if (controller && controller !== port) { void diagnostics.record('connection.rejected', { code: 'duplicate_workbench', tabId: port.sender?.tab?.id }); send(port, { ok: false, error: '已有工作台，请使用原工作台' }); port.disconnect(); return; }
    controller = port;
    void diagnostics.record('connection.connected', { tabId: port.sender?.tab?.id });
    port.onMessage.addListener((message: Request | { type: 'heartbeat' }) => {
      if ('type' in message && message.type === 'heartbeat') {
        const elapsedMs = Date.now() - heartbeatAt;
        heartbeatAt = Date.now();
        if (elapsedMs > 25000) void diagnostics.record('connection.heartbeat_delayed', { phase: 'workbench', elapsedMs, tabId: port.sender?.tab?.id });
        return;
      }
      const request = message as Request;
      void diagnostics.record('command.received',{command:request?.command?.type,requestId:request?.id});
      // Stop the writer at message receipt, not after queued I/O finishes.
      if (request?.command?.type === 'stop' && controller === port) halt('已由你接管；平台上传可能继续，插件已停止操作');
      void serial(async () => {
        try { if (!request?.id || !request.command) throw new Error('无效请求'); await command(request.command, port); send(port, { id: request.id, ok: true, snapshot: snapshot() }); notify(); }
        catch (error) { void diagnostics.record('command.failed',{command:request?.command?.type,requestId:request?.id,code:diagnosticCode(error)}); send(port, { id: request?.id, ok: false, error: errorText(error), snapshot: snapshot() }); }
      });
    });
    send(port, { type: 'snapshot', snapshot: snapshot() });
  });
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (message?.type === 'bilibili-verify-editor') {
    void serial(async () => {
      await ready;
      try {
        const who = identity(sender), task = active(), owner = controller;
        if (!owner || !task || task.platform !== 'bilibili' || task.bilibiliDraft || !task.completedStages?.includes('upload')
          || who.frameId !== 0 || who.tabId !== task.tabId || who.documentId !== task.documentId
          || message.taskId !== task.taskId || message.attemptId !== task.attemptId
          || new URL(who.url).origin !== 'https://member.bilibili.com'
          || !state.grants.some(grant => grant.taskId === task.taskId && grant.consumed)) {
          throw new Error('B 站编辑页任务身份已失效');
        }
        const [inspection] = await chrome.scripting.executeScript({
          target: {tabId: who.tabId, documentIds: [who.documentId]}, world: 'MAIN', func: inspectBilibiliEditor,
        });
        if (active() !== task || controller !== owner) throw new Error('B 站任务已停止');
        const page = inspection?.result;
        const {title, description} = normalizePublication(task.publication, false);
        if (!page || page.title !== title || page.description !== description) throw new Error('B 站编辑页实际文案未同步，请手动检查');
        if (page.tid !== 193) throw new Error('B 站编辑页实际分区不是亲子，请手动检查');
        respond({ok: true});
      } catch (error) { respond({ok: false, error: errorText(error)}); }
    });
    return true;
  }
  if (message?.type === 'bilibili-video-change') {
    void serial(async()=>{
      await ready;
      try {
        const who=identity(sender), task=active();
        if (!controller || !task || task.platform!=='bilibili' || task.videoAlreadyTransferred || task.pipelineStage!=='transfer' || who.frameId!==0 || who.tabId!==task.tabId || who.documentId!==task.documentId || message.taskId!==task.taskId || message.attemptId!==task.attemptId || new URL(who.url).origin!=='https://member.bilibili.com' || !state.grants.some(g=>g.taskId===task.taskId&&g.consumed)) throw new Error('B 站文件交接身份已失效');
        const asset=await readAsset(task.batchId,task.assetId);
        if (!controller || active()!==task) throw new Error('B 站任务已停止');
        const result=await chrome.scripting.executeScript({target:{tabId:who.tabId,documentIds:[who.documentId]},world:'MAIN',func:triggerBilibiliUpload,args:[asset.name,asset.size]});
        if (result[0]?.result === 'waiting') { respond({ok:false,pending:true});return; }
        if (!result[0]?.result) throw new Error('B 站上传入口或文件身份发生变化');
        respond({ok:true});
      } catch(error) { respond({ok:false,error:errorText(error)}); }
    });
    return true;
  }
  if(message?.type==='resume-sync') {
    void serial(async()=>{
      try {
        const task=state.batch?.tasks.find(item=>item.taskId===message.taskId);
        const platform=task && platforms.find(item=>item.id===task.platform);
        const samePlatformOrigin=!!task && !!platform && typeof sender.url==='string' && new URL(sender.url).origin===platform.origin;
        if(!controller||!task||!samePlatformOrigin||sender.tab?.id===undefined)throw new Error('当前页面不是原任务页面');
        if (sender.tab.id !== task.tabId) {
          // A user can reopen the same platform page after the original tab was
          // closed. Rebind only when the old task tab is gone; if it is still
          // open, keep the fail-closed identity check to avoid choosing an
          // arbitrary same-origin creator tab.
          const oldTabOpen = await chrome.tabs.get(task.tabId).then(() => true, () => false);
          if (oldTabOpen) throw new Error('当前页面不是原任务页面');
          task.tabId = sender.tab.id;
        }
        // A page refresh or an SPA document replacement keeps the same tab and
        // platform, but Chrome assigns a new documentId. Rebind the checkpoint
        // to the sender's current document before launching the continuation;
        // rejecting this case strands the visible “继续同步” breakpoint.
        if (sender.documentId && sender.documentId !== task.documentId) task.documentId = sender.documentId;
        await command({type:'resume',taskId:task.taskId},controller); respond({ok:true}); notify();
      } catch(error) { respond({ok:false,error:errorText(error)}); }
    });
    return true;
  }
  if(message?.type==='weixin-original-confirm') {
    void serial(async()=>{
      await ready;
      try {
        const who=identity(sender),task=active();
        if(!controller||!task||task.platform!=='weixin'||who.frameId!==0||who.tabId!==task.tabId||who.documentId!==task.documentId||message.taskId!==task.taskId||message.attemptId!==task.attemptId||new URL(who.url).origin!=='https://channels.weixin.qq.com')throw new Error('视频号任务身份已失效');
        const result=await chrome.scripting.executeScript({target:{tabId:who.tabId,documentIds:[who.documentId]},world:'MAIN',func:clickWeixinOriginalConfirm});
        if(!result[0]?.result)throw new Error('未找到视频号原创确认按钮');
        respond({ok:true});
      }catch(error){respond({ok:false,error:errorText(error)});}
    });
    return true;
  }
  if(message?.type!=='weixin-cover-click')return;
  void serial(async()=>{
    await ready;
    try {
      const who=identity(sender),task=active();
      if(!controller||!task||task.platform!=='weixin'||who.frameId!==0||who.tabId!==task.tabId||who.documentId!==task.documentId||message.taskId!==task.taskId||message.attemptId!==task.attemptId||new URL(who.url).origin!=='https://channels.weixin.qq.com')throw new Error('视频号任务身份已失效');
      if(!['3:4','4:3'].includes(message.ratio)||!['open','direct','upload','confirm'].includes(message.action))throw new Error('不支持的视频号封面操作');
      let file: {base64:string;name:string;type:string;lastModified:number} | undefined;
      if(message.action==='upload') {
        if(![task.coverAssetId,...(task.pkCoverAssetIds??[])].includes(message.assetId))throw new Error('封面不属于当前任务');
        const asset=await readAsset(task.batchId,message.assetId);
        if(asset.size>20*1024*1024||!/^image\/(jpeg|png|webp)$/.test(asset.type)||await inspectCover(asset.blob)!==message.ratio)throw new Error('封面比例或类型不匹配');
        const bytes=new Uint8Array(await asset.blob.arrayBuffer());
        let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
        file={base64:btoa(binary),name:asset.name,type:asset.type,lastModified:asset.lastModified};
      }
      if(!controller||active()!==task)throw new Error('视频号任务已停止');
      const result=await chrome.scripting.executeScript({target:{tabId:who.tabId,documentIds:[who.documentId]},world:'MAIN',func:clickWeixinCoverControl,args:[message.ratio,message.action,file??null]});
      if(!result[0]?.result)throw new Error('未找到当前比例的封面控件');
      respond({ok:true});
    }catch(error){respond({ok:false,error:errorText(error)});}
  });
  return true;
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'bridge-claim' && message?.type !== 'bridge-consume') return;
  void serial(async () => {
    await ready;
    try {
      if (!controller || !active()) throw new Error('任务已停止');
      const who = identity(sender);
      const grant = state.grants.find(item => item.token === message.token);
      if (!grant) throw new Error('素材授权不存在');
      if (message.type === 'bridge-claim') {
        if (state.claims.length >= 8) throw new Error('桥接请求过多');
        const claim = authorizeClaim(grant, who, bridgeUrl, Date.now());
        state.claims.push(claim); await persist();
        if (!controller || !active() || !state.grants.includes(grant)) throw new Error('任务已停止');
        respond({ ok: true, claimId: claim.id, origin: grant.origin });
      } else {
        const claim = state.claims.find(item => item.id === message.claimId);
        if (!claim) throw new Error('桥接请求不存在');
        Object.assign(grant, consumeGrant(grant, claim, who, Date.now())); await persist();
        if (!controller || !active() || !state.grants.includes(grant)) throw new Error('任务已停止');
        respond({ ok: true, batchId: grant.batchId, assetId: grant.assetId, coverAssetId: grant.coverAssetId, pkCoverAssetIds:grant.pkCoverAssetIds, origin: grant.origin });
      }
    } catch (error) { void diagnostics.record('bridge.failed',{type:message.type,code:diagnosticCode(error),tabId:sender.tab?.id,frameId:sender.frameId,documentId:sender.documentId}); respond({ ok: false, error: errorText(error) }); }
  });
  return true;
});
// Douyin creates a distinct editor tab after accepting the file. Adopt only this
// task's own top-level navigation target; never locate arbitrary tabs by URL.
chrome.webNavigation.onCreatedNavigationTarget.addListener(details=>{
 void serial(async()=>{
  const task=active(),owner=controller;
  if(!task||!owner||task.platform!=='douyin'||task.videoAlreadyTransferred||task.tabId!==details.sourceTabId||details.sourceFrameId!==0||task.status!=='transferring'||details.url!=='https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page'||!state.grants.some(g=>g.taskId===task.taskId&&g.consumed))return;
  const oldPort=pagePort;pagePort=undefined;send(oldPort,{type:'stop'});oldPort?.disconnect();
  task.uploadTabId=task.tabId;task.tabId=details.tabId;task.documentId='';task.videoAlreadyTransferred=true;task.pipelineStage='upload';task.reason='视频已交接，正在接续抖音编辑页';
  state.grants=[];state.claims=[];
  navigations.set(task.tabId,{url:details.url,loading:false});
  await persist();notify();void launch(task,owner);
 }).catch(()=>stop('抖音编辑页接续失败，已停止','paused'));
});
chrome.tabs.onRemoved.addListener(id => { if (active()?.tabId === id) interrupt('平台页面已关闭'); });
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  const task = active();
  if (task?.tabId !== id) return;
  // Once bound, real navigations are handled by onBeforeNavigate and the page listener.
  // A late initial tabs.onUpdated URL notification is not a new navigation.
  if (task.documentId) return;
  const navigation = navigations.get(id);
  if (!navigation) return;
  const url = change.url ?? tab?.url;
  if ((!url || url === 'about:blank') && !navigation.loading) return;
  if (change.url && change.url !== navigation.url) { interrupt('平台页面在加载期间跳转，已停止操作'); return; }
  // tabs.onUpdated is a status stream, not one event per navigation.
});
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  const task = active();
  if (!task || task.tabId !== details.tabId || details.frameId !== 0) return;
  const navigation = navigations.get(details.tabId);
  if (details.url === 'about:blank' && navigation && !navigation.loading) return;
  if (task.documentId || !navigation || navigation.loading) {
    interrupt('平台页面开始新的导航，已停止操作');
    return;
  }
  if (details.url !== navigation.url) {
    interrupt('平台页面在加载期间跳转，已停止操作');
    return;
  }
  navigation.loading = true;
});

async function openWorkbench() {
  const tabs = await chrome.tabs.query({ url: workbenchUrl });
  const existing = tabs.find(tab => tab.id !== undefined);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: workbenchUrl });
  }
}

chrome.action.onClicked.addListener(() => { void serial(openWorkbench); });

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (message?.type !== 'video-upload.import.v1' && message?.type !== 'video-upload.import-check.v1') return;
  const origin = sender.origin;
  if (sender.id || sender.frameId !== 0 || sender.tab?.id === undefined || !origin || !/^https?:\/\//.test(origin)) {
    respond({ ok: false, error: '请在已允许的网站页面中导入' });
    return;
  }
  const requestId = message.requestId;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{32}$/.test(requestId)) {
    respond({ ok: false, error: '导入请求无效' });
    return;
  }
  void serial(async () => {
    try {
      await ready;
      const previous = state.batch;
      const alreadyImported = previous?.externalImport?.origin === origin && previous.externalImport.requestId === requestId;
      if (previous && !alreadyImported) throw new Error('工作台已有一批素材，请先在插件里结束并清理上一批');
      if (!alreadyImported && message.type === 'video-upload.import-check.v1') {
        respond({ ok: true, imported: false, maxCovers: MAX_LOCAL_COVERS, supportsAllCovers: true, supportsTags: true, supportsCollection: true });
        return;
      }
      if (!alreadyImported) {
        const batch = await importBatch(message, origin, requestId);
        state.batch = batch;
        try {
          await persist();
        } catch (error) {
          state.batch = previous;
          await deleteBatchAssets(batch.id).catch(() => {});
          throw error;
        }
        notify();
      }
      const opened = await openWorkbench().then(() => true, () => false);
      respond({ ok: true, imported: true, opened });
    } catch (error) {
      respond({ ok: false, error: errorText(error) });
    }
  });
  return true;
});
