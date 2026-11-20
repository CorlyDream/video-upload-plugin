import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/weixin.ts',name:'wx',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(file=>file.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try {
 for (const mode of ['slow-generation','missing-preview','generation-timeout','generation-cancel']) {
  const page=await browser.newPage();
  await page.setContent('<div>正在处理文件</div><div>删除</div><input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div><div class="vertical-cover-wrap"><div><img><button class="edit-btn">编辑</button></div><div>个人主页卡片 3:4</div><div class="vertical-mask-layer" style="width:40px;height:40px"></div></div>');
  await page.evaluate(mode=>{
   const card=document.querySelector('.vertical-cover-wrap'), image=card.querySelector('img');
   const readyImage='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
   window.earlyClicks=0;window.opened=0;window.progress=[];
   if(mode!=='missing-preview') image.src=readyImage;
   else card.querySelector('.vertical-mask-layer').remove();
   window.releaseGeneration=()=>{card.querySelector('.vertical-mask-layer')?.remove();image.src=readyImage;};
   card.querySelector('button').onclick=()=>{
    if(card.querySelector('.vertical-mask-layer')||!image.complete||!image.naturalWidth){window.earlyClicks++;return;}
    window.opened++;
    const modal=document.createElement('div');modal.className='cover-modal';modal.innerHTML='<h3>编辑个人主页卡片</h3><button>上传封面</button><input type="file" accept="image/*"><button>取消</button><button id="confirm">确认</button>';
    modal.querySelector('input').onchange=event=>{const img=document.createElement('img');img.src=URL.createObjectURL(event.target.files[0]);modal.append(img);};
    modal.querySelector('#confirm').onclick=()=>{const img=modal.querySelector('img');if(img?.complete&&img.naturalWidth){image.src=img.src;modal.remove();}};
    document.body.append(modal);
   };
  },mode);
  await page.addScriptTag({content:code});
  const result=await page.evaluate(async mode=>{
   const canvas=document.createElement('canvas');canvas.width=30;canvas.height=40;canvas.getContext('2d').fillRect(0,0,30,40);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const cover={id:'cover',batchId:'test',name:'portrait.png',type:'image/png',blob,size:blob.size,lastModified:0,createdAt:0};
   const now=Date.now;let offset=0;
   if(mode==='slow-generation'||mode==='generation-timeout') Date.now=()=>now()+offset;
   const advance=setTimeout(()=>{offset=mode==='generation-timeout'?600001:65000;},30);
   const release=mode==='slow-generation'||mode==='missing-preview'?setTimeout(()=>window.releaseGeneration(),450):undefined;
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),mode==='generation-cancel'?100:2000);
   try{return {reason:await wx.fillWeixin(document,{title:'封面等待测试',description:'',tags:[]},{signal:controller.signal,edit:fn=>fn(),progress:(reason,stage)=>window.progress.push({reason,stage})},cover)}}
   catch(error){return {error:error.message};}
   finally{Date.now=now;clearTimeout(advance);clearTimeout(release);clearTimeout(timeout);}
  },mode);
  assert.equal(await page.evaluate(()=>window.earlyClicks),0,'never edit while default cover is still generating');
  if(mode==='generation-timeout'||mode==='generation-cancel'){
   assert.match(result.error??'',mode==='generation-timeout'?/生成.*600 秒/:/操作已停止/);
   assert.equal(await page.evaluate(()=>window.opened),0);
   console.log('WEIXIN READINESS',mode,'PASS');
   await page.close();continue;
  }
  assert.equal(result.error,undefined,`${mode}: ${result.error}`);
  assert.equal(await page.evaluate(()=>window.opened),1);
  const progress=await page.evaluate(()=>window.progress);
  assert.match(progress.find(p=>p.stage==='cover-0-baseline')?.reason??'',/等待视频号.*生成/);
  assert.ok(progress.some(p=>p.stage==='cover-0-confirm'));
  console.log('WEIXIN READINESS',mode,'PASS');
  await page.close();
 }

 // Wujie exposes the same moved DOM nodes through both its shadow root and iframe document.
 const collectionPage=await browser.newPage();
 await collectionPage.setContent('<div>删除</div><input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div><div class="post-album-wrap"><div class="post-album-display">选择合集</div><div class="option-item" style="display:none"><div class="name">幼儿英语</div><div>共24个内容</div></div></div>');
 await collectionPage.evaluate(()=>{
  const host=document.createElement('wujie-app'),frame=document.createElement('iframe');
  const nodes=[...document.body.childNodes];document.body.append(host,frame);const shadow=host.attachShadow({mode:'open'});shadow.append(...nodes);
  frame.contentDocument.querySelectorAll=shadow.querySelectorAll.bind(shadow);
  const display=shadow.querySelector('.post-album-display'),option=shadow.querySelector('.option-item');
  display.onclick=()=>option.style.display='block';option.onclick=()=>{display.textContent='幼儿英语';option.style.display='none';};
 });
 await collectionPage.addScriptTag({content:code});
 const collection=await collectionPage.evaluate(async()=>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),1500);
  try{return {reason:await wx.fillWeixin(document,{title:'复用任务',description:'',tags:[],collection:'幼儿英语'},{signal:controller.signal,edit:fn=>fn(),progress:()=>{}})}}
  catch(error){return {error:error.message};}finally{clearTimeout(timeout);}
 });
 assert.equal(collection.error,undefined,`overlapping roots: ${collection.error}`);
 assert.match(collection.reason,/已选择并回读视频号合集/);
 console.log('WEIXIN READINESS overlapping-roots PASS');
 await collectionPage.close();

 for(const surface of ['document','iframe']) {
 const originalPage=await browser.newPage();
 await originalPage.setContent('<div>删除</div><input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div><label><input type="checkbox" checked>声明原创</label>');
 if(surface==='iframe') await originalPage.evaluate(()=>{const html=document.body.innerHTML;document.body.replaceChildren();const frame=document.createElement('iframe');document.body.append(frame);frame.contentDocument.body.innerHTML=html;});
 await originalPage.addScriptTag({content:code});
 const original=await originalPage.evaluate(async()=>{
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),1500);
  try{return {reason:await wx.fillWeixin(document,{title:'复用任务',description:'',tags:[]},{signal:controller.signal,edit:fn=>fn(),progress:()=>{}})}}
  catch(error){return {error:error.message};}finally{clearTimeout(timeout);}
 });
 assert.equal(original.error,undefined,`already confirmed original declaration: ${original.error}`);
 assert.match(original.reason,/已勾选原创声明/);
 assert.equal(await originalPage.evaluate(()=> (document.querySelector('iframe')?.contentDocument??document).querySelector('input[type=checkbox]').checked),true,'retry must preserve the checked declaration across iframe realms');
 console.log('WEIXIN READINESS original-retry',surface,'PASS');
 await originalPage.close();
 }
} finally {await browser.close();}
