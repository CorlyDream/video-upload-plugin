import {afterEach,expect,it,vi} from 'vitest';
import {waitFor} from '../src/extension/xiaohongshu';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('allows a cover result arriving after the old 30 second limit',async()=>{
 vi.useFakeTimers();let ready=false;
 const result=waitFor(()=>ready?'done':undefined,new AbortController().signal,120000,false,'第 1/4 张封面：上传与校验');
 await vi.advanceTimersByTimeAsync(35000);ready=true;
 await vi.advanceTimersByTimeAsync(250);expect(await result).toBe('done');expect(vi.getTimerCount()).toBe(0);
});
it('reports the exact stage and duration at the bounded deadline',async()=>{
 vi.useFakeTimers();
 const result=waitFor(()=>undefined,new AbortController().signal,90000,false,'第 2/4 张封面：确认保存结果');
 const failure=expect(result).rejects.toThrow('第 2/4 张封面：确认保存结果等待超过 90 秒');
 await vi.advanceTimersByTimeAsync(90000);await failure;expect(vi.getTimerCount()).toBe(0);
});
it('still cancels immediately during the extended wait',async()=>{
 vi.useFakeTimers();const controller=new AbortController();
 const result=waitFor(()=>undefined,controller.signal,120000);
 const failure=expect(result).rejects.toThrow('操作已停止');
 controller.abort();await failure;expect(vi.getTimerCount()).toBe(0);
});
it('pauses cover deadline while hidden and resumes without repeating completed work',async()=>{
 vi.useFakeTimers();const page=new EventTarget();let visible=false;
 Object.defineProperty(page,'visibilityState',{get:()=>visible?'visible':'hidden'});
 vi.stubGlobal('document',page);
 const read=vi.fn(()=>undefined);const visibility=vi.fn();
 const result=waitFor(read,new AbortController().signal,90000,false,'封面确认',visibility);
 const failure=expect(result).rejects.toThrow('90 秒');
 await vi.advanceTimersByTimeAsync(180000);
 expect(read).not.toHaveBeenCalled();expect(visibility).toHaveBeenLastCalledWith(false);
 visible=true;page.dispatchEvent(new Event('visibilitychange'));
 await vi.advanceTimersByTimeAsync(89000);expect(visibility).toHaveBeenLastCalledWith(true);
 await vi.advanceTimersByTimeAsync(1000);await failure;expect(vi.getTimerCount()).toBe(0);
 vi.unstubAllGlobals();
});
