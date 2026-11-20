import { afterEach, it, expect, vi } from 'vitest';
import { keepConnectionAlive, connectWorkbench, type ConnectionState } from '../src/core/connection';
afterEach(() => vi.useRealTimers());
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

function mockPort() {
  const messages = new Set<(message: any) => void>();
  const disconnects = new Set<() => void>();
  return {
    name: 'workbench',
    onMessage: { addListener: (fn: any) => messages.add(fn), removeListener: (fn: any) => messages.delete(fn) },
    onDisconnect: { addListener: (fn: any) => disconnects.add(fn), removeListener: (fn: any) => disconnects.delete(fn) },
    postMessage: vi.fn(), disconnect: vi.fn(),
    receive: (message: unknown) => { for (const fn of messages) fn(message); },
    lose: () => { for (const fn of disconnects) fn(); },
  };
}
function session() {
  const ports: ReturnType<typeof mockPort>[] = [];
  const states: ConnectionState[] = [];
  const onMessage = vi.fn(), onDisconnect = vi.fn(), onEvent = vi.fn();
  let lastError: string | undefined;
  const connect = vi.fn(() => { const port = mockPort(); ports.push(port); return port as unknown as chrome.runtime.Port; });
  const connection = connectWorkbench({ connect, lastError: () => lastError, onMessage, onDisconnect, onEvent, onState: state => states.push(state) });
  return { connection, ports, states, connect, onMessage, onDisconnect, onEvent, error: (value: string) => { lastError = value; } };
}

it('reconnects after worker loss, waits for a fresh snapshot, and never replays upload commands', () => {
  vi.useFakeTimers();
  const h = session();
  h.ports[0]!.receive({ type: 'snapshot', snapshot: {} });
  expect(h.states.at(-1)).toBe('connected');
  h.error('The message port closed.');
  h.ports[0]!.lose();
  expect(h.onDisconnect).toHaveBeenCalledWith('The message port closed.');
  expect(h.onEvent).toHaveBeenCalledWith('connection.disconnected', expect.objectContaining({ code: 'The message port closed.', elapsedMs: 0 }));
  expect(h.states.at(-1)).toBe('reconnecting');
  vi.advanceTimersByTime(1000);
  expect(h.ports).toHaveLength(2);
  expect(h.states.at(-1)).toBe('reconnecting');
  expect(h.ports[1]!.postMessage).not.toHaveBeenCalled();
  h.ports[0]!.receive({ type: 'snapshot', snapshot: {} });
  expect(h.states.at(-1)).toBe('reconnecting');
  h.ports[1]!.receive({ type: 'snapshot', snapshot: { batch: { tasks: [{ status: 'paused' }] } } });
  expect(h.states.at(-1)).toBe('connected');
  expect(h.onMessage).toHaveBeenLastCalledWith(expect.objectContaining({ snapshot: { batch: { tasks: [{ status: 'paused' }] } } }));
  h.connection.close();
  vi.advanceTimersByTime(60000);
  expect(h.connect).toHaveBeenCalledTimes(2);
});

it('records delayed heartbeat timing without logging normal heartbeat traffic', () => {
  vi.useFakeTimers();
  const h = session();
  h.ports[0]!.receive({ type: 'snapshot', snapshot: {} });
  vi.setSystemTime(Date.now() + 60000);
  vi.advanceTimersByTime(15000);
  expect(h.onEvent).toHaveBeenCalledWith('connection.heartbeat_delayed', { elapsedMs: 75000 });
  h.onEvent.mockClear();
  vi.advanceTimersByTime(15000);
  expect(h.onEvent).not.toHaveBeenCalled();
  h.connection.close();
});

it('bounds handshake retries, shows disconnected, and permits an explicit retry', () => {
  vi.useFakeTimers();
  const h = session();
  vi.advanceTimersByTime(60000);
  expect(h.connect).toHaveBeenCalledTimes(4);
  expect(h.states.at(-1)).toBe('disconnected');
  expect(h.ports.every(port => port.disconnect.mock.calls.length === 1)).toBe(true);
  h.connection.reconnect();
  expect(h.connect).toHaveBeenCalledTimes(5);
  h.ports[4]!.receive({ type: 'snapshot', snapshot: {} });
  expect(h.states.at(-1)).toBe('connected');
  h.connection.close();
});

it('does not fight the original workbench when the background rejects a duplicate', () => {
  vi.useFakeTimers();
  const h = session();
  h.ports[0]!.receive({ ok: false, error: '已有工作台，请使用原工作台' });
  h.ports[0]!.lose();
  vi.advanceTimersByTime(60000);
  expect(h.connect).toHaveBeenCalledTimes(1);
  expect(h.states.at(-1)).toBe('disconnected');
  expect(h.onDisconnect).toHaveBeenCalledWith('已有工作台，请使用原工作台');
  h.connection.close();
});

it('handles a heartbeat send failure as a lost connection and cancels retries on close', () => {
  vi.useFakeTimers();
  const h = session();
  h.ports[0]!.receive({ type: 'snapshot', snapshot: {} });
  h.ports[0]!.postMessage.mockImplementation(() => { throw new Error('Attempting to use a disconnected port object'); });
  vi.advanceTimersByTime(15000);
  expect(h.states.at(-1)).toBe('reconnecting');
  h.connection.close();
  vi.advanceTimersByTime(60000);
  expect(h.connect).toHaveBeenCalledTimes(1);
});

it('ignores messages from the old port after reconnect and does not retry an invalid extension context', () => {
  vi.useFakeTimers();
  const h = session();
  h.error('Extension context invalidated.');
  h.ports[0]!.lose();
  h.ports[0]!.receive({ type: 'snapshot', snapshot: {} });
  vi.advanceTimersByTime(60000);
  expect(h.connect).toHaveBeenCalledTimes(1);
  expect(h.onMessage).not.toHaveBeenCalled();
  expect(h.states.at(-1)).toBe('disconnected');
  h.connection.close();
});
