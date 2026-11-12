import {publicationBody, type Publication} from '../core/publication';
import type {FillContext} from './xiaohongshu';

const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
const textOf = (element: HTMLTextAreaElement | HTMLElement) => ('value' in element ? element.value : element.innerText || element.textContent || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
const sameText = (actual: string, expected: string) => actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim();

export async function fillBilibili(documentRoot: Document, publication: Publication, ctx: FillContext): Promise<string> {
  const {signal, progress} = ctx;
  const wait = <T>(read: () => T | undefined | false, label: string, timeout = 600000) => new Promise<T>((resolve, reject) => {
    const started = Date.now();
    const abort = () => { clearInterval(timer); reject(new Error('操作已停止')); };
    const tick = () => {
      if (signal.aborted) return abort();
      try {
        const value = read();
        if (value) { clearInterval(timer); signal.removeEventListener('abort', abort); resolve(value); return; }
        if (Date.now() - started >= timeout) { clearInterval(timer); signal.removeEventListener('abort', abort); reject(new Error(`${label}等待超过 ${Math.round(timeout / 1000)} 秒，已停止自动操作`)); }
      } catch (error) { clearInterval(timer); signal.removeEventListener('abort', abort); reject(error); }
    };
    const timer = setInterval(tick, 250);
    signal.addEventListener('abort', abort, {once:true});
    tick();
  });
  const fields = await wait(() => {
    const title = [...documentRoot.querySelectorAll<HTMLInputElement>('input[placeholder*="稿件标题"], input[placeholder*="标题"], input[aria-label="标题"]')].find(visible);
    const description = [...documentRoot.querySelectorAll<HTMLTextAreaElement>('textarea[placeholder*="简介"], textarea[aria-label="简介"], [contenteditable="true"][data-placeholder*="简介"], [contenteditable="true"][data-placeholder*="描述"], [contenteditable="true"]')].find(visible) as HTMLTextAreaElement | HTMLElement | undefined;
    return title && description ? {title, description} : undefined;
  }, '等待 B 站编辑页');
  progress('已找到 B 站标题和简介输入框', 'copy');
  if (textOf(fields.title as never).trim() || textOf(fields.description).trim()) throw new Error('B 站编辑页已有文案，未覆盖，请手动检查');
  const body = publicationBody(publication);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter || (fields.description instanceof HTMLTextAreaElement && !textSetter)) throw new Error('无法设置 B 站编辑文案');
  ctx.edit(() => {
    setter.call(fields.title, publication.title);
    fields.title.dispatchEvent(new Event('input', {bubbles:true}));
    fields.title.dispatchEvent(new Event('change', {bubbles:true}));
    if (fields.description instanceof HTMLTextAreaElement) {
      textSetter!.call(fields.description, body);
      fields.description.dispatchEvent(new Event('input', {bubbles:true}));
      fields.description.dispatchEvent(new Event('change', {bubbles:true}));
    } else {
      fields.description.focus();
      fields.description.textContent = body;
      fields.description.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:body}));
    }
  });
  await wait(() => fields.title.value === publication.title && sameText(textOf(fields.description), body), '核验 B 站标题和简介', 30000);
  return `B站标题和简介已回读核验；${publication.tags.length ? '已填写 #标签 文本，请检查平台话题。' : ''}请检查后手动投稿；未投稿、未保存草稿。`;
}
