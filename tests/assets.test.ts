import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { saveAsset, readAsset, deleteBatchAssets, purgeExpiredAssets } from '../src/core/assets';

it('keeps bytes in a batch and denies a cross-batch lookup', async () => {
  const asset = await saveAsset('batch-a', new File(['private video'], 'video.mp4', { type: 'video/mp4' }), 1000);
  expect(await (await readAsset('batch-a', asset.id)).blob.text()).toBe('private video');
  await expect(readAsset('batch-b', asset.id)).rejects.toThrow();
  await deleteBatchAssets('batch-a');
  await expect(readAsset('batch-a', asset.id)).rejects.toThrow();
});

it('expires inactive assets after 24h while preserving the current batch', async () => {
  const old = await saveAsset('old', new File(['a'], 'a.mp4'), 1000);
  const active = await saveAsset('active', new File(['b'], 'b.mp4'), 1000);
  const recent = await saveAsset('recent', new File(['c'], 'c.mp4'), 86400000);
  await purgeExpiredAssets(86401000, 'active');
  await expect(readAsset('old', old.id)).rejects.toThrow();
  expect((await readAsset('active', active.id)).name).toBe('b.mp4');
  expect((await readAsset('recent', recent.id)).name).toBe('c.mp4');
});

it('rejects empty files and insufficient quota before writing', async () => {
  await expect(saveAsset('b', new File([], 'empty.mp4'))).rejects.toThrow();
  await expect(saveAsset('b', new File(['1234'], 'v.mp4'), 1000, { quota: 3, usage: 0 })).rejects.toThrow(/空间/);
});
