import type { Response } from './protocol';

/** Liveness only; callers own connection recovery and task cancellation. */
export function keepConnectionAlive(send: () => void): () => void {
  const timer = setInterval(() => {
    try { send(); } catch { clearInterval(timer); }
  }, 15000);
  return () => clearInterval(timer);
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type WorkbenchMessage = Response & { type?: string };
type ConnectionOptions = {
  connect: () => chrome.runtime.Port;
  lastError: () => string | undefined;
  onMessage: (message: WorkbenchMessage) => void;
  onState: (state: ConnectionState) => void;
  onDisconnect: (reason: string) => void;
  onEvent: (event: string, details: Record<string, unknown>) => void;
};

/** Recovers transport only. It never sends or replays a workbench command. */
export function connectWorkbench(options: ConnectionOptions) {
  let closed = false;
  let retries = 0;
  let connectedOnce = false;
  let heartbeatAt = Date.now();
  let current: chrome.runtime.Port | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let detach = () => {};

  function release() {
    const previous = current;
    current = undefined;
    detach(); detach = () => {};
    try { previous?.disconnect(); } catch { /* The extension context may be gone. */ }
  }
  function lost(reason: string, retry = true) {
    release();
    options.onEvent('connection.disconnected', { code: reason, count: retries, elapsedMs: Date.now() - heartbeatAt });
    options.onDisconnect(reason);
    if (!closed && retry && !/context invalidated/i.test(reason) && retries < 3) {
      options.onState('reconnecting');
      const delay = 1000 * 2 ** retries++;
      retryTimer = setTimeout(open, delay);
    } else {
      options.onState('disconnected');
    }
  }
  function open() {
    retryTimer = undefined;
    if (closed) return;
    options.onState(connectedOnce || retries ? 'reconnecting' : 'connecting');
    options.onEvent('connection.opening', { count: retries });
    let port: chrome.runtime.Port;
    try { port = options.connect(); }
    catch (error) { lost(error instanceof Error ? error.message : 'connect_failed'); return; }
    current = port;
    let ready = false;
    heartbeatAt = Date.now();
    const timeout = setTimeout(() => { if (current === port) lost('snapshot_timeout'); }, 8000);
    const heartbeat = keepConnectionAlive(() => {
      if (current !== port) return;
      const elapsedMs = Date.now() - heartbeatAt;
      heartbeatAt = Date.now();
      if (elapsedMs > 25000) options.onEvent('connection.heartbeat_delayed', { elapsedMs });
      try { port.postMessage({ type: 'heartbeat' }); }
      catch (error) { lost(error instanceof Error ? error.message : 'heartbeat_failed'); }
    });
    const disconnected = () => {
      // Chrome only exposes lastError during this synchronous callback.
      const reason = options.lastError() ?? 'port_closed';
      if (current === port) lost(reason);
    };
    const message = (value: WorkbenchMessage) => {
      if (current !== port || closed) return;
      if (!ready && value.error && !value.id && !value.snapshot) {
        // A duplicate or untrusted workbench must not repeatedly challenge its owner.
        options.onMessage(value);
        lost(value.error, false);
        return;
      }
      if (value.snapshot && !ready) {
        ready = true; clearTimeout(timeout);
        retries = 0; connectedOnce = true;
        options.onEvent('connection.connected', {});
        options.onState('connected');
      }
      options.onMessage(value);
    };
    detach = () => {
      clearTimeout(timeout); heartbeat();
      port.onMessage.removeListener(message);
      port.onDisconnect.removeListener(disconnected);
    };
    port.onMessage.addListener(message);
    port.onDisconnect.addListener(disconnected);
  }
  open();
  return {
    get port() { return current; },
    reconnect() {
      if (closed || current || retryTimer !== undefined) return;
      retries = 0; open();
    },
    close() {
      closed = true; clearTimeout(retryTimer); release();
    },
  };
}
