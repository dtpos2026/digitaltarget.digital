// ============================================================
// v1.93.0 — Customer Display and the Kitchen Display Center, brought over from the offline POS (v1.21.0).
//
// The offline tests for the shared pieces (templates, announcements, the live bill's allow-list) are ported beside this
// file. What is pinned HERE is what is specific to this app:
//   • the display window runs outside the till's shell (no KOT printer, beeps or timers of a second till);
//   • the customer display shows the bill the POS publishes — only with the setting on, and only the allow-listed fields;
//   • the kitchen TV board follows the Kitchen Display settings (lanes, credit line) and stays branch-scoped;
//   • the Center is on the Kitchen Display page behind the TV Mode button.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import type { Order } from '@/lib/types';
import { displayWindowHash } from '@/lib/appEntry';
import { LIVE_BILL_KEY, publishLiveBill, toLiveBill, __resetLiveBillForTests } from '@/lib/liveBill';

vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: async () => {} }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const NOW = new Date(2026, 10, 4, 15, 30, 0);
const ago = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();
const line = (id: string, name: string, qty: number, price = 500) => ({ id, menuItemId: id, name, price, quantity: qty, lineTotal: price * qty, note: '', pricingType: 'fixed' });
const order = (o: Partial<Order>): Order => ({
  id: 'o', orderNumber: 1, orderType: 'takeaway', status: 'running', paymentMethod: 'cash', items: [line('a', 'Zinger', 2)] as any, subtotal: 1000,
  discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 1000, createdAt: ago(5), notes: '', cashierId: 'a1', ...o,
} as Order);

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seed(orders: Order[], settings: object = {}) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', ...settings },
    users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
    orders, categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 100,
  }));
  localStorage.setItem('pos-user-id', 'a1');
  localStorage.setItem('pos-user-role', 'admin');
  localStorage.setItem('pos-user-name', 'Owner');
  reload();
}

// ------------------------------------------------------------------ the window
describe('the display window', () => {
  it('is recognised by its route, and nothing else is mistaken for it', () => {
    for (const h of ['#/customer-display', '/customer-display', '#/customer-display?x=1', '#/customer-display/']) expect(displayWindowHash(h), h).toBe(true);
    for (const h of ['', '#/', '#/kitchen', '#/kds-tv', '#/customer-displays', '#/customers', '#/owner-app']) expect(displayWindowHash(h), h).toBe(false);
  });

  it('runs outside the till shell: no AppLayout and none of its workers', () => {
    const app = read('src/App.tsx');
    const branch = app.slice(app.indexOf('if (displayWindowHash('), app.indexOf('<CloudPrintHost />'));
    expect(branch).toContain('<CustomerDisplayPage />');
    for (const worker of ['AppLayout', 'AutoKotPrinter', 'NewOrderNotifier', 'CloudPrintHost']) expect(branch, worker).not.toContain(worker);
    // and it is not ALSO a route inside the shell, where it would get the sidebar and the workers
    const shell = app.slice(app.indexOf('<AppLayout userRole'));
    expect(shell).not.toContain('path="/customer-display"');
  });

  it('the till publishes the bill only with the display setting on, never for an order taker, and clears it when off or closed', () => {
    const pos = read('src/pages/POSScreen.tsx');
    expect(pos).toMatch(/const liveBillOn = !!settings\.displayEnabled && !isOrderTaker;/);
    expect(pos).toMatch(/useEffect\(\(\) => \(\) => publishLiveBill\(null\), \[\]\)/);
    expect(pos).toMatch(/if \(!liveBillOn\) publishLiveBill\(null\)/);
    // what it sends is built by toLiveBill from the cart's totals, not the order
    expect(pos).toMatch(/publishLiveBill\(toLiveBill\(\{/);
  });
});

// ------------------------------------------------------------------ the customer display page
describe('the customer display', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); __resetLiveBillForTests(); vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  async function mount() {
    const { default: CustomerDisplayPage } = await import('@/pages/CustomerDisplayPage');
    window.location.hash = '#/customer-display';
    return render(<HashRouter><CustomerDisplayPage /></HashRouter>);
  }

  it('shows the shop, what is being prepared and what is ready — and no money or customer details', async () => {
    seed([
      order({ id: 'p', orderNumber: 1041, kitchenStatus: 'preparing', items: [line('z', 'Zinger Burger', 2)] as any, customer: { id: 'c', name: 'Sara Khan', phone: '0300-1234567', address: 'House 5' } as any }),
      order({ id: 'r', orderNumber: 1043, kitchenStatus: 'ready', items: [line('f', 'Loaded Fries', 1)] as any }),
      order({ id: 'x', orderNumber: 1050, status: 'void' }),
    ]);
    await mount();
    const page = document.body.textContent || '';
    expect(page).toContain('Sample Restaurant');
    expect(page).toMatch(/#1041/);
    expect(page).toMatch(/#1043/);
    expect(page).not.toMatch(/#1050/);                                  // a void is not an order anyone waits for
    expect(page).toMatch(/READY/i);
    for (const secret of ['Sara Khan', '0300', 'House 5', '1,000']) expect(page, secret).not.toContain(secret);
  });

  it('shows the live bill only when the display setting is on', async () => {
    seed([], { displayEnabled: false });
    publishLiveBill(toLiveBill({ orderType: 'takeaway', lines: [{ name: 'Cola', quantity: 3, price: 120, lineTotal: 360 }] as any, subtotal: 360, discount: 0, discountLabel: '', serviceCharge: 0, serviceChargeLabel: '', tax: 0, delivery: 0, total: 360, received: 0 } as any));
    expect(localStorage.getItem(LIVE_BILL_KEY)).not.toBeNull();
    const first = await mount();
    expect(screen.queryByTestId('live-bill-total')).toBeNull();
    first.unmount();

    seed([], { displayEnabled: true });
    await mount();
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: LIVE_BILL_KEY })); });
    expect(await screen.findByTestId('live-bill-total')).toHaveTextContent(/360/);
    expect(screen.getByTestId('live-bill-lines')).toHaveTextContent(/3 ×\s*Cola/);
  });

  it('drops anything outside the allow-list when it reads a bill from storage', async () => {
    seed([], { displayEnabled: true });
    const bill = toLiveBill({ orderType: 'takeaway', lines: [{ name: 'Cola', quantity: 1, price: 120, lineTotal: 120 }] as any, subtotal: 120, discount: 0, discountLabel: '', serviceCharge: 0, serviceChargeLabel: '', tax: 0, delivery: 0, total: 120, received: 0 } as any)!;
    // a tampered or older build wrote more than it should have
    localStorage.setItem(LIVE_BILL_KEY, JSON.stringify({ ...bill, at: Date.now(), cashierName: 'Ali', customer: { phone: '0300-999' }, lines: [{ name: 'Cola', qty: 1, amount: 120, note: 'no onion', phone: '0300' }] }));
    await mount();
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: LIVE_BILL_KEY })); });
    const page = document.body.textContent || '';
    expect(page).toContain('Cola');
    for (const secret of ['Ali', '0300', 'no onion']) expect(page, secret).not.toContain(secret);
  });
});

// ------------------------------------------------------------------ the kitchen boards
describe('the kitchen TV board', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  async function mountTv() {
    const { default: KdsTvPage } = await import('@/pages/KdsTvPage');
    window.location.hash = '#/kds-tv';
    return render(<HashRouter><KdsTvPage /></HashRouter>);
  }

  it('puts each order in the lane of its stage, with the shop\'s own name on it', async () => {
    seed([
      order({ id: 'n', orderNumber: 2001, kitchenStatus: 'pending', createdAt: ago(2) }),
      order({ id: 'p', orderNumber: 2002, kitchenStatus: 'preparing', createdAt: ago(8) }),
      order({ id: 'r', orderNumber: 2003, kitchenStatus: 'ready', createdAt: ago(12) }),
    ]);
    await mountTv();
    const text = document.body.textContent || '';
    for (const lane of ['NEW', 'PREPARING', 'READY', 'DELIVERY', 'COMPLETED']) expect(text, lane).toContain(lane);
    for (const n of ['#2001', '#2002', '#2003']) expect(text, n).toContain(n);
    expect(text).toContain('Sample Restaurant');
  });

  it('follows the credit-line setting from the Kitchen Display Center', async () => {
    seed([order({ id: 'n', orderNumber: 2001 })]);
    const first = await mountTv();
    expect(document.body.textContent).toContain('Powered by Digital Target');
    first.unmount();
    localStorage.setItem('dtpos-kitchen-display-v1', JSON.stringify({ showDeveloperCredit: false }));
    await mountTv();
    expect(document.body.textContent).not.toContain('Powered by Digital Target');
  });

  it('is still scoped to the branch, and its poll is still behind the egress flag', () => {
    const src = read('src/pages/KdsTvPage.tsx');
    expect(src).toContain("import { scopeToBranch } from '@/lib/cashierScope'");
    expect(src).toMatch(/const scoped = scopeToBranch\(getOrders\(\)\)/);
    expect(src).toMatch(/ENABLE_REDUNDANT_ORDER_POLL \? setInterval\(refresh, 10000\) : null/);
    // the recently-finished strip comes from the same scoped list — another branch's cancellations must not appear
    expect(src).toMatch(/const finished = scoped\b/);
    expect(src).not.toMatch(/=\s*getOrders\(\)\s*\.filter/);
  });
});

describe('the Kitchen Display page', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); });
  afterEach(() => cleanup());

  it('opens the Center from the TV Mode button, and not before', async () => {
    seed([order({ id: 'n', orderNumber: 2001, kitchenStatus: 'pending' })]);
    const { default: KitchenDisplayPage } = await import('@/pages/KitchenDisplayPage');
    window.location.hash = '#/kitchen';
    render(<HashRouter><KitchenDisplayPage /></HashRouter>);
    expect(screen.queryByText('Choose a design')).toBeNull();
    fireEvent.click(screen.getByTitle(/Choose which screen the kitchen watches/));
    expect(screen.getAllByText('Choose a design').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Customer Display/i).length).toBeGreaterThan(0);
  });
});
