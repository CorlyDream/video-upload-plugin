import type {Publication} from '../core/publication';
import type {Asset} from '../core/model';
import type {FillContext} from './xiaohongshu';
import {declarationVisible, ensureChecked, findDeclarationControl, findDeclarationText} from './declarations';

const visible = (element: Element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
const textOf = (element: HTMLTextAreaElement | HTMLElement) => ('value' in element ? element.value : element.innerText || element.textContent || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
const sameText = (actual: string, expected: string) => actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim();
type BilibiliWait = <T>(read:()=>T|undefined|false,label:string,timeout?:number)=>Promise<T>;
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
  ctx.progress('正在设置 B 站封面', 'cover-open');
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
  ctx.progress('正在确认 B 站封面', 'cover-confirm');
  ctx.edit(() => done.click());
  await wait(() => !documentRoot.querySelector('.cover-editor-panel') && !main.querySelector('.cover-empty'), '核验 B 站封面已应用', 60000);
  return 'B 站封面已应用并回读核验；';
}

async function setBilibiliTags(documentRoot: Document, tags: string[], wait: BilibiliWait, ctx: FillContext): Promise<string> {
  if (!tags.length) return '';
  const input = await wait(() => [...documentRoot.querySelectorAll<HTMLInputElement>('input[placeholder="按回车键Enter创建标签"]')].find(visible), '等待 B 站标签输入框', 30000);
  const container = input.closest('.tag-container, .tag-input-wrp') ?? input.parentElement;
  if (!container) throw new Error('B 站标签控件不完整，请手动设置');
  const existing = () => [...container.querySelectorAll<HTMLElement>('.label-item-v2-content')].map(element => element.textContent?.trim() ?? '').filter(Boolean);
  const pending = tags.filter(tag => !existing().includes(tag));
  if (existing().length + pending.length > 10) throw new Error('B 站标签最多 10 个，请减少标签后重试');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置 B 站标签');
  for (const tag of pending) {
    ctx.edit(() => {
      input.focus();
      setter.call(input, tag);
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
      input.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
    });
    await wait(() => existing().includes(tag), `核验 B 站标签“${tag}”`, 10000);
  }
  return pending.length ? `已创建 ${pending.length} 个 B 站标签；` : 'B 站标签已存在；';
}

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
  const existingTitle = textOf(fields.title as never).trim();
  const generatedTitle = ctx.generatedTitle?.trim();
  if ((existingTitle && (!generatedTitle || existingTitle !== generatedTitle)) || textOf(fields.description).trim()) throw new Error('B 站编辑页已有文案，未覆盖，请手动检查');
  const body = publication.description;
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
  let coverNote = '';
  if (ctx.cover) coverNote = await setBilibiliCover(documentRoot, ctx.cover, wait, ctx);
  const tagNote = await setBilibiliTags(documentRoot, publication.tags, wait, ctx);
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
  let scheduleNote='';
  if(publication.scheduleAt) scheduleNote=await setBilibiliSchedule(documentRoot,publication.scheduleAt,wait,ctx);
  return `B站标题和简介已回读核验；${coverNote}${tagNote}${declaration ? declaration + '；' : ''}${scheduleNote}${publication.tags.length && !tagNote ? '标签请检查平台控件；' : ''}请检查后手动投稿；未投稿、未保存草稿。`;
}
