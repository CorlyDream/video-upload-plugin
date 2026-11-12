import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle = await build({configFile:false, logLevel:'silent', build:{write:false, lib:{entry:'src/extension/bilibili.ts', name:'bili', formats:['iife']}}});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(file => file.type === 'chunk').code;
const browser = await chromium.launch({headless:true});
try {
  for (const mode of ['success', 'existing', 'cancel']) {
    const page = await browser.newPage();
    await page.setContent(`
      <input name="buploader" type="file" accept=".mp4,video/mp4" style="display:none">
      <div>上传完成</div><input placeholder="请输入稿件标题">
      <textarea placeholder="请输入简介">${mode === 'existing' ? '原稿' : ''}</textarea>
      <button id="publish">投稿</button><button id="draft">保存草稿</button>
    `);
    await page.evaluate(() => {
      window.submissions = 0;
      for (const button of document.querySelectorAll('button')) button.onclick = () => window.submissions++;
    });
    await page.addScriptTag({content:code});
    const result = await page.evaluate(async mode => {
      const controller = new AbortController();
      if (mode === 'cancel') controller.abort();
      try {
        return {reason: await bili.fillBilibili(document, {title:'小熊洗脸', description:'和小熊一起学习洗脸的英语表达。', tags:['英语启蒙','亲子英语']}, {signal:controller.signal, edit:fn=>fn(), progress:()=>{}})};
      } catch (error) { return {error:error.message}; }
    }, mode);
    const state = await page.evaluate(() => ({
      title: document.querySelector('input[placeholder="请输入稿件标题"]').value,
      description: document.querySelector('textarea').value,
      submissions: window.submissions,
    }));
    assert.equal(state.submissions, 0);
    if (mode === 'success') {
      assert.match(result.reason, /已回读核验/);
      assert.equal(state.title, '小熊洗脸');
      assert.equal(state.description, '和小熊一起学习洗脸的英语表达。\n\n#英语启蒙 #亲子英语');
    } else {
      assert.ok(result.error, JSON.stringify(result));
      assert.equal(state.title, mode === 'existing' ? '' : '');
      assert.equal(state.description, mode === 'existing' ? '原稿' : '');
    }
    console.log('BILIBILI', mode, JSON.stringify(result));
    await page.close();
  }
} finally { await browser.close(); }
