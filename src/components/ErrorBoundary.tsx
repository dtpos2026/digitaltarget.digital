import React from 'react';

interface State { error: Error | null; recovering: boolean }

/**
 * Marker so a recovery reload can only happen once per browser session.
 * Without it, a genuinely missing chunk would reload forever.
 */
const RECOVERY_KEY = 'dtpos-chunk-recovery';

/**
 * Is this the "your index.html is older than the deployment" failure?
 *
 * Vite fingerprints every chunk, so each deploy produces new filenames and
 * removes the old ones. A browser holding a cached index.html keeps asking for
 * chunks from a build that no longer exists, and the app dies at the first
 * lazy import — for this project, usually the Super Admin page.
 *
 * Nothing is wrong with the code or the deployment. The browser is reading
 * yesterday's map, and the only cure is to fetch a fresh one.
 */
function isStaleChunkError(e: Error): boolean {
  const msg = `${e?.message ?? ''} ${e?.name ?? ''}`.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module')
    || msg.includes('error loading dynamically imported module')
    || msg.includes('importing a module script failed')
    || msg.includes('chunkloaderror')
    || (msg.includes('unexpected token') && msg.includes('<'))   // HTML served as JS
  );
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: isStaleChunkError(error) };
  }

  async componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary]', error, info);
    if (!isStaleChunkError(error)) return;

    // Recover once. A second failure means the chunk is genuinely gone, and a
    // reload loop would be worse than an honest error message.
    let alreadyTried = false;
    try { alreadyTried = sessionStorage.getItem(RECOVERY_KEY) === '1'; } catch { /* ignore */ }
    if (alreadyTried) { this.setState({ recovering: false }); return; }

    try { sessionStorage.setItem(RECOVERY_KEY, '1'); } catch { /* ignore */ }
    await this.hardReload();
  }

  /**
   * Drop every cached copy of the app shell, then reload.
   *
   * A plain location.reload() is not enough: the service worker will serve the
   * same stale index.html straight back and the error repeats. Only caches and
   * the worker are cleared — localStorage and IndexedDB are left untouched, so
   * an unsynced bill is never at risk.
   */
  private hardReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (e) { console.warn('[recovery] could not unregister service worker', e); }

    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) { console.warn('[recovery] could not clear caches', e); }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('_v', Date.now().toString());   // defeat any proxy cache
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  reset = () => {
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch { /* ignore */ }
    void this.hardReload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (this.state.recovering) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full text-center">
            <div className="text-4xl mb-3">🔄</div>
            <h1 className="text-lg font-bold mb-2">Updating to the latest version…</h1>
            <p className="text-sm text-muted-foreground">
              A new build was released. Loading it now — this takes a moment.
            </p>
          </div>
        </div>
      );
    }

    const stale = isStaleChunkError(this.state.error);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-lg text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-lg font-bold mb-2">
            {stale ? 'Could not load the latest version' : 'Something went wrong'}
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            {stale
              ? 'Your browser is holding an old copy of the app. Press Reload — it clears '
                + 'the cache and fetches the current build.'
              : (this.state.error.message || 'Unknown error')}
          </p>
          <button
            onClick={this.reset}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold text-sm"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
