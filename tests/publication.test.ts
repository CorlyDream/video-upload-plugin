import { expect, it } from 'vitest';
import { normalizePublication, publicationBody, kuaishouDescription, parseTags } from '../src/core/publication';

it('parses comma, line and hash separated tags with surrounding spaces', () => {
  expect(parseTags(' #趣味英语动画#情景英语 #生活英语\n亲子英语, 早教益智启蒙 ')).toEqual([
    '趣味英语动画', '情景英语', '生活英语', '亲子英语', '早教益智启蒙',
  ]);
});

it('keeps exact copy and deduplicates user supplied tags', () => {
  const draft = normalizePublication({ title: ' 小熊洗脸 ', description: '第一行\n第二行', tags: ['#英语启蒙', '英语启蒙', '亲子英语'] });
  expect(draft.title).toBe(' 小熊洗脸 ');
  expect(draft.tags).toEqual(['英语启蒙', '亲子英语']);
  expect(publicationBody(draft)).toBe('第一行\n第二行\n\n#英语启蒙 #亲子英语');
});
it('rejects invalid or too long values instead of truncating user content', () => {
  expect(() => normalizePublication({ title: 3 } as never)).toThrow();
  expect(() => normalizePublication({ title: '长'.repeat(21) })).toThrow(/标题/);
  expect(() => normalizePublication({ description: '字'.repeat(1000), tags: ['话题'] })).toThrow(/正文/);
  expect(() => normalizePublication({ tags: ['不合法 空格'] })).toThrow(/标签/);
  expect(() => normalizePublication({ tags: Array.from({length:11}, (_,i)=>`标签${i}`) })).toThrow(/标签/);
});
it('defaults old batches to an empty publication', () => {
  expect(normalizePublication(undefined)).toEqual({title:'',description:'',tags:[]});
});

it('uses only the title and first four tags for Kuaishou without changing the shared copy', () => {
  const value = {title:'小熊洗脸', description:'不要填入快手的正文', tags:['一','二','三','四','五']};
  expect(kuaishouDescription(value)).toBe('小熊洗脸\n#一 #二 #三 #四');
  expect(value.tags).toHaveLength(5);
  expect(publicationBody(value)).toContain('不要填入快手的正文');
  expect(kuaishouDescription({...value,title:'',tags:[]})).toBe('');
});
it('can normalize shared copy without applying Xiaohongshu limits to Kuaishou',()=>{
  const raw={title:'标题',description:'正'.repeat(1001),tags:Array.from({length:12},(_,i)=>`标签${i+1}`)};
  const shared=normalizePublication(raw,false);
  expect(kuaishouDescription(shared)).toBe('标题\n#标签1 #标签2 #标签3 #标签4');
  expect(shared.tags).toHaveLength(12);
  expect(()=>normalizePublication(shared)).toThrow();
});
