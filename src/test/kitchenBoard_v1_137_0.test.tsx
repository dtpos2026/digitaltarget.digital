// ============================================================
// v1.137.0 — the Kitchen display as the design draws it (SW-11): a dark full-screen board, the stations across the top, three columns
// — New · Cooking · Ready — of tickets (order · type · table, the age on the right, purple → amber → red), the items as "1 × Zinger Burger"
// with the cook's note under, and ONE button: Start cooking · Bump → Ready · Recall.
// Pinned: the rules in lib/kitchenBoard.ts, the buttons really move the order (and Recall really takes "ready" back), the station filter,
// DT Refined shows the board and every other look keeps its page, and the stylesheet is scoped.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getOrders, recallKitchenOrder } from '@/lib/store';
import {
  actionFor, ageLabel, ageTone, boardTitle, columnOf, itemLine, KDS_COLUMNS, minutesSince, ticketTitle, waitedMinutes,
} from '@/lib/kitchenBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

describe('the rules', () => {
  it('three columns, in the design\'s order; "accepted" is still New', () => {
    expect(KDS_COLUMNS.map(c => c.label)).toEqual(['New', 'Cooking', 'Ready']);
    expect(columnOf({ kitchenStatus: undefined })).toBe('new');
    expect(columnOf({ kitchenStatus: 'pending' })).toBe('new');
    expect(columnOf({ kitchenStatus: 'accepted' })).toBe('new');
    expect(columnOf({ kitchenStatus: 'preparing' })).toBe('cooking');
    expect(columnOf({ kitchenStatus: 'ready' })).toBe('ready');
  });

  it('the ticket title says the order, how it leaves and — for dining — the table', () => {
    expect(ticketTitle({ orderNumber: 1043, orderType: 'dining', tableName: 'T-07' } as any)).toBe('#1043 · Dining T-07');
    expect(ticketTitle({ orderNumber: 1041, orderType: 'delivery', tableName: 'T-07' } as any)).toBe('#1041 · Delivery');
    expect(ticketTitle({ orderNumber: 12, orderType: 'takeaway' } as any)).toBe('#12 · Takeaway');
    expect(ticketTitle({ orderNumber: 5, orderType: 'dining' } as any)).toBe('#5 · Dining');
  });

  it('the age: minutes since the order; a Ready ticket counts from the moment it was bumped, and says so', () => {
    const now = Date.UTC(2026, 10, 22, 12, 0, 0);
    const at = (m: number) => new Date(now - m * 60000).toISOString();
    expect(minutesSince(at(9), now)).toBe(9);
    expect(minutesSince(at(-3), now)).toBe(0);
    expect(minutesSince('not a date', now)).toBe(0);
    expect(waitedMinutes({ createdAt: at(16), kitchenStatus: 'preparing', kitchenStatusAt: at(1) }, now)).toBe(16);
    expect(waitedMinutes({ createdAt: at(30), kitchenStatus: 'ready', kitchenStatusAt: at(2) }, now)).toBe(2);
    expect(ageLabel('new', 1)).toBe('1 min');
    expect(ageLabel('cooking', 9)).toBe('9 min');
    expect(ageLabel('ready', 2)).toBe('waiting 2 min');
  });

  it('purple, then amber, then red — by the restaurant\'s own two limits', () => {
    expect(ageTone(1, 5, 10)).toBe('normal');
    expect(ageTone(4, 5, 10)).toBe('normal');
    expect(ageTone(5, 5, 10)).toBe('warn');
    expect(ageTone(9, 5, 10)).toBe('warn');
    expect(ageTone(10, 5, 10)).toBe('bad');
    expect(ageTone(16, 5, 10)).toBe('bad');
    expect(ageTone(7, 3, 6)).toBe('bad');                  // a faster kitchen's limits
    expect(ageTone(12, 0, 0)).toBe('bad');                 // unset limits fall back to 5 / 10, never to "everything is late"
    expect(ageTone(1, 0, 0)).toBe('normal');
  });

  it('an item line carries the size and the add-ons the cook has to make', () => {
    expect(itemLine({ quantity: 1, name: 'Chicken Tikka Pizza', variantName: 'L' })).toBe('1 × Chicken Tikka Pizza (L)');
    expect(itemLine({ quantity: 2, name: 'Zinger Burger' })).toBe('2 × Zinger Burger');
    expect(itemLine({ quantity: 1, name: 'Fries', variantName: 'Large', addOns: [{ id: 'a', name: 'Cheese', price: 50 }] })).toBe('1 × Fries (Large, + Cheese)');
  });

  it('one button per column', () => {
    expect(actionFor('new')).toEqual({ label: 'Start cooking', to: 'preparing' });
    expect(actionFor('cooking')).toEqual({ label: 'Bump → Ready', to: 'ready' });
    expect(actionFor('ready')).toEqual({ label: 'Recall', to: 'recall' });
  });

  it('the board is named for the branch, else the restaurant, else just Kitchen', () => {
    expect(boardTitle('Main Branch', 'Chai Corner')).toBe('Kitchen · Main Branch');
    expect(boardTitle(null, 'Chai Corner')).toBe('Kitchen · Chai Corner');
    expect(boardTitle('', '')).toBe('Kitchen');
  });
});

function seed() {
  const line = (id: string, menuItemId: string, name: string, q: number, extra: Record<string, unknown> = {}) => ({ id: `l-${id}`, menuItemId, name, price: 100, quantity: q, lineTotal: q * 100, note: '', pricingType: 'fixed', ...extra });
  const base = { orderType: 'dining', subtotal: 0, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 0, notes: '', payments: [], amountPaid: 0, status: 'running' };
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', kitchenPreparingMinutes: 5, kitchenWarningMinutes: 10 },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [{ id: 'c1', name: 'Mains', icon: '', sortOrder: 1 }],
    menuItems: [
      { id: 'm1', name: 'Karahi', price: 1000, categoryId: 'c1', pricingType: 'fixed', isActive: true, kitchenId: 'k1' },
      { id: 'm2', name: 'Tea', price: 100, categoryId: 'c1', pricingType: 'fixed', isActive: true, kitchenId: 'k2' },
    ],
    kitchens: [{ id: 'k1', name: 'Grill' }, { id: 'k2', name: 'Bar' }],
    orders: [
      { ...base, id: 'o1', orderNumber: 101, kitchenStatus: 'pending', createdAt: ago(14), tableName: 'T-04', items: [line('a', 'm1', 'Karahi', 1, { note: 'no onion', variantName: 'half' })] },
      { ...base, id: 'o2', orderNumber: 102, kitchenStatus: 'preparing', createdAt: ago(7), orderType: 'takeaway', items: [line('b', 'm2', 'Tea', 2), line('c', 'm1', 'Karahi', 1)] },
      { ...base, id: 'o3', orderNumber: 103, kitchenStatus: 'ready', createdAt: ago(30), kitchenStatusAt: ago(2), tableName: 'T-09', items: [line('d', 'm2', 'Tea', 1)] },
      { ...base, id: 'o4', orderNumber: 104, kitchenStatus: 'ready', createdAt: ago(25), orderType: 'delivery', deliveryStatus: 'ready', readyAt: ago(3), kitchenStatusAt: ago(3), items: [line('e', 'm1', 'Karahi', 1)] },
      { ...base, id: 'o5', orderNumber: 105, status: 'paid', kitchenStatus: 'served', createdAt: ago(60), items: [line('f', 'm1', 'Karahi', 1)] },
    ],
    tables: [], floors: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 200,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}

const mount = async () => { const { default: Page } = await import('@/pages/KitchenDisplayPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const col = (k: string) => document.querySelector(`[data-kb-column="${k}"]`) as HTMLElement;
const status = (id: string) => getOrders().find(o => o.id === id)!;

describe('the board under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/kitchen'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('is a full-screen board on <body> with the branch\'s name, the stations, Live and the time', async () => {
    await mount();
    const board = document.querySelector('[data-kb-board]') as HTMLElement;
    expect(board).not.toBeNull();
    expect(board.parentElement).toBe(document.body);                       // no shell around it
    expect(within(board).getByRole('heading', { level: 1 }).textContent).toBe('Kitchen · Chai Corner');
    expect(within(board).getAllByRole('tab').map(t => t.textContent)).toEqual(['All stations', 'Grill', 'Bar', 'Unassigned']);
    expect(within(board).getByRole('tab', { name: 'All stations' }).getAttribute('aria-selected')).toBe('true');
    expect(board.querySelector('[data-kb-live]')!.textContent).toMatch(/Live|Offline|waiting/);
    expect(board.querySelector('[data-kb-clock]')!.textContent).toMatch(/^\d{2}:\d{2}$/);
  });

  it('the three columns carry the tickets, with the counts; a bill that is done is not on the board', async () => {
    await mount();
    expect(KDS_COLUMNS.map(c => col(c.key).querySelector('.kb-count')!.textContent)).toEqual(['1', '1', '2']);
    expect(within(col('new')).getByText('#101 · Dining T-04')).toBeInTheDocument();
    expect(within(col('cooking')).getByText('#102 · Takeaway')).toBeInTheDocument();
    expect(within(col('ready')).getByText('#103 · Dining T-09')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/#105/);
  });

  it('a ticket says the age and goes purple → amber → red; items read "1 × Karahi (half)" with the note under', async () => {
    await mount();
    const t101 = within(col('new')).getByText('#101 · Dining T-04').closest('[data-kb-ticket]') as HTMLElement;
    expect(t101.getAttribute('data-tone')).toBe('bad');
    expect(t101.querySelector('[data-kb-age]')!.textContent).toBe('14 min');
    expect(t101.textContent).toContain('1 × Karahi (half)');
    expect(t101.querySelector('.kb-note')!.textContent).toBe('no onion');
    const t102 = within(col('cooking')).getByText('#102 · Takeaway').closest('[data-kb-ticket]') as HTMLElement;
    expect(t102.getAttribute('data-tone')).toBe('warn');
    expect(t102.querySelector('[data-kb-age]')!.textContent).toBe('7 min');
    const t103 = within(col('ready')).getByText('#103 · Dining T-09').closest('[data-kb-ticket]') as HTMLElement;
    expect(t103.getAttribute('data-tone')).toBe('normal');
    expect(t103.querySelector('[data-kb-age]')!.textContent).toBe('waiting 2 min');
    expect(document.querySelector('[data-kb-delayed]')!.textContent).toBe('1 delayed');
  });

  it('Start cooking → Bump → Ready → Recall move the order through the kitchen', async () => {
    await mount();
    fireEvent.click(within(col('new')).getByRole('button', { name: 'Start cooking' }));
    expect(status('o1').kitchenStatus).toBe('preparing');
    expect(within(col('cooking')).getByText('#101 · Dining T-04')).toBeInTheDocument();
    expect(within(col('new')).queryByText('#101 · Dining T-04')).toBeNull();

    const t101 = within(col('cooking')).getByText('#101 · Dining T-04').closest('[data-kb-ticket]') as HTMLElement;
    fireEvent.click(within(t101).getByRole('button', { name: 'Bump → Ready' }));
    expect(status('o1').kitchenStatus).toBe('ready');
    expect(within(col('ready')).getByText('#101 · Dining T-04')).toBeInTheDocument();

    const again = within(col('ready')).getByText('#101 · Dining T-04').closest('[data-kb-ticket]') as HTMLElement;
    fireEvent.click(within(again).getByRole('button', { name: 'Recall' }));
    expect(status('o1').kitchenStatus).toBe('preparing');
    expect(within(col('cooking')).getByText('#101 · Dining T-04')).toBeInTheDocument();
  });

  it('Served takes a ready ticket off the board for good', async () => {
    await mount();
    const t103 = within(col('ready')).getByText('#103 · Dining T-09').closest('[data-kb-ticket]') as HTMLElement;
    fireEvent.click(within(t103).getByRole('button', { name: 'Mark served' }));
    expect(status('o3').kitchenStatus).toBe('delivered');
    expect(document.body.textContent).not.toMatch(/#103/);
  });

  it('a station shows only its own items, and a ticket with none of them leaves', async () => {
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Bar' }));
    expect(document.body.textContent).not.toMatch(/#101/);                // Karahi only — a Grill item
    const t102 = within(col('cooking')).getByText('#102 · Takeaway').closest('[data-kb-ticket]') as HTMLElement;
    expect(t102.textContent).toContain('2 × Tea');
    expect(t102.textContent).not.toContain('Karahi');
    fireEvent.click(screen.getByRole('tab', { name: 'All stations' }));
    expect(within(col('new')).getByText('#101 · Dining T-04')).toBeInTheDocument();
  });

  it('the options menu holds the sound, full screen and TV mode; ✕ goes back to the till', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen display options' }));
    expect(await screen.findByRole('button', { name: /Sound alerts on/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /TV mode/ }));
    expect(await screen.findByRole('heading', { name: /TV mode/ })).toBeInTheDocument();
  });

  it('closing the board leaves the Kitchen page', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close the kitchen display' }));
    expect(window.location.hash).toMatch(/^#\/$|^#$|^$/);
  });

  it('nothing on the board: the all-clear message, the stations still there', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!);
    data.orders = [];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(document.querySelector('[data-kb-empty]')!.textContent).toMatch(/All orders completed/);
    expect(screen.getByRole('tab', { name: 'All stations' })).toBeInTheDocument();
  });
});

describe('Recall takes "ready" back', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });
  it('the ready stamp goes, a delivery that was waiting for its rider is cooking again, and the cooking clock restarts', () => {
    const before = status('o4');
    expect(before.deliveryStatus).toBe('ready');
    expect((before as any).readyAt).toBeTruthy();
    recallKitchenOrder('o4');
    const after = status('o4');
    expect(after.kitchenStatus).toBe('preparing');
    expect(after.deliveryStatus).toBe('cooking');
    expect((after as any).readyAt).toBeFalsy();
    expect(Date.now() - new Date(after.cookingStartedAt!).getTime()).toBeLessThan(5000);
  });
  it('an unknown order is left alone', () => {
    expect(() => recallKitchenOrder('nope')).not.toThrow();
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/kitchen'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: no board, the old cards', async () => {
    setUiStyle('modern'); setTheme('ember');
    const { container } = await mount();
    expect(document.querySelector('[data-kb-board]')).toBeNull();
    expect(container.querySelectorAll('[data-kds-card]').length).toBe(4);
  });
});

describe('the stylesheet', () => {
  const css = read('src/styles/ui-refined-kitchen.css');
  it('is imported and every rule is scoped to DT Refined', () => {
    expect(read('src/styles.css')).toContain('ui-refined-kitchen.css');
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const flat = body.replace(/@media[^{]*\{/g, '');                       // the @media wrapper has no selector of its own
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
  it('draws the design\'s tokens: the dark ground, the amber and the red header, three columns', () => {
    for (const s of ['#0f0b18', '#1a1426', '#352b4a', 'repeat(3, minmax(0, 1fr))', '.kb-ticket[data-tone="warn"]', '.kb-ticket[data-tone="bad"]']) expect(css).toContain(s);
  });
  it('the old v1.102.0 ring card is gone from the stylesheet and the page', () => {
    expect(read('src/styles/ui-refined-pos.css')).not.toContain('data-kds-ring');
    expect(read('src/pages/KitchenDisplayPage.tsx')).not.toContain('TimerRing');
  });
});
