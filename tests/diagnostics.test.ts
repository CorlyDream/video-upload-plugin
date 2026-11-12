import {expect,it} from 'vitest';
import {createDiagnostics} from '../src/core/diagnostics';
it('serializes concurrent writes, bounds records, and keeps only approved metadata',async()=>{
 const data:Record<string,unknown>={};
 const log=createDiagnostics('workbench',{get:async()=>data,set:async value=>{Object.assign(data,value)}},3);
 await Promise.all(Array.from({length:5},(_,i)=>log.record('start.clicked',{count:i,title:'secret',token:'secret',connected:true})));
 const entries=data['diagnostics.workbench'] as any[];
 expect(entries).toHaveLength(3);expect(entries.map(e=>e.details.count)).toEqual([2,3,4]);
 expect(JSON.stringify(entries)).not.toContain('secret');
});
it('logging failures never break the workflow and future writes recover',async()=>{
 let fail=true;const data:Record<string,unknown>={};
 const log=createDiagnostics('background',{get:async()=>data,set:async value=>{if(fail)throw Error('quota');Object.assign(data,value)}});
 await expect(log.record('connected')).resolves.toBeUndefined();fail=false;
 await log.record('connected');expect(data['diagnostics.background']).toBeDefined();
});
it('exports historical task errors without exporting publication or asset data',async()=>{
 const {diagnosticTask}=await import('../src/core/diagnostics');
 const summary=diagnosticTask({taskId:'task',tabId:123,platform:'xiaohongshu',status:'needs_attention',step:0,reason:'No tab with id: 123.',publication:{title:'secret'},assetId:'secret'});
 expect(summary.code).toBe('tab_not_found');expect(summary.tabId).toBe(123);
 expect(JSON.stringify(summary)).not.toContain('secret');
});
