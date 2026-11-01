// ============================================================
// PRINTER NAME RESOLVER (electron/printerResolve.cjs).
//
// The image route now follows a Windows rename ("… (Copy 1)") instead of
// failing RAW and falling back to the slow driver route. Resolving must
// never make a slip late: these tests pin the cache, the shared query, the
// time limit and the no-throw fallback.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { HAS_ENGINE, requireEngine } from './_shellEngine';

const require_ = createRequire(import.meta.url);
const { createPrinterResolver } = requireEngine('printerResolve.cjs');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// A stand-in for main.cjs's matchPrinterName: exact, else the "(Copy n)" rename.
const match = (name: string, printers: Array<{ name: string }>) => {
  const exact = printers.find(p => p.name === name);
  if (exact) return { name: exact.name, stage: 'exact' };
  const copy = printers.find(p => p.name.replace(/\s*\(Copy \d+\)$/i, '') === name);
  return copy ? { name: copy.name, stage: 'no-suffix' } : { name, stage: 'passthrough' };
};
const installed = [{ name: 'BlackCopper 80mm Series (Copy 1)' }, { name: 'Microsoft Print to PDF' }];

describe('following a renamed printer', () => {
  it('the saved name resolves to the renamed queue', async () => {
    const r = createPrinterResolver({ list: async () => installed, match });
    expect(await r.resolve('BlackCopper 80mm Series')).toEqual({ name: 'BlackCopper 80mm Series (Copy 1)', stage: 'no-suffix' });
    expect(await r.resolve('Microsoft Print to PDF')).toEqual({ name: 'Microsoft Print to PDF', stage: 'exact' });
  });
  it('no saved name → nothing to open', async () => {
    const list = vi.fn(async () => installed);
    const r = createPrinterResolver({ list, match });
    expect(await r.resolve('  ')).toEqual({ name: '', stage: 'none' });
    expect(list).not.toHaveBeenCalled();
  });
});

describe('one Windows query, not one per slip', () => {
  it('the list is reused for 30 s', async () => {
    let t = 1_000_000;
    const list = vi.fn(async () => installed);
    const r = createPrinterResolver({ list, match, now: () => t });
    await r.resolve('BlackCopper 80mm Series');
    t += 29_000;
    await r.resolve('BlackCopper 80mm Series');
    expect(list).toHaveBeenCalledTimes(1);
    t += 2_000;
    await r.resolve('BlackCopper 80mm Series');
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('a bill and a KOT printing together share one query', async () => {
    const list = vi.fn(async () => { await sleep(20); return installed; });
    const r = createPrinterResolver({ list, match });
    const [bill, kot] = await Promise.all([r.resolve('BlackCopper 80mm Series'), r.resolve('BlackCopper 80mm Series')]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(bill.name).toBe(kot.name);
  });
  it('after a job could not open its printer, `fresh` reads the list again', async () => {
    let now: Array<{ name: string }> = [{ name: 'BlackCopper 80mm Series' }];
    const r = createPrinterResolver({ list: async () => now, match });
    expect((await r.resolve('BlackCopper 80mm Series')).name).toBe('BlackCopper 80mm Series');
    now = [{ name: 'BlackCopper 80mm Series (Copy 2)' }];    // re-plugged meanwhile
    expect((await r.resolve('BlackCopper 80mm Series')).name).toBe('BlackCopper 80mm Series');   // cached
    expect((await r.resolve('BlackCopper 80mm Series', true)).name).toBe('BlackCopper 80mm Series (Copy 2)');
  });
  it('an empty list is not cached — the next slip asks again', async () => {
    const list = vi.fn(async () => [] as Array<{ name: string }>);
    const r = createPrinterResolver({ list, match });
    await r.resolve('P'); await r.resolve('P');
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('resolving never makes a slip late or fails it', () => {
  it('a slow printer list is not waited for: the slip prints on the saved name', async () => {
    const list = vi.fn(async () => { await sleep(200); return installed; });
    const r = createPrinterResolver({ list, match, waitMs: 30 });
    const t0 = Date.now();
    expect(await r.resolve('BlackCopper 80mm Series')).toEqual({ name: 'BlackCopper 80mm Series', stage: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(150);
    // …and the list, once it arrives, serves the next slip at once.
    await sleep(220);
    expect(await r.resolve('BlackCopper 80mm Series')).toEqual({ name: 'BlackCopper 80mm Series (Copy 1)', stage: 'no-suffix' });
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('a failing enumeration prints on the saved name and never rejects', async () => {
    const r = createPrinterResolver({ list: async () => { throw new Error('spooler stopped'); }, match });
    await expect(r.resolve('BlackCopper 80mm Series')).resolves.toEqual({ name: 'BlackCopper 80mm Series', stage: 'error' });
  });
  it('a matcher that throws is survived too', async () => {
    const r = createPrinterResolver({ list: async () => installed, match: () => { throw new Error('bad'); } });
    await expect(r.resolve('X')).resolves.toEqual({ name: 'X', stage: 'error' });
  });
});
