// ============================================================
// v1.139.0 — the Pickup board as the design draws it (SW-09): "Pickup orders · Counter view", three lanes — Preparing · Ready to hand over ·
// Collected today — of cards with the order number large, the customer, "4 items", an age pill and ONE button (Mark ready · Handed over).
// Pinned: the rules in lib/pickupBoard.ts, every button against the saved order, the search, the ⋯ menu (call, WhatsApp, reprint),
// the earlier history, DT Refined shows the board and every other look keeps its tabs, and the stylesheet is scoped.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getOrders } from '@/lib/store';
import { openWhatsApp } from '@/lib/whatsapp';
import { groupPickups, isPickupOrder, itemsLabel, pickupDueAt, pickupLane, pickupName, pickupPill, READY_WARN_MIN } from '@/lib/pickupBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: vi.fn(async () => {}) }));
vi.mock('@/lib/whatsapp', async (orig) => ({ ...(await orig<typeof import('@/lib/whatsapp')>()), openWhatsApp: vi.fn() }));
vi.mock('@/components/ReceiptPreview', () => ({ default: ({ order }: { order: { orderNumber: number } }) => <div data-testid="receipt-printing">{order.orderNumber}</div> }));
vi.mock('@/components/ReadyNotificationBus', () => ({ default: () => null }));
vi.mock('@/components/ReadyOrderPoller', () => ({ default: () => null }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const at = (min: number) => new Date(NOW - min * 60000).toISOString();

describe('the rules', () => {
  it('a pickup order is a takeaway or a website self-pickup — never a void or cancelled one', () => {
    expect(isPickupOrder({ orderType: 'takeaway', status: 'running' } as any)).toBe(true);
    expect(isPickupOrder({ orderType: 'dining', status: 'running', pickupRequested: true } as any)).toBe(true);
    expect(isPickupOrder({ orderType: 'dining', status: 'running' } as any)).toBe(false);
    expect(isPickupOrder({ orderType: 'delivery', status: 'running' } as any)).toBe(false);
    expect(isPickupOrder({ orderType: 'takeaway', status: 'cancelled' } as any)).toBe(false);
    expect(isPickupOrder({ orderType: 'takeaway', status: 'void' } as any)).toBe(false);
  });

  it('the lane: Preparing until the kitchen is done, Ready until it is paid / handed over, then Collected', () => {
    expect(pickupLane({ status: 'running', kitchenStatus: undefined })).toBe('preparing');
    expect(pickupLane({ status: 'running', kitchenStatus: 'pending' })).toBe('preparing');
    expect(pickupLane({ status: 'running', kitchenStatus: 'preparing' })).toBe('preparing');
    expect(pickupLane({ status: 'running', kitchenStatus: 'ready' })).toBe('ready');
    expect(pickupLane({ status: 'running', kitchenStatus: 'served' })).toBe('ready');
    expect(pickupLane({ status: 'paid', kitchenStatus: 'ready' })).toBe('collected');
    expect(pickupLane({ status: 'credit_received', kitchenStatus: undefined })).toBe('collected');
  });

  it('the time the customer was given: "30 min" after the order, or a clock time', () => {
    expect(pickupDueAt({ pickupTime: '30 min', createdAt: at(10) })).toBe(NOW - 10 * 60000 + 30 * 60000);
    expect(pickupDueAt({ pickupTime: new Date(NOW + 5 * 60000).toISOString(), createdAt: at(10) })).toBe(NOW + 5 * 60000);
    expect(pickupDueAt({ pickupTime: undefined, createdAt: at(10) })).toBeNull();
    expect(pickupDueAt({ pickupTime: 'whenever', createdAt: at(10) })).toBeNull();
  });

  it('the pill: minutes cooking, "overdue" past the promised time, "waiting" once ready (amber after ten), the clock once collected', () => {
    const base = { status: 'running', createdAt: at(6), kitchenStatusAt: undefined, pickupTime: undefined, paidAt: undefined };
    expect(pickupPill({ ...base, kitchenStatus: 'preparing' } as any, NOW)).toEqual({ label: '6 min', tone: 'info' });
    expect(pickupPill({ ...base, kitchenStatus: 'preparing', pickupTime: '5 min' } as any, NOW)).toEqual({ label: 'overdue 1 min', tone: 'bad' });
    expect(pickupPill({ ...base, kitchenStatus: 'preparing', pickupTime: '30 min' } as any, NOW)).toEqual({ label: '6 min', tone: 'info' });
    expect(pickupPill({ ...base, kitchenStatus: 'ready', kitchenStatusAt: at(3) } as any, NOW)).toEqual({ label: 'waiting 3 min', tone: 'ok' });
    expect(pickupPill({ ...base, kitchenStatus: 'ready', kitchenStatusAt: at(READY_WARN_MIN) } as any, NOW).tone).toBe('warn');
    const paid = new Date(2026, 10, 22, 9, 5).toISOString();
    expect(pickupPill({ ...base, status: 'paid', paidAt: paid } as any, NOW)).toEqual({ label: '09:05', tone: 'neutral' });
  });

  it('"4 items" counts pieces, not lines; no name is a Walk-in', () => {
    expect(itemsLabel({ items: [{ quantity: 3 }, { quantity: 1 }] } as any)).toBe('4 items');
    expect(itemsLabel({ items: [{ quantity: 1 }] } as any)).toBe('1 item');
    expect(pickupName({ customer: undefined })).toBe('Walk-in');
    expect(pickupName({ customer: { name: '  ' } } as any)).toBe('Walk-in');
    expect(pickupName({ customer: { name: 'Sara' } } as any)).toBe('Sara');
  });
});

function seed() {
  const order = (n: number, over: Record<string, unknown> = {}) => ({
    id: `p${n}`, orderNumber: n, orderType: 'takeaway', status: 'running', source: 'pos', kitchenStatus: undefined,
    items: [{ id: `i${n}`, menuItemId: 'm1', name: 'Zinger Burger', pricingType: 'fixed', price: 400, quantity: 2, lineTotal: 800, note: '' }],
    subtotal: 800, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 800, notes: '', payments: [], amountPaid: 0,
    createdAt: ago(8), customer: { id: `c${n}`, name: `Customer ${n}`, phone: `0300555${n}`, address: 'x' }, ...over,
  });
  const yesterday = new Date(Date.now() - 26 * 3600_000).toISOString();
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [{ id: 'm1', name: 'Zinger Burger', price: 400, categoryId: 'c1', pricingType: 'fixed', isActive: true }],
    orders: [
      order(1044, { customer: undefined, kitchenStatus: 'preparing' }),
      order(1045, { orderType: 'dining', pickupRequested: true, source: 'website', pickupTime: '1 min', createdAt: ago(20) }),   // a website self-pickup, long overdue
      order(1040, { kitchenStatus: 'ready', kitchenStatusAt: ago(3) }),
      order(1036, { kitchenStatus: 'ready', kitchenStatusAt: ago(12), customer: { id: 'c9', name: 'Hina Malik', phone: '', address: '' } }),
      order(1033, { status: 'paid', kitchenStatus: 'served', paidAt: ago(1), amountPaid: 800 }),
      order(1010, { status: 'paid', kitchenStatus: 'served', paidAt: yesterday, createdAt: yesterday, amountPaid: 800 }),
      order(1020, { orderType: 'dining' }),                              // dine-in: not a pickup
      order(1021, { status: 'cancelled' }),                              // cancelled: not a pickup
    ],
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}

const mount = async () => { const { default: Page } = await import('@/pages/PickupOrdersPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const lane = (k: string) => document.querySelector(`[data-pk-lane="${k}"]`) as HTMLElement;
const saved = (id: string) => getOrders().find(o => o.id === id)!;
const cardOf = (l: string, num: number) => within(lane(l)).getByText(`#${num}`).closest('[data-pk-card]') as HTMLElement;
const counts = () => ['preparing', 'ready', 'collected'].map(k => lane(k).querySelector('.pk-count')!.textContent);

describe('the grouping', () => {
  it('three lanes; the oldest promise first; the earlier collected kept apart; dine-in and cancelled left out; the search', () => {
    seed();
    const all = getOrders();
    const g = groupPickups(all, '');
    expect(g.preparing.map(o => o.orderNumber)).toEqual([1045, 1044]);       // the website order promised for a minute after it was placed, 20 minutes ago, is due first
    expect(g.ready.map(o => o.orderNumber)).toEqual([1036, 1040]);
    expect(g.collected.map(o => o.orderNumber)).toEqual([1033]);
    expect(g.earlier.map(o => o.orderNumber)).toEqual([1010]);
    expect(groupPickups(all, '0300555').preparing.length).toBe(1);           // the Walk-in has no phone
    expect(groupPickups(all, 'hina').ready.map(o => o.orderNumber)).toEqual([1036]);
    expect(groupPickups(all, '#1044').preparing.map(o => o.orderNumber)).toEqual([1044]);
  });
});

describe('the board under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/pickup'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); vi.mocked(openWhatsApp).mockClear(); });
  afterEach(() => cleanup());

  it('the title, "Counter view" and three lanes with their counts', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pickup orders');
    expect(document.querySelector('.pk-titles p')!.textContent).toBe('Counter view');
    expect(['Preparing', 'Ready to hand over', 'Collected today']).toEqual([...document.querySelectorAll('.pk-lane-head b')].map(b => b.textContent));
    expect(counts()).toEqual(['2', '2', '1']);
  });

  it('a card: the number large, the customer, "2 items · Rs 800" and the pill', async () => {
    await mount();
    const c = cardOf('ready', 1040);
    expect(c.querySelector('.pk-num')!.textContent).toBe('#1040');
    expect(c.textContent).toContain('Customer 1040');
    expect(c.textContent).toContain('2 items · Rs 800');
    expect(c.querySelector('.pk-pill')!.textContent).toBe('waiting 3 min');
    expect(cardOf('ready', 1036).querySelector('.pk-pill')!.getAttribute('data-tone')).toBe('warn');
    expect(within(lane('preparing')).getByText('Walk-in')).toBeInTheDocument();
    expect(cardOf('preparing', 1045).querySelector('.pk-pill')!.getAttribute('data-tone')).toBe('bad');     // the website order is past the time it was promised
    expect(cardOf('collected', 1033).textContent).toContain('paid');
  });

  it('Mark ready tells the kitchen it is ready and moves the card to Ready to hand over', async () => {
    await mount();
    fireEvent.click(within(cardOf('preparing', 1044)).getByRole('button', { name: 'Mark ready' }));
    expect(saved('p1044').kitchenStatus).toBe('ready');
    expect(within(lane('ready')).getByText('#1044')).toBeInTheDocument();
    expect(counts()).toEqual(['1', '3', '1']);
  });

  it('Handed over takes the bill (collects it), prints it and moves the card to Collected today', async () => {
    await mount();
    fireEvent.click(within(cardOf('ready', 1040)).getByRole('button', { name: 'Handed over' }));
    expect(saved('p1040').status).toBe('paid');
    expect(saved('p1040').paidAt).toBeTruthy();
    expect(within(lane('collected')).getByText('#1040')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-printing')).toHaveTextContent('1040');
  });

  it('the search narrows every lane by number, name or phone', async () => {
    await mount();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pickup orders' }), { target: { value: 'hina' } });
    expect(counts()).toEqual(['0', '1', '0']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search pickup orders' }), { target: { value: '#1044' } });
    expect(counts()).toEqual(['1', '0', '0']);
  });

  it('Show earlier brings in yesterday\'s collected orders', async () => {
    await mount();
    expect(within(lane('collected')).queryByText('#1010')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show earlier \(1\)/ }));
    expect(within(lane('collected')).getByText('#1010')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide earlier/ }));
    expect(within(lane('collected')).queryByText('#1010')).toBeNull();
  });

  it('the ⋯ menu: call the customer, send the "ready" message on WhatsApp; a collected card can be reprinted', async () => {
    await mount();
    fireEvent.click(within(cardOf('ready', 1040)).getByRole('button', { name: /More for order 1040/ }));
    expect(await screen.findByRole('link', { name: /Call customer/ })).toHaveAttribute('href', 'tel:03005551040');
    fireEvent.click(screen.getByRole('button', { name: /Send “ready” message/ }));
    expect(openWhatsApp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openWhatsApp).mock.calls[0][1]).toMatch(/Customer 1040.*#1040/);
    cleanup(); await mount();
    fireEvent.click(within(cardOf('ready', 1036)).getByRole('button', { name: /More for order 1036/ }));
    expect(await screen.findByRole('button', { name: /Send “ready” message/ })).toBeDisabled();             // no phone number on that one
    cleanup(); await mount();
    fireEvent.click(within(cardOf('collected', 1033)).getByRole('button', { name: /More for order 1033/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Reprint bill/ }));
    expect(screen.getByTestId('receipt-printing')).toHaveTextContent('1033');
  });

  it('nothing at the counter: each lane says so', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!);
    data.orders = [];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(counts()).toEqual(['0', '0', '0']);
    expect(lane('preparing').textContent).toContain('Nothing being prepared');
    expect(lane('ready').textContent).toContain('Nothing waiting at the counter');
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/pickup'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: the awaiting / collected tabs, no board', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-pk-board]')).toBeNull();
    expect(screen.getByRole('tab', { name: /Awaiting Pickup \(4\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Collected \(2\)/ })).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-pickup.css');
    expect(read('src/styles.css')).toContain('ui-refined-pickup.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
