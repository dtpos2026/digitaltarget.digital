// v1.128.1 — "Page Unresponsive" at the busy restaurants.
// Settling a bill re-read, sorted, re-serialised and re-wrote the WHOLE order archive from localStorage, on the main thread, for every
// paid bill (measured: 160 ms for one sale at 4x slower CPU with 3,500 archived orders, and growing). Past the browser's ~5 MB it failed,
// halved and wrote again. These tests pin the cost model, not a stopwatch: a sale must not parse or serialise the archive.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { archiveOrders, archiveBudgetChars, clearArchivedOrders, flushArchive, getAllHistoricalOrders, getArchivedOrders } from '@/lib/orderArchive';
import type { Order } from '@/lib/types';

const NOW = Date.now();
const order = (i: number, over: Partial<Order> = {}): Order => ({
  id: 'o' + i, orderNumber: i, orderType: 'dining', status: 'paid', items: [{ id: 'i' + i, name: 'Zinger Burger', price: 650, quantity: 1, lineTotal: 650 }],
  subtotal: 650, grandTotal: 650, createdAt: new Date(NOW - i * 60_000).toISOString(), payments: [], ...over,
} as unknown as Order);

const archiveKey = () => Object.keys(localStorage).find(k => k.startsWith('dt-pos-order-archive::'));

beforeEach(() => { localStorage.clear(); clearArchivedOrders(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('one settled sale', () => {
  it('only touches memory: nothing is parsed or serialised, and the write waits for a quiet moment', () => {
    archiveOrders(Array.from({ length: 50 }, (_, i) => order(i)));                // Day Close-sized: written at once
    const before = localStorage.getItem(archiveKey()!);
    const stringify = vi.spyOn(JSON, 'stringify'); const parse = vi.spyOn(JSON, 'parse');
    for (let i = 100; i < 120; i++) archiveOrders([order(i)]);                    // twenty sales in a rush
    expect(stringify).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(localStorage.getItem(archiveKey()!)).toBe(before);                     // storage untouched
    expect(getArchivedOrders()).toHaveLength(70);                                 // ...yet every one of them is already visible to the reports
  });

  it('twenty sales are written ONCE, a few seconds later', () => {
    archiveOrders(Array.from({ length: 50 }, (_, i) => order(i)));
    const stringify = vi.spyOn(JSON, 'stringify');
    for (let i = 100; i < 120; i++) archiveOrders([order(i)]);
    expect(JSON.parse(localStorage.getItem(archiveKey()!)!)).toHaveLength(50);   // not written yet
    vi.advanceTimersByTime(5000);
    expect(stringify).toHaveBeenCalledTimes(1);                                   // one serialisation for the twenty sales
    expect(JSON.parse(localStorage.getItem(archiveKey()!)!)).toHaveLength(70);
  });

  it('closing or hiding the till writes at once — nothing waits on a timer', () => {
    archiveOrders([order(1)]);
    expect(archiveKey()).toBeUndefined();
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(archiveKey()!)!)).toHaveLength(1);
  });

  it('several bills at once (Day Close, a privacy erase) are written straight away, and say so', () => {
    expect(archiveOrders([order(1), order(2)])).toBe(true);
    expect(JSON.parse(localStorage.getItem(archiveKey()!)!)).toHaveLength(2);
  });
});

describe('the reports read the archive without parsing it each time', () => {
  it('many reads parse the stored archive at most once', () => {
    archiveOrders(Array.from({ length: 200 }, (_, i) => order(i)));
    flushArchive();
    clearArchivedOrders();                                                        // forget memory; keep storage empty -> write again below
    archiveOrders(Array.from({ length: 200 }, (_, i) => order(i)));
    flushArchive();
    const parse = vi.spyOn(JSON, 'parse');
    for (let i = 0; i < 30; i++) getAllHistoricalOrders([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it('still notices storage that was cleared behind its back', () => {
    archiveOrders([order(1), order(2)]);
    localStorage.clear();
    expect(getArchivedOrders()).toEqual([]);
  });
});

describe('the archive stays inside what the live cache leaves free', () => {
  it('gets less room when something else is already holding most of the storage', () => {
    const empty = archiveBudgetChars();
    localStorage.setItem('desi-pos-data:t', 'x'.repeat(3_500_000));
    expect(archiveBudgetChars()).toBeLessThan(empty);
    expect(archiveBudgetChars()).toBeLessThanOrEqual(1_300_000);
  });

  it('is trimmed in ONE pass to the newest bills that fit, instead of writing until the browser refuses', () => {
    localStorage.setItem('desi-pos-data:t', 'x'.repeat(4_300_000));              // a busy restaurant's live cache
    const budget = archiveBudgetChars();
    expect(budget).toBeLessThanOrEqual(400_000);
    const stringify = vi.spyOn(JSON, 'stringify');
    archiveOrders(Array.from({ length: 3000 }, (_, i) => order(i)));              // far more than fits
    const kept = JSON.parse(localStorage.getItem(archiveKey()!)!) as Order[];
    expect(localStorage.getItem(archiveKey()!)!.length).toBeLessThanOrEqual(budget);
    expect(stringify.mock.calls.length).toBeLessThanOrEqual(2);                    // measure, then write the trimmed copy
    expect(kept[0].id).toBe('o0');                                                // newest first: the bills kept are the recent ones
    expect(kept.length).toBeLessThan(3000);
  });

  it('never leaves less than a small floor, so a restaurant with a full cache still keeps some history', () => {
    localStorage.setItem('desi-pos-data:t', 'x'.repeat(4_650_000));
    expect(archiveBudgetChars()).toBeGreaterThanOrEqual(150_000);
  });
});
