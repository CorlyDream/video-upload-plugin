import { deleteBatchAssets, saveAsset } from './assets';
import { splitCovers } from './cover-order';
import { inspectCover } from './covers';
import type { Batch } from './model';
import { normalizePublication } from './publication';

export async function importBatch(message: Record<string, unknown>, origin: string, requestId: string): Promise<Batch> {
  const { video, cover, title, candidateTitles = [], tags = [], collection } = message;
  if (!(video instanceof File) || !video.type.startsWith('video/') || !video.size) {
    throw new Error('未收到视频文件，请使用支持文件消息的 Chrome 148 或更新版本');
  }
  const covers = message.covers === undefined ? [cover] : message.covers;
  if (!Array.isArray(covers) || !covers.length) {
    throw new Error('请至少选择一张封面');
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 512 ||
      !Array.isArray(candidateTitles) || candidateTitles.length > 6 ||
      candidateTitles.some(value => typeof value !== 'string' || !value.trim() || value.length > 512)) {
    throw new Error('标题或候选标题格式无效');
  }
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || /[,，]/u.test(tag))) {
    throw new Error('标签格式无效');
  }
  if (collection !== undefined && typeof collection !== 'string') {
    throw new Error('合集名称格式无效');
  }
  const publication = normalizePublication({ title: title.trim(), tags, collection }, false);
  const formats = covers.length > 1 ? ['image/jpeg', 'image/png'] : ['image/jpeg', 'image/png', 'image/webp'];
  for (const file of covers) {
    if (!(file instanceof File) || !formats.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) {
      throw new Error(covers.length > 1 ? '多张封面请选择 JPG 或 PNG，每张最大 20 MiB' : '请选择 JPG、PNG 或 WebP 封面，最大 20 MiB');
    }
    await inspectCover(file);
  }
  const id = crypto.randomUUID();
  try {
    const asset = await saveAsset(id, video);
    const coverAssets = [];
    for (const file of covers) coverAssets.push(await saveAsset(id, file));
    return {
      id, asset, ...splitCovers(coverAssets), coverPk: coverAssets.length > 1, tasks: [], createdAt: Date.now(),
      publication,
      externalImport: { origin, requestId, candidateTitles: [...new Set(candidateTitles.map(value => value.trim()))] },
    };
  } catch (error) {
    await deleteBatchAssets(id).catch(() => {});
    throw error;
  }
}
