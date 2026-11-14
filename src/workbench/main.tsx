import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { platforms, isActive, type Batch, type PlatformId, type TaskStatus } from '../core/model';
import { saveAsset, deleteBatchAssets } from '../core/assets';
import type { WorkbenchCommand, Response, Snapshot } from '../core/protocol';
import './style.css';
import { TaskProgress } from './TaskProgress';
import { createDiagnostics, diagnosticTask } from '../core/diagnostics';
const diagnostics = createDiagnostics('workbench',chrome.storage.local);
void diagnostics.record('page.loaded');
import { requestPermission } from '../core/permission-wait';
import { keepConnectionAlive } from '../core/connection';
import { inspectCover } from '../core/covers';
import { normalizePublication, normalizeDouyinPublication, parseTags, scheduleWindowMs } from '../core/publication';
import { coverPkEnabled, flattenCovers, splitCovers } from '../core/cover-order';
import { readStoredCollection, readStoredTags, restoreCollection, restoreTags, writeStoredCollection, writeStoredTags } from '../core/tag-storage';
import { CoverPreviewList } from './CoverPreviewList';

const labels: Record<TaskStatus, string> = { checking: '检查页面', transferring: '传递文件', needs_attention: '需你处理', paused: '已暂停', aborted: '已中止', failed: '失败' };
function localDateTimeValue(offsetMs: number) {
  const date = new Date(Date.now() + offsetMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function App() {
  const [batch, setBatch] = useState<Batch>();
  const [selected, setSelected] = useState<PlatformId[]>(() => platforms.map(platform => platform.id));
  const [error, setError] = useState('');
  const [startPhase,setStartPhase] = useState('');
  const [startClicks,setStartClicks] = useState(0);
  useEffect(()=>{if(error)void diagnostics.record('ui.error',{code:error.includes('授权')?'permission':error.includes('连接')?'connection':error.includes('最多')?'validation':'operation'});},[error]);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error){feedback.current?.scrollIntoView({block:'nearest'});feedback.current?.focus({preventScroll:true});}},[error]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [collection, setCollection] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [cover, setCover] = useState<Batch['cover']>();
  const [pkCovers,setPkCovers] = useState<NonNullable<Batch['pkCovers']>>([]);
  const port = useRef<chrome.runtime.Port | null>(null);
  const latest = useRef<Batch | undefined>(undefined);
  const stopped = useRef(false);
  const permissionWait = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const pending = useRef(new Map<string, { resolve: (snapshot: Snapshot) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
  const waiters = useRef(new Set<() => void>());
  function update(snapshot: Snapshot) {
    const changed = latest.current?.id !== snapshot.batch?.id;
    latest.current = snapshot.batch; setBatch(snapshot.batch);
    if (changed || !snapshot.batch) {
      setTitle(snapshot.batch?.publication?.title ?? ''); setDescription(snapshot.batch?.publication?.description ?? '');
      setTags(restoreTags(snapshot.batch?.publication, readStoredTags())); setCollection(restoreCollection(snapshot.batch?.publication, readStoredCollection())); setScheduleAt(snapshot.batch?.publication?.scheduleAt ?? ''); setCover(snapshot.batch?.cover); setPkCovers(snapshot.batch?.pkCovers ?? []);
    }
    const last=snapshot.batch?.tasks.at(-1);
    if(last?.status==='needs_attention' && last.step===0)setError(last.reason);
    for (const wake of waiters.current) wake();
  }
  function request(command: WorkbenchCommand): Promise<Snapshot> {
    if (!port.current) return Promise.reject(new Error('连接已断开，请重新打开工作台'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      void diagnostics.record('command.sent',{command:command.type,requestId:id});
      const timer = setTimeout(() => { pending.current.delete(id); void diagnostics.record('command.timeout',{command:command.type,requestId:id}); reject(new Error('操作超时，请检查页面')); }, 30000);
      pending.current.set(id, { resolve, reject, timer });
      try { port.current!.postMessage({ id, command }); }
      catch { clearTimeout(timer); pending.current.delete(id); reject(new Error('连接已断开')); }
    });
  }
  useEffect(() => {
    void diagnostics.record('connection.opening');
    const connection = chrome.runtime.connect({ name: 'workbench' });
    port.current = connection;
    const stopHeartbeat = keepConnectionAlive(() => connection.postMessage({ type: 'heartbeat' }));
    connection.onMessage.addListener((message: Response & { type?: string }) => {
      if (message.snapshot) { setConnected(true); update(message.snapshot); }
      const item = message.id ? pending.current.get(message.id) : undefined;
      if (item) {
        void diagnostics.record('command.reply',{requestId:message.id,result:message.ok});
        clearTimeout(item.timer); pending.current.delete(message.id!);
        if (message.ok) item.resolve(message.snapshot ?? {}); else item.reject(new Error(message.error));
      } else if (message.error) setError(message.error);
    });
    connection.onDisconnect.addListener(() => {
      void diagnostics.record('connection.disconnected');
      stopHeartbeat(); permissionWait.current?.abort();
      void chrome.runtime.lastError;
      port.current = null; stopped.current = true; runningRef.current = false;
      setConnected(false); setRunning(false); setBusy(false);
      setError('工作台连接已断开，自动操作已停止。重新打开只恢复记录。');
      for (const item of pending.current.values()) { clearTimeout(item.timer); item.reject(new Error('连接已断开')); }
      pending.current.clear(); for (const wake of waiters.current) wake();
    });
    // Wait for the initial snapshot: background initialization can be asynchronous.
    const initial = (message: { type?: string }) => {
      if (message.type === 'snapshot') { connection.onMessage.removeListener(initial); void request({ type: 'get' }).catch(e => setError(e.message)); }
    };
    connection.onMessage.addListener(initial);
    return () => { stopHeartbeat(); connection.disconnect(); };
  }, []);
  async function exportDiagnostics() {
    try {
      await diagnostics.record('export.requested');
      const stored=await chrome.storage.local.get(['diagnostics.workbench','diagnostics.background','state']);
      const {state:storedState,...logs}=stored;
      const tasks=((storedState as {batch?:{tasks?:Record<string,unknown>[]}} | undefined)?.batch?.tasks ?? []).map(diagnosticTask);
      const blob=new Blob([JSON.stringify({version:'2026-11-09.10',exportedAt:new Date().toISOString(),tasks,logs},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='video-upload-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch {setError('导出诊断日志失败，请检查浏览器下载设置');}
  }
  const active = batch?.tasks.some(task => isActive(task.status));
  const metadataLocked = !connected || !batch || busy || running || active || !!batch.tasks.length;
  async function chooseCover(files: File[]) {
    if (!files.length || !batch || metadataLocked) return;
    setBusy(true); setError('');
    try {
      // Each file-picker action adds to the current ordered list. The first
      // selected image remains the main cover; later images become PK covers.
      const existing = flattenCovers(cover, pkCovers);
      const total = existing.length + files.length;
      if (total > 4) throw new Error('最多选择 4 张封面（1 张主封面 + 3 张 PK）');
      for (const file of files) {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 20*1024*1024) throw new Error('封面支持 JPG、PNG、WebP，最大 20 MiB');
      if (total > 1 && !['image/jpeg','image/png'].includes(file.type)) throw new Error('多封面请选择 JPG 或 PNG');
      await inspectCover(file);
      }
      const assets = await Promise.all(files.map(file=>saveAsset(batch.id,file)));
      const next = [...existing, ...assets];
      setCover(next[0]); setPkCovers(next.slice(1));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  function updateCoverOrder(items: NonNullable<Batch['cover']>[]) {
    const next = splitCovers(items);
    setCover(next.cover);
    setPkCovers(next.pkCovers);
  }
  async function choose(file?: File) {
    if (!file || busy || batch) return;
    setError(''); setBusy(true);
    const id = crypto.randomUUID();
    try {
      if (!file.type.startsWith('video/')) throw new Error('请选择视频文件');
      const asset = await saveAsset(id, file);
      try { await request({ type: 'prepare', asset }); }
      catch (error) { await deleteBatchAssets(id); throw error; }
    } catch (error) { setError(error instanceof Error ? error.message : '保存素材失败'); }
    finally { setBusy(false); }
  }
  async function waitForHandoff() {
    if (!latest.current?.tasks.some(task => isActive(task.status))) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { waiters.current.delete(check); reject(new Error('任务未按时结束，请检查原页面')); }, 18 * 60 * 1000);
      const check = () => {
        if (stopped.current || !latest.current?.tasks.some(task => isActive(task.status))) {
          clearTimeout(timer); waiters.current.delete(check); resolve();
        }
      };
      waiters.current.add(check); check();
    });
  }
  async function start() {
    void diagnostics.record('start.clicked',{connected,busy,active:!!active,running:runningRef.current,count:selected.length});
    setStartClicks(count=>count+1);
    if (runningRef.current || busy || active || !selected.length) {
      void diagnostics.record('start.blocked',{busy,active:!!active,running:runningRef.current});
      setError(runningRef.current ? '上次启动流程尚未结束，请先停止并接管页面' : busy ? '素材仍在处理中，请稍后开始' : active ? '已有平台任务正在执行，请查看平台记录' : '请先选择目标平台');
      return;
    }
    runningRef.current = true; stopped.current = false; setRunning(true); setError(''); setStartPhase('正在检查填写内容…');
    const targets = platforms.filter(item => selected.includes(item.id) && !batch?.tasks.some(task => task.platform === item.id));
    try {
      if (!targets.length) throw new Error('所选平台均已尝试，请检查原页面');
      const publicationWithSchedule = normalizePublication({title, description, tags: parseTags(tags), collection, scheduleAt: scheduleAt || undefined}, false);
      if (targets.some(p=>p.id === 'xiaohongshu')) normalizePublication(publicationWithSchedule);
      if (targets.some(p=>p.id === 'douyin')) normalizeDouyinPublication(publicationWithSchedule);
      if (targets.some(p=>!['xiaohongshu','kuaishou','douyin','weixin','bilibili'].includes(p.id)) && (title || description || publicationWithSchedule.tags.length || publicationWithSchedule.collection || publicationWithSchedule.scheduleAt || cover)) throw new Error('文案、合集、定时发布时间和封面自动填写目前仅支持小红书、快手、抖音、视频号和 B 站');
      writeStoredTags(publicationWithSchedule.tags.join(','));
      writeStoredCollection(publicationWithSchedule.collection ?? '');
      // Request optional hosts directly from the user gesture, before any asynchronous work.
      setStartPhase('正在等待浏览器站点授权，请查看权限提示…');
      const cancellation = new AbortController(); permissionWait.current = cancellation;
      void diagnostics.record('permission.request');
      const allowed = await requestPermission(()=>chrome.permissions.request({ origins: targets.map(item => `${item.origin}/*`) }), cancellation.signal);
      if (stopped.current || cancellation.signal.aborted) return;
      void diagnostics.record('permission.result',{result:allowed});
      if (!allowed) throw new Error('未授权访问所选平台');
      setStartPhase('正在保存本次填写内容并打开平台…');
      if (!batch?.tasks.length) await request({type:'configure', publication: publicationWithSchedule, coverAssetId:cover?.id, pkCoverAssetIds:pkCovers.map(c=>c.id), coverPk:coverPkEnabled(pkCovers) ? true : undefined});
      for (const target of targets) {
        if (stopped.current) break;
        try { await request({ type: 'start', platform: target.id }); setStartPhase('任务已开始，请查看平台记录；等待上传和填写完成…'); await waitForHandoff(); }
        catch (error) {
          if (latest.current?.tasks.some(task => isActive(task.status))) { await request({ type: 'stop' }); throw error; }
          setError(error instanceof Error ? error.message : '平台操作失败');
        }
      }
    } catch (error) { setError(error instanceof Error ? error.message : '操作失败'); }
    finally { permissionWait.current = null; runningRef.current = false; setRunning(false); setStartPhase(''); }
  }
  async function retry(taskId:string) {
    if(runningRef.current || busy || active)return;
    runningRef.current=true;stopped.current=false;setRunning(true);setError('');setStartPhase('正在确认原页面已关闭并复用已保存素材…');
    try {await request({type:'retry',taskId});await waitForHandoff();}
    catch(error){setError(error instanceof Error?error.message:'重新打开失败，素材仍保留');}
    finally{runningRef.current=false;setRunning(false);setStartPhase('');}
  }
  async function stop() {
    stopped.current = true; permissionWait.current?.abort();
    for (const wake of waiters.current) wake();
    try { await request({ type: 'stop' }); } catch (error) { setError((error as Error).message); }
  }
  async function clear() {
    if (busy || running) return;
    setBusy(true); setError('');
    try { await request({ type: 'clear' }); } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <main>
    <header><div className="brand">视频上传工作台</div><span className="edition">多平台填表实验版</span></header>
    <section className="intro"><h1>上传、填表，最后由你检查。</h1><p>小红书、抖音和视频号填写标题、正文和标签；快手作品描述仅用标题，换行后填写前 4 个标签；B 站填写标题、简介、平台标签和单张封面。平台有合集或定时控件时会按名称或时间填写并回读；没有对应控件的平台会跳过。平台话题与裁剪结果需要你确认。</p></section>
    <div className="workspace">
      <section className="source" aria-labelledby="source-title"><h2 id="source-title">本次素材</h2>
        <label className="file-picker"><span>{batch ? batch.asset.name : '选择本地视频'}</span>
          <input aria-label="选择本地视频" type="file" accept="video/*" disabled={!connected || busy || !!batch} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        {batch && <p className="file-info">{(batch.asset.size / 1024 / 1024).toFixed(1)} MiB · 仅缓存于此浏览器</p>}
        <fieldset className="publication-fields" disabled={metadataLocked}>
          <legend>文案与封面</legend>
          <label>标题<input aria-label="标题" value={title} onChange={e=>setTitle(e.target.value)} placeholder="小红书最多 20 字，不会自动截断" /></label>
          <label>内容描述<textarea aria-label="内容描述" rows={5} value={description} onChange={e=>setDescription(e.target.value)} placeholder="小红书正文与标签合计最多 1000 字；快手不使用正文" /></label>
          <label>标签<textarea aria-label="标签" rows={2} value={tags} onChange={e=>setTags(e.target.value)} placeholder="逗号、换行或 # 分隔；小红书最多 10 个，快手取前 4 个" /></label>
          <p className="hint">标签将以 #标签 文本填入正文；平台话题候选需要你确认。留空的字段不填写。</p>
          <label>合集名称（平台支持时）<input aria-label="合集名称" value={collection} onChange={e=>setCollection(e.target.value)} placeholder="填写后按名称选择平台已有合集" /></label>
          <p className="hint">支持合集的平台会查找名称完全相同的已有合集并回读选择结果；没有合集控件的平台会跳过。</p>
          <label>定时发布时间（平台支持时）<span className="schedule-controls"><input aria-label="定时发布时间" type="datetime-local" value={scheduleAt} min={localDateTimeValue(60_000)} max={localDateTimeValue(scheduleWindowMs)} onChange={e=>setScheduleAt(e.target.value)} /><button type="button" onClick={()=>setScheduleAt('')} disabled={!scheduleAt}>清理定时</button></span></label>
          <p className="hint">有定时控件的平台会设置并回读日期和时间；没有对应控件的平台会跳过。只能设置未来 7 天内的时间。仍需你最后检查并点击发布；清理后不会设置定时发布。</p>
          <label>可选封面<input aria-label="选择封面图片" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{void chooseCover(Array.from(e.target.files ?? []));e.target.value='';}} /></label>
          <CoverPreviewList items={flattenCovers(cover, pkCovers)} disabled={metadataLocked} onChange={updateCoverOrder} />
          <p className="hint">最多 4 张。第一次选择的图片自动作为主封面，之后继续选择的图片会按顺序追加为 PK 候选；不需要单独开启开关。只支持 4:3 和 3:4。快手两种比例各取一张；只有一种比例时随机取两张（只有一张则用一张），重试沿用所选图片。抖音按横/竖比例各取第一张，没有的比例保留平台默认。不选择时保留平台默认封面。自定义封面使用平台默认裁剪，遇到额外裁剪步骤时交给你处理。</p>
        </fieldset>
        <h2>目标平台</h2><p className="hint">小红书、快手、抖音、视频号和 B 站支持实验性填表，其余平台仅交接视频；均需在原页面检查。支持 PK 的平台会使用全部封面；不支持 PK 的平台只使用第一张主封面。</p><p className="hint">快手、抖音默认禁止他人下载/保存。小红书、视频号和 B 站暂未找到对应开关，会提示人工检查。</p>
        <fieldset disabled={running || active || busy}><legend className="sr-only">选择目标平台</legend>
          {platforms.map(platform => <label className="platform" key={platform.id}>
            <input type="checkbox" checked={selected.includes(platform.id)} onChange={event => { const checked = event.currentTarget.checked; setSelected(ids => checked ? [...ids, platform.id] : ids.filter(id => id !== platform.id)); }} />
            <span>{platform.name}</span><small>{batch?.tasks.some(task => task.platform === platform.id) ? '已尝试' : '待验证'}</small>
          </label>)}
        </fieldset>
        <p className="hint" data-testid="start-diagnostics">诊断版 2026-11-09.10 · {startClicks ? `已收到 ${startClicks} 次开始点击` : '尚未收到开始点击'}</p>
        <button type="button" onClick={()=>void exportDiagnostics()}>导出诊断日志</button>
        {error && <p ref={feedback} tabIndex={-1} role="alert" className="error">{error}</p>}
        {running && <p role="status" className="hint">{startPhase}</p>}
        <button className="primary" onClick={() => void start()} disabled={!connected || !batch || running || active || busy || !selected.some(id => !batch.tasks.some(task => task.platform === id))}>开始文件交接验证</button>
        {(running || active) && <button className="stop" onClick={() => void stop()}>停止并接管页面</button>}
        <p className="hint">运行时保持工作台打开。平台收到素材后可能继续上传；停止操作不会撤回已传数据。</p>
      </section>
      <section className="results" aria-labelledby="results-title"><h2 id="results-title">平台记录</h2>
        <p className="boundary">发布由你操作。插件不会点击发布或存草稿。</p>
          <div aria-live="polite">{!batch?.tasks.length ? <div className="empty"><span className="empty-symbol" aria-hidden="true">↗</span><h3>还没有交接记录</h3><p>选择素材和平台后开始。已打开的编辑页面会保留，方便你检查。</p></div> : batch.tasks.map(task => <article className="task" key={task.taskId}><div className="task-heading"><h3>{platforms.find(p=>p.id===task.platform)?.name}</h3><span className={`status ${isActive(task.status) ? 'active' : ''}`}>{task.status === 'needs_attention' && task.pipelineStage !== 'downloads' && (task.reason.startsWith('标题、正文已回读核验；') || task.reason.startsWith('作品描述已回读核验') || task.reason.startsWith('抖音标题、简介已回读核验；') || task.reason.startsWith('视频号短标题和视频描述已回读核验；') || task.reason.startsWith('B站标题和简介已回读核验；')) ? '填写完成，待检查' : task.status === 'needs_attention' && /超时|等待超过/.test(task.reason) ? '等待超时，已停止' : labels[task.status]}</span></div><TaskProgress task={task}/><p>{task.reason}</p><button onClick={() => void request({ type: 'open', taskId: task.taskId }).catch(e => setError(e.message))}>打开页面</button>{batch.tasks.filter(item=>item.platform===task.platform).at(-1)?.taskId===task.taskId && <><button disabled={!connected || running || active || busy} onClick={()=>void retry(task.taskId)}>保留素材重新打开</button><p className="hint">仅原标签页已关闭时可用；会重新上传并填写，沿用本次视频、文案和封面。</p></>}</article>)}</div>
        {batch && <footer><button disabled={busy || running || active} onClick={() => void clear()}>结束并清理素材与记录</button><p className="hint">只清理插件缓存，平台页面和已上传的素材由你管理。</p></footer>}
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
