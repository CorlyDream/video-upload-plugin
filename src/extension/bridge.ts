import { readAsset } from '../core/assets';

async function bridge() {
  if (window.parent === window) return;
  const token = location.hash.slice(1);
  if (!/^[0-9a-f-]{36}$/.test(token)) return;
  const claim = await chrome.runtime.sendMessage({ type: 'bridge-claim', token });
  if (!claim?.ok || typeof claim.origin !== 'string') return;
  const channel = new MessageChannel();
  let used = false;
  const timeout = setTimeout(() => channel.port1.close(), 45000);
  channel.port1.onmessage = async event => {
    if (used || event.data?.type !== 'approved') return;
    used = true;
    try {
      const authorization = await chrome.runtime.sendMessage({ type: 'bridge-consume', token, claimId: claim.claimId });
      if (!authorization?.ok || authorization.origin !== claim.origin) throw new Error('素材授权已失效');
      const asset = await readAsset(authorization.batchId, authorization.assetId);
      const cover = authorization.coverAssetId ? await readAsset(authorization.batchId, authorization.coverAssetId) : undefined;
      const pkCovers = await Promise.all((authorization.pkCoverAssetIds ?? []).map((id: string)=>readAsset(authorization.batchId,id)));
      channel.port1.postMessage({ pkCovers, name: asset.name, type: asset.type, lastModified: asset.lastModified, blob: asset.blob, cover });
    } catch (error) { channel.port1.postMessage({ error: error instanceof Error ? error.message : '读取素材失败' }); }
    finally { clearTimeout(timeout); channel.port1.close(); }
  };
  channel.port1.start();
  window.parent.postMessage({ type: 'bridge-ready', token, claimId: claim.claimId }, claim.origin, [channel.port2]);
}
void bridge().catch(() => {});
