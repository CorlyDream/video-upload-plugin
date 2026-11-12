import {publicationBody, type Publication} from '../core/publication';
import type {FillContext} from './xiaohongshu';

function visible(element: Element) { return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'; }
function textOf(element: HTMLElement) { return (element.innerText || element.textContent || '').replace(/\u200b/g, '').replace(/\r\n/g, '\n').replace(/\n+$/, ''); }
function sameText(actual: string, expected: string) { return actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim(); }

/** Video Channels keeps the composer in a same-origin empty.html iframe. */
export async function fillWeixin(documentRoot: Document, publication: Publication, ctx: FillContext): Promise<string> {
  const {signal, progress} = ctx;
  const wait = <T>(read: () => T | undefined | false, label: string, timeout = 60000) => new Promise<T>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (signal.aborted) { clearInterval(timer); reject(new Error('操作已停止')); return; }
      try {
        const value = read();
        if (value) { clearInterval(timer); signal.removeEventListener('abort', abort); resolve(value); return; }
        if (Date.now() - started >= timeout) { clearInterval(timer); signal.removeEventListener('abort', abort); reject(new Error(`${label}等待超过 ${Math.round(timeout / 1000)} 秒，已停止自动操作`)); }
      } catch (error) { clearInterval(timer); signal.removeEventListener('abort', abort); reject(error); }
    };
    const abort = () => { clearInterval(timer); reject(new Error('操作已停止')); };
    const timer = setInterval(tick, 250);
    signal.addEventListener('abort', abort, {once: true});
    tick();
  });
  const title = await wait<HTMLInputElement>(() => documentRoot.querySelector<HTMLInputElement>('input[placeholder="填写短标题有机会获得更多流量"]') ?? undefined, '等待视频号编辑页');
  progress('已找到视频号短标题输入框', 'copy');
  const description = await wait<HTMLElement>(() => documentRoot.querySelector<HTMLElement>('[contenteditable][data-placeholder="添加描述"]') ?? undefined, '等待视频号描述框');
  progress('已找到视频号描述框', 'copy');
  const uploadReady = await wait(() => [...documentRoot.querySelectorAll('*')].some(e => e.children.length === 0 && e.textContent?.trim() === '重新上传'), '等待视频号视频处理完成', 600000);
  if (!uploadReady) throw new Error('视频号视频处理未完成');
  progress('视频号视频已处理完成', 'upload');
  if (title.value.trim() || textOf(description).trim()) throw new Error('视频号编辑页已有文案，未覆盖，请手动检查');
  progress('填写并核验视频号短标题、视频描述', 'copy');
  const setter = Object.getOwnPropertyDescriptor(title.constructor.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置视频号短标题');
  ctx.edit(() => {
    setter.call(title, publication.title.slice(0, 16));
    title.dispatchEvent(new Event('input', {bubbles: true}));
    title.dispatchEvent(new Event('change', {bubbles: true}));
    description.focus();
    description.textContent = publicationBody(publication);
    description.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: publicationBody(publication)}));
  });
  await wait(() => title.value === publication.title.slice(0, 16) && sameText(textOf(description), publicationBody(publication)), '核验视频号文案', 30000);
  return `视频号短标题和视频描述已回读核验；${publication.tags.length ? '已填写 #标签 文本，请检查平台话题。' : ''}请检查后手动发表；未发表、未保存草稿。`;
}
