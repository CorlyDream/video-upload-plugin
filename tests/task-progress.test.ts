import {expect,it} from 'vitest';
import {taskProgress} from '../src/core/task-progress';
import type {Task} from '../src/core/model';
const task={assetId:'video',createdAt:0,batchId:'batch',taskId:'task',attemptId:'attempt',tabId:1,documentId:'document',step:1,platform:'xiaohongshu',status:'transferring',reason:'正在处理',coverAssetId:'main',pkCoverAssetIds:['a','b','c'],coverPk:true,publication:{title:'标题',description:'内容',tags:[]},pipelineStage:'cover-2-upload'} as Task;
it('shows completed, active and pending steps for the exact cover stage',()=>{
 const p=taskProgress(task);
 expect(p.current.label).toBe('封面 3/4 · 上传与校验');
 expect(p.steps.find(s=>s.id==='copy')?.state).toBe('done');
 expect(p.current.state).toBe('active');
 expect(p.steps.find(s=>s.id==='cover-3-open')?.state).toBe('pending');
});
it('stops the current stage instead of showing it as running after a timeout',()=>{
 const p=taskProgress({...task,status:'needs_attention',reason:'等待超过 120 秒'});
 expect(p.current.state).toBe('stopped');
 expect(p.steps.filter(s=>s.state==='active')).toHaveLength(0);
});
it('completes the handoff step when automation finishes',()=>{
 const p=taskProgress({...task,pipelineStage:'review',status:'needs_attention',reason:'标题、正文已回读核验；'});
 expect(p.current).toMatchObject({id:'review',state:'done'});
 expect(p.steps.map(s=>s.id)).not.toContain('downloads');
 expect(p.steps.every(s=>s.state==='done')).toBe(true);
});
it('recognizes earlier completed records without a stage',()=>{
 const p=taskProgress({...task,pipelineStage:undefined,status:'needs_attention',reason:'标题、正文已回读核验；请人工检查'});
 expect(p.current).toMatchObject({id:'review',state:'done'});
});
it('keeps an explicit automation failure stopped even if the copy was verified',()=>{
 const p=taskProgress({...task,status:'needs_attention',reason:'标题、正文已回读核验；封面处理未完成'});
 expect(p.current.state).toBe('stopped');
 expect(p.steps.at(-1)).toMatchObject({id:'review',state:'pending'});
});
it('shows verified Bilibili drafts as handed off',()=>{
 const p=taskProgress({...task,platform:'bilibili',coverAssetId:undefined,coverPk:undefined,pipelineStage:'review',status:'needs_attention',
  completedStages:['page','transfer','upload','copy','declaration','category','draft'],
  bilibiliDraft:{phase:'saved',cid:1,filename:'video',beforeIds:[],draftId:2}});
 expect(p.current).toMatchObject({id:'review',state:'done'});
 expect(p.steps.every(s=>s.state==='done')).toBe(true);
});
it('does not invent progress for old generic timeout records',()=>{
 const p=taskProgress({...task,pipelineStage:undefined,status:'needs_attention',reason:'等待页面确认超时'});
 expect(p.current.label).toBe('具体步骤未记录');
 expect(p.steps.every(s=>s.state==='unknown')).toBe(true);
});
it('only includes relevant stages for file handoff platforms',()=>{
 const p=taskProgress({...task,platform:'unknown-platform' as Task['platform'],pipelineStage:'transfer'});
 expect(p.steps.map(s=>s.id)).toEqual(['page','transfer','review']);
});
it('shows Bilibili metadata stage without download stage',()=>{
 const p=taskProgress({...task,platform:'bilibili',coverAssetId:undefined,pkCoverAssetIds:[],coverPk:undefined,pipelineStage:'copy'});
 expect(p.steps.map(s=>s.id)).toEqual(['page','transfer','upload','copy','declaration','category','review']);
 expect(p.current.label).toBe('填写并核验标题、简介和标签');
});
it('shows Kuaishou description and exactly two cover slots',()=>{
 const p=taskProgress({...task,platform:'kuaishou',pipelineStage:'cover-1-upload'});
 expect(p.current.label).toBe('封面 2/2 · 上传与校验');
 expect(p.steps.find(s=>s.id==='copy')?.label).toBe('填写并核验作品描述（标题和标签）');
 expect(p.steps.some(s=>s.id==='cover-2-open')).toBe(false);
});
it('waits for Video Channels default covers before opening their editors',()=>{
 const p=taskProgress({...task,platform:'weixin',pkCoverAssetIds:['portrait'],pipelineStage:'cover-0-baseline'});
 expect(p.current.label).toBe('封面 1/2 · 等待视频号生成默认封面');
 expect(p.current.state).toBe('active');
 expect(p.steps.find(s=>s.id==='cover-0-open')?.state).toBe('pending');
 expect(p.steps.findIndex(s=>s.id==='cover-0-baseline')).toBeLessThan(p.steps.findIndex(s=>s.id==='cover-0-open'));
});

it('shows the Douyin collection stage when a collection was requested',()=>{
 const p=taskProgress({...task,platform:'douyin',publication:{title:'',description:'',tags:[],collection:'英语启蒙合集'},coverAssetId:undefined,pkCoverAssetIds:[],coverPk:undefined,pipelineStage:'collection'});
 expect(p.current.label).toBe('选择并核验抖音合集');
 expect(p.steps.map(s=>s.id)).toContain('collection');
});
it('shows the Xiaohongshu schedule stage when requested',()=>{
 const p=taskProgress({...task,publication:{title:'',description:'',tags:[],scheduleAt:'2099-01-02T03:04'},coverAssetId:undefined,pkCoverAssetIds:[],coverPk:undefined,pipelineStage:'schedule'});
 expect(p.current.label).toBe('设置并核验定时发布时间');
 expect(p.steps.map(s=>s.id)).toContain('schedule');
});

it('keeps download settings visible even when no metadata was supplied',()=>{
 const douyin:Task={...task,platform:'douyin',publication:undefined,coverAssetId:undefined,coverPk:undefined,pipelineStage:'downloads'};
 const p=taskProgress(douyin);
 expect(p.current.state).toBe('active');
 expect(p.steps.map(s=>s.id)).toEqual(['page','transfer','downloads','review']);
 expect(taskProgress({...douyin,status:'needs_attention'}).current.state).toBe('stopped');
 const finished=taskProgress({...douyin,pipelineStage:'review',status:'needs_attention',reason:'已核验：不允许他人下载/保存。'});
 expect(finished.current).toMatchObject({id:'review',state:'done'});
 expect(finished.steps.every(s=>s.state==='done')).toBe(true);
});

it('does not claim download protection for earlier completed records',()=>{
 expect(taskProgress({...task,platform:'douyin',pipelineStage:'review',status:'needs_attention'}).steps.find(s=>s.id==='downloads')?.state).toBe('unknown');
});

it('does not invent Bilibili field or cover completion from a later stage',()=>{
 const p=taskProgress({...task,platform:'bilibili',coverPk:undefined,pkCoverAssetIds:[],pipelineStage:'review',status:'needs_attention',reason:'旧直传记录',completedStages:['page','transfer','upload']});
 expect(p.steps.find(s=>s.id==='upload')?.state).toBe('done');
 expect(p.current).toMatchObject({id:'review',state:'done'});
 expect(p.steps.find(s=>s.id==='declaration')?.state).toBe('unknown');
 expect(p.steps.map(s=>s.id)).not.toContain('draft');
 expect(p.steps.filter(s=>s.id.startsWith('cover-')).every(s=>s.state!=='done')).toBe(true);
});
