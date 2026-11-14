import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle = await build({configFile:false, logLevel:'silent', build:{write:false, lib:{entry:'src/extension/bilibili.ts', name:'bili', formats:['iife']}}});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(file => file.type === 'chunk').code;
const browser = await chromium.launch({headless:true});
try {
  for (const mode of ['success', 'generated-title', 'existing', 'cancel']) {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="bcc-upload-wrapper"><input type="file" accept=".mp4,.flv,.mov,.webm" multiple style="display:none"></div>
      <input name="buploader" type="file" accept=".mp4,video/mp4" style="display:none">
      <input name="buploader" type="file" accept=".txt">
      <div class="cover-module cover-module-main"><div class="cover-slot"><div class="cover-empty"><div class="cover-empty-pill">添加封面</div></div></div></div>
      <div>上传完成</div><input placeholder="请输入稿件标题" value="${mode === 'generated-title' ? 'merged' : ''}">
      <div class="ql-editor" contenteditable="true" data-placeholder="简介">${mode === 'existing' ? '原稿' : ''}</div>
      <div id="tag-container"><div class="tag-input-wrp"><div class="input-container"><div class="tag-pre-wrp"><div class="label-item-v2-container"><p class="label-item-v2-content">记录</p></div></div><div class="input-instance"><input maxlength="20" placeholder="按回车键Enter创建标签"></div><p class="tag-last-wrp">还可以添加 9 个标签</p></div></div></div>
      <div class="bcc-select"><input readonly placeholder="请选择符合您视频内容的创作声明"><ul><li class="bcc-option"><span>含AI生成内容</span></li></ul></div>
      <div class="time-container"><div class="switch-container">定时发布</div><div class="time-picker"><div class="date-picker-date"><p class="date-show">2026-11-14</p></div><div class="date-picker-timer"><p class="date-show">11:34</p></div></div></div>
      <button id="publish">投稿</button><button id="draft">保存草稿</button>
    `);
    await page.evaluate(() => {
      window.submissions = 0;
      for (const button of document.querySelectorAll('button')) button.onclick = () => window.submissions++;
      document.querySelector('.bcc-option').onclick = () => { document.querySelector('.bcc-select input').value = '含AI生成内容'; };
      const coverEntry=document.querySelector('.cover-empty-pill');
      coverEntry.onclick=()=>{window.coverOpened=(window.coverOpened||0)+1;const modal=document.createElement('div');modal.className='cover-editor-panel';modal.innerHTML='<div class="cover-upload"><input accept="image/png, image/jpeg" type="file"></div><div id="editor_4_3" style="opacity:0"><canvas></canvas></div><div id="editor_16_9" style="opacity:0"><canvas></canvas></div><div class="cover-editor-content-right-bottom"><div class="button">取消</div><div class="button submit">完成</div></div>';const input=modal.querySelector('input');input.onchange=()=>{modal.querySelector('#editor_16_9').style.opacity='1';modal.querySelector('#editor_16_9').dataset.coverName=input.files[0].name;};modal.querySelector('.submit').onclick=()=>{document.querySelector('.cover-empty').remove();const img=document.createElement('img');img.className='cover-preview';img.dataset.coverName=input.files[0].name;document.querySelector('.cover-slot').append(img);modal.remove();};modal.querySelector('.button:not(.submit)').onclick=()=>modal.remove();document.body.append(modal);};
      const tagInput=document.querySelector('input[placeholder="按回车键Enter创建标签"]');
      tagInput.addEventListener('keydown',event=>{if(event.key!=='Enter'||!tagInput.value.trim())return;const chip=document.createElement('div');chip.className='label-item-v2-container';chip.innerHTML='<p class="label-item-v2-content"></p>';chip.querySelector('p').textContent=tagInput.value.trim();document.querySelector('.tag-pre-wrp').append(chip);tagInput.value='';});
      const switchControl=document.querySelector('.switch-container');switchControl.onclick=()=>switchControl.classList.add('switch-container-active');
      const dateControl=document.querySelector('.date-picker-date');dateControl.onclick=()=>{const button=document.createElement('button');button.textContent='2026-11-15';button.onclick=()=>{dateControl.querySelector('.date-show').textContent='2026-11-15';button.remove();};document.body.append(button);};
      const timeControl=document.querySelector('.date-picker-timer');timeControl.onclick=()=>{for(const text of ['12','30']){const button=document.createElement('button');button.textContent=text;button.onclick=()=>button.remove();document.body.append(button);}const confirm=document.createElement('button');confirm.textContent='确定';confirm.onclick=()=>{timeControl.querySelector('.date-show').textContent='12:30';confirm.remove();};document.body.append(confirm);};
    });
    await page.addScriptTag({content:code});
    const result = await page.evaluate(async mode => {
      const controller = new AbortController();
      if (mode === 'cancel') controller.abort();
      try {
        const blob=new Blob(['cover'],{type:'image/png'});
        return {reason: await bili.fillBilibili(document, {title:'小熊洗脸', description:'和小熊一起学习洗脸的英语表达。', tags:['英语启蒙','亲子英语'], scheduleAt: mode === 'success' ? '2026-11-15T12:30' : undefined}, {signal:controller.signal, generatedTitle: mode === 'generated-title' ? 'merged' : undefined, cover:{id:'cover',batchId:'test',name:'cover.png',type:'image/png',size:blob.size,lastModified:0,createdAt:0,blob}, edit:fn=>fn(), progress:()=>{}})};
      } catch (error) { return {error:error.message}; }
    }, mode);
    const state = await page.evaluate(() => ({
      title: document.querySelector('input[placeholder="请输入稿件标题"]').value,
      description: document.querySelector('[contenteditable="true"]').textContent,
      declaration: document.querySelector('.bcc-select input').value,
      tags: [...document.querySelectorAll('.label-item-v2-content')].map(e=>e.textContent),
      cover: document.querySelector('.cover-preview')?.dataset.coverName ?? '',
      modal: document.querySelectorAll('.cover-editor-panel').length,
      submissions: window.submissions,
    }));
    assert.equal(state.submissions, 0);
    if (mode === 'success' || mode === 'generated-title') {
      assert.match(result.reason, /已回读核验/);
      if (mode === 'success') assert.match(result.reason, /定时发布时间/);
      assert.equal(state.title, '小熊洗脸');
      assert.equal(state.description, '和小熊一起学习洗脸的英语表达。');
      assert.equal(state.declaration, '含AI生成内容');
      assert.deepEqual(state.tags, ['记录', '英语启蒙', '亲子英语']);
      assert.equal(state.cover, 'cover.png');
      assert.equal(state.modal, 0);
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
} finally { await browser.close(); }
