// v1.119.0 — the day-to-day screens are fetched when the browser is idle after sign-in, so they open at once and survive a dropped signal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CORE_SCREENS, EXPORT_LIBS, _resetWarm, skipReason, warmCoreScreens } from '@/lib/prefetchScreens';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('when warming is skipped', () => {
  it('offline, data saver, and a slow link — but not on a good one', () => {
    expect(skipReason({ online: false })).toBe('offline');
    expect(skipReason({ online: true, saveData: true })).toBe('data saver');
    for (const t of ['slow-2g', '2g', '3g']) expect(skipReason({ online: true, effectiveType: t })).toBe('slow connection');
    expect(skipReason({ online: true, effectiveType: '4g' })).toBeNull();
    expect(skipReason({})).toBeNull();
  });
});

describe('warming', () => {
  beforeEach(() => { _resetWarm(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const loaders = () => { const order: string[] = []; const mk = (k: string, fail = false) => () => { order.push(k); return fail ? Promise.reject(new Error('x')) : Promise.resolve({}); }; return { order, loaders: { a: mk('a'), b: mk('b', true), c: mk('c') } }; };

  it('fetches the files one at a time, in order, and one that fails does not stop the rest', async () => {
    const { order, loaders: l } = loaders();
    expect(warmCoreScreens({ loaders: l, idle: f => f(), online: true, gapMs: 0 })).toEqual(['a', 'b', 'c']);
    await vi.runAllTimersAsync();
    expect(order).toEqual(['a', 'b', 'c']);
  });
  it('waits for idle time before each file', async () => {
    const { order, loaders: l } = loaders();
    const queue: (() => void)[] = [];
    warmCoreScreens({ loaders: l, idle: f => queue.push(f), online: true, gapMs: 0 });
    expect(order).toEqual([]);                                      // nothing yet: the browser is not idle
    queue.shift()!(); await vi.runAllTimersAsync();
    expect(order).toEqual(['a']);
    queue.shift()!(); await vi.runAllTimersAsync();
    expect(order).toEqual(['a', 'b']);
  });
  it('once per session', () => {
    const { loaders: l } = loaders();
    expect(warmCoreScreens({ loaders: l, idle: () => undefined, online: true }).length).toBe(3);
    expect(warmCoreScreens({ loaders: l, idle: () => undefined, online: true })).toEqual([]);
  });
  it('does nothing offline, on a data saver or a slow link — and may try again later', async () => {
    const { order, loaders: l } = loaders();
    expect(warmCoreScreens({ loaders: l, idle: f => f(), online: false })).toEqual([]);
    expect(warmCoreScreens({ loaders: l, idle: f => f(), online: true, saveData: true })).toEqual([]);
    expect(warmCoreScreens({ loaders: l, idle: f => f(), online: true, effectiveType: '2g' })).toEqual([]);
    await vi.runAllTimersAsync();
    expect(order).toEqual([]);
    expect(warmCoreScreens({ loaders: l, idle: () => undefined, online: true }).length).toBe(3);   // a skipped try does not use up the session
  });
  it('stops when the signal goes in the middle', async () => {
    const { order, loaders: l } = loaders();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    warmCoreScreens({ loaders: l, idle: f => f(), online: true, gapMs: 100 });
    await vi.advanceTimersByTimeAsync(50);
    online.mockReturnValue(false);
    await vi.runAllTimersAsync();
    expect(order).toEqual(['a']);                                   // the first was fetched, then the signal went and the rest were left
  });
});

describe('the list', () => {
  const src = read('src/lib/prefetchScreens.ts');
  it('every screen named exists', () => {
    const paths = [...src.matchAll(/import\('@\/pages\/(\w+)'\)/g)].map(m => m[1]);
    expect(paths.length).toBe(Object.keys(CORE_SCREENS).length);
    for (const p of paths) expect(existsSync(resolve(root, `src/pages/${p}.tsx`)), p).toBe(true);
  });
  it('includes the report makers, so PDF and JPG work with no signal', () => {
    expect(Object.keys(EXPORT_LIBS).sort()).toEqual(['image', 'pdf', 'pdf-table']);
    for (const lib of ['jspdf', 'jspdf-autotable', 'html2canvas']) expect(src).toContain(`import('${lib}')`);
  });
  it('is started by the signed-in shell only — not by the public website, the Owner app or the displays', () => {
    expect(read('src/components/AppLayout.tsx')).toContain('warmCoreScreens()');
    for (const f of ['src/pages/OnlineOrderPage.tsx', 'src/pages/OwnerAppPage.tsx', 'src/pages/CustomerDisplayPage.tsx']) expect(read(f)).not.toContain('warmCoreScreens');
  });
});
