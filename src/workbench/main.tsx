import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { platforms, isActive, type Batch, type PlatformId, type TaskStatus } from '../core/model';
import { saveAsset, deleteBatchAssets } from '../core/assets';
import type { WorkbenchCommand, Response, Snapshot } from '../core/protocol';
import './style.css';
import { TaskProgress } from './TaskProgress';
import { isReviewReady } from '../core/task-progress';
import { createDiagnostics, diagnosticTask } from '../core/diagnostics';
const diagnostics = createDiagnostics('workbench',chrome.storage.local);
void diagnostics.record('page.loaded');
import { requestPermission } from '../core/permission-wait';
import { connectWorkbench, type ConnectionState } from '../core/connection';
import { inspectCover } from '../core/covers';
import { normalizePublication, normalizeDouyinPublication, parseTags, scheduleWindowMs } from '../core/publication';
import { coverPkEnabled, flattenCovers, MAX_LOCAL_COVERS, splitCovers } from '../core/cover-order';
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
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const connected = connectionState === 'connected';
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [collection, setCollection] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [cover, setCover] = useState<Batch['cover']>();
  const [pkCovers,setPkCovers] = useState<NonNullable<Batch['pkCovers']>>([]);
  const connection = useRef<ReturnType<typeof connectWorkbench> | null>(null);
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
    const port = connection.current?.port;
    if (!connected || !port) return Promise.reject(new Error('工作台未连接，请先恢复连接'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      void diagnostics.record('command.sent',{command:command.type,requestId:id});
      const timer = setTimeout(() => { pending.current.delete(id); void diagnostics.record('command.timeout',{command:command.type,requestId:id}); reject(new Error('操作超时，请检查页面')); }, 30000);
      pending.current.set(id, { resolve, reject, timer });
      try { port.postMessage({ id, command }); }
      catch { clearTimeout(timer); pending.current.delete(id); reject(new Error('连接已断开')); }
    });
  }
  useEffect(() => {
    let initialSnapshot = true;
    let interrupted = false;
    const session = connectWorkbench({
      connect: () => chrome.runtime.connect({ name: 'workbench' }),
      lastError: () => chrome.runtime.lastError?.message,
      onEvent: (event, details) => {
        if (event === 'connection.opening') initialSnapshot = true;
        void diagnostics.record(event, { ...details, phase: document.visibilityState });
      },
      onState: state => {
        setConnectionState(state);
        if (state === 'connected' && interrupted) setError(previous => previous.startsWith('工作台连接') ? '工作台连接已恢复，任务不会自动继续；请检查原页面后手动继续同步。' : previous);
      },
      onMessage: (message: Response & { type?: string }) => {
        if (message.snapshot) update(message.snapshot);
        const item = message.id ? pending.current.get(message.id) : undefined;
        if (item) {
          void diagnostics.record('command.reply',{requestId:message.id,result:message.ok});
          clearTimeout(item.timer); pending.current.delete(message.id!);
          if (message.ok) item.resolve(message.snapshot ?? {}); else item.reject(new Error(message.error));
        } else if (message.error) setError(message.error);
        if (message.type === 'snapshot' && initialSnapshot) {
          initialSnapshot = false;
          // The snapshot itself establishes readiness. Do not use the initial
          // render's request() closure, whose connected state is still false.
          session.port?.postMessage({ id: crypto.randomUUID(), command: { type: 'get' } });
        }
      },
      onDisconnect: reason => {
        interrupted = true; permissionWait.current?.abort();
        stopped.current = true; runningRef.current = false;
        setRunning(false); setBusy(false); setStartPhase('');
        const batch = latest.current;
        if (batch) update({ batch: { ...batch, tasks: batch.tasks.map(task => isActive(task.status) ? { ...task, status: 'paused', reason: '工作台连接中断，自动操作已停止；请检查原页面后手动继续同步。' } : task) } });
        setError(/已有工作台/.test(reason) ? reason : /context invalidated/i.test(reason) ? '插件已重新加载，请刷新工作台恢复连接；任务不会自动继续。' : '工作台连接中断，自动操作已停止。恢复连接后请手动继续同步。');
        for (const item of pending.current.values()) { clearTimeout(item.timer); item.reject(new Error('连接已断开')); }
        pending.current.clear(); for (const wake of waiters.current) wake();
      },
    });
    connection.current = session;
    const visible = () => {
      void diagnostics.record('page.visibility', { phase: document.visibilityState });
    };
    document.addEventListener('visibilitychange', visible);
    return () => { document.removeEventListener('visibilitychange', visible); session.close(); connection.current = null; };
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
  const pendingPlatforms = selected.filter(id => !batch?.tasks.some(task => task.platform === id));
  async function chooseCover(files: File[]) {
    if (!files.length || !batch || metadataLocked) return;
    setBusy(true); setError('');
    try {
      // Each file-picker action adds to the current ordered list. The first
      // selected image remains the main cover; later images become PK covers.
      const existing = flattenCovers(cover, pkCovers);
      const total = existing.length + files.length;
      if (total > MAX_LOCAL_COVERS) throw new Error('最多从本地添加到 4 张封面');
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
  async function resume(taskId:string) {
    if(runningRef.current || busy || active)return;
    runningRef.current=true;stopped.current=false;setRunning(true);setError('');setStartPhase('正在原平台页面继续同步，已上传视频不会重复上传…');
    try {await request({type:'resume',taskId});await waitForHandoff();}
    catch(error){setError(error instanceof Error?error.message:'继续同步失败，素材仍保留');}
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
    <a className="skip-link" href="#workspace">跳到填写区域</a>
    <header>
      <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">↗</span><div><div className="brand">视频上传工作台</div><span className="edition">快速填表 · 手动发布</span></div></div>
      <div className="connection-controls"><span className={`connection-pill ${connected ? 'is-connected' : ''}`} role="status"><span aria-hidden="true" />{{ connecting: '正在连接…', connected: '已连接', reconnecting: '正在重新连接…', disconnected: '连接已断开' }[connectionState]}</span>{connectionState === 'disconnected' && <button type="button" onClick={() => connection.current?.reconnect()}>重新连接</button>}</div>
    </header>
    <section className="intro" aria-labelledby="page-title"><p className="eyebrow">VIDEO WORKBENCH</p><h1 id="page-title">准备好内容，交给平台填写。</h1><p className="intro-copy">按顺序完成 3 步，上传和填写完成后在各平台编辑页检查。</p><ol className="flow-steps" aria-label="操作步骤"><li className="is-current"><span>1</span>选择素材</li><li><span>2</span>填写内容</li><li><span>3</span>交接并检查</li></ol></section>
    <div className="workspace" id="workspace">
      <section className="source" aria-labelledby="source-title">
        <div className="section-heading"><div><p className="section-kicker">STEP 1–2</p><h2 id="source-title">素材与内容</h2></div><span className="required-note">均为可选</span></div>
        <label className={`file-picker ${batch ? 'has-file' : ''}`}>
          <span className="file-picker-icon" aria-hidden="true">{batch ? '✓' : '↑'}</span><span className="file-picker-copy"><strong>{batch ? batch.asset.name : '选择视频文件'}</strong><small>{batch ? '素材已准备，可继续填写' : '支持 MP4、MOV 等视频格式'}</small></span>
          <input aria-label="选择本地视频" type="file" accept="video/*" disabled={!connected || busy || !!batch} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        {batch && <p className="file-info"><span aria-hidden="true">●</span> {(batch.asset.size / 1024 / 1024).toFixed(1)} MiB · 仅缓存于此浏览器</p>}
        <fieldset className="publication-fields" disabled={metadataLocked}>
          <legend><span>填写内容</span><small>留空字段会跳过</small></legend>
          <label><span className="field-label">标题 <small>{title.length}/20</small></span><input name="title" autoComplete="off" aria-label="标题" value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：今天的工作记录…" /></label>
          {!!batch?.externalImport?.candidateTitles.length && <label>
            <span className="field-label">候选标题</span>
            <select value="" onChange={event => setTitle(event.target.value)}>
              <option value="" disabled>选择候选标题</option>
              {batch.externalImport.candidateTitles.map(value => <option key={value}>{value}</option>)}
            </select>
          </label>}
          <label><span className="field-label">内容描述 <small>{description.length} 字</small></span><textarea name="description" autoComplete="off" aria-label="内容描述" rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="写下这条视频的重点…" /></label>
          <label><span className="field-label">标签 <small>用逗号或换行分隔</small></span><textarea name="tags" autoComplete="off" aria-label="标签" rows={2} value={tags} onChange={e=>setTags(e.target.value)} placeholder="#日常，工作记录…" /></label>
          <div className="field-grid">
            <label>
              <span className="field-label">合集名称</span>
              <input name="collection" autoComplete="off" aria-label="合集名称" aria-describedby="collection-help" value={collection} onChange={e=>setCollection(e.target.value)} placeholder="平台上已有的合集名称" />
              <small id="collection-help" className="hint">小红书、抖音、视频号按名称匹配已有合集，留空时跳过。</small>
            </label>
            <label><span className="field-label">定时发布时间 <small>未来 7 天内</small></span><span className="schedule-controls"><input name="scheduleAt" aria-label="定时发布时间" type="datetime-local" value={scheduleAt} min={localDateTimeValue(60_000)} max={localDateTimeValue(scheduleWindowMs)} onChange={e=>setScheduleAt(e.target.value)} /><button type="button" onClick={()=>setScheduleAt('')} disabled={!scheduleAt} aria-label="清除定时发布时间">清除</button></span></label>
          </div>
          <div className="cover-options"><label><span className="field-label">封面图 <small>本地添加最多 4 张</small></span><input aria-label="选择封面图片" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>{void chooseCover(Array.from(e.target.files ?? []));e.target.value='';}} /></label><CoverPreviewList items={flattenCovers(cover, pkCovers)} disabled={metadataLocked} onChange={updateCoverOrder} /><p className="hint">第一张是主图，后续是 PK 候选。小红书使用前 4 张，请在平台页面检查裁剪效果。</p></div>
          <details className="advanced-options"><summary>平台填写说明</summary><div className="advanced-content"><p className="hint">标签会以 #文本 填入正文；合集与定时控件只在平台支持时填写并回读。</p></div></details>
        </fieldset>
        <section className="platform-picker" aria-labelledby="platform-title"><div className="section-heading"><div><p className="section-kicker">STEP 3</p><h2 id="platform-title">选择目标平台</h2></div><span className="selection-count">{pendingPlatforms.length} 个待交接</span></div><p className="hint">可多选。已完成的平台会自动跳过。</p>
          <fieldset disabled={running || active || busy}><legend className="sr-only">选择目标平台</legend><div className="platform-grid">{platforms.map(platform => <label className={`platform ${selected.includes(platform.id) ? 'is-selected' : ''}`} key={platform.id}><input type="checkbox" checked={selected.includes(platform.id)} onChange={event => { const checked = event.currentTarget.checked; setSelected(ids => checked ? [...ids, platform.id] : ids.filter(id => id !== platform.id)); }} /><span className="platform-check" aria-hidden="true">{selected.includes(platform.id) ? '✓' : ''}</span><span>{platform.name}</span><small>{batch?.tasks.some(task => task.platform === platform.id) ? '已尝试' : '待验证'}</small></label>)}</div></fieldset>
        </section>
        <div className="action-bar">
          {error && <p ref={feedback} tabIndex={-1} role="alert" className="error">{error}</p>}
          {running && <p role="status" className="running-status"><span className="spinner" aria-hidden="true" />{startPhase}</p>}
          <button className="primary" onClick={() => void start()} disabled={!connected || !batch || running || active || busy || !selected.some(id => !batch.tasks.some(task => task.platform === id))}>开始文件交接验证</button>
          {(running || active) && <button className="stop" onClick={() => void stop()}>停止并接管页面</button>}
          <p className="action-note">运行时保持工作台打开 · 发布仍由你确认</p>
        </div>
        <details open className="utility-actions"><summary>工具与诊断</summary><div><button type="button" onClick={()=>void exportDiagnostics()}>导出诊断日志</button></div></details><p className="hint diagnostics" data-testid="start-diagnostics">诊断版 2026-11-09.10 · {startClicks ? `已收到 ${startClicks} 次开始点击` : '尚未收到开始点击'}</p>
      </section>
      <section className="results" aria-labelledby="results-title"><div className="results-heading"><div><p className="section-kicker">LIVE STATUS</p><h2 id="results-title">平台记录</h2></div><span className="record-count">{batch?.tasks.length ?? 0} 条记录</span></div>
        <p className="boundary"><span aria-hidden="true">✓</span><span><strong>最后一步由你完成</strong><small>上传和填写完成后保留编辑页，由你手动发布。</small></span></p>
        <div aria-live="polite">{!batch?.tasks.length ? <div className="empty"><span className="empty-symbol" aria-hidden="true">✦</span><h3>准备开始</h3><p>选择视频、填写内容并勾选平台，交接记录会显示在这里。</p></div> : batch.tasks.map(task => { const latestForPlatform = batch.tasks.filter(item=>item.platform===task.platform).at(-1)?.taskId===task.taskId; const canResume = latestForPlatform && (task.platform !== 'bilibili' || !!task.completedStages) && task.bilibiliDraft?.phase !== 'saved' && (!!task.documentId || !!task.bilibiliDraft) && ['needs_attention','paused','aborted','failed'].includes(task.status) && (task.pipelineStage === 'upload' || task.pipelineStage === 'copy' || task.pipelineStage === 'pk' || task.pipelineStage === 'declaration' || task.pipelineStage === 'collection' || task.pipelineStage === 'category' || task.pipelineStage === 'schedule' || task.pipelineStage === 'review' || task.pipelineStage === 'downloads' || task.pipelineStage === 'draft' || task.pipelineStage?.startsWith('cover-'));
          const reviewReady = isReviewReady(task);
          const statusLabel = reviewReady
            ? (task.bilibiliDraft?.phase === 'saved' ? '草稿已保存' : '插件已完成')
            : task.status === 'needs_attention' && /超时|等待超过/.test(task.reason) ? '等待超时，已停止' : labels[task.status];
          return <article className="task" key={task.taskId}><div className="task-heading"><h3>{platforms.find(p=>p.id===task.platform)?.name}</h3><span className={`status ${reviewReady ? 'done' : isActive(task.status) ? 'active' : ''}`}>{statusLabel}</span></div><TaskProgress task={task}/><p>{task.reason}</p><div className="task-actions"><button onClick={() => void request({ type: 'open', taskId: task.taskId }).catch(e => setError(e.message))}>{task.bilibiliDraft?.draftId ? '打开草稿' : '打开页面'}</button>{canResume && <button disabled={!connected || running || active || busy} onClick={()=>void resume(task.taskId)}>{task.bilibiliDraft ? '核验草稿保存结果' : '继续同步（不重复上传）'}</button>}{latestForPlatform && !task.bilibiliDraft && <button disabled={!connected || running || active || busy} onClick={()=>void retry(task.taskId)}>保留素材重新打开</button>}</div>{latestForPlatform && <p className="hint">{task.bilibiliDraft ? '草稿保存记录已保留；结果不明时只读核验，不会重复上传或再次创建。' : '继续同步复用原平台页面和已上传视频；原页面关闭后再用“保留素材重新打开”。'}</p>}</article>})}</div>
        {batch && <footer><button disabled={busy || running || active} onClick={() => void clear()}>结束并清理素材与记录</button><p className="hint">只清理插件缓存，平台页面和已上传素材由你管理。</p></footer>}
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
