// ============================================================
// v1.87.0 — branch management, A to Z, for the owner (desktop page + Owner app) and stock transfers between branches.
//
// What is pinned:
//   • live status, stock, staff, targets and transfer rules (lib/branchHub.ts), and ranking branches;
//   • transfers through the real store: stock leaves the sender on send, arrives at the receiver on receipt (matched by
//     SKU/name or created there, moving-average cost carried, shortfall recorded), goes back on cancel — and never
//     moves twice (status guard + one ledger movement id per line and step);
//   • the desktop page and the Owner app: cards, tabs, targets saved, a transfer sent and received from the screen,
//     a branch-limited manager seeing only their branch;
//   • the wiring: page key (multi-branch only, Business plan), route, the two new synced document collections.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter, Route, Routes } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { InventoryItem, Order, StockTransfer } from '@/lib/types';
import {
  branchStock, carriedCost, isOnline, liveStatus, matchItem, nextTransferNumber, parseReceived, parseTarget, staffOf, targetProgress,
  transferTotals, transfersFor, validateTransfer, type DeviceRow, type StaffRow,
} from '@/lib/branchHub';
import { rankBranches, type BranchFigures } from '@/lib/ownerApp';
import { PAGES, MULTI_BRANCH_ONLY_PAGES } from '@/lib/permissions';
import { PLANS } from '@/lib/plans';

const access = vi.hoisted(() => ({ ids: null as string[] | null, all: true }));
vi.mock('@/lib/branchAccess', () => ({
  loadBranchAccess: () => Promise.resolve(),
  authorizedBranchIds: () => access.ids,
  hasAllBranchAccess: () => access.all,
  isBranchAllowed: (id?: string | null) => !id || access.all || access.ids === null || access.ids.includes(id),
  filterAllowedBranches: <T,>(l: T[]) => l,
  resetBranchAccess: () => {},
}));
const cloud = vi.hoisted(() => ({
  devices: [] as DeviceRow[],
  staff: [] as StaffRow[],
}));
vi.mock('@/lib/branchCloud', () => ({
  loadDevices: async () => ({ ok: true, rows: cloud.devices, at: Date.now() }),
  loadStaff: async () => ({ ok: true, rows: cloud.staff, at: Date.now() }),
  clearBranchCloudCache: () => {},
}));
vi.mock('@/lib/restaurantIdentity', () => ({ resolveRestaurantIdentity: async () => ({ workspaceCode: 'DT-4821' }) }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const NOW = new Date(2026, 10, 3, 15, 30, 0);
const T = NOW.getTime();
const iso = (minsAgo: number) => new Date(T - minsAgo * 60000).toISOString();
const item = (o: Partial<InventoryItem>): InventoryItem => ({ id: 'x', name: 'Chicken', sku: '', categoryId: 'c', costPrice: 900, salePrice: 0, quantity: 20, unit: 'kg', baseUnit: 'kg', lowStockThreshold: 5, isActive: true, branchId: 'A', ...o } as InventoryItem);

// ------------------------------------------------------------------ rules
describe('live status, stock, staff, targets', () => {
  const devices: DeviceRow[] = [
    { id: 'd1', label: 'Till 1', branchId: 'A', lastSeenAt: iso(2), approved: true },
    { id: 'd2', label: 'Till 2', branchId: 'A', lastSeenAt: iso(40), approved: true },
    { id: 'd3', label: 'Old', branchId: 'A', lastSeenAt: iso(1), approved: true, blocked: true },
    { id: 'd4', label: 'New', branchId: 'A', lastSeenAt: iso(1), approved: false },
    { id: 'd5', label: 'B till', branchId: 'B', lastSeenAt: iso(300), approved: true },
  ];
  it('a till is online when seen in the last 5 minutes; blocked and unapproved tills do not count', () => {
    expect(isOnline(devices[0], T)).toBe(true);
    expect(isOnline(devices[1], T)).toBe(false);
    expect(isOnline(devices[2], T)).toBe(false);
    const a = liveStatus([], devices, 'A', T);
    expect([a.devicesOnline, a.devicesTotal, a.live]).toEqual([1, 2, true]);
  });
  it('a branch with no till online is live if it billed in the last 30 minutes; a bill stamped in the future is ignored', () => {
    const orders = [{ branchId: 'B', createdAt: iso(20) }, { branchId: 'B', createdAt: iso(-90) }] as Order[];
    const b = liveStatus(orders, devices, 'B', T);
    expect(b.live).toBe(true);
    expect(b.lastBillAt).toBe(iso(20));
    expect(liveStatus([{ branchId: 'B', createdAt: iso(45) } as Order], devices, 'B', T).live).toBe(false);
  });
  it('branch stock: items, value at moving-average cost, low items; other branches and inactive items left out', () => {
    const inv = [item({ id: 'a1', quantity: 4, lowStockThreshold: 10, avgCostPrice: 1000 }), item({ id: 'a2', name: 'Oil', quantity: 10, costPrice: 500, lowStockThreshold: 2 }),
      item({ id: 'a3', isActive: false }), item({ id: 'b1', branchId: 'B' })];
    expect(branchStock(inv, 'A')).toEqual({ items: 2, value: 4 * 1000 + 10 * 500, low: 1 });
  });
  it('staff: assigned to the branch (active first), and those who work across all branches', () => {
    const staff: StaffRow[] = [
      { id: '1', name: 'Zara', role: 'cashier', branchId: 'A', active: false }, { id: '2', name: 'Ali', role: 'cashier', branchId: 'A', active: true },
      { id: '3', name: 'Owner', role: 'admin', branchId: null, active: true }, { id: '4', name: 'Bilal', role: 'waiter', branchId: 'B', active: true },
    ];
    const s = staffOf(staff, 'A');
    expect(s.assigned.map(x => x.name)).toEqual(['Ali', 'Zara']);
    expect(s.everywhere.map(x => x.name)).toEqual(['Owner']);
  });
  it('targets: today against the daily target; the month against where it should be by today', () => {
    expect(targetProgress(45000, 60000, 'daily', NOW)).toEqual({ target: 60000, actual: 45000, pct: 75, expected: 60000, onTrack: false });
    const m = targetProgress(200000, 1500000, 'monthly', NOW)!; // 3 of 30 days → 150,000 expected
    expect([m.expected, m.onTrack, m.pct]).toEqual([150000, true, 13]);
    expect(targetProgress(100, undefined, 'daily', NOW)).toBeNull();
    expect(parseTarget('60,000')).toBe(60000);
    expect(parseTarget('')).toBeUndefined();
    expect(parseTarget('abc')).toBeNull();
    expect(parseTarget('0')).toBeNull();
  });
  it('branches ranked by a measure: best first, lowest first where less is better, bills without a branch left out', () => {
    const r = (id: string, revenue: number, owed: number): BranchFigures => ({ id, name: id, unassigned: id === '__unassigned__', revenue, bills: 1, owed, openNow: 0, voided: 0, avgBill: revenue, share: 0 });
    const rows = [r('A', 500, 30), r('B', 900, 10), r('__unassigned__', 2000, 0)];
    expect(rankBranches(rows, 'revenue').map(x => x.id)).toEqual(['B', 'A']);
    expect(rankBranches(rows, 'owed').map(x => x.id)).toEqual(['B', 'A']);
  });
});

describe('transfer rules', () => {
  const inv = [item({ id: 'a-ch', quantity: 20 }), item({ id: 'a-oil', name: 'Cooking oil', unit: 'L', baseUnit: 'l', quantity: 8 }),
    item({ id: 'b-ch', branchId: 'B', quantity: 2 }), item({ id: 'b-sku', branchId: 'B', name: 'Mozzarella block', sku: 'MOZ-1', quantity: 1 })];
  it('says what stops a transfer, in words', () => {
    expect(validateTransfer({ fromBranchId: 'A', toBranchId: 'A', lines: [{ itemId: 'a-ch', qty: 1 }] }, inv)).toContain('A branch cannot send stock to itself');
    expect(validateTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [] }, inv)).toEqual(['Add at least one item']);
    expect(validateTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'b-ch', qty: 1 }] }, inv)).toEqual(['An item is not in the sending branch’s stock']);
    expect(validateTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 0 }] }, inv)).toEqual(['Chicken: enter how much to send']);
    expect(validateTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 25 }] }, inv)).toEqual(['Chicken: only 20 kg in stock']);
    expect(validateTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 1 }, { itemId: 'a-ch', qty: 2 }] }, inv)).toEqual(['Chicken is listed twice']);
    expect(validateTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 20 }, { itemId: 'a-oil', qty: 2.5 }] }, inv)).toEqual([]);
  });
  it('the receiving branch\'s item: the same SKU, else the same name in the same unit, never another branch\'s', () => {
    expect(matchItem({ itemName: 'Mozzarella', sku: 'MOZ-1', unit: 'kg' }, inv, 'B')!.id).toBe('b-sku');
    expect(matchItem({ itemName: ' chicken ', unit: 'kg' }, inv, 'B')!.id).toBe('b-ch');
    expect(matchItem({ itemName: 'Chicken', unit: 'pcs' }, inv, 'B')).toBeUndefined();
    expect(matchItem({ itemName: 'Cooking oil', unit: 'l' }, inv, 'B')).toBeUndefined();
  });
  it('moving-average cost, numbers, totals and order', () => {
    expect(carriedCost(2, 1000, 4, 900)).toBe(933.33);
    expect(carriedCost(0, 0, 5, 900)).toBe(900);
    expect(nextTransferNumber([{ number: 'TR-0009' }, { number: 'TR-0002' }, { number: 'odd' }] as StockTransfer[])).toBe('TR-0010');
    const t = { status: 'received', lines: [{ id: 'l1', qty: 5, unitCost: 900, receivedQty: 4 }, { id: 'l2', qty: 2, unitCost: 500 }] } as StockTransfer;
    expect(transferTotals(t)).toEqual({ lines: 2, sent: 7, received: 6, value: 5500, shortfall: 1 });
    const list = [
      { id: '1', status: 'received', fromBranchId: 'A', toBranchId: 'B', sentAt: iso(10) },
      { id: '2', status: 'in_transit', fromBranchId: 'A', toBranchId: 'C', sentAt: iso(100) },
      { id: '3', status: 'in_transit', fromBranchId: 'C', toBranchId: 'B', sentAt: iso(5) },
    ] as StockTransfer[];
    expect(transfersFor(list).map(x => x.id)).toEqual(['3', '2', '1']);
    expect(transfersFor(list, 'B').map(x => x.id)).toEqual(['3', '1']);
    expect([parseReceived('4', 5), parseReceived('6', 5), parseReceived('-1', 5), parseReceived('2.5', 5)]).toEqual([4, null, null, 2.5]);
  });
});

// ------------------------------------------------------------------ the store
const STORE_KEY = 'desi-pos-data';
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seed(opts: { role?: 'admin' | 'manager'; transfers?: StockTransfer[] } = {}) {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', costTrackingEnabled: true },
    users: [
      { id: 'u-admin', name: 'Ayesha Khan', username: 'admin', password: 'x', role: 'admin', isActive: true },
      { id: 'u-man', name: 'Bilal', username: 'bilal', password: 'x', role: 'manager', isActive: true, branchId: 'A' },
    ],
    branches: [{ id: 'A', name: 'Main Branch', city: 'Lahore', isActive: true, sortOrder: 1, address: '12 Gulberg', lat: 31.5, lng: 74.3 },
      { id: 'B', name: 'Johar Town', city: 'Lahore', isActive: true, sortOrder: 2 }],
    inventory: [item({ id: 'a-ch', quantity: 20, avgCostPrice: 900 }), item({ id: 'a-oil', name: 'Cooking oil', unit: 'L', baseUnit: 'l', quantity: 8, costPrice: 500 }),
      item({ id: 'b-ch', branchId: 'B', quantity: 2, avgCostPrice: 1000, costPrice: 1000 })],
    orders: [
      { id: 'o1', orderNumber: 1, branchId: 'A', orderType: 'dining', status: 'paid', paymentMethod: 'cash', items: [], subtotal: 4500, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 4500, amountPaid: 4500, createdAt: iso(10), paidAt: iso(10), notes: '' },
      { id: 'o2', orderNumber: 2, branchId: 'B', orderType: 'dining', status: 'running', paymentMethod: 'cash', items: [], subtotal: 900, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 900, createdAt: iso(200), notes: '' },
    ],
    stockTransfers: opts.transfers || [], branchTargets: [], stockLogs: [],
    categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], orderCounter: 10,
  }));
  localStorage.setItem('pos-user-id', opts.role === 'manager' ? 'u-man' : 'u-admin');
  localStorage.setItem('pos-user-role', opts.role || 'admin');
  localStorage.setItem('pos-tenant-plan', 'enterprise');
  reload();
}

describe('stock transfers through the real store', () => {
  beforeEach(() => { localStorage.clear(); access.ids = null; access.all = true; seed(); });

  it('send takes the stock out of the sender; receive puts what arrived into the receiver at a carried cost', async () => {
    const { sendTransfer, receiveTransfer } = await import('@/lib/stockTransfers');
    const { getInventory, getStockTransfers, getStockLogs } = await import('@/lib/store');
    const r = sendTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 5 }] }, 'Ayesha');
    expect(r.ok).toBe(true);
    const t = (r as { transfer: StockTransfer }).transfer;
    expect(t).toMatchObject({ number: 'TR-0001', status: 'in_transit', fromBranchId: 'A', toBranchId: 'B', sentBy: 'Ayesha' });
    expect(t.lines[0]).toMatchObject({ itemName: 'Chicken', qty: 5, unitCost: 900, unit: 'kg' });
    expect(getInventory().find(i => i.id === 'a-ch')!.quantity).toBe(15);
    expect(getStockTransfers()).toHaveLength(1);
    expect(getStockLogs().some(l => (l as { movementId?: string }).movementId === `transfer:${t.id}:out:${t.lines[0].id}`)).toBe(true);

    const done = receiveTransfer(t.id, 'Bilal', { [t.lines[0].id]: 4 });
    expect(done.ok).toBe(true);
    const b = getInventory().find(i => i.id === 'b-ch')!;
    expect(b.quantity).toBe(6);
    expect(b.avgCostPrice).toBe(933.33);
    const saved = getStockTransfers().find(x => x.id === t.id)!;
    expect(saved).toMatchObject({ status: 'received', receivedBy: 'Bilal' });
    expect(saved.lines[0]).toMatchObject({ receivedQty: 4, toItemId: 'b-ch' });
    expect(transferTotals(saved).shortfall).toBe(1);
  });

  it('an item the receiving branch does not stock is created there, in its branch, at the transferred cost', async () => {
    const { sendTransfer, receiveTransfer } = await import('@/lib/stockTransfers');
    const { getInventory } = await import('@/lib/store');
    const t = (sendTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-oil', qty: 3 }] }, 'Ayesha') as { transfer: StockTransfer }).transfer;
    receiveTransfer(t.id, 'Bilal');
    const created = getInventory().find(i => i.branchId === 'B' && i.name === 'Cooking oil')!;
    expect(created).toMatchObject({ quantity: 3, avgCostPrice: 500, unit: 'L', baseUnit: 'l', isActive: true });
    expect(getInventory().find(i => i.id === 'a-oil')!.quantity).toBe(5);
  });

  it('never twice: a second receive is refused; a cancelled transfer cannot be received; cancel puts stock back once', async () => {
    const { sendTransfer, receiveTransfer, cancelTransfer } = await import('@/lib/stockTransfers');
    const { getInventory, adjustStock } = await import('@/lib/store');
    const t = (sendTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 5 }] }, 'Ayesha') as { transfer: StockTransfer }).transfer;
    expect(receiveTransfer(t.id, 'Bilal').ok).toBe(true);
    expect(receiveTransfer(t.id, 'Bilal')).toEqual({ ok: false, error: 'Already received' });
    expect(getInventory().find(i => i.id === 'b-ch')!.quantity).toBe(7);
    expect(cancelTransfer(t.id, 'Ayesha')).toEqual({ ok: false, error: 'It has already been received' });
    // the ledger itself refuses a replayed movement id
    const replay = adjustStock('b-ch', 5, 'in', 'replay', { movementId: `transfer:${t.id}:in:${t.lines[0].id}` });
    expect(replay.duplicate).toBe(true);
    expect(getInventory().find(i => i.id === 'b-ch')!.quantity).toBe(7);

    const t2 = (sendTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 3 }] }, 'Ayesha') as { transfer: StockTransfer }).transfer;
    expect(t2.number).toBe('TR-0002');
    expect(getInventory().find(i => i.id === 'a-ch')!.quantity).toBe(12);
    expect(cancelTransfer(t2.id, 'Ayesha', 'wrong branch').ok).toBe(true);
    expect(getInventory().find(i => i.id === 'a-ch')!.quantity).toBe(15);
    expect(cancelTransfer(t2.id, 'Ayesha').ok).toBe(false);
    expect(receiveTransfer(t2.id, 'Bilal')).toEqual({ ok: false, error: 'This transfer was cancelled' });
  });

  it('a draft that is not valid moves nothing', async () => {
    const { sendTransfer } = await import('@/lib/stockTransfers');
    const { getInventory, getStockTransfers } = await import('@/lib/store');
    expect(sendTransfer({ fromBranchId: 'A', toBranchId: 'B', lines: [{ itemId: 'a-ch', qty: 50 }] }, 'Ayesha')).toEqual({ ok: false, error: 'Chicken: only 20 kg in stock' });
    expect(getInventory().find(i => i.id === 'a-ch')!.quantity).toBe(20);
    expect(getStockTransfers()).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ the screens
describe('the desktop Branch Management page', () => {
  afterEach(() => { vi.useRealTimers(); });
  beforeEach(() => {
    cleanup(); localStorage.clear(); access.ids = null; access.all = true;
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    cloud.devices = [{ id: 'd1', label: 'Till 1', branchId: 'A', lastSeenAt: new Date().toISOString(), approved: true }, { id: 'd2', label: 'Till B', branchId: 'B', lastSeenAt: new Date(Date.now() - 3 * 3600_000).toISOString(), approved: true }];
    cloud.staff = [{ id: 's1', name: 'Ali', role: 'cashier', branchId: 'A', active: true }, { id: 's2', name: 'Ayesha Khan', role: 'admin', branchId: null, active: true }];
  });
  const mount = async () => {
    const { default: Page } = await import('@/pages/BranchManagementPage');
    window.location.hash = '#/branch-management';
    return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>);
  };

  it('a card per branch: live or quiet, money taken, open now, stock, tills', async () => {
    seed();
    await mount();
    const a = screen.getByTestId('branch-card-A');
    await waitFor(() => expect(a.textContent).toMatch(/Tills 1\/1 online/));
    expect(a.textContent).toMatch(/Live/);
    expect(a.textContent).toMatch(/4,500/);
    expect(screen.getByTestId('branch-card-B').textContent).toMatch(/Quiet/);
    expect(screen.getByTestId('branch-card-B').textContent).toMatch(/Open now1/);
  });

  it('a branch opens A to Z: stock, staff, tills, info; targets are saved', async () => {
    seed();
    await mount();
    fireEvent.click(screen.getByTestId('branch-card-A'));
    const tabs = within(screen.getByRole('tablist', { name: 'Branch' }));
    fireEvent.click(tabs.getByRole('tab', { name: 'Stock' }));
    expect(screen.getByTestId('branch-stock').textContent).toMatch(/Cooking oil/);
    fireEvent.click(tabs.getByRole('tab', { name: 'Staff' }));
    await waitFor(() => expect(screen.getByTestId('branch-staff').textContent).toMatch(/Ali/));
    expect(screen.getByTestId('branch-staff').textContent).toMatch(/Work across all branches \(1\)/);
    fireEvent.click(tabs.getByRole('tab', { name: 'Tills' }));
    await waitFor(() => expect(screen.getByTestId('branch-tills').textContent).toMatch(/Till 1.*Online/));
    fireEvent.click(tabs.getByRole('tab', { name: 'Info' }));
    expect(screen.getByTestId('branch-info').textContent).toMatch(/12 Gulberg/);
    expect(screen.getByRole('link', { name: /Open on the map/ }).getAttribute('href')).toBe('https://www.google.com/maps?q=31.5,74.3');
    fireEvent.click(tabs.getByRole('tab', { name: 'Targets' }));
    fireEvent.change(screen.getByLabelText('Daily target'), { target: { value: '60,000' } });
    fireEvent.click(screen.getByTestId('save-targets'));
    const { getBranchTargets } = await import('@/lib/store');
    expect(getBranchTargets()).toEqual([expect.objectContaining({ id: 'A', branchId: 'A', daily: 60000, updatedBy: 'Ayesha Khan' })]);
  });

  it('a transfer sent and received from the screen moves the stock', async () => {
    seed();
    await mount();
    const { getInventory } = await import('@/lib/store');
    fireEvent.click(screen.getAllByTestId('new-transfer')[0]);
    const sheet = within(screen.getByTestId('transfer-sheet'));
    fireEvent.click(sheet.getByRole('button', { name: /Chicken/ }));
    fireEvent.change(sheet.getByLabelText('Quantity of Chicken'), { target: { value: '5' } });
    fireEvent.click(sheet.getByTestId('send-transfer'));
    expect(getInventory().find(i => i.id === 'a-ch')!.quantity).toBe(15);
    await waitFor(() => expect(screen.getAllByTestId('transfer-TR-0001').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId('receive-TR-0001')[0]);
    fireEvent.click(within(screen.getByTestId('receive-sheet')).getByTestId('confirm-receive'));
    expect(getInventory().find(i => i.id === 'b-ch')!.quantity).toBe(7);
  });

  it('a manager limited to one branch sees only it, and cannot receive into another branch', async () => {
    access.all = false; access.ids = ['A'];
    seed({ role: 'manager', transfers: [{ id: 'tx', number: 'TR-0005', fromBranchId: 'A', toBranchId: 'B', status: 'in_transit', sentAt: iso(30), lines: [{ id: 'l', fromItemId: 'a-ch', itemName: 'Chicken', unit: 'kg', qty: 2, unitCost: 900 }] }] });
    await mount();
    expect(screen.getByTestId('branch-card-A')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-card-B')).toBeNull();
    fireEvent.click(screen.getByTestId('branch-card-A'));
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Branch' })).getByRole('tab', { name: 'Transfers' }));
    const row = screen.getAllByTestId('transfer-TR-0005')[0];
    expect(within(row).queryByText('Receive')).toBeNull();      // B is not theirs
    expect(within(row).getByText('Cancel')).toBeInTheDocument(); // A is
  });
});

describe('the Owner app: branches A to Z', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); access.ids = null; access.all = true;
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    cloud.devices = [{ id: 'd1', label: 'Till 1', branchId: 'A', lastSeenAt: new Date().toISOString(), approved: true }];
    cloud.staff = [{ id: 's1', name: 'Ali', role: 'cashier', branchId: 'A', active: true }];
  });
  afterEach(() => { vi.useRealTimers(); });
  const mount = async (at: string) => {
    const { default: OwnerAppPage } = await import('@/pages/OwnerAppPage');
    window.location.hash = '#' + at;
    return render(<TooltipProvider><HashRouter><Routes><Route path="/owner-app/*" element={<OwnerAppPage onLogout={() => {}} />} /></Routes></HashRouter></TooltipProvider>);
  };

  it('a branch has tabs: Today, Stock, Staff, Tills, Targets, Transfers', async () => {
    seed();
    await mount('/owner-app/branch/A');
    const tabs = within(screen.getByTestId('own-branch-tabs'));
    expect(tabs.getAllByRole('tab').map(t => t.textContent)).toEqual(['Today', 'Stock', 'Staff', 'Tills', 'Targets', 'Transfers']);
    fireEvent.click(tabs.getByRole('tab', { name: 'Tills' }));
    await waitFor(() => expect(screen.getByTestId('branch-tills').textContent).toMatch(/Online/));
    fireEvent.click(tabs.getByRole('tab', { name: 'Staff' }));
    await waitFor(() => expect(screen.getByTestId('branch-staff').textContent).toMatch(/Ali/));
  });

  it('Compare ranks the branches; More has a Branches section; Transfers lists stock on the road', async () => {
    seed({ transfers: [{ id: 'tx', number: 'TR-0003', fromBranchId: 'A', toBranchId: 'B', status: 'in_transit', sentAt: iso(30), lines: [{ id: 'l', fromItemId: 'a-ch', itemName: 'Chicken', unit: 'kg', qty: 2, unitCost: 900 }] }] });
    const first = await mount('/owner-app/compare');
    const list = within(screen.getByTestId('own-compare-list'));
    expect(list.getAllByRole('button').map(b => b.textContent?.replace(/\s+/g, ' '))).toEqual([expect.stringMatching(/^1Main Branch/), expect.stringMatching(/^2Johar Town/)]);
    first.unmount();
    const more = await mount('/owner-app/more');
    expect(screen.getByTestId('own-more-compare')).toBeInTheDocument();
    expect(screen.getByTestId('own-more-transfers')).toBeInTheDocument();
    more.unmount();
    await mount('/owner-app/transfers');
    expect(screen.getByTestId('transfer-TR-0003').textContent).toMatch(/Main Branch.*Johar Town/);
  });
});

describe('wiring', () => {
  it('Branch Management is a page for multi-branch restaurants on the Business plan and up, with a route', () => {
    expect(PAGES.find(p => p.key === 'branch-management')).toMatchObject({ path: '/branch-management', defaultRoles: ['admin', 'manager'] });
    expect(MULTI_BRANCH_ONLY_PAGES).toContain('branch-management');
    expect(PLANS.business.features).toContain('branch-management');
    expect(PLANS.starter.features).not.toContain('branch-management');
    expect(read('src/App.tsx')).toContain('<Route path="/branch-management" element={<BranchManagementPage />} />');
  });
  it('transfers and targets are synced documents (no new table) and transfers write through at once', async () => {
    const ss = await import('@/lib/supabaseStore');
    expect(ss.isDocStoreCollection('stockTransfers')).toBe(true);
    expect(ss.isDocStoreCollection('branchTargets')).toBe(true);
    expect(read('src/lib/store.ts')).toMatch(/scheduleReload\('purchaseOrders'\);\s*scheduleReload\('stockTransfers'\);\s*scheduleReload\('branchTargets'\);/);
    expect(read('src/lib/deferredSync.ts')).toMatch(/'stockTransfers',\n\]\);/);
  });
  it('stock moves only through the stock ledger with a movement id per line and step', () => {
    const src = read('src/lib/stockTransfers.ts');
    for (const step of ['out', 'in', 'back']) expect(src).toContain(`movementId: \`transfer:\${id}:${step}:\${l.id}\``);
    expect(src).not.toMatch(/\.quantity\s*=(?!=)/); // never sets a quantity by hand
  });
});
