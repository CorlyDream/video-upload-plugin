import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless: true});
const failures = [];
try {
  for (const platform of ['xiaohongshu', 'kuaishou']) {
    const bundle = await build({configFile:false, logLevel:'silent', build:{write:false, lib:{entry:`src/extension/${platform}.ts`, name:'adapter', formats:['iife']}}});
    const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(file => file.type === 'chunk').code;
    for (const mode of ['unchecked', 'checked', 'delayed', 'disabled', 'rollback', 'cancel', ...(platform === 'xiaohongshu' ? ['agreement', 'agreement-no-id', 'resume-agreement'] : [])]) {
      const page = await browser.newPage();
      const xhs = platform === 'xiaohongshu';
      const ai = xhs ? '笔记含AI合成内容' : '内容为AI生成';
      const xhsEntry = `<span id="entry">${mode === 'checked' ? ai : '添加内容类型声明'}</span>`;
      const xhsSelect = mode === 'agreement-no-id'
        ? `<div class="d-select-wrapper" tabindex="1"><div class="d-select-main">${xhsEntry}</div></div>`
        : xhsEntry;
      // XHS: current official scripts render .custom-switch-wrapper/.d-switch
      // with a native checkbox and a first-use .originalContainer agreement.
      // Kuaishou: 作者声明 is an inert label next to an Ant Select.
      await page.setContent(`${xhs ? '<input placeholder="填写标题会有更多赞哦"><div class="tiptap ProseMirror" contenteditable="true"><p></p></div><div class="cover-plugin-preview"></div>' : '<div id="work-description-edit" contenteditable="true"></div><div class="_high-cover-editor_test"></div>'}
        <div>重新上传</div>
        ${xhs ? `<div class="custom-switch-wrapper"><div class="custom-switch-card"><div class="custom-switch-text-content"><span>原创声明</span></div><div class="custom-switch-switch"><div id="original" class="d-switch"><span class="d-switch-simulator"><input type="checkbox" style="display:none" ${mode === 'checked' ? 'checked' : ''}></span></div></div></div></div>` : `<section><span>原创声明</span><button id="original" role="switch" aria-checked="${mode === 'checked'}"></button></section>`}
        <section id="declaration">${xhs ? xhsSelect : `<label>作者声明</label><div class="ant-select"><div class="ant-select-selector"><span id="entry">${mode === 'checked' ? ai : '为作品添加补充说明'}</span></div></div>`}</section>
        <button id="publish">发布</button><button id="draft">存草稿</button>`);
      await page.evaluate(({ai, mode, xhs}) => {
        window.submissions = 0; window.originalClicks = 0; window.aiClicks = 0; window.agreements = 0;
        if (mode === 'disabled') (document.querySelector('#original input') ?? document.querySelector('#original')).disabled = true;
        document.querySelector('#publish').onclick = document.querySelector('#draft').onclick = () => window.submissions++;
        document.querySelector('#original').onclick = () => {
          window.originalClicks++;
          const original = document.querySelector('#original');
          const input = original.querySelector('input');
          const update = () => input ? input.checked = !input.checked : original.setAttribute('aria-checked', String(original.getAttribute('aria-checked') !== 'true'));
          setTimeout(update, mode === 'delayed' ? 50 : 0);
          if (mode.includes('agreement')) {
            const agreement = mode === 'agreement-no-id'
              ? '<div class="d-grid d-checkbox d-checkbox-main-label d-clickable bg-red"><input type="checkbox" hidden><span>我已阅读并同意 <a>《原创声明须知》</a>，如滥用声明，平台将驳回并予以相关处置</span></div>'
              : '<label id="originalCheckBox"><input type="checkbox">我已阅读并同意《原创声明须知》，如滥用声明，平台将驳回并予以相关处置</label>';
            const dialog = document.createElement('div'); dialog.className = 'd-modal'; dialog.innerHTML = `<div class="originalContainer"><p>笔记完成原创声明后，将获得以下权益</p>${agreement}<button disabled>声明原创</button></div>`;
            const checkbox = dialog.querySelector('input');
            const confirm = dialog.querySelector('button');
            checkbox.onchange = () => confirm.disabled = !checkbox.checked;
            if (mode === 'agreement-no-id') {
              checkbox.parentElement.onclick = event => {
                if (event.target === checkbox) return;
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
              };
            }
            confirm.onclick = () => { window.agreements++; dialog.remove(); };
            document.body.append(dialog);
          }
        };
        const open = () => {
          if (mode === 'cancel') { window.controller.abort(); return; }
          const menu = document.createElement('div');
          menu.id = 'menu'; menu.className = xhs ? 'declaration-drop-down' : 'ant-select-dropdown'; menu.innerHTML = `<div role="option">虚构演绎，仅供娱乐</div><div role="option">${ai}</div>`;
          menu.lastElementChild.onclick = () => {
            window.aiClicks++;
            setTimeout(() => {
              if (mode !== 'rollback') document.querySelector('#entry').textContent = ai;
              menu.remove();
            }, mode === 'delayed' ? 50 : 0);
          };
          document.body.append(menu);
        };
        if (mode === 'agreement-no-id') document.querySelector('.d-select-wrapper').addEventListener('focusin', open);
        else if (xhs) document.querySelector('#entry').onclick = open;
        else document.querySelector('.ant-select-selector').onmousedown = open;
        if (mode === 'resume-agreement') document.querySelector('#original').click();
      }, {ai, mode, xhs});
      await page.addScriptTag({content:code});
      const result = await page.evaluate(async ({platform, mode}) => {
        window.controller = new AbortController();
        const timeout = setTimeout(() => window.controller.abort(), mode === 'rollback' || mode === 'cancel' ? 1800 : 5000);
        try {
          const context = {signal:window.controller.signal, edit:fn=>fn(), progress:()=>{}};
          const fill = platform === 'xiaohongshu' ? adapter.fillXiaohongshu : adapter.fillKuaishou;
          const reason = await fill({title:'声明回归', description:'', tags:[]}, undefined, context);
          const second = await fill({title:'声明回归', description:'', tags:[]}, undefined, context);
          return {reason, second};
        } catch (error) { return {error:error.message}; }
        finally { clearTimeout(timeout); }
      }, {platform, mode});
      const state = await page.evaluate(() => ({original:String(document.querySelector('#original input')?.checked ?? (document.querySelector('#original').getAttribute('aria-checked') === 'true')), selected:document.querySelector('#entry').textContent, originalClicks, aiClicks, submissions, agreements, modal:!!document.querySelector('.originalContainer')}));
      try {
        assert.equal(state.submissions, 0);
        assert.equal(state.agreements, mode.includes('agreement') ? 1 : 0);
        assert.equal(state.modal, false);
        if (mode === 'rollback' || mode === 'cancel') {
          assert.ok(result.error || !/已选择 AI 生成声明/.test(result.reason), `${platform} ${mode}: must not report success`);
          if (mode === 'cancel') assert.ok(result.error, 'cancellation must stop filling');
        } else {
          assert.equal(state.original, mode === 'disabled' ? 'false' : 'true', `${platform}: 原创声明必须开启或保留禁用状态`);
          assert.equal(state.selected, ai, `${platform}: 必须选中 ${ai}`);
          assert.equal(state.originalClicks, mode === 'checked' || mode === 'disabled' ? 0 : 1, 'retry must preserve the checked switch');
          assert.equal(state.aiClicks, mode === 'checked' ? 0 : 1, 'retry must preserve the selected declaration');
          assert.match(result.reason, mode === 'disabled' ? /原创声明未确认/ : /已勾选原创声明/);
          assert.match(result.reason, /已选择 AI 生成声明/);
        }
        console.log('DECLARATIONS', platform, mode, 'PASS');
      } catch (error) { failures.push(error); console.error('DECLARATIONS', platform, mode, error.message, result, state); }
      await page.close();
    }
  }
} finally { await browser.close(); }
assert.equal(failures.length, 0, failures.map(error=>error.message).join('\n'));
