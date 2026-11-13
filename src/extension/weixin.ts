import {publicationBody, type Publication} from '../core/publication';
import {inspectCover, type CoverRatio} from '../core/covers';
import type {Asset} from '../core/model';
import type {FillContext} from './xiaohongshu';

function visible(element: Element) { return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'; }
function textOf(element: HTMLElement) { return (element.innerText || element.textContent || '').replace(/\u200b/g, '').replace(/\r\n/g, '\n').replace(/\n+$/, ''); }
function sameText(actual: string, expected: string) { return actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim(); }

export type WeixinSearchRoot = Document | ShadowRoot;

/** Map the ordered cover selection to Video Channels' fixed 3:4 and 4:3 slots. */
export function selectWeixinCovers<T extends {ratio: CoverRatio}>(covers: T[]): {portrait?: T; landscape?: T} {
  const main = covers[0];
  if (!main) return {};
  const alternate = covers.slice(1).find(cover => cover.ratio !== main.ratio);
  return main.ratio === '3:4'
    ? {portrait: main, landscape: alternate}
    : {landscape: main, portrait: alternate};
}

/** Search the page, same-origin frames, and open shadow roots used by the composer shell. */
export function weixinSearchRoots(documentRoot: Document): WeixinSearchRoot[] {
  const roots: WeixinSearchRoot[] = [];
  const seen = new Set<WeixinSearchRoot>();
  const visit = (root: WeixinSearchRoot) => {
    if (seen.has(root)) return;
    seen.add(root);
    roots.push(root);
    for (const element of root.querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot) visit(element.shadowRoot);
      if (element instanceof HTMLIFrameElement && element.contentDocument) visit(element.contentDocument);
    }
  };
  visit(documentRoot);
  return roots;
}

/** The current composer creates its file input only after the upload card is opened. */
export function openWeixinUploadEntry(documentRoot: Document): boolean {
  const entry = weixinSearchRoots(documentRoot).flatMap(root => [...root.querySelectorAll<HTMLElement>('button,[role="button"],label,div')])
    .filter(visible)
    .filter(element => /支持上传|上传视频/.test(element.textContent?.trim() ?? ''))
    .filter(element => ![...element.children].some(child => /支持上传|上传视频/.test(child.textContent?.trim() ?? '')))
    .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0];
  if (!entry) return false;
  entry.click();
  return true;
}

function leaf(root: ParentNode, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('*')]
    .filter(element => visible(element) && element.textContent?.trim() === text)
    .sort((a, b) => a.children.length - b.children.length)[0];
}

function button(root: ParentNode, text: string): HTMLButtonElement | HTMLElement | undefined {
  const controls = [...root.querySelectorAll<HTMLElement>('button,[role="button"]')].find(element => visible(element) && element.textContent?.trim() === text);
  return controls ?? [...root.querySelectorAll<HTMLElement>('div,span')]
    .filter(element => visible(element) && element.textContent?.trim() === text)
    .sort((a, b) => a.children.length - b.children.length)[0];
}

function coverCard(documentRoot: Document, ratio: CoverRatio): {edit: HTMLElement; image: HTMLImageElement | undefined} | undefined {
  const label = ratio === '3:4' ? '个人主页卡片 3:4' : '分享卡片 4:3';
  for (const root of weixinSearchRoots(documentRoot)) {
    const marker = leaf(root, label);
    if (!marker) continue;
    let ancestor: HTMLElement | null = marker.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
      const edit = button(ancestor, '编辑');
      if (edit) return {edit, image: ancestor.querySelector<HTMLImageElement>('img') ?? undefined};
    }
  }
  return undefined;
}

function coverModal(documentRoot: Document, ratio: CoverRatio): HTMLElement | undefined {
  const title = leaf(documentRoot, `编辑${ratio === '3:4' ? '个人主页卡片' : '分享卡片'}`);
  if (!title) return undefined;
  let ancestor: HTMLElement | null = title.parentElement;
  for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
    if (button(ancestor, '取消') && button(ancestor, '确认')) return ancestor;
  }
  return undefined;
}

async function fillWeixinCover(documentRoot: Document, ratio: CoverRatio, asset: Asset, ctx: FillContext): Promise<void> {
  if (!(asset.blob instanceof Blob) || !asset.type.startsWith('image/')) throw new Error('视频号封面素材不可用');
  const card = await waitForWeixin(() => coverCard(documentRoot, ratio), ctx, `等待视频号 ${ratio} 封面槽位`);
  ctx.progress(`已找到视频号 ${ratio} 封面槽位`, `cover-${ratio}-open`);
  const before = card.image?.currentSrc || card.image?.src || '';
  ctx.edit(() => card.edit.click());
  const modal = await waitForWeixin(() => coverModal(documentRoot, ratio), ctx, `打开视频号 ${ratio} 封面编辑器`);
  ctx.progress(`已打开视频号 ${ratio} 封面编辑器`, `cover-${ratio}-open`);
  const upload = button(modal, '上传封面');
  if (!upload) throw new Error(`未找到视频号 ${ratio} 封面上传入口`);
  ctx.edit(() => upload.click());
  const input = await waitForWeixin(() => weixinSearchRoots(documentRoot)
    .flatMap(root => [...root.querySelectorAll<HTMLInputElement>('input[type="file"]')])
    .find(element => !element.disabled && !element.files?.length && /image|png|jpe?g|webp/i.test(element.accept || 'image/*')), ctx, `等待视频号 ${ratio} 封面上传控件`);
  ctx.progress(`正在上传视频号 ${ratio} 封面`, `cover-${ratio}-upload`);
  const transfer = new DataTransfer();
  transfer.items.add(new File([asset.blob], asset.name, {type: asset.type, lastModified: asset.lastModified}));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', {bubbles: true}));
  input.dispatchEvent(new Event('change', {bubbles: true}));
  const confirm = await waitForWeixin(() => {
    const current = coverModal(documentRoot, ratio);
    if (!current) return;
    const button = [...current.querySelectorAll<HTMLButtonElement>('button')].find(element => visible(element) && element.textContent?.trim() === '确认' && !element.disabled);
    return button;
  }, ctx, `等待视频号 ${ratio} 封面上传完成`, 120000);
  ctx.progress(`已上传视频号 ${ratio} 封面，等待确认`, `cover-${ratio}-confirm`);
  ctx.edit(() => confirm.click());
  await waitForWeixin(() => {
    const current = coverModal(documentRoot, ratio);
    const updated = coverCard(documentRoot, ratio)?.image;
    return !current && (!before || (updated?.currentSrc || updated?.src) !== before);
  }, ctx, `确认视频号 ${ratio} 封面`, 90000);
}

function waitForWeixin<T>(read: () => T | undefined | false, ctx: FillContext, label: string, timeout = 60000): Promise<T> {
  const {signal} = ctx;
  return new Promise<T>((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (signal.aborted) { clearInterval(timer); reject(new Error('操作已停止')); return; }
      try {
        const value = read();
        if (value) { clearInterval(timer); resolve(value); return; }
        if (Date.now() - started >= timeout) { clearInterval(timer); reject(new Error(`${label}等待超过 ${Math.round(timeout / 1000)} 秒，已停止自动操作`)); }
      } catch (error) { clearInterval(timer); reject(error); }
    }, 250);
    signal.addEventListener('abort', () => { clearInterval(timer); reject(new Error('操作已停止')); }, {once: true});
    try {
      const value = read();
      if (value) { clearInterval(timer); resolve(value); }
    } catch (error) { clearInterval(timer); reject(error); }
  });
}

/** Video Channels keeps the composer in a same-origin empty.html iframe. */
export async function fillWeixin(documentRoot: Document, publication: Publication, ctx: FillContext, cover?: Asset, pkCovers: Asset[] = []): Promise<string> {
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
  const find = <T extends Element>(selector: string) => weixinSearchRoots(documentRoot).flatMap(root => [...root.querySelectorAll<T>(selector)]).find(visible);
  const title = await wait<HTMLInputElement>(() => find<HTMLInputElement>('input[placeholder="填写短标题有机会获得更多流量"]'), '等待视频号编辑页');
  progress('已找到视频号短标题输入框', 'copy');
  const description = await wait<HTMLElement>(() => find<HTMLElement>('[contenteditable][data-placeholder="添加描述"]'), '等待视频号描述框');
  progress('已找到视频号描述框', 'copy');
  const uploadReady = await wait(() => weixinSearchRoots(documentRoot).some(root => {
    const completedLabel = [...root.querySelectorAll('*')].some(e => {
      if (e.children.length !== 0) return false;
      const text = e.textContent?.trim();
      return text === '重新上传' || text === '删除';
    });
    const media = [...root.querySelectorAll('video')].some(video => Boolean(video.currentSrc || video.getAttribute('src')));
    return completedLabel || media;
  }), '等待视频号视频处理完成', 600000);
  if (!uploadReady) throw new Error('视频号视频处理未完成');
  progress('视频号视频已处理完成', 'upload');
  const selected = cover ? [{asset: cover, ratio: await inspectCover(cover.blob)}, ...await Promise.all(pkCovers.map(async asset => ({asset, ratio: await inspectCover(asset.blob)})))] : [];
  const slots = selectWeixinCovers(selected);
  const ordered = selected[0]?.ratio === '3:4'
    ? [['3:4', slots.portrait], ['4:3', slots.landscape]] as const
    : [['4:3', slots.landscape], ['3:4', slots.portrait]] as const;
  let coverCount = 0;
  for (const [ratio, selectedCover] of ordered) {
    if (!selectedCover) continue;
    progress(`正在上传视频号 ${ratio} 封面`, `cover-${ratio}`);
    await fillWeixinCover(documentRoot, ratio, selectedCover.asset, ctx);
    coverCount++;
  }
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
  return `视频号短标题和视频描述已回读核验；${coverCount ? `${coverCount} 张封面已按 3:4/4:3 槽位更新，请检查裁剪。` : ''}${publication.tags.length ? '已填写 #标签 文本，请检查平台话题。' : ''}请检查后手动发表；未发表、未保存草稿。`;
}
