import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle = await build({configFile:false, logLevel:'silent', build:{write:false, lib:{entry:'src/extension/bilibili.ts', name:'bili', formats:['iife']}}});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(file => file.type === 'chunk').code;
const browser = await chromium.launch({headless:true});
try {
  for (const mode of ['success', 'generated-title', 'existing', 'cancel', 'delayed-upload', 'rejected-tag', 'check-error']) {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="bcc-upload-wrapper"><input type="file" accept=".mp4,.flv,.mov,.webm" multiple style="display:none"></div>
      <input name="buploader" type="file" accept=".mp4,video/mp4" style="display:none">
      <input name="buploader" type="file" accept=".txt">
      <div class="cover-module cover-module-main"><div class="cover-slot"><div class="cover-empty"><div class="cover-empty-pill">添加封面</div></div></div></div>
      <div id="upload-status">${mode === 'delayed-upload' ? '上传中 49%' : '上传完成'}</div><input placeholder="请输入稿件标题" value="${mode === 'generated-title' ? 'merged' : ''}">
      <div class="ql-editor" contenteditable="true" data-placeholder="简介">${mode === 'existing' ? '原稿' : ''}</div>
      <div id="tag-container"><div><div class="input-container"><div class="tag-pre-wrp"><div class="label-item-v2-container"><p class="label-item-v2-content">记录</p></div></div><div class="input-instance"><input maxlength="20" placeholder="按回车键Enter创建标签"></div><p class="tag-last-wrp">还可以添加 9 个标签</p></div></div></div>
      <div class="video-human-type"><div class="select-controller"><p class="select-item-cont">vlog</p></div><div class="drop-list-v2-item" title="亲子" style="display:none">亲子</div></div><div class="bcc-select"><input readonly placeholder="请选择符合您视频内容的创作声明"><ul><li class="bcc-option"><span>含AI生成内容</span></li></ul></div>
      <div class="time-container"><div class="switch-container">定时发布</div><div class="time-picker"><div class="date-picker-date"><p class="date-show">2026-11-14</p></div><div class="date-picker-timer"><p class="date-show">11:34</p></div></div></div>
      <button id="publish">投稿</button><button id="draft">保存草稿</button>
    `);
    await page.evaluate(mode => {
      window.submissions = 0;
      document.querySelector('.select-controller').onclick=()=>document.querySelector('.drop-list-v2-item').style.display='block';
      document.querySelector('.drop-list-v2-item').onclick=()=>{document.querySelector('.select-item-cont').textContent='亲子';document.querySelector('.drop-list-v2-item').style.display='none';};
      window.editedBeforeUpload = false;
      window.uploadCompletedAt = mode === 'delayed-upload' ? 0 : performance.now();
      document.querySelector('input[placeholder="请输入稿件标题"]').addEventListener('input', () => {
        if (document.querySelector('#upload-status').textContent.includes('上传中')) window.editedBeforeUpload = true;
      });
      if (mode === 'delayed-upload') setTimeout(() => {
        document.querySelector('#upload-status').textContent = '上传完成';
        window.uploadCompletedAt = performance.now();
      }, 900);
      for (const button of document.querySelectorAll('button')) button.onclick = () => window.submissions++;
      document.querySelector('.bcc-option').onclick = () => { document.querySelector('.bcc-select input').value = '含AI生成内容'; };
      const coverEntry=document.querySelector('.cover-empty-pill');
      coverEntry.onclick=()=>{window.coverOpened=(window.coverOpened||0)+1;const modal=document.createElement('div');modal.className='cover-editor-panel';modal.innerHTML='<div class="cover-upload"><input accept="image/png, image/jpeg" type="file"></div><div id="editor_4_3" style="opacity:0"><canvas></canvas></div><div id="editor_16_9" style="opacity:0"><canvas></canvas></div><div class="cover-editor-content-right-bottom"><div class="button">取消</div><div class="button submit">完成</div></div>';const input=modal.querySelector('input');input.onchange=()=>{modal.querySelector('#editor_16_9').style.opacity='1';modal.querySelector('#editor_16_9').dataset.coverName=input.files[0].name;};modal.querySelector('.submit').onclick=()=>{document.querySelector('.cover-empty').remove();const img=document.createElement('img');img.className='cover-preview';img.dataset.coverName=input.files[0].name;document.querySelector('.cover-slot').append(img);modal.remove();};modal.querySelector('.button:not(.submit)').onclick=()=>modal.remove();document.body.append(modal);};
      const tagInput=document.querySelector('input[placeholder="按回车键Enter创建标签"]');
      tagInput.addEventListener('keydown',event=>{if(event.key!=='Enter'||!tagInput.value.trim())return;const chip=document.createElement('div');chip.className='label-item-v2-container';chip.innerHTML='<p class="label-item-v2-content"></p>';chip.querySelector('p').textContent=tagInput.value.trim();document.querySelector('.tag-pre-wrp').append(chip);tagInput.value='';});
      const switchControl=document.querySelector('.switch-container');switchControl.onclick=()=>switchControl.classList.add('switch-container-active');
      const dateControl=document.querySelector('.date-picker-date');dateControl.onclick=()=>{const button=document.createElement('button');button.textContent='2026-11-15';button.onclick=()=>{dateControl.querySelector('.date-show').textContent='2026-11-15';button.remove();};document.body.append(button);};
      const timeControl=document.querySelector('.date-picker-timer');timeControl.onclick=()=>{for(const text of ['12','30']){const button=document.createElement('button');button.textContent=text;button.onclick=()=>button.remove();document.body.append(button);}const confirm=document.createElement('button');confirm.textContent='确定';confirm.onclick=()=>{timeControl.querySelector('.date-show').textContent='12:30';confirm.remove();};document.body.append(confirm);};
    }, mode);
    await page.addScriptTag({content:code});
      const result = await page.evaluate(async mode => {
      const controller = new AbortController();
      if (mode === 'cancel') controller.abort();
      try {
        const blob=new Blob(['cover'],{type:'image/png'});
        const rejected=[];
        const reason=await bili.fillBilibili(document, {title:'小熊洗脸', description:'和小熊一起学习洗脸的英语表达。', tags:['英语启蒙','亲子英语'], scheduleAt: mode === 'success' ? '2026-11-15T12:30' : undefined}, {signal:controller.signal, rejectedTags:tags=>{rejected.splice(0,rejected.length,...tags);}, checkTag:async tag=>{if(mode==='check-error')throw new Error('校验服务异常');return mode==='rejected-tag'&&tag==='英语启蒙'?{accepted:false,reason:'当前tag为话题专用，不允许自定义添加'}:{accepted:true};}, generatedTitle: mode === 'generated-title' ? 'merged' : undefined, cover:{id:'cover',batchId:'test',name:'cover.png',type:'image/png',size:blob.size,lastModified:0,createdAt:0,blob}, edit:fn=>fn(), progress:()=>{}});return {reason,rejected};
      } catch (error) { return {error:error.message}; }
    }, mode);
    const state = await page.evaluate(() => ({
      title: document.querySelector('input[placeholder="请输入稿件标题"]').value,
      description: document.querySelector('[contenteditable="true"]').textContent,
      declaration: document.querySelector('.bcc-select input').value,
      category:document.querySelector('.select-item-cont').textContent,
      tags: [...document.querySelectorAll('.label-item-v2-content')].map(e=>e.textContent),
      cover: document.querySelector('.cover-preview')?.dataset.coverName ?? '',
      modal: document.querySelectorAll('.cover-editor-panel').length,
      submissions: window.submissions,
      editedBeforeUpload: window.editedBeforeUpload,
      uploadCompletedAt: window.uploadCompletedAt,
    }));
    assert.equal(state.submissions, 0);
    if (mode === 'success' || mode === 'generated-title' || mode === 'delayed-upload' || mode === 'rejected-tag') {
      assert.match(result.reason, /已回读核验/);
      assert.match(result.reason, /当前编辑页检查后点击“立即投稿”/);
      if (mode === 'delayed-upload') assert.equal(state.editedBeforeUpload, false);
      if (mode === 'success') assert.match(result.reason, /定时发布时间/);
      assert.equal(state.title, '小熊洗脸');
      assert.equal(state.description, '和小熊一起学习洗脸的英语表达。');
      assert.equal(state.declaration, '含AI生成内容');
      assert.equal(state.category,'亲子');
      assert.deepEqual(state.tags, mode==='rejected-tag'?['记录','亲子英语']:['记录', '英语启蒙', '亲子英语']);
      if(mode==='rejected-tag'){assert.deepEqual(result.rejected,[{tag:'英语启蒙',reason:'当前tag为话题专用，不允许自定义添加'}]);assert.match(result.reason,/已跳过/);}
      assert.equal(state.cover, 'cover.png');
      assert.equal(state.modal, 0);
    } else if(mode==='check-error'){
      assert.match(result.error,/校验服务异常/);assert.deepEqual(state.tags,['记录']);
    } else {
      assert.ok(result.error, JSON.stringify(result));
      assert.equal(state.title, mode === 'existing' ? '' : '');
      assert.equal(state.description, mode === 'existing' ? '原稿' : '');
      assert.deepEqual(state.tags, ['记录']);
      assert.equal(state.cover, '');
    }
    console.log('BILIBILI', mode, JSON.stringify(result));
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.setContent('<div class="bcc-upload-wrapper"><input id="old" type="file" accept=".mp4,.mov"></div>');
    await page.addScriptTag({content: code});
    const result = await page.evaluate(() => {
      const oldInput = document.querySelector('#old');
      const wrapper = oldInput.parentElement;
      const replacement = oldInput.cloneNode();
      replacement.id = 'new';
      oldInput.remove();
      wrapper.append(replacement);
      const candidates = Array.from(document.querySelectorAll('input[type="file"]'))
        .filter(input => input.accept.includes('.mp4'));
      return {
        oldConnected: oldInput.isConnected,
        selected: bili.resolveBilibiliTransferInput(candidates, false)?.id,
        blockedWhenAmbiguous: bili.resolveBilibiliTransferInput([...candidates, replacement.cloneNode()], false) === undefined,
      };
    });
    assert.equal(result.oldConnected, false);
    assert.equal(result.selected, 'new');
    assert.equal(result.blockedWhenAmbiguous, true);
    console.log('BILIBILI input-redraw', JSON.stringify(result));
    await page.close();
  }
  {
    const page = await browser.newPage();
    await page.setContent('<div class="bcc-upload-wrapper"><input id="hidden-card" type="file" accept=".mp4" style="display:none"></div><div id="b-uploader-input-container_test"><input id="named" name="buploader" type="file" accept=".mp4"></div><div id="b-uploader-input-container_txt"><input name="buploader" type="file" accept=".txt"></div>');
    await page.addScriptTag({content: code});
    const selected = await page.evaluate(() => bili.selectBilibiliUploadInput(Array.from(document.querySelectorAll('input[type="file"]'))).map(input => input.id || input.accept));
    assert.deepEqual(selected, ['hidden-card']);
    const beforeCardReady = await page.evaluate(() => {
      document.querySelector('.bcc-upload-wrapper').remove();
      return bili.selectBilibiliUploadInput(Array.from(document.querySelectorAll('input[type="file"]'))).map(input=>input.id);
    });
    assert.deepEqual(beforeCardReady, [], 'wait for upload card even when buploader is the sole video input');
    console.log('BILIBILI input-priority', JSON.stringify({selected}));
    await page.close();
  }
  {
    const page=await browser.newPage();
    await page.route('https://member.bilibili.com/**', route=>route.fulfill({contentType:'text/html',body:'<div class="bcc-upload-wrapper"><input type="file" accept=".mp4"></div>'}));
    await page.goto('https://member.bilibili.com/platform/upload/video/frame');
    await page.addScriptTag({content:code});
    const result=await page.evaluate(async()=>{
      const input=document.querySelector('input'), transfer=new DataTransfer();
      transfer.items.add(new File(['video'],'test.mp4',{type:'video/mp4'}));input.files=transfer.files;
      let changes=0; input.addEventListener('change',()=>changes++);
      window.__MICRO_APP_PROXY_WINDOW__={document,_profile:undefined};
      const pending=bili.triggerBilibiliUpload('test.mp4',5);
      if(changes)throw new Error('must not dispatch before the micro-app upload profile is ready');
      window.__MICRO_APP_PROXY_WINDOW__._profile={upload:'ugcfx/bup'};
      const accepted=await bili.triggerBilibiliUpload('test.mp4',5);
      let mismatch=false;try{await bili.triggerBilibiliUpload('different.mp4',5);}catch{mismatch=true;}
      return {pending,accepted,changes,mismatch};
    });
    assert.deepEqual(result,{pending:'waiting',accepted:true,changes:1,mismatch:true});
    console.log('BILIBILI micro-app upload readiness',JSON.stringify(result));await page.close();
  }
  for (const mode of ['allowed','rejected','auth-error','network-error','malformed']) {
    const page=await browser.newPage();
    await page.route('https://member.bilibili.com/**',route=>{
      const url=new URL(route.request().url());
      assert.equal(route.request().method(),'GET');
      if(url.pathname==='/platform/upload/video/frame')return route.fulfill({contentType:'text/html',body:'<body></body>'});
      const topic=url.pathname==='/x/vupre/web/topic/tag/check';
      const body=topic&&mode==='auth-error'?{code:-101}: {code:0,data:{code:topic&&mode==='rejected'?-1:topic&&mode==='malformed'?null:0,content:'话题专用，不允许自定义添加'}};
      return route.fulfill({status:topic&&mode==='network-error'?503:200,json:body});
    });
    await page.goto('https://member.bilibili.com/platform/upload/video/frame');await page.addScriptTag({content:code});
    const result=await page.evaluate(async()=>{try{return await bili.checkBilibiliTag('测试标签');}catch(error){return {error:error.message};}});
    if(mode==='allowed')assert.equal(result.accepted,true);
    else if(mode==='rejected')assert.deepEqual(result,{accepted:false,reason:'话题专用，不允许自定义添加'});
    else {assert.ok(result.error);assert.equal(result.accepted,undefined,'ambiguous failures must not become rejected tags');}
    console.log('BILIBILI tag-check',mode,JSON.stringify(result));await page.close();
  }
  for (const mode of ['ready', 'uploading', 'existing-draft', 'submitted-archive']) {
    const page = await browser.newPage();
    const requests = [];
    const url = 'https://member.bilibili.com/platform/upload/video/frame'
      + (mode === 'submitted-archive' ? '?type=edit&aid=1' : mode === 'existing-draft' ? '?type=draft&draftId=1' : '');
    await page.route('https://member.bilibili.com/**', route => {
      const request = route.request();
      requests.push(request.method());
      return route.fulfill({contentType:'text/html; charset=utf-8',body:'<button class="submit-draft" disabled>存草稿</button><button id="publish">立即投稿</button>'});
    });
    await page.goto(url);
    await page.evaluate(mode => {
      document.body.__vue__ = {$taskConfig:{tasks:[{
        archive:{title:'标题',desc:'简介',tid:193},
        videoTasks:[{status:mode === 'uploading' ? 1 : 3,cid:123,filename:'video'}],
      }]}};
      window.clicks = 0;
      for (const button of document.querySelectorAll('button')) button.onclick = () => window.clicks++;
    }, mode);
    await page.addScriptTag({content:code});
    const result = await page.evaluate(() => {
      try {return bili.inspectBilibiliEditor();}
      catch (error) {return {error:error.message};}
    });
    if (mode === 'ready') assert.deepEqual(result, {title:'标题',description:'简介',tid:193});
    else assert.ok(result.error);
    assert.equal(await page.evaluate(() => window.clicks), 0);
    assert.deepEqual(requests, ['GET']);
    assert.equal(page.url(), url);
    console.log('BILIBILI editor inspection', mode, JSON.stringify(result));
    await page.close();
  }
} finally { await browser.close(); }
