import {describe,expect,it} from 'vitest';
import {findBilibiliDraft,verifyBilibiliDraft} from '../src/extension/bilibili-draft';
import type {BilibiliDraftCheckpoint} from '../src/core/model';
const checkpoint:BilibiliDraftCheckpoint={phase:'saving',cid:123,filename:'video',beforeIds:[1]};
const publication={title:'标题',description:'简介',tags:['英语']};
const draft={id:2,title:'标题',desc:'简介',tag:'英语,动画',videos:[{cid:123,filename:'video'}],cover43:'cover'};
describe('Bilibili durable draft identity',()=>{
 it('reconciles a lost save response by video identity, excluding existing drafts',()=>{
  expect(findBilibiliDraft(checkpoint,[{id:1,cid:123},{id:2,cid:123},{id:3,cid:456}])).toBe(2);
  expect(findBilibiliDraft(checkpoint,[{id:1,cid:123}])).toBeUndefined();
  expect(()=>findBilibiliDraft(checkpoint,[{id:2,cid:123},{id:3,cid:123}])).toThrow('多个');
 });
 it('verifies an existing draft by its persisted id, never creates another',()=>{
  expect(findBilibiliDraft({...checkpoint,draftId:2},[])).toBe(2);
  expect(()=>verifyBilibiliDraft({...checkpoint,draftId:2},draft,publication,true)).not.toThrow();
 });
 it.each([
  [{...draft,id:3},'身份'],[{...draft,videos:[{cid:456,filename:'video'}]},'身份'],
  [{...draft,videos:[{cid:123,filename:'other'}]},'身份'],[{...draft,title:'merged'},'标题'],
  [{...draft,desc:''},'简介'],[{...draft,tag:'动画'},'标签'],[{...draft,cover43:''},'封面'],
 ])('rejects a persisted draft with incorrect video or fields', (value,message)=>{
  expect(()=>verifyBilibiliDraft({...checkpoint,draftId:2},value,publication,true)).toThrow(message);
 });
 it('exempts only explicitly rejected tags and still verifies every remaining tag',()=>{
  const config={...publication,tags:['拒绝的标签','英语']};
  const saved={...checkpoint,draftId:2,rejectedTags:[{tag:'拒绝的标签',reason:'话题专用标签'}]};
  expect(()=>verifyBilibiliDraft(saved,draft,config,true)).not.toThrow();
  expect(()=>verifyBilibiliDraft(saved,{...draft,tag:'动画'},config,true)).toThrow('标签');
  expect(config.tags).toEqual(['拒绝的标签','英语']);
 });
 it('verifies the persisted parenting category independently of tag completion',()=>{
  const saved={...checkpoint,draftId:2,categoryTid:193};
  expect(()=>verifyBilibiliDraft(saved,{...draft,tid:193},publication,true)).not.toThrow();
  expect(()=>verifyBilibiliDraft(saved,{...draft,tid:21},publication,true)).toThrow('分区');
 });
});
