/** Keep invocation inside the click gesture; a late reply must never restart a cancelled task. */
export function requestPermission(request: () => Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new Error('操作已停止'));return;}
    let settled=false;
    const finish=(value?:boolean,error?:unknown)=>{
      if(settled)return;
      settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(value === true);
    };
    const abort=()=>finish(undefined,new Error('操作已停止'));
    const timer=setTimeout(()=>finish(undefined,new Error('浏览器未返回站点授权结果，已停止等待；请检查浏览器权限提示。本次未开始上传。')),30000);
    signal.addEventListener('abort',abort,{once:true});
    try { request().then(value=>finish(value),error=>finish(undefined,error)); }
    catch(error){finish(undefined,error);}
  });
}
