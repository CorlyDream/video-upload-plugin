import {isReviewReady,taskProgress} from '../core/task-progress';
import {keepConnectionAlive} from '../core/connection';
import {disableDownloads} from './downloads';
import {isDouyinUploadTransition} from '../core/platform-navigation';
import {fillDouyin} from './douyin';
import { hasDownloadSettings, type Task } from '../core/model';
import type { PageCommand } from '../core/protocol';
import { hasPublication, normalizePublication } from '../core/publication';
import { fillXiaohongshu } from './xiaohongshu';
import { fillKuaishou } from './kuaishou';
import { clickWeixinOriginalConfirm, fillWeixin, openWeixinUploadEntry, weixinSearchRoots } from './weixin';
import { fillBilibili, resolveBilibiliTransferInput, selectBilibiliUploadInput } from './bilibili';

// Re-injection must never attach a second executor to the same document.
const scope = globalThis as typeof globalThis & { __videoUploadM0?: boolean };
if (!scope.__videoUploadM0) {
  scope.__videoUploadM0 = true;
  const onConnect = (port: chrome.runtime.Port) => {
    if (port.name !== 'upload-page') return;
    let task: Task | undefined;
    let stopped = false;
    const stopHeartbeat = keepConnectionAlive(() => port.postMessage({type:'heartbeat'}));
    const cancellation = new AbortController();
    let ownSynchronousEdit = false;
    let iframe: HTMLIFrameElement | undefined;
    let channel: MessagePort | undefined;
    let expectedClaim: string | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let inspectTimer: ReturnType<typeof setInterval> | undefined;
    let observer: MutationObserver | undefined;
    let initialUrl = '';
    let allowUploadTransition = false;
    let uploadEntryOpened = false;
    const progressPanelId = 'video-upload-plugin-progress';
    const stageLabels: Record<string, string> = {
      page: '打开并检查页面', transfer: '交接视频文件', upload: '等待视频上传与处理',
      category: '选择并核验亲子分区',
      copy: '填写并核验文案', pk: '设置封面 PK', declaration: '设置原创 / AI 声明', collection: '选择并核验合集',
      schedule: '设置并核验定时发布', review: '交接人工检查', downloads: '核验下载权限',
    };
    const platformLabels: Record<string, string> = { xiaohongshu:'小红书', douyin:'抖音', weixin:'视频号', bilibili:'B站', kuaishou:'快手' };
    const layoutProgressPanel = (panel: HTMLElement) => {
      const expanded = panel.matches(':hover') || panel.matches(':focus-within');
      panel.style.width = expanded ? '292px' : '244px';
      panel.style.maxHeight = 'calc(100vh - 32px)';
      panel.style.overflowY = 'auto';
      for (const node of panel.querySelectorAll<HTMLElement>('[data-progress-detail],[data-progress-list]')) {
        node.style.display = expanded || node.dataset.progressPersistent === 'true' ? 'block' : 'none';
      }
    };
    const progressPanel = () => {
      let panel = document.getElementById(progressPanelId);
      if (!(panel instanceof HTMLElement)) {
        panel = document.createElement('div'); panel.id = progressPanelId;
        Object.assign(panel.style, { position:'fixed', top:'16px', right:'16px', zIndex:'2147483647', width:'244px', maxWidth:'calc(100vw - 58px)', maxHeight:'calc(100vh - 32px)', overflowY:'auto', padding:'9px 12px', border:'1px solid #b8cbea', borderRadius:'9px', background:'#fff', color:'#20324d', boxShadow:'0 8px 24px #244b7533', font:'12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', transition:'width .12s ease' });
        const host = panel;
        host.tabIndex = 0;
        for (const event of ['mouseenter','mouseleave','focusin','focusout']) host.addEventListener(event, () => layoutProgressPanel(host));
        document.documentElement.append(panel);
      }
      return panel;
    };
    const updateProgress = (status: Task['status'], reason: string, pipelineStage?: string) => {
      const panel = progressPanel();
      const label = task?.platform === 'weixin' && /^cover-\d+-baseline$/.test(pipelineStage ?? '') ? '等待视频号生成封面' : stageLabels[pipelineStage ?? ''] ?? (pipelineStage?.startsWith('cover-') ? '处理封面' : '处理中');
      const progressTask = task && {...task, status, reason, pipelineStage};
      const reviewReady = progressTask && isReviewReady(progressTask);
      const blocked = ['needs_attention','paused','aborted','failed'].includes(status) && !reviewReady;
      const stateLabel = reviewReady ? '插件已完成，请人工检查' : status === 'failed' ? '处理失败' : status === 'paused' ? '已暂停' : status === 'aborted' ? '已停止' : blocked ? '处理已停止' : '进行中';
      const color = blocked ? '#b42318' : reviewReady ? '#2c8b61' : '#245fc0';
      panel.style.borderColor = blocked ? '#e6a19b' : '#b8cbea';
      panel.style.background = blocked ? '#fff7f6' : '#fff';
      panel.replaceChildren();
      const title = document.createElement('div'); title.textContent = `${platformLabels[task?.platform ?? ''] ?? '平台'} · 视频上传工作台`; Object.assign(title.style, {fontSize:'10px', fontWeight:'500', lineHeight:'1.2', color:'#8090a8', marginBottom:'3px'});
      const step = document.createElement('div'); step.textContent = blocked ? `${stateLabel}：${label}` : reviewReady ? stateLabel : `当前进度：${label}`; Object.assign(step.style, {fontSize:'13px', fontWeight:'650', lineHeight:'1.3', color});
      const detail = document.createElement('div'); detail.dataset.progressDetail='true'; detail.dataset.progressPersistent=String(blocked); detail.textContent = reason; detail.style.cssText = 'display:none;margin-top:5px;overflow-wrap:anywhere';
      if (blocked) detail.setAttribute('role','alert');
      const state = document.createElement('div'); state.dataset.progressDetail='true'; state.textContent = stateLabel; state.style.marginTop = '6px'; state.style.color = color; state.style.display='none';
      panel.append(title, step, detail, state);
      if (progressTask) {
        const {steps} = taskProgress(progressTask);
        const list = document.createElement('div'); list.dataset.progressList='true'; Object.assign(list.style, {display:'none', marginTop:'10px', borderTop:'1px solid #e2e8f2', paddingTop:'7px'});
        for (const item of steps) {
          const row = document.createElement('div');
          const done = item.state === 'done', active = item.state === 'active';
          row.textContent = `${done ? '✓' : active ? '●' : '○'}  ${item.label}`;
          row.style.cssText = `padding:3px 0;color:${done ? '#2c8b61' : active ? '#245fc0' : '#8090a8'};font-weight:${active ? '650' : '400'}`;
          list.append(row);
        }
        panel.append(list);
      }
      const resumableStage = pipelineStage === 'upload' || pipelineStage === 'copy' || pipelineStage === 'pk' || pipelineStage === 'declaration' || pipelineStage === 'collection' || pipelineStage === 'category' || pipelineStage === 'schedule' || pipelineStage === 'review' || pipelineStage === 'downloads' || pipelineStage?.startsWith('cover-');
      const resumable = resumableStage && ['needs_attention','paused','aborted','failed'].includes(status);
      if (resumable) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '继续同步'; button.dataset.progressDetail='true'; button.dataset.progressPersistent=String(blocked);
        Object.assign(button.style, {marginTop:'9px', padding:'5px 10px', border:'1px solid #2d67c7', borderRadius:'6px', background:'#2d67c7', color:'#fff', cursor:'pointer'});
        button.addEventListener('click', () => { button.disabled = true; button.textContent = '正在继续…'; void chrome.runtime.sendMessage({type:'resume-sync',taskId:task?.taskId}).then((result: {ok?:boolean;error?:string}) => { if (!result?.ok) { button.disabled = false; button.textContent = '继续同步'; detail.textContent = result?.error ?? '继续同步失败'; } }); });
        panel.append(button);
      }
      layoutProgressPanel(panel);
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const clean = () => {
      if (stopped) return;
      stopped = true;
      stopHeartbeat();
      cancellation.abort();
      clearTimeout(deadline);
      clearInterval(inspectTimer);
      observer?.disconnect();
      navigation?.removeEventListener('navigate', navigating);
      window.removeEventListener('popstate', navigating);
      window.removeEventListener('hashchange', navigating);
      iframe?.remove(); iframe = undefined;
      channel?.close(); channel = undefined;
      window.removeEventListener('message', onBridge);
      document.removeEventListener('input', edited, true);
      document.removeEventListener('change', edited, true);
      document.removeEventListener('click', clicked, true);
      window.removeEventListener('pagehide', leaving);
      chrome.runtime.onConnect.removeListener(onConnect);
      scope.__videoUploadM0 = false;
    };
    const report = (status: Task['status'], reason: string, pipelineStage?: string) => {
      if (!task || stopped) return;
      task = { ...task, step: task.step + 1, status, reason, pipelineStage:pipelineStage ?? task.pipelineStage };
      updateProgress(status, reason, task.pipelineStage);
      try { port.postMessage({ type: 'checkpoint', checkpoint: task }); } catch { clean(); }
    };
    const abort = (reason: string) => { report('aborted', reason); clean(); };
    const edited = (event: Event) => { if (event.isTrusted && !ownSynchronousEdit) abort('检测到你在平台页面编辑，已停止操作'); };
    const clicked = (event: Event) => {
      if (event.isTrusted && event.target instanceof Element && event.target.closest('button,a,[role="button"],input[type="submit"]')) abort('检测到你操作平台控件，已交由你接管');
    };
    const leaving = () => { report('paused', '平台页面离开，已停止操作'); clean(); };
    const navigating = (event?: Event) => {
      const destination = (event as Event & { destination?: {url: string; sameDocument: boolean} })?.destination;
      if (task?.platform === 'douyin' && allowUploadTransition && destination && isDouyinUploadTransition(initialUrl,destination.url,destination.sameDocument)) { initialUrl=destination.url;allowUploadTransition=false;return; }
      // Cover dialogs change history state without leaving this editor document.
      if (destination?.sameDocument && destination.url === initialUrl) return;
      if (event?.type === 'popstate' && location.href === initialUrl) return;
      report('paused', '平台页面发生导航，已停止操作'); clean();
    };
    let token = '';
    let origin = '';
    let input: HTMLInputElement | undefined;
    function candidates() {
      if (task?.platform === 'bilibili') {
        const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter(element => {
          const accept = element.accept.toLowerCase();
          return !element.disabled && accept !== '.txt' && /video|\.mp4|\.mov|\.webm/.test(accept) && !element.files?.length;
        });
        return selectBilibiliUploadInput(inputs);
      }
      const roots: ParentNode[] = task?.platform === 'weixin' ? weixinSearchRoots(document) : [document];
      return roots.flatMap(root => [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')]).filter(element => {
        const accept = element.accept.toLowerCase();
        return !element.disabled && /video|\.mp4|\.mov|\.webm/.test(accept) && !element.files?.length;
      });
    }
    function hasExistingContent() {
      const roots: ParentNode[] = task?.platform === 'weixin' ? weixinSearchRoots(document) : [document];
      return roots.flatMap(root => [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea')])
        .some(element => (element instanceof HTMLTextAreaElement || ['text', 'search', 'url'].includes(element.type)) && element.value.trim())
        || roots.flatMap(root => [...root.querySelectorAll('[contenteditable="true"]')]).some(element => element.textContent?.trim())
        || roots.flatMap(root => [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')]).some(element => element.files?.length)
        || roots.flatMap(root => [...root.querySelectorAll('video')]).some(element => element.currentSrc || element.getAttribute('src'));
    }
    async function onBridge(event: MessageEvent) {
      if (stopped || !iframe || event.source !== iframe.contentWindow || event.origin !== new URL(chrome.runtime.getURL('/')).origin || event.data?.token !== token || event.data?.type !== 'bridge-ready' || event.ports.length !== 1 || channel) return;
      expectedClaim = event.data.claimId;
      if (typeof expectedClaim !== 'string') return;
      channel = event.ports[0];
      channel!.onmessage = async event => {
        if (stopped) return;
        if (location.href !== initialUrl) { navigating(); return; }
        if (event.data?.error) { report('needs_attention', '素材交接失败：' + String(event.data.error).slice(0,200)); clean(); return; }
        const asset = event.data;
        if (!task?.videoAlreadyTransferred && task?.platform === 'bilibili') {
          // The upload card is rendered by a micro-app and can replace the
          // input node between inspect() and bridge-ready. Re-resolve the
          // unique current video input immediately before writing the file.
          input = resolveBilibiliTransferInput(candidates(), hasExistingContent());
        }
        if (!(asset?.blob instanceof Blob) || typeof asset.name !== 'string' || (!task?.videoAlreadyTransferred && (!input?.isConnected || input.files?.length || hasExistingContent() || candidates().length !== 1 || (task?.platform !== 'bilibili' && candidates()[0] !== input)))) {
          report('needs_attention', '页面内容或视频入口发生变化，未写入文件'); clean(); return;
        }
        let reason='文件已交给页面控件；尚未核验平台上传完成，请打开页面检查。';
        const complete = (stage: string) => {
          if (task?.platform !== 'bilibili') return;
          task.completedStages = [...new Set([...(task.completedStages ?? []), stage])];
        };
        try {
          if (!task?.videoAlreadyTransferred) {
          const transfer = new DataTransfer();
          transfer.items.add(new File([asset.blob], asset.name, { type: asset.type, lastModified: asset.lastModified }));
          allowUploadTransition = task?.platform === 'douyin';
          input!.files = transfer.files;
          if (task?.platform === 'bilibili') {
            const started = Date.now();
            let result: {ok?:boolean;pending?:boolean;error?:string};
            do {
              if (stopped) return;
              result = await chrome.runtime.sendMessage({type:'bilibili-video-change',taskId:task.taskId,attemptId:task.attemptId});
              if (!result?.pending) break;
              await new Promise(resolve=>setTimeout(resolve,100));
            } while (!stopped && Date.now()-started<15000);
            if (stopped) return;
            if (result?.pending) throw new Error('B 站上传配置尚未就绪，未触发上传');
            if (!result?.ok) throw new Error(result?.error ?? 'B 站上传控件未接受文件');
          } else {
            input!.dispatchEvent(new Event('input', { bubbles: true }));
            if (!stopped) input!.dispatchEvent(new Event('change', { bubbles: true }));
          }
          complete('transfer');
          if (task?.platform === 'bilibili' && !stopped) report('transferring', '文件已交给 B 站上传控件，等待页面确认上传与处理完成', 'upload');
          // Some editors synchronously copy the FileList into
          // their own uploader and clear the native input.  A cleared input
          // therefore does not mean that the platform rejected the video;
          // the platform-specific adapter below is responsible for waiting
          // for the real upload-complete/editor signal.
          }
          if (!stopped && task?.platform === 'weixin') {
            clearTimeout(deadline);
            if (task.coverAssetId && (asset.cover?.id !== task.coverAssetId || asset.cover.batchId !== task.batchId)) throw new Error('封面身份不匹配');
            if ((task.pkCoverAssetIds ?? []).length !== (asset.pkCovers ?? []).length || (task.pkCoverAssetIds ?? []).some((id,index)=>asset.pkCovers[index]?.id !== id || asset.pkCovers[index]?.batchId !== task!.batchId)) throw new Error('PK 封面身份不匹配');
            reason = await fillWeixin(document, normalizePublication(task.publication, false), {
              signal:cancellation.signal, progress:(reason,stage)=>report('transferring', reason, stage),
              edit(action) { ownSynchronousEdit = true; try { action(); } finally { ownSynchronousEdit = false; } },
              activateCover: async (ratio,action,coverAsset) => {
                if (stopped || !task) return false;
                const result=await chrome.runtime.sendMessage({type:'weixin-cover-click',taskId:task.taskId,attemptId:task.attemptId,ratio,action,assetId:coverAsset?.id});
                if(!result?.ok)throw new Error(result?.error??'视频号封面操作失败');
                return true;
              },
              activateOriginal: async () => {
                if (stopped || !task) return false;
                const result=await chrome.runtime.sendMessage({type:'weixin-original-confirm',taskId:task.taskId,attemptId:task.attemptId});
                return !!result?.ok;
              },
            }, asset.cover, asset.pkCovers ?? []);
          } else if (!stopped && task?.platform === 'bilibili') {
            clearTimeout(deadline);
            if (task.coverAssetId && (asset.cover?.id !== task.coverAssetId || asset.cover.batchId !== task.batchId)) throw new Error('封面身份不匹配');
            reason = await fillBilibili(document, normalizePublication(task.publication, false), {
              signal:cancellation.signal, progress:(reason,stage)=>report('transferring', reason, stage),
              complete,
              rejectedTags: tags => { if(task) task.bilibiliRejectedTags=tags; },
              generatedTitle: asset.name.replace(/\.[^.]+$/u, ''),
              cover: task.coverAssetId && !task.completedStages?.includes('cover-0-confirm') ? asset.cover : undefined,
              edit(action) { ownSynchronousEdit = true; try { action(); } finally { ownSynchronousEdit = false; } },
            });
            if (stopped) return;
            report('transferring', '正在核验 B 站编辑页的文案和分区', 'copy');
            const verified = await chrome.runtime.sendMessage({type: 'bilibili-verify-editor', taskId: task.taskId, attemptId: task.attemptId});
            if (!verified?.ok) throw new Error(verified?.error ?? '无法核验 B 站编辑页，请手动检查');
          } else if (!stopped && task && ['xiaohongshu','kuaishou','douyin'].includes(task.platform) && (hasPublication(task.publication) || (task.platform === 'douyin' && task.publication?.collection) || task.coverAssetId || task.coverPk !== undefined)) {
            clearTimeout(deadline);
            if (task.coverAssetId && (asset.cover?.id !== task.coverAssetId || asset.cover?.batchId !== task.batchId)) throw new Error('封面身份不匹配');
            if ((task.pkCoverAssetIds ?? []).length !== (asset.pkCovers ?? []).length || (task.pkCoverAssetIds ?? []).some((id,index)=>asset.pkCovers[index]?.id !== id || asset.pkCovers[index]?.batchId !== task!.batchId)) throw new Error('PK 封面身份不匹配');
            const filler = task.platform === 'douyin' ? fillDouyin : task.platform === 'kuaishou' ? fillKuaishou : fillXiaohongshu;
            reason = await filler(normalizePublication(task.publication, task.platform === 'xiaohongshu'), task.coverAssetId ? asset.cover : undefined, {
              signal:cancellation.signal, progress:(reason,stage)=>report('transferring', reason, stage),
              edit(action) { ownSynchronousEdit = true; try { action(); } finally { ownSynchronousEdit = false; } },
            }, asset.pkCovers ?? [], task.coverPk);
          }
          if(!stopped && task && hasDownloadSettings(task.platform)) {
            clearTimeout(deadline);
            const privacy=await disableDownloads(task.platform,{signal:cancellation.signal,progress:(reason,stage)=>report('transferring',reason,stage),edit(action){ownSynchronousEdit=true;try{action();}finally{ownSynchronousEdit=false;}}});
            if(!stopped)report('needs_attention',reason+' '+privacy.message,privacy.verified?'review':'downloads');
          } else if(!stopped) report('needs_attention',reason,'review');
        } catch (error) { if (!stopped) report('needs_attention', error instanceof Error ? error.message : '平台控件未接受交接，请手动检查'); }
        clean();
      };
      channel!.start();
      port.postMessage({ type: 'approve', token, claimId: expectedClaim });
    }
    port.onMessage.addListener((message: PageCommand | { type: 'approved'; claimId: string }) => {
      if (message.type === 'stop') { clean(); return; }
      if (message.type === 'approved') {
        if (!stopped && message.claimId === expectedClaim) channel?.postMessage({ type: 'approved' });
        return;
      }
      if (task || stopped || message.type !== 'run') return;
      task = message.task;
      if (task.platform === 'bilibili') task.completedStages = [...new Set([...(task.completedStages ?? []), 'page'])];
      token = message.token; origin = message.origin; initialUrl = location.href;
      updateProgress(task.status, task.reason, task.pipelineStage);
      if (location.origin !== origin) { report('needs_attention', '当前页面不属于目标平台'); clean(); return; }
      document.addEventListener('input', edited, true);
      document.addEventListener('change', edited, true);
      document.addEventListener('click', clicked, true);
      window.addEventListener('pagehide', leaving);
      navigation?.addEventListener('navigate', navigating);
      window.addEventListener('popstate', navigating);
      window.addEventListener('hashchange', navigating);
      deadline = setTimeout(() => { report('needs_attention', '文件交接超时，请检查登录、页面入口或浏览器限制'); clean(); }, 45000);
      // Observe actual DOM readiness, never sleep and assume success.
      const inspect = () => {
        if (stopped) return;
        if (!task?.videoAlreadyTransferred && hasExistingContent()) { report('needs_attention', '页面已有内容或素材，为保护原稿已停止'); clean(); return; }
        let inputs = candidates();
        if (!task?.videoAlreadyTransferred && task?.platform === 'weixin' && !inputs.length && !uploadEntryOpened) {
          uploadEntryOpened = openWeixinUploadEntry(document);
          if (uploadEntryOpened) inputs = candidates();
        }
        if (!task?.videoAlreadyTransferred && inputs.length > 1) { report('needs_attention', '发现多个视频入口，无法确认目标，已停止'); clean(); return; }
        if (!task?.videoAlreadyTransferred && !inputs.length) return;
        input = inputs[0];
        observer?.disconnect();
        clearInterval(inspectTimer);
        report('transferring', task?.videoAlreadyTransferred ? '正在接续原平台编辑页；不会重复上传' : '正在交接素材；不代表上传完成', task?.videoAlreadyTransferred ? 'upload' : 'transfer');
        window.addEventListener('message', onBridge);
        iframe = document.createElement('iframe');
        iframe.hidden = true;
        iframe.src = chrome.runtime.getURL(`bridge.html#${token}`);
        document.documentElement.append(iframe);
      };
      observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['accept', 'disabled'] });
      // Shadow-root mutations do not bubble to a document observer. Poll the
      // search roots as well so controls created asynchronously after the
      // upload card is opened are still discovered.
      inspectTimer = setInterval(inspect, 250);
      inspect();
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (!stopped && task) updateProgress('paused', '插件连接已断开，自动操作已停止；请回工作台继续同步', task.pipelineStage);
      clean();
    });
  };
  chrome.runtime.onConnect.addListener(onConnect);
}
