// ============================================================
// KOT PRINTED TWICE — "when I print just the KOT, two slips come out".
//
// The POS "Kitchen" button saves the order as running, which queues its KOT
// through the print host (Auto Print KOT is on by default) — and then opened
// the Kitchen Slip window, whose preview auto-printed the same KOT AGAIN,
// straight to the printer, outside the queue (so none of the queue's
// duplicate guards could see it). One press, two tickets.
//
// Pinned:
//   • the slip window prints by itself only when the queue has NOT already
//     sent this order's KOT; otherwise it just shows the slip, and its Print
//     button still gives a deliberate extra copy;
//   • with Auto Print KOT off ("send manually") the window is the only printer
//     and still prints once;
//   • a ticket that failed for good does not count as sent;
//   • every opener of the window goes through that one decision.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import KitchenReceipt from '@/components/KitchenReceipt';
import { buildSampleOrder } from '@/lib/sampleOrder';
import type { RestaurantSettings } from '@/lib/types';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const STORE_KEY = 'desi-pos-data';
const order = { ...buildSampleOrder(), id: 'ord-1', status: 'running', kotPrinted: false } as ReturnType<typeof buildSampleOrder>;
const settings = { name: 'Chai Corner', currencySymbol: 'Rs ', paperSize: '80mm', receiptDesign: 'classic', kotDesign: 'classic', kotEnabled: true } as unknown as RestaurantSettings;

function seed(extra: Record<string, unknown> = {}) {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    orders: [order], menuItems: [], inventory: [], stockLogs: [], customers: [], recipes: [], tables: [], users: [], categories: [],
    paymentAccounts: [], settings: { name: 'Chai Corner', kotEnabled: true, ...extra }, orderCounter: 0,
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the Kitchen Slip window', () => {
  it('prints once by itself when it is asked to', async () => {
    const done = vi.fn();
    render(<KitchenReceipt order={order} settings={settings} autoPrint autoPrintDelayMs={0} onAutoPrintComplete={r => done(r)} />);
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('only shows the slip when the queue already sent the KOT — Print is still there', async () => {
    const done = vi.fn();
    const { container, getByText } = render(<KitchenReceipt order={order} settings={settings} autoPrint={false} autoPrintDelayMs={0} onAutoPrintComplete={r => done(r)} />);
    await new Promise(r => setTimeout(r, 400));
    expect(done).not.toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
    expect(container.textContent).toMatch(order.items[0].name);
    // A deliberate extra copy is one press away.
    fireEvent.click(getByText(/Print Kitchen Slip/));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});

describe('the decision', () => {
  it('a KOT that is queued, printing or just printed counts as sent', async () => {
    seed();
    const q = await import('@/lib/printQueue');
    expect(q.kotRecentlyQueued(order.id)).toBe(false);
    const job = q.enqueueKot(order as never);
    expect(job).toBeTruthy();
    expect(q.kotRecentlyQueued(order.id)).toBe(true);             // waiting in the queue
    q.markPrinting(job!.id);
    expect(q.kotRecentlyQueued(order.id)).toBe(true);             // on the printer
    q.markPrinted(job!.id);
    expect(q.kotRecentlyQueued(order.id)).toBe(true);             // came out a moment ago
    expect(q.kotRecentlyQueued('some-other-order')).toBe(false);
    expect(q.kotRecentlyQueued('')).toBe(false);
  });

  it('after a minute it is a new request again (a deliberate reprint prints)', async () => {
    seed();
    const q = await import('@/lib/printQueue');
    q.enqueueKot(order as never);
    expect(q.kotRecentlyQueued(order.id, 60_000, Date.now() + 59_000)).toBe(true);
    expect(q.kotRecentlyQueued(order.id, 60_000, Date.now() + 61_000)).toBe(false);
  });

  it('a ticket that failed for good did not come out, so the window prints it', async () => {
    seed();
    const q = await import('@/lib/printQueue');
    const job = q.enqueueKot(order as never)!;
    for (let i = 0; i < 3; i++) q.markFailed(job.id, 'printer offline');
    expect(q.getPrintQueue().find(j => j.id === job.id)).toMatchObject({ status: 'failed', retryCount: 3 });
    expect(q.kotRecentlyQueued(order.id)).toBe(false);
  });

  it('one press of Kitchen = one ticket: the queue holds one job and the window stays quiet', async () => {
    seed();                                                   // Auto Print KOT is on by default
    const q = await import('@/lib/printQueue');
    q.enqueueKot(order as never);                             // what processOrder('running') does
    expect(q.getPrintQueue().filter(j => j.printType === 'kot')).toHaveLength(1);
    const auto = !q.kotRecentlyQueued(order.id);              // what openKitchenSlip() decides
    expect(auto).toBe(false);
    render(<KitchenReceipt order={order} settings={settings} autoPrint={auto} autoPrintDelayMs={0} />);
    await new Promise(r => setTimeout(r, 400));
    expect(window.print).not.toHaveBeenCalled();
  });

  it('with Auto Print KOT off the window is the only printer, and it prints once', async () => {
    seed({ autoPrintKot: false, manualSendToKitchen: true });
    const q = await import('@/lib/printQueue');
    expect(q.getPrintQueue().filter(j => j.printType === 'kot')).toHaveLength(0);
    const auto = !q.kotRecentlyQueued(order.id);
    expect(auto).toBe(true);
    const done = vi.fn();
    render(<KitchenReceipt order={order} settings={settings} autoPrint={auto} autoPrintDelayMs={0} onAutoPrintComplete={r => done(r)} />);
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});

describe('the whole press, with the real print host', () => {
  // Mounts the print host the way the layout does, queues the KOT the way
  // processOrder('running') does, then opens the slip window the way the
  // Kitchen button does — the old window always printed, giving two slips.
  const press = async (windowPrints: (queued: boolean) => boolean) => {
    seed();
    const q = await import('@/lib/printQueue');
    const { default: AutoKotPrinter } = await import('@/components/AutoKotPrinter');
    const host = render(<AutoKotPrinter />);
    q.enqueueKot(order as never);
    const auto = windowPrints(q.kotRecentlyQueued(order.id));
    const done = vi.fn();
    render(<KitchenReceipt order={order} settings={settings} autoPrint={auto} autoPrintDelayMs={0} onAutoPrintComplete={r => done(r)} />);
    await waitFor(() => expect(q.getPrintQueue().find(j => j.printType === 'kot')?.status).toBe('printed'), { timeout: 5000 });
    await new Promise(r => setTimeout(r, 500));
    host.unmount();
    return (window.print as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
  };

  it('before: the window printed whatever the queue had done — two slips', async () => {
    expect(await press(() => true)).toBe(2);
  });

  it('now: one slip', async () => {
    expect(await press(queued => !queued)).toBe(1);
  });
});

describe('the POS screen', () => {
  const pos = read('pages/POSScreen.tsx');

  it('every opener of the window goes through one decision', () => {
    expect(pos.match(/setShowKitchenReceipt\(true\)/g)).toHaveLength(1);     // only inside openKitchenSlip
    expect(pos).toMatch(/const openKitchenSlip = \(\) => \{\s*setKitchenSlipAuto\(!kotRecentlyQueued\(lastOrderIdRef\.current\) && !lastOrderKotSentRef\.current\);\s*setShowKitchenReceipt\(true\);/);
    // Kitchen button (new order and last order), the table/delivery dialogs, and the window's own tab.
    // (The cloud POS has no "More" menu entry for the slip, so five openers rather than six. It also keeps the
    // cloud's own `kotPrinted` guard inside the decision, so an old, already-sent order is not re-printed.)
    expect(pos.match(/openKitchenSlip\(\)/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('both slip previews obey it', () => {
    expect(pos.match(/autoPrint=\{kitchenSlipAuto\}/g)).toHaveLength(2);
    expect(pos).not.toMatch(/<KitchenReceipt[^>]*\n\s+autoPrint\n/);
    expect(pos).toMatch(/data-kot-already-sent/);
  });

  it('the window always knows which order it is about', () => {
    expect(pos).not.toMatch(/[^a-zA-Z]setLastOrder\((?!o\))/);               // only rememberLastOrder calls it
    expect(pos).toMatch(/rememberLastOrder = \(o: Order \| null\) => \{ lastOrderIdRef\.current = o\?\.id \|\| ''; lastOrderKotSentRef\.current = !!o\?\.kotPrinted; setLastOrder\(o\); \}/);
  });
});
