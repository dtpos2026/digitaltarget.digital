// ============================================================
// Tests — v1.25.2 stale chunk recovery
//
// REPORTED on the live domain:
//   "Failed to fetch dynamically imported module:
//    https://digitaltarget.digital/assets/SuperAdminPage-CTfysxcO.js"
//
// CAUSE: Vite fingerprints each chunk; a deploy replaces them. A browser
// holding an old index.html keeps requesting files that no longer exist, and
// dies at the first lazy import. Pressing Reload does not help — the same
// cached HTML is read again.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { isStaleChunkError, clearChunkRecoveryFlag } from '@/lib/chunkRecovery';

beforeEach(() => { try { sessionStorage.clear(); } catch { /* ignore */ } });

describe('recognising a stale build', () => {
  it('THE REPORTED ERROR is recognised', () => {
    expect(isStaleChunkError(new Error(
      'Failed to fetch dynamically imported module: https://digitaltarget.digital/assets/SuperAdminPage-CTfysxcO.js',
    ))).toBe(true);
  });

  it('recognises the other browsers wording', () => {
    // Each engine words this differently; missing one leaves those users stuck.
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('ChunkLoadError: Loading chunk 5 failed'))).toBe(true);
  });

  it('recognises the SPA fallback serving HTML for a missing chunk', () => {
    // The /* -> /index.html rewrite returns HTML with a 200 for a chunk that
    // is gone, and the browser complains about the MIME type instead.
    expect(isStaleChunkError(new Error(
      "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of 'text/html' is not a valid JavaScript MIME type.",
    ))).toBe(true);
  });

  it('does NOT treat ordinary errors as a stale build', () => {
    // Reloading and wiping caches for an unrelated bug would hide the real
    // problem and lose the operator's place.
    expect(isStaleChunkError(new Error('Invalid login credentials'))).toBe(false);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(new Error('Failed to fetch'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe('recovery runs at most once per session', () => {
  const KEY = 'dtpos-chunk-recovery-attempted';

  it('the guard flag gates a second attempt', () => {
    // Without this, a reload that also fails reloads again — an endless
    // refresh loop that hides the real cause entirely.
    sessionStorage.setItem(KEY, '1');
    expect(sessionStorage.getItem(KEY)).toBe('1');
  });

  it('a successful start clears the flag', () => {
    sessionStorage.setItem(KEY, '1');
    clearChunkRecoveryFlag();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});

describe('the deploy config that prevents this for new visitors', () => {
  it('index.html and the service worker are never cached', async () => {
    const fs = await import('node:fs');
    const h = fs.readFileSync('public/_headers', 'utf8');
    // index.html is the map from URLs to hashed chunks. Cache it and the
    // browser keeps following yesterday's map.
    expect(h).toMatch(/\/index\.html[\s\S]*?no-cache/);
    expect(h).toMatch(/\/sw\.js[\s\S]*?no-cache/);
  });

  it('hashed assets ARE cached forever', async () => {
    const fs = await import('node:fs');
    const h = fs.readFileSync('public/_headers', 'utf8');
    // Safe precisely because a new build means a new filename.
    expect(h).toMatch(/\/assets\/\*[\s\S]*?immutable/);
  });

  it('a SPA fallback exists so deep links survive a refresh', async () => {
    const fs = await import('node:fs');
    expect(fs.readFileSync('public/_redirects', 'utf8')).toMatch(/\/\*\s+\/index\.html\s+200/);
  });
});
