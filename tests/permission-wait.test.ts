import {afterEach,expect,it,vi} from 'vitest';
import {requestPermission} from '../src/core/permission-wait';
afterEach(()=>vi.useRealTimers());
it('calls the browser synchronously to retain the click gesture',async()=>{
 const call=vi.fn(()=>Promise.resolve(true));const promise=requestPermission(call,new AbortController().signal);
 expect(call).toHaveBeenCalledOnce();expect(await promise).toBe(true);
});
it('times out a stalled request and ignores its late approval',async()=>{
 vi.useFakeTimers();let approve!:(v:boolean)=>void;
 const promise=requestPermission(()=>new Promise(resolve=>{approve=resolve}),new AbortController().signal);
 const failed=expect(promise).rejects.toThrow('浏览器未返回站点授权结果');
 await vi.advanceTimersByTimeAsync(30000);await failed;approve(true);
 expect(vi.getTimerCount()).toBe(0);
});
it('cancels immediately while the browser prompt is pending',async()=>{
 const controller=new AbortController();const promise=requestPermission(()=>new Promise(()=>{}),controller.signal);
 controller.abort();await expect(promise).rejects.toThrow('操作已停止');
});
