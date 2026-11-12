import { it, expect, vi } from 'vitest';
import { keepConnectionAlive } from '../src/core/connection';
it('sends session liveness and stops sending after the workbench disconnects', () => {
  vi.useFakeTimers();
  let count = 0;
  const stop = keepConnectionAlive(() => { count++; });
  vi.advanceTimersByTime(45000);
  expect(count).toBe(3);
  stop(); vi.advanceTimersByTime(30000);
  expect(count).toBe(3);
  vi.useRealTimers();
});
