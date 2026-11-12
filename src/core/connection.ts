/** Liveness only while the workbench is open; never restarts a task or a connection. */
export function keepConnectionAlive(send: () => void): () => void {
  const timer = setInterval(() => {
    try { send(); } catch { clearInterval(timer); }
  }, 15000);
  return () => clearInterval(timer);
}
