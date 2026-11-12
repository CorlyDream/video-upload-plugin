import type { Asset, AssetMeta } from './model';
const database = 'video-upload-assets';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assets', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, set: (value: T) => void) => void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('assets', mode);
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('素材存储失败')); };
    try { action(tx.objectStore('assets'), value => { result = value; }); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}
export async function saveAsset(batchId: string, file: File, now = Date.now(), estimate?: StorageEstimate): Promise<AssetMeta> {
  if (!batchId || !file.size) throw new Error('请选择非空素材文件');
  const capacity = estimate ?? await globalThis.navigator?.storage?.estimate?.();
  if (capacity?.quota !== undefined && capacity.quota - (capacity.usage ?? 0) < file.size * 1.1) throw new Error('本地存储空间不足，请先清理素材');
  const meta: AssetMeta = { id: crypto.randomUUID(), batchId, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, createdAt: now };
  // Store an explicit Blob: File metadata is separate and survives structured clone.
  await transaction<void>('readwrite', store => { store.put({ ...meta, blob: file.slice() }); });
  return meta;
}
export async function readAsset(batchId: string, assetId: string): Promise<Asset> {
  const asset = await transaction<Asset | undefined>('readonly', (store, set) => {
    const request = store.get(assetId);
    request.onsuccess = () => set(request.result);
  });
  if (!asset || asset.batchId !== batchId) throw new Error('素材不存在或已清理，请重新选择');
  return asset;
}
async function removeWhere(predicate: (asset: Asset) => boolean): Promise<void> {
  await transaction<void>('readwrite', store => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (predicate(item.value)) item.delete();
      item.continue();
    };
  });
}
export const deleteBatchAssets = (batchId: string) => removeWhere(asset => asset.batchId === batchId);
export const purgeExpiredAssets = (now = Date.now(), activeBatchId?: string) => removeWhere(asset => asset.batchId !== activeBatchId && now - asset.createdAt >= 86400000);
