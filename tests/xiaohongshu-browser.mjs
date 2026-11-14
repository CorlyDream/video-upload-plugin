import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/xiaohongshu.ts',name:'xh',formats:['iife']}}});
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(f=>f.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
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
} finally { await browser.close(); }
