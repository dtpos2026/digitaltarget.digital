// ============================================================
// RETRIEVE → PAY: the paid receipt prints first, at once — "print late aata hai".
//
// Reported from a Black Copper counter: Print Speed Test showed a receipt and
// a KOT waiting ~20 s in the queue before rendering (Enqueue→Render 20464–
// 20670 ms) and then printing in under a second. Two faults, both in the
// print host rather than the printer:
//   1. the layout around the host re-renders every second (header clock);
//      a render between mounting a slip and starting its print cancelled the
//      print, and the job waited for the 20-second safety timeout;
//   2. Retrieve → Pay queues the new items' KOT before the receipt, and the
//      host took the KOT the instant it was queued, so the receipt waited.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import AutoKotPrinter from '@/components/AutoKotPrinter';
import { enqueueKot, enqueueReceiptOnPay, getPrintQueue } from '@/lib/printQueue';
import type { Order } from '@/lib/types';

const STORE_KEY = 'desi-pos-data';

const order = {
  id: 'o-3057', orderNumber: 3057, orderType: 'dining', status: 'paid', paymentMethod: 'cash',
  items: [
    { id: 'i1', menuItemId: 'm1', name: 'Zinger Burger', price: 500, quantity: 2, lineTotal: 1000, pricingType: 'fixed', printedQty: 1 },
  ],
  subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1000,
  createdAt: new Date().toISOString(), paidAt: new Date().toISOString(), kotPrinted: true,
} as unknown as Order;

function seed() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    categories: [{ id: 'c1', name: 'Main', sortOrder: 1 }],
    menuItems: [{ id: 'm1', name: 'Zinger Burger', price: 500, categoryId: 'c1', isActive: true, isAvailable: true }],
    orders: [order], stockLogs: [], customers: [], recipes: [], tables: [], users: [], inventory: [],
    settings: { name: 'LOTUS CAFE', currencySymbol: 'Rs ', paperSize: '80mm', defaultPrinter: 'BlackCopper 80mm Series', kotPrinter: 'BlackCopper 80mm Series' },
    orderCounter: 3057,
  }));
}

/**
 * The layout around the print host, as AppLayout mounts it: the host is
 * created in the layout's own render, and the layout re-renders constantly
 * (its header clock ticks every second; here every 2 ms).
 */
function BusyLayout() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 2);
    return () => clearInterval(t);
  }, []);
  return <div data-tick={tick}><AutoKotPrinter /></div>;
}

beforeEach(() => {
  localStorage.clear();
  seed();
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('print host on Retrieve → Pay', () => {
  it('the receipt starts first and both slips print within a second, under constant re-renders', async () => {
    render(<BusyLayout />);
    await new Promise(r => setTimeout(r, 50));
    // One click: the new items' KOT update, then the paid receipt (POSScreen's edit path).
    const t0 = Date.now();
    enqueueKot(order, { force: true, updateMode: true, diffItemIds: ['i1'], diffDeltas: { i1: 1 } });
    enqueueReceiptOnPay(order);
    await waitFor(() => {
      const jobs = getPrintQueue();
      expect(jobs).toHaveLength(2);
      expect(jobs.every(j => j.status === 'printed')).toBe(true);
    }, { timeout: 5000 });
    const jobs = getPrintQueue();
    const receipt = jobs.find(j => j.printType === 'receipt')!;
    const kot = jobs.find(j => j.printType === 'kot')!;
    const at = (s?: string) => new Date(s || 0).getTime();
    // Receipt first...
    expect(at(receipt.renderStartedAt)).toBeLessThanOrEqual(at(kot.renderStartedAt));
    // ...started straight away, and printed well inside a second.
    expect(at(receipt.renderStartedAt) - at(receipt.createdAt)).toBeLessThan(250);
    expect(receipt.durationMs!).toBeLessThan(1000);
    expect(Date.now() - t0).toBeLessThan(2000);
    // Each printed once.
    expect(window.print).toHaveBeenCalledTimes(2);
  });
});
