/** Shared copy plus optional platform-specific settings. */
export interface Publication { title: string; description: string; tags: string[]; collection?: string; scheduleAt?: string }
export const scheduleWindowMs = 7 * 24 * 60 * 60 * 1000;
export function parseTags(value: string): string[] {
  return value.split(/[,，\n]+/u).flatMap(part => part.split('#')).map(tag => tag.trim()).filter(Boolean);
}
export function publicationBody(value: Publication): string {
  return [value.description, value.tags.map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n');
}
export function normalizePublication(value?: Partial<Publication>, xiaohongshuLimits = true): Publication {
  const title = value?.title ?? '';
  const description = value?.description ?? '';
  const raw = value?.tags ?? [];
  const collection = value?.collection;
  const scheduleAt = value?.scheduleAt;
  if (typeof title !== 'string' || typeof description !== 'string' || !Array.isArray(raw) || raw.some(tag => typeof tag !== 'string') || (collection !== undefined && typeof collection !== 'string') || (scheduleAt !== undefined && typeof scheduleAt !== 'string')) throw new Error('文案格式无效');
  if (scheduleAt !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduleAt) || !Number.isFinite(Date.parse(scheduleAt)))) throw new Error('定时发布时间格式无效，请重新选择时间');
  if (scheduleAt !== undefined && Date.parse(scheduleAt) <= Date.now()) throw new Error('定时发布时间必须晚于当前时间');
  if (scheduleAt !== undefined && Date.parse(scheduleAt) > Date.now() + scheduleWindowMs) throw new Error('定时发布时间只能设置在未来 7 天内');
  const tags = [...new Set(raw.map(tag => tag.trim().replace(/^#+/, '')).filter(Boolean))];
  if (xiaohongshuLimits && title.length > 20) throw new Error('小红书标题最多 20 字，请修改后再开始');
  if ((xiaohongshuLimits && tags.length > 10) || tags.some(tag => /[\s#]/u.test(tag) || tag.length > 30)) throw new Error('标签最多 10 个，每个最多 30 字，不能包含空格或 #');
  const result: Publication = { title, description, tags };
  if (collection?.trim()) result.collection = collection.trim();
  if (scheduleAt) result.scheduleAt = scheduleAt;
  if (xiaohongshuLimits && publicationBody(result).length > 1000) throw new Error('正文和标签合计最多 1000 字，请修改后再开始');
  return result;
}
export function hasPublication(value?: Publication): boolean {
  return !!value && !!(value.title || value.description || value.tags.length || value.collection || value.scheduleAt);
}

/** Kuaishou has one description field; shared body copy is deliberately excluded. */
export function kuaishouDescription(value: Publication): string {
  return [value.title, value.tags.slice(0, 4).map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n');
}
export function normalizeDouyinPublication(value?:Partial<Publication>):Publication{
  const result=normalizePublication(value,false);
  if(result.title.length>30)throw new Error('抖音标题最多 30 字，请修改后再开始');
  if(publicationBody(result).length>1000)throw new Error('抖音正文和标签合计最多 1000 字，请修改后再开始');
  return result;
}
