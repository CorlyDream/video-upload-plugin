import type {Publication} from '../core/publication';

import type {BilibiliDraftCheckpoint} from '../core/model';

/** Read-only recovery for draft checkpoints created by older extension versions. */
export async function readBilibiliDrafts(id?: number): Promise<any> {
  if (location.origin !== 'https://member.bilibili.com') throw new Error('B 站页面已离开，未核验草稿');
  const path = id ? `/x/vupre/web/draft/view?id=${id}` : '/x/vupre/web/draft/list';
  const response = await fetch(path, {credentials: 'include', signal: AbortSignal.timeout(8000)});
  const body = await response.json();
  if (!response.ok || body.code !== 0 || !body.data || (!id && !Array.isArray(body.data))) throw new Error('B 站草稿回读失败，请检查登录状态和草稿箱');
  return body.data;
}

export function findBilibiliDraft(checkpoint: BilibiliDraftCheckpoint, drafts: {id: number; cid: number}[]): number | undefined {
  if (checkpoint.draftId) return checkpoint.draftId;
  const candidates = drafts.filter(d => Number(d.cid) === checkpoint.cid && !checkpoint.beforeIds.includes(Number(d.id)));
  if (candidates.length > 1) throw new Error('发现多个匹配草稿，请手动核对，不会再次保存');
  const id = Number(candidates[0]?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function verifyBilibiliDraft(checkpoint: BilibiliDraftCheckpoint, draft: any, publication: Publication, hasCover: boolean): void {
  const video = draft?.videos?.length === 1 ? draft.videos[0] : undefined;
  if (Number(draft?.id) !== checkpoint.draftId || Number(video?.cid) !== checkpoint.cid || video?.filename !== checkpoint.filename) throw new Error('草稿视频身份不匹配，请手动核对');
  if (draft.title !== publication.title || (draft.desc ?? '') !== publication.description) throw new Error('草稿标题或简介与工作台不一致，请在草稿页检查');
  const tags = typeof draft.tag === 'string' ? draft.tag.split(',') : [];
  const rejected = new Set(checkpoint.rejectedTags?.map(item=>item.tag) ?? []);
  if (!publication.tags.filter(tag=>!rejected.has(tag)).every(tag => tags.includes(tag))) throw new Error('草稿标签未完整保存，请在草稿页检查');
  if (checkpoint.categoryTid && Number(draft.tid)!==checkpoint.categoryTid) throw new Error('草稿亲子分区未保存，请在草稿页检查');
  if (hasCover && !draft.cover43 && !draft.cover) throw new Error('草稿封面未保存，请在草稿页检查');
}


