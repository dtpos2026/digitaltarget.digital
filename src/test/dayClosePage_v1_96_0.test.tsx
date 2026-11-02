// ============================================================
// v1.96.0 — the Day Close page.
//
// Day Close was a tab at the bottom of Settings. The sidebar's "Day Close" now opens a page of its own (like the offline
// POS): the shift report, what the day close clears (bills, tables, order number, backup, the modules reset to 00), and a
// confirmation that lists exactly how many bills leave the live lists. The work itself is the cloud's own, moved
// unchanged (v1.27.1 and later): it stops while bills have not reached the server and archives instead of deleting.
//
// Pinned: planDayClose = the old inline rule, for every status, payment and checkbox; the page's counts, choices and
// persistence; the confirmation; that a blocked close does nothing; what a successful one calls and in what order; the
// cashier's request-only view; and the wiring (route, permission path, Settings pointing here instead of holding a copy).
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import type { Order } from '@/lib/types';
import { dayCloseGroupOf, getDayCloseConfig, planDayClose, type DayCloseConfig } from '@/lib/dayCloseConfig';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const calls: string[] = [];
const archiveOrdersBulk = vi.fn(async (ids: string[]) => { calls.push('archive'); return { archived: ids.length, failed: 0, offline: false } as { archived: number; failed: number; offline: boolean; error?: string }; });
const resetOrderCounter = vi.fn(async () => { calls.push('counter'); return true; });
const clearCollectionsForDayClose = vi.fn(async (cols: string[]) => { calls.push('modules'); return Object.fromEntries(cols.map(c => [c, 3])); });
const countUnsyncedOrders = vi.fn(async () => 0);
const logDayCloseEvent = vi.fn(async () => { calls.push('audit'); });

vi.mock('@/lib/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/store')>()),
  archiveOrdersBulk: (...a: [string[]]) => archiveOrdersBulk(...a),
  resetOrderCounter: (...a: [number]) => resetOrderCounter(...(a as [])),
  clearCollectionsForDayClose: (...a: [string[]]) => clearCollectionsForDayClose(...a),
}));
vi.mock('@/lib/dayClosePreflight', async (orig) => ({ ...(await orig<typeof import('@/lib/dayClosePreflight')>()), countUnsyncedOrders: () => countUnsyncedOrders() }));
vi.mock('@/lib/dayCloseBackup', () => ({ saveBackupToCloud: async () => true, logDayCloseEvent: (...a: []) => logDayCloseEvent(...a) }));
vi.mock('@/components/ShiftReport', () => ({ printShiftReport: vi.fn(async () => ({ success: true })) }));
const toastError = vi.fn(); const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn(), message: vi.fn() } }));

const NOW = new Date(2026, 10, 4, 21, 0, 0).toISOString();
const bill = (id: string, status: string, extra: Partial<Order> = {}): Order => ({
  id, orderNumber: Number(id.replace(/\D/g, '') || 1), orderType: 'dining', status, paymentMethod: 'cash', items: [], subtotal: 1000, discount: 0, tax: 0,
  serviceCharge: 0, serviceChargePercent: 0, grandTotal: 1000, createdAt: NOW, notes: '', ...extra,
} as Order);

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seed(orders: Order[], role: 'admin' | 'cashier' = 'admin', permissions: string[] = []) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ' },
    users: [{ id: 'u1', name: role === 'admin' ? 'Owner' : 'Sana', username: 'u', password: 'x', role, isActive: true, permissions }],
    orders, categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 50,
  }));
  localStorage.setItem('pos-user-id', 'u1'); localStorage.setItem('pos-user-role', role); localStorage.setItem('pos-user-name', role === 'admin' ? 'Owner' : 'Sana');
  reload();
}
async function mountPage() {
  const { default: DayClosePage } = await import('@/pages/DayClosePage');
  window.location.hash = '#/day-close';
  return render(<HashRouter><DayClosePage /></HashRouter>);
}

// ------------------------------------------------------------------ the rule
describe('planDayClose', () => {
  // the rule as the Settings page wrote it inline (v1.2.4), kept here as the reference
  const reference = (o: { status: string; paymentMethod?: string }, c: Record<string, boolean>) => {
    const s = o.status;
    const isCredit = s === 'credit_pending' || s === 'credit_received' || (o.paymentMethod === 'credit' && s !== 'void' && s !== 'cancelled');
    const isPaid = !isCredit && s === 'paid';
    const isRunHold = !isCredit && (s === 'running' || s === 'hold' || s === 'partial');
    const isVoidComp = s === 'void' || s === 'complimentary' || s === 'cancelled';
    return (isPaid && c.clearPaidOrders) || (isRunHold && c.clearRunningHoldBills) || (!isCredit && isVoidComp && c.clearVoidComp) || (isCredit && c.clearCreditOrders);
  };

  it('clears exactly what the old inline rule cleared, for every status, payment method and set of boxes', () => {
    const statuses = ['paid', 'running', 'hold', 'partial', 'void', 'complimentary', 'cancelled', 'credit_pending', 'credit_received', 'pending_approval', 'weird'];
    const methods = [undefined, 'cash', 'card', 'credit'];
    let checked = 0;
    for (let mask = 0; mask < 16; mask++) {
      const cfg = { clearPaidOrders: !!(mask & 1), clearRunningHoldBills: !!(mask & 2), clearVoidComp: !!(mask & 4), clearCreditOrders: !!(mask & 8) };
      const orders = statuses.flatMap(s => methods.map(m => ({ id: `${s}-${m}`, status: s, paymentMethod: m })));
      const plan = planDayClose(orders, cfg);
      for (const o of orders) { expect(plan.toClear.includes(o.id), `${o.id} mask ${mask}`).toBe(!!reference(o, cfg)); checked++; }
      expect(plan.toClear.length + plan.kept).toBe(plan.total);
      expect(plan.cleared.paid + plan.cleared.runningHold + plan.cleared.voidComp + plan.cleared.credit).toBe(plan.toClear.length);
    }
    expect(checked).toBe(16 * 11 * 4);
  });

  it('counts the groups, says how many cleared bills are still unpaid, and how many of those are on HOLD', () => {
    const plan = planDayClose([
      { id: 'a', status: 'paid' }, { id: 'b', status: 'paid' }, { id: 'c', status: 'running' }, { id: 'd', status: 'hold' }, { id: 'e', status: 'partial' },
      { id: 'f', status: 'void' }, { id: 'g', status: 'credit_pending' }, { id: 'h', status: 'paid', paymentMethod: 'credit' },
    ], { clearPaidOrders: true, clearRunningHoldBills: true, clearVoidComp: false, clearCreditOrders: false });
    expect(plan.cleared).toEqual({ paid: 2, runningHold: 3, voidComp: 0, credit: 0 });
    expect(plan.unpaidCleared).toBe(3);
    expect(plan.heldCleared).toBe(1);
    expect(plan.kept).toBe(3);                                         // the void and the two credit bills stay
    expect(dayCloseGroupOf({ status: 'paid', paymentMethod: 'credit' })).toBe('credit');
    expect(dayCloseGroupOf({ status: 'weird' })).toBe('other');
    expect(planDayClose([], { clearPaidOrders: true, clearRunningHoldBills: true, clearVoidComp: true, clearCreditOrders: true })).toMatchObject({ total: 0, kept: 0, toClear: [] });
  });
});

// ------------------------------------------------------------------ the page
describe('the Day Close page', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); calls.length = 0;
    for (const m of [archiveOrdersBulk, resetOrderCounter, clearCollectionsForDayClose, countUnsyncedOrders, logDayCloseEvent, toastError, toastSuccess]) m.mockClear();
    countUnsyncedOrders.mockImplementation(async () => 0);
    archiveOrdersBulk.mockImplementation(async (ids: string[]) => { calls.push('archive'); return { archived: ids.length, failed: 0, offline: false }; });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); cleanup(); });

  const orders = () => [bill('p1', 'paid'), bill('p2', 'paid'), bill('r1', 'running'), bill('h1', 'hold'), bill('v1', 'void'), bill('c1', 'credit_pending')];

  it('shows the live counts and warns about open bills before anything else', async () => {
    seed(orders());
    await mountPage();
    expect(screen.getByRole('heading', { name: 'Day Close' })).toBeInTheDocument();
    const tiles = document.body.textContent || '';
    expect(tiles).toMatch(/Open bills\s*2/);
    expect(tiles).toMatch(/On HOLD — UNPAID\s*1/);
    expect(tiles).toMatch(/Bills in the live list\s*6/);
    expect(screen.getByRole('status')).toHaveTextContent(/2 bills are still open \(1 on HOLD — UNPAID\)/);
    for (const step of [/Step 1 · Shift report/, /Step 2 · What Day Close clears/, /Step 3 · Close the day/]) expect(screen.getByText(step)).toBeInTheDocument();
  });

  it('what the admin ticks is saved at once and is what the confirmation reports', async () => {
    seed(orders());
    await mountPage();
    // the defaults: paid + running/hold are cleared, void and credit are not
    fireEvent.click(screen.getByRole('button', { name: 'Close the day (Admin)' }));
    const plan = await screen.findByTestId('day-close-plan');
    expect(plan).toHaveTextContent(/Paid bills: 2/);
    expect(plan).toHaveTextContent(/Running and HOLD — UNPAID bills: 2/);
    expect(plan).toHaveTextContent(/Void \/ complimentary \/ cancelled: 0/);
    expect(plan).toHaveTextContent(/Credit orders: 0/);
    expect(plan).toHaveTextContent(/Staying in the live lists: 2/);
    expect(screen.getByText(/2 unpaid bills \(1 on HOLD — UNPAID\) will be removed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // untick the unpaid group and tick credit: the page remembers it, and the confirmation follows
    fireEvent.click(screen.getByText('Running and HOLD — UNPAID bills'));
    fireEvent.click(screen.getByText('Credit / Udhaar orders'));
    const saved = getDayCloseConfig();
    expect(saved).toMatchObject({ clearRunningHoldBills: false, clearCreditOrders: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close the day (Admin)' }));
    const plan2 = await screen.findByTestId('day-close-plan');
    expect(plan2).toHaveTextContent(/Running and HOLD — UNPAID bills: 0/);
    expect(plan2).toHaveTextContent(/Credit orders: 1/);
    expect(screen.queryByText(/unpaid bills? .* will be removed/)).toBeNull();
  });

  it('a close that cannot reach the server does nothing: the button is blocked and nothing is called', async () => {
    seed(orders());
    countUnsyncedOrders.mockImplementation(async () => 3);
    await mountPage();
    fireEvent.click(screen.getByRole('button', { name: 'Close the day (Admin)' }));
    const pre = await screen.findByTestId('day-close-preflight');
    await waitFor(() => expect(within(pre).getByRole('alert')).toHaveTextContent(/3 bill\(s\) have not reached the server/));
    const confirm = screen.getByRole('button', { name: 'Confirm Day Close' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(archiveOrdersBulk).not.toHaveBeenCalled();
    expect(resetOrderCounter).not.toHaveBeenCalled();
    expect(clearCollectionsForDayClose).not.toHaveBeenCalled();
  });

  it('a close that is allowed archives exactly the bills in the plan, then resets the counter and the modules, then writes the audit entry', async () => {
    seed(orders());
    localStorage.setItem(`dt-pos-dayclose-config::${localStorage.getItem('pos-tenant-id') || 'null'}`, JSON.stringify({ modules: { transactions: true, stockLogs: true }, autoBackup: false }));
    await mountPage();
    fireEvent.click(screen.getByRole('button', { name: 'Close the day (Admin)' }));
    await screen.findByTestId('day-close-preflight');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Day Close' })).not.toBeDisabled());
    expect(screen.getByText(/2 module\(s\) are reset to 00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Day Close' }));
    await waitFor(() => expect(logDayCloseEvent).toHaveBeenCalledTimes(1));

    expect(archiveOrdersBulk).toHaveBeenCalledTimes(1);
    expect([...archiveOrdersBulk.mock.calls[0][0]].sort()).toEqual(['h1', 'p1', 'p2', 'r1']);     // not the void, not the credit bill
    expect(resetOrderCounter).toHaveBeenCalledWith(0);
    expect(clearCollectionsForDayClose).toHaveBeenCalledWith(['transactions', 'stockLogs']);
    expect(calls).toEqual(['archive', 'counter', 'modules', 'audit']);
    const audit = logDayCloseEvent.mock.calls[0][0] as unknown as { cleared: Record<string, number>; closedByName: string };
    expect(audit.cleared).toEqual({ paid: 2, runningHold: 2, voidComp: 0, credit: 0 });
    expect(audit.closedByName).toBe('Owner');
    // what it tells the operator is what the server confirmed
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/Day closed\. 4 bills moved to history \(nothing deleted\)\. · 6 module records reset to 0/));
  });

  it('no internet stops the close before anything on the till changes', async () => {
    seed(orders());
    archiveOrdersBulk.mockImplementation(async () => ({ archived: 0, failed: 0, offline: true }));
    await mountPage();
    fireEvent.click(screen.getByRole('button', { name: 'Close the day (Admin)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm Day Close' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Day Close' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/No internet — Day Close stopped\. Nothing was changed/)));
    expect(resetOrderCounter).not.toHaveBeenCalled();
    expect(clearCollectionsForDayClose).not.toHaveBeenCalled();
    expect(logDayCloseEvent).not.toHaveBeenCalled();
  });

  it('a cashier with the permission can only ask: no choices, no close button, a request instead', async () => {
    seed(orders(), 'cashier', ['day-close']);
    await mountPage();
    expect(screen.queryByText(/Step 2 · What Day Close clears/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close the day (Admin)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Request Day Close/ }));
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/request sent/i));
    expect(screen.getByText('Cashier requests').nextElementSibling).toHaveTextContent('1');
    expect(archiveOrdersBulk).not.toHaveBeenCalled();
  });

  it('someone without the permission is told so', async () => {
    seed(orders(), 'cashier', []);
    await mountPage();
    expect(screen.getByText(/You do not have Day Close access/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request Day Close/ })).toBeNull();
  });
});

// ------------------------------------------------------------------ the wiring
describe('the wiring', () => {
  it('has its own route and permission path, and Settings points to it instead of holding a second copy', () => {
    expect(read('src/App.tsx')).toMatch(/<Route path="\/day-close" element=\{<DayClosePage \/>\} \/>/);
    expect(read('src/lib/permissions.ts')).toMatch(/key: 'day-close',\s+path: '\/day-close'/);
    const settings = read('src/pages/SettingsPage.tsx');
    expect(settings).not.toContain('handleDayClose');
    expect(settings).not.toContain('archiveOrdersBulk');
    expect(settings).not.toContain('clearCollectionsForDayClose');
    expect(settings).toContain("window.location.hash = '#/day-close'");
  });

  it('the page keeps the cloud\'s safety rules', () => {
    const page = read('src/pages/DayClosePage.tsx');
    expect(page).toContain('countUnsyncedOrders()');
    expect(page).toContain('archiveOrdersBulk(toClear)');
    expect(page).not.toMatch(/deleteOrder|deleteOrdersBulk/);          // archive, never delete
    expect(page).toContain("releasedTable(t, undefined, 'free')");
    expect(page).toContain('resetOrderCounter(0)');
    expect(page).toContain('logDayCloseEvent');
    // the order of the steps: sync check, backup, archive the snapshot, archive the bills, tables, counter, modules, audit
    const order = ['countUnsyncedOrders()', 'exportData()', 'archiveOrders(all)', 'archiveOrdersBulk(toClear)', 'releasedTable(', 'resetOrderCounter(0)', 'clearCollectionsForDayClose(', 'logDayCloseEvent('];
    const at = order.map(s => page.indexOf(s, page.indexOf('const handleDayClose')));
    expect(at.every(i => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the default config is unchanged', () => {
    const cfg: DayCloseConfig = getDayCloseConfig();
    expect(cfg).toMatchObject({ clearPaidOrders: true, clearRunningHoldBills: true, clearVoidComp: false, clearCreditOrders: false, resetTables: true, resetOrderNumber: true, autoBackup: true });
  });
});
