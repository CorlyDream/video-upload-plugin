import {build} from 'vite';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'src/extension/downloads.ts',name:'privacy',formats:['iife']}}});
const code=(Array.isArray(result)?result[0]:result).output.find(f=>f.type==='chunk').code;
const browser=await chromium.launch({headless:true});
try {for(const platform of ['kuaishou','douyin','xiaohongshu'])for(const mode of ['allowed','denied','missing','ambiguous','rollback','cancel']){
 const page=await browser.newPage();
 const control=platform==='kuaishou'?`<label><input type="checkbox" value="downloadType" ${mode==='denied'?'':'checked'}>允许下载此作品</label>`:platform==='douyin'?`<div class="download-content-test"><label><input type="checkbox" value="1" ${mode==='denied'?'':'checked'}>允许</label><label><input type="checkbox" value="0" ${mode==='denied'?'checked':''}>不允许</label></div>`:'';
 await page.setContent(`<div id="work-description-edit"></div><div data-slate-editor="true"></div><label><input id="other" type="checkbox" checked>公开可见</label><button id="publish">发布</button><button id="draft">存草稿</button>${mode==='missing'?'':control}${mode==='ambiguous'?control:''}`);
 await page.evaluate(({platform,mode})=>{window.clicks=0;window.submissions=0;document.querySelectorAll('button').forEach(b=>b.onclick=()=>submissions++);document.querySelectorAll('input:not(#other)').forEach(e=>e.onclick=()=>{clicks++;if(platform==='douyin')document.querySelector('input[value="1"]').checked=false;if(mode==='rollback')setTimeout(()=>{document.querySelector('input[value="'+(platform==='douyin'?'0':'downloadType')+'"]').checked=platform!=='douyin';},10);});}, {platform,mode});
 await page.addScriptTag({content:code});
 const actual=await page.evaluate(async({platform,mode})=>{const abort=new AbortController();if(mode==='cancel')abort.abort();try{return await privacy.disableDownloads(platform,{signal:abort.signal,edit:fn=>fn(),progress:()=>{}});}catch(e){return {error:e.message};}},{platform,mode});
 const state=await page.evaluate(()=>({clicks,submissions,other:document.querySelector('#other').checked}));
 assert.equal(state.submissions,0);assert.equal(state.other,true);
 if(mode==='cancel')assert.ok(actual.error);
 else if(platform==='xiaohongshu'||mode==='missing'){assert.equal(actual.verified,false);assert.equal(state.clicks,0);}
 else if(['ambiguous','rollback'].includes(mode))assert.ok(actual.error);
 else {assert.equal(actual.verified,true);assert.equal(state.clicks,mode==='denied'?0:1);}
 console.log('DOWNLOADS',platform,mode,actual);await page.close();
}}finally{await browser.close();}
