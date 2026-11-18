// ============================================================================
// Offline reload (v1.125.0) — the page itself stays on the device, so a till can be reloaded with no signal.
//
// Opt-in, per device: nothing is registered until the owner turns it on in Settings → Devices → "This device". The worker is
// public/sw.js (read its header for what it does and never does). This module is the page's side of it:
//   enableOfflineShell()   registers the worker, then saves the page and the files already loaded so it works at once, not after a reload
//   disableOfflineShell()  the kill switch: unregisters every worker and deletes every copy it made, and forgets the choice
//   registerOfflineShellIfWanted()  on boot of a signed-in device that opted in: registers again (this is how a new release's worker arrives)
//   applyKillParam()       "?nosw=1" in the address does the kill switch — for a device whose screens will not open
// ============================================================================
import { APP_VERSION } from '@/lib/version';

export const OFFLINE_SHELL_FLAG = 'dt.offlineShell';
export const shellCacheName = (version: string): string => `dt-shell-${version}`;
export const ASSET_CACHE = 'dt-assets';

const ownCache = (name: string) => name.startsWith('dt-');

/** Can this browser do it? A service worker needs a secure page (https, or localhost) and the cache API. */
export function offlineShellSupported(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    if (!('serviceWorker' in navigator) || typeof caches === 'undefined') return false;
    return window.isSecureContext === true || ['localhost', '127.0.0.1'].includes(window.location.hostname);
  } catch { return false; }
}

export function offlineShellWanted(): boolean {
  try { return localStorage.getItem(OFFLINE_SHELL_FLAG) === 'on'; } catch { return false; }
}
const setWanted = (on: boolean) => { try { if (on) localStorage.setItem(OFFLINE_SHELL_FLAG, 'on'); else localStorage.removeItem(OFFLINE_SHELL_FLAG); } catch { /* private mode: the worker still works for this session */ } };

const scriptUrl = (version: string) => `/sw.js?v=${encodeURIComponent(version)}`;

async function register(version: string): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(scriptUrl(version), { scope: '/', updateViaCache: 'none' });
}

/** The files this page has loaded from this site's /assets folder (what it needs to open again). */
export function loadedAssetUrls(): string[] {
  try {
    const out = new Set<string>();
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const u = new URL(e.name, window.location.href);
      if (u.origin === window.location.origin && u.pathname.startsWith('/assets/')) out.add(u.pathname + u.search);
    }
    return [...out];
  } catch { return []; }
}

/** Saves the page and the files already loaded, so the first offline reload works without a reload first. Returns how many files were saved. */
export async function saveCurrentPage(version: string = APP_VERSION): Promise<{ page: boolean; files: number }> {
  let page = false, files = 0;
  try {
    const res = await fetch('/', { cache: 'reload', credentials: 'same-origin' });
    if (res.ok && /text\/html/i.test(res.headers.get('content-type') || '')) { await (await caches.open(shellCacheName(version))).put('/', res); page = true; }
  } catch { /* offline: nothing to save now */ }
  try {
    const cache = await caches.open(ASSET_CACHE);
    for (const url of loadedAssetUrls()) {
      if (await cache.match(url)) { files++; continue; }
      try {
        const res = await fetch(url);
        if (res.status === 200 && !/text\/html/i.test(res.headers.get('content-type') || '')) { await cache.put(url, res); files++; }
      } catch { /* one file missing does not stop the rest */ }
    }
  } catch { /* cache API refused (storage full): the worker still keeps what it can */ }
  return { page, files };
}

export type EnableResult = { ok: true; page: boolean; files: number } | { ok: false; reason: string };

export async function enableOfflineShell(version: string = APP_VERSION): Promise<EnableResult> {
  if (!offlineShellSupported()) return { ok: false, reason: 'This browser cannot keep the page for offline use (it needs a secure https page).' };
  try {
    await register(version);
    await navigator.serviceWorker.ready;
    setWanted(true);
    const saved = await saveCurrentPage(version);
    return { ok: true, ...saved };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The worker could not be installed.' };
  }
}

/** The kill switch: no worker, no copies, no choice remembered. Never throws. */
export async function disableOfflineShell(): Promise<void> {
  setWanted(false);
  let regs: ServiceWorkerRegistration[] = [];
  try { if ('serviceWorker' in navigator) regs = [...(await navigator.serviceWorker.getRegistrations())]; } catch { /* none */ }
  // 1. tell the worker to stop caching and pass everything through (an unregistered worker serves its open pages until they close, and would otherwise keep filling the copies we are about to delete)
  for (const r of regs) { try { (r.active || r.waiting || r.installing)?.postMessage({ type: 'dt-off' }); } catch { /* gone */ } }
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'dt-off' }); } catch { /* none */ }
  // 2. unregister
  await Promise.all(regs.map(r => r.unregister().catch(() => false)));
  // 3. delete every copy — twice, the second time after a moment, for a write that was already in flight
  const wipe = async () => {
    try {
      if (typeof caches === 'undefined') return;
      const names = await caches.keys();
      await Promise.all(names.filter(ownCache).map(n => caches.delete(n)));
    } catch { /* nothing to delete */ }
  };
  await wipe();
  await new Promise(r => setTimeout(r, 400));
  await wipe();
}

export interface ShellStatus { supported: boolean; wanted: boolean; registered: boolean; controlling: boolean; pageSaved: boolean; files: number }

export async function offlineShellStatus(version: string = APP_VERSION): Promise<ShellStatus> {
  const s: ShellStatus = { supported: offlineShellSupported(), wanted: offlineShellWanted(), registered: false, controlling: false, pageSaved: false, files: 0 };
  if (!s.supported) return s;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    s.registered = regs.length > 0;
    s.controlling = !!navigator.serviceWorker.controller;
  } catch { /* unknown */ }
  try {
    s.pageSaved = !!(await (await caches.open(shellCacheName(version))).match('/'));
    s.files = (await (await caches.open(ASSET_CACHE)).keys()).length;
  } catch { /* unknown */ }
  return s;
}

/** On the boot of a device that opted in: register again (a new release's worker arrives this way) and refresh the saved page. Quiet. */
export function registerOfflineShellIfWanted(version: string = APP_VERSION): void {
  if (!offlineShellWanted() || !offlineShellSupported()) return;
  const run = () => { void register(version).then(() => saveCurrentPage(version)).catch(() => { /* not today */ }); };
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 4000);
}

/** "?nosw=1" in the address: do the kill switch, then drop the parameter. Returns true when it ran. */
export function applyKillParam(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('nosw') !== '1') return false;
    void disableOfflineShell().then(() => {
      url.searchParams.delete('nosw');
      window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    });
    return true;
  } catch { return false; }
}

// the kill parameter is read as soon as this module is loaded (App imports it), before anything can go wrong later
if (typeof window !== 'undefined') applyKillParam();
