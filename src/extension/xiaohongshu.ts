import {scheduleOption, selectScheduleMonth, type SchedulePickerWait} from './schedule-picker';
import { publicationBody, type Publication } from '../core/publication';
import type { Asset } from '../core/model';
import {checkedState, declarationDisabled, declarationVisible, ensureChecked, findDeclarationControl, findDeclarationText, selectAiDeclaration} from './declarations';

export interface FillContext { signal: AbortSignal; progress: (reason: string, stage?: string) => void; edit: (action: () => void) => void; generatedTitle?: string; cover?: Asset }
const titleSelector = 'input[placeholder="填写标题会有更多赞哦"]';
const bodySelector = '.tiptap.ProseMirror[contenteditable="true"]';
const coverSelector = '.cover-plugin-preview';
const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
export function isUploadPreviewReady(preview?: { getAttribute: (name: string) => string | null }): boolean {
  return !!preview && preview.getAttribute('aria-busy') !== 'true';
}
function one<T extends Element>(selector: string, root: ParentNode = document): T | undefined {
  const matches = [...root.querySelectorAll<T>(selector)].filter(visible);
  if (matches.length > 1) throw new Error('发现多个填写控件，已停止以保护原稿');
  return matches[0];
}
function guard(signal: AbortSignal) { if (signal.aborted) throw new Error('操作已停止'); }

function compactText(value: string) { return value.replace(/\s+/gu, ' ').trim(); }
function scheduleControls(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button,label,[role="button"],[role="switch"],input[type="checkbox"],div,span')]
    .filter(visible)
    .filter(element => compactText(element.textContent ?? '').startsWith('定时发布') || compactText(element.getAttribute('aria-label') ?? '').startsWith('定时发布'))
    .filter(element => ![...element.children].some(child => compactText(child.textContent ?? '').startsWith('定时发布')))
    .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
}
function scheduleInput(root: ParentNode, kind: 'datetime-local' | 'date' | 'time'): HTMLInputElement | undefined {
  const selector = kind === 'datetime-local' ? 'input[type="datetime-local"]' : `input[type="${kind}"]`;
  const inputs = [...root.querySelectorAll<HTMLInputElement>(selector)].filter(visible);
  if (inputs.length > 1) throw new Error('定时发布时间控件不唯一，请手动设置');
  return inputs[0];
}
function labeledScheduleInputs(root: ParentNode): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>('input')].filter(input => visible(input) && /日期|时间/.test(`${input.getAttribute('aria-label') ?? ''} ${input.placeholder ?? ''}`));
}
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('无法设置定时发布时间');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', {bubbles: true}));
  input.dispatchEvent(new Event('change', {bubbles: true}));
}
function scheduleDisplay(scheduleAt: string) {
  return scheduleAt.replace('T', ' ');
}
function collectionTrigger(): HTMLElement | undefined {
  // The live editor changes the trigger class after a collection is selected:
  // the initial empty state uses `.collection-plugin-button`, while the
  // selected state is rendered as `.collection-plugin-choose`. Treat both as
  // the same control so a completed selection can be read back immediately.
  const controls = [...document.querySelectorAll<HTMLElement>('.collection-plugin-button,.collection-plugin-choose')].filter(visible);
  if (controls.length > 1) throw new Error('小红书合集控件不唯一，请手动设置');
  return controls[0];
}
function collectionValue(trigger: HTMLElement): string {
  return compactText(trigger.querySelector<HTMLElement>('.collection-name')?.textContent ?? trigger.textContent ?? '');
}
function collectionOption(name: string): HTMLElement | undefined {
  const expected = compactText(name);
  const options = [...document.querySelectorAll<HTMLElement>('.collection-plugin-popover-content .item')]
    .filter(visible)
    .filter(item => compactText(item.querySelector<HTMLElement>('.item-label')?.textContent ?? item.textContent ?? '') === expected);
  if (options.length > 1) throw new Error('小红书同名合集不唯一，请手动设置');
  return options[0];
}
export async function selectXiaohongshuCollection(name: string, context: Pick<FillContext, 'signal' | 'progress' | 'edit'>): Promise<string> {
  const expected = compactText(name);
  if (!expected) return '';
  const {signal, progress, edit} = context;
  const trigger = collectionTrigger();
  if (!trigger) return '小红书编辑页没有合集控件，已跳过合集设置；';
  progress('正在选择小红书合集', 'collection');
  const current = collectionValue(trigger);
  if (current.includes(expected) && !current.includes('选择合集')) return `已回读小红书合集“${expected}”；`;
  edit(() => trigger.click());
  const option = await waitFor(() => collectionOption(name), signal, 10000, false, '等待小红书同名合集');
  edit(() => (option.querySelector<HTMLElement>('.item-label') ?? option).click());
  await waitFor(() => {
    const updated = collectionTrigger();
    if (!updated) return false;
    const text = collectionValue(updated);
    return text.includes(expected) && !text.includes('选择合集');
  }, signal, 10000, true, '核验小红书合集选择');
  return `已选择并回读小红书合集“${expected}”；`;
}
async function setXiaohongshuPicker(
  scope: ParentNode,
  trigger: HTMLElement,
  date: string,
  time: string,
  context: Pick<FillContext, 'signal' | 'edit'>,
) {
  const {signal, edit} = context;
  const wait: SchedulePickerWait = (read, label) => waitFor(read, signal, 10000, true, label);
  const input = () => one<HTMLInputElement>('input.d-text', trigger);
  const current = () => scope.querySelector('.d-datepicker-input-filter-shadow')?.textContent?.trim();
  const expected = `${date} ${time}`;
  if (current() === expected && input()?.value === expected) return;

  // Delight renders the calendar outside the schedule row and opens it on focus.
  const panel = () => one<HTMLElement>('.d-datepicker-body:has(.d-timepicker-timebar)');
  if (!panel()) edit(() => trigger.dispatchEvent(new FocusEvent('focusin', {bubbles: true})));
  await wait(panel, '等待小红书定时日历');
  if (!current()?.startsWith(date + ' ')) {
    await selectScheduleMonth(date, () => panel()?.querySelector('.d-datepicker-selector')?.textContent ?? '', direction => {
      const arrows = panel()?.querySelectorAll<HTMLElement>('.d-datepicker-header > div .d-icon');
      const arrow = arrows?.length === 4 ? arrows[direction === 'next' ? 2 : 1] : undefined;
      if (!arrow) throw new Error('小红书定时日历无法切换月份，请手动检查');
      edit(() => arrow.click());
    }, wait, '小红书');
    const calendar = await wait(panel, '等待小红书定时日历');
    const day = await wait(() => scheduleOption(calendar, '.d-datepicker-cell:not(.disabled):not(.--color-text-placeholder)', String(Number(date.slice(-2)))), '等待小红书定时日期');
    edit(() => day.click());
  }
  for (const [index, value] of time.split(':').entries()) {
    const option = await wait(() => {
      const column = panel()?.querySelectorAll('.d-timepicker-timebar')[index];
      if (!column) return;
      const selectedLabel = value + (index === 0 ? '时' : '分');
      return scheduleOption(column, '.d-timepicker-time.active:not(.disabled)', selectedLabel)
        ?? scheduleOption(column, '.d-timepicker-time:not(.disabled)', value);
    }, index === 0 ? '等待小红书定时小时' : '等待小红书定时分钟');
    if (!option.classList.contains('active')) edit(() => option.click());
  }
  edit(() => { input()?.blur(); document.body.click(); });
  await wait(() => !panel() && current() === expected && input()?.value === expected, '核验小红书定时发布时间');
}

/** Enable Xiaohongshu's schedule control and verify its selected local time. */
export async function setXiaohongshuSchedule(scheduleAt: string, context: Pick<FillContext, 'signal' | 'progress' | 'edit'>): Promise<string> {
  const {signal, progress, edit} = context;
  const [date, time] = scheduleAt.split('T');
  if (!date || !time) throw new Error('定时发布时间格式无效，请重新选择时间');
  progress('正在设置小红书定时发布时间', 'schedule');
  const control = scheduleControls()[0];
  if (!control) return '小红书编辑页没有定时控件，已跳过定时设置；';
  const controlScope = control.closest('.post-time-wrapper') ?? control.closest('label,section,form,div') ?? document;
  const checkbox = control instanceof HTMLInputElement && control.type === 'checkbox'
    ? control
    : controlScope.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const switchControl = control.getAttribute('role') === 'switch' ? control : controlScope.querySelector<HTMLElement>('[role="switch"]');
  const enabled = () => checkbox ? checkbox.checked : switchControl ? switchControl.getAttribute('aria-checked') === 'true' : true;
  if (!checkbox && !switchControl) {
    edit(() => control.click());
  } else if (!enabled()) {
    edit(() => (checkbox ?? switchControl ?? control).click());
    await waitFor(() => enabled(), signal, 10000, true, '核验小红书定时发布开关');
  }
  const scope = controlScope as ParentNode;
  const picker = one<HTMLElement>('.d-datepicker-wrapper', scope);
  if (picker) {
    await setXiaohongshuPicker(scope, picker, date, time, context);
    return `已设置并回读定时发布时间 ${scheduleDisplay(scheduleAt)}；请检查后手动发布。`;
  }
  const roots = [scope, document].filter((root, index, all) => all.indexOf(root) === index);
  const panel = roots.find(root => root.querySelector('input[type="datetime-local"],input[type="date"],input[type="time"]') || labeledScheduleInputs(root).length >= 2) ?? document;
  const datetime = scheduleInput(panel, 'datetime-local');
  const dateInput = datetime ? undefined : scheduleInput(panel, 'date');
  const timeInput = datetime ? undefined : scheduleInput(panel, 'time');
  const labeled = datetime || dateInput || timeInput ? [] : labeledScheduleInputs(panel);
  if (!datetime && (!dateInput || !timeInput) && labeled.length < 2) throw new Error('未找到小红书定时日期和时间控件，请手动设置');
  edit(() => {
    if (datetime) setInputValue(datetime, scheduleAt);
    else if (dateInput && timeInput) { setInputValue(dateInput, date); setInputValue(timeInput, time); }
    else {
      const dateLabeled = labeled.find(input => /日期/.test(`${input.getAttribute('aria-label') ?? ''} ${input.placeholder ?? ''}`));
      const timeLabeled = labeled.find(input => /时间/.test(`${input.getAttribute('aria-label') ?? ''} ${input.placeholder ?? ''}`));
      if (!dateLabeled || !timeLabeled) throw new Error('无法区分定时日期和时间控件，请手动设置');
      setInputValue(dateLabeled, date); setInputValue(timeLabeled, time);
    }
  });
  await waitFor(() => {
    if (datetime) return datetime.value === scheduleAt;
    if (dateInput && timeInput) return dateInput.value === date && timeInput.value === time;
    return labeled.some(input => input.value === date) && labeled.some(input => input.value === time);
  }, signal, 10000, true, '核验小红书定时发布时间');
  return `已设置并回读定时发布时间 ${scheduleDisplay(scheduleAt)}；请检查后手动发布。`;
}
export function waitFor<T>(read: () => T | undefined | false, signal: AbortSignal, timeout = 30000, deferred = false, stage = '页面确认', onVisibility?: (visible:boolean)=>void): Promise<T> {
  guard(signal);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setInterval>;
    let remaining = timeout;
    let lastTick = Date.now();
    const pageVisible = () => !onVisibility || document.visibilityState === 'visible' || document.hasFocus?.() === true;
    let wasVisible = pageVisible();
    let announced: boolean | undefined;
    const clean = () => { clearInterval(timer); signal.removeEventListener('abort', abort); if(onVisibility)document.removeEventListener('visibilitychange',inspect); };
    const abort = () => { clean(); reject(new Error('操作已停止')); };
    const inspect = () => {
      try {
        guard(signal);
        const now = Date.now();
        if(wasVisible)remaining -= now-lastTick;
        lastTick=now;
        wasVisible=pageVisible();
        if(onVisibility && announced!==wasVisible){announced=wasVisible;onVisibility(wasVisible);}
        if(!wasVisible)return;
        const result = read();
        if (result) { clean(); resolve(result); }
        else if (remaining <= 0) { clean(); reject(new Error(stage + '等待超过 ' + Math.round(timeout / 1000) + ' 秒，已停止自动操作；请检查原页面，不会重复上传')); }
      } catch (error) { clean(); reject(error); }
    };
    signal.addEventListener('abort', abort, {once:true});
    if(onVisibility)document.addEventListener('visibilitychange',inspect);
    timer = setInterval(inspect, 250); if (!deferred) inspect();
  });
}
function editorText(element: HTMLElement): string {
  // ProseMirror paragraphs are logical lines; innerText adds visual paragraph spacing.
  const paragraphs = [...element.children];
  const text = paragraphs.length && paragraphs.every(node => node.tagName === 'P')
    ? paragraphs.map(node => (node as HTMLElement).innerText.replace(/\n+$/, '')).join('\n')
    : element.innerText;
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}
function previewSignature(): string {
  const preview = document.querySelector(`${coverSelector} .cover > .default`);
  return preview?.getAttribute('style') ?? '';
}
function pkCards(): HTMLElement[] {
  // The panel may keep an empty add slot as a card while it is rendering.
  // Only cards with an edit entry represent an existing candidate slot.
  return [...document.querySelectorAll<HTMLElement>('.pk-cover-list-card')]
    .filter(card => visible(card) && !!card.querySelector('.pk-cover-list-edit-text'));
}
function coverMedia(modal: HTMLElement): string {
  const parts: string[] = [];
  for (const image of modal.querySelectorAll('img')) {
    if (visible(image) && image.complete && image.naturalWidth) parts.push(image.currentSrc || image.src);
  }
  for (const canvas of modal.querySelectorAll('canvas')) {
    if (visible(canvas) && canvas.width && canvas.height) {
      try { parts.push(canvas.toDataURL()); } catch { /* Unreadable preview requires manual confirmation. */ }
    }
  }
  return JSON.stringify(parts);
}
const coverProofs = ((globalThis as typeof globalThis & {__xhCoverProofs?: Record<string,string>}).__xhCoverProofs ??= {});
async function imageMatchesAsset(image: HTMLImageElement, asset: Asset, signal: AbortSignal): Promise<boolean> {
  if (!image.complete || !image.naturalWidth) return false;
  const src = image.currentSrc || image.src;
  if (!/^(blob:|data:image\/)/.test(src)) return false;
  const response = await fetch(src, {signal});
  if (!response.ok) return false;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.blob.size) return false;
  const hash = async (data: ArrayBuffer) => new Uint8Array(await crypto.subtle.digest('SHA-256',data)).toString();
  return await hash(bytes) === await hash(await asset.blob.arrayBuffer());
}
async function selectCoverRatio(modal: HTMLElement, asset: Asset, context: Pick<FillContext,'signal'|'edit'>) {
  const cropTab = [...modal.querySelectorAll<HTMLElement>('button,div,span')].filter(visible).find(e=>compactText(e.textContent ?? '')==='裁剪' && ![...e.children].some(c=>compactText(c.textContent ?? '')==='裁剪'));
  if (cropTab) context.edit(()=>cropTab.click());
  const selector = modal.matches('.cover-modal,.pk-cover-list-editor-modal') ? '.ratio-option' : '.crop-ratio-item';
  if (cropTab) await waitFor(()=>modal.querySelector(selector),context.signal,10000,false,'等待封面裁剪比例');
  const options=[...modal.querySelectorAll<HTMLElement>(selector)].filter(visible);
  if (!options.length) return;
  const bitmap=await createImageBitmap(asset.blob);
  const desired=bitmap.width>bitmap.height?'4:3':bitmap.width<bitmap.height?'3:4':'1:1';bitmap.close();
  const matches=options.filter(e=>compactText(e.textContent ?? '')===desired);
  if(matches.length!==1)throw new Error('封面裁剪比例入口不唯一，未保存');
  const option=matches[0]!;
  if(!option.classList.contains('active')&&!option.classList.contains('crop-ratio-item-active')) context.edit(()=>option.click());
  await waitFor(()=>option.classList.contains('active')||option.classList.contains('crop-ratio-item-active'),context.signal,10000,true,'核验封面裁剪比例');
}
function legacyCoverModal(): HTMLElement | undefined {
  const candidates = [...document.querySelectorAll<HTMLElement>('.d-modal')]
    .filter(visible)
    .filter(modal => compactText(modal.textContent ?? '').includes('设置封面') && !!modal.querySelector('.btn-confirm'));
  if (candidates.length > 1) throw new Error('小红书旧版封面弹窗不唯一，请手动处理');
  return candidates[0];
}
function deferClick(context: Pick<FillContext, 'edit'>, element: HTMLElement) {
  // Xiaohongshu performs synchronous crop/encode work from the legacy confirm
  // handler. Let the bridge message return before entering that handler so a
  // slow platform render cannot make the automation channel look hung.
  context.edit(() => setTimeout(() => { if (element.isConnected) element.click(); }, 0));
}
export async function fillXiaohongshu(publication: Publication, cover: Asset | undefined, context: FillContext, pkCovers: Asset[] = [], coverPk?: boolean): Promise<string> {
  const {signal, progress} = context;
  progress('视频已交接，等待平台完成上传后填写','upload');
  const fields = await waitFor(() => {
    const text = document.body.innerText;
    if (/上传失败|上传出错|视频处理失败/.test(text)) throw new Error('平台报告视频上传或处理失败，未填写');
    if (/上传中|处理中|转码中/.test(text) || !text.includes('重新上传')) return;
    const title = one<HTMLInputElement>(titleSelector);
    const body = one<HTMLElement>(bodySelector);
    const preview = one<HTMLElement>(coverSelector);
    if (!title || !body || !isUploadPreviewReady(preview)) return;
    return {title, body};
  }, signal, 10 * 60 * 1000, false, '视频上传与处理');
  guard(signal);
  const bodyText = publicationBody(publication);
  const existingTitle = fields.title.value.trim();
  const existingBody = editorText(fields.body);
  const copyAlreadyMatches = existingTitle === publication.title && existingBody === bodyText.replace(/\n+$/, '');
  if ((existingTitle || existingBody) && !copyAlreadyMatches) throw new Error('编辑页已有不同文案，未覆盖，请手动检查');
  if (!copyAlreadyMatches) {
    progress('平台上传已完成，正在填写标题和正文','copy');
    if (publication.title) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(fields.title, publication.title);
      fields.title.dispatchEvent(new Event('input', {bubbles:true}));
      fields.title.dispatchEvent(new Event('change', {bubbles:true}));
    }
    guard(signal);
    if (bodyText) {
      fields.body.focus();
      // Use the editor's native editing path, never manufacture ProseMirror internal nodes.
      context.edit(() => {
        const lines = bodyText.split('\n');
        const lineCommand = fields.body.firstElementChild?.tagName === 'P' ? 'insertParagraph' : 'insertLineBreak';
        for (let index = 0; index < lines.length; index++) {
          if (index && !document.execCommand(lineCommand)) throw new Error('正文编辑器不接受换行，请手动检查');
          if (lines[index] && !document.execCommand('insertText', false, lines[index])) throw new Error('正文编辑器不接受自动输入，请手动填写');
        }
      });
      fields.body.dispatchEvent(new Event('input', {bubbles:true}));
    }
  } else {
    progress('平台文案已存在且回读一致，继续后续步骤','copy');
  }
  const verifyCopy = () => {
    if (!fields.title.isConnected || !fields.body.isConnected || fields.title.value !== publication.title || editorText(fields.body) !== bodyText.replace(/\n+$/, '')) throw new Error('标题或正文回读不一致，请检查页面，不会重复填写');
  };
  // Separate a browser event turn so framework rerenders cannot be mistaken for acceptance.
  await waitFor(() => { verifyCopy(); return true; }, signal, 30000, true);
  let declarationNote='';
  const originalLabels=['原创声明','声明原创','原创视频'];
  // The agreement's confirm button is also named 声明原创. Prefer the
  // setting's own labels so an already-open dialog cannot make it ambiguous.
  const readOriginal=()=>findDeclarationControl(document,['原创声明','原创视频'])??findDeclarationControl(document,['声明原创']);
  const originalDialog=()=>[...document.querySelectorAll<HTMLElement>('.originalContainer')].find(declarationVisible);
  const originalControl=readOriginal();
  if(originalControl && (checkedState(originalControl)===true || !declarationDisabled(originalControl))){
    progress('正在设置小红书原创声明','declaration');
    if(checkedState(originalControl)!==true || originalDialog()){
      if(!originalDialog())context.edit(()=>ensureChecked(originalControl));
      // First-time declarations open an agreement rather than immediately
      // persisting the switch. Only confirm inside this specific dialog.
      await waitFor(()=>checkedState(readOriginal()??originalControl)===true||originalDialog(),signal,10000,true,'等待小红书原创声明确认');
      const dialog=originalDialog();
      if(dialog){
        const agreement=dialog.querySelector<HTMLElement>('#originalCheckBox')
          ?? findDeclarationText(dialog,['《原创声明须知》','原创声明须知'])?.closest<HTMLElement>('.d-checkbox-main-label');
        if(!agreement)throw new Error('小红书原创声明须知勾选框未找到，请手动检查');
        const checkbox=agreement.querySelector<HTMLElement>('input[type="checkbox"],[role="checkbox"]')??agreement;
        if(checkedState(checkbox)!==true){
          // Delight handles clicks on the label and keeps the checked state in its native input.
          const target=agreement.matches('.d-checkbox-main-label')?agreement:checkbox;
          context.edit(()=>ensureChecked(target));
        }
        const confirm=await waitFor(()=>{
          const text=findDeclarationText(dialog,['声明原创']);
          const button=text?.closest<HTMLElement>('button,[role="button"]')??text;
          return button&&!button.matches(':disabled,[aria-disabled="true"],.disabled,.is-disabled')?button:undefined;
        },signal,10000,true,'等待小红书原创声明确认按钮');
        context.edit(()=>confirm.click());
        await waitFor(()=>!originalDialog(),signal,10000,true,'核验小红书原创声明弹窗关闭');
      }
    }
    await waitFor(()=>checkedState(readOriginal()??originalControl)===true,signal,10000,true,'核验小红书原创声明');
    declarationNote+='已勾选原创声明；';
  }else if(findDeclarationText(document,originalLabels)){
    declarationNote+='原创声明未确认，请手动检查；';
  }
  progress('正在设置小红书 AI 生成声明','declaration');
  declarationNote+=await selectAiDeclaration(['添加内容类型声明','添加创作声明','内容类型声明'],['笔记含AI合成内容','含AI生成内容','内容由AI生成','AI生成内容','AI生成'],context.edit,
    (read,label,deferred)=>waitFor(read,signal,10000,deferred,label));
  let collectionNote = '';
  if (publication.collection) collectionNote = await selectXiaohongshuCollection(publication.collection, context);
  let scheduleNote = '';
  if (publication.scheduleAt) scheduleNote = await setXiaohongshuSchedule(publication.scheduleAt, context);
  let coverResult = '保留平台默认封面';
  if (pkCovers.length > 3 || (pkCovers.length && (!cover || !coverPk))) throw new Error('PK 封面配置无效');
  if (coverPk !== undefined) {
    progress(coverPk ? '正在开启封面 PK' : '正在关闭封面 PK','pk');
    const toggle = one<HTMLElement>('.pk-cover-panel-switch');
    const checkbox = toggle?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle || !checkbox || checkbox.disabled) throw new Error('无法确认封面 PK 开关，请手动处理');
    if (checkbox.checked !== coverPk) { guard(signal); toggle.click(); }
    await waitFor(()=>checkbox.isConnected && checkbox.checked === coverPk, signal, 30000, true);
  }
  const allCovers = cover ? [cover,...pkCovers] : [];
  for (const [index, cover] of allCovers.entries()) {
    guard(signal);
    const coverStage = '第 ' + (index+1) + '/' + allCovers.length + ' 张封面';
    progress(coverStage + '：打开编辑器（最多等待 60 秒）', 'cover-' + index + '-open');
    if (!(cover.blob instanceof Blob) || !cover.type.startsWith('image/')) throw new Error('封面素材不可用，请手动设置');
    const signature = () => index === 0 ? previewSignature() : pkCards()[index-1]?.querySelector<HTMLImageElement>('.pk-cover-list-card-img')?.src ?? '';
    const before = signature();
    const proofKey = `${index}:${cover.id}`;
    const ownedCover = !!before && coverProofs[proofKey] === before;
    let ratioMatches = true;
    if (ownedCover && index > 0) {
      const image = pkCards()[index-1]?.querySelector<HTMLImageElement>('.pk-cover-list-card-img');
      const bitmap = await createImageBitmap(cover.blob);
      ratioMatches = !!image?.naturalWidth && Math.abs(image.naturalWidth / image.naturalHeight - bitmap.width / bitmap.height) < 0.01;
      bitmap.close();
    }
    if (ownedCover && ratioMatches) {
      progress(coverStage + '：已核验保存结果，跳过重复上传', 'cover-' + index + '-confirm');
      coverResult = `${index+1} 张封面已核验保存`;
      continue;
    }
    if (index === 0) {
      const entry = document.querySelector<HTMLElement>(`${coverSelector} .cover-edit-entry`);
      if (!entry || document.querySelectorAll(`${coverSelector} .cover-edit-entry`).length !== 1) throw new Error('未找到唯一封面编辑入口，请手动设置');
      const existingModal = one<HTMLElement>('.cover-modal');
      if (!existingModal && !legacyCoverModal()) context.edit(() => entry.click());
    } else {
      // The PK panel is mounted asynchronously after the main cover editor closes.
      // Wait for the exact next slot or the enabled add control before deciding it is missing.
      const target = await waitFor(() => {
        const cards = pkCards();
        const card = cards[index-1];
        const entry = card?.querySelector<HTMLElement>('.pk-cover-list-edit-text');
        if (card && entry) return {kind:'card' as const, element:card};
        const add = one<HTMLButtonElement>('.pk-cover-list-add-btn');
        if (add && !add.disabled && cards.length === index-1) return {kind:'add' as const, element:add};
        return undefined;
      }, signal, 60000, false, coverStage + '：等待 PK 入口');
      if (target.kind === 'card') {
        const card = target.element;
        const entry = card.querySelector<HTMLElement>('.pk-cover-list-edit-text');
        if (!entry) throw new Error('未找到 PK 封面编辑入口');
        if (!ownedCover && !entry.getAttribute('data-impression')?.includes('系统推荐')) throw new Error('已有自定义 PK 封面，未覆盖，请手动检查');
        entry.click();
      } else {
        // Open the editor from the PK area first. The main cover editor is a fixed 4:3 slot.
        guard(signal); target.element.click();
      }
    }
    let modal = await waitFor(() => {
      const selectors = index === 0 ? ['.cover-modal'] : ['.pk-cover-list-editor-modal', '.cover-modal'];
      for (const selector of selectors) {
        const candidate = one<HTMLElement>(selector);
        if (candidate && (candidate.querySelector('.editor-panel') || /视频加载遇到问题|回退到旧版封面编辑弹窗/.test(candidate.innerText))) return candidate;
      }
      return legacyCoverModal();
    }, signal, 60000, false, coverStage + '：打开编辑器', visible => progress(coverStage + (visible ? '：打开编辑器（仅前台计时）' : '：页面在后台，切回小红书继续；计时已暂停'), 'cover-' + index + '-open'));
    if (!modal.innerText.includes('设置封面')) throw new Error('封面弹窗不匹配，已停止');
    // The current editor opens on its preview tab. Switch to the scoped edit
    // tab before looking for the image input; otherwise the hidden preview
    // video reports a misleading "video loading" message and no file input
    // is mounted.
    const editTab = [...modal.querySelectorAll<HTMLButtonElement>('.video-panel-switch-item')]
      .find(button => button.textContent?.trim() === '编辑');
    if (editTab && !editTab.classList.contains('active')) {
      guard(signal);
      context.edit(() => editTab.click());
      await waitFor(() => editTab.classList.contains('active'), signal, 10000, false, coverStage + '：切换编辑页签');
    }
    if (modal.matches('.cover-modal,.pk-cover-list-editor-modal')) {
      await waitFor(() => modal.querySelector('input[type="file"][aria-label="上传封面图片"]') || /视频加载遇到问题|回退到旧版封面编辑弹窗/.test(modal.innerText), signal, 15000, false, coverStage + '：等待新版编辑器');
      if (!modal.querySelector('input[type="file"][aria-label="上传封面图片"]')) {
        const fallback = [...modal.querySelectorAll<HTMLElement>('button,a,[role="button"]')].filter(visible).filter(e=>/^(回退到旧版|使用旧版|切换旧版)/.test(compactText(e.textContent ?? '')));
        if (fallback.length !== 1) throw new Error('新版封面不可用且未找到唯一旧版入口，请检查');
        progress(coverStage + '：新版不可用，回退旧版', 'cover-' + index + '-open');
        deferClick(context, fallback[0]!);
        modal = await waitFor(legacyCoverModal,signal,15000,false,'等待旧版封面编辑器');
      }
    }
    const legacyConfirm = !modal.matches('.cover-modal,.pk-cover-list-editor-modal') ? modal.querySelector<HTMLButtonElement>('.btn-confirm') : undefined;
    if (legacyConfirm) {
      // The legacy editor keeps its existing local cover list in the modal and
      // only mounts a file input after switching to “上传封面”. An existing
      // list alone is not proof that this run uploaded the requested asset;
      // fail closed until a new image is observed.
      let input = modal.querySelector<HTMLInputElement>('input[type="file"]');
      const existingImages = () => [...modal.querySelectorAll<HTMLImageElement>('img')]
        .filter(image => {
          const source = image.currentSrc || image.src;
          // The legacy editor uses three ordinary crop/preview <img> nodes
          // with a reused blob URL. They do not carry data-index; only count
          // loaded bitmap previews and exclude the empty SVG placeholder.
          return visible(image) && image.complete && image.naturalWidth &&
            /^(blob:|data:image\/(?!svg\+xml))/.test(source);
        });
      if (!input) {
        const uploadTab = [...modal.querySelectorAll<HTMLElement>('button,[role="tab"],[role="button"],span,div')]
          .find(element => visible(element) && compactText(element.textContent ?? '') === '上传封面');
        if (uploadTab) {
          guard(signal); deferClick(context, uploadTab);
          input = await waitFor(() => modal.querySelector<HTMLInputElement>('input[type="file"]'), signal, 10000, false, coverStage + '：打开旧版上传封面');
        }
      }
      if (input) {
        const previousImages = new Set(existingImages().map(image => image.currentSrc || image.src));
        const confirmWasEnabled = !legacyConfirm.disabled;
        const transfer = new DataTransfer(); transfer.items.add(new File([cover.blob], cover.name, {type:cover.type,lastModified:cover.lastModified}));
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new Event('change', {bubbles:true}));
        await waitFor(() => {
          if (/上传失败|格式不支持|上传出错/.test(modal.innerText)) return true;
          const newImage = existingImages().some(image => !previousImages.has(image.currentSrc || image.src));
          // The platform may reuse the same blob URL and clear the native
          // FileList after consuming it. An enabled confirm button plus a
          // loaded crop preview is the positive completion signal in that DOM.
          const consumed = !input!.files?.length && !confirmWasEnabled && !legacyConfirm.disabled && existingImages().length > 0;
          return newImage || consumed;
        }, signal, 120000, false, coverStage + '：等待旧版封面上传');
        if (/上传失败|格式不支持|上传出错/.test(modal.innerText)) throw new Error('封面上传失败，请手动处理');
      }
      if (!input) {
        throw new Error('第 ' + (index + 1) + ' 张封面处理未完成：旧版封面弹窗没有可用上传入口，需人工检查');
      }
      const matches = await Promise.all(existingImages().map(image=>imageMatchesAsset(image,cover,signal)));
      if (!matches.some(Boolean)) throw new Error('旧版封面预览与所选图片不一致，未保存');
      await waitFor(()=>!legacyConfirm.disabled && existingImages().length>0,signal,15000,false,'等待旧版封面确认');
      await selectCoverRatio(modal,cover,context);
      progress(coverStage + '：原图校验通过，确认保存', 'cover-' + index + '-confirm');
      guard(signal); deferClick(context, legacyConfirm);
      await waitFor(() => (!modal.isConnected || !visible(modal)) && signature() !== before && !!signature() && !/封面上传中/.test(document.querySelector(coverSelector)?.textContent ?? ''), signal,90000,false,coverStage + '：核验旧版保存结果');
      coverProofs[proofKey] = signature();
      coverResult = `${index+1} 张封面已核验保存（请检查裁剪）`;
      continue;
    }
    const inputs = modal.querySelectorAll<HTMLInputElement>('input[type="file"][aria-label="上传封面图片"]');
    if (inputs.length !== 1 || inputs[0]!.disabled || inputs[0]!.files?.length) throw new Error('封面入口存在歧义或已有素材，请手动设置');
    const panels = modal.querySelectorAll<HTMLElement>('.editor-panel');
    if (panels.length !== 1) throw new Error('无法确认封面裁剪预览，请手动处理');
    const panel = panels[0]!;
    // Settle the existing crop preview before attributing any change to our file.
    progress(coverStage + '：等待原预览就绪（最多等待 60 秒）', 'cover-' + index + '-baseline');
    let baseline = coverMedia(panel);
    let baselineSince = Date.now();
    const oldMedia = await waitFor(() => {
      if ([...panel.querySelectorAll('img')].some(img => !img.complete)) { baselineSince = Date.now(); return; }
      const current = coverMedia(panel);
      if (current !== baseline) { baseline = current; baselineSince = Date.now(); return; }
      return Date.now() - baselineSince >= 1000 ? current : undefined;
    }, signal, 60000, false, coverStage + '：原预览就绪', visible => progress(coverStage + (visible ? '：原预览就绪（仅前台计时）' : '：页面在后台，切回小红书继续；计时已暂停'), 'cover-' + index + '-baseline'));
    guard(signal);
    const expectedHash = new Uint8Array(await crypto.subtle.digest('SHA-256', await cover.blob.arrayBuffer())).toString();
    const checkedSources = new Set<string>();
    const retries = new Map<string, {count:number; after:number}>();
    const verifiedSources = new Set<string>();
    let newMedia = oldMedia;
    let stableSince = Date.now();
    guard(signal);
    const transfer = new DataTransfer(); transfer.items.add(new File([cover.blob], cover.name, {type:cover.type,lastModified:cover.lastModified}));
    inputs[0]!.files = transfer.files;
    inputs[0]!.dispatchEvent(new Event('input', {bubbles:true}));
    guard(signal); inputs[0]!.dispatchEvent(new Event('change', {bubbles:true}));
    // Only the scoped cover editor completion button is allowed. Never a page-wide confirm.
    progress(coverStage + '：上传并校验图片（最多等待 120 秒）', 'cover-' + index + '-upload');
    const button = await waitFor(() => {
      if (!modal.isConnected) throw new Error('封面弹窗提前关闭，结果未确认');
      if (/上传失败|格式不支持|上传出错/.test(modal.innerText)) throw new Error('封面上传失败，请手动处理');
      if (/上传中|处理中/.test(modal.innerText) || modal.querySelector('[aria-busy="true"]')) return;
      // Require exact original bytes, including the platform's uploaded-image thumbnail.
      // Unrelated thumbnails and late old-canvas initialization cannot satisfy this check.
      for (const img of panel.querySelectorAll('img')) {
        const src = img.currentSrc || img.src;
        const uploadedThumbnail = img.matches('.uploaded-thumbnail-img') && src.startsWith('https://ros-preview.xhscdn.com/');
        if (!visible(img) || !img.complete || !img.naturalWidth || (!/^(blob:|data:image\/)/.test(src) && !uploadedThumbnail) || checkedSources.has(src)) continue;
        const retry = retries.get(src);
        if (retry && (retry.count >= 3 || Date.now() < retry.after)) continue;
        checkedSources.add(src);
        retries.set(src, {count:(retry?.count ?? 0)+1, after:Date.now()+2000});
        void (async () => {
          try {
            const response = await fetch(src, {signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]), credentials:'omit'});
            if (!response.ok) throw new Error('封面预览请求失败');
            const blob = await response.blob();
            if (blob.size !== cover.blob.size) return;
            const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())).toString();
            if (!signal.aborted && hash === expectedHash) verifiedSources.add(src);
          } catch { checkedSources.delete(src); /* Retry transient reads, never upload the file again. */ }
        })();
      }
      if (![...panel.querySelectorAll('img')].some(img => visible(img) && img.complete && verifiedSources.has(img.currentSrc || img.src))) return;
      const media = coverMedia(panel);
      if (media === oldMedia || media === '[]') { stableSince = Date.now(); return; }
      if (media !== newMedia) { newMedia = media; stableSince = Date.now(); return; }
      if (Date.now() - stableSince < 500) return;
      const buttons = [...modal.querySelectorAll<HTMLButtonElement>('.bottom-content button')].filter(b=>b.textContent?.trim()==='完成' && visible(b));
      if (buttons.length !== 1) throw new Error('无法确认封面完成按钮，请手动处理');
      return buttons[0]!.disabled ? undefined : buttons[0];
    }, signal, 120000, false, coverStage + '：上传与原图校验', visible => progress(coverStage + (visible ? '：上传与原图校验（仅前台计时）' : '：页面在后台，切回小红书继续；计时已暂停'), 'cover-' + index + '-upload'));
    await selectCoverRatio(modal,cover,context);
    progress(coverStage + '：确认保存结果（最多等待 90 秒）', 'cover-' + index + '-confirm');
    guard(signal); deferClick(context, button);
    await waitFor(() => (!modal.isConnected || !visible(modal)) && signature() !== before && !!signature(), signal, 90000, false, coverStage + '：确认保存结果', visible => progress(coverStage + (visible ? '：确认保存结果（仅前台计时）' : '：页面在后台，切回小红书继续；计时已暂停'), 'cover-' + index + '-confirm'));
    coverProofs[proofKey] = signature();
    coverResult = `${index+1} 张封面预览已更新（请检查裁剪）`;
  }
  guard(signal); verifyCopy();
  return `标题、正文已回读核验；${declarationNote}${collectionNote}${scheduleNote ? scheduleNote + '；' : ''}${coverResult}；${coverPk === undefined ? "" : coverPk ? "PK 已开启" : "PK 已关闭"}。${publication.tags.length ? '已填写 #标签 文本，平台话题候选需你确认。' : ''}请检查后手动发布；未发布、未存草稿。`;
}
