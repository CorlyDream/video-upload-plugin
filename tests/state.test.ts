import { it, expect } from 'vitest';
import { acceptCheckpoint } from '../src/core/model';

it('does not accept a claim of completion from an unverified page adapter', () => {
  const current = { batchId: 'b', taskId: 't', attemptId: 'a', tabId: 1, documentId: 'd', step: 1, status: 'transferring' as const, reason: '' };
  // Runtime messages are untyped; M0 cannot manufacture a completion state.
  expect(acceptCheckpoint(current, { ...current, step: 2, status: 'ready' as never })).toBeNull();
});
