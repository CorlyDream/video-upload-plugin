import type {PlatformId} from '../core/model';
import {waitFor,type FillContext} from './xiaohongshu';
const visible=(element:Element)=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
/** Only act on download controls observed on the platform, never generic visibility options. */
export async function disableDownloads(platform:PlatformId,ctx:FillContext):Promise<{verified:boolean;message:string}>{
 const {signal,progress}=ctx;
 progress('设置并核验不允许他人下载/保存','downloads');
 await waitFor(()=>true,signal,30000,false,'下载权限',shown=>progress(shown?'设置并核验不允许他人下载/保存':'页面在后台，切回平台继续；计时已暂停','downloads'));
 const read=()=>{
  const inputs=platform==='kuaishou'
   ? [...document.querySelectorAll<HTMLLabelElement>('label')].filter(e=>visible(e)&&e.textContent?.trim()==='允许下载此作品').flatMap(e=>[...e.querySelectorAll<HTMLInputElement>('input[type="checkbox"][value="downloadType"]')])
   : platform==='douyin'
    ? [...document.querySelectorAll<HTMLLabelElement>('[class^="download-content-"] label')].filter(e=>visible(e)&&e.textContent?.trim()==='不允许').flatMap(e=>[...e.querySelectorAll<HTMLInputElement>('input[type="checkbox"][value="0"]')])
    : [];
  if(inputs.length>1)throw new Error('下载/保存权限控件不唯一，已停止；请手动检查');
  return inputs[0];
 };
 if(platform==='kuaishou'||platform==='douyin')await waitFor(()=>read()||document.querySelector(platform==='kuaishou'?'#work-description-edit':'[data-slate-editor="true"]'),signal,600000,false,'等待下载/保存设置',shown=>progress(shown?'等待下载/保存设置':'页面在后台，切回平台继续；计时已暂停','downloads'));
 const input=read();
 if(!input)return {verified:false,message:'当前编辑页未找到下载/保存开关，未能设置为不允许，请在平台手动检查。'};
 const desired=platform==='douyin';
 if(input.disabled)throw new Error('下载/保存权限控件不可操作，请手动检查');
 if(input.checked!==desired)ctx.edit(()=>input.click());
 // Read framework-owned state again after its update cycle; do not toggle a second time.
 let stableSince=0;
 await waitFor(()=>{
  const current=read();
  if(!current||current.disabled||current.checked!==desired)throw new Error('下载/保存权限未保持“不允许”，已停止；请手动检查');
  if(platform==='douyin'){
   const group=current.closest('[class^="download-content-"]');
   const allowed=group?.querySelectorAll<HTMLInputElement>('input[value="1"]');
   if(allowed?.length!==1||allowed[0]!.checked)throw new Error('抖音保存权限回读不一致，请手动检查');
  }
  if(!stableSince)stableSince=Date.now();
  return Date.now()-stableSince>=500;
 },signal,30000,true,'下载/保存权限核验',shown=>progress(shown?'核验不允许他人下载/保存':'页面在后台，切回平台继续；计时已暂停','downloads'));
 return {verified:true,message:'已核验：不允许他人下载/保存。'};
}
