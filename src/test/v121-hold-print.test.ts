// ============================================================
// HOLD PRINTING — UI action → order state → print trigger → print queue.
//
// Root cause: a bill saved straight to Hold printed nothing (the POS only
// sent KOTs for running/paid/partial), and the Hold buttons on Retrieve,
// Running Bills and the POS retrieve list changed the status only.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Order } from '@/lib/types';

const STORE_KEY = 'desi-pos-data';
function seed(order: Order, settings: Record<string, unknown> = {}) {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    orders: [order], menuItems: [], inventory: [], stockLogs: [], customers: [], recipes: [], tables: [], users: [], categories: [],
    settings: { name: 'Test', kotEnabled: true, ...settings }, orderCounter: 1,
  }));
}
function bill(over: Partial<Order> = {}): Order {
  return {
    id: 'h1', orderNumber: 301, orderType: 'dining', status: 'hold', tableName: 'T-2',
    items: [{ id: 'l1', menuItemId: 'm1', name: 'Karahi', price: 1500, quantity: 1, lineTotal: 1500 }],
    subtotal: 1500, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 1500,
    createdAt: new Date().toISOString(), notes: '', ...over,
  } as unknown as Order;
}
const jobs = async () => (await import('@/lib/printQueue')).getPrintQueue().map(j => j.printType).sort();

describe('printOnHold', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('a new bill put on Hold prints the bill AND sends the kitchen ticket', async () => {
    seed(bill());
    const q = await import('@/lib/printQueue');
    expect(q.printOnHold(bill())).toEqual({ bill: true, kot: true });
    expect(await jobs()).toEqual(['kot', 'receipt']);
  });

  it('a bill whose KOT already went out only prints the bill', async () => {
    seed(bill({ kotPrinted: true }));
    const q = await import('@/lib/printQueue');
    expect(q.printOnHold(bill({ kotPrinted: true }))).toEqual({ bill: true, kot: false });
  });

  it('"Print Bill on Hold" OFF keeps the kitchen ticket only', async () => {
    seed(bill(), { printBillOnHold: false });
    const q = await import('@/lib/printQueue');
    expect(q.printOnHold(bill())).toEqual({ bill: false, kot: true });
  });

  it('manual "Send to Kitchen" mode and KOT-off are respected', async () => {
    seed(bill(), { manualSendToKitchen: true });
    expect((await import('@/lib/printQueue')).printOnHold(bill()).kot).toBe(false);
    localStorage.clear(); vi.resetModules();
    seed(bill(), { kotEnabled: false });
    expect((await import('@/lib/printQueue')).printOnHold(bill()).kot).toBe(false);
  });

  it('holding twice quickly never prints twice', async () => {
    seed(bill());
    const q = await import('@/lib/printQueue');
    q.printOnHold(bill());
    expect(q.printOnHold(bill())).toEqual({ bill: false, kot: false });
    expect(await jobs()).toEqual(['kot', 'receipt']);
  });

  it('the message says only what was printed', async () => {
    const q = await import('@/lib/printQueue');
    expect(q.holdMessage(301, { bill: true, kot: true })).toBe('Bill #301 is on HOLD — UNPAID · bill and kitchen ticket sent to the printer');
    expect(q.holdMessage(301, { bill: false, kot: false })).toBe('Bill #301 is on HOLD — UNPAID');
  });
});

describe('every Hold action reaches the print trigger, once, on entering Hold', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
  it('POS Hold button (new and edited bills) and the POS retrieve list', () => {
    const pos = read('pages/POSScreen.tsx');
    expect(pos).toMatch(/status === 'hold'\) \{[\s\S]{0,300}printOnHold\(order, \{ kot: !isOrderTaker \}\)/);
    expect(pos).toMatch(/status === 'hold' && existing\.status !== 'hold'[\s\S]{0,300}printOnHold\(updated, \{ kot: false \}\)/);
    expect(pos).toMatch(/status === 'hold' && order\.status !== 'hold'\) \{\s*toast\.success\(holdMessage\(order\.orderNumber, printOnHold\(updated\)\)\)/);
  });
  it('Running Bills', () => {
    // The cloud app has no separate Retrieve page; the POS retrieve list (markBillStatus) covers that path.
    expect(read('pages/RunningBillsPage.tsx')).toMatch(/status === 'hold' && order\.status !== 'hold'\) toast\.success\(holdMessage\(order\.orderNumber, printOnHold\(updated\)\)\)/);
  });
});
