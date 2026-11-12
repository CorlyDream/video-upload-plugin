import {hasPublication} from './publication';
import {isActive, type Task} from './model';
export type StepState = 'done' | 'active' | 'pending' | 'stopped' | 'unknown';
export interface ProgressStep {id:string;label:string;state:StepState}
export function taskProgress(task:Task):{steps:ProgressStep[];current:ProgressStep} {
 const plan=[{id:'page',label:'打开并检查页面'},{id:'transfer',label:'交接视频文件'}];
 const supported=['xiaohongshu','kuaishou','douyin','weixin','bilibili'].includes(task.platform);
 const fill=supported && (hasPublication(task.publication)||task.coverAssetId||task.coverPk!==undefined);
 if(fill){
  plan.push({id:'upload',label:'等待视频上传与处理'},{id:'copy',label:task.platform==='kuaishou'?'填写并核验作品描述（标题和标签）':task.platform==='weixin'?'填写并核验短标题和视频描述':task.platform==='bilibili'?'填写并核验标题和简介':'填写并核验标题、正文和标签'});
  if(task.coverPk!==undefined)plan.push({id:'pk',label:task.coverPk?'开启封面 PK':'关闭封面 PK'});
  const count=task.coverAssetId?1+(task.platform==='kuaishou'?(task.coverPk?Math.min(1,task.pkCoverAssetIds?.length??0):0):(task.pkCoverAssetIds?.length??0)):0;
  for(let i=0;i<count;i++)for(const [suffix,label] of [['open','打开编辑器'],['baseline','等待原预览就绪'],['upload','上传与校验'],['confirm','确认封面结果']])
   plan.push({id:`cover-${i}-${suffix}`,label:`封面 ${i+1}/${count} · ${label}`});
 }
 if(supported && task.platform !== 'weixin' && task.platform !== 'bilibili')plan.push({id:'downloads',label:'禁止他人下载/保存并核验'});
 plan.push({id:'review',label:'人工检查编辑页'});
 const stage=task.pipelineStage ?? ((task.reason.startsWith('标题、正文已回读核验；') || task.reason.startsWith('视频号短标题和视频描述已回读核验；') || task.reason.startsWith('B站标题和简介已回读核验；'))?'review':undefined);
 const index=plan.findIndex(s=>s.id===stage);
 const steps:ProgressStep[]=plan.map((s,i)=>({...s,state:index<0 || (s.id==='downloads' && stage==='review' && !task.reason.includes('已核验：不允许他人下载/保存'))?'unknown':i<index?'done':i>index||s.id==='review'?'pending':isActive(task.status)?'active':'stopped'}));
 return {steps,current:steps[index]??{id:'unknown',label:'具体步骤未记录',state:'unknown'}};
}
