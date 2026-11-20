import {hasPublication} from './publication';
import {hasDownloadSettings, isActive, type Task} from './model';
export type StepState = 'done' | 'active' | 'pending' | 'stopped' | 'unknown';
export interface ProgressStep {id:string;label:string;state:StepState}

export function isReviewReady(task: Pick<Task, 'status' | 'pipelineStage' | 'reason' | 'bilibiliDraft'>): boolean {
 if (task.bilibiliDraft) return task.bilibiliDraft.phase === 'saved';
 if (task.status !== 'needs_attention') return false;
 if (task.pipelineStage !== undefined) return task.pipelineStage === 'review';
 return /^(标题、正文已回读核验；|作品描述已回读核验|抖音标题、简介已回读核验；|视频号短标题和视频描述已回读核验；|B站标题和简介已回读核验；)/.test(task.reason)
  && !/封面处理未完成|封面编辑器无法加载视频|封面弹窗没有可用上传入口|等待你在旧版编辑器点击|封面已存在，未重复上传/.test(task.reason);
}

export function taskProgress(task:Task):{steps:ProgressStep[];current:ProgressStep} {
 const plan=[{id:'page',label:'打开并检查页面'},{id:'transfer',label:'交接视频文件'}];
 const supported=['xiaohongshu','kuaishou','douyin','weixin','bilibili'].includes(task.platform);
 const fill=supported && (task.platform === 'bilibili'||hasPublication(task.publication)||task.publication?.collection||task.publication?.scheduleAt||task.coverAssetId||task.coverPk!==undefined);
 if(fill){
  plan.push({id:'upload',label:'等待视频上传与处理'},{id:'copy',label:task.platform==='kuaishou'?'填写并核验作品描述（标题和标签）':task.platform==='weixin'?'填写并核验短标题和视频描述':task.platform==='bilibili'?'填写并核验标题、简介和标签':'填写并核验标题、正文和标签'});
  if(task.coverPk!==undefined)plan.push({id:'pk',label:task.coverPk?'开启封面 PK':'关闭封面 PK'});
  plan.push({id:'declaration',label:'设置原创 / AI 生成声明'});
  if(task.platform==='bilibili')plan.push({id:'category',label:'选择并核验亲子分区'});
  if((task.platform==='douyin' || task.platform==='xiaohongshu') && task.publication?.collection)plan.push({id:'collection',label:`选择并核验${task.platform==='douyin'?'抖音':'小红书'}合集`});
  if(task.publication?.scheduleAt)plan.push({id:'schedule',label:task.platform==='xiaohongshu'?'设置并核验定时发布时间':`设置并核验${task.platform==='douyin'?'抖音':task.platform==='kuaishou'?'快手':task.platform==='weixin'?'视频号':'B 站'}定时发布时间`});
  const count=task.coverAssetId?1+(task.platform==='kuaishou'?(task.coverPk?Math.min(1,task.pkCoverAssetIds?.length??0):0):(task.pkCoverAssetIds?.length??0)):0;
  const coverSteps=task.platform==='weixin'?[['baseline','等待视频号生成默认封面'],['open','打开编辑器'],['upload','上传与校验'],['confirm','确认封面结果']]:[['open','打开编辑器'],['baseline','等待原预览就绪'],['upload','上传与校验'],['confirm','确认封面结果']];
  for(let i=0;i<count;i++)for(const [suffix,label] of coverSteps)
   plan.push({id:`cover-${i}-${suffix}`,label:`封面 ${i+1}/${count} · ${label}`});
 }
 if(hasDownloadSettings(task.platform))plan.push({id:'downloads',label:'禁止他人下载/保存并核验'});
 if(task.platform==='bilibili' && task.bilibiliDraft)plan.push({id:'draft',label:'核验旧版 B 站草稿'});
 plan.push({id:'review',label:'交接人工检查'});
 const reviewReady=isReviewReady(task);
 const stage=reviewReady?'review':task.pipelineStage;
 const index=plan.findIndex(s=>s.id===stage);
 if (task.platform === 'bilibili') {
  const completed = new Set(task.completedStages ?? []);
  if (reviewReady) completed.add('review');
  const steps:ProgressStep[] = plan.map(s=>({...s,state:completed.has(s.id)?'done':s.id===stage?(isActive(task.status)?'active':'stopped'):reviewReady?'unknown':s.id==='review'||task.completedStages?'pending':'unknown'}));
  return {steps,current:steps.find(s=>s.id===stage)??{id:'unknown',label:'具体步骤未记录',state:'unknown'}};
 }
 const steps=plan.map((s,i):ProgressStep=>{
  if(index<0 || (s.id==='downloads' && stage==='review' && !task.reason.includes('已核验：不允许他人下载/保存'))) return {...s,state:'unknown'};
  if(i<index || (i===index && reviewReady)) return {...s,state:'done'};
  if(i>index) return {...s,state:'pending'};
  return {...s,state:isActive(task.status)?'active':'stopped'};
 });
 return {steps,current:steps[index]??{id:'unknown',label:'具体步骤未记录',state:'unknown'}};
}
