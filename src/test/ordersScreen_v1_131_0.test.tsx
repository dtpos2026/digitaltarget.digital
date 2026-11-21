// v1.131.0 — the Orders screen is the design's (SW-06): one table of the day's bills, status pills, Today / All types, a panel for the bill.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HashRouter } from '@/lib/hash-router';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { filterOrders, ordersCsv, rangeBounds, statusGroup, statusPill, timeLabel, isOpenBill } from '@/lib/ordersView';
import type { Order } from '@/lib/types';

const enqueueReceipt = vi.fn();
vi.mock('@/lib/printQueue', async (orig) => ({ ...(await orig<typeof import('@/lib/printQueue')>()), enqueueReceipt: (...a: unknown[]) => enqueueReceipt(...a) }));
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: async () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const NOW = new Date(2026, 10, 21, 15, 30, 0).getTime();            // Saturday 21 Nov 2026, 15:30
const at = (dayOffset: number, h: number, m = 0) => new Date(2026, 10, 21 + dayOffset, h, m).toISOString();
let n = 1000;
const order = (o: Partial<Order> = {}): Order => ({
  id: `o${++n}`, orderNumber: n, orderType: 'dining', status: 'paid', items: [{ id: `i${n}`, menuItemId: 'm1', name: 'Zinger Burger', price: 650, quantity: 1, lineTotal: 650 } as any],
  subtotal: 650, grandTotal: 650, createdAt: at(0, 12), payments: [], ...o,
} as Order);

describe('the rules of the Orders screen', () => {
  it('statuses fall into the design\'s pills; what no pill names shows under All only', () => {
    expect(['running', 'hold', 'paid', 'partial', 'void', 'cancelled', 'credit_pending', 'credit_received', 'pending_approval', 'complimentary'].map(s => statusGroup({ status: s as any })))
      .toEqual(['running', 'hold', 'paid', 'partial', 'void', 'void', 'credit', 'paid', 'other', 'other']);
    expect(isOpenBill({ status: 'running' })).toBe(true);
    expect(isOpenBill({ status: 'paid' })).toBe(false);
    expect(isOpenBill({ status: 'void' })).toBe(false);
  });

  it('a running bill says what is happening to it', () => {
    expect(statusPill(order({ status: 'running' }))).toEqual({ label: 'Running', tone: 'info' });
    expect(statusPill(order({ status: 'running', kitchenStatus: 'preparing' }))).toEqual({ label: 'Cooking', tone: 'info' });
    expect(statusPill(order({ status: 'running', orderType: 'delivery', deliveryStatus: 'onway' }))).toEqual({ label: 'On the way', tone: 'accent' });
    expect(statusPill(order({ status: 'paid' }))).toEqual({ label: 'Paid', tone: 'ok' });
    expect(statusPill(order({ status: 'partial' }))).toEqual({ label: 'Partial', tone: 'warn' });
    expect(statusPill(order({ status: 'void' }))).toEqual({ label: 'Void', tone: 'bad' });
  });

  it('Today is the calendar day; Yesterday, 7 days and the month are what they say', () => {
    const [a, b] = rangeBounds('today', NOW);
    expect(new Date(a).getHours()).toBe(0); expect(b - a).toBe(86_400_000);
    const list = [order({ createdAt: at(0, 9) }), order({ createdAt: at(-1, 22) }), order({ createdAt: at(-5, 10) }), order({ createdAt: at(-30, 10) })];
    const f = (range: any) => filterOrders(list, { range, type: 'all', status: 'all', q: '' }, NOW).length;
    expect([f('today'), f('yesterday'), f('week'), f('month'), f('all')]).toEqual([1, 1, 3, 3, 4]);
  });

  it('filters by type and status, searches bill number, customer, phone and table, newest first', () => {
    const list = [
      order({ orderNumber: 1, createdAt: at(0, 10), orderType: 'dining', tableName: 'T-07', customer: { id: 'c', name: 'Ahmed Raza', phone: '0300111' } as any }),
      order({ orderNumber: 2, createdAt: at(0, 14), orderType: 'delivery', status: 'running', customer: { id: 'd', name: 'Sara Khan', phone: '0321222' } as any }),
      order({ orderNumber: 3, createdAt: at(0, 12), orderType: 'takeaway', status: 'void' }),
    ];
    const f = (o: Partial<{ type: string; status: any; q: string }>) => filterOrders(list, { range: 'today', type: 'all', status: 'all', q: '', ...o }, NOW).map(x => x.orderNumber);
    expect(f({})).toEqual([2, 3, 1]);                         // newest first
    expect(f({ type: 'delivery' })).toEqual([2]);
    expect(f({ status: 'void' })).toEqual([3]);
    expect(f({ q: 'ahmed' })).toEqual([1]);
    expect(f({ q: '#2' })).toEqual([2]);
    expect(f({ q: 't-07' })).toEqual([1]);
    expect(f({ q: '0321' })).toEqual([2]);
    expect(f({ q: 'walk-in' })).toEqual([3]);
  });

  it('time: today shows the clock, another day shows the date too', () => {
    expect(timeLabel(order({ createdAt: at(0, 9, 5) }), NOW)).toBe('09:05');
    expect(timeLabel(order({ createdAt: at(-2, 18, 40) }), NOW)).toMatch(/^19 Nov 18:40$/);
  });

  it('the CSV is the table: the same columns, the total as a plain number, quotes escaped', () => {
    const csv = ordersCsv([order({ orderNumber: 7, grandTotal: 1450, customer: { id: 'c', name: 'Ali "Chotu", Raza' } as any, createdAt: at(0, 12, 41) })], NOW).split('\r\n');
    expect(csv[0]).toBe('Bill,Type,Table,Customer,Total,Status,Time');
    expect(csv[1]).toBe('7,dining,,"Ali ""Chotu"", Raza",1450,Paid,12:41');
  });
});

describe('the Orders screen, mounted', () => {
  const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
  const seed = (orders: Order[]) => {
    localStorage.setItem('desi-pos-data', JSON.stringify({
      settings: { name: 'Sample', currencySymbol: 'Rs ' },
      users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
      categories: [], menuItems: [], orders, tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 2000,
    }));
    localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Owner');
    reload();
  };
  const wideWindow = () => { (window as any).matchMedia = (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }); };
  const mount = async () => {
    const { default: Page } = await import('@/pages/RunningBillsPage');
    window.location.hash = '#/bills';
    return render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider></QueryClientProvider>);
  };
  beforeEach(() => { cleanup(); localStorage.clear(); enqueueReceipt.mockClear(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); wideWindow(); });
  afterEach(() => { cleanup(); delete (window as any).matchMedia; });

  const today = (h: number, m = 0) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
  const list = () => [
    order({ id: 'a', orderNumber: 1042, status: 'running', orderType: 'dining', tableName: 'T-07', grandTotal: 3280, createdAt: today(0, 1), customer: { id: 'c1', name: 'Ahmed Raza' } as any }),
    order({ id: 'b', orderNumber: 1040, status: 'paid', orderType: 'takeaway', grandTotal: 940, createdAt: today(0, 2) }),
    order({ id: 'c', orderNumber: 1036, status: 'void', orderType: 'takeaway', grandTotal: 1290, createdAt: today(0, 3) }),
    order({ id: 'd', orderNumber: 1038, status: 'hold', orderType: 'delivery', grandTotal: 1780, createdAt: today(0, 4) }),
  ];

  it('is titled Orders with the day\'s bill count; lists every status as a row; Export and New bill sit at the right', async () => {
    seed(list());
    const { container } = await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Orders');
    expect(container.textContent).toMatch(/Today · 4 bills/);
    const rows = [...container.querySelectorAll('[data-bill-row]')];
    expect(rows).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New bill/ })).toBeInTheDocument();
    expect([...container.querySelectorAll('thead th')].map(t => t.textContent)).toEqual(['Bill', 'Type', 'Table', 'Customer', 'Total', 'Status', 'Time']);
  });

  it('the status pills filter the table; the search finds a bill by number, customer or table', async () => {
    seed(list());
    const { container } = await mount();
    const ids = () => [...container.querySelectorAll('[data-bill-row]')].map(r => r.getAttribute('data-bill-row'));
    fireEvent.click(container.querySelector('[data-status-filter="void"]')!);
    expect(ids()).toEqual(['c']);
    fireEvent.click(container.querySelector('[data-status-filter="paid"]')!);
    expect(ids()).toEqual(['b']);
    fireEvent.click(container.querySelector('[data-status-filter="all"]')!);
    fireEvent.change(screen.getByLabelText('Search bills'), { target: { value: 'ahmed' } });
    expect(ids()).toEqual(['a']);
    fireEvent.change(screen.getByLabelText('Search bills'), { target: { value: 't-07' } });
    expect(ids()).toEqual(['a']);
    fireEvent.change(screen.getByLabelText('Search bills'), { target: { value: 'zzz' } });
    expect(screen.getByText('No bills here')).toBeInTheDocument();
  });

  it('a wide window opens with the first bill in the panel; picking a row shows its lines and total; an open bill has Reprint, Pay and the ⋯ menu', async () => {
    seed(list());
    const { container } = await mount();
    const panel = () => container.querySelector('[data-bill-panel]') as HTMLElement;
    expect(panel().getAttribute('data-bill-panel')).toBe('d');                           // the newest
    fireEvent.click(container.querySelector('[data-bill-row="a"]')!);
    expect(panel().getAttribute('data-bill-panel')).toBe('a');
    expect(within(panel()).getByText(/1 × Zinger Burger/)).toBeInTheDocument();
    expect(within(panel()).getByText('Total')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /Reprint/ })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /Pay/ })).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'More actions' }));
    const items = [...document.querySelectorAll('[data-bill-more-item]')].map(b => b.getAttribute('data-bill-more-item'));
    expect(items).toEqual(['receipt', 'history', 'edit', 'kot', 'hold', 'cancel']);
  });

  it('a paid bill can be reprinted and looked up, but not paid, edited, held or cancelled', async () => {
    seed(list());
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-bill-row="b"]')!);
    const panel = container.querySelector('[data-bill-panel]') as HTMLElement;
    expect(within(panel).queryByRole('button', { name: /^Pay/ })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'More actions' }));
    expect([...document.querySelectorAll('[data-bill-more-item]')].map(b => b.getAttribute('data-bill-more-item'))).toEqual(['receipt', 'history']);
  });

  it('Reprint sends the customer receipt to the printer, forced, once', async () => {
    seed(list());
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-bill-row="b"]')!);
    fireEvent.click(within(container.querySelector('[data-bill-panel]') as HTMLElement).getByRole('button', { name: /Reprint/ }));
    await waitFor(() => expect(enqueueReceipt).toHaveBeenCalledTimes(1));
    expect(enqueueReceipt.mock.calls[0][0].id).toBe('b');
    expect(enqueueReceipt.mock.calls[0][1]).toEqual({ force: true });
  });

  it('Hold in the ⋯ menu holds a running bill; the table shows the new status', async () => {
    seed(list());
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-bill-row="a"]')!);
    fireEvent.click(within(container.querySelector('[data-bill-panel]') as HTMLElement).getByRole('button', { name: 'More actions' }));
    fireEvent.click(document.querySelector('[data-bill-more-item="hold"]')!);
    await waitFor(() => expect(within(container.querySelector('[data-bill-row="a"]') as HTMLElement).getByText('Hold')).toBeInTheDocument());
  });
});
