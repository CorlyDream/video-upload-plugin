import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, mkdir, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';

const scratch = await mkdtemp(join(tmpdir(), 'video-upload-extension-'));
const extension = join(scratch, 'extension');
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
// Fixture-only copy pregrants exactly the production optional hosts. Never edit dist.
manifest.host_permissions = manifest.optional_host_permissions;
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
await mkdir('artifacts', { recursive: true });
const failures = [];
const observations = [];
let scenario = 'normal';
function autofillFixture(mode) {
  return `<!doctype html><html><body><form>
  <input type="file" accept="video/mp4">
  <input placeholder="填写标题会有更多赞哦">
  <div role="textbox" class="tiptap ProseMirror" contenteditable="true">${mode === 'autofill' ? '<p><br></p>' : ''}</div>
  <button type="submit">发布</button><button id="draft" type="button">暂存离开</button>
  </form><div class="cover-plugin-preview" aria-busy="false"><div class="cover"><div class="default" style="background-image:url(old.png)"><span class="cover-edit-entry">编辑封面</span></div></div></div>
  <div class="pk-cover-panel-switch"><input type="checkbox"></div><div id="pk-cards"></div><input class="pk-cover-list-file-input" type="file" accept=".jpg,.png"><button class="pk-cover-list-add-btn" ${mode === 'autofill-pk-delayed' ? 'disabled' : ''}>添加</button>
  <script>
  window.submissions=0;window.drafts=0;window.changes=0;window.coverChanges=0;window.earlyCoverConfirm=0;
  document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
  document.querySelector('#draft').onclick=()=>window.drafts++;
  document.querySelector('input[type=file]').onchange=()=>{
    window.changes++;document.body.insertAdjacentHTML('beforeend','<p id="uploading">上传中 49%</p>');
    setTimeout(()=>{document.querySelector('#uploading').remove();document.body.insertAdjacentHTML('beforeend','<p>${mode === 'autofill-upload-fail' ? '上传失败' : '重新上传'}</p>');},1200);
  };
  document.querySelector('.pk-cover-list-add-btn').onclick=()=>openCover(document.querySelectorAll('.pk-cover-list-card').length);
  window.coverNames=[];
  document.querySelector('.pk-cover-panel-switch').onclick=e=>{
    const input=document.querySelector('.pk-cover-panel-switch input');if(e.target!==input)input.checked=!input.checked;
    if('${mode}'==='autofill-pk-delayed') setTimeout(()=>document.querySelector('.pk-cover-list-add-btn').disabled=false,900);
    if('${mode}'!=='autofill-pk-add' && input.checked && !document.querySelector('.pk-cover-list-card')) for(let i=0;i<3;i++){
      const card=document.createElement('div');card.className='pk-cover-list-card';
      card.innerHTML='<img class="pk-cover-list-card-img" src="old'+i+'.png"><span class="pk-cover-list-edit-text" data-impression="'+('${mode}'==='autofill-pk-existing'?'自定义':'系统推荐')+'">编辑</span>';
      card.querySelector('span').onclick=()=>openCover(i);document.querySelector('#pk-cards').append(card);
    }
  };
  document.querySelector('.cover-edit-entry').onclick=()=>openCover(-1);
  document.querySelector('.pk-cover-list-file-input').onchange=e=>openCover(document.querySelectorAll('.pk-cover-list-card').length,e.target.files[0]);
  function openCover(index, prefill){
    history.pushState({cover:true},'',location.href);
    window.coverReady=false;
    const dialog=document.createElement('div'); dialog.className=index<0?'cover-modal':'pk-cover-list-editor-modal';
    dialog.innerHTML='<h6>设置封面</h6><div class="editor-panel"></div><input type="file" accept="image/*" aria-label="上传封面图片"><div class="bottom-content"><button type="button">完成</button></div>';
    document.body.append(dialog);
    dialog.querySelector('input').onchange=()=>{window.coverChanges++;window.coverNames.push(dialog.querySelector('input').files[0].name);window.coverName=dialog.querySelector('input').files[0].name;setTimeout(()=>{if('${mode}'==='autofill-cover-fail'){dialog.insertAdjacentHTML('beforeend','<p>上传失败</p>');return;}const img=new Image();img.src=URL.createObjectURL(dialog.querySelector('input').files[0]);dialog.querySelector('.editor-panel').append(img);window.coverReady=true;},'${mode}'==='autofill'?35000:700);};
    dialog.querySelector('button').onclick=()=>{if(!window.coverReady)window.earlyCoverConfirm++;if(index<0)document.querySelector('.cover > .default').style.backgroundImage='url(new.png)';else {let img=document.querySelectorAll('.pk-cover-list-card-img')[index];if(!img){const card=document.createElement('div');card.className='pk-cover-list-card';img=document.createElement('img');img.className='pk-cover-list-card-img';card.append(img);document.querySelector('#pk-cards').append(card);}img.src=dialog.querySelector('.editor-panel img').src;}if('${mode}'==='autofill')dialog.style.display='none';else dialog.remove();};
    if(prefill){const transfer=new DataTransfer();transfer.items.add(prefill);dialog.querySelector('input').files=transfer.files;dialog.querySelector('input').dispatchEvent(new Event('change'));}
  };
  ${mode === 'autofill-rollback' ? "document.querySelector('.tiptap').addEventListener('input',()=>setTimeout(()=>{document.querySelector('.tiptap').textContent='平台回滚'},0));" : ''}
  ${mode === 'autofill-existing' ? "document.querySelector('.tiptap').textContent='保留我的原稿'" : ''}
  </script></body></html>`;
}
function douyinPopupFixture(url) {
 if(!url.includes('/post/video'))return `<!doctype html><input type="file" accept="video/mp4"><script>window.changes=0;document.querySelector('input').onchange=()=>{window.changes++;window.open('https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page');};</script>`;
 return `<!doctype html><input placeholder="填写作品标题，为作品获得更多流量"><div data-slate-editor="true" data-placeholder="添加作品简介" contenteditable="true"><div data-line-wrapper="true">​</div></div><div>重新上传</div><div class="download-content-fixture"><label><input type="checkbox" value="1" checked>允许</label><label><input type="checkbox" value="0" onclick="this.closest('.download-content-fixture').querySelector('input').checked=false">不允许</label></div><div class="coverControl-fixture">横封面4:3</div><div class="coverControl-fixture">竖封面3:4</div><button id="publish">发布</button><button id="draft">暂存离开</button><script>window.submissions=0;document.querySelector('#publish').onclick=document.querySelector('#draft').onclick=()=>window.submissions++;document.querySelector('[contenteditable]').addEventListener('paste',e=>{e.preventDefault();e.currentTarget.textContent=e.clipboardData.getData('text/plain');});</script>`;
}
const fixture = (url='') => scenario==='douyin-popup' ? douyinPopupFixture(url) : scenario.startsWith('autofill') ? autofillFixture(scenario) : `<!doctype html><html><head><meta charset="utf-8"><title>本地上传夹具</title></head><body>
<form><input type="file" accept="video/mp4"><input aria-label="标题" placeholder="填写标题会有更多赞哦"><button type="submit">发布</button><button id="draft" type="button">存草稿</button></form>
<div class="download-content-fixture"><label><input type="checkbox" value="1" checked>允许</label><label><input type="checkbox" value="0" onclick="this.closest('.download-content-fixture').querySelector('input').checked=false">不允许</label></div><output id="result"></output><div class="tiptap ProseMirror" contenteditable="true"></div><div class="cover-plugin-preview" aria-busy="false">封面</div><div class="pk-cover-panel-switch"><input type="checkbox" checked></div><script>
document.querySelector('.pk-cover-panel-switch').onclick=e=>{const input=document.querySelector('.pk-cover-panel-switch input');if(e.target!==input)input.checked=!input.checked;};
window.submissions=0;window.drafts=0;window.changes=0;window.checkedBytes=0;
document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submissions++});
document.querySelector('#draft').onclick=()=>window.drafts++;
document.querySelector('input[type=file]').addEventListener('change',async e=>{
 window.changes++;const f=e.target.files[0];window.fileName=f.name;window.fileSize=f.size;
 // Check every byte through bounded 4 MiB chunks, avoiding an extra full-file buffer.
 const hashes=[];for(let offset=0;offset<f.size;offset+=4*1024*1024){const chunk=await f.slice(offset,offset+4*1024*1024).arrayBuffer();hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',chunk))).map(v=>v.toString(16).padStart(2,'0')).join(''));window.checkedBytes+=chunk.byteLength;}
 window.hashes=hashes;document.querySelector('#result').textContent='fixture file received';document.body.insertAdjacentHTML('beforeend','<p>重新上传</p>');
});
${scenario === 'existing' ? "document.querySelector('input[aria-label]').value='用户的原稿';" : ''}
${scenario === 'ambiguous' ? "document.querySelector('form').append(document.querySelector('input[type=file]').cloneNode());" : ''}
${scenario === 'waiting' ? "document.querySelector('input[type=file]').remove();" : ''}
</script></body></html>`;
// Browser-level DNS mapping catches the first request of extension-created tabs too.
// The self-signed certificate exception applies only to this disposable test profile.
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(scratch, 'key.pem'), '-out', join(scratch, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const server = createServer({ key: await readFile(join(scratch, 'key.pem')), cert: await readFile(join(scratch, 'cert.pem')) }, (req, res) => {
  if (process.env.DEBUG_FIXTURE) console.log('FIXTURE', req.headers.host, scenario);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fixture(req.url));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixturePort = server.address().port;
const mappings = manifest.host_permissions.map(pattern => `MAP ${new URL(pattern).hostname} 127.0.0.1:${fixturePort}`).join(', ');
const context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
  headless: true, channel: 'chromium', ignoreHTTPSErrors: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--host-resolver-rules=${mappings}, MAP * ~NOTFOUND`, '--ignore-certificate-errors', '--no-proxy-server'],
});
context.on('page', page => page.on('pageerror', error => failures.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const wb = await context.newPage();
  wb.on('pageerror', error => failures.push(error.message));
  await wb.goto(`chrome-extension://${extensionId}/workbench.html`);
  await wb.getByLabel('选择本地视频').waitFor();
  for (const [index,name] of ['小红书','抖音','B站','视频号','快手'].entries()) assert.equal(await wb.locator('label.platform input[type="checkbox"]').nth(index).isChecked(),true,`${name} should be selected by default`);
  for (const name of ['抖音','B站','视频号','快手']) await wb.getByText(name, {exact:true}).click();
  await wb.waitForFunction(() => [...document.querySelectorAll('label.platform input[type="checkbox"]')].slice(1).every(input => !input.checked));
  await wb.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
  if (process.argv.includes('--idle')) {
    await new Promise(resolve => setTimeout(resolve, 35000));
    assert.equal(await wb.getByLabel('选择本地视频').isEnabled(), true, 'visible idle workbench must remain usable after worker idle threshold');
  }
  const file = join(scratch, 'fixture.mp4');
  const bytes = Buffer.alloc(1024 * 1024 + 19, 73);
  await writeFile(file, bytes);
  const expected = createHash('sha256').update(bytes).digest('hex');
  async function prepare(path = file) {
    await wb.getByLabel('选择本地视频').setInputFiles(path);
    await wb.getByRole('button', { name: '开始文件交接验证' }).waitFor();
    if (!scenario.startsWith('autofill')) await wb.getByRole('checkbox',{name:'默认开启封面 PK'}).uncheck();
    await wb.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '开始文件交接验证').disabled);
  }
  async function clear() {
    const button = wb.getByRole('button', { name: '结束并清理素材与记录' });
    await button.click();
    await wb.waitForFunction(() => !document.querySelector('input[type=file]').disabled);
    const count = await wb.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('video-upload-assets', 1); request.onsuccess = () => { const db=request.result; const count=db.transaction('assets').objectStore('assets').count(); count.onsuccess=()=>{db.close();resolve(count.result)};count.onerror=()=>reject(count.error); };request.onerror=()=>reject(request.error); }));
    assert.equal(count, 0);
  }
  async function targetPage() {
    await wb.waitForFunction(() => document.querySelectorAll('.task').length > 0);
    const pages = context.pages().filter(page => page.url().startsWith('https://creator.'));
    return pages.at(-1) ?? await context.waitForEvent('page');
  }
  if (process.argv.includes('--start-feedback')) {
    await wb.setViewportSize({width:1100,height:760});
    await prepare();
    await wb.getByLabel('标题',{exact:true}).fill('这是一条超过二十个字符的标题用于验证错误提示位置');
    await wb.getByRole('button',{name:'开始文件交接验证'}).click();
    await wb.getByTestId('start-diagnostics').filter({hasText:'已收到 1 次开始点击'}).waitFor();
    const alert=wb.getByRole('alert');await alert.waitFor();
    assert.match(await alert.innerText(),/最多 20/);
    const box=await alert.boundingBox();
    assert.ok(box && box.y>=0 && box.y+box.height<=760,'点击开始后错误提示必须出现在当前视口，不能藏在右侧顶部');
    assert.equal(context.pages().filter(p=>p.url().startsWith('https://creator.')).length,0);
    await wb.screenshot({path:'artifacts/start-feedback.png',fullPage:false});
    await wb.getByLabel('标题',{exact:true}).fill('');
    // Controlled fixture only: exercise a permission prompt still pending, then denial.
    await wb.evaluate(()=>{chrome.permissions.request=()=>new Promise(resolve=>{window.resolvePermission=resolve;});});
    await wb.getByRole('button',{name:'开始文件交接验证'}).click();
    await wb.getByRole('status').filter({hasText:'等待浏览器站点授权'}).waitFor();
    assert.equal(await wb.getByRole('button',{name:'开始文件交接验证'}).isDisabled(),true);
    await wb.evaluate(()=>window.resolvePermission(false));
    await wb.getByRole('alert').filter({hasText:'未授权访问所选平台'}).waitFor();
    const denied=await wb.getByRole('alert').boundingBox();
    assert.ok(denied && denied.y>=0 && denied.y+denied.height<=760);
    assert.equal(context.pages().filter(p=>p.url().startsWith('https://creator.')).length,0);
    await wb.getByRole('button',{name:'开始文件交接验证'}).click();
    await wb.getByRole('status').filter({hasText:'等待浏览器站点授权'}).waitFor();
    await wb.getByRole('button',{name:'停止并接管页面'}).click();
    await wb.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='开始文件交接验证').disabled,null,{timeout:2000});
    // A delayed permission response must not resume a cancelled start.
    await wb.evaluate(()=>window.resolvePermission(true));
    assert.equal(context.pages().filter(p=>p.url().startsWith('https://creator.')).length,0);
    const downloadReady=wb.waitForEvent('download');
    await wb.getByRole('button',{name:'导出诊断日志'}).click();
    const download=await downloadReady;
    const exported=JSON.parse(await readFile(await download.path(),'utf8'));
    const events=exported.logs['diagnostics.workbench'].map(e=>e.event);
    assert.ok(events.includes('start.clicked'));assert.ok(events.includes('permission.request'));assert.ok(events.includes('command.sent'));
    assert.ok(!JSON.stringify(exported).includes('这是一条超过'));
    await wb.reload();
    const stored=await wb.evaluate(async()=>(await chrome.storage.local.get('diagnostics.workbench'))['diagnostics.workbench']);
    assert.ok(stored.some(e=>e.event==='start.clicked'),'logs survive workbench reload');
    console.log('PASS: feedback, cancellation, persistent diagnostics and JSON export');
    await clear();
  } else {
  if(!process.argv.includes('--douyin-only')) {
  await prepare();
  await wb.getByText('抖音', { exact: true }).click();
  await wb.getByRole('button', { name: '开始文件交接验证' }).click();
  await wb.waitForFunction(() => document.querySelectorAll('.task .status').length === 2 && [...document.querySelectorAll('.task .status')].every(el => /^(需你处理|填写完成，待检查)$/.test(el.textContent)), null, { timeout: 65000 });
  const targets = context.pages().filter(page => page.url().startsWith('https://creator.'));
  assert.equal(targets.length, 2);
  for (const page of targets) {
    await page.waitForFunction(() => window.hashes, null, { timeout: 10000 });
    const result = await page.evaluate(() => ({ name: window.fileName, size: window.fileSize, hashes: window.hashes, changes: window.changes, submissions: window.submissions, drafts: window.drafts }));
    assert.deepEqual(result, { name: 'fixture.mp4', size: bytes.length, hashes: [expected], changes: 1, submissions: 0, drafts: 0 });
    if(page.url().includes('xiaohongshu')) assert.equal(await page.locator('.pk-cover-panel-switch input').isChecked(),false,'PK-only off must disable an existing checked switch');
    observations.push({ origin: new URL(page.url()).origin, ...result });
    assert.equal(await page.locator('iframe').count(), 0);
  }
  assert.equal(await wb.getByText('待你检查', { exact: true }).count(), 0);
  assert.equal(await wb.getByRole('button', { name: '开始文件交接验证' }).isDisabled(), true);
  await wb.screenshot({ path: 'artifacts/workbench.png', fullPage: true });
  await wb.reload();
  await wb.getByText('文件已交给页面控件', { exact: false }).first().waitFor();
  assert.equal(context.pages().filter(page => page.url().startsWith('https://creator.')).length, 2);
  await wb.getByRole('checkbox', {name:/^B站/}).click();
  await wb.getByRole('button', {name:'开始文件交接验证'}).click();
  await wb.waitForFunction(()=>document.querySelectorAll('.task .status').length===3 && [...document.querySelectorAll('.task .status')].every(e=>/^(需你处理|填写完成，待检查)$/.test(e.textContent)));
  await wb.getByRole('checkbox', {name:/^B站/}).click();
  for (const extra of context.pages().filter(p=>p.url().startsWith('https://member.'))) await extra.close();
  await clear();
  for (const page of targets) await page.close();
  if (await wb.getByRole('checkbox',{name:/^抖音/}).isChecked()) await wb.getByRole('checkbox',{name:/^抖音/}).uncheck();
  for (const test of ['existing', 'ambiguous']) {
    scenario = test; await prepare();
    await wb.getByRole('button', { name: '开始文件交接验证' }).click();
    await wb.getByText(/^(需你处理|填写完成，待检查)$/).waitFor();
    const page = await targetPage();
    assert.equal(await page.evaluate(() => window.changes), 0);
    assert.equal(await page.evaluate(() => window.submissions + window.drafts), 0);
    if (test === 'existing') assert.equal(await page.getByLabel('标题').inputValue(), '用户的原稿');
    observations.push({ scenario: test, reason: await wb.locator('.task > p:not(.hint)').textContent(), fileChanges: 0 });
    await clear(); await page.close();
  }
  scenario = 'waiting'; await prepare();
  await wb.getByRole('button', { name: '开始文件交接验证' }).click();
  let page = await targetPage();
  await page.getByLabel('标题').fill('我接管了');
  await wb.getByText('已中止', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('标题').inputValue(), '我接管了');
  await clear(); await page.close();
  await prepare(); await wb.getByRole('button', { name: '开始文件交接验证' }).click();
  page = await targetPage();
  await page.reload();
  await wb.getByText('已暂停', { exact: true }).waitFor();
  await clear(); await page.close();
  await prepare(); await wb.getByRole('button', { name: '开始文件交接验证' }).click();
  page = await targetPage();
  await wb.reload();
  await wb.getByText('已暂停', { exact: true }).waitFor();
  await page.evaluate(() => { const input=document.createElement('input');input.type='file';input.accept='video/mp4';document.body.append(input); });
  assert.equal(await page.evaluate(() => document.querySelector('input[type=file]').files.length), 0);
  await clear(); await page.close();
  if (process.argv.includes('--sizes')) {
    scenario = 'normal';
    for (const mib of [20, 100, 500]) {
      const path = join(scratch, `fixture-${mib}MiB.mp4`);
      const handle = await open(path, 'w'); await handle.truncate(mib * 1024 * 1024); await handle.close();
      const before = await worker.evaluate(() => navigator.storage.estimate());
      const started = performance.now();
      await prepare(path);
      const cachedAt = performance.now();
      const cached = await worker.evaluate(() => navigator.storage.estimate());
      await wb.getByRole('button', { name: '开始文件交接验证' }).click();
      await wb.getByText(/^(需你处理|填写完成，待检查)$/).waitFor();
      const page = await targetPage();
      await page.waitForFunction(() => window.hashes, null, { timeout: 60000 });
      const received = await page.evaluate(() => ({ size: window.fileSize, checkedBytes: window.checkedBytes, hashes: window.hashes, changes: window.changes, submissions: window.submissions, drafts: window.drafts, jsHeapBytes: performance.memory?.usedJSHeapSize }));
      assert.equal(received.size, mib * 1024 * 1024);
      assert.equal(received.checkedBytes, received.size);
      assert.equal(received.changes, 1); assert.equal(received.submissions + received.drafts, 0);
      const chunkHash = createHash('sha256').update(Buffer.alloc(4 * 1024 * 1024)).digest('hex');
      assert.ok(received.hashes.every(hash => hash === chunkHash));
      const verifiedAt = performance.now();
      await clear();
      const after = await worker.evaluate(() => navigator.storage.estimate());
      const observation = { scenario: 'size-stress', mib, cacheMs: Math.round(cachedAt-started), transferAndHashMs: Math.round(verifiedAt-cachedAt), beforeUsage: before.usage, cachedUsage: cached.usage, afterUsage: after.usage, jsHeapBytes: received.jsHeapBytes, bytesVerified: received.checkedBytes };
      observations.push(observation); console.log('SIZE', JSON.stringify(observation));
      await page.close();
    }
  }
  for (const mode of ['autofill', 'autofill-existing', 'autofill-rollback', 'autofill-upload-fail', 'autofill-cover-fail', 'autofill-no-cover', 'autofill-takeover', 'autofill-pk-multi', 'autofill-pk-existing', 'autofill-pk-off','autofill-pk-add','autofill-pk-delayed']) {
    scenario = mode; await prepare();
    await wb.getByLabel('标题', {exact:true}).fill('小熊洗脸');
    await wb.getByLabel('内容描述', {exact:true}).fill('一起学英语\n洗脸真开心');
    await wb.getByLabel('标签', {exact:true}).fill('英语启蒙,亲子英语');
    const coverFile = join(scratch, 'cover.png');
    await writeFile(coverFile, Buffer.from(await wb.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;canvas.getContext('2d').fillRect(0,0,4,3);return canvas.toDataURL().split(',')[1];}),'base64'));
    assert.equal(await wb.getByRole('checkbox',{name:'默认开启封面 PK'}).isChecked(),true);
    if(mode==='autofill-pk-off') await wb.getByRole('checkbox',{name:'默认开启封面 PK'}).uncheck();
    if (mode !== 'autofill-no-cover') {
      await wb.getByLabel('选择封面图片').setInputFiles(coverFile);
      if(mode==='autofill-pk-multi'||mode==='autofill-pk-existing'||mode==='autofill-pk-add'||mode==='autofill-pk-delayed'){
        const files=[coverFile];for(let i=1;i<=3;i++){const path=join(scratch,'pk'+i+'.png');await cp(coverFile,path);files.push(path);}
        await wb.getByLabel('选择封面图片').setInputFiles(files);
        await wb.getByText('PK 3：pk3.png',{exact:true}).waitFor();
        const fifth=join(scratch,'pk4.png');await cp(coverFile,fifth);
        await wb.getByLabel('选择封面图片').setInputFiles([...files,fifth]);
        await wb.getByRole('alert').filter({hasText:'最多选择 4 张'}).waitFor();
        assert.equal(await wb.getByText('PK 3：pk3.png',{exact:true}).count(),1);
      }
      await wb.getByText('cover.png', {exact:true}).waitFor();
    }
    await wb.getByRole('button', {name:'开始文件交接验证'}).click();
    const target = await targetPage();
    if (mode !== 'autofill-existing') {
      await target.locator('#uploading').waitFor();
      assert.equal(await target.getByPlaceholder('填写标题会有更多赞哦').inputValue(), '');
    }
    if (mode === 'autofill-takeover') {
      await target.getByPlaceholder('填写标题会有更多赞哦').fill('用户接管');
      await wb.getByText('已中止', {exact:true}).waitFor();
      await target.getByText('重新上传', {exact:true}).waitFor();
      assert.equal(await target.getByPlaceholder('填写标题会有更多赞哦').inputValue(), '用户接管');
      assert.equal(await target.evaluate(()=>window.coverChanges+window.submissions+window.drafts),0);
      await clear(); await target.close(); continue;
    }
    if(mode==='autofill') {
      const trigger=wb.locator('.progress-trigger');
      await wb.waitForFunction(()=>document.querySelector('.progress-trigger')?.textContent.includes('上传与校验'));
      await trigger.hover();
      const panel=wb.getByRole('region',{name:'全部处理步骤'});
      await panel.waitFor();await panel.hover();
      assert.equal(await panel.locator('li.active').count(),1);
      assert.ok(await panel.locator('li.done').count()>0);
      assert.ok(await panel.locator('li.pending').count()>0);
      await wb.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
      await wb.mouse.move(0,0);await trigger.focus();await panel.waitFor();
      await trigger.press('Escape');await panel.waitFor({state:'hidden'});
      await trigger.click();await panel.waitFor();
      await wb.setViewportSize({width:390,height:844});
      await wb.waitForFunction(()=>{const e=document.querySelector('.progress-panel:popover-open');if(!e)return false;const b=e.getBoundingClientRect();return b.x>=0&&b.right<=390&&b.y>=0&&b.bottom<=844;});
      await wb.screenshot({path:'artifacts/progress-mobile.png'});
      await trigger.press('Escape');await wb.setViewportSize({width:1280,height:900});
    }
    await wb.getByText(/^(需你处理|填写完成，待检查)$/).waitFor({timeout:45000});
    if (mode === 'autofill') {
      assert.equal(await target.getByPlaceholder('填写标题会有更多赞哦').inputValue(), '小熊洗脸');
      assert.deepEqual(await target.locator('.tiptap > p').allTextContents(), ['一起学英语','洗脸真开心','','#英语启蒙 #亲子英语']);
      assert.equal(await target.evaluate(()=>window.coverName), 'cover.png');
      assert.equal(await target.evaluate(()=>window.coverChanges), 1);
      assert.equal(await wb.locator('.task .status').innerText(),'需你处理');
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(),/未找到下载\/保存开关/);
      assert.match(await wb.locator('.progress-trigger').innerText(),/禁止他人下载\/保存并核验/);
      assert.equal(await target.evaluate(()=>window.earlyCoverConfirm), 0);
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(), /话题/);
    } else if(mode==='autofill-pk-multi'||mode==='autofill-pk-add'||mode==='autofill-pk-delayed') {
      assert.deepEqual(await target.evaluate(()=>window.coverNames),['cover.png','pk1.png','pk2.png','pk3.png']);
      assert.equal(await target.locator('.pk-cover-panel-switch input').isChecked(),true);
      assert.equal(await target.evaluate(()=>window.earlyCoverConfirm),0);
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(),/4 张封面/);
    } else if(mode==='autofill-pk-existing') {
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(),/已有自定义 PK/);
      assert.equal(await target.evaluate(()=>window.coverChanges),1);
    } else if(mode==='autofill-pk-off') {
      assert.equal(await target.locator('.pk-cover-panel-switch input').isChecked(),false);
    } else if (mode === 'autofill-no-cover') {
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(), /保留平台默认封面/);
      assert.equal(await target.evaluate(()=>window.coverChanges),0);
    } else if (mode === 'autofill-upload-fail') {
      assert.equal(await target.getByPlaceholder('填写标题会有更多赞哦').inputValue(), '');
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(), /上传或处理失败/);
    } else if (mode === 'autofill-cover-fail') {
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(), /封面上传失败/);
      assert.equal(await target.locator('.cover-modal').count(),1);
    } else if (mode === 'autofill-rollback') {
      assert.match(await wb.locator('.task > p:not(.hint)').innerText(), /回读不一致/);
      assert.equal(await target.evaluate(()=>window.coverChanges), 0);
    } else {
      assert.equal(await target.locator('.tiptap').innerText(),'保留我的原稿');
      assert.equal(await target.evaluate(()=>window.changes),0);
    }
    assert.equal(await target.evaluate(()=>window.submissions+window.drafts),0);
    observations.push({scenario:mode,reason:await wb.locator('.task > p:not(.hint)').innerText(),noSubmission:true});
    if(mode==='autofill-pk-multi') {
      await wb.getByRole('button',{name:'保留素材重新打开'}).click();
      await wb.getByRole('alert').filter({hasText:'原平台页面仍然打开'}).waitFor();
      const before=(await worker.evaluate(async()=>(await chrome.storage.local.get('state')).state)).batch;
      await target.close();
      await wb.getByRole('button',{name:'保留素材重新打开'}).click();
      await wb.waitForFunction(()=>document.querySelectorAll('.task').length===2 && [...document.querySelectorAll('.task .status')].every(e=>e.textContent==='需你处理'),null,{timeout:45000});
      const reopened=await targetPage();
      assert.deepEqual(await reopened.evaluate(()=>window.coverNames),['cover.png','pk1.png','pk2.png','pk3.png']);
      const after=(await worker.evaluate(async()=>(await chrome.storage.local.get('state')).state)).batch;
      assert.equal(after.asset.id,before.asset.id);assert.deepEqual(after.publication,before.publication);assert.deepEqual(after.pkCovers,before.pkCovers);
      assert.notEqual(after.tasks[0].attemptId,after.tasks[1].attemptId);
      assert.equal(await reopened.evaluate(()=>window.submissions+window.drafts),0);
      await reopened.close();
    }

    await clear(); await target.close();
  }
  }
  scenario='douyin-popup';await prepare();
  await wb.getByRole('checkbox',{name:/小红书/}).uncheck();await wb.getByRole('checkbox',{name:/抖音/}).check();
  await wb.getByLabel('标题',{exact:true}).fill('抖音标题');await wb.getByLabel('内容描述',{exact:true}).fill('作品简介');
  await wb.getByRole('button',{name:'开始文件交接验证'}).click();
  await wb.getByText('填写完成，待检查',{exact:true}).waitFor({timeout:30000});
  const dyTask=await worker.evaluate(async()=>(await chrome.storage.local.get('state')).state.batch.tasks.at(-1));
  assert.match(dyTask.reason,/已核验：不允许他人下载\/保存/);
  assert.equal(dyTask.pipelineStage,'review');
  assert.equal(dyTask.videoAlreadyTransferred,true);assert.notEqual(dyTask.tabId,dyTask.uploadTabId);
  const dyUpload=context.pages().find(p=>p.url().includes('/content/upload?enter_from=dou_web'));
  const dyEditor=context.pages().find(p=>p.url().includes('/post/video?enter_from=publish_page'));
  assert.equal(await dyEditor.locator('input[value="0"]').isChecked(),true);
  assert.equal(await dyEditor.locator('input[value="1"]').isChecked(),false);
  assert.equal(await dyUpload.evaluate(()=>window.changes),1);
  assert.equal(await dyEditor.getByPlaceholder('填写作品标题，为作品获得更多流量').inputValue(),'抖音标题');
  assert.equal(await dyEditor.evaluate(()=>window.submissions),0);
  observations.push({scenario:'douyin-popup',noDuplicateUpload:true,noSubmission:true});
  await clear();await dyUpload.close();await dyEditor.close();
  const storage = await worker.evaluate(async () => ({ state: (await chrome.storage.local.get('state')).state, estimate: await navigator.storage.estimate() }));
  assert.equal(storage.state.batch, undefined);
  assert.equal(storage.state.grants.length, 0);
  assert.equal(storage.state.claims.length, 0);
  assert.deepEqual(failures, []);
  await writeFile('artifacts/browser-results.json', JSON.stringify({ browser: context.browser()?.version(), observations, checks: ['two origins share bytes', 'no submit or draft', 'no duplicate after reload', 'existing content protected', 'ambiguous input refused', 'trusted edit takeover', 'navigation pauses', 'workbench disconnect pauses', 'cleared metadata'], storage, failures }, null, 2));
  console.log(process.argv.includes('--douyin-only')?'PASS: unpacked extension Douyin popup handoff, single upload and no submission':'PASS: real unpacked extension, two local origins, bytes, no submission, lifecycle and cleanup');
  }
} catch (error) {
  for (const [index, page] of context.pages().entries()) {
    try { console.error('PAGE', page.url(), (await page.content()).slice(0, 3000)); await page.screenshot({ path: `artifacts/failure-${index}.png` }); } catch {}
  }
  console.error('WORKERS', JSON.stringify(await Promise.all(context.serviceWorkers().map(w => w.evaluate(async () => ({state: (await chrome.storage.local.get('state')).state, tabs: await chrome.tabs.query({})})))), null, 2));
  throw error;
} finally { await context.close(); await new Promise(resolve => server.close(resolve)); await rm(scratch, { recursive: true, force: true }); }
