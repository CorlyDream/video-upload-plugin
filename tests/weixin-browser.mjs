import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/weixin.ts',name:'wx',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(f=>f.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try { for (const mode of ['success','existing','cancel','lazy-upload','lazy-shadow']) {
 const page=await browser.newPage();
 await page.setContent(`<iframe srcdoc="${mode==='lazy-upload' ? '&lt;div role=button id=upload&gt;支持上传 8 小时以内的视频&lt;/div&gt;&lt;script&gt;upload.onclick=()=&gt;document.body.insertAdjacentHTML(\'beforeend\',\'<input type=file accept=video/*&gt;\')&lt;/script&gt;' : '&lt;input type=\'file\' accept=\'video/*\'&gt;&lt;div&gt;重新上传&lt;/div&gt;&lt;div contenteditable data-placeholder=\'添加描述\'&gt;&lt;/div&gt;&lt;input placeholder=\'填写短标题有机会获得更多流量\'&gt;'}"></iframe><div id='shadow-host'></div><button id='publish'>发表</button><button id='draft'>保存草稿</button>`);
 if(mode==='lazy-shadow') await page.evaluate(()=>{const root=document.querySelector('#shadow-host').attachShadow({mode:'open'});root.innerHTML='<div role="button" id="upload">支持上传 8 小时以内的视频</div>';root.querySelector('#upload').addEventListener('click',()=>{const input=document.createElement('input');input.type='file';input.accept='video/*';root.append(input);});});
 await page.addScriptTag({content:code});
 if(mode==='lazy-upload'||mode==='lazy-shadow'){
   const activated=await page.evaluate(mode=>wx.openWeixinUploadEntry(mode==='lazy-shadow' ? document : document.querySelector('iframe').contentDocument),mode);
   assert.equal(activated,true);
   assert.equal(await page.evaluate(mode=>mode==='lazy-shadow' ? document.querySelector('#shadow-host').shadowRoot.querySelector('input[type=file]') !== null : document.querySelector('iframe').contentDocument.querySelector('input[type=file]') !== null,mode),true);
   await page.close();
   console.log('WEIXIN',mode,{activated});
   continue;
 }
 await page.evaluate(mode=>{window.submissions=0;for(const b of document.querySelectorAll('button'))b.onclick=()=>window.submissions++;const d=document.querySelector('iframe').contentDocument;if(mode==='existing')d.querySelector('input[placeholder]').value='原稿';},mode);
 const result=await page.evaluate(async mode=>{const d=document.querySelector('iframe').contentDocument;const c=new AbortController();if(mode==='cancel')c.abort();else setTimeout(()=>c.abort(),10000);try{return {reason:await wx.fillWeixin(d,{title:'小熊洗脸',description:'和小熊一起学习洗脸的英语表达。',tags:['英语启蒙','亲子英语']},{signal:c.signal,edit:fn=>fn(),progress:()=>{}})}}catch(e){return {error:e.message}}},mode);
 const state=await page.evaluate(()=>{const d=document.querySelector('iframe').contentDocument;return {title:d.querySelector('input[placeholder]').value,description:d.querySelector('[contenteditable]').innerText,submissions,iframe:true}});
 assert.equal(state.submissions,0);if(mode==='success'){assert.match(result.reason,/已回读核验/);assert.equal(state.title,'小熊洗脸');assert.equal(state.description.replace(/\s+/g,' ').trim(),'和小熊一起学习洗脸的英语表达。 #英语启蒙 #亲子英语')}else assert.ok(result.error);
 console.log('WEIXIN',mode,result);await page.close();
 }} finally {await browser.close()}
