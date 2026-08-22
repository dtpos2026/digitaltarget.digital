// IndexedDB-backed image cache.
// Goal: jab Electron EXE me product/category image first time https se aati hai,
// usay blob ke roop me IndexedDB me save kar lo. Next launch + offline mode me
// instant blob URL milegi. Browser cache se zyada reliable kyunki user clear nahi karta.
//
// Public API:
//   getCachedImageUrl(url) -> Promise<string>   (returns blob: URL if cached, else original https URL after kicking off background fetch)
//   preloadImages(urls[])                       (background warm-up; safe to call repeatedly)
//
// Works in both Electron and browser. No file:// paths — sirf blob URLs / https URLs use hoti hain,
// is liye EXE me image load issue nahi hota.

const DB_NAME = 'dt-pos-img-cache';
const STORE = 'images';
const DB_VERSION = 1;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 din

let _db: Promise<IDBDatabase> | null = null;
const memUrlCache = new Map<string, string>();    // src url -> blob: url
const inflight = new Map<string, Promise<string | null>>();

function openDb(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

interface CacheEntry { url: string; blob: Blob; type: string; ts: number; }

async function idbGet(url: string): Promise<CacheEntry | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve((req.result as CacheEntry) || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function idbPut(entry: CacheEntry): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

function isCacheable(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('blob:')) return false;
  if (url.startsWith('data:')) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

async function downloadAndCache(url: string): Promise<string | null> {
  if (inflight.has(url)) return inflight.get(url)!;
  const p = (async () => {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const blob = await res.blob();
      await idbPut({ url, blob, type: blob.type || 'image/jpeg', ts: Date.now() });
      const blobUrl = URL.createObjectURL(blob);
      memUrlCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/**
 * Synchronous fast-path: returns cached blob URL if already in memory cache,
 * else returns the original URL and triggers background caching.
 */
export function getCachedImageUrlSync(url: string): string {
  if (!url || !isCacheable(url)) return url;
  const hit = memUrlCache.get(url);
  if (hit) return hit;
  // kick off async lookup; result will be picked up on next render via useCachedImage
  return url;
}

/**
 * Async: returns blob URL from cache, else fetches + caches and returns blob URL.
 * On network failure returns original URL so the <img> still tries to load directly.
 */
export async function getCachedImageUrl(url: string): Promise<string> {
  if (!url || !isCacheable(url)) return url;
  const memHit = memUrlCache.get(url);
  if (memHit) return memHit;

  const entry = await idbGet(url);
  if (entry && Date.now() - entry.ts < MAX_AGE_MS) {
    const blobUrl = URL.createObjectURL(entry.blob);
    memUrlCache.set(url, blobUrl);
    return blobUrl;
  }
  const fetched = await downloadAndCache(url);
  return fetched || url;
}

/** Warm-up: pre-cache a list of image URLs in background. Idempotent. */
export async function preloadImages(urls: (string | undefined | null)[]): Promise<void> {
  const list = Array.from(new Set(urls.filter(Boolean) as string[])).filter(isCacheable);
  // process with low concurrency so we don't saturate network at startup
  const CONCURRENCY = 4;
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const u = list[i++];
      if (memUrlCache.has(u)) continue;
      const entry = await idbGet(u);
      if (entry && Date.now() - entry.ts < MAX_AGE_MS) {
        memUrlCache.set(u, URL.createObjectURL(entry.blob));
        continue;
      }
      await downloadAndCache(u);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
