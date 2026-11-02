// ============================================================
// v1.90.0 — Owner app operations on the phone: online approvals (OWN-08), kitchen (OWN-09), delivery and riders
// (OWN-10), staff (OWN-16), customers and credit (OWN-17), profile and workspace (OWN-22).
//
// What is pinned:
//   • the rules (lib/ownerOps.ts): approvals oldest first; an approval from the phone leaves the kitchen ticket to a
//     till (no ticket claimed on the phone, kotFromTill set, recent only); kitchen counters and late; delivery
//     counters, stuck deliveries, riders live or offline; credit owed per customer; customers; staff; on duty;
//   • the till end: NewOrderNotifier prints a phone approval's ticket once, through the auto-KOT rule, and never a
//     till's own approval;
//   • the screens through the real store: approve and reject from the phone; More opens the phone screens.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { HashRouter, Route, Routes } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Attendance, CreditPayment, CustomerProfile, Employee, Order, Rider } from '@/lib/types';
import {
  TILL_KOT_WINDOW_MS, approveFromPhone, creditRows, customerRows, deliveryBoard, kitchenBoard, needsTillKot, onDutyToday, pendingApprovals,
  staffList,
} from '@/lib/ownerOps';

const access = vi.hoisted(() => ({ ids: null as string[] | null, all: true }));
vi.mock('@/lib/branchAccess', () => ({
  loadBranchAccess: () => Promise.resolve(),
  authorizedBranchIds: () => access.ids,
  hasAllBranchAccess: () => access.all,
  isBranchAllowed: (id?: string | null) => !id || access.all || access.ids === null || access.ids.includes(id),
  filterAllowedBranches: <T,>(l: T[]) => l,
  resetBranchAccess: () => {},
}));
vi.mock('@/lib/restaurantIdentity', () => ({ resolveRestaurantIdentity: async () => ({ workspaceCode: 'DT-4821' }) }));
const kot = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/lib/printQueue', async (orig) => ({
  ...(await orig<typeof import('@/lib/printQueue')>()),
  enqueueKot: (o: Order) => { kot.calls.push(o.id); return { id: `job-${o.id}` }; },
}));
// The till's watcher re-reads the cloud before it looks; there is no cloud here.
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: async () => {} }));
vi.mock('@/components/LeafletMap', () => ({ default: ({ markers }: { markers: unknown[] }) => <div data-testid="map" data-pins={markers.length} /> }));
vi.mock('@/components/WorkspaceCodeCard', () => ({ default: () => <div data-testid="workspace-code" /> }));
vi.mock('@/components/PlanStatusWidget', () => ({ default: () => <div data-testid="plan-status" /> }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const NOW = new Date(2026, 10, 4, 15, 30, 0);
const T = NOW.getTime();
const ago = (m: number) => new Date(T - m * 60000).toISOString();
const line = (name: string, qty: number, price = 500) => ({ id: name + qty, menuItemId: name, name, price, quantity: qty, lineTotal: price * qty, note: '', pricingType: 'fixed' });
const order = (o: Partial<Order>): Order => ({
  id: 'o', orderNumber: 1, orderType: 'dining', status: 'running', paymentMethod: 'cash', items: [line('Zinger', 2)] as any, subtotal: 1000,
  discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 1000, createdAt: ago(5), notes: '', ...o,
} as Order);

// ------------------------------------------------------------------ rules
describe('approvals from the phone', () => {
  it('oldest waiting first', () => {
    const list = pendingApprovals([order({ id: 'a', status: 'pending_approval', createdAt: ago(2) }), order({ id: 'b', status: 'pending_approval', createdAt: ago(9) }), order({ id: 'c' })]);
    expect(list.map(o => o.id)).toEqual(['b', 'a']);
  });

  it('approving claims no kitchen ticket on the phone: the till prints it, once, and only a recent one', () => {
    const o = order({ id: 'w', status: 'pending_approval', source: 'website', editLogs: [] });
    const next = approveFromPhone(o, { userId: 'u1', userName: 'Ayesha' }, NOW);
    expect(next).toMatchObject({ status: 'running', approvalRequired: false, approvedBy: 'u1', approvedByName: 'Ayesha', approvedAt: NOW.toISOString(), kotFromTill: true });
    expect(next.kotPrinted).toBeFalsy();
    expect(next.items[0].printedQty).toBeUndefined();
    expect(next.editLogs?.at(-1)).toMatchObject({ newValue: 'running' });
    expect(needsTillKot(next, T)).toBe(true);
    expect(needsTillKot({ ...next, kotPrinted: true }, T)).toBe(false);
    expect(needsTillKot({ ...next, status: 'paid' }, T)).toBe(false);
    expect(needsTillKot(next, T + TILL_KOT_WINDOW_MS + 60_000)).toBe(false);
    // a till's own approval (it printed there) is never the phone's to print
    expect(needsTillKot(order({ approvedAt: ago(1) }), T)).toBe(false);
  });
});

describe('kitchen and delivery', () => {
  it('the kitchen screen\'s tickets, oldest first, late past the warning time', () => {
    const b = kitchenBoard([
      order({ id: 'n', createdAt: ago(3) }),
      order({ id: 'c', kitchenStatus: 'preparing', createdAt: ago(14), tableName: 'T-05' }),
      order({ id: 'r', kitchenStatus: 'ready', createdAt: ago(30) }),
      order({ id: 'paid', status: 'paid' }),
      order({ id: 'served', kitchenStatus: 'served' }),
      order({ id: 'out', orderType: 'delivery', deliveryStatus: 'onway' }),
    ], { kitchenWarningMinutes: 12 }, T);
    expect(b.tickets.map(t => t.id)).toEqual(['r', 'c', 'n']);
    expect(b.counts).toEqual({ new: 1, cooking: 1, ready: 1, late: 1 });
    expect(b.tickets.find(t => t.id === 'c')).toMatchObject({ late: true, label: 'Table T-05', items: 2, age: 14 });
    expect(b.tickets.find(t => t.id === 'r')!.late).toBe(false);   // ready is never late
    expect(kitchenBoard([], null, T).lateAfter).toBe(10);
  });

  it('deliveries: counts, what is stuck, riders live or offline, who is waiting for a rider', () => {
    const riders: Rider[] = [
      { id: 'r1', name: 'Hamza', phone: '0300', isActive: true, lastSeenAt: ago(1) },
      { id: 'r2', name: 'Bilal', phone: '0301', isActive: true, lastSeenAt: ago(20) },
      { id: 'r3', name: 'Gone', phone: '', isActive: false },
    ];
    const b = deliveryBoard([
      order({ id: 'ready-free', orderType: 'delivery', deliveryStatus: 'ready', createdAt: ago(25) }),
      order({ id: 'cooking', orderType: 'delivery', deliveryStatus: 'cooking', createdAt: ago(5) }),
      order({ id: 'old', orderType: 'delivery', deliveryStatus: 'pending', createdAt: ago(70) }),
      order({ id: 'out', orderType: 'delivery', deliveryStatus: 'onway', riderId: 'r2', dispatchedAt: ago(50), riderPingedAt: ago(2), createdAt: ago(80) }),
      order({ id: 'mine', orderType: 'delivery', deliveryStatus: 'rider_assigned', riderId: 'r1', createdAt: ago(10) }),
      order({ id: 'done', orderType: 'delivery', deliveryStatus: 'delivered', deliveredAt: ago(30), status: 'paid' }),
      order({ id: 'held', orderType: 'delivery', status: 'pending_approval' }),
      order({ id: 'dine', orderType: 'dining' }),
    ], riders, T);
    expect(b.counts).toEqual({ waiting: 4, onway: 1, delivered: 1 });
    expect(b.stuck.map(s => [s.order.id, s.why])).toEqual([['ready-free', 'Ready, no rider yet'], ['old', 'Waiting 1 h 10 min'], ['out', 'Out for 50 min']]);
    expect(b.unassigned.map(o => o.id)).toEqual(['old', 'ready-free', 'cooking']);
    // found in the browser check: a delivery bill paid at the counter without the rider stages is finished, and
    // yesterday's leftovers are history — neither waits forever
    const quiet = deliveryBoard([
      order({ id: 'counter', orderType: 'delivery', status: 'paid', createdAt: ago(30) }),
      order({ id: 'prepaid', orderType: 'delivery', status: 'paid', deliveryStatus: 'ready', createdAt: ago(30) }),
      order({ id: 'yesterday', orderType: 'delivery', deliveryStatus: 'pending', createdAt: ago(60 * 26) }),
      order({ id: 'slow', orderType: 'delivery', deliveryStatus: 'pending', createdAt: ago(125) }),
    ], [], T);
    expect(quiet.counts.waiting).toBe(2);   // the prepaid one still has to go out, and the slow one
    expect(quiet.stuck.map(x => x.why)).toEqual(['Ready, no rider yet', 'Waiting 2 h 5 min']);
    // Bilal's app was last seen 20 min ago, but his delivery pinged 2 min ago: Live
    expect(b.riders.map(r => [r.name, r.live, r.current.map(o => o.id)])).toEqual([['Bilal', true, ['out']], ['Hamza', true, ['mine']]]);
  });
});

describe('customers, credit, staff', () => {
  it('credit owed per customer, after what was received; settled, void and other bills left out', () => {
    const c = (id: string, extra: Partial<Order>) => order({ id, paymentMethod: 'credit', status: 'credit_pending', ...extra });
    const rows = creditRows([
      c('a1', { grandTotal: 3000, customer: { id: 'x', name: 'Usman', phone: '0300-1112233' } as any, createdAt: ago(60 * 24 * 3) }),
      c('a2', { grandTotal: 1000, amountPaid: 400, customer: { id: 'x', name: 'Usman', phone: '+92 300 1112233' } as any }),
      c('b1', { grandTotal: 500, customer: { id: 'y', name: 'Hina', phone: '0345' } as any }),
      c('void', { status: 'void', grandTotal: 9000 }),
      c('settled', { status: 'credit_received', grandTotal: 9000 }),
      order({ id: 'cash', grandTotal: 9000 }),
    ], [{ id: 'p', orderId: 'a1', amount: 1000, method: 'cash', date: ago(60) } as CreditPayment]);
    expect(rows.map(r => [r.name, r.owed, r.bills])).toEqual([['Usman', 2600, 2], ['Hina', 500, 1]]);
    // a bill with no customer on it is its own row, never merged under a vague "Customer"
    const loose = creditRows([c('n1', { grandTotal: 700 }), c('n2', { grandTotal: 300, customer: { id: 'z', name: 'Zain' } as any })]);
    expect(loose.map(r => [r.name, r.owed])).toEqual([['No customer on the bill', 700], ['Zain', 300]]);
    expect(rows[0].oldest).toBe(ago(60 * 24 * 3));
  });

  it('customers by spend, searched by name or phone', () => {
    const list = [
      { id: '1', name: 'Ayesha', phone: '0300-1112233', totalSpent: 5000, totalOrders: 4 },
      { id: '2', name: 'Bilal', phone: '0321-5556677', totalSpent: 9000, totalOrders: 2 },
    ] as CustomerProfile[];
    expect(customerRows(list).map(c => c.id)).toEqual(['2', '1']);
    expect(customerRows(list, 'aye').map(c => c.id)).toEqual(['1']);
    expect(customerRows(list, '5556').map(c => c.id)).toEqual(['2']);
  });

  it('staff active first; on duty from today\'s HR attendance', () => {
    const s = staffList([
      { id: 'a', name: 'Zara', role: 'cashier', active: false }, { id: 'b', name: 'Ali', role: 'cashier', active: true }, { id: 'c', name: 'Moin', role: 'rider', active: true },
    ], 'cashier');
    expect(s.map(x => x.name)).toEqual(['Ali', 'Zara']);
    const emp = [{ id: 'e1', name: 'Ali' }, { id: 'e2', name: 'Moin' }, { id: 'e3', name: 'Zara' }] as Employee[];
    const att = [
      { id: '1', employeeId: 'e1', date: '2026-11-04', status: 'present', inTime: '09:00' },
      { id: '2', employeeId: 'e2', date: '2026-11-04', status: 'present', inTime: '09:00', outTime: '13:00' },
      { id: '3', employeeId: 'e3', date: '2026-11-03', status: 'present' },
    ] as Attendance[];
    expect(onDutyToday(emp, att, '2026-11-04').map(e => e.name)).toEqual(['Ali']);
  });
});

// ------------------------------------------------------------------ the store, the till and the screens
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seed(orders: Order[], settings: object = {}) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', ...settings },
    users: [{ id: 'u-admin', name: 'Ayesha Khan', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    branches: [], categories: [], menuItems: [], orders, tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], customers: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'u-admin');
  localStorage.setItem('pos-user-role', 'admin');
  localStorage.setItem('pos-tenant-plan', 'enterprise');
  reload();
}
const held = (id: string, n: number, mins: number) => order({ id, orderNumber: n, status: 'pending_approval', source: 'website', orderType: 'delivery', createdAt: ago(mins),
  customer: { id: 'c', name: 'Sara Khan', phone: '0321-5556677', address: 'Block 7, Gulshan' } as any, editLogs: [] });

describe('the till prints a phone approval\'s ticket', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); kot.calls = []; vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
  afterEach(() => { vi.useRealTimers(); });

  async function till() {
    const { default: NewOrderNotifier } = await import('@/components/NewOrderNotifier');
    render(<HashRouter><NewOrderNotifier /></HashRouter>);
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });   // the first look marks what is already there
  }
  // The phone's change reaches a till through the realtime feed, which raises the store's data-change event.
  const save = async (o: Order) => {
    const { saveOrder } = await import('@/lib/store');
    await act(async () => {
      saveOrder(o);
      window.dispatchEvent(new CustomEvent('dt-pos-data-change', { detail: { collection: 'orders', collections: ['orders'] } }));
      await new Promise(r => setTimeout(r, 30));
    });
  };

  it('once, through the auto-KOT rule; a till\'s own approval is left alone', async () => {
    seed([held('w1', 1101, 4), order({ id: 'own', orderNumber: 1102, source: 'website', approvedAt: ago(1), kotPrinted: true })]);
    await till();
    expect(kot.calls).toEqual([]);
    const { getOrders } = await import('@/lib/store');
    await save(approveFromPhone(getOrders().find(o => o.id === 'w1')!, { userName: 'Ayesha' }, NOW));
    await waitFor(() => expect(kot.calls).toEqual(['w1']));
    await save({ ...getOrders().find(o => o.id === 'w1')!, notes: 'touch' });   // another change to the same order
    expect(kot.calls).toEqual(['w1']);
  });

  it('a restaurant that sends to the kitchen by hand: no automatic ticket', async () => {
    seed([held('w2', 1201, 4)], { manualSendToKitchen: true });
    await till();
    const { getOrders } = await import('@/lib/store');
    await save(approveFromPhone(getOrders().find(o => o.id === 'w2')!, { userName: 'Ayesha' }, NOW));
    await act(async () => { await new Promise(r => setTimeout(r, 60)); });
    expect(kot.calls).toEqual([]);
  });
});

async function mount(at: string) {
  const { default: OwnerAppPage } = await import('@/pages/OwnerAppPage');
  window.location.hash = '#' + at;
  return render(<TooltipProvider><HashRouter><Routes><Route path="/owner-app/*" element={<OwnerAppPage onLogout={() => {}} />} /></Routes></HashRouter></TooltipProvider>);
}

describe('the Owner app screens', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); kot.calls = []; access.ids = null; access.all = true; vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
  afterEach(() => { vi.useRealTimers(); });

  it('approve from the phone: running, waiting for a till to print, nothing queued on the phone', async () => {
    seed([held('w1', 1101, 9), held('w2', 1102, 3)]);
    await mount('/owner-app/approvals');
    const list = await screen.findByTestId('owner-approvals');
    const cards = within(list).getAllByTestId(/own-approval-/);
    expect(cards.map(c => c.dataset.testid)).toEqual(['own-approval-w1', 'own-approval-w2']);
    expect(cards[0]).toHaveTextContent('Delivery Portal · Delivery');
    expect(cards[0]).toHaveTextContent('Block 7, Gulshan');
    expect(within(cards[0]).getByRole('link', { name: /Call Sara Khan/ })).toHaveAttribute('href', 'tel:03215556677');
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Approve' }));
    const { getOrders } = await import('@/lib/store');
    expect(getOrders().find(o => o.id === 'w1')).toMatchObject({ status: 'running', kotFromTill: true, approvedByName: 'Ayesha Khan' });
    expect(getOrders().find(o => o.id === 'w1')!.kotPrinted).toBeFalsy();
    expect(kot.calls).toEqual([]);
    await waitFor(() => expect(screen.queryByTestId('own-approval-w1')).toBeNull());
  });

  it('reject with a reason, kept on the order', async () => {
    seed([held('w1', 1101, 9)]);
    await mount('/owner-app/approvals');
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const sheet = screen.getByRole('dialog', { name: 'Reject #1101' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Out Of Delivery Area' }));
    fireEvent.change(within(sheet).getByPlaceholderText('Note (optional)'), { target: { value: 'Raiwind' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reject order' }));
    const { getOrders } = await import('@/lib/store');
    expect(getOrders().find(o => o.id === 'w1')).toMatchObject({ status: 'rejected', rejectedReason: 'Out Of Delivery Area — Raiwind' });
    await waitFor(() => expect(screen.getByText('No orders are waiting for approval.')).toBeInTheDocument());
  });

  it('More opens the phone screens, not the till\'s pages', async () => {
    seed([held('w1', 1101, 9), order({ id: 'k', kitchenStatus: 'preparing', createdAt: ago(15) })]);
    await mount('/owner-app/more');
    const more = await screen.findByTestId('owner-more');
    expect(within(more).getByTestId('own-more-approvals')).toHaveTextContent('1');
    fireEvent.click(within(more).getByTestId('own-more-kitchen'));
    expect(await screen.findByTestId('owner-kitchen')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/owner-app/kitchen');
    expect(screen.getByTestId('own-kitchen-counts')).toHaveTextContent(/Cooking\s*1.*Late\s*1/);
    for (const [id, screenId] of [['own-more-delivery', 'owner-delivery'], ['own-more-customers', 'owner-customers'], ['own-more-staff', 'owner-staff'], ['own-more-profile', 'owner-profile']] as const) {
      window.location.hash = '#/owner-app/more';
      fireEvent.click(await screen.findByTestId(id));
      expect(await screen.findByTestId(screenId)).toBeInTheDocument();
      expect(window.location.hash.startsWith('#/owner-app/')).toBe(true);
    }
    expect(screen.getByTestId('workspace-code')).toBeInTheDocument();
    expect(screen.getByTestId('own-tab-more')).toHaveAttribute('aria-current', 'page');
  });

  it('customers and credit on the phone', async () => {
    seed([order({ id: 'cr', paymentMethod: 'credit', status: 'credit_pending', grandTotal: 2500, customer: { id: 'x', name: 'Usman Ali', phone: '0300-1112233' } as any })]);
    await mount('/owner-app/customers');
    fireEvent.click(await screen.findByRole('tab', { name: /Credit/ }));
    expect(screen.getByTestId('own-credit-total')).toHaveTextContent('2,500');
    expect(within(screen.getByTestId('own-credit-list')).getByText('Usman Ali')).toBeInTheDocument();
  });
});
