import {disableDownloads} from './downloads';
import {isDouyinUploadTransition} from '../core/platform-navigation';
import {fillDouyin} from './douyin';
import type { Task } from '../core/model';
import type { PageCommand } from '../core/protocol';
import { hasPublication, normalizePublication } from '../core/publication';
import { fillXiaohongshu } from './xiaohongshu';
import { fillKuaishou } from './kuaishou';
import { fillWeixin } from './weixin';
import { fillBilibili } from './bilibili';

// Re-injection must never attach a second executor to the same document.
const scope = globalThis as typeof globalThis & { __videoUploadM0?: boolean };
if (!scope.__videoUploadM0) {
  scope.__videoUploadM0 = true;
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'upload-page') return;
    let task: Task | undefined;
    let stopped = false;
    const cancellation = new AbortController();
    let ownSynchronousEdit = false;
    let iframe: HTMLIFrameElement | undefined;
    let channel: MessagePort | undefined;
    let expectedClaim: string | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let initialUrl = '';
    let allowUploadTransition = false;
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const clean = () => {
      stopped = true;
      cancellation.abort();
      clearTimeout(deadline);
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
    };
    const report = (status: Task['status'], reason: string, pipelineStage?: string) => {
      if (!task || stopped) return;
      task = { ...task, step: task.step + 1, status, reason, pipelineStage:pipelineStage ?? task.pipelineStage };
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
        return [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter(element => {
          const accept = element.accept.toLowerCase();
          return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.disabled && accept !== '.txt' && /video|\.mp4|\.mov|\.webm/.test(accept) && !element.files?.length;
        });
      }
      const roots: ParentNode[] = [document];
      if (task?.platform === 'weixin') for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) if (frame.contentDocument) roots.push(frame.contentDocument);
      return roots.flatMap(root => [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')]).filter(element => {
        const accept = element.accept.toLowerCase();
        return !element.disabled && /video|\.mp4|\.mov|\.webm/.test(accept) && !element.files?.length;
      });
    }
    function hasExistingContent() {
      const roots: ParentNode[] = [document];
      if (task?.platform === 'weixin') for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) if (frame.contentDocument) roots.push(frame.contentDocument);
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
        if (!(asset?.blob instanceof Blob) || typeof asset.name !== 'string' || (!task?.videoAlreadyTransferred && (!input?.isConnected || input.files?.length || hasExistingContent() || candidates().length !== 1 || candidates()[0] !== input))) {
          report('needs_attention', '页面内容或视频入口发生变化，未写入文件'); clean(); return;
        }
        // Write the video once; optional metadata uses the scoped adapter below.
        try {
          if (!task?.videoAlreadyTransferred) {
          const transfer = new DataTransfer();
          transfer.items.add(new File([asset.blob], asset.name, { type: asset.type, lastModified: asset.lastModified }));
          allowUploadTransition = task?.platform === 'douyin';
          input!.files = transfer.files;
          input!.dispatchEvent(new Event('input', { bubbles: true }));
          if (!stopped) input!.dispatchEvent(new Event('change', { bubbles: true }));
          }
          let reason='文件已交给页面控件；尚未核验平台上传完成，请打开页面检查。';
          if (!stopped && task?.platform === 'weixin') {
            clearTimeout(deadline);
            const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe')].find(item => item.contentDocument?.querySelector('input[placeholder="填写短标题有机会获得更多流量"]'));
            if (!frame?.contentDocument) throw new Error('未找到视频号编辑器');
            reason = await fillWeixin(frame.contentDocument, normalizePublication(task.publication, false), {
              signal:cancellation.signal, progress:(reason,stage)=>report('transferring', reason, stage),
              edit(action) { ownSynchronousEdit = true; try { action(); } finally { ownSynchronousEdit = false; } },
            });
          } else if (!stopped && task?.platform === 'bilibili' && hasPublication(task.publication)) {
            clearTimeout(deadline);
            reason = await fillBilibili(document, normalizePublication(task.publication, false), {
              signal:cancellation.signal, progress:(reason,stage)=>report('transferring', reason, stage),
              edit(action) { ownSynchronousEdit = true; try { action(); } finally { ownSynchronousEdit = false; } },
            });
          } else if (!stopped && task && ['xiaohongshu','kuaishou','douyin'].includes(task.platform) && (hasPublication(task.publication) || task.coverAssetId || task.coverPk !== undefined)) {
            clearTimeout(deadline);
            if (task.coverAssetId && (asset.cover?.id !== task.coverAssetId || asset.cover?.batchId !== task.batchId)) throw new Error('封面身份不匹配');
            if ((task.pkCoverAssetIds ?? []).length !== (asset.pkCovers ?? []).length || (task.pkCoverAssetIds ?? []).some((id,index)=>asset.pkCovers[index]?.id !== id || asset.pkCovers[index]?.batchId !== task!.batchId)) throw new Error('PK 封面身份不匹配');
            const filler = task.platform === 'douyin' ? fillDouyin : task.platform === 'kuaishou' ? fillKuaishou : fillXiaohongshu;
            reason = await filler(normalizePublication(task.publication, task.platform === 'xiaohongshu'), task.coverAssetId ? asset.cover : undefined, {
              signal:cancellation.signal, progress:(reason,stage)=>report('transferring', reason, stage),
              edit(action) { ownSynchronousEdit = true; try { action(); } finally { ownSynchronousEdit = false; } },
            }, asset.pkCovers ?? [], task.coverPk);
          }
          if(!stopped && task && ['xiaohongshu','kuaishou','douyin'].includes(task.platform)) {
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
      task = message.task; token = message.token; origin = message.origin; initialUrl = location.href;
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
        const inputs = candidates();
        if (!task?.videoAlreadyTransferred && inputs.length > 1) { report('needs_attention', '发现多个视频入口，无法确认目标，已停止'); clean(); return; }
        if (!task?.videoAlreadyTransferred && !inputs.length) return;
        input = inputs[0];
        observer?.disconnect();
        report('transferring', task?.videoAlreadyTransferred ? '正在接续抖音编辑页；不会重复上传' : '正在交接素材；不代表上传完成', task?.videoAlreadyTransferred ? 'upload' : 'transfer');
        window.addEventListener('message', onBridge);
        iframe = document.createElement('iframe');
        iframe.hidden = true;
        iframe.src = chrome.runtime.getURL(`bridge.html#${token}`);
        document.documentElement.append(iframe);
      };
      observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['accept', 'disabled'] });
      inspect();
    });
    port.onDisconnect.addListener(clean);
  });
}
