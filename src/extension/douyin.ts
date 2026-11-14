import type {Asset} from '../core/model';
import {inspectCover, type CoverRatio} from '../core/covers';
import {normalizeDouyinPublication,publicationBody,type Publication} from '../core/publication';
import {waitFor,type FillContext} from './xiaohongshu';
import {declarationVisible, ensureChecked, findDeclarationControl, findDeclarationText} from './declarations';
const titleSelector='input[placeholder="填写作品标题，为作品获得更多流量"]';
const bodySelector='[data-slate-editor="true"][contenteditable="true"]';
const visible=(e:Element)=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
function one<T extends Element>(selector:string,root:ParentNode=document):T|undefined{
 const matches=[...root.querySelectorAll<T>(selector)].filter(visible);
 if(matches.length>1)throw new Error('抖音控件存在歧义，已停止');return matches[0];
}
function copyText(e:HTMLElement){const lines=[...e.querySelectorAll('[data-line-wrapper="true"]')];return (lines.length?lines.map(line=>line.textContent??'').join('\n'):e.innerText).replace(/[\u200b\ufeff]/g,'').replace(/\r\n/g,'\n').replace(/\n+$/,'');}
function card(ratio:CoverRatio){return [...document.querySelectorAll<HTMLElement>('[class^="coverControl-"]')].find(e=>e.innerText.includes(ratio==='4:3'?'横封面4:3':'竖封面3:4'));}
function compactText(value:string){return value.replace(/\s+/gu,' ').trim();}
function leafText(root:ParentNode, expected:string):HTMLElement[] {
 const text=compactText(expected);
 return [...root.querySelectorAll<HTMLElement>('input,button,[role="option"],[role="button"],[role="combobox"],li,div,span')]
  .filter(element=>visible(element)&&compactText(element instanceof HTMLInputElement ? element.value : element.textContent??'')===text)
  .filter(element=>![...element.children].some(child=>compactText(child.textContent??'')===text));
}
function douyinCollectionTrigger():HTMLElement|undefined {
 const inputs=[...document.querySelectorAll<HTMLInputElement>('input[placeholder="请选择合集"],input[aria-label="请选择合集"]')].filter(visible);
 if(inputs.length>1)throw new Error('抖音合集控件不唯一，已停止');
 if(inputs[0])return inputs[0];
 const matches=leafText(document,'请选择合集');
 if(matches.length>1)throw new Error('抖音合集控件不唯一，已停止');
 return matches[0];
}
function douyinCollectionOption(name:string):HTMLElement|undefined {
 const all=leafText(document,name).filter(element=>!(element instanceof HTMLInputElement));
 const structured=all.filter(element=>element.matches('[role="option"],[role="menuitem"],li,[class*="option"],[class*="Option"],[class*="item"],[class*="Item"]'));
 const matches=structured.length?structured:all;
 if(matches.length>1)throw new Error('抖音同名合集不唯一，已停止');
 return matches[0];
}
function douyinCollectionSelected(trigger:HTMLElement,name:string):boolean {
 const expected=compactText(name);
 if(trigger instanceof HTMLInputElement)return compactText(trigger.value)===expected;
 const scope=trigger.closest<HTMLElement>('[role="combobox"],[role="button"],button') ?? trigger.parentElement;
 return compactText(trigger.textContent??'')===expected || (!!scope && compactText(scope.textContent??'').includes(expected) && !compactText(scope.textContent??'').includes('请选择合集'));
}
function setDouyinInput(input: HTMLInputElement, value: string) {
 const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
 if(!setter)throw new Error('无法设置抖音定时发布时间');
 setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
}
type DouyinWait = <T>(read:()=>T|undefined|false,stage:string,label:string,timeout?:number,deferred?:boolean)=>Promise<T>;
async function setDouyinSchedule(scheduleAt:string, wait:DouyinWait, ctx:FillContext):Promise<string>{
 const [date,time]=scheduleAt.split('T');
 if(!date||!time)throw new Error('定时发布时间格式无效，请重新选择时间');
 const {signal,progress}=ctx;
 const scheduled=[...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter(visible).find(input=>input.value==='1' && /定时发布/.test(input.parentElement?.parentElement?.textContent??''));
 if(!scheduled)return '抖音编辑页没有定时控件，已跳过定时设置；';
 progress('正在设置抖音定时发布时间','schedule');
 const wasEnabled=scheduled.checked;
 if(!wasEnabled){ctx.edit(()=>scheduled.click());await wait(()=>scheduled.checked,'schedule','核验抖音定时发布开关',10000,true);}
 const datetime=await wait(()=>one<HTMLInputElement>('input.semi-input[placeholder="日期和时间"],.semi-datepicker input[placeholder="日期和时间"]'),'schedule','等待抖音定时日期和时间控件',10000);
 const display=scheduleAt.replace('T',' ');
 if(wasEnabled && datetime.value && datetime.value!==scheduleAt && datetime.value!==display)throw new Error('抖音编辑页已有不同的定时发布时间，未覆盖，请手动检查');
 ctx.edit(()=>setDouyinInput(datetime,display));
 await wait(()=>datetime.value===scheduleAt || datetime.value===display,'schedule','核验抖音定时发布时间',10000,true);
 return `已设置并回读抖音定时发布时间 ${display}；请检查后手动发布。`;
}

/** Select an existing Douyin collection by exact visible name and verify the trigger changed. */
export async function selectDouyinCollection(name:string, wait:<T>(read:()=>T|undefined|false,stage:string,label:string,timeout?:number,deferred?:boolean)=>Promise<T>, ctx:FillContext):Promise<string> {
 const expected=name.trim();
 if(!expected)return '';
 const trigger=await wait(()=>douyinCollectionTrigger(),'collection','等待抖音合集控件',30000);
 ctx.edit(()=>trigger.click());
 const option=await wait(()=>douyinCollectionOption(expected),'collection','等待抖音同名合集',30000);
 ctx.edit(()=>option.click());
 await wait(()=>douyinCollectionSelected(trigger,expected) || (()=>{const current=douyinCollectionTrigger();return !!current&&douyinCollectionSelected(current,expected);})(),'collection','核验抖音合集选择',30000,true);
 return `已选择抖音合集“${expected}”；`;
}
function sample(source:CanvasImageSource):Uint8ClampedArray{
 const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
 const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,32,32);return ctx.getImageData(0,0,32,32).data;
}
export function similarPreview(actual:Uint8ClampedArray,expected:Uint8ClampedArray):boolean{
 if(actual.length!==expected.length||!actual.length)return false;
 let diff=0;for(let i=0;i<actual.length;i++)diff+=Math.abs(actual[i]!-expected[i]!);
 return diff/actual.length<4;
}
export async function fillDouyin(value:Publication,cover:Asset|undefined,ctx:FillContext,otherCovers:Asset[]=[]):Promise<string>{
 const publication=normalizeDouyinPublication(value),{signal,progress}=ctx;
 const guard=()=>{if(signal.aborted)throw new Error('操作已停止');};
 const wait=<T>(read:()=>T|undefined|false,stage:string,label:string,timeout=60000,deferred=false)=>waitFor(read,signal,timeout,deferred,label,shown=>progress(shown?label+'（仅前台计时）':'页面在后台，切回抖音继续；计时已暂停',stage));
 const fields=await wait(()=>{
  if(/上传失败|视频处理失败/.test(document.body.innerText))throw new Error('抖音报告视频上传失败');
  const title=one<HTMLInputElement>(titleSelector),body=one<HTMLElement>(bodySelector);
  // The page footer always mentions 上传中. Use the actual reupload control and editor readiness.
  const reupload=[...document.querySelectorAll('label,button,div')].some(e=>e.children.length===0&&e.textContent==='重新上传'&&visible(e));
  return title&&body&&reupload&&card('4:3')&&card('3:4')?{title,body}:undefined;
 },'upload','等待抖音编辑页和视频就绪',600000);
 guard();if(fields.title.value.trim()||copyText(fields.body).trim())throw new Error('抖音编辑页已有文案，未覆盖，请手动检查');
 progress('填写抖音标题、作品简介和标签','copy');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(fields.title,publication.title);
 fields.title.dispatchEvent(new Event('input',{bubbles:true}));fields.title.dispatchEvent(new Event('change',{bubbles:true}));
 const body=publicationBody(publication);
 if(body){
  fields.body.focus();
  ctx.edit(()=>{
   const data=new DataTransfer();data.setData('text/plain',body);
   const accepted=!fields.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
   if(!accepted)throw new Error('抖音简介编辑器未接收粘贴，已停止');
  });
 }

 const verify=()=>{if(!fields.title.isConnected||!fields.body.isConnected||fields.title.value!==publication.title||copyText(fields.body)!==body.replace(/\n+$/,''))throw new Error('抖音文案回读不一致，不会重复填写');return true;};
 await wait(verify,'copy','核验抖音文案',30000,true);
 let declarationNote='';
 const originalControl=findDeclarationControl(document,['声明原创','原创视频']);
 if(originalControl){let checked=false;ctx.edit(()=>{checked=ensureChecked(originalControl);});if(checked) declarationNote+='已勾选原创声明；';}
 const declarationEntry=findDeclarationText(document,['请选择自主声明','请选择声明类型','添加自主声明','自主声明','作品声明']);
 if(declarationEntry){
  progress('正在设置抖音 AI 生成声明','declaration');
  try{
   ctx.edit(()=>declarationEntry.click());
   const dialog=await wait(()=>[...document.querySelectorAll<HTMLElement>('.semi-modal-content,.semi-modal-body')].find(element=>declarationVisible(element)&&/请选择声明类型/.test(element.textContent??'')),'declaration','等待抖音声明选项',10000);
   const option=findDeclarationText(dialog,['内容由AI生成','内容由 AI 生成']);
   if(!option)throw new Error('未找到 AI 生成声明选项');
   ctx.edit(()=>option.click());
   const confirm=[...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button=>declarationVisible(button)&&button.textContent?.trim()==='确定'&&!button.disabled);
   if(confirm)ctx.edit(()=>confirm.click());
   declarationNote+='已选择 AI 生成声明；';
  }catch{declarationNote+='AI 生成声明未确认，请手动检查；';}
 }
 let collectionNote='';
 if(publication.collection){
  progress('正在选择抖音合集','collection');
  collectionNote=await selectDouyinCollection(publication.collection,wait,ctx);
 }
 let scheduleNote='';
 if(publication.scheduleAt) scheduleNote=await setDouyinSchedule(publication.scheduleAt,wait,ctx);
 const selected:{asset:Asset;ratio:CoverRatio}[]=[];
 for(const asset of cover?[cover,...otherCovers]:[]){const ratio=await inspectCover(asset.blob);if(!selected.some(c=>c.ratio===ratio))selected.push({asset,ratio});}
 const signatures=new Map(selected.map(({ratio})=>[ratio,card(ratio)?.querySelector('img')?.src??'']));
 let modal:HTMLElement|undefined;
 for(const [index,{asset,ratio}] of selected.entries()){
  const stage=(part:string)=>`cover-${index}-${part}`,label=`${ratio==='4:3'?'横':'竖'}封面 ${ratio}`;
  guard();progress(label+'：打开编辑器',stage('open'));
  if(!modal){
   const entry=card(ratio)?.querySelector<HTMLElement>('[class^="cover-"]');if(!entry)throw new Error('未找到抖音封面入口');entry.click();
   modal=await wait(()=>one<HTMLElement>('.dy-creator-content-modal-body'),'cover-'+index+'-open',label+'：打开编辑器');
  }
  const tabText=ratio==='4:3'?'设置横封面':'设置竖封面';
  const tabs=[...modal.querySelectorAll<HTMLElement>('[class^="step-"]')].filter(e=>e.textContent===tabText&&visible(e));
  if(tabs.length===1)tabs[0]!.click();
  else if(tabs.length!==0||one<HTMLElement>('[class^="single-title-"]',modal)?.textContent!==tabText)throw new Error('抖音封面比例标签不唯一');
  const input=await wait(()=>{
   const inputs=modal!.querySelectorAll<HTMLInputElement>('[class*="upload-tips-"] + .semi-upload input.semi-upload-hidden-input');
   if(inputs.length>1)throw new Error('抖音封面上传入口不唯一');return inputs[0];
  },stage('baseline'),label+'：等待上传入口');
  const before=new Set([...modal.querySelectorAll<HTMLImageElement>('[class^="notImg-"] img')].map(i=>i.src));
  const sourceUrl=URL.createObjectURL(asset.blob);const source=new Image();source.src=sourceUrl;
  let expected:Uint8ClampedArray,width:number,height:number;
  try{await source.decode();expected=sample(source);width=source.naturalWidth;height=source.naturalHeight;}finally{URL.revokeObjectURL(sourceUrl);}
  guard();const transfer=new DataTransfer();transfer.items.add(new File([asset.blob],asset.name,{type:asset.type,lastModified:asset.lastModified}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  let stableSrc='',stableAt=0;
  await wait(()=>{
   modal=one<HTMLElement>('.dy-creator-content-modal-body')??modal;
   const previews=modal!.querySelectorAll<HTMLImageElement>('[class^="notImg-"] img');
   if(previews.length>1)throw new Error('抖音原图预览不唯一');
   const img=previews[0];
   if(!img?.complete||img.naturalWidth!==width||img.naturalHeight!==height||before.has(img.src)){progress(label+`：等待原图（当前 ${img?.naturalWidth??0}×${img?.naturalHeight??0}，目标 ${width}×${height}）`,stage('upload'));return;}
   // Douyin converts the source to JPEG. Compare decoded thumbnails with bounded compression tolerance.
   if(!similarPreview(sample(img),expected))return;
   if(stableSrc!==img.src){stableSrc=img.src;stableAt=Date.now();return;}
   return Date.now()-stableAt>=500;
  },stage('upload'),label+'：上传并核验图片',120000);
  progress(label+'：编辑器图片已核验，等待应用',stage('confirm'));
 if(modal){
  guard();const buttons=[...modal.querySelectorAll<HTMLButtonElement>('button')].filter(e=>e.textContent?.trim()==='完成'&&!e.disabled&&visible(e));
  if(buttons.length!==1)throw new Error('抖音封面完成按钮不唯一');buttons[0]!.click();
  let dismissed=false;
  await wait(()=>{
   const prompt=one<HTMLElement>('[class*="verticalSupoortDualCoverModal-"]');
   if(prompt&&!dismissed&&prompt.innerText.includes('设置竖封面获更多流量')){
    const skip=[...prompt.querySelectorAll<HTMLButtonElement>('button')].find(e=>e.textContent==='暂不设置');
    if(skip){dismissed=true;skip.click();}return;
   }
   return (!modal!.isConnected||!visible(modal!))&&(()=>{const img=card(ratio)?.querySelector('img');return img?.complete&&img.naturalWidth>0&&img.src!==signatures.get(ratio);})();
  },stage('confirm'),'确认抖音封面已应用',90000,true);
  modal=undefined;
 }
 }
 guard();verify();return `抖音标题、简介已回读核验；${declarationNote}${collectionNote}${scheduleNote}${selected.length?`${selected.length} 张横/竖封面已更新，请检查裁剪`:'保留平台默认封面'}。标签为 #文本，请检查平台话题。未发布、未存草稿。`;
}
