import type {Publication} from '../core/publication';
import type {Asset, BilibiliRejectedTag} from '../core/model';
import type {FillContext} from './xiaohongshu';
import {declarationVisible, ensureChecked, findDeclarationControl, findDeclarationText} from './declarations';

const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
const textOf = (element: HTMLTextAreaElement | HTMLElement) => ('value' in element ? element.value : element.innerText || element.textContent || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
const sameText = (actual: string, expected: string) => actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim();
type BilibiliWait = <T>(read:()=>T|undefined|false,label:string,timeout?:number)=>Promise<T>;
type BilibiliContext = FillContext & {
  complete?: (stage: string) => void;
  rejectedTags?: (tags: BilibiliRejectedTag[]) => void;
  checkTag?: (tag: string) => Promise<{accepted: boolean; reason?: string}>;
};

/** Same read-only checks used by the official TagInput before creating a tag. */
export async function checkBilibiliTag(tag: string, signal?: AbortSignal): Promise<{accepted: boolean; reason?: string}> {
  if (location.origin !== 'https://member.bilibili.com') throw new Error('当前不是 B 站页面，无法校验标签');
  const checks = await Promise.all([
    ['/x/app/h5/archive/tag/info', 'tag_name', 'msg'],
    ['/x/vupre/web/topic/tag/check', 'tag', 'content'],
  ].map(async ([path, key, reasonKey]) => {
    const response = await fetch(`${path}?${key}=${encodeURIComponent(tag)}`, {
      credentials:'include', signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
    const body = await response.json();
    if (!response.ok || body.code !== 0 || !body.data || !/^-?\d+$/u.test(String(body.data.code))) throw new Error(`B 站标签“${tag}”校验失败，未跳过，请稍后继续`);
    if (Number(body.data.code) === 0) return {accepted:true};
    const reason = body.data[reasonKey!] ?? body.data.msg ?? body.data.content;
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`B 站标签“${tag}”校验结果不明，未跳过`);
    return {accepted:false, reason:reason.trim().slice(0,300)};
  }));
  return checks.find(check=>!check.accepted) ?? {accepted:true};
}

async function setBilibiliCategory(documentRoot: Document, wait: BilibiliWait, ctx: BilibiliContext): Promise<void> {
  ctx.progress('正在选择并核验 B 站亲子分区', 'category');
  const root = await wait(()=>documentRoot.querySelector<HTMLElement>('.video-human-type') ?? undefined, '等待 B 站分区控件',10000);
  const selected = () => root.querySelector('.select-controller .select-item-cont')?.textContent?.trim();
  if (selected() !== '亲子') {
    const control = root.querySelector<HTMLElement>('.select-controller');
    if (!control || !visible(control)) throw new Error('B 站分区入口不可用，请手动检查');
    ctx.edit(()=>control.click());
    const option = await wait(()=>{
      const options=[...root.querySelectorAll<HTMLElement>('.drop-list-v2-item[title="亲子"]')].filter(visible);
      return options.length===1 ? options[0] : undefined;
    },'等待唯一亲子分区',10000);
    ctx.edit(()=>option.click());
  }
  await wait(()=>selected()==='亲子','核验 B 站亲子分区',10000);
  ctx.complete?.('category');
}
function visibleStatusText(documentRoot: ParentNode): string[] {
  return [...documentRoot.querySelectorAll<HTMLElement>('*')]
    .filter(element => visible(element) && element.children.length === 0)
    .map(element => element.textContent?.trim() ?? '')
    .filter(Boolean);
}
/** Bilibili exposes editor fields before the video upload finishes. */
export function isBilibiliUploadComplete(documentRoot: ParentNode): boolean {
  return visibleStatusText(documentRoot).some(text => /^(?:上传完成|上传成功|重新上传)$/u.test(text));
}
/**
 * Bilibili may replace its upload input while the bridge is reading the
 * asset. Reuse the current unique video input after that redraw, while still
 * failing closed when the page is ambiguous or already contains content.
 */
export function resolveBilibiliTransferInput(candidates: HTMLInputElement[], hasExistingContent: boolean): HTMLInputElement | undefined {
  if (hasExistingContent || candidates.length !== 1) return undefined;
  return candidates[0];
}
/** Pick the input Bilibili's upload app actually listens to. */
export function selectBilibiliUploadInput(inputs: HTMLInputElement[]): HTMLInputElement[] {
  const videoInputs = inputs.filter(element => /video|\.mp4|\.mov|\.webm/iu.test(element.accept) && element.accept !== '.txt');
  // The upload card owns the file chooser that was verified on the real page.
  // Its change handler initializes editor state before handing off to UPOS.
  const cardInputs = videoInputs.filter(element => element.closest('.bcc-upload-wrapper'));
  // The lower-level buploader input can appear before the card. Waiting for
  // the card avoids selecting that temporary sole candidate during startup.
  return cardInputs;
}

function exactVisibleText(root: ParentNode, value: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('button,[role="button"],li,td,span,p,div')]
    .filter(visible).filter(element => element.textContent?.trim() === value)
    .sort((a,b)=>a.children.length-b.children.length)[0];
}
async function setBilibiliSchedule(documentRoot: Document, scheduleAt: string, wait: BilibiliWait, ctx: FillContext): Promise<string> {
  const [date,time]=scheduleAt.split('T');
  if(!date||!time)throw new Error('定时发布时间格式无效，请重新选择时间');
  const switchControl=documentRoot.querySelector<HTMLElement>('.time-container .switch-container');
  if(!switchControl || !visible(switchControl))return 'B 站编辑页没有定时控件，已跳过定时设置；';
  ctx.progress('正在设置 B 站定时发布时间','schedule');
  if(!switchControl.classList.contains('switch-container-active')){ctx.edit(()=>switchControl.click());await wait(()=>switchControl.classList.contains('switch-container-active'),'核验 B 站定时发布开关',10000);}
  const picker=await wait(()=>documentRoot.querySelector<HTMLElement>('.time-picker') ?? undefined, '等待 B 站定时控件',10000);
  const dateControl=picker.querySelector<HTMLElement>('.date-picker-date');
  const timeControl=picker.querySelector<HTMLElement>('.date-picker-timer');
  if(!dateControl||!timeControl)return 'B 站定时控件不完整，已跳过定时设置，请手动检查；';
  ctx.edit(()=>dateControl.click());
  const day=await wait(()=>exactVisibleText(documentRoot,date), '等待 B 站定时日期',10000);
  ctx.edit(()=>day.click());
  ctx.edit(()=>timeControl.click());
  const hour=time.slice(0,2), minute=time.slice(3,5);
  const hourItem=await wait(()=>exactVisibleText(documentRoot,hour), '等待 B 站定时时',10000);
  ctx.edit(()=>hourItem.click());
  const minuteItem=await wait(()=>exactVisibleText(documentRoot,minute), '等待 B 站定时分钟',10000);
  ctx.edit(()=>minuteItem.click());
  const confirm=exactVisibleText(documentRoot,'确定');
  if(confirm)ctx.edit(()=>confirm.click());
  await wait(()=>picker.querySelector('.date-picker-date .date-show')?.textContent?.trim()===date && picker.querySelector('.date-picker-timer .date-show')?.textContent?.trim()===time,'核验 B 站定时发布时间',10000);
  return `已设置并回读 B 站定时发布时间 ${scheduleAt.replace('T',' ')}；`;
}

async function setBilibiliCover(documentRoot: Document, cover: Asset, wait: BilibiliWait, ctx: FillContext): Promise<string> {
  if (!(cover.blob instanceof Blob) || !/^image\/(?:jpeg|png)$/u.test(cover.type)) throw new Error('B 站封面仅支持 JPG 或 PNG，请手动设置');
  const main = documentRoot.querySelector<HTMLElement>('.cover-module-main');
  const entry = main?.querySelector<HTMLElement>('.cover-empty-pill') ?? main?.querySelector<HTMLElement>('.cover-empty');
  if (!main || !entry || !visible(entry)) throw new Error('B 站已有封面或未找到封面入口，未覆盖，请手动检查');
  ctx.progress('正在设置 B 站封面', 'cover-0-open');
  ctx.edit(() => entry.click());
  const input = await wait(() => {
    const inputs = [...documentRoot.querySelectorAll<HTMLInputElement>('.cover-editor-panel input[type="file"]')]
      .filter(candidate => !candidate.disabled && /image\/(?:png|jpeg)/u.test(candidate.accept));
    if (inputs.length !== 1 || inputs[0]!.files?.length) return;
    return inputs[0];
  }, '等待 B 站封面上传入口', 30000);
  const transfer = new DataTransfer();
  transfer.items.add(new File([cover.blob], cover.name, {type: cover.type, lastModified: cover.lastModified}));
  ctx.edit(() => {
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
  });
  await wait(() => input.files?.length === 1, '核验 B 站封面文件', 30000);
  await wait(() => {
    const editors = [...documentRoot.querySelectorAll<HTMLElement>('.cover-editor-panel .cover-editor-panel-canvas-image, .cover-editor-panel [id^="editor_"]')];
    return editors.some(editor => getComputedStyle(editor).opacity !== '0' && editor.querySelector('canvas'));
  }, '等待 B 站封面预览', 60000);
  const done = await wait(() => {
    const buttons = [...documentRoot.querySelectorAll<HTMLElement>('.cover-editor-content-right-bottom .button.submit, .cover-editor-content-right-bottom .submit')]
      .filter(candidate => visible(candidate) && candidate.textContent?.trim() === '完成');
    return buttons.length === 1 ? buttons[0] : undefined;
  }, '等待 B 站封面完成按钮', 30000);
  ctx.progress('正在确认 B 站封面', 'cover-0-confirm');
  ctx.edit(() => done.click());
  await wait(() => !documentRoot.querySelector('.cover-editor-panel') && !main.querySelector('.cover-empty'), '核验 B 站封面已应用', 60000);
  return 'B 站封面已应用并回读核验；';
}

async function setBilibiliTags(documentRoot: Document, tags: string[], wait: BilibiliWait, ctx: BilibiliContext): Promise<string> {
  const rejected: BilibiliRejectedTag[]=[];
  ctx.rejectedTags?.([]);
  if (!tags.length) return '';
  const input = await wait(() => [...documentRoot.querySelectorAll<HTMLInputElement>('input[placeholder="按回车键Enter创建标签"]')].find(visible), '等待 B 站标签输入框', 30000);
  const container = input.closest('.tag-container, .tag-input-wrp, .input-container') ?? input.parentElement;
  if (!container) throw new Error('B 站标签控件不完整，请手动设置');
  const existing = () => [...container.querySelectorAll<HTMLElement>('.label-item-v2-content')].map(element => element.textContent?.trim() ?? '').filter(Boolean);
  const pending = tags.filter(tag => !existing().includes(tag));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 B 站标签');
  let added=0;
  for (const tag of pending) {
    const validation=await (ctx.checkTag ? ctx.checkTag(tag) : checkBilibiliTag(tag,ctx.signal));
    if (ctx.signal.aborted) throw new Error('操作已停止');
    if (!validation.accepted) {
      if (!validation.reason) throw new Error(`B 站标签“${tag}”校验结果不明，未跳过`);
      rejected.push({tag,reason:validation.reason});ctx.rejectedTags?.([...rejected]);
      ctx.progress(`B 站拒绝标签“${tag}”：${validation.reason}；已跳过，继续其余标签`,'copy');
      continue;
    }
    if (existing().length >= 10) throw new Error('B 站标签最多 10 个，请减少标签后重试');
    ctx.edit(() => {
      input.focus();
      setter.call(input, tag);
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
      input.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
    });
    await wait(() => existing().includes(tag), `核验 B 站标签“${tag}”`, 10000);
    added++;
  }
  return `${added ? `已创建 ${added} 个 B 站标签；` : '其余 B 站标签已核验；'}${rejected.length ? `已跳过平台拒绝的标签：${rejected.map(item=>item.tag).join('、')}；` : ''}`;
}

export async function fillBilibili(documentRoot: Document, publication: Publication, ctx: BilibiliContext): Promise<string> {
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
  await wait(() => {
    const status = visibleStatusText(documentRoot);
    if (status.some(text => /上传失败|上传出错|视频处理失败/u.test(text))) throw new Error('B 站报告视频上传或处理失败，未填写');
    return isBilibiliUploadComplete(documentRoot) || undefined;
  }, '等待 B 站视频上传与处理完成');
  ctx.complete?.('upload');
  progress('B 站视频上传与处理已完成', 'upload');
  const fields = await wait(() => {
    const title = [...documentRoot.querySelectorAll<HTMLInputElement>('input[placeholder*="稿件标题"], input[placeholder*="标题"], input[aria-label="标题"]')].find(visible);
    const description = [...documentRoot.querySelectorAll<HTMLTextAreaElement>('textarea[placeholder*="简介"], textarea[aria-label="简介"], [contenteditable="true"][data-placeholder*="简介"], [contenteditable="true"][data-placeholder*="描述"], [contenteditable="true"]')].find(visible) as HTMLTextAreaElement | HTMLElement | undefined;
    return title && description ? {title, description} : undefined;
  }, '等待 B 站编辑页');
  progress('已找到 B 站标题和简介输入框', 'copy');
  const existingTitle = textOf(fields.title as never).trim();
  const generatedTitle = ctx.generatedTitle?.trim();
  const body = publication.description;
  const existingDescription = textOf(fields.description).trim();
  const copyAlreadyMatches = existingTitle === publication.title && existingDescription === body.trim();
  if ((existingTitle && (!copyAlreadyMatches && (!generatedTitle || existingTitle !== generatedTitle))) || (existingDescription && !copyAlreadyMatches)) throw new Error('B 站编辑页已有不同文案，未覆盖，请手动检查');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!copyAlreadyMatches) {
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
  } else progress('B 站文案已存在且回读一致，继续后续步骤', 'copy');
  await wait(() => fields.title.value === publication.title && sameText(textOf(fields.description), body), '核验 B 站标题和简介', 30000);
  await setBilibiliCategory(documentRoot,wait,ctx);
  let coverNote = '';
  if (ctx.cover) {
    coverNote = await setBilibiliCover(documentRoot, ctx.cover, wait, ctx);
    for (const suffix of ['open','baseline','upload','confirm']) ctx.complete?.(`cover-0-${suffix}`);
  }
  progress('正在填写并核验 B 站标签', 'copy');
  const tagNote = await setBilibiliTags(documentRoot, publication.tags, wait, ctx);
  ctx.complete?.('copy');
  let declaration = '';
  const originalControl = findDeclarationControl(documentRoot, ['声明原创', '原创视频']);
  if (originalControl) {
    let checked = false;
    ctx.edit(() => { checked = ensureChecked(originalControl); });
    if (checked) declaration += '已勾选原创声明；';
  }
  const declarationInput = [...documentRoot.querySelectorAll<HTMLInputElement>('input[placeholder="请选择符合您视频内容的创作声明"]')].find(declarationVisible);
  if (declarationInput) {
    progress('正在设置 B 站创作声明', 'declaration');
    ctx.edit(() => declarationInput.click());
    const option = await wait(() => findDeclarationText(documentRoot, ['含AI生成内容', '含 AI 生成内容']), '等待 B 站 AI 生成声明', 10000);
    if (option) {
      ctx.edit(() => option.click());
      await wait(() => declarationInput.value.includes('AI') || declarationInput.value.includes('生成'), '核验 B 站创作声明', 10000);
      declaration += '已选择 AI 生成内容';
    }
  }
  if (!declaration) throw new Error('B 站创作声明未核验，请手动检查');
  ctx.complete?.('declaration');
  let scheduleNote='';
  if(publication.scheduleAt) {
    scheduleNote=await setBilibiliSchedule(documentRoot,publication.scheduleAt,wait,ctx);
    if (!scheduleNote.startsWith('已设置并回读')) throw new Error(scheduleNote);
    ctx.complete?.('schedule');
  }
  return `B站标题和简介已回读核验；${coverNote}${tagNote}${declaration}；${scheduleNote}请在当前编辑页检查后点击“立即投稿”。`;
}
/** Runs in MAIN world to read the uploader's own state. */
export function inspectBilibiliEditor() {
  const params = new URLSearchParams(location.search);
  if (location.origin !== 'https://member.bilibili.com' || location.pathname !== '/platform/upload/video/frame'
    || ['aid', 'bvid', 'type', 'draftId'].some(key => params.has(key))) {
    throw new Error('当前不是 B 站新稿件编辑页，请手动检查');
  }
  const appWindow = (window as Window & {__MICRO_APP_PROXY_WINDOW__?: Window}).__MICRO_APP_PROXY_WINDOW__ ?? window;
  type PageTask = {archive: {title?: string; desc?: string; tid?: number}; videoTasks: {status: number; cid: number; filename: string}[]};
  type VueHost = Element & {__vue__?: {$taskConfig?: {tasks: PageTask[]}}};
  const host = [...appWindow.document.querySelectorAll<VueHost>('*')].find(e => e.__vue__?.$taskConfig);
  const tasks = host?.__vue__?.$taskConfig?.tasks;
  const task = tasks?.length === 1 ? tasks[0] : undefined;
  const video = task?.videoTasks.length === 1 ? task.videoTasks[0] : undefined;
  if (!task || !video) throw new Error('无法核验 B 站页面的单视频上传任务');
  if (video.status !== 3 || !Number.isSafeInteger(Number(video.cid)) || Number(video.cid) <= 0 || !video.filename) {
    throw new Error('B 站编辑页尚未确认视频上传完成，请手动检查');
  }
  return {title: task.archive.title ?? '', description: task.archive.desc ?? '', tid: Number(task.archive.tid)};
}

/** Dispatch from the page realm so the uploader receives its own File/Event wrappers. */
export function triggerBilibiliUpload(name: string, size: number): boolean | 'waiting' {
  if (location.origin !== 'https://member.bilibili.com' || location.pathname !== '/platform/upload/video/frame') return false;
  type UploadWindow = Window & {_profile?: {upload?: string}};
  const appWindow = (window as Window & {__MICRO_APP_PROXY_WINDOW__?: UploadWindow}).__MICRO_APP_PROXY_WINDOW__ ?? window as UploadWindow;
  // The card renders before initProfile() resolves, but the uploader reads the profile synchronously.
  if (!appWindow._profile?.upload) return 'waiting';
  const inputs = [...appWindow.document.querySelectorAll<HTMLInputElement>('.bcc-upload-wrapper input[type="file"]')]
    .filter(input => !input.disabled && /video|\.mp4/iu.test(input.accept));
  if (inputs.length !== 1) throw new Error(`B 站上传卡片数量不符：${inputs.length}`);
  const input = inputs[0]!;
  if (input.files?.length !== 1) throw new Error('B 站上传卡片尚未收到视频文件');
  const file = input.files[0]!;
  if (file.name !== name || file.size !== size || !size) throw new Error('B 站上传卡片的视频文件身份不符');
  input.dispatchEvent(new Event('change', {bubbles: true}));
  return true;
}
