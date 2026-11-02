// ============================================================
// v1.91.0 — Owner app: Profit (OWN-12), Website and app switches (OWN-20), Devices (OWN-21), the empty / offline /
// denied states (OWN-23) and the dark theme (OWN-24).
//
// What is pinned:
//   • profit says "costs incomplete" and shows no flattering profit when recipes are missing (none → no figure,
//     some → "at most"), and agrees with the till's Financial Statements because it reads the same engine;
//   • the switches write the same settings as the Customer Portal page, a switch under the master one is locked when
//     the master is off, and the links are the till's links;
//   • device actions write what the Devices page writes — and an update the database's rules filtered out (no rows,
//     no error) is reported as refused, not as done; the phone in hand cannot block itself;
//   • screens through the real store: profit, switches, devices; a screen the role may not open says so; offline
//     banner; dark theme kept on the phone.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter, Route, Routes } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ProfitAndLoss } from '@/lib/financials';
import type { DeviceRow } from '@/lib/branchHub';
import {
  SWITCHES, approvalMode, canActOn, devicePatch, groupDevices, portalLinks, profitView, switchDisabled, switchOn,
} from '@/lib/ownerAdmin';

const access = vi.hoisted(() => ({ ids: null as string[] | null, all: true, loadsAs: null as boolean | null }));
vi.mock('@/lib/branchAccess', () => ({
  loadBranchAccess: () => Promise.resolve().then(() => { if (access.loadsAs !== null) access.all = access.loadsAs; }),
  authorizedBranchIds: () => access.ids,
  hasAllBranchAccess: () => access.all,
  isBranchAllowed: (id?: string | null) => !id || access.all || access.ids === null || access.ids.includes(id),
  filterAllowedBranches: <T extends { id: string }>(l: T[]) => (access.all || !access.ids ? l : l.filter(b => access.ids!.includes(b.id))),
  resetBranchAccess: () => {},
}));
vi.mock('@/lib/restaurantIdentity', () => ({ resolveRestaurantIdentity: async () => ({ workspaceCode: 'DT-4821' }) }));
const cloud = vi.hoisted(() => ({ devices: [] as DeviceRow[], ok: true, writes: [] as { id: string; action: string }[], answer: 'ok' as 'ok' | 'none' | 'error' }));
vi.mock('@/lib/branchCloud', () => ({
  loadDevices: async () => (cloud.ok ? { ok: true, rows: cloud.devices, at: Date.now() } : { ok: false, error: 'Could not load from the cloud' }),
  loadStaff: async () => ({ ok: true, rows: [], at: Date.now() }),
  clearBranchCloudCache: () => {},
}));
vi.mock('@/lib/ownerCloud', () => ({
  actOnDevice: async (id: string, action: string) => {
    cloud.writes.push({ id, action });
    if (cloud.answer === 'none') return { ok: false, error: 'Not allowed: only the owner or an admin can change devices.' };
    if (cloud.answer === 'error') return { ok: false, error: 'You are offline — this needs a connection.' };
    cloud.devices = cloud.devices.map(d => d.id !== id ? d : action === 'approve' ? { ...d, approved: true } : action === 'block' ? { ...d, blocked: true, approved: false } : action === 'unblock' ? { ...d, blocked: false } : d).filter(d => !(d.id === id && action === 'reject'));
    return { ok: true };
  },
}));
vi.mock('@/components/WorkspaceCodeCard', () => ({ default: () => <div /> }));
vi.mock('@/components/PlanStatusWidget', () => ({ default: () => <div /> }));
vi.mock('@/lib/tenant', async (orig) => ({ ...(await orig<typeof import('@/lib/tenant')>()), getDeviceId: () => 'phone-1' }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const NOW = new Date(2026, 10, 4, 15, 30, 0);
const T = NOW.getTime();
const ago = (m: number) => new Date(T - m * 60000).toISOString();

// ------------------------------------------------------------------ rules
const pnl = (o: Partial<ProfitAndLoss>): ProfitAndLoss => ({
  period: { fromMs: 0, toMs: 1 }, branchId: null, billCount: 10, grossItemSales: 100000, discounts: 0, netItemSales: 100000, serviceCharge: 0,
  deliveryCharges: 0, rounding: 0, unreconciled: 0, netRevenue: 100000, salesTaxCollected: 0, foodCost: 35000, foodCostCoverage: 1, linesWithoutRecipe: 0,
  wastage: 2000, grossProfit: 63000, grossMarginPct: 63, otherIncome: [], expenses: [{ label: 'Rent', amount: 20000 }, { label: 'Gas', amount: 5000 }], payroll: 15000,
  payrollMonths: 1, totalExpenses: 40000, netProfit: 23000, netMarginPct: 23, notes: [], ...o,
} as ProfitAndLoss);

describe('profit, and when not to show one', () => {
  it('every sold line has a recipe: the profit as it is, the margin, the biggest expenses', () => {
    const v = profitView(pnl({}));
    expect(v).toMatchObject({ state: 'complete', revenue: 100000, costOfGoods: 37000, expenses: 40000, profit: 23000, margin: 23, coverage: 100 });
    expect(v.bars.map(b => b.key)).toEqual(['revenue', 'cost', 'expenses', 'profit']);
    expect(v.topExpenses).toEqual([{ label: 'Rent', amount: 20000, share: 80 }, { label: 'Gas', amount: 5000, share: 20 }]);
  });

  it('some items without a recipe: "at most", with how much is covered', () => {
    const v = profitView(pnl({ foodCostCoverage: 0.6, linesWithoutRecipe: 14 }));
    expect(v).toMatchObject({ state: 'partial', coverage: 60, linesWithoutRecipe: 14, profit: 23000 });
  });

  it('sales but no recipe at all: no profit is shown, because the whole cost of food is missing', () => {
    const v = profitView(pnl({ foodCost: 0, foodCostCoverage: 0, linesWithoutRecipe: 30, netProfit: 58000 }));
    expect(v).toMatchObject({ state: 'unknown', profit: null, margin: null });
    expect(v.bars.map(b => b.key)).toEqual(['revenue', 'cost', 'expenses']);
  });

  it('nothing happened in the period', () => {
    expect(profitView(pnl({ billCount: 0, netRevenue: 0, expenses: [], payroll: 0, wastage: 0, foodCost: 0, netProfit: 0 })).state).toBe('empty');
  });

  it('a loss is a negative profit, shown as it is', () => {
    expect(profitView(pnl({ netProfit: -4000 })).profit).toBe(-4000);
  });
});

describe('switches, links and devices', () => {
  it('a missing setting is on; a switch under the master one locks when the master is off', () => {
    expect(SWITCHES.map(s => s.key)).toEqual(['onlineOrderEnabled', 'onlineDeliveryEnabled', 'onlinePickupEnabled', 'allowGuestCheckout']);
    expect(switchOn({}, 'onlineDeliveryEnabled')).toBe(true);
    expect(switchOn({ onlineDeliveryEnabled: false }, 'onlineDeliveryEnabled')).toBe(false);
    const [master, delivery] = SWITCHES;
    expect(switchDisabled({ onlineOrderEnabled: false }, delivery)).toBe(true);
    expect(switchDisabled({ onlineOrderEnabled: false }, master)).toBe(false);
    expect(switchDisabled({}, delivery)).toBe(false);
    expect(approvalMode({})).toBe('auto');
    expect(approvalMode({ onlineOrderApprovalMode: 'manual' })).toBe('manual');
  });

  it('the links are the Customer Portal page\'s links', () => {
    const l = portalLinks('https://digitaltarget.digital', 'abc-123');
    expect(l.map(x => x.url)).toEqual([
      'https://digitaltarget.digital/#/order/abc-123', 'https://digitaltarget.digital/#/order/abc-123?mode=takeaway', 'https://digitaltarget.digital/#/order/abc-123?mode=delivery',
      'https://digitaltarget.digital/#/order/abc-123?table=Table%201', 'https://digitaltarget.digital/#/track/abc-123',
    ]);
    expect(portalLinks('https://x', null)[0].url).toBe('https://x/#/order');
  });

  it('devices: waiting first, approved online first, blocked last; what each action writes', () => {
    const rows: DeviceRow[] = [
      { id: 'a', label: 'Till 1', platform: 'windows', approved: true, lastSeenAt: ago(1) },
      { id: 'b', label: 'Old till', platform: 'windows', approved: true, lastSeenAt: ago(60 * 30) },
      { id: 'c', label: 'New phone', platform: 'android', approved: false, lastSeenAt: ago(3) },
      { id: 'd', label: 'Stolen', platform: 'android', approved: false, blocked: true, lastSeenAt: ago(5000) },
    ];
    const g = groupDevices(rows, T);
    expect(g.pending.map(d => d.id)).toEqual(['c']);
    expect(g.approved.map(d => [d.id, d.online])).toEqual([['a', true], ['b', false]]);
    expect(g.blocked.map(d => d.id)).toEqual(['d']);
    expect(devicePatch('approve', NOW)).toEqual({ approved: true, approved_at: NOW.toISOString(), blocked: false });
    expect(devicePatch('block', NOW)).toEqual({ blocked: true, blocked_at: NOW.toISOString(), approved: false });   // loses sync rights at once
    expect(devicePatch('unblock', NOW)).toEqual({ blocked: false, blocked_at: null });
    expect(devicePatch('reject')).toBeNull();
    // the phone in hand cannot be blocked or rejected from itself
    expect(canActOn({ id: 'phone-1' }, 'phone-1', 'block')).toBe(false);
    expect(canActOn({ id: 'phone-1' }, 'phone-1', 'approve')).toBe(true);
    expect(canActOn({ id: 'x' }, 'phone-1', 'block')).toBe(true);
  });
});

// ------------------------------------------------------------------ the screens
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const line = (id: string, name: string, price: number, qty: number) => ({ id, menuItemId: id, name, price, quantity: qty, lineTotal: price * qty, note: '', pricingType: 'fixed' });
function seed(opts: { role?: 'admin' | 'manager'; recipes?: boolean; settings?: object } = {}) {
  const sale = (id: string, n: number) => ({ id, orderNumber: n, orderType: 'dining', status: 'paid', paymentMethod: 'cash', items: [line('z', 'Zinger', 650, 4)], subtotal: 2600, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 2600, amountPaid: 2600, createdAt: ago(90), paidAt: ago(90), notes: '' });
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', ...(opts.settings || {}) },
    users: [{ id: 'u-admin', name: 'Ayesha Khan', username: 'admin', password: 'x', role: 'admin', isActive: true }, { id: 'u-man', name: 'Bilal', username: 'bilal', password: 'x', role: 'manager', isActive: true }],
    branches: [{ id: 'A', name: 'Main', isActive: true, sortOrder: 1 }, { id: 'B', name: 'Johar Town', isActive: true, sortOrder: 2 }],
    orders: [sale('s1', 1), sale('s2', 2)],
    inventory: [{ id: 'i1', name: 'Chicken', quantity: 20, unit: 'kg', baseUnit: 'kg', lowStockThreshold: 5, isActive: true, costPrice: 400, avgCostPrice: 400 }],
    recipes: opts.recipes ? [{ id: 'r1', menuItemId: 'z', components: [{ inventoryItemId: 'i1', quantity: 0.25, unit: 'kg' }] }] : [],
    transactions: [{ id: 't1', type: 'expense', date: '2026-11-04', amount: 1500, categoryId: 'u', categoryName: 'Utilities', description: 'Gas', paymentMethod: 'cash' }],
    accountCategories: [{ id: 'u', name: 'Utilities', type: 'expense' }],
    categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], wastages: [], payslips: [], orderCounter: 10,
  }));
  localStorage.setItem('pos-user-id', opts.role === 'manager' ? 'u-man' : 'u-admin');
  localStorage.setItem('pos-user-role', opts.role || 'admin');
  localStorage.setItem('pos-tenant-plan', 'enterprise');
  reload();
}
async function mount(at: string) {
  const { default: OwnerAppPage } = await import('@/pages/OwnerAppPage');
  window.location.hash = '#' + at;
  return render(<TooltipProvider><HashRouter><Routes><Route path="/owner-app/*" element={<OwnerAppPage onLogout={() => {}} />} /></Routes></HashRouter></TooltipProvider>);
}
const setOnline = (on: boolean) => { Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => on }); window.dispatchEvent(new Event(on ? 'online' : 'offline')); };

describe('the Owner app admin screens', () => {
  beforeEach(() => {
    cleanup(); localStorage.clear(); access.ids = null; access.all = true; access.loadsAs = null; cloud.ok = true; cloud.writes = []; cloud.answer = 'ok'; setOnline(true);
    cloud.devices = [
      { id: 'phone-1', label: 'Owner phone', platform: 'android', approved: true, lastSeenAt: ago(1) },
      { id: 'till-1', label: 'Front till', platform: 'windows', approved: true, lastSeenAt: ago(2) },
      { id: 'new-1', label: 'Hina phone', platform: 'android', approved: false, lastSeenAt: ago(4) },
    ];
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('profit with no recipes shows no profit and says why; with recipes it shows the figure', async () => {
    seed({ recipes: false });
    await mount('/owner-app/profit');
    expect(await screen.findByTestId('own-profit-incomplete')).toHaveTextContent(/None of the items sold has a recipe/);
    expect(screen.getByTestId('own-profit-value')).toHaveTextContent('—');
    cleanup();
    seed({ recipes: true });
    await mount('/owner-app/profit');
    await screen.findByTestId('own-profit-tiles');
    expect(screen.queryByTestId('own-profit-incomplete')).toBeNull();
    // 2 bills × 4 Zingers; cost 0.25 kg × 4 × 400 = 400 per bill; revenue 5,200; expenses 1,500 (Utilities)
    expect(screen.getByTestId('own-profit-tiles')).toHaveTextContent('5,200');
    expect(screen.getByTestId('own-profit-value')).toHaveTextContent('2,900');
    expect(within(screen.getByTestId('own-profit-expenses')).getByText('Utilities')).toBeInTheDocument();
  });

  it('an owner whose branch access loads a moment after the screen opens still sees the whole business', async () => {
    // found in the browser check: the first render saw "not an all-branch user" and picked the first branch, which
    // dropped every cost that carries no branch (Expenses showed Rs 0)
    access.all = false; access.ids = null; access.loadsAs = true;   // not loaded yet: no restriction is known
    seed({ recipes: true });
    await mount('/owner-app/profit');
    await screen.findByTestId('own-profit-tiles');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'All branches' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByTestId('own-profit-value')).toHaveTextContent('2,900');
    expect(screen.getByTestId('own-profit-tiles')).toHaveTextContent('1,500');
  });

  it('a period with nothing says so', async () => {
    seed({ recipes: true });
    await mount('/owner-app/profit');
    await screen.findByTestId('own-profit-tiles');
    fireEvent.click(screen.getByRole('tab', { name: 'Yesterday' }));
    expect(await screen.findByText('No data for this period.')).toBeInTheDocument();
  });

  it('a manager limited to one branch never sees the whole-business profit', async () => {
    access.all = false; access.ids = ['B'];
    seed({ role: 'manager', recipes: true });
    localStorage.setItem('pos-tenant-plan', 'enterprise');
    // a manager has no Financial Statements permission by default, so the screen explains instead of redirecting
    await mount('/owner-app/profit');
    expect(await screen.findByTestId('own-denied')).toHaveTextContent('Profit is not available to your account');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Overview' }));
    expect(window.location.hash).toBe('#/owner-app');
  });

  it('switches write the same settings; the delivery switch locks when online ordering is off', async () => {
    seed({ settings: {} });
    await mount('/owner-app/switches');
    const list = await screen.findByTestId('own-switch-list');
    const delivery = within(list).getByRole('switch', { name: 'Home delivery' });
    expect(delivery).toBeEnabled(); expect(delivery).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(delivery);
    const { getSettings } = await import('@/lib/store');
    expect(getSettings().onlineDeliveryEnabled).toBe(false);
    fireEvent.click(within(list).getByRole('switch', { name: 'Online ordering' }));
    expect(getSettings().onlineOrderEnabled).toBe(false);
    expect(within(list).getByRole('switch', { name: 'Pickup' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Held for approval' }));
    expect(getSettings().onlineOrderApprovalMode).toBe('manual');
    expect(within(screen.getByTestId('own-links')).getAllByText(/#\/order/).length).toBeGreaterThanOrEqual(3);
    // opening hours and banners are reserved, marked coming — the software has no storage for them yet
    for (const n of ['Opening hours', 'Banners and offers']) expect(screen.getByText(n).parentElement).toHaveTextContent('Coming');
  });

  it('devices: approve a request, block with a confirmation, the phone in hand cannot block itself', async () => {
    seed();
    await mount('/owner-app/devices');
    const pending = await screen.findByTestId('own-devices-pending');
    fireEvent.click(within(pending).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(cloud.writes).toEqual([{ id: 'new-1', action: 'approve' }]));
    await waitFor(() => expect(screen.queryByTestId('own-devices-pending')).toBeNull());

    const approved = screen.getByTestId('own-devices-approved');
    expect(within(screen.getByTestId('own-device-phone-1')).getByRole('button', { name: 'Block' })).toBeDisabled();
    fireEvent.click(within(screen.getByTestId('own-device-till-1')).getByRole('button', { name: 'Block' }));
    const sheet = screen.getByRole('dialog', { name: /Block Front till/ });
    expect(cloud.writes).toHaveLength(1);                 // nothing written before the owner confirms
    fireEvent.click(within(sheet).getByRole('button', { name: 'Block device' }));
    await waitFor(() => expect(cloud.writes.at(-1)).toEqual({ id: 'till-1', action: 'block' }));
    await waitFor(() => expect(screen.getByTestId('own-devices-blocked')).toBeInTheDocument());
    expect(approved).toBeTruthy();
  });

  it('a refused device write is said on the screen and nothing changes', async () => {
    cloud.answer = 'none';
    seed();
    await mount('/owner-app/devices');
    fireEvent.click(within(await screen.findByTestId('own-devices-pending')).getByRole('button', { name: /Approve/ }));
    expect(await screen.findByText('Not allowed: only the owner or an admin can change devices.')).toBeInTheDocument();
    expect(screen.getByTestId('own-devices-pending')).toBeInTheDocument();
  });

  it('devices that cannot be loaded: a Retry banner, then the list', async () => {
    cloud.ok = false;
    seed();
    await mount('/owner-app/devices');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load from the cloud');
    cloud.ok = true;
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('own-devices-approved')).toBeInTheDocument();
  });

  it('offline: a banner at the top; online again: gone', async () => {
    seed();
    await mount('/owner-app');
    await screen.findByTestId('owner-app');
    expect(screen.queryByTestId('own-offline')).toBeNull();
    act(() => setOnline(false));
    expect(await screen.findByTestId('own-offline')).toHaveTextContent(/last data this phone loaded/);
    act(() => setOnline(true));
    await waitFor(() => expect(screen.queryByTestId('own-offline')).toBeNull());
  });

  it('dark theme from the profile screen, kept on the phone', async () => {
    seed();
    await mount('/owner-app/profile');
    expect(await screen.findByTestId('owner-app')).toHaveAttribute('data-theme', 'light');
    fireEvent.click(screen.getByRole('switch', { name: 'Dark theme' }));
    expect(screen.getByTestId('owner-app')).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('owner-theme')).toBe('dark');
    cleanup();
    await mount('/owner-app');
    expect(await screen.findByTestId('owner-app')).toHaveAttribute('data-theme', 'dark');
  });

  it('More opens the new screens', async () => {
    seed();
    await mount('/owner-app/more');
    const more = await screen.findByTestId('owner-more');
    for (const [id, screenId] of [['own-more-profit', 'owner-profit'], ['own-more-switches', 'owner-switches'], ['own-more-devices', 'owner-devices']] as const) {
      window.location.hash = '#/owner-app/more';
      fireEvent.click(await within(await screen.findByTestId('owner-more')).findByTestId(id));
      expect(await screen.findByTestId(screenId)).toBeInTheDocument();
    }
    expect(more).toBeTruthy();
  });
});

describe('the wiring', () => {
  it('the dark palette is a set of tokens; no light-only colour is left in the owner screens', () => {
    const css = read('src/styles/ui-owner.css');
    expect(css).toContain('.dt-owner[data-theme="dark"]');
    expect(css).toContain('--own-ok-bg');
    for (const f of ['ownerUi.tsx', 'OwnerMore.tsx', 'OwnerOverview.tsx', 'OwnerReports.tsx', 'OwnerOps.tsx', 'OwnerAdmin.tsx']) {
      const src = read(`src/components/owner/${f}`);
      expect(src, f).not.toMatch(/bg-amber-|border-amber-|bg-red-|border-red-|bg-\[hsl\(\d/);
    }
  });
});

// Last on purpose: it resets the module registry to load the real ownerCloud, which would split the router the screens above share.
describe('the device write', () => {
  it('an update the database filtered out (no rows, no error) is refused, not reported as done', async () => {
    vi.resetModules();
    vi.doUnmock('@/lib/ownerCloud');
    const calls: string[] = [];
    let rowsBack: { id: string }[] = [];
    vi.doMock('@/lib/supabase', () => ({
      isSupabaseConfigured: () => true,
      sb: () => ({ from: () => ({
        update: (p: Record<string, unknown>) => ({ eq: () => ({ select: async () => { calls.push('update ' + Object.keys(p).join(',')); return { data: rowsBack, error: null }; } }) }),
        delete: () => ({ eq: () => ({ select: async () => { calls.push('delete'); return { data: rowsBack, error: null }; } }) }),
      }) }),
    }));
    try {
      const { actOnDevice } = await import('@/lib/ownerCloud');
      expect(await actOnDevice('d1', 'approve')).toEqual({ ok: false, error: 'Not allowed: only the owner or an admin can change devices.' });
      rowsBack = [{ id: 'd1' }];
      expect(await actOnDevice('d1', 'approve')).toEqual({ ok: true });
      expect(await actOnDevice('d1', 'reject')).toEqual({ ok: true });
      expect(calls).toEqual(['update approved,approved_at,blocked', 'update approved,approved_at,blocked', 'delete']);
    } finally {
      vi.doUnmock('@/lib/supabase');
      vi.doMock('@/lib/ownerCloud', () => ({
        actOnDevice: async (id: string, action: string) => {
          cloud.writes.push({ id, action });
          if (cloud.answer === 'none') return { ok: false, error: 'Not allowed: only the owner or an admin can change devices.' };
          if (cloud.answer === 'error') return { ok: false, error: 'You are offline — this needs a connection.' };
          cloud.devices = cloud.devices.map(d => d.id !== id ? d : action === 'approve' ? { ...d, approved: true } : action === 'block' ? { ...d, blocked: true, approved: false } : action === 'unblock' ? { ...d, blocked: false } : d).filter(d => !(d.id === id && action === 'reject'));
          return { ok: true };
        },
      }));
    }
  });
});
