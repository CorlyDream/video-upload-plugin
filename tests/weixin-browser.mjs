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
 const schedulePage=await browser.newPage();
 await schedulePage.setContent(`
   <input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div>
   <div>重新上传</div><label><input type="radio" value="0">不定时</label><label><input type="radio" value="1">定时</label>
   <div class="weui-desktop-picker__date-time">
     <input readonly placeholder="请选择发表时间" value="2026-11-14 14:00">
     <span class="weui-desktop-picker__icon-wrap">日历</span>
     <div class="weui-desktop-picker__panel_day" hidden>
       <div><span class="weui-desktop-picker__panel__label">2026年</span><span class="weui-desktop-picker__panel__label">11月</span></div>
       <table class="weui-desktop-picker__table"><tr><td><a>15</a></td></tr></table>
       <span class="weui-desktop-icon__time">时间</span>
       <div class="weui-desktop-picker__dd__time" hidden>
         <ol class="weui-desktop-picker__time__hour"><li>12</li></ol>
         <ol class="weui-desktop-picker__time__minute"><li>30</li></ol>
       </div>
     </div>
   </div>
 `);
 await schedulePage.evaluate(()=>{
   const field=document.querySelector('input[placeholder="请选择发表时间"]');
   const calendar=document.querySelector('.weui-desktop-picker__panel_day');
   const time=document.querySelector('.weui-desktop-picker__dd__time');
   document.querySelector('.weui-desktop-picker__icon-wrap').onclick=()=>calendar.hidden=!calendar.hidden;
   document.querySelector('.weui-desktop-icon__time').onclick=()=>time.hidden=!time.hidden;
   let date='2026-11-14', hour='14';
   calendar.querySelector('a').onclick=()=>date='2026-11-15';
   time.querySelector('.weui-desktop-picker__time__hour li').onclick=()=>hour='12';
   time.querySelector('.weui-desktop-picker__time__minute li').onclick=()=>field.setAttribute('value',date+' '+hour+':30');
 });
 await schedulePage.addScriptTag({content:code});
 const scheduleResult=await schedulePage.evaluate(async()=>{const c=new AbortController();return wx.fillWeixin(document,{title:'标题',description:'描述',tags:[],scheduleAt:'2026-11-15T12:30'},{signal:c.signal,edit:fn=>fn(),progress:()=>{}});});
 assert.match(scheduleResult,/已设置并回读视频号定时发布时间/);
 assert.equal(await schedulePage.locator('input[placeholder="请选择发表时间"]').getAttribute('value'),'2026-11-15 12:30');
 await schedulePage.close();
 const collectionPage=await browser.newPage();
 await collectionPage.setContent('<div>重新上传</div><input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div><div class="post-album-wrap"><div class="post-album-display"><div class="display-text">选择合集</div></div><div class="filter-wrap" style="display:none"><div class="option-item"><div class="item"><div class="name">英语启蒙</div><div class="desc">共20个内容</div></div></div></div></div>');
 await collectionPage.evaluate(()=>{const wrap=document.querySelector('.post-album-wrap'),display=wrap.querySelector('.post-album-display'),filter=wrap.querySelector('.filter-wrap'),item=wrap.querySelector('.option-item');display.onclick=()=>filter.style.display='block';item.onclick=()=>{display.querySelector('.display-text').textContent='英语启蒙';filter.style.display='none';};});
 await collectionPage.addScriptTag({content:code});
 const collectionResult=await collectionPage.evaluate(async()=>wx.fillWeixin(document,{title:'合集测试',description:'说明',tags:[],collection:'英语启蒙'},{signal:new AbortController().signal,edit:fn=>fn(),progress:()=>{}}));
 assert.match(collectionResult,/已选择并回读视频号合集 英语启蒙/);
 assert.equal(await collectionPage.locator('.display-text').textContent(),'英语启蒙');
 await collectionPage.close();
 const originalPage=await browser.newPage();
 await originalPage.setContent('<div>重新上传</div><label><input id="original" type="checkbox"><span>声明原创</span></label><input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div>');
 await originalPage.evaluate(()=>{
  window.originalConfirmations=0;
  document.querySelector('#original').addEventListener('change',()=>{
   const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.innerHTML='<h2>原创权益</h2><div>平台将保护你的作品并获得原创标记。</div><label><input id="original-consent" type="checkbox">我已阅读并同意《原创声明须知》和《使用条款》</label><button>取消</button><button id="original-confirm" class="weui-desktop-btn_disabled">声明原创</button>';
   document.body.append(dialog);
   dialog.querySelector('#original-consent').addEventListener('change',event=>{dialog.querySelector('#original-confirm').classList.toggle('weui-desktop-btn_disabled',!event.target.checked);});
   dialog.querySelector('#original-confirm').onclick=()=>{window.originalConfirmations++;dialog.remove();};
  });
 });
 await originalPage.addScriptTag({content:code});
 const originalResult=await originalPage.evaluate(async()=>{
  const controller=new AbortController();
  try{return {reason:await wx.fillWeixin(document,{title:'原创测试',description:'说明',tags:[]},{signal:controller.signal,edit:fn=>fn(),progress:()=>{}})}}
  catch(error){return {error:error.message};}
 });
 assert.equal(await originalPage.evaluate(()=>window.originalConfirmations),1);
 assert.match(originalResult.reason,/已勾选原创声明/);
 await originalPage.close();
 for (const surface of ['iframe','shadow']) for (const order of ['portrait-first','landscape-first']) {
  const page=await browser.newPage();
  const defaultPreview='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  await page.setContent(`<div class="cover-card vertical-cover-wrap" data-ratio="3:4"><div><div>个人主页卡片</div><div>3:4</div></div><div><button class="edit-btn">编辑</button><img src="${defaultPreview}#portrait-default"></div></div><div class="cover-card horizon-cover-wrap" data-ratio="4:3"><div><div>分享卡片</div><div>4:3</div></div><div><button class="edit-btn">编辑</button><img src="${defaultPreview}#landscape-default"></div></div><video src="processing.mp4" hidden></video><div id="processing">处理中</div><input placeholder="填写短标题有机会获得更多流量"><div contenteditable data-placeholder="添加描述"></div>`);
  await page.evaluate(surface=>{
   if(surface==='shadow'){
    const contents=document.body.innerHTML;document.body.innerHTML='';
    const host=document.createElement('wujie-app');document.body.append(host);host.attachShadow({mode:'open'}).innerHTML=contents;return;
   }
   const frame=document.createElement('iframe');document.body.append(frame);
   frame.contentDocument.body.innerHTML=document.body.innerHTML.replace(/<iframe[\s\S]*?<\/iframe>/g,'');
   [...document.body.children].filter(e=>e!==frame).forEach(e=>e.remove());
  },surface);
  await page.evaluate(()=>{
   const document=window.document.querySelector('iframe')?.contentDocument??window.document.querySelector('wujie-app').shadowRoot;
   window.coverNames=[];window.reusedWrongCover=0;
   setTimeout(()=>{document.querySelector('#processing').textContent='删除';},350);
   for(const card of document.querySelectorAll('.cover-card')){
    const mask=window.document.createElement('div');mask.className=card.dataset.ratio==='3:4'?'vertical-mask-layer':'horizon-mask-layer';card.append(mask);
    setTimeout(()=>mask.remove(),800);
   }
   for(const card of document.querySelectorAll('.cover-card')) {const openModal=()=>{
    const ratio=card.dataset.ratio;
    const modal=window.document.createElement('div');modal.className='cover-modal';modal.innerHTML=`<h3>编辑${ratio==='3:4'?'个人主页卡片':'分享卡片'}</h3><div>上传封面</div><button>取消</button><button>确认</button>`;
    (document.body??document).append(modal);
    {const input=window.document.createElement('input');input.type='file';input.accept='image/*';modal.append(input);input.onchange=()=>{if(!(input.files[0] instanceof input.ownerDocument.defaultView.File))return;const name=input.files[0].name;window.coverNames.push(name);setTimeout(()=>{const img=window.document.createElement('img');img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#uploaded-'+name;modal.append(img);},100);};}
    const crop=window.document.createElement('div');crop.className='crop-area';const canvas=window.document.createElement('canvas');canvas.width=160;canvas.height=90;canvas.style.opacity='0';crop.append(canvas);modal.append(crop);
    const waitPreview=setInterval(()=>{if(!modal.querySelector('img'))return;clearInterval(waitPreview);canvas.width=2;canvas.height=2;canvas.style.opacity='1';},50);
    modal.querySelectorAll('button')[1].onclick=()=>{if(!modal.querySelector('img')||canvas.style.opacity!=='1')return;card.querySelector('img').src=modal.querySelector('img').src;modal.remove();};
   };
   card.querySelector('button').onclick=()=>{
    if(card.querySelector('.vertical-mask-layer,.horizon-mask-layer'))throw Error('封面帧仍在生成时不应点击编辑');
    if(document.querySelector('#processing').textContent!=='删除')return;
    if(!window.coverNames.length){openModal();return;}
    const popover=window.document.createElement('div');popover.className='img-recommend-wrap';popover.innerHTML='<div>使用此素材作为封面？</div><button>直接编辑</button><button>使用素材</button>';
    (document.body??document).append(popover);
    popover.querySelectorAll('button')[0].onclick=()=>{popover.remove();openModal();};
    popover.querySelectorAll('button')[1].onclick=()=>{window.reusedWrongCover++;popover.remove();};
   };}
  });
  await page.addScriptTag({content:code});
  const result=await page.evaluate(async order=>{
   const make=async(w,h,name)=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').fillRect(0,0,w,h);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));return {id:name,batchId:'test',name,type:'image/png',blob,size:blob.size,lastModified:0,createdAt:0};};
   const portrait=await make(30,40,'portrait.png'),landscape=await make(40,30,'landscape.png');
   const main=order==='portrait-first'?portrait:landscape,other=order==='portrait-first'?landscape:portrait;
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
   try{return await wx.fillWeixin(document,{title:'小熊洗脸',description:'一起学英语',tags:[]},{signal:controller.signal,edit:fn=>fn(),progress:()=>{},activateCover:async(r,a,asset)=>{let file;if(asset){const data=new Uint8Array(await asset.blob.arrayBuffer());file={...asset,base64:btoa(String.fromCharCode(...data))};}return wx.clickWeixinCoverControl(r,a,file,document.querySelector('iframe')?.contentDocument??document.querySelector('wujie-app').shadowRoot);}},main,[other]);}
   finally {clearTimeout(timer);}
  },order);
  const state=await page.evaluate(()=>{const document=window.document.querySelector('iframe')?.contentDocument??window.document.querySelector('wujie-app').shadowRoot;return {reusedWrongCover:window.reusedWrongCover,reason:window.coverNames,portrait:document.querySelector('[data-ratio="3:4"] img').src,landscape:document.querySelector('[data-ratio="4:3"] img').src};});
  assert.equal(state.reusedWrongCover,0);
  if(order==='portrait-first'){
   assert.deepEqual(state.reason,['portrait.png','landscape.png']);
   assert.ok(state.portrait.endsWith('#uploaded-portrait.png'));assert.ok(state.landscape.endsWith('#uploaded-landscape.png'));
  } else {
   assert.deepEqual(state.reason,['landscape.png','portrait.png']);
   assert.ok(state.portrait.endsWith('#uploaded-portrait.png'));assert.ok(state.landscape.endsWith('#uploaded-landscape.png'));
  }
  assert.match(result,/2 张封面已按 3:4\/4:3 槽位更新/);
  await page.close();
 }
 for (const mode of ['success','existing','cancel','lazy-upload','lazy-shadow']) {
 const page=await browser.newPage();
 await page.setContent(`<iframe srcdoc="${mode==='lazy-upload' ? '&lt;div role=button id=upload&gt;支持上传 8 小时以内的视频&lt;/div&gt;&lt;script&gt;upload.onclick=()=&gt;document.body.insertAdjacentHTML(\'beforeend\',\'<input type=file accept=video/*&gt;\')&lt;/script&gt;' : '&lt;input type=\'file\' accept=\'video/*\'&gt;&lt;div&gt;重新上传&lt;/div&gt;&lt;div contenteditable data-placeholder=\'添加描述\'&gt;&lt;/div&gt;&lt;input placeholder=\'填写短标题有机会获得更多流量\'&gt;'}"></iframe><div id='shadow-host'></div><button id='publish'>发表</button><button id='draft'>保存草稿</button>`);
 if(mode==='lazy-shadow') await page.evaluate(()=>{const root=document.querySelector('#shadow-host').attachShadow({mode:'open'});root.innerHTML='<div role="button" id="upload">支持上传 8 小时以内的视频</div>';root.querySelector('#upload').addEventListener('click',()=>{const input=window.document.createElement('input');input.type='file';input.accept='video/*';root.append(input);});});
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
 assert.equal(state.submissions,0);if(mode==='success'){assert.match(result.reason,/已回读核验/);assert.equal(state.title,'小熊洗脸');assert.equal(state.description.replace(/\s+/g,' ').trim(),'小熊洗脸 和小熊一起学习洗脸的英语表达。 #英语启蒙 #亲子英语')}else assert.ok(result.error);
 console.log('WEIXIN',mode,result);await page.close();
 }} finally {await browser.close()}
