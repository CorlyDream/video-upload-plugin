type Store = {get: (key: string)=>Promise<Record<string,unknown>>;set:(value:Record<string,unknown>)=>Promise<unknown>};
const allowed = new Set(['count','connected','busy','active','running','command','requestId','status','step','platform','result','code','tabId','taskId','phase']);
export function createDiagnostics(source:string,storage:Store,limit=300){
  const key=`diagnostics.${source}`;let queue=Promise.resolve();
  return {record(event:string,details:Record<string,unknown>={}){
    const clean=Object.fromEntries(Object.entries(details).filter(([key,value])=>allowed.has(key)&&['string','boolean','number'].includes(typeof value)).map(([key,value])=>[key,typeof value==='string'?value.slice(0,160):value]));
    queue=queue.then(async()=>{
      const saved=(await storage.get(key))[key];
      const entries=Array.isArray(saved)?saved:[];
      await storage.set({[key]:[...entries,{time:new Date().toISOString(),source,event,details:clean}].slice(-limit)});
    }).catch(()=>{/* Diagnostics must not stop upload or create unhandled rejections. */});
    return queue;
  }};
}
export function diagnosticCode(error:unknown):string {
 const message=error instanceof Error?error.message:String(error ?? '');
 if(/No tab with id/i.test(message))return 'tab_not_found';
 if(/Cannot access|permission|授权/i.test(message))return 'permission_denied';
 if(/Receiving end does not exist|Could not establish connection/i.test(message))return 'content_connection_missing';
 if(/超时|timeout/i.test(message))return 'timeout';
 if(/连接|disconnect/i.test(message))return 'disconnected';
 if(/跳转|导航/.test(message))return 'navigation_changed';
 if(/关闭/.test(message))return 'tab_closed';
 return 'unclassified';
}
export function diagnosticTask(task:Record<string,unknown>){
 return {taskId:task.taskId,tabId:task.tabId,platform:task.platform,status:task.status,step:task.step,phase:task.diagnosticPhase ?? 'legacy_unknown',code:diagnosticCode(task.reason)};
}
