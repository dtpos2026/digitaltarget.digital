// ============================================================================
// STALE CHUNK RECOVERY — v1.25.2
//
// THE PROBLEM
// Vite fingerprints every lazy-loaded chunk. On each deploy the hashes change
// and the previous files disappear from the server. A browser holding an old
// index.html — or an old service-worker cache — keeps asking for chunks that
// no longer exist, and the app dies at the first lazy import with:
//
//     Failed to fetch dynamically imported module: .../SuperAdminPage-<hash>.js
//
// The cache headers in public/_headers stop this happening to NEW visitors.
// This module rescues the ones already stuck: their browser will not re-read
// index.html on its own, so no amount of redeploying fixes them and the
// operator is left pressing Reload against a page that can never recover.
//
// WHY A ONE-SHOT GUARD MATTERS
// The recovery reloads the page. If the reload also fails — the network is
// down, or the deploy is genuinely broken — reloading again would produce an
// endless refresh loop that looks far worse than the original error and makes
// the real cause impossible to read. So recovery runs AT MOST ONCE per
// browsing session, recorded in sessionStorage. After that the error is shown
// honestly.
// ============================================================================

const ATTEMPT_KEY = 'dtpos-chunk-recovery-attempted';

/** Does this error look like a chunk that no longer exists on the server? */
export function isStaleChunkError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '');
  return (
    /Failed to fetch dynamically imported module/i.test(msg)
    || /error loading dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg)      // Safari
    || /'text\/html' is not a valid JavaScript MIME type/i.test(msg)
    // ^ the SPA fallback served index.html for a missing chunk
    || (/ChunkLoadError/i.test(msg))
  );
}

function alreadyTried(): boolean {
  try { return sessionStorage.getItem(ATTEMPT_KEY) === '1'; } catch { return false; }
}

function markTried(): void {
  try { sessionStorage.setItem(ATTEMPT_KEY, '1'); } catch { /* storage unavailable */ }
}

/** Clear the recovery flag once the app has loaded successfully. */
export function clearChunkRecoveryFlag(): void {
  try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* ignore */ }
}

/**
 * Drop the service worker and every cache, then reload once.
 *
 * Both are needed. Unregistering the worker alone leaves the CacheStorage
 * entries it wrote, and the next load can still be served the old index.html
 * from there.
 */
export async function recoverFromStaleChunk(): Promise<boolean> {
  if (alreadyTried()) return false;
  markTried();

  console.warn('[recovery] stale build detected — clearing caches and reloading once');

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) { console.warn('[recovery] service worker unregister failed', e); }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) { console.warn('[recovery] cache clear failed', e); }

  // Cache-busting query so the HTML itself is re-fetched, not read from the
  // browser's own memory/disk cache.
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now().toString(36));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
  return true;
}

/**
 * Listen for chunk failures anywhere in the app.
 *
 * A failed dynamic import surfaces as an unhandled rejection, so React error
 * boundaries never see it — which is why the generic "Something went wrong"
 * card appeared with no recovery path.
 */
export function installChunkRecovery(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('unhandledrejection', (ev) => {
    if (isStaleChunkError(ev.reason)) {
      ev.preventDefault();
      void recoverFromStaleChunk();
    }
  });

  window.addEventListener('error', (ev) => {
    if (isStaleChunkError((ev as ErrorEvent).error ?? (ev as ErrorEvent).message)) {
      void recoverFromStaleChunk();
    }
  });

  // Nothing blew up during startup, so any earlier recovery worked. Reset the
  // guard, otherwise a single recovery would disarm it for the whole session.
  window.setTimeout(clearChunkRecoveryFlag, 5000);
}
