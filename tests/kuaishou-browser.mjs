import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const bundle = await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/kuaishou.ts',name:'ks',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(f=>f.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try {
for(const mode of ['success','scaled-preview','rollback','existing','wrong-image','takeover','no-cover']){
 const page=await browser.newPage();
 await page.setContent(`<div id="work-description-edit" contenteditable="true">${mode==='existing'?'原稿':''}</div><p>重新上传</p>
 <div class="_high-cover-editor_test"><div class="_default-cover_test"><div class="_cover-full-editor_test">封面设置</div><img></div><button role="switch" aria-checked="false">PK封面</button><div class="_pk-upload_test">PK封面</div></div>
 <button id="publish">发布</button><button id="draft">存草稿</button>`);
 await page.evaluate(mode=>{
  window.submissions=0; window.coverNames=[]; window.confirms=0;
  document.querySelector('#publish').onclick=document.querySelector('#draft').onclick=()=>window.submissions++;
  const toggle=document.querySelector('[role=switch]');toggle.onclick=()=>toggle.setAttribute('aria-checked',String(toggle.getAttribute('aria-checked')!=='true'));
  const editor=document.querySelector('#work-description-edit');
  if(mode==='rollback')editor.oninput=()=>setTimeout(()=>editor.textContent='平台回滚',0);
  function openCover(index){
   const modal=document.createElement('div');modal.className='ant-modal';modal.innerHTML='<div class="_header-title-item_test">封面截取</div><div class="_header-title-item_test">上传封面</div><button>确认</button>';
   document.body.append(modal);
   modal.querySelectorAll('div')[1].onclick=()=>{
    const input=document.createElement('input');input.type='file';input.style.display='none';input.accept='image/*';modal.append(input);
    input.onchange=async()=>{
     window.coverNames.push(input.files[0].name);
     const bitmap=await createImageBitmap(input.files[0]);const canvas=document.createElement('canvas');canvas.className='_cutter-raw_test';canvas.width=mode==='scaled-preview'?2:bitmap.width;canvas.height=mode==='scaled-preview'?2:bitmap.height;
     canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
     if(mode==='wrong-image')canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);
     modal.append(canvas);
    };
   };
   modal.querySelector('button').onclick=()=>{
    window.confirms++;
    const image=new Image();image.src=modal.querySelector('canvas').toDataURL();
    const parent=document.querySelector(index?'._pk-upload_test':'._default-cover_test');parent.querySelector('img')?.remove();parent.append(image);if(index)parent.className='_pk-cover_test';
    modal.remove();
   };
  }
  document.querySelector('._cover-full-editor_test').onclick=()=>openCover(0);
  document.querySelector('._pk-upload_test').onclick=()=>openCover(1);
 },mode);
 await page.addScriptTag({content:code});
 const result=await page.evaluate(async mode=>{
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillStyle='red';canvas.getContext('2d').fillRect(0,0,4,4);
  const blob=await new Promise(r=>canvas.toBlob(r));
  const asset=i=>({id:String(i),batchId:'test',name:'cover-'+i+'.png',type:'image/png',blob,size:blob.size});
  const abort=new AbortController();const stages=[];
  if(mode==='takeover')abort.abort();
  const deadline=setTimeout(()=>abort.abort(),5000);
  if(mode==='wrong-image')setTimeout(()=>abort.abort(),1800);
  try{return {reason:await ks.fillKuaishou({title:'标题',description:'正文绝不填写',tags:['一','二','三','四','五']},mode==='no-cover'?undefined:asset(0),{signal:abort.signal,edit:fn=>fn(),progress:(_,s)=>stages.push(s)},mode==='no-cover'?[]:[asset(1),asset(2),asset(3)],true),stages};}
  catch(e){return {error:e.message,stages};}finally{clearTimeout(deadline);}
 },mode);
 const state=await page.evaluate(()=>({text:document.querySelector('#work-description-edit').innerText,submissions,coverNames,confirms}));
 assert.equal(state.submissions,0);
 if(mode==='success'||mode==='scaled-preview'){
  assert.match(result.reason,/作品描述已回读核验/);assert.equal(state.text,'标题\n#一 #二 #三 #四');
  assert.deepEqual(state.coverNames,['cover-0.png','cover-1.png']);assert.equal(state.confirms,2);assert.ok(result.stages.includes('cover-1-confirm'));
 }else if(mode==='no-cover'){assert.match(result.reason,/保留平台默认封面/);assert.equal(state.confirms,0);}
 else {assert.ok(result.error,mode);assert.equal(state.confirms,0);}
 if(mode==='existing')assert.equal(state.text,'原稿');
 if(mode==='wrong-image')assert.deepEqual(state.coverNames,['cover-0.png']);
 console.log('KUAISHOU',mode,JSON.stringify(result));await page.close();
}
}finally{await browser.close();}
