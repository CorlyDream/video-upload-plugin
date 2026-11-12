export interface Publication { title: string; description: string; tags: string[] }
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
  if (typeof title !== 'string' || typeof description !== 'string' || !Array.isArray(raw) || raw.some(tag => typeof tag !== 'string')) throw new Error('文案格式无效');
  const tags = [...new Set(raw.map(tag => tag.trim().replace(/^#+/, '')).filter(Boolean))];
  if (xiaohongshuLimits && title.length > 20) throw new Error('小红书标题最多 20 字，请修改后再开始');
  if ((xiaohongshuLimits && tags.length > 10) || tags.some(tag => /[\s#]/u.test(tag) || tag.length > 30)) throw new Error('标签最多 10 个，每个最多 30 字，不能包含空格或 #');
  const result = { title, description, tags };
  if (xiaohongshuLimits && publicationBody(result).length > 1000) throw new Error('正文和标签合计最多 1000 字，请修改后再开始');
  return result;
}
export function hasPublication(value?: Publication): boolean {
  return !!value && !!(value.title || value.description || value.tags.length);
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
