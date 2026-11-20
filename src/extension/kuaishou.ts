import {kuaishouDescription, type Publication} from '../core/publication';
import type {Asset} from '../core/model';
import {waitFor, type FillContext} from './xiaohongshu';
import {checkedState, declarationDisabled, ensureChecked, findDeclarationControl, selectAiDeclaration} from './declarations';

const rootSelector = '[class^="_high-cover-editor_"]';
const visible = (e:Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
function one<T extends Element>(selector:string, root:ParentNode=document):T|undefined {
  const matches=[...root.querySelectorAll<T>(selector)].filter(visible);
  if(matches.length>1)throw new Error('快手控件存在歧义，已停止以保护原稿');
  return matches[0];
}
function guard(signal:AbortSignal){if(signal.aborted)throw new Error('操作已停止');}
function pixels(canvas:HTMLCanvasElement):Uint8ClampedArray {
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('无法读取封面预览');
  return ctx.getImageData(0,0,canvas.width,canvas.height).data;
}
function closeToExpected(actual:HTMLCanvasElement, expected:HTMLCanvasElement):boolean {
  if (!actual.width || !actual.height) return false;
  const source = expected.getContext('2d',{willReadFrequently:true});
  const target = actual.getContext('2d',{willReadFrequently:true});
  if (!source || !target) return false;
  const resized = document.createElement('canvas'); resized.width=actual.width; resized.height=actual.height;
  resized.getContext('2d')!.drawImage(expected,0,0,resized.width,resized.height);
  const a=target.getImageData(0,0,actual.width,actual.height).data;
  const b=resized.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,resized.width,resized.height).data;
  if(a.length!==b.length)return false;
  let total=0;for(let i=0;i<a.length;i+=4)total+=Math.abs((a[i]??0)-(b[i]??0))+Math.abs((a[i+1]??0)-(b[i+1]??0))+Math.abs((a[i+2]??0)-(b[i+2]??0));
  return total/(a.length/4*3)<=24;
}
type KuaishouWait = <T>(read:()=>T|undefined|false,stage:string,label:string,timeout?:number,deferred?:boolean)=>Promise<T>;
function setKuaishouInput(input: HTMLInputElement, value: string) {
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  if(!setter)throw new Error('无法设置快手定时发布时间');
  setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
}
async function setKuaishouSchedule(scheduleAt:string, wait:KuaishouWait, context:FillContext):Promise<string>{
  const [date,time]=scheduleAt.split('T');
  if(!date||!time)throw new Error('定时发布时间格式无效，请重新选择时间');
  const radios=[...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(visible);
  const scheduled=radios.find(input=>/定时发布/.test(input.closest('label,div')?.textContent??'') && input.value==='2') ?? radios.find(input=>input.value==='2');
  if(!scheduled)return '快手编辑页没有定时控件，已跳过定时设置；';
  context.progress('正在设置快手定时发布时间','schedule');
  const wasEnabled=scheduled.checked;
  if(!wasEnabled){context.edit(()=>scheduled.click());await wait(()=>scheduled.checked,'schedule','核验快手定时发布开关',10000,true);}
  const input=await wait(()=>[...document.querySelectorAll<HTMLInputElement>('input')].filter(visible).find(element=>element!==scheduled && (/日期|时间/.test(`${element.placeholder} ${element.getAttribute('aria-label')??''}`)||/^\d{4}-\d{2}-\d{2}/.test(element.value))), 'schedule','等待快手定时日期和时间控件',10000);
  const display=scheduleAt.replace('T',' ');
  if(wasEnabled && input.value && input.value!==scheduleAt && input.value!==display)throw new Error('快手编辑页已有不同的定时发布时间，未覆盖，请手动检查');
  context.edit(()=>setKuaishouInput(input,display));
  await wait(()=>input.value===scheduleAt || input.value===display,'schedule','核验快手定时发布时间',10000,true);
  return `已设置并回读快手定时发布时间 ${display}；请检查后手动发布。`;
}
export async function fillKuaishou(publication:Publication, cover:Asset|undefined, context:FillContext, pkCovers:Asset[]=[], coverPk?:boolean):Promise<string>{
  const {signal,progress}=context;
  const wait=<T>(read:()=>T|undefined|false, stage:string, label:string, timeout=60000, deferred=false)=>waitFor(read,signal,timeout,deferred,label,
    shown=>progress(shown?label+'（仅前台计时）':'页面在后台，切回快手继续；计时已暂停',stage));
  const fields=await wait(()=>{
    const text=document.body.innerText;
    if(/上传失败|上传出错|视频处理失败/.test(text))throw new Error('快手报告视频上传或处理失败，未填写');
    if(/上传中|处理中|转码中/.test(text)||!text.includes('重新上传'))return;
    const editor=one<HTMLElement>('#work-description-edit[contenteditable="true"]');
    const covers=one<HTMLElement>(rootSelector);
    return editor&&covers?{editor,covers}:undefined;
  },'upload','等待快手视频上传与处理',600000);
  guard(signal);
  const copy=kuaishouDescription(publication);
  const existingCopy=fields.editor.innerText.replace(/\r\n/g,'\n').replace(/\n+$/,'');
  const copyAlreadyMatches=existingCopy===copy;
  if(existingCopy&&!copyAlreadyMatches)throw new Error('快手编辑页已有不同文案，未覆盖，请手动检查');
  if(!copyAlreadyMatches){
    progress('正在填写作品描述：标题和前 4 个标签','copy');
    if(copy){
      fields.editor.focus();
      context.edit(()=>{if(!document.execCommand('insertText',false,copy))throw new Error('快手作品描述不接受自动输入，请手动检查');});
      fields.editor.dispatchEvent(new Event('input',{bubbles:true}));
    }
  } else progress('快手作品描述已存在且回读一致，继续后续步骤','copy');
  const verifyCopy=()=>{
    if(!fields.editor.isConnected||fields.editor.innerText.replace(/\r\n/g,'\n').replace(/\n+$/,'')!==copy)throw new Error('快手作品描述回读不一致，已停止，不会重复填写');
    return true;
  };
  await wait(verifyCopy,'copy','核验快手作品描述',30000,true);
  let declarationNote='';
  const originalLabels=['原创声明','声明原创','原创视频'];
  const originalControl=findDeclarationControl(document,originalLabels);
  if(originalControl && !declarationDisabled(originalControl)){
    context.edit(()=>ensureChecked(originalControl));
    await wait(()=>checkedState(findDeclarationControl(document,originalLabels)??originalControl)===true,'declaration','核验快手原创声明',10000,true);
    declarationNote+='已勾选原创声明；';
  }else if(originalControl){
    declarationNote+=checkedState(originalControl)===true?'已勾选原创声明；':'原创声明未确认，请手动检查；';
  }
  progress('正在设置快手 AI 生成声明','declaration');
  try{
    declarationNote+=await selectAiDeclaration(['作者声明','选择视频标注','选择内容标注','添加内容声明','作品声明'],['内容为AI生成','含AI生成内容','内容由AI生成','AI生成'],context.edit,
      (read,label,deferred)=>wait(read,'declaration',label,10000,deferred));
  }catch{
    guard(signal);
    declarationNote+='AI 生成声明未确认，请手动检查；';
  }
  let scheduleNote='';
  if(publication.scheduleAt) scheduleNote=await setKuaishouSchedule(publication.scheduleAt,wait,context);
  if(coverPk!==undefined){
    guard(signal);progress(coverPk?'正在开启封面 PK':'正在关闭封面 PK','pk');
    const toggle=one<HTMLButtonElement>('[role="switch"]',fields.covers);
    if(!toggle||toggle.disabled||!['true','false'].includes(toggle.getAttribute('aria-checked')??''))throw new Error('无法确认快手封面 PK 开关');
    if((toggle.getAttribute('aria-checked')==='true')!==coverPk)toggle.click();
    await wait(()=>toggle.isConnected&&toggle.getAttribute('aria-checked')===String(coverPk),'pk','确认封面 PK 开关',30000,true);
  }
  // The current Kuaishou editor has exactly one main cover and one PK candidate.
  const covers=cover?[cover,...(coverPk?pkCovers.slice(0,1):[])]:[];
  for(const [index,asset] of covers.entries()){
    guard(signal);
    const label=`第 ${index+1}/${covers.length} 张封面`;
    const stage=(part:string)=>`cover-${index}-${part}`;
    if(!(asset.blob instanceof Blob)||!asset.type.startsWith('image/'))throw new Error('封面素材不可用');
    const slot=index?'[class^="_pk-cover_"]':'[class^="_default-cover_"]';
    const image=()=>one<HTMLImageElement>(slot+' img',fields.covers);
    const before=image()?.src??'';
    if(index&&before)throw new Error('快手已有 PK 封面，未覆盖，请手动检查');
    const entry=one<HTMLElement>(index?'[class^="_pk-upload_"]':slot+' [class^="_cover-full-editor_"]',fields.covers);
    if(!entry)throw new Error('未找到唯一快手封面编辑入口');
    progress(label+'：打开编辑器',stage('open'));entry.click();
    const modal=await wait(()=>one<HTMLElement>('.ant-modal'),'cover-'+index+'-open',label+'：打开编辑器');
    const tabs=[...modal.querySelectorAll<HTMLElement>('[class^="_header-title-item_"]')].filter(e=>e.textContent?.trim()==='上传封面'&&visible(e));
    if(tabs.length!==1||!modal.innerText.includes('封面截取'))throw new Error('快手封面弹窗不匹配');
    guard(signal);tabs[0]!.click();
    const input=await wait(()=>{
      // Kuaishou intentionally hides this native input behind the upload dropzone.
      const inputs=modal.querySelectorAll<HTMLInputElement>('input[type="file"][accept*="image"]');
      if(inputs.length>1)throw new Error('快手封面上传入口不唯一');
      return inputs[0];
    },stage('baseline'),label+'：等待上传入口就绪');
    if(input.disabled||input.files?.length)throw new Error('快手封面上传入口已有文件，未覆盖');
    const bitmap=await createImageBitmap(asset.blob);
    const expected=document.createElement('canvas');expected.width=bitmap.width;expected.height=bitmap.height;
    expected.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();
    guard(signal);
    const transfer=new DataTransfer();transfer.items.add(new File([asset.blob],asset.name,{type:asset.type,lastModified:asset.lastModified}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    const confirm=await wait(()=>{
      if(!modal.isConnected||!visible(modal))throw new Error('快手封面弹窗提前关闭，结果未确认');
      if(/上传失败|上传出错|格式不支持/.test(modal.innerText))throw new Error('快手封面上传失败，请手动检查');
      const canvas=one<HTMLCanvasElement>('canvas[class^="_cutter-raw_"]',modal);
      if(!canvas||!closeToExpected(canvas,expected))return;
      const buttons=[...modal.querySelectorAll<HTMLButtonElement>('button')].filter(b=>visible(b)&&b.textContent?.trim()==='确认'&&!b.disabled);
      return buttons.length===1?buttons[0]:undefined;
    },stage('upload'),label+'：上传与校验原图',120000);
    guard(signal);progress(label+'：确认封面结果',stage('confirm'));confirm.click();
    await wait(()=>{
      const img=image();
      return (!modal.isConnected||!visible(modal))&&img?.complete&&img.naturalWidth>0&&img.src!==before;
    },stage('confirm'),label+'：确认封面结果',90000,true);
  }
  guard(signal);verifyCopy();
  return `作品描述已回读核验（标题 + 前 4 个标签，不含正文）；${declarationNote}${scheduleNote}${covers.length?`${covers.length} 张封面预览已更新（请检查裁剪）`:'保留平台默认封面'}；${coverPk?'PK 已开启。':''}标签为 #文本，请检查平台话题。未发布、未存草稿。`;
}
