// v1.125.0 — the page's side of the offline reload: the opt-in switch, the kill switch (button and "?nosw=1"), the Settings card, the wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ASSET_CACHE, OFFLINE_SHELL_FLAG, applyKillParam, disableOfflineShell, enableOfflineShell, loadedAssetUrls, offlineShellStatus, offlineShellSupported,
  offlineShellWanted, registerOfflineShellIfWanted, shellCacheName,
} from '@/lib/offlineShell';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

// ---- a fake browser: service worker container + cache storage + fetch + the resource timing list
interface Fake { register: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; stores: Map<string, Map<string, Response>>; fetch: ReturnType<typeof vi.fn> }
function installFakeBrowser(opts: { registerFails?: boolean; assets?: string[]; fetchOffline?: boolean } = {}): Fake {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: unknown) => (typeof r === 'string' ? r : (r as { url: string }).url).replace(/^https?:\/\/[^/]+/, '');
  const mk = (name: string) => ({
    match: async (r: unknown) => stores.get(name)?.get(key(r))?.clone(),
    put: async (r: unknown, res: Response) => { stores.get(name)!.set(key(r), res); },
    keys: async () => [...(stores.get(name)?.keys() ?? [])].map(k => ({ url: k })),
  });
  vi.stubGlobal('caches', {
    open: async (n: string) => { if (!stores.has(n)) stores.set(n, new Map()); return mk(n); },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  });
  const post = vi.fn();
  const worker = { postMessage: post };
  let regs: { active: typeof worker; unregister: ReturnType<typeof vi.fn> }[] = [];
  const unregister = vi.fn(async () => true);
  const register = vi.fn(async () => {
    if (opts.registerFails) throw new Error('SecurityError: the worker could not be installed');
    const r = { active: worker, unregister };
    regs = [r];
    return r;
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, ready: Promise.resolve({}), getRegistrations: async () => regs, controller: worker },
  });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  const fetchMock = vi.fn(async (u: unknown) => {
    if (opts.fetchOffline) throw new TypeError('Failed to fetch');
    const url = String(u);
    return url === '/' ? new Response('<html>page</html>', { headers: { 'content-type': 'text/html' } }) : new Response('code', { headers: { 'content-type': 'text/javascript' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  const entries = (opts.assets ?? []).map(a => ({ name: `${window.location.origin}${a}` }));
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue(entries as unknown as PerformanceEntryList);
  return { register, unregister, post, stores, fetch: fetchMock };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); try { delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker; } catch { /* jsdom */ } });

describe('can this browser do it?', () => {
  it('no without a service worker or the cache API, yes on a secure page that has both', () => {
    expect(offlineShellSupported()).toBe(false);                                  // jsdom has neither
    installFakeBrowser();
    expect(offlineShellSupported()).toBe(true);
    // localhost is allowed even when the browser does not call it secure (a developer's machine and the test rig); a real address needs https
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    expect(window.location.hostname).toBe('localhost');
    expect(offlineShellSupported()).toBe(true);
    expect(read('src/lib/offlineShell.ts')).toContain("window.isSecureContext === true || ['localhost', '127.0.0.1'].includes(window.location.hostname)");
  });
});

describe('turning it on', () => {
  it('registers /sw.js?v=<release>, remembers the choice, and saves the page and the files already loaded so it works at once', async () => {
    const f = installFakeBrowser({ assets: ['/assets/App-abc.js', '/assets/index-def.css'] });
    expect(offlineShellWanted()).toBe(false);
    const r = await enableOfflineShell('1.125.0');
    expect(r).toEqual({ ok: true, page: true, files: 2 });
    expect(f.register).toHaveBeenCalledWith('/sw.js?v=1.125.0', { scope: '/', updateViaCache: 'none' });
    expect(localStorage.getItem(OFFLINE_SHELL_FLAG)).toBe('on');
    expect([...f.stores.get(shellCacheName('1.125.0'))!.keys()]).toEqual(['/']);
    expect([...f.stores.get(ASSET_CACHE)!.keys()].sort()).toEqual(['/assets/App-abc.js', '/assets/index-def.css']);
  });
  it('the name of the page cache is the one the worker uses', () => {
    expect(shellCacheName('3.4.5')).toBe('dt-shell-3.4.5');
    expect(read('public/sw.js')).toContain("var SHELL = 'dt-shell-' + VERSION;");
    expect(read('public/sw.js')).toContain("var ASSETS = 'dt-assets';");
    expect(ASSET_CACHE).toBe('dt-assets');
  });
  it('a failed registration says why and leaves the choice off', async () => {
    installFakeBrowser({ registerFails: true });
    const r = await enableOfflineShell('1.125.0');
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reason).toContain('could not be installed');
    expect(offlineShellWanted()).toBe(false);
  });
  it('an unsupported browser is told so and nothing is registered', async () => {
    const r = await enableOfflineShell('1.125.0');
    expect(r).toMatchObject({ ok: false });
    expect(offlineShellWanted()).toBe(false);
  });
  it('with no signal while saving, it is still turned on; the page is saved the next time it loads online', async () => {
    const f = installFakeBrowser({ assets: ['/assets/App-abc.js'], fetchOffline: true });
    const r = await enableOfflineShell('1.125.0');
    expect(r).toEqual({ ok: true, page: false, files: 0 });
    expect(offlineShellWanted()).toBe(true);
    expect(f.register).toHaveBeenCalled();
  });
  it('files only from this site’s /assets folder are saved', () => {
    installFakeBrowser({ assets: ['/assets/a-1.js'] });
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ name: `${window.location.origin}/assets/a-1.js` }, { name: `${window.location.origin}/api/x` }, { name: 'https://cdn.other.test/assets/z.js' }, { name: `${window.location.origin}/assets/a-1.js` }] as unknown as PerformanceEntryList);
    expect(loadedAssetUrls()).toEqual(['/assets/a-1.js']);
  });
});

describe('the status', () => {
  it('says whether it is on, registered, saved, and how many files', async () => {
    installFakeBrowser({ assets: ['/assets/a-1.js', '/assets/b-2.js', '/assets/c-3.js'] });
    expect(await offlineShellStatus('1.125.0')).toMatchObject({ supported: true, wanted: false, registered: false, pageSaved: false, files: 0 });
    await enableOfflineShell('1.125.0');
    expect(await offlineShellStatus('1.125.0')).toMatchObject({ supported: true, wanted: true, registered: true, pageSaved: true, files: 3 });
  });
});

describe('the kill switch', () => {
  it('tells the worker to stop, unregisters it, deletes every dt- copy (and only those), and forgets the choice', async () => {
    const f = installFakeBrowser({ assets: ['/assets/a-1.js'] });
    await enableOfflineShell('1.125.0');
    f.stores.set('something-else', new Map([['/x', new Response('keep me')]]));
    await disableOfflineShell();
    expect(f.post).toHaveBeenCalledWith({ type: 'dt-off' });
    expect(f.unregister).toHaveBeenCalled();
    expect([...f.stores.keys()]).toEqual(['something-else']);
    expect(offlineShellWanted()).toBe(false);
  });
  it('never throws, even where nothing is supported', async () => {
    await expect(disableOfflineShell()).resolves.toBeUndefined();
  });
  it('"?nosw=1" does the same, drops the parameter and keeps the rest of the address', async () => {
    const f = installFakeBrowser({ assets: ['/assets/a-1.js'] });
    await enableOfflineShell('1.125.0');
    window.history.pushState({}, '', '/?nosw=1&keep=1#/inventory');
    expect(applyKillParam()).toBe(true);
    await waitFor(() => expect(f.unregister).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(window.location.search).toBe('?keep=1'), { timeout: 3000 });
    expect(window.location.hash).toBe('#/inventory');
    expect([...f.stores.keys()]).toEqual([]);
    window.history.pushState({}, '', '/');
    expect(applyKillParam()).toBe(false);                                           // no parameter, nothing happens
  });
});

describe('on boot', () => {
  it('a device that did not opt in registers nothing', () => {
    const f = installFakeBrowser();
    registerOfflineShellIfWanted('1.125.0');
    expect(f.register).not.toHaveBeenCalled();
  });
  it('a device that opted in registers this release’s worker (that is how a new release arrives) and refreshes the saved page', async () => {
    const f = installFakeBrowser({ assets: ['/assets/a-1.js'] });
    localStorage.setItem(OFFLINE_SHELL_FLAG, 'on');
    (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback = cb => cb();
    registerOfflineShellIfWanted('1.125.1');
    await waitFor(() => expect(f.register).toHaveBeenCalledWith('/sw.js?v=1.125.1', { scope: '/', updateViaCache: 'none' }));
    await waitFor(() => expect(f.stores.get('dt-shell-1.125.1')?.has('/')).toBe(true));
    delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  });
});

describe('the Settings card', () => {
  async function card() {
    vi.resetModules();
    return (await import('@/components/settings/OfflineShellCard')).default;
  }
  it('off: says so and offers Turn on; on: shows what is saved and offers Turn off and the reset', async () => {
    installFakeBrowser({ assets: ['/assets/a-1.js', '/assets/b-2.js'] });
    const Card = await card();
    render(<Card />);
    await waitFor(() => expect(document.querySelector('[data-offline-shell-state]')?.textContent).toBe('Off.'));
    expect(document.querySelector('[data-offline-shell-on]')).not.toBeNull();
    expect(document.querySelector('[data-offline-shell-reset]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-offline-shell-on]')!);
    await waitFor(() => expect(document.querySelector('[data-offline-shell-off]')).not.toBeNull());
    expect(document.querySelector('[data-offline-shell-state]')?.textContent).toMatch(/On\. The page and 2 files are saved on this device\./);
    expect(document.body.textContent).toContain('?nosw=1');
    fireEvent.click(document.querySelector('[data-offline-shell-off]')!);
    await waitFor(() => expect(document.querySelector('[data-offline-shell-state]')?.textContent).toBe('Off.'));
    expect(offlineShellWanted()).toBe(false);
  });
  it('on a browser that cannot do it, it says so and offers nothing', async () => {
    const Card = await card();
    render(<Card />);
    await screen.findByText(/cannot do it here/);
    expect(document.querySelector('[data-offline-shell-on]')).toBeNull();
  });
});

describe('wiring', () => {
  it('the card is on Settings → Devices, the boot registration is in the signed-in shell, and the kill parameter is read by the app', () => {
    const settings = read('src/pages/SettingsPage.tsx');
    expect(settings).toMatch(/<TabsContent value="devices"[\s\S]*?<OfflineShellCard \/>[\s\S]*?<\/TabsContent>/);
    expect(read('src/components/AppLayout.tsx')).toContain('registerOfflineShellIfWanted()');
    expect(read('src/App.tsx')).toContain("import '@/lib/offlineShell';");
  });
  it('nothing is registered unless the owner opted in: the only register call is behind the choice or the explicit Turn on', () => {
    const lib = read('src/lib/offlineShell.ts');
    expect(lib.match(/navigator\.serviceWorker\.register\(/g)).toHaveLength(1);
    expect(lib).toContain('if (!offlineShellWanted() || !offlineShellSupported()) return;');
    for (const f of ['src/App.tsx', 'src/components/AppLayout.tsx', 'src/routes/__root.tsx', 'src/routes/index.tsx']) expect(read(f)).not.toContain('serviceWorker.register');
  });
  it('the build keeps public/sw.js and the cache rules still say it is never cached', () => {
    expect(read('public/_headers')).toMatch(/\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/);
    expect(read('scripts/test-offline-reload.mjs')).toContain('NO SIGNAL: a reload still opens the page');
  });
});
