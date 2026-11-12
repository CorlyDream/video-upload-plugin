import { publicationBody, type Publication } from '../core/publication';
import type { Asset } from '../core/model';

export interface FillContext { signal: AbortSignal; progress: (reason: string, stage?: string) => void; edit: (action: () => void) => void }
const titleSelector = 'input[placeholder="填写标题会有更多赞哦"]';
const bodySelector = '.tiptap.ProseMirror[contenteditable="true"]';
const coverSelector = '.cover-plugin-preview';
const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
function one<T extends Element>(selector: string, root: ParentNode = document): T | undefined {
  const matches = [...root.querySelectorAll<T>(selector)].filter(visible);
  if (matches.length > 1) throw new Error('发现多个填写控件，已停止以保护原稿');
  return matches[0];
}
function guard(signal: AbortSignal) { if (signal.aborted) throw new Error('操作已停止'); }
export function waitFor<T>(read: () => T | undefined | false, signal: AbortSignal, timeout = 30000, deferred = false, stage = '页面确认', onVisibility?: (visible:boolean)=>void): Promise<T> {
  guard(signal);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setInterval>;
    let remaining = timeout;
    let lastTick = Date.now();
    let wasVisible = !onVisibility || document.visibilityState === 'visible';
    let announced: boolean | undefined;
    const clean = () => { clearInterval(timer); signal.removeEventListener('abort', abort); if(onVisibility)document.removeEventListener('visibilitychange',inspect); };
    const abort = () => { clean(); reject(new Error('操作已停止')); };
    const inspect = () => {
      try {
        guard(signal);
        const now = Date.now();
        if(wasVisible)remaining -= now-lastTick;
        lastTick=now;
        wasVisible=!onVisibility || document.visibilityState === 'visible';
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
    if (!title || !body || !preview || preview.getAttribute('aria-busy') !== 'false') return;
    return {title, body};
  }, signal, 10 * 60 * 1000, false, '视频上传与处理');
  guard(signal);
  if (fields.title.value.trim() || fields.body.textContent?.trim()) throw new Error('编辑页已有文案，未覆盖，请手动检查');
  progress('平台上传已完成，正在填写标题和正文','copy');
  if (publication.title) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(fields.title, publication.title);
    fields.title.dispatchEvent(new Event('input', {bubbles:true}));
    fields.title.dispatchEvent(new Event('change', {bubbles:true}));
  }
  guard(signal);
  const bodyText = publicationBody(publication);
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
  const verifyCopy = () => {
    if (!fields.title.isConnected || !fields.body.isConnected || fields.title.value !== publication.title || editorText(fields.body) !== bodyText.replace(/\n+$/, '')) throw new Error('标题或正文回读不一致，请检查页面，不会重复填写');
  };
  // Separate a browser event turn so framework rerenders cannot be mistaken for acceptance.
  await waitFor(() => { verifyCopy(); return true; }, signal, 30000, true);
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
    if (index === 0) {
      const entry = document.querySelector<HTMLElement>(`${coverSelector} .cover-edit-entry`);
      if (!entry || document.querySelectorAll(`${coverSelector} .cover-edit-entry`).length !== 1) throw new Error('未找到唯一封面编辑入口，请手动设置');
      entry.click();
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
        if (!entry?.getAttribute('data-impression')?.includes('系统推荐')) throw new Error('已有自定义 PK 封面，未覆盖，请手动检查');
        entry.click();
      } else {
        // Open the editor from the PK area first. The main cover editor is a fixed 4:3 slot.
        guard(signal); target.element.click();
      }
    }
    const modal = await waitFor(() => {
      const selectors = index === 0 ? ['.cover-modal'] : ['.pk-cover-list-editor-modal', '.cover-modal'];
      for (const selector of selectors) {
        const candidate = one<HTMLElement>(selector);
        if (candidate?.querySelector('input[type="file"][aria-label="上传封面图片"]') && candidate.querySelector('.editor-panel')) return candidate;
      }
      return undefined;
    }, signal, 60000, false, coverStage + '：打开编辑器', visible => progress(coverStage + (visible ? '：打开编辑器（仅前台计时）' : '：页面在后台，切回小红书继续；计时已暂停'), 'cover-' + index + '-open'));
    if (!modal.innerText.includes('设置封面')) throw new Error('封面弹窗不匹配，已停止');
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
    progress(coverStage + '：确认保存结果（最多等待 90 秒）', 'cover-' + index + '-confirm');
    guard(signal); button.click();
    await waitFor(() => (!modal.isConnected || !visible(modal)) && signature() !== before && !!signature(), signal, 90000, false, coverStage + '：确认保存结果', visible => progress(coverStage + (visible ? '：确认保存结果（仅前台计时）' : '：页面在后台，切回小红书继续；计时已暂停'), 'cover-' + index + '-confirm'));
    coverResult = `${index+1} 张封面预览已更新（请检查裁剪）`;
  }
  guard(signal); verifyCopy();
  return `标题、正文已回读核验；${coverResult}；${coverPk === undefined ? "" : coverPk ? "PK 已开启" : "PK 已关闭"}。${publication.tags.length ? '已填写 #标签 文本，平台话题候选需你确认。' : ''}请检查后手动发布；未发布、未存草稿。`;
}
