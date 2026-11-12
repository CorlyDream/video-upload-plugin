import { describe, it, expect } from 'vitest';
import { authorizeClaim, approveBridge, consumeGrant } from '../src/core/authorization';
import { acceptCheckpoint } from '../src/core/model';

const binding = { batchId: 'batch', taskId: 'task', attemptId: 'attempt', tabId: 7, documentId: 'top-doc', step: 1 };
const grant = () => ({ ...binding, token: 'secret', assetId: 'video', origin: 'https://creator.xiaohongshu.com', expiresAt: 2000, consumed: false });
const frame = { tabId: 7, frameId: 3, documentId: 'bridge-doc', url: 'chrome-extension://unit/bridge.html#secret' };
const top = { tabId: 7, frameId: 0, documentId: 'top-doc', url: 'https://creator.xiaohongshu.com/publish/publish' };

describe('one-use asset authorization', () => {
  it('requires approval by the bound top document before consuming the asset', () => {
    const g = grant();
    const claim = authorizeClaim(g, frame, 'chrome-extension://unit/bridge.html', 1000);
    expect(() => consumeGrant(g, claim, frame, 1000)).toThrow();
    const approved = approveBridge(g, claim, top, 1000);
    expect(consumeGrant(g, approved, frame, 1000)).toMatchObject({ consumed: true, assetId: 'video' });
  });
  it.each([
    { ...frame, tabId: 8 }, { ...frame, frameId: 0 },
    { ...frame, url: 'https://evil.example/bridge.html#secret' },
    { ...frame, url: 'chrome-extension://unit/bridge.html#other' },
  ])('rejects unrelated or top-level frame %#', (sender) => {
    expect(() => authorizeClaim(grant(), sender, 'chrome-extension://unit/bridge.html', 1000)).toThrow();
  });
  it.each([
    { ...top, documentId: 'old-doc' }, { ...top, tabId: 8 },
    { ...top, frameId: 4 }, { ...top, url: 'https://evil.example/' },
  ])('rejects approval from stale document or wrong origin %#', (sender) => {
    const g = grant();
    const claim = authorizeClaim(g, frame, 'chrome-extension://unit/bridge.html', 1000);
    expect(() => approveBridge(g, claim, sender, 1000)).toThrow();
  });
  it('rejects expiration, replay, and a different bridge document', () => {
    const g = grant();
    const claim = approveBridge(g, authorizeClaim(g, frame, 'chrome-extension://unit/bridge.html', 1000), top, 1000);
    expect(() => consumeGrant(g, claim, frame, 2000)).toThrow();
    expect(() => consumeGrant(g, claim, { ...frame, documentId: 'different' }, 1000)).toThrow();
    const used = consumeGrant(g, claim, frame, 1000);
    expect(() => consumeGrant(used, claim, frame, 1000)).toThrow();
  });
});

describe('checkpoint isolation', () => {
  it('accepts a current ordered observation but never revives a stopped task', () => {
    const current = { ...binding, status: 'transferring' as const, reason: '' };
    expect(acceptCheckpoint(current, { ...binding, step: 2, status: 'needs_attention', reason: 'File input accepted; upload not verified' })).toMatchObject({ step: 2, status: 'needs_attention' });
    expect(acceptCheckpoint({ ...current, status: 'aborted' }, { ...binding, step: 2, status: 'needs_attention', reason: '' })).toBeNull();
  });
  it.each([
    { attemptId: 'old' }, { batchId: 'old' }, { taskId: 'other' },
    { documentId: 'old-doc' }, { tabId: 8 }, { step: 1 }, { step: 5 },
  ])('drops stale or out-of-order event %#', (override) => {
    expect(acceptCheckpoint({ ...binding, status: 'transferring', reason: '' }, { ...binding, step: 2, status: 'needs_attention', reason: '', ...override })).toBeNull();
  });
});
