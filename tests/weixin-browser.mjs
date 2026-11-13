import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/weixin.ts',name:'wx',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(f=>f.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try {
 const selectionPage=await browser.newPage();
 await selectionPage.addScriptTag({content:code});
 const selected=await selectionPage.evaluate(()=>wx.selectWeixinCovers([
   {id:'main-portrait',ratio:'3:4'},
   {id:'other-landscape',ratio:'4:3'},
   {id:'other-portrait',ratio:'3:4'},
 ]));
 assert.deepEqual({portrait:selected.portrait?.id,landscape:selected.landscape?.id},{portrait:'main-portrait',landscape:'other-landscape'});
 await selectionPage.close();
 for (const order of ['portrait-first','landscape-first']) {
  const page=await browser.newPage();
  await page.setContent(`<div class="cover-card" data-ratio="3:4"><div>个人主页卡片 3:4</div><div><button>编辑</button><img src="portrait-default"></div></div><div class="cover-card" data-ratio="4:3"><div>分享卡片 4:3</div><div><button>编辑</button><img src="landscape-default"></div></div><div>重新上传</div><input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div>`);
  await page.evaluate(()=>{
   window.coverNames=[];
   for(const card of document.querySelectorAll('.cover-card')) card.querySelector('button').onclick=()=>{
    const ratio=card.dataset.ratio;
    const modal=document.createElement('div');modal.className='cover-modal';modal.innerHTML=`<h3>编辑${ratio==='3:4'?'个人主页卡片':'分享卡片'}</h3><div>上传封面</div><button>取消</button><button>确认</button>`;
    document.body.append(modal);
    modal.querySelector('div').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='image/*';modal.append(input);input.onchange=()=>{window.coverNames.push(input.files[0].name);const img=document.createElement('img');img.src='uploaded-'+input.files[0].name;modal.append(img);};};
    modal.querySelectorAll('button')[1].onclick=()=>{card.querySelector('img').src=modal.querySelector('img').src;modal.remove();};
   };
  });
  await page.addScriptTag({content:code});
  const result=await page.evaluate(async order=>{
   const make=async(w,h,name)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').fillRect(0,0,w,h);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));return {id:name,batchId:'test',name,type:'image/png',blob,size:blob.size,lastModified:0,createdAt:0};};
   const portrait=await make(30,40,'portrait.png'),landscape=await make(40,30,'landscape.png');
   const main=order==='portrait-first'?portrait:landscape,other=order==='portrait-first'?landscape:portrait;
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
   try{return await wx.fillWeixin(document,{title:'小熊洗脸',description:'一起学英语',tags:[]},{signal:controller.signal,edit:fn=>fn(),progress:()=>{}},main,[other]);}
   finally {clearTimeout(timer);}
  },order);
  const state=await page.evaluate(()=>({reason:window.coverNames,portrait:document.querySelector('[data-ratio="3:4"] img').src,landscape:document.querySelector('[data-ratio="4:3"] img').src}));
  if(order==='portrait-first'){
   assert.deepEqual(state.reason,['portrait.png','landscape.png']);
   assert.equal(state.portrait,'uploaded-portrait.png');assert.equal(state.landscape,'uploaded-landscape.png');
  } else {
   assert.deepEqual(state.reason,['landscape.png','portrait.png']);
   assert.equal(state.portrait,'uploaded-portrait.png');assert.equal(state.landscape,'uploaded-landscape.png');
  }
  assert.match(result,/2 张封面已按 3:4\/4:3 槽位更新/);
  await page.close();
 }
 for (const mode of ['success','existing','cancel','lazy-upload','lazy-shadow']) {
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
