import type { TaskBinding, SenderIdentity } from './model';
export interface Grant extends TaskBinding {
  token: string; assetId: string; coverAssetId?: string; pkCoverAssetIds?: string[]; coverPk?: boolean; origin: string; expiresAt: number; consumed: boolean;
}
export interface Claim { id: string; token: string; tabId: number; frameId: number; documentId: string; approved: boolean }
function valid(grant: Grant, now: number) {
  if (grant.consumed || now >= grant.expiresAt) throw new Error('素材授权已过期或已使用');
}
export function authorizeClaim(grant: Grant, sender: SenderIdentity, bridgeUrl: string, now: number): Claim {
  valid(grant, now);
  if (sender.tabId !== grant.tabId || sender.frameId <= 0 || !sender.documentId || sender.url !== `${bridgeUrl}#${grant.token}`) throw new Error('桥接页面身份不匹配');
  return { id: crypto.randomUUID(), token: grant.token, tabId: sender.tabId, frameId: sender.frameId, documentId: sender.documentId, approved: false };
}
export function approveBridge(grant: Grant, claim: Claim, sender: SenderIdentity, now: number): Claim {
  valid(grant, now);
  if (claim.token !== grant.token || sender.tabId !== grant.tabId || sender.frameId !== 0 || sender.documentId !== grant.documentId || new URL(sender.url).origin !== grant.origin) throw new Error('父页面身份不匹配');
  return { ...claim, approved: true };
}
export function consumeGrant(grant: Grant, claim: Claim, sender: SenderIdentity, now: number): Grant {
  valid(grant, now);
  if (!claim.approved || claim.token !== grant.token || claim.tabId !== sender.tabId || claim.frameId !== sender.frameId || claim.documentId !== sender.documentId) throw new Error('素材授权未获批准');
  return { ...grant, consumed: true };
}
