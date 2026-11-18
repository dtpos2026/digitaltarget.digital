// v1.125.0 — public/sw.js, run in a sandbox with a fake cache and a fake network: what it answers, what it keeps, what it never touches,
// and the kill switches. (The same file is also run for real, in Chromium with the network switched off: scripts/test-offline-reload.mjs.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(__dirname, '../..');
const SW_SOURCE = readFileSync(resolve(ROOT, 'public/sw.js'), 'utf8');
const ORIGIN = 'https://shop.test';

const norm = (k: unknown): string => {
  const u = typeof k === 'string' ? k : (k as { url: string }).url;
  return u.startsWith(ORIGIN) ? u.slice(ORIGIN.length) : u;
};
class FakeCache {
  map = new Map<string, Response>();
  async match(req: unknown) { return this.map.get(norm(req))?.clone(); }
  async put(req: unknown, res: Response) { this.map.set(norm(req), res); }
  async keys() { return [...this.map.keys()].map(k => ({ url: ORIGIN + k })); }
  async delete(req: unknown) { return this.map.delete(norm(req)); }
}
const basic = (body: string, init: ResponseInit & { type?: string } = {}): Response => {
  const r = new Response(body, init);
  Object.defineProperty(r, 'type', { value: init.type ?? 'basic' });
  return r;
};
const html = (body = '<html>page</html>', status = 200) => basic(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const js = (body = 'export default 1') => basic(body, { headers: { 'content-type': 'text/javascript' } });

function load(opts: { source?: string; version?: string; fetchImpl?: (req: unknown) => Promise<Response> } = {}) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, FakeCache>();
  const calls: string[] = [];
  const state = { claimed: false, unregistered: false, skipped: false };
  const caches = {
    open: async (n: string) => { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n)!; },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const self = {
    location: { href: `${ORIGIN}/sw.js?v=${opts.version ?? '9.9'}`, origin: ORIGIN },
    addEventListener: (t: string, fn: (e: unknown) => void) => { handlers[t] = fn; },
    skipWaiting: () => { state.skipped = true; },
    clients: { claim: async () => { state.claimed = true; } },
    registration: { unregister: async () => { state.unregistered = true; return true; } },
  };
  const fetchFn = (req: unknown) => { calls.push(norm(req)); return (opts.fetchImpl ?? (async () => html()))(req); };
  vm.runInNewContext(opts.source ?? SW_SOURCE, {
    self, caches, fetch: fetchFn, URL, Response, Promise, console,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  });
  const fire = (url: string, o: { method?: string; mode?: string; cache?: string } = {}) => {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    const event = {
      request: { url: url.startsWith('http') ? url : ORIGIN + url, method: o.method ?? 'GET', mode: o.mode ?? 'no-cors', cache: o.cache ?? 'default' },
      respondWith: (p: Promise<Response>) => { responded = Promise.resolve(p); },
      waitUntil: (p: Promise<unknown>) => { waits.push(Promise.resolve(p)); },
    };
    handlers.fetch(event);
    return { responded, settle: () => Promise.all(waits.map(w => w.catch(() => undefined))) };
  };
  const lifecycle = async (type: 'install' | 'activate' | 'message', data?: unknown) => {
    const waits: Promise<unknown>[] = [];
    handlers[type]({ waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)), data });
    await Promise.all(waits);
  };
  return { fire, lifecycle, stores, calls, state, handlers };
}
const keysOf = (c: FakeCache | undefined) => (c ? [...c.map.keys()] : []);

describe('the page (GET /)', () => {
  it('network first: the network answers, and the answer is kept under one key, whatever the query string was', async () => {
    const w = load({ fetchImpl: async () => html('<html>today</html>') });
    const { responded, settle } = w.fire('/?device=till-2', { mode: 'navigate' });
    expect(await (await responded!).text()).toBe('<html>today</html>');
    await settle();
    expect(keysOf(w.stores.get('dt-shell-9.9'))).toEqual(['/']);
    expect(await (await w.stores.get('dt-shell-9.9')!.match('/'))!.text()).toBe('<html>today</html>');
  });

  it('no signal: the kept page answers; with nothing kept yet it fails like any browser would', async () => {
    const w = load({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    const none = w.fire('/', { mode: 'navigate' });
    await expect(none.responded).rejects.toThrow();
    await none.settle();
    const c = new FakeCache(); w.stores.set('dt-shell-9.9', c); await c.put('/', html('<html>kept</html>'));
    const r = w.fire('/', { mode: 'navigate' });
    expect(await (await r.responded!).text()).toBe('<html>kept</html>');
    await r.settle();
  });

  describe('a slow network', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    it('after 3 seconds the kept page answers, and the late network answer is kept for next time', async () => {
      let release!: (r: Response) => void;
      const w = load({ fetchImpl: () => new Promise<Response>(res => { release = res; }) });
      const c = new FakeCache(); w.stores.set('dt-shell-9.9', c); await c.put('/', html('<html>kept</html>'));
      const { responded, settle } = w.fire('/', { mode: 'navigate' });
      let answer: string | null = null;
      void responded!.then(async r => { answer = await r.text(); });
      await vi.advanceTimersByTimeAsync(2900);
      expect(answer).toBeNull();                                         // still waiting for the network
      await vi.advanceTimersByTimeAsync(200);
      expect(answer).toBe('<html>kept</html>');                          // 3 s passed: the kept page
      release(html('<html>fresh</html>'));
      await vi.advanceTimersByTimeAsync(10);
      await settle();
      expect(await (await c.match('/'))!.text()).toBe('<html>fresh</html>');
    });
    it('a network that answers inside 3 seconds wins', async () => {
      const w = load({ fetchImpl: () => new Promise<Response>(res => setTimeout(() => res(html('<html>fresh</html>')), 1500)) });
      const c = new FakeCache(); w.stores.set('dt-shell-9.9', c); await c.put('/', html('<html>kept</html>'));
      const { responded } = w.fire('/', { mode: 'navigate' });
      await vi.advanceTimersByTimeAsync(1600);
      expect(await (await responded!).text()).toBe('<html>fresh</html>');
    });
  });

  it('a server error (5xx) is answered by the kept page and is not itself kept', async () => {
    const w = load({ fetchImpl: async () => html('Bad gateway', 502) });
    const c = new FakeCache(); w.stores.set('dt-shell-9.9', c); await c.put('/', html('<html>kept</html>'));
    const { responded, settle } = w.fire('/', { mode: 'navigate' });
    expect(await (await responded!).text()).toBe('<html>kept</html>');
    await settle();
    expect(await (await c.match('/'))!.text()).toBe('<html>kept</html>');
    // with nothing kept, the 502 is passed on as it is
    const w2 = load({ fetchImpl: async () => html('Bad gateway', 502) });
    expect((await w2.fire('/', { mode: 'navigate' }).responded!).status).toBe(502);
  });

  it('only a 200 that is HTML is kept as the page', async () => {
    const w = load({ fetchImpl: async () => js('not a page') });
    const { responded, settle } = w.fire('/', { mode: 'navigate' });
    await responded; await settle();
    expect(keysOf(w.stores.get('dt-shell-9.9'))).toEqual([]);
  });

  it('only GET / as a page load is handled: a script asking for "/", other paths and the API are left to the network', async () => {
    const w = load();
    expect(w.fire('/', { mode: 'no-cors' }).responded).toBeUndefined();
    expect(w.fire('/inventory', { mode: 'navigate' }).responded).toBeUndefined();
    expect(w.fire('/api/custom-site/order/x', { mode: 'navigate' }).responded).toBeUndefined();
    expect(w.fire('/api/x').responded).toBeUndefined();
    expect(w.fire('/_serverFn/abc').responded).toBeUndefined();
    expect(w.fire('/_server/x').responded).toBeUndefined();
    expect(w.fire('/sw.js?v=9.9').responded).toBeUndefined();
    expect(w.fire('/', { method: 'POST', mode: 'navigate' }).responded).toBeUndefined();
    expect(w.fire('https://drpzxzpvkpqfxcjbwypo.supabase.co/rest/v1/orders').responded).toBeUndefined();   // the cloud is another origin
    expect(w.fire('/assets/x.js', { method: 'POST' }).responded).toBeUndefined();
    expect(w.fire('/assets/x.js', { cache: 'only-if-cached', mode: 'no-cors' }).responded).toBeUndefined();
    expect(w.calls).toEqual([]);                                          // nothing was fetched on the way
  });
});

describe('the build files (/assets/*)', () => {
  it('kept on first use, then answered from the copy without touching the network', async () => {
    const w = load({ fetchImpl: async () => js('chunk-a') });
    const first = w.fire('/assets/Page-abc123.js');
    expect(await (await first.responded!).text()).toBe('chunk-a');
    await first.settle();
    expect(keysOf(w.stores.get('dt-assets'))).toEqual(['/assets/Page-abc123.js']);
    const second = w.fire('/assets/Page-abc123.js');
    expect(await (await second.responded!).text()).toBe('chunk-a');
    expect(w.calls).toEqual(['/assets/Page-abc123.js']);                  // fetched once only
  });
  it('a missing file, a page sent in place of a script, and a cross-origin or opaque answer are never kept', async () => {
    for (const res of [basic('nope', { status: 404, headers: { 'content-type': 'text/html' } }), html('<html>the app</html>'), basic('x', { type: 'opaque' }), basic('x', { type: 'cors' }), basic('err', { status: 500 })]) {
      const w = load({ fetchImpl: async () => res });
      const r = w.fire('/assets/gone-abc.js');
      await r.responded; await r.settle();
      expect(keysOf(w.stores.get('dt-assets'))).toEqual([]);
    }
  });
  it('trims to the newest 700 files', async () => {
    const w = load({ fetchImpl: async () => js('new') });
    const c = new FakeCache(); w.stores.set('dt-assets', c);
    for (let i = 0; i < 705; i++) await c.put(`/assets/old-${i}.js`, js(`o${i}`));
    const r = w.fire('/assets/newest.js');
    await r.responded; await r.settle();
    const keys = keysOf(c);
    expect(keys.length).toBe(700);
    expect(keys).toContain('/assets/newest.js');
    expect(keys).not.toContain('/assets/old-0.js');                       // the oldest went first
    expect(keys).toContain('/assets/old-6.js');
  });
});

describe('fonts, icons and the manifest', () => {
  it('answered from the copy while a fresh one is fetched and kept', async () => {
    const w = load({ fetchImpl: async () => basic('v2', { headers: { 'content-type': 'font/woff2' } }) });
    const c = new FakeCache(); w.stores.set('dt-shell-9.9', c); await c.put('/fonts/Inter.woff2', basic('v1'));
    const r = w.fire('/fonts/Inter.woff2');
    expect(await (await r.responded!).text()).toBe('v1');
    await r.settle();
    expect(await (await c.match('/fonts/Inter.woff2'))!.text()).toBe('v2');
    for (const p of ['/favicon.ico', '/apple-touch-icon.png', '/pwa-icon-192.png', '/splash.png', '/manifest.webmanifest']) expect(w.fire(p).responded).toBeDefined();
    expect(w.fire('/robots.txt').responded).toBeUndefined();
  });
});

describe('versions and the kill switches', () => {
  it('the cache of the page is named after the release in the registration address', async () => {
    const w = load({ version: '1.125.0' });
    const r = w.fire('/', { mode: 'navigate' }); await r.responded; await r.settle();
    expect([...w.stores.keys()]).toEqual(['dt-shell-1.125.0']);
  });
  it('a new release deletes the old page caches, keeps the build files, leaves other caches alone, and takes over', async () => {
    const w = load({ version: '2.0.0' });
    for (const n of ['dt-shell-1.9.0', 'dt-shell-2.0.0', 'dt-assets', 'something-else']) await w.stores.set(n, new FakeCache());
    await w.lifecycle('install'); await w.lifecycle('activate');
    expect([...w.stores.keys()].sort()).toEqual(['dt-assets', 'dt-shell-2.0.0', 'something-else']);
    expect(w.state).toMatchObject({ skipped: true, claimed: true, unregistered: false });
  });
  it('KILL = true: on activation it deletes every dt- copy, unregisters itself, and never answers a request', async () => {
    const w = load({ source: SW_SOURCE.replace('var KILL = false;', 'var KILL = true;') });
    for (const n of ['dt-shell-1.0.0', 'dt-assets', 'something-else']) w.stores.set(n, new FakeCache());
    await w.lifecycle('activate');
    expect([...w.stores.keys()]).toEqual(['something-else']);
    expect(w.state.unregistered).toBe(true);
    expect(w.fire('/', { mode: 'navigate' }).responded).toBeUndefined();
    expect(w.fire('/assets/a-b.js').responded).toBeUndefined();
  });
  it('the page’s kill switch sends "dt-off": from then on the worker answers nothing and keeps nothing', async () => {
    const w = load();
    expect(w.fire('/assets/a-b.js').responded).toBeDefined();
    await w.lifecycle('message', { type: 'dt-off' });
    expect(w.fire('/assets/a-b.js').responded).toBeUndefined();
    expect(w.fire('/', { mode: 'navigate' }).responded).toBeUndefined();
    await w.lifecycle('message', { type: 'something else' });             // other messages change nothing
  });
  it('is shipped with KILL off, and the file is never cached by the browser', () => {
    expect(SW_SOURCE).toContain('var KILL = false;');
    const headers = readFileSync(resolve(ROOT, 'public/_headers'), 'utf8');
    expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/);
  });
});
