import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle = await build({configFile:false, logLevel:'silent', build:{write:false, lib:{entry:'src/extension/content.ts', name:'content', formats:['iife']}}});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(file => file.type === 'chunk').code;
const browser = await chromium.launch({headless:true});
const timeoutReason = '等待视频号 4:3 封面槽位等待超过 60 秒，已停止自动操作';
const cases = [
  {status:'needs_attention', stage:'cover-4:3', reason:timeoutReason, summary:/处理已停止.*处理封面/, alert:true},
  {status:'failed', stage:'copy', reason:'文案核验失败', summary:/处理失败.*文案/, alert:true},
  {status:'paused', stage:'upload', reason:'插件连接已断开，自动操作已停止', summary:/已暂停/, alert:true},
  {status:'paused', stage:'cover-4:3', reason:'插件连接已断开，自动操作已停止；请回工作台继续同步', summary:/已暂停.*处理封面/, alert:true, disconnect:true},
  {status:'aborted', stage:'cover-3:4', reason:'检测到你操作平台控件，已交由你接管', summary:/已停止/, alert:true},
  {status:'needs_attention', stage:'review', reason:'填写已核验，请检查后手动发表', summary:/插件已完成，请人工检查/, alert:false},
  {status:'transferring', stage:'cover-4:3', reason:'正在上传视频号 4:3 封面', summary:/当前进度：处理封面/, alert:false},
  {status:'transferring', stage:'cover-0-baseline', reason:'等待视频号解析并生成 4:3 默认封面', summary:/当前进度：等待视频号生成封面/, alert:false},
];

try {
  for (const scenario of cases) {
    const page = await browser.newPage();
    await page.route('https://channels.weixin.qq.com/**', route => route.fulfill({contentType:'text/html', body:'<!doctype html><title>进度夹具</title>'}));
    await page.goto('https://channels.weixin.qq.com/platform/post/create');
    await page.evaluate(() => {
      window.chrome = {runtime:{
        onConnect:{addListener:listener => window.connect = listener, removeListener:() => {}},
        sendMessage:async message => { window.resumeMessage = message; return {ok:true}; },
      }};
    });
    await page.addScriptTag({content:code});
    await page.evaluate(scenario => {
      let receive;
      let disconnect;
      window.connect({name:'upload-page', postMessage:() => {}, onMessage:{addListener:listener => receive = listener}, onDisconnect:{addListener:listener => disconnect = listener}});
      receive({type:'run', origin:location.origin, token:'fixture', task:{
        batchId:'batch', taskId:'task', attemptId:'attempt', tabId:1, documentId:'document', step:1,
        platform:'weixin', assetId:'video', createdAt:0, coverAssetId:'cover',
        status:scenario.disconnect ? 'transferring' : scenario.status, pipelineStage:scenario.stage, reason:scenario.disconnect ? '正在处理封面' : scenario.reason,
      }});
      // No upload input: stop the executor timers without changing its rendered checkpoint.
      if (scenario.disconnect) disconnect();
      else receive({type:'stop'});
    }, scenario);
    const panel = page.locator('#video-upload-plugin-progress');
    await page.mouse.move(0, 0);
    assert.match(await panel.innerText(), scenario.summary, `${scenario.status}/${scenario.stage}: compact summary must state the outcome`);
    if (scenario.alert) {
      assert.equal(await panel.getByRole('alert').isVisible(), true, 'stopped reason must be visible without hover');
      assert.ok((await panel.innerText()).includes(scenario.reason));
      assert.equal(await panel.getByRole('button', {name:'继续同步'}).isVisible(), true);
      await panel.getByRole('button', {name:'继续同步'}).click();
      assert.deepEqual(await page.evaluate(() => window.resumeMessage), {type:'resume-sync', taskId:'task'});
      await panel.evaluate(() => document.activeElement.blur());
      await page.mouse.move(0, 0);
    } else {
      assert.equal(await panel.locator('[data-progress-detail]').first().isVisible(), false, 'normal details stay compact');
      assert.equal(await panel.getByRole('alert').count(), 0);
    }
    assert.equal(await panel.locator('[data-progress-list]').isVisible(), false);
    await panel.hover();
    assert.equal(await panel.locator('[data-progress-list]').isVisible(), true);
    if (scenario.stage === 'review') {
      assert.match(await panel.locator('[data-progress-list]').innerText(), /✓\s+交接人工检查/);
    }
    await page.mouse.move(0, 0);
    assert.equal(await panel.locator('[data-progress-list]').isVisible(), false);
    if (scenario.alert) assert.equal(await panel.getByRole('alert').isVisible(), true, 'reason must survive mouseleave');
    await panel.focus();
    assert.equal(await panel.locator('[data-progress-list]').isVisible(), true, 'keyboard focus must open workflow details');
    await panel.evaluate(panel => panel.blur());
    if (scenario.alert) {
      await page.setViewportSize({width:390, height:844});
      const box = await panel.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, 'stopped message must fit a narrow viewport');
    }
    // Check actual clipping, since isVisible alone ignores the host overflow.
    const unclipped = await panel.evaluate(panel => {
      const box = panel.getBoundingClientRect();
      return [...panel.children].filter(child => getComputedStyle(child).display !== 'none').every(child => child.getBoundingClientRect().bottom <= box.bottom);
    });
    assert.equal(unclipped, true, 'compact content must not be clipped by a fixed height');
    console.log('PROGRESS', scenario.status, scenario.stage, 'PASS');
    await page.close();
  }
} finally { await browser.close(); }
