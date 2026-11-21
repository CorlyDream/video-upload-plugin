import {publicationBody, type Publication} from '../core/publication';
import {inspectCover, type CoverRatio} from '../core/covers';
import type {Asset} from '../core/model';
import type {FillContext} from './xiaohongshu';
import {checkedState, ensureChecked, findDeclarationControl, findDeclarationText} from './declarations';

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
    .filter(element => visible(element) && element.textContent?.replace(/\s+/g, '') === text.replace(/\s+/g, ''))
    .sort((a, b) => a.children.length - b.children.length)[0];
}

function button(root: ParentNode, text: string): HTMLButtonElement | HTMLElement | undefined {
  const controls = [...root.querySelectorAll<HTMLElement>('button,[role="button"]')].find(element => visible(element) && element.textContent?.trim() === text);
  return controls ?? [...root.querySelectorAll<HTMLElement>('div,span')]
    .filter(element => visible(element) && element.textContent?.trim() === text)
    .sort((a, b) => a.children.length - b.children.length)[0];
}

/** Find the confirmation control shown after enabling the original declaration. */
function originalDialog(documentRoot: Document): HTMLElement | undefined {
  const selectors = '.weui-desktop-dialog,[role="dialog"],[role="alertdialog"],.weui-dialog,[class*="modal"]';
  for (const root of weixinSearchRoots(documentRoot)) {
    for (const dialog of [...root.querySelectorAll<HTMLElement>(selectors)].filter(element => visible(element) && !element.classList.contains('weui-desktop-dialog__wrp'))) {
      if (!/原创/.test(dialog.textContent ?? '')) continue;
      return dialog;
    }
  }
  return undefined;
}

function originalConsent(dialog: HTMLElement): HTMLElement | undefined {
  return [...dialog.querySelectorAll<HTMLElement>('input[type="checkbox"],[role="checkbox"]')]
    .find(element => visible(element) && !(element as HTMLInputElement).checked && element.getAttribute('aria-checked') !== 'true');
}

function originalSubmit(dialog: HTMLElement): HTMLElement | undefined {
  const enabled = (element: HTMLElement) => visible(element) && !(element as HTMLButtonElement).disabled && element.getAttribute('aria-disabled') !== 'true' && !element.classList.contains('weui-desktop-btn_disabled') && !element.classList.contains('is-disabled') && /^(声明原创|确认|确定|继续|我知道了|同意并继续)$/.test(element.textContent?.trim() ?? '');
  const controls = [...dialog.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(enabled);
  return controls[0] ?? [...dialog.querySelectorAll<HTMLElement>('div,span')].filter(enabled).sort((a, b) => a.children.length - b.children.length)[0];
}
function clickWeixinElement(element: HTMLElement): void {
  element.focus();
  element.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: element.ownerDocument.defaultView}));
  element.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: element.ownerDocument.defaultView}));
  element.click();
}

function coverCard(documentRoot: Document, ratio: CoverRatio): {edit: HTMLElement; image: HTMLImageElement | undefined} | undefined {
  const label = ratio === '3:4' ? '个人主页卡片 3:4' : '分享卡片 4:3';
  for (const root of weixinSearchRoots(documentRoot)) {
    const marker = leaf(root, label);
    if (!marker) continue;
    let ancestor: HTMLElement | null = marker.parentElement;
    for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
      const edit = button(ancestor, '编辑');
      if (edit) {
        // Edit remains visible while Channels is still generating video frames,
        // but its handler ignores clicks until this blocking mask disappears.
        if ([...ancestor.querySelectorAll('.vertical-mask-layer,.horizon-mask-layer')].some(visible)) return undefined;
        const image = ancestor.querySelector<HTMLImageElement>('img');
        if (!image?.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0 || (edit as HTMLButtonElement).disabled || edit.getAttribute('aria-disabled') === 'true') return undefined;
        return {edit, image};
      }
    }
  }
  return undefined;
}

function coverModal(documentRoot: Document, ratio: CoverRatio): HTMLElement | undefined {
  const title = weixinSearchRoots(documentRoot).map(root => leaf(root, `编辑${ratio === '3:4' ? '个人主页卡片' : '分享卡片'}`)).find(Boolean);
  if (!title) return undefined;
  let ancestor: HTMLElement | null = title.parentElement;
  for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
    if (button(ancestor, '取消') && button(ancestor, '确认')) return ancestor;
  }
  return undefined;
}

export type WeixinCoverAction = 'open' | 'direct' | 'upload' | 'confirm';
interface WeixinFillContext extends FillContext {
  watchEditor?: (document: Document) => void;
  activateCover?: (ratio: CoverRatio, action: WeixinCoverAction, asset?: Asset) => Promise<boolean> | boolean;
  activateOriginal?: () => Promise<boolean> | boolean;
}

function weixinDescription(value: Publication): string {
  const body = publicationBody(value);
  return [value.title, body].filter(Boolean).join('\n');
}

function setWeixinDescription(element: HTMLElement, value: string): void {
  element.focus();
  const doc = element.ownerDocument;
  const selection = doc.getSelection();
  selection?.selectAllChildren(element);
  const inserted = doc.execCommand?.('insertText', false, value) ?? false;
  if (!inserted || textOf(element).trim() !== value.trim()) {
    element.replaceChildren(doc.createTextNode(value));
    element.dispatchEvent(new InputEvent('beforeinput', {bubbles: true, inputType: 'insertText', data: value}));
    element.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: value}));
  }
  element.dispatchEvent(new Event('change', {bubbles: true}));
  element.blur();
}
export function clickWeixinOriginalConfirm(root: Document | ShadowRoot = document): boolean {
  const visibleNow = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  if (root instanceof Document) {
    const frame = root.querySelector<HTMLIFrameElement>('iframe[src="https://channels.weixin.qq.com/empty.html"]');
    if (frame?.contentDocument) return clickWeixinOriginalConfirm(frame.contentDocument);
  }
  for (const searchRoot of root instanceof Document ? weixinSearchRoots(root) : [root]) {
    const dialog = [...searchRoot.querySelectorAll<HTMLElement>('.weui-desktop-dialog')].find(e => visibleNow(e) && e.textContent?.includes('原创权益'));
    const button = dialog && [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(e => visibleNow(e) && e.textContent?.trim() === '声明原创' && !e.classList.contains('weui-desktop-btn_disabled'));
    if (button) { button.click(); return true; }
  }
  return false;
}
/** Runs in the editor iframe's MAIN world; only these four cover actions are allowed. */
export function clickWeixinCoverControl(ratio: CoverRatio, action: WeixinCoverAction, file?: {base64:string;name:string;type:string;lastModified:number} | null, root: Document | ShadowRoot = document): boolean {
  if (!['3:4','4:3'].includes(ratio) || !['open','direct','upload','confirm'].includes(action)) return false;
  const editor = root.querySelector<HTMLIFrameElement>('iframe[src="https://channels.weixin.qq.com/empty.html"]')?.contentDocument;
  if (editor) root = editor;
  const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  let target: HTMLElement | undefined;
  if (action === 'open') {
    const card = [...root.querySelectorAll<HTMLElement>(ratio === '3:4' ? '.vertical-cover-wrap' : '.horizon-cover-wrap')].find(visible);
    if (card && [...card.querySelectorAll('.vertical-mask-layer,.horizon-mask-layer')].some(visible)) return false;
    target = card?.querySelector<HTMLElement>('.edit-btn') ?? card;
  } else if (action === 'direct') {
    const recommendations = [...root.querySelectorAll<HTMLElement>('.img-recommend-wrap')].filter(visible);
    if (recommendations.length !== 1) return false;
    target = [...recommendations[0]!.querySelectorAll<HTMLElement>('button,[role="button"]')].find(e=>visible(e)&&e.textContent?.trim()==='直接编辑');
  } else {
    const title = `编辑${ratio === '3:4' ? '个人主页卡片' : '分享卡片'}`;
    const heading = [...root.querySelectorAll<HTMLElement>('h3')].find(e=>visible(e)&&e.textContent?.trim()===title);
    const modal = heading?.closest('.weui-desktop-dialog,.cover-modal');
    if (action === 'upload') {
      const input = modal?.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input || !file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return false;
      const realm = (input.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
      const bytes = Uint8Array.from(atob(file.base64), char=>char.charCodeAt(0));
      const transfer = new realm.DataTransfer();
      transfer.items.add(new realm.File([bytes],file.name,{type:file.type,lastModified:file.lastModified}));
      input.files=transfer.files;
      input.dispatchEvent(new realm.Event('input',{bubbles:true}));
      input.dispatchEvent(new realm.Event('change',{bubbles:true}));
      return true;
    }
    target = modal ? [...modal.querySelectorAll<HTMLElement>('button,[role="button"],div,span')].filter(e=>visible(e)&&e.textContent?.trim()==='确认').sort((a,b)=>a.children.length-b.children.length)[0] : undefined;
  }
  if (!target || (target as HTMLButtonElement).disabled) return false;
  target.click();return true;
}
async function activate(ctx: WeixinFillContext, ratio: CoverRatio, action: WeixinCoverAction, target: HTMLElement, asset?: Asset) {
  if (ctx.signal.aborted) throw new Error('操作已停止');
  if (ctx.activateCover) { if (!await ctx.activateCover(ratio,action,asset)) throw new Error('视频号封面控件未就绪'); }
  else ctx.edit(()=>target.click());
}

async function fillWeixinCover(documentRoot: Document, ratio: CoverRatio, asset: Asset, ctx: WeixinFillContext, index: number): Promise<void> {
  if (!(asset.blob instanceof Blob) || !asset.type.startsWith('image/')) throw new Error('视频号封面素材不可用');
  // Upload completion exposes “删除” before Channels finishes parsing frames.
  // Keep this separate from the short editor-open timeout: the visible edit
  // button can still be blocked by a mask or have no generated preview yet.
  ctx.progress(`等待视频号解析并生成 ${ratio} 默认封面；预览加载完成且编辑遮罩解除后继续（最多等待 10 分钟）`, `cover-${index}-baseline`);
  const card = await waitForWeixin(() => coverCard(documentRoot, ratio), ctx, `等待视频号解析并生成 ${ratio} 默认封面及解除编辑遮罩`, 600000);
  ctx.progress(`视频号 ${ratio} 默认封面已就绪，正在打开编辑器`, `cover-${index}-open`);
  const before = card.image?.currentSrc || card.image?.src || '';
  await activate(ctx,ratio,'open',card.edit);
  let directPending=false, directError: unknown;
  const modal = await waitForWeixin(() => {
    if (directError) throw directError;
    const current = coverModal(documentRoot, ratio);
    if (current) return current;
    // After editing one ratio, Channels recommends reusing it for the other.
    // Choose direct editing so each slot receives its own selected-ratio asset.
    const recommendations = [...new Set(weixinSearchRoots(documentRoot).flatMap(root => [...root.querySelectorAll<HTMLElement>('.img-recommend-wrap')]))].filter(visible);
    if (recommendations.length === 1) {
      const direct = button(recommendations[0]!, '直接编辑');
      if (direct && !directPending) {
        directPending=true;
        void activate(ctx,ratio,'direct',direct).catch(error=>{directError=error;}).finally(()=>{directPending=false;});
      }
    }
  }, ctx, `打开视频号 ${ratio} 封面编辑器`);
  ctx.progress(`已打开视频号 ${ratio} 封面编辑器`, `cover-${index}-open`);
  const upload = button(modal, '上传封面');
  if (!upload) throw new Error(`未找到视频号 ${ratio} 封面上传入口`);
  const preview = upload.closest('.single-cover-uploader-wrap') ?? modal;
  const previousImages = new Map([...preview.querySelectorAll('img')].map(image => [image, image.currentSrc || image.src]));
  ctx.progress(`正在上传视频号 ${ratio} 封面`, `cover-${index}-upload`);
  if (ctx.activateCover) await activate(ctx,ratio,'upload',upload,asset);
  else {
    ctx.edit(()=>upload.click());
    const input = await waitForWeixin(() => [...modal.querySelectorAll<HTMLInputElement>('input[type="file"]')]
      .find(element => !element.disabled && !element.files?.length && /image|png|jpe?g|webp/i.test(element.accept || 'image/*')), ctx, `等待视频号 ${ratio} 封面上传控件`);
    const realm = (input.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    const transfer = new realm.DataTransfer();
    transfer.items.add(new realm.File([asset.blob], asset.name, {type: asset.type, lastModified: asset.lastModified}));
    input.files = transfer.files;
    input.dispatchEvent(new realm.Event('input', {bubbles: true}));
    input.dispatchEvent(new realm.Event('change', {bubbles: true}));
  }
  await waitForWeixin(() => {
    const image = [...preview.querySelectorAll('img')].find(image => image.complete && image.naturalWidth > 0 && previousImages.get(image) !== (image.currentSrc || image.src));
    if (!image) return false;
    const canvas = [...modal.querySelectorAll<HTMLCanvasElement>('.crop-area canvas')].find(visible);
    // Channels downsizes portrait sources (for example 1086x1448 -> 810x1080).
    return !canvas || (canvas.width > 0 && canvas.height > 0 && canvas.width * image.naturalHeight === canvas.height * image.naturalWidth && canvas.style.opacity !== '0');
  }, ctx, `等待视频号 ${ratio} 封面预览加载`, 120000);
  const confirm = await waitForWeixin(() => {
    const current = coverModal(documentRoot, ratio);
    if (!current) return;
    const button = [...current.querySelectorAll<HTMLButtonElement>('button')].find(element => visible(element) && element.textContent?.trim() === '确认' && !element.disabled);
    return button;
  }, ctx, `等待视频号 ${ratio} 封面上传完成`, 120000);
  ctx.progress(`已上传视频号 ${ratio} 封面，等待确认`, `cover-${index}-confirm`);
  await activate(ctx,ratio,'confirm',confirm);
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

function weixinScheduleInput(documentRoot: Document): HTMLInputElement | undefined {
  return weixinSearchRoots(documentRoot).flatMap(root => [...root.querySelectorAll<HTMLInputElement>('input[placeholder="请选择发表时间"]')]).find(visible);
}
async function setWeixinCollection(documentRoot: Document, name: string, ctx: FillContext): Promise<string> {
  const display = await waitForWeixin(() => weixinSearchRoots(documentRoot)
    .flatMap(root => [...root.querySelectorAll<HTMLElement>('.post-album-display,.post-album-display-wrap')])
    .find(element => visible(element) && (element.textContent?.includes('选择合集') || element.textContent?.trim() === name)), ctx, '等待视频号合集控件', 10000);
  if (display.textContent?.trim() === name) return `已回读视频号合集 ${name}；`;
  ctx.progress('正在选择视频号合集', 'collection');
  ctx.edit(() => display.click());
  const option = await waitForWeixin(() => {
    const matches = [...new Set(weixinSearchRoots(documentRoot).flatMap(root => [...root.querySelectorAll<HTMLElement>('.post-album-wrap .option-item,.post-album-wrap .item,.post-album-wrap .name,.post-album-wrap [role="option"]')]))]
      .filter(element => visible(element) && element.textContent?.trim() === name);
    return matches.length === 1 ? matches[0] : undefined;
  }, ctx, `等待视频号合集 ${name}`, 10000);
  ctx.edit(() => option.click());
  await waitForWeixin(() => weixinSearchRoots(documentRoot)
    .flatMap(root => [...root.querySelectorAll<HTMLElement>('.post-album-display .display-text,.post-album-display .collection-text,.post-album-display-wrap .display-text,.post-album-display-wrap .collection-text,.post-album-display')])
    .find(element => visible(element) && element.textContent?.trim() === name), ctx, '核验视频号合集', 10000);
  return `已选择并回读视频号合集 ${name}；`;
}
async function setWeixinSchedule(documentRoot: Document, scheduleAt: string, ctx: FillContext): Promise<string> {
  const [date,time]=scheduleAt.split('T');
  if(!date||!time)throw new Error('定时发布时间格式无效，请重新选择时间');
  const roots=weixinSearchRoots(documentRoot);
  const scheduled=roots.flatMap(root=>[...root.querySelectorAll<HTMLInputElement>('input[type="radio"][value="1"]')]).find(input=>visible(input)&&/定时/.test(input.parentElement?.parentElement?.textContent??''));
  if(!scheduled)return '视频号编辑页没有定时控件，已跳过定时设置；';
  ctx.progress('正在设置视频号定时发布时间','schedule');
  const wasEnabled=scheduled.checked;
  if(!wasEnabled){ctx.edit(()=>scheduled.click());await waitForWeixin(()=>scheduled.checked,ctx,'核验视频号定时发布开关',10000);}
  const input=await waitForWeixin(()=>weixinScheduleInput(documentRoot),ctx,'等待视频号定时日期和时间控件',10000);
  const display=`${date} ${time}`;
  if(wasEnabled && input.value && input.value!==display && input.value!==scheduleAt)throw new Error('视频号编辑页已有不同的定时发布时间，未覆盖，请手动检查');
  const inputPrototype=input.ownerDocument.defaultView?.HTMLInputElement.prototype ?? HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(inputPrototype,'value')?.set;
  if(!setter)throw new Error('无法设置视频号定时发布时间');
  ctx.edit(()=>{setter.call(input,display);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  await waitForWeixin(()=>input.value===display||input.value===scheduleAt,ctx,'核验视频号定时发布时间',10000);
  return `已设置并回读视频号定时发布时间 ${display}；请检查后手动发表。`;
}

/** Video Channels keeps the composer in a same-origin empty.html iframe. */
export async function fillWeixin(documentRoot: Document, publication: Publication, ctx: WeixinFillContext, cover?: Asset, pkCovers: Asset[] = []): Promise<string> {
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
  progress('等待视频号视频上传完成；随后等待平台解析和生成默认封面', 'upload');
  const uploadReady = await wait(() => weixinSearchRoots(documentRoot).some(root => {
    const completedLabel = [...root.querySelectorAll('*')].some(e => {
      if (e.children.length !== 0 || !visible(e)) return false;
      const text = e.textContent?.trim();
      return text === '重新上传' || text === '删除';
    });
    return completedLabel;
  }), '等待视频号视频处理完成', 600000);
  if (!uploadReady) throw new Error('视频号视频处理未完成');
  progress('视频号视频已上传；封面操作前仍需等待平台解析并生成默认封面', 'upload');
  const title = await wait<HTMLInputElement>(() => find<HTMLInputElement>('input[placeholder="填写短标题有机会获得更多流量"]'), '等待视频号编辑页');
  ctx.watchEditor?.(title.ownerDocument);
  progress('已找到视频号短标题输入框', 'copy');
  const description = await wait<HTMLElement>(() => find<HTMLElement>('[contenteditable][data-placeholder="添加描述"]'), '等待视频号描述框');
  ctx.watchEditor?.(description.ownerDocument);
  progress('已找到视频号描述框', 'copy');
  const roots=weixinSearchRoots(documentRoot);
  let declarationNote='';
  const declarationEntry=roots.map(root=>findDeclarationText(root,['选择视频标注','选择内容标注','添加内容声明','作品声明'])).find(Boolean);
  if(declarationEntry){
    progress('正在设置视频号 AI 生成标记','declaration');
    try{
      ctx.edit(()=>declarationEntry.click());
      const option=await wait(()=>roots.map(root=>findDeclarationText(root,['含AI生成内容','含 AI 生成内容','内容由AI生成','内容由 AI 生成'])).find(Boolean),'等待视频号 AI 生成标记',10000);
      if(option)ctx.edit(()=>option.click());
      if(option)declarationNote+='已选择 AI 生成标记；';
    }catch{declarationNote+='AI 生成标记未确认，请手动检查；';}
  }
  for(const root of roots){
    const originalControl=findDeclarationControl(root,['声明原创','原创视频']);
    if(!originalControl)continue;
    const alreadyChecked=checkedState(originalControl)===true;
    let checked=false;
    ctx.edit(()=>{checked=ensureChecked(originalControl);});
    if(checked){
      const dialog=alreadyChecked?originalDialog(documentRoot):await wait(()=>originalDialog(documentRoot),'等待视频号原创声明确认',10000);
      if(dialog){
        const consent=originalConsent(dialog);
        if(consent)ctx.edit(()=>consent.click());
        const confirm=await wait(()=>originalSubmit(dialog),'等待视频号原创声明按钮启用',10000);
        if(ctx.activateOriginal) { if(!await ctx.activateOriginal()) throw new Error('视频号原创确认按钮未就绪'); }
        else ctx.edit(()=>clickWeixinElement(confirm));
        await wait(()=>!originalDialog(documentRoot),'核验视频号原创声明确认',10000);
      }
      declarationNote+='已勾选原创声明；';
    }
    break;
  }
  let collectionNote='';
  if(publication.collection) collectionNote=await setWeixinCollection(documentRoot,publication.collection,ctx);
  let scheduleNote='';
  if(publication.scheduleAt) scheduleNote=await setWeixinSchedule(documentRoot,publication.scheduleAt,ctx);
  const selected = cover ? [{asset: cover, ratio: await inspectCover(cover.blob)}, ...await Promise.all(pkCovers.map(async asset => ({asset, ratio: await inspectCover(asset.blob)})))] : [];
  const slots = selectWeixinCovers(selected);
  const ordered = selected[0]?.ratio === '3:4'
    ? [['3:4', slots.portrait], ['4:3', slots.landscape]] as const
    : [['4:3', slots.landscape], ['3:4', slots.portrait]] as const;
  let coverCount = 0;
  for (const [ratio, selectedCover] of ordered) {
    if (!selectedCover) continue;
    await fillWeixinCover(documentRoot, ratio, selectedCover.asset, ctx, coverCount);
    coverCount++;
  }
  const finalDescription = weixinDescription(publication);
  const expectedTitle = publication.title.slice(0, 16);
  const existingTitle = title.value.trim(), existingDescription = textOf(description).trim();
  const copyAlreadyMatches = existingTitle === expectedTitle && sameText(existingDescription, finalDescription);
  if ((existingTitle || existingDescription) && !copyAlreadyMatches) throw new Error('视频号编辑页已有不同文案，未覆盖，请手动检查');
  if (!copyAlreadyMatches) {
    progress('填写并核验视频号短标题、视频描述', 'copy');
    const setter = Object.getOwnPropertyDescriptor(title.constructor.prototype, 'value')?.set;
    if (!setter) throw new Error('无法设置视频号短标题');
    ctx.edit(() => {
      setter.call(title, expectedTitle);
      title.dispatchEvent(new Event('input', {bubbles: true}));
      title.dispatchEvent(new Event('change', {bubbles: true}));
      setWeixinDescription(description, finalDescription);
    });
  } else progress('视频号文案已存在且回读一致，继续后续步骤', 'copy');
  await wait(() => title.value === publication.title.slice(0, 16) && sameText(textOf(description), finalDescription), '核验视频号文案', 30000);
  return `视频号短标题和视频描述已回读核验；${declarationNote}${collectionNote}${scheduleNote}${coverCount ? `${coverCount} 张封面已按 3:4/4:3 槽位更新，请检查裁剪。` : ''}${publication.tags.length ? '已填写 #标签 文本，请检查平台话题。' : ''}请检查后手动发表；未发表、未保存草稿。`;
}
