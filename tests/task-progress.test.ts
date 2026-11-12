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
it('keeps manual review pending after all automatic steps finish',()=>{
 const p=taskProgress({...task,pipelineStage:'review',status:'needs_attention',reason:'已核验：不允许他人下载/保存。'});
 expect(p.current.state).toBe('pending');
 expect(p.steps.slice(0,-1).every(s=>s.state==='done')).toBe(true);
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
 expect(p.steps.map(s=>s.id)).toEqual(['page','transfer','upload','copy','review']);
 expect(p.current.label).toBe('填写并核验标题和简介');
});
it('shows Kuaishou description and exactly two cover slots',()=>{
 const p=taskProgress({...task,platform:'kuaishou',pipelineStage:'cover-1-upload'});
 expect(p.current.label).toBe('封面 2/2 · 上传与校验');
 expect(p.steps.find(s=>s.id==='copy')?.label).toBe('填写并核验作品描述（标题和标签）');
 expect(p.steps.some(s=>s.id==='cover-2-open')).toBe(false);
});

it('keeps download settings visible even when no metadata was supplied',()=>{
 const p=taskProgress({...task,platform:'douyin',publication:undefined,coverAssetId:undefined,coverPk:undefined,pipelineStage:'downloads'});
 expect(p.current.state).toBe('active');
 expect(p.steps.map(s=>s.id)).toEqual(['page','transfer','downloads','review']);
 expect(taskProgress({...task,pipelineStage:'downloads',status:'needs_attention'}).current.state).toBe('stopped');
});

it('does not claim download protection for earlier completed records',()=>{
 expect(taskProgress({...task,pipelineStage:'review',status:'needs_attention'}).steps.find(s=>s.id==='downloads')?.state).toBe('unknown');
});
