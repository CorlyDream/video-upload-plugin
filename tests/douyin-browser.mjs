import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/douyin.ts',name:'dy',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(f=>f.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try{for(const mode of ['success','existing','rollback','wrong-image','cancel']){
 const page=await browser.newPage();
 await page.setContent(`<input placeholder="填写作品标题，为作品获得更多流量"><div contenteditable="true" data-slate-editor="true" data-placeholder="添加作品简介"><div class="ace-line"><div data-line-wrapper="true">${mode==='existing'?'原稿':'\u200b'}</div></div></div><div>重新上传</div>
 <div class="coverControl-test"><div class="cover-test">选择封面</div><span>横封面4:3</span><img></div><div class="coverControl-test"><div class="cover-test">选择封面</div><span>竖封面3:4</span><img></div><button id="publish">发布</button><button id="draft">暂存离开</button>`);
 await page.evaluate(mode=>{
  window.confirms=0;window.submissions=0;window.names=[];
  document.querySelector('#publish').onclick=document.querySelector('#draft').onclick=()=>window.submissions++;
  document.querySelector('[contenteditable]').addEventListener('paste',e=>{e.preventDefault();const editor=e.currentTarget;editor.replaceChildren();for(const line of e.clipboardData.getData('text/plain').split('\n')){const div=document.createElement('div');div.dataset.lineWrapper='true';div.textContent=line||'\u200b';editor.append(div);}editor.dispatchEvent(new Event('input',{bubbles:true}));});
  if(mode==='rollback')document.querySelector('[contenteditable]').oninput=()=>setTimeout(()=>document.querySelector('[contenteditable]').textContent='平台回滚',0);
  document.querySelectorAll('[class^=coverControl-]').forEach((card,index)=>card.querySelector('.cover-test').onclick=()=>{
   const modal=document.createElement('div');modal.className='dy-creator-content-modal-body';modal.innerHTML='<div class="step-test"><span>设置横封面</span></div><div class="step-test"><span>设置竖封面</span></div><div class="upload-tips-test"></div><div class="semi-upload"><input type="file" class="semi-upload-hidden-input" style="display:none"></div><div class="notImg-test" style="display:none"></div><button>完成</button>';
   if(index===1){modal.querySelectorAll('.step-test').forEach(e=>e.remove());const title=document.createElement('span');title.className='single-title-test';title.textContent='设置竖封面';modal.prepend(title);}
   document.body.append(modal);
   modal.querySelector('input').onchange=async e=>{
    names.push(e.target.files[0].name);const bitmap=await createImageBitmap(e.target.files[0]);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);if(mode==='wrong-image'){ctx.fillStyle='blue';ctx.fillRect(0,0,canvas.width,canvas.height);}bitmap.close();
    const img=new Image();img.src=canvas.toDataURL('image/jpeg');modal.querySelector('.notImg-test').append(img);
   };
   modal.querySelector('button').onclick=()=>{confirms++;card.querySelector('img').src=modal.querySelector('img').src;modal.remove();};
  });
 },mode);
 await page.addScriptTag({content:code});
 const result=await page.evaluate(async mode=>{
  const make=async(w,h,name)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,w,h);const blob=await new Promise(r=>c.toBlob(r));return {blob,name,type:'image/png'};};
  const cover=await make(40,30,'horizontal.png'),portrait=await make(30,40,'vertical.png');
  const abort=new AbortController();if(mode==='cancel')abort.abort();const timer=setTimeout(()=>abort.abort(),mode==='wrong-image'?2200:6500);
  try{return {reason:await dy.fillDouyin({title:'小熊洗脸',description:'一起学英语\nWash your face!',tags:['亲子英语']},cover,{signal:abort.signal,edit:fn=>fn(),progress:()=>{}},[portrait])};}catch(e){return {error:e.message};}finally{clearTimeout(timer);}
 },mode);
 const state=await page.evaluate(()=>({confirms,submissions,names,title:document.querySelector('input').value,body:document.querySelector('[contenteditable]').textContent}));
 assert.equal(state.submissions,0);
 if(mode==='success'){assert.match(result.reason,/已回读核验/);assert.equal(state.confirms,2);assert.deepEqual(state.names,['horizontal.png','vertical.png']);}
 else {assert.ok(result.error,JSON.stringify(result));assert.equal(state.confirms,0);}
 console.log('DOUYIN',mode,JSON.stringify(result));await page.close();
}}finally{await browser.close();}
