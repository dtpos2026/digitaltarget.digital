// "Restart application to apply changes".
//
// The Modern / Classic switch and the accent colour apply instantly, so a
// restart is never required — this exists for the shop that wants the app to
// come back up fresh (it is also how a change of language or zoom is picked up
// everywhere at once). It NEVER clears anything: local data, the licence,
// users, settings and printer configuration stay exactly where they are.
// Before restarting, pending writes are flushed to disk.

export function canRestartApp(): boolean {
  try { return typeof (window as any).electronAPI?.restartApp === 'function'; } catch { return false; }
}

export async function restartApp(): Promise<void> {
  // Cloud app: the local cache is written synchronously; what can still be pending is the upload queue. Give it one
  // short chance to drain before the page is replaced, never block the restart on it.
  try {
    const { flushDeferredOps, waitForQueuePersist } = await import('@/lib/deferredSync');
    await Promise.race([waitForQueuePersist().then(() => flushDeferredOps()), new Promise(r => setTimeout(r, 2500))]);
  } catch { /* the queue is durable; it resumes after the restart */ }
  try {
    const api = (window as any).electronAPI;
    if (typeof api?.restartApp === 'function') {
      const r = await api.restartApp();
      if (r && r.ok === false) throw new Error(r.error || 'restart failed');
      return; // the process is being replaced
    }
  } catch { /* fall through to a plain reload */ }
  window.location.reload();
}
