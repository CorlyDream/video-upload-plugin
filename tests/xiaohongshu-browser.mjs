import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/xiaohongshu.ts',name:'xh',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(f=>f.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.route('https://fixture.test/**',route=>route.fulfill(route.request().url().endsWith('.png')?{body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),contentType:'image/png'}:{body:'<!doctype html><html></html>',contentType:'text/html'}));
  await page.goto('https://fixture.test/');
  await page.setContent(`<div class="collection-plugin-wrapper"><button class="collection-plugin-button">选择合集</button><div class="collection-plugin-popover" hidden><div class="collection-plugin-popover-content"><div class="item"><span class="item-label">幼儿英语</span></div></div></div></div><label><span>定时发布</span><input type="checkbox"></label><input aria-label="日期" value=""><input aria-label="时间" value="">`);
  await page.evaluate(()=>{
    const trigger=document.querySelector('.collection-plugin-button');const popover=document.querySelector('.collection-plugin-popover');
    trigger.onclick=()=>popover.hidden=false;
    document.querySelector('.item').onclick=()=>{trigger.textContent='幼儿英语';popover.hidden=true;};
  });
  await page.addScriptTag({content:code});
  const result=await page.evaluate(async()=>{
    const controller=new AbortController();
    const context={signal:controller.signal,edit:fn=>fn(),progress:()=>{}};
    return {collection:await xh.selectXiaohongshuCollection('幼儿英语',context),schedule:await xh.setXiaohongshuSchedule('2026-11-15T12:30',context)};
  });
  assert.match(result.collection,/已选择并回读小红书合集/);
  assert.match(result.schedule,/已设置并回读定时发布时间/);
  assert.equal(await page.locator('.collection-plugin-button').textContent(),'幼儿英语');
  assert.equal(await page.locator('input[aria-label="日期"]').inputValue(),'2026-11-15');
  assert.equal(await page.locator('input[aria-label="时间"]').inputValue(),'12:30');
  console.log('XIAOHONGSHU',JSON.stringify(result));

  // Live collection menus attach the selection handler to the inner content.
  await page.setContent(`<button class="collection-plugin-button">选择合集</button><div class="collection-plugin-popover-content" hidden><div class="item"><div class="item-content"><div class="item-label">幼儿英语</div></div></div></div>`);
  await page.evaluate(()=>{
    document.querySelector('.collection-plugin-button').onclick=()=>document.querySelector('.collection-plugin-popover-content').hidden=false;
    document.querySelector('.item-content').onclick=()=>{document.querySelector('.collection-plugin-button').outerHTML='<div class="collection-plugin-choose"><span class="collection-name">幼儿英语</span></div>';document.querySelector('.collection-plugin-popover-content').hidden=true;};
  });
  const selected = await page.evaluate(()=>xh.selectXiaohongshuCollection('幼儿英语',{signal:new AbortController().signal,edit:fn=>fn(),progress:()=>{}}));
  assert.match(selected,/已选择并回读/);
  const reread = await page.evaluate(()=>xh.selectXiaohongshuCollection('幼儿英语',{signal:new AbortController().signal,edit:()=>{throw Error('must not reselect');},progress:()=>{}}));
  assert.match(reread,/已回读/);
  console.log('XIAOHONGSHU_INNER_COLLECTION',selected,reread);

  // The live site can fall back to a legacy `.d-modal` after the new editor
  // reports a video-loading error. Its confirm handler does synchronous crop
  // work, so the adapter must resume from the existing local cover list and
  // defer the click rather than waiting on a page-wide completion button.
  await page.setContent(`<input placeholder="填写标题会有更多赞哦"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div><div>重新上传</div><div class="cover-plugin-preview"><div class="cover"><div class="default" style="background-image:url(old.png)"><span class="cover-edit-entry">编辑封面</span></div></div></div><div class="d-modal"><div>设置封面 截取封面 上传封面</div><img data-index="0" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="><button class="btn-confirm" type="button" disabled>确定</button></div><script>window.confirmed=0;document.querySelector('.btn-confirm').onclick=()=>{window.confirmed++;document.querySelector('.d-modal').remove();document.querySelector('.cover > .default').style.backgroundImage='url(new.png)';};</script>`);
  const legacy = await page.evaluate(async()=>{
    const blob = new Blob([new Uint8Array([137,80,78,71])], {type:'image/png'});
    const context = {signal:new AbortController().signal, edit:(action)=>action(), progress:()=>{}};
    const asset = {id:'cover',batchId:'batch',name:'cover.png',type:'image/png',size:blob.size,lastModified:0,createdAt:0,blob};
    const result = await xh.fillXiaohongshu({title:'旧版封面',description:'',tags:[]},asset,context).catch(error=>error.message);
    return {result,confirmed:window.confirmed,modal:!!document.querySelector('.d-modal'),preview:document.querySelector('.cover > .default')?.getAttribute('style')};
  });
  assert.equal(legacy.confirmed,0);
  assert.equal(legacy.modal,true);
  assert.match(legacy.result,/封面处理未完成/);
  assert.match(legacy.preview,/old\.png/);
  console.log('XIAOHONGSHU_LEGACY',JSON.stringify(legacy));

  await page.setContent(`<input placeholder="填写标题会有更多赞哦"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div><div>重新上传</div><div class="cover-plugin-preview"><div class="cover"><div class="default" style="background-image:url(old.png)"><span class="cover-edit-entry">编辑封面</span></div></div></div><div class="d-modal"><div>设置封面</div><button class="upload-tab" type="button">上传封面</button><button class="btn-confirm" type="button">确定</button></div><script>window.confirmed=0;document.querySelector('.upload-tab').onclick=()=>{const input=document.createElement('input');input.type='file';document.querySelector('.d-modal').append(input);input.onchange=()=>{const img=document.createElement('img');img.dataset.index='0';img.style.width='1px';img.style.height='1px';img.src=URL.createObjectURL(input.files[0]);document.querySelector('.d-modal').append(img);};};document.querySelector('.btn-confirm').onclick=()=>{window.confirmed++;document.querySelector('.d-modal').remove();document.querySelector('.cover > .default').style.backgroundImage='url(new.png)';};</script>`);
  const legacyUpload = await page.evaluate(async()=>{
    const encoded = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const blob = new Blob([bytes], {type:'image/png'});
    const context = {signal:new AbortController().signal, edit:(action)=>action(), progress:()=>{}};
    const asset = {id:'cover',batchId:'batch',name:'cover.png',type:'image/png',size:blob.size,lastModified:0,createdAt:0,blob};
    const result = await xh.fillXiaohongshu({title:'旧版上传',description:'',tags:[]},asset,context).catch(error=>error.message);
    return {result,confirmed:window.confirmed,modal:!!document.querySelector('.d-modal'),input:!!document.querySelector('input[type="file"]'),preview:document.querySelector('.cover > .default')?.getAttribute('style')};
  });
  assert.equal(legacyUpload.confirmed,1);
  assert.equal(legacyUpload.modal,false);
  assert.equal(legacyUpload.input,false);
  assert.match(legacyUpload.result,/1 张封面已核验保存/);
  assert.match(legacyUpload.preview,/new\.png/);
  console.log('XIAOHONGSHU_LEGACY_UPLOAD',JSON.stringify(legacyUpload));

  // New editor shares `.d-modal` and mounts its editor asynchronously.
  await page.setContent(`<input placeholder="填写标题会有更多赞哦"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div><div>重新上传</div><div class="cover-plugin-preview"><div class="cover"><div class="default" style="background-image:url(old.png)"><span class="cover-edit-entry">编辑封面</span></div></div></div>`);
  await page.evaluate(()=>{
    window.newSaved=0;
    document.querySelector('.cover-edit-entry').onclick=()=>{
      const m=document.createElement('div');m.className='d-modal cover-modal';m.textContent='设置封面';document.body.append(m);
      setTimeout(()=>{
        m.innerHTML='<div>设置封面</div><button class="video-panel-switch-item">编辑</button><button class="video-panel-switch-item active">预览</button><div class="editor-panel"></div><span class="crop-tab">裁剪</span><div class="ratio-option active">4:3</div><div class="ratio-option">3:4</div><div class="bottom-content"><button>完成</button></div>';
        m.querySelector('button').onclick=()=>{m.querySelector('button').classList.add('active');const input=document.createElement('input');input.type='file';input.setAttribute('aria-label','上传封面图片');m.append(input);input.onchange=()=>{const img=new Image();img.src=URL.createObjectURL(input.files[0]);m.querySelector('.editor-panel').append(img);};};
        for(const option of m.querySelectorAll('.ratio-option'))option.onclick=()=>{m.querySelector('.ratio-option.active').classList.remove('active');option.classList.add('active');};
        m.querySelector('.bottom-content button').onclick=()=>{window.savedRatio=m.querySelector('.ratio-option.active').textContent;window.newSaved++;document.querySelector('.cover > .default').style.backgroundImage='url(new-editor.png)';m.remove();};
      },150);
    };
  });
  const modern=await page.evaluate(async()=>{
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const canvas=document.createElement('canvas');canvas.width=3;canvas.height=4;canvas.getContext('2d').fillRect(0,0,3,4);const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    const asset={id:'new-delayed',batchId:'batch',name:'new.png',type:'image/png',size:blob.size,lastModified:0,createdAt:0,blob};
    const result=await xh.fillXiaohongshu({title:'新版异步挂载',description:'',tags:[]},asset,{signal:new AbortController().signal,edit:fn=>fn(),progress:()=>{}});
    return {result,saved:window.newSaved,ratio:window.savedRatio};
  });
  assert.equal(modern.saved,1);assert.equal(modern.ratio,'3:4');assert.match(modern.result,/1 张封面预览已更新/);
  console.log('XIAOHONGSHU_NEW_EDITOR_DELAYED',JSON.stringify(modern));

  // All four selected assets must pass byte verification and save in order,
  // including an explicit new-editor failure before the legacy fallback.
  await page.setContent(`<input placeholder="填写标题会有更多赞哦"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div><div>重新上传</div><div class="cover-plugin-preview"><div class="cover"><div class="default" style="background-image:url(old.png)"><span class="cover-edit-entry">编辑封面</span></div></div></div><div class="pk-cover-panel-switch"><input type="checkbox" checked></div><div id="cards"></div>`);
  await page.evaluate(()=>{
    window.saved=[];window.newAttempts=0;
    const openLegacy=index=>{
      const modal=document.createElement('div');modal.className='d-modal';modal.innerHTML='<div>设置封面</div><input type="file"><button class="btn-confirm" disabled>确定</button>';document.body.append(modal);
      const input=modal.querySelector('input');input.onchange=()=>{const img=document.createElement('img');img.src=URL.createObjectURL(input.files[0]);img.onload=()=>modal.querySelector('button').disabled=false;modal.append(img);};
      modal.querySelector('button').onclick=()=>{window.saved.push(input.files[0].name);if(index<0)document.querySelector('.cover > .default').style.backgroundImage='url(saved-main.png)';else document.querySelectorAll('.pk-cover-list-card-img')[index].src='https://fixture.test/saved-'+index+'.png';modal.remove();};
    };
    const open=index=>{window.newAttempts++;const m=document.createElement('div');m.className='cover-modal';m.innerHTML='<div>设置封面 视频加载遇到问题</div><button>回退到旧版</button>';m.querySelector('button').onclick=()=>{m.remove();openLegacy(index);};document.body.append(m);};
    document.querySelector('.cover-edit-entry').onclick=()=>open(-1);
    for(let i=0;i<3;i++){const card=document.createElement('div');card.className='pk-cover-list-card';card.innerHTML='<img class="pk-cover-list-card-img" src="https://fixture.test/old-'+i+'.png"><span class="pk-cover-list-edit-text" data-impression="系统推荐">编辑</span>';card.querySelector('span').onclick=()=>open(i);document.getElementById('cards').append(card);}
  });
  const allFour=await page.evaluate(async()=>{
    const encoded='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const blob=new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'image/png'});
    const assets=Array.from({length:4},(_,i)=>({id:'four-'+i,batchId:'batch',name:i+'.png',type:'image/png',size:blob.size,lastModified:0,createdAt:0,blob}));
    const context={signal:new AbortController().signal,edit:fn=>fn(),progress:()=>{}};
    const result=await xh.fillXiaohongshu({title:'四张封面',description:'',tags:[]},assets[0],context,assets.slice(1),true);
    const reread=await xh.fillXiaohongshu({title:'四张封面',description:'',tags:[]},assets[0],context,assets.slice(1),true);
    return {result,reread,saved:window.saved,attempts:window.newAttempts};
  });
  assert.deepEqual(allFour.saved,['0.png','1.png','2.png','3.png']);
  assert.equal(allFour.attempts,4);
  assert.match(allFour.result,/4 张封面已核验保存/);
  console.log('XIAOHONGSHU_FALLBACK_FOUR_AND_RESUME',JSON.stringify(allFour));
  await page.setContent(`<input placeholder="填写标题会有更多赞哦"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div><div>重新上传</div><div class="cover-plugin-preview"><div class="cover"><div class="default" style="background-image:url(old.png)"><span class="cover-edit-entry">编辑封面</span></div></div></div><div class="d-modal"><div>设置封面</div><input type="file"><button class="btn-confirm">确定</button></div>`);
  const mismatch=await page.evaluate(async()=>{
    window.confirmed=0;document.querySelector('.btn-confirm').onclick=()=>window.confirmed++;
    document.querySelector('.d-modal input').onchange=()=>{const img=new Image();img.src=URL.createObjectURL(new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}));document.querySelector('.d-modal').append(img);};
    const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    const asset={id:'mismatch',batchId:'batch',name:'mismatch.png',type:'image/png',size:blob.size,lastModified:0,createdAt:0,blob};
    const result=await xh.fillXiaohongshu({title:'错图拒绝',description:'',tags:[]},asset,{signal:new AbortController().signal,edit:fn=>fn(),progress:()=>{}}).catch(e=>e.message);
    return {result,confirmed:window.confirmed};
  });
  assert.equal(mismatch.confirmed,0);assert.match(mismatch.result,/预览与所选图片不一致/);
  console.log('XIAOHONGSHU_WRONG_IMAGE_REFUSED',JSON.stringify(mismatch));
  // Reinjection after stop must leave exactly one bridge executor.
  const contentBundle=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/content.ts',name:'contentLifecycle',formats:['iife']}}});
  const contentCode=(Array.isArray(contentBundle)?contentBundle[0]:contentBundle).output.find(f=>f.type==='chunk').code;
  await page.setContent('<div>lifecycle</div>');
  await page.evaluate(()=>{window.connectionListeners=new Set();window.chrome ??= {};window.chrome.runtime={onConnect:{addListener:fn=>window.connectionListeners.add(fn),removeListener:fn=>window.connectionListeners.delete(fn)}};});
  for(let i=0;i<2;i++){
    await page.addScriptTag({content:contentCode});
    assert.equal(await page.evaluate(()=>window.connectionListeners.size),1);
    if(i===1){await page.evaluate(()=>window.oldDisconnect());await page.addScriptTag({content:contentCode});assert.equal(await page.evaluate(()=>window.connectionListeners.size),1);}
    await page.evaluate(()=>{
      let onMessage;const port={name:'upload-page',onMessage:{addListener:fn=>onMessage=fn},onDisconnect:{addListener:fn=>window.oldDisconnect=fn},postMessage:()=>{}};
      [...window.connectionListeners][0](port);onMessage({type:'stop'});
    });
    assert.equal(await page.evaluate(()=>window.connectionListeners.size),0);
  }
  console.log('XIAOHONGSHU_SINGLE_EXECUTOR_REINJECTION_PASS');
} finally { await browser.close(); }
