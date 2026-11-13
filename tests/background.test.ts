import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { isActive, platforms, acceptCheckpoint } from '../src/core/model';
import { createDiagnostics, diagnosticCode } from '../src/core/diagnostics';
import {authorizeClaim,approveBridge,consumeGrant} from '../src/core/authorization';
import {selectKuaishouCovers} from '../src/core/covers';
import { normalizePublication, hasPublication, normalizeDouyinPublication } from '../src/core/publication';

// Run the actual worker entrypoint with Chrome events under explicit test control.
// This covers lifecycle ordering which the pure authorization/state tests cannot.
type Listener = (...args: any[]) => void;
function event() {
  const listeners = new Set<Listener>();
  return {
    addListener(listener: Listener) { listeners.add(listener); },
    removeListener(listener: Listener) { listeners.delete(listener); },
    emit(...args: any[]) { for (const listener of [...listeners]) listener(...args); },
  };
}
function port(tabId: number, name = 'workbench') {
  const messages: any[] = [];
  return {
    name,
    sender: { id: 'review', url: 'chrome-extension://review/workbench.html', frameId: 0, tab: { id: tabId } },
    onMessage: event(), onDisconnect: event(), messages,
    postMessage(message: unknown) { messages.push(structuredClone(message)); },
    disconnect() { this.onDisconnect.emit(); },
  };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function settle() { await tick(); await tick(); }

function worker(initialization: Promise<void> = Promise.resolve(), splitInitialNavigation = false) {
  const page = port(7, 'upload-page');
  let tabUrl = 'about:blank';
  let tabStatus = 'loading';
  const chrome = {
    runtime: {
      id: 'review', getURL: (path: string) => `chrome-extension://review/${path}`,
      onConnect: event(), onMessage: event(),
    },
    webNavigation: { onBeforeNavigate: event(), onCreatedNavigationTarget:event() },
    storage: { local: {
      setAccessLevel: () => initialization,
      get: async () => ({ state: { batch: { id: 'batch', asset: { id: 'asset' }, tasks: [] } } }),
      set: async () => {},
    } },
    permissions: { contains: async () => true },
    tabs: {
      onRemoved: event(), onUpdated: event(), query:async()=>[],
      create: async (options: { url?: string }) => {
        tabUrl = options.url ?? 'about:blank';
        if(tabUrl !== 'about:blank'){
          if(splitInitialNavigation)chrome.tabs.onUpdated.emit(7,{status:'loading'},{url:'about:blank'});
          chrome.webNavigation.onBeforeNavigate.emit({tabId:7,frameId:0,url:tabUrl});
          chrome.tabs.onUpdated.emit(7,{url:tabUrl},{url:tabUrl});
        }
        return { id: 7, url: tabUrl, status: tabStatus };
      },
      get: async (_id?:number) => ({ id: 7, status: tabStatus, url: tabUrl }),
      update: async (_tabId: number, options: { url?: string }) => {
        if (options.url) {
          if (splitInitialNavigation) chrome.tabs.onUpdated.emit(7, { status: 'loading' }, { url: tabUrl });
          tabUrl = options.url; tabStatus = 'loading';
          chrome.webNavigation.onBeforeNavigate.emit({ tabId: 7, frameId: 0, url: tabUrl });
          chrome.tabs.onUpdated.emit(7, splitInitialNavigation ? { url: tabUrl } : { status: 'loading', url: tabUrl }, { url: tabUrl });
        }
        return { id: 7, url: tabUrl, status: tabStatus };
      },
      connect: (tabId:number) => tabId===7?page:port(tabId,'upload-page'),
    },
    scripting: { executeScript: async () => [{ documentId: 'document-after-user-refresh' }] },
    action: { onClicked: event() },
  };
  const source = readFileSync(new URL('../src/extension/background.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  runInNewContext(stripTypeScriptTypes(source), {
    Error, authorizeClaim,approveBridge,consumeGrant,createDiagnostics, diagnosticCode, chrome, URL, crypto, setTimeout, clearTimeout, console,
    inspectCover:async(blob:string)=>blob==='pk2'?'3:4':'4:3',selectKuaishouCovers,
    isActive, platforms, acceptCheckpoint, normalizePublication, hasPublication, normalizeDouyinPublication, readAsset: async (_batch: string, id: string) => ['cover','pk1','pk2','pk3'].includes(id) ? ({id, blob:id,batchId:'batch', type:'image/jpeg', size:200}) : ({}),
  });
  return {
    chrome, page,
    navigate(url: string, status: 'loading' | 'complete') {
      tabUrl = url; tabStatus = status;
      if (status === 'loading') chrome.webNavigation.onBeforeNavigate.emit({ tabId: 7, frameId: 0, url });
      chrome.tabs.onUpdated.emit(7, status === 'loading' ? { status, url } : { status });
    },
  };
}

describe('worker lifecycle races', () => {
  it('ignores a late initial URL update after binding the page document',async()=>{
    const harness=worker();const wb=port(1);harness.chrome.runtime.onConnect.emit(wb);await settle();
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'xiaohongshu'}});await settle();
    const url=platforms[0].origin+platforms[0].path;harness.navigate(url,'complete');await settle();
    expect(harness.page.messages.filter(m=>m.type==='run')).toHaveLength(1);
    harness.chrome.tabs.onUpdated.emit(7,{url,status:'complete'},{url});await settle();
    expect(harness.page.messages.filter(m=>m.type==='stop')).toHaveLength(0);
    wb.disconnect();await settle();
  });
  it('opens the platform directly without a second tab update',async()=>{
    const harness=worker();const wb=port(1);harness.chrome.runtime.onConnect.emit(wb);await settle();
    const create=vi.spyOn(harness.chrome.tabs,'create');
    const update=vi.spyOn(harness.chrome.tabs,'update').mockRejectedValue(new Error('No tab with id: 7.'));
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'xiaohongshu'}});await settle();
    expect(create).toHaveBeenCalledWith({url:platforms[0].origin+platforms[0].path,active:true});
    expect(update).not.toHaveBeenCalled();
    harness.navigate(platforms[0].origin+platforms[0].path,'complete');await settle();
    expect(harness.page.messages.filter(m=>m.type==='run')).toHaveLength(1);
    wb.disconnect();await settle();
  });
  it('honors stop while direct tab creation is still pending',async()=>{
    const harness=worker();const wb=port(1);harness.chrome.runtime.onConnect.emit(wb);await settle();
    const create=harness.chrome.tabs.create;
    harness.chrome.tabs.create=async options=>{const tab=await create(options);wb.onMessage.emit({id:'stop',command:{type:'stop'}});return tab;};
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'xiaohongshu'}});await settle();
    harness.navigate(platforms[0].origin+platforms[0].path,'complete');await settle();
    const snapshots=wb.messages.filter(m=>m.snapshot?.batch?.tasks.length);
    expect(snapshots.at(-1)?.snapshot.batch.tasks[0].status).not.toBe('checking');
    expect(harness.page.messages.filter(m=>m.type==='run')).toEqual([]);wb.disconnect();await settle();
  });
  it('stops if navigation changes before tab creation resolves',async()=>{
    const harness=worker();const wb=port(1);harness.chrome.runtime.onConnect.emit(wb);await settle();
    const create=harness.chrome.tabs.create;
    harness.chrome.tabs.create=async options=>{const tab=await create(options);harness.navigate(platforms[0].origin+'/different-composer','loading');return tab;};
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'xiaohongshu'}});await settle();
    expect(wb.messages.find(m=>m.id==='start')?.snapshot.batch.tasks[0].status).toBe('paused');
    expect(harness.page.messages.filter(m=>m.type==='run')).toEqual([]);wb.disconnect();await settle();
  });
  it('does not guess another tab when the created id cannot be read',async()=>{
    const harness=worker();const wb=port(1);harness.chrome.runtime.onConnect.emit(wb);await settle();
    harness.chrome.tabs.get=async()=>{throw Error('No tab with id: 7.');};
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'xiaohongshu'}});await settle();
    const snapshots=wb.messages.filter(m=>m.snapshot?.batch?.tasks.length);
    const task=snapshots.at(-1)?.snapshot.batch.tasks[0];
    expect(task.status).toBe('needs_attention');expect(task.diagnosticPhase).toBe('wait_tab_loaded');
    expect(task.reason).toContain('浏览器返回了无法访问的标签页编号');
    expect(harness.page.messages.filter(m=>m.type==='run')).toEqual([]);wb.disconnect();await settle();
  });
  it('freezes ordered PK covers and rejects invalid PK batches', async () => {
    const harness=worker();const wb=port(1);harness.chrome.runtime.onConnect.emit(wb);await settle();
    for(const [id, extra] of Object.entries({tooMany:{pkCoverAssetIds:['pk1','pk2','pk3','pk4']},duplicate:{pkCoverAssetIds:['cover']},disabled:{coverPk:false,pkCoverAssetIds:['pk1']},foreign:{pkCoverAssetIds:['unknown']}})){
      wb.onMessage.emit({id,command:{type:'configure',publication:{},coverAssetId:'cover',coverPk:true,...extra}});await settle();
      expect(wb.messages.find(m=>m.id===id)?.ok).toBe(false);
    }
    wb.onMessage.emit({id:'valid',command:{type:'configure',publication:{},coverAssetId:'cover',coverPk:true,pkCoverAssetIds:['pk2','pk1','pk3']}});await settle();
    expect(wb.messages.find(m=>m.id==='valid')?.ok).toBe(true);
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'xiaohongshu'}});await settle();harness.navigate(platforms[0].origin+platforms[0].path,'complete');await settle();
    expect(harness.page.messages.find(m=>m.type==='run')?.task.pkCoverAssetIds).toEqual(['pk2','pk1','pk3']);
    expect(harness.page.messages.find(m=>m.type==='run')?.task.coverPk).toBe(true);
    wb.disconnect();await settle();
  });
  it('freezes publication and validated cover into the launched task', async () => {
    const harness = worker(); const wb = port(1);
    harness.chrome.runtime.onConnect.emit(wb); await settle();
    wb.onMessage.emit({id:'configure',command:{type:'configure',publication:{title:'小熊洗脸',description:'说明',tags:['英语']},coverAssetId:'cover'}});
    await settle();
    expect(wb.messages.find(m=>m.id==='configure')?.ok).toBe(true);
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'xiaohongshu'}}); await settle();
    harness.navigate(platforms[0].origin+platforms[0].path,'complete'); await settle();
    const task = harness.page.messages.find(m=>m.type==='run')?.task;
    expect(task.publication).toEqual({title:'小熊洗脸',description:'说明',tags:['英语']});
    expect(task.coverAssetId).toBe('cover');
    wb.onMessage.emit({id:'change',command:{type:'configure',publication:{title:'覆盖'}}}); await settle();
    expect(wb.messages.find(m=>m.id==='change')?.ok).toBe(false);
    wb.disconnect(); await settle();
  });
  it('selects one cover per ratio for Kuaishou and retains the selection on retry',async()=>{
    const harness=worker();const wb=port(1);harness.chrome.runtime.onConnect.emit(wb);await settle();
    wb.onMessage.emit({id:'config',command:{type:'configure',publication:{title:'标题',tags:Array.from({length:12},(_,i)=>`标签${i}`)},coverAssetId:'cover',pkCoverAssetIds:['pk1','pk2','pk3'],coverPk:true}});await settle();
    expect(wb.messages.find(m=>m.id==='config').ok).toBe(true);
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'kuaishou'}});await settle();
    const platform=platforms.find(p=>p.id==='kuaishou')!;harness.navigate(platform.origin+platform.path,'complete');await settle();
    const task=harness.page.messages.find(m=>m.type==='run').task;
    const originalTaskId = task.taskId;
    const originalAttemptId = task.attemptId;
    expect(['cover','pk1','pk3']).toContain(task.coverAssetId);expect(task.pkCoverAssetIds).toEqual(['pk2']);
    harness.page.onMessage.emit({type:'checkpoint',checkpoint:{...task,step:task.step+1,status:'needs_attention',reason:'完成'}});await settle();
    wb.onMessage.emit({id:'retry',command:{type:'retry',taskId:task.taskId}});await settle();
    const retriedSnapshot=wb.messages.find(m=>m.id==='retry').snapshot.batch;
    expect(retriedSnapshot.tasks).toHaveLength(1);
    const retried=retriedSnapshot.tasks[0];
    expect(retried.taskId).toBe(originalTaskId);
    expect(retried.attemptId).not.toBe(originalAttemptId);
    expect(retried.coverAssetId).toBe(task.coverAssetId);expect(retried.pkCoverAssetIds).toEqual(task.pkCoverAssetIds);
    wb.disconnect();await settle();
  });
  it('adopts only its own authorized Douyin popup after file delivery',async()=>{
    const h=worker(),wb=port(1);h.chrome.runtime.onConnect.emit(wb);await settle();
    wb.onMessage.emit({id:'start',command:{type:'start',platform:'douyin'}});await settle();
    const upload=platforms.find(p=>p.id==='douyin')!;h.navigate(upload.origin+upload.path,'complete');await settle();
    const run=h.page.messages.find(m=>m.type==='run'),editor=upload.origin+'/creator-micro/content/post/video?enter_from=publish_page';
    h.page.onMessage.emit({type:'checkpoint',checkpoint:{...run.task,step:run.task.step+1,status:'transferring',pipelineStage:'transfer',reason:'交接'}});await settle();
    const target={sourceTabId:7,sourceFrameId:0,tabId:8,url:editor};
    const current=()=>wb.messages.filter(m=>m.snapshot?.batch?.tasks.length).at(-1).snapshot.batch.tasks.at(-1);
    h.chrome.webNavigation.onCreatedNavigationTarget.emit(target);await settle();expect(current().tabId).toBe(7);
    const sender={id:'review',tab:{id:7},frameId:1,documentId:'bridge',url:'chrome-extension://review/bridge.html#'+run.token};
    let claim:any;h.chrome.runtime.onMessage.emit({type:'bridge-claim',token:run.token},sender,(r:any)=>claim=r);await settle();expect(claim).toMatchObject({ok:true});
    h.page.onMessage.emit({type:'approve',token:run.token,claimId:claim.claimId});await settle();
    let consumed:any;h.chrome.runtime.onMessage.emit({type:'bridge-consume',token:run.token,claimId:claim.claimId},sender,(r:any)=>consumed=r);await settle();expect(consumed.ok).toBe(true);
    h.chrome.webNavigation.onCreatedNavigationTarget.emit({...target,sourceTabId:9});await settle();expect(current().tabId).toBe(7);
    h.chrome.webNavigation.onCreatedNavigationTarget.emit({...target,url:editor+'&evil=1'});await settle();expect(current().tabId).toBe(7);
    h.chrome.tabs.get=async()=>({id:8,status:'complete',url:editor});
    h.chrome.webNavigation.onCreatedNavigationTarget.emit(target);await settle();
    expect(current().tabId).toBe(8);expect(current().videoAlreadyTransferred).toBe(true);expect(current().uploadTabId).toBe(7);
    h.chrome.webNavigation.onCreatedNavigationTarget.emit({...target,sourceTabId:8,tabId:9});await settle();expect(current().tabId).toBe(8);
    wb.disconnect();await settle();
  });
  it('rejects a cover that is not a validated image', async () => {
    const harness=worker(); const wb=port(1); harness.chrome.runtime.onConnect.emit(wb); await settle();
    wb.onMessage.emit({id:'bad-cover',command:{type:'configure',publication:{},coverAssetId:'unknown'}}); await settle();
    expect(wb.messages.find(m=>m.id==='bad-cover')?.ok).toBe(false);
    wb.disconnect(); await settle();
  });
  it('allows repeated loading notifications for one actual navigation', async () => {
    const harness = worker(Promise.resolve(), true);
    const workbench = port(1);
    harness.chrome.runtime.onConnect.emit(workbench);
    await settle();
    workbench.onMessage.emit({ id: 'start', command: { type: 'start', platform: 'xiaohongshu' } });
    await settle();
    const target = platforms[0].origin + platforms[0].path;
    harness.chrome.tabs.onUpdated.emit(7, { status: 'loading' }, { url: target });
    harness.chrome.tabs.onUpdated.emit(7, { status: 'loading' }, { url: target });
    harness.navigate(target, 'complete');
    await settle();
    const runs = harness.page.messages.filter(message => message.type === 'run');
    workbench.disconnect();
    await settle();
    expect(runs).toHaveLength(1);
  });

  it('does not reserve the controller for a workbench closed during initialization', async () => {
    let initialize!: () => void;
    const harness = worker(new Promise(resolve => { initialize = resolve; }));
    const closed = port(1);
    harness.chrome.runtime.onConnect.emit(closed);
    closed.disconnect();
    initialize();
    await settle();

    const reopened = port(2);
    harness.chrome.runtime.onConnect.emit(reopened);
    await settle();

    expect(reopened.messages.some(message => message.error === '已有工作台，请使用原工作台')).toBe(false);
    expect(reopened.messages.some(message => message.type === 'snapshot')).toBe(true);
    reopened.disconnect();
    await settle();
  });

  it('does not launch into a replacement document after navigation during initial loading', async () => {
    const harness = worker();
    const workbench = port(1);
    harness.chrome.runtime.onConnect.emit(workbench);
    await settle();
    workbench.onMessage.emit({ id: 'start', command: { type: 'start', platform: 'xiaohongshu' } });
    await settle();

    // The original target has not completed loading or acquired a document binding.
    // The user leaves it for a different composer on the same allowed platform.
    const replacement = 'https://creator.xiaohongshu.com/different-composer';
    harness.navigate(replacement, 'loading');
    await settle();
    harness.navigate(replacement, 'complete');
    await settle();

    expect(harness.page.messages.filter(message => message.type === 'run')).toEqual([]);
    workbench.disconnect();
    await settle();
  });

  it('recognizes initial navigation when loading and URL arrive separately, then refuses a same-URL refresh', async () => {
    const harness = worker(Promise.resolve(), true);
    const workbench = port(1);
    harness.chrome.runtime.onConnect.emit(workbench);
    await settle();
    workbench.onMessage.emit({ id: 'start', command: { type: 'start', platform: 'xiaohongshu' } });
    await settle();

    const platform = platforms[0];
    const target = platform.origin + platform.path;
    harness.navigate(target, 'loading');
    await settle();
    harness.navigate(target, 'complete');
    await settle();

    const runs = harness.page.messages.filter(message => message.type === 'run');
    workbench.disconnect();
    await settle();
    expect(runs).toEqual([]);
  });
});
