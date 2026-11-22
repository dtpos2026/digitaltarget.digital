// ============================================================
// v1.140.0 — Online order approval as the design draws it (SW-07): "Awaiting approval — 3 orders · auto-refreshing", All · Website · QR · Order taker,
// and a card per order — source and age, what it is ("Delivery · Sara Khan · Gulberg · 2.4 km"), the items, the total, Reject · Accept.
// Pinned: the rules in lib/approvalBoard.ts, Accept / Reject (with the reason) against the saved order, the four filters over the five sources,
// the processing mode, the history, the ⋯ menu (call, WhatsApp, block), DT Refined shows the board and every other look keeps its tabs, scoped stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getOrders, getSettings } from '@/lib/store';
import { getBlockedCustomers } from '@/lib/blocklist';
import {
  APPROVAL_FILTERS, APPROVAL_LATE_MIN, APPROVAL_WARN_MIN, approvalAge, approvalLine, approvalSubtitle, filterOf, groupApprovals, sourceBadge, waitingCounts,
} from '@/lib/approvalBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/printQueue', async (orig) => ({ ...(await orig<typeof import('@/lib/printQueue')>()), enqueueKot: vi.fn() }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

describe('the rules', () => {
  it('the design\'s four groups over the five sources: a website delivery is a website order, both QRs are QR', () => {
    expect(APPROVAL_FILTERS.map(f => f.label)).toEqual(['All', 'Website', 'QR', 'Order taker']);
    expect(filterOf('website')).toBe('website');
    expect(filterOf('delivery')).toBe('website');
    expect(filterOf('qr')).toBe('qr');
    expect(filterOf('takeaway_qr')).toBe('qr');
    expect(filterOf('order_taker')).toBe('order_taker');
  });

  it('the badge on a card', () => {
    expect(sourceBadge({ source: 'website', orderType: 'takeaway' } as any)).toBe('Website');
    expect(sourceBadge({ source: 'website', orderType: 'delivery' } as any)).toBe('Website');
    expect(sourceBadge({ source: 'qr', tableName: 'T-05' } as any)).toBe('QR table');
    expect(sourceBadge({ source: 'qr' } as any)).toBe('QR takeaway');
    expect(sourceBadge({ source: 'order_taker' } as any)).toBe('Order taker');
  });

  it('how long it has waited: neutral, amber from 4 minutes, red from 8', () => {
    const now = Date.UTC(2026, 10, 22, 12, 0, 0);
    const at = (m: number) => new Date(now - m * 60000).toISOString();
    expect(approvalAge(at(0), now)).toEqual({ label: 'just now', tone: 'normal', minutes: 0 });
    expect(approvalAge(at(3), now)).toEqual({ label: '3 min ago', tone: 'normal', minutes: 3 });
    expect(approvalAge(at(APPROVAL_WARN_MIN), now).tone).toBe('warn');
    expect(approvalAge(at(APPROVAL_LATE_MIN), now).tone).toBe('bad');
    expect(approvalAge(at(90), now).label).toBe('1 h ago');
    expect(approvalAge(at(60 * 49), now).label).toBe('2 d ago');
    expect(approvalAge(undefined, now).minutes).toBe(0);
  });

  it('what it is, in one line', () => {
    expect(approvalLine({ orderType: 'delivery', source: 'website', customer: { name: 'Sara Khan', area: 'Gulberg', address: 'x' }, delivery: { distanceFromRestaurantKm: 2.4 } } as any)).toBe('Delivery · Sara Khan · Gulberg · 2.4 km');
    expect(approvalLine({ orderType: 'dining', source: 'qr', tableName: 'T-05' } as any)).toBe('Dining · T-05 · Guest');
    expect(approvalLine({ orderType: 'dining', source: 'order_taker', tableName: 'T-09', waiterName: 'Imran' } as any)).toBe('Dining · T-09 · Waiter: Imran');
    expect(approvalLine({ orderType: 'takeaway', source: 'website', customer: { name: 'Hina' } } as any)).toBe('Takeaway · Hina');
  });

  it('the subtitle', () => {
    expect(approvalSubtitle(3)).toBe('3 orders · auto-refreshing');
    expect(approvalSubtitle(1)).toBe('1 order · auto-refreshing');
    expect(approvalSubtitle(2, true)).toBe('2 orders decided');
  });
});

function seed(extra: Record<string, unknown> = {}) {
  const order = (n: number, over: Record<string, unknown> = {}) => ({
    id: `a${n}`, orderNumber: n, orderType: 'dining', status: 'pending_approval', source: 'website', approvalRequired: true,
    items: [
      { id: `i${n}a`, menuItemId: 'm1', name: 'Chicken Tikka Pizza', pricingType: 'fixed', price: 800, quantity: 1, lineTotal: 800, note: '', variantName: 'L' },
      { id: `i${n}b`, menuItemId: 'm1', name: 'Mint Margarita', pricingType: 'fixed', price: 300, quantity: 2, lineTotal: 600, note: 'less ice' },
    ],
    subtotal: 1400, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 1400, notes: '', payments: [], amountPaid: 0, createdAt: ago(2), ...over,
  });
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', onlineOrderApprovalMode: 'manual', ...extra },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [{ id: 'm1', name: 'Pizza', price: 800, categoryId: 'c1', pricingType: 'fixed', isActive: true }],
    orders: [
      order(218, { orderType: 'delivery', customer: { id: 'c1', name: 'Sara Khan', phone: '03001234567', address: '12 Gulberg, Lahore', area: 'Gulberg' }, delivery: { distanceFromRestaurantKm: 2.4 }, createdAt: ago(1) }),
      order(219, { orderType: 'takeaway', customer: { id: 'c2', name: 'Noman', phone: '', address: '' }, createdAt: ago(9), notes: 'ring the bell' }),
      order(44, { source: 'qr', tableName: 'T-05', tableId: 't5', createdAt: ago(3) }),
      order(45, { source: 'qr', createdAt: ago(5) }),                                            // a takeaway QR
      order(97, { source: 'order_taker', tableName: 'T-09', tableId: 't9', waiterName: 'Imran', createdAt: ago(4) }),
      order(300, { status: 'rejected', rejectedReason: 'Fake Order', rejectedByName: 'Ayesha', rejectedAt: ago(30), approvalRequired: false }),
      order(301, { status: 'running', approvedAt: ago(40), approvedByName: 'Ayesha', approvalRequired: false }),
      order(500, { source: 'pos', status: 'running' }),                                          // a till order: never in this workflow
    ],
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  localStorage.setItem('dt_pos_current_user', JSON.stringify({ id: 'a1', name: 'Ayesha' }));
  reload();
}

const mount = async () => { const { default: Page } = await import('@/pages/OnlineOrderApprovalPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const cards = () => [...document.querySelectorAll('[data-ap-card]')] as HTMLElement[];
const numbers = () => cards().map(c => c.querySelector('.ap-num')!.textContent);
const saved = (id: string) => getOrders().find(o => o.id === id)!;
const cardOf = (n: number) => cards().find(c => c.querySelector('.ap-num')!.textContent === `#${n}`)!;

describe('the grouping', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });
  it('waiting orders, longest wait first, in the chosen group; decided ones apart; till orders left out', () => {
    const all = getOrders();
    expect(groupApprovals(all).pending.map(o => o.orderNumber)).toEqual([219, 45, 97, 44, 218]);
    expect(groupApprovals(all, 'website').pending.map(o => o.orderNumber)).toEqual([219, 218]);
    expect(groupApprovals(all, 'qr').pending.map(o => o.orderNumber)).toEqual([45, 44]);
    expect(groupApprovals(all, 'order_taker').pending.map(o => o.orderNumber)).toEqual([97]);
    expect(groupApprovals(all).history.map(o => o.orderNumber)).toEqual([300, 301]);
    expect(waitingCounts(all)).toEqual({ all: 5, website: 2, qr: 2, order_taker: 1 });
  });
});

describe('the board under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/online-approval'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('"Awaiting approval", "5 orders · auto-refreshing" and the four groups with what is waiting in each', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Awaiting approval');
    expect(document.querySelector('[data-ap-subtitle]')!.textContent).toBe('5 orders · auto-refreshing');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['All', 'Website2', 'QR2', 'Order taker1']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('a card: the number, the source, the age, what it is, the items (size included), the total, Reject · Accept', async () => {
    await mount();
    const c = cardOf(218);
    expect(c.querySelector('[data-ap-source]')!.textContent).toBe('Website');
    expect(c.querySelector('[data-ap-age]')!.textContent).toBe('1 min ago');
    expect(c.textContent).toContain('Delivery · Sara Khan · Gulberg · 2.4 km');
    expect(c.textContent).toContain('1 × Chicken Tikka Pizza (L)');
    expect(c.textContent).toContain('2 × Mint Margarita');
    expect(c.textContent).toContain('less ice');
    expect(c.textContent).toContain('Rs 1,400');
    expect(within(c).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(cardOf(219).querySelector('[data-ap-age]')!.getAttribute('data-tone')).toBe('bad');
    expect(cardOf(219).querySelector('[data-ap-note]')!.textContent).toBe('ring the bell');
    expect(cardOf(97).textContent).toContain('Waiter: Imran');
  });

  it('the group chosen narrows the queue', async () => {
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: /^QR/ }));
    expect(numbers()).toEqual(['#45', '#44']);
    expect(document.querySelector('[data-ap-subtitle]')!.textContent).toBe('2 orders · auto-refreshing');
    fireEvent.click(screen.getByRole('tab', { name: /^Order taker/ }));
    expect(numbers()).toEqual(['#97']);
    fireEvent.click(screen.getByRole('tab', { name: /^Website/ }));
    expect(numbers()).toEqual(['#219', '#218']);
  });

  it('Accept approves the order: it runs, with who approved it and when, and leaves the queue', async () => {
    await mount();
    fireEvent.click(within(cardOf(218)).getByRole('button', { name: 'Accept' }));
    const o = saved('a218');
    expect(o.status).toBe('running');
    expect(o.approvedByName).toBe('Ayesha');
    expect(o.approvedAt).toBeTruthy();
    expect(numbers()).not.toContain('#218');
  });

  it('Reject asks for the reason, saves it with the note, and the order goes to history — never deleted', async () => {
    await mount();
    fireEvent.click(within(cardOf(44)).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('heading', { name: 'Reject order #44' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Reason' }), { target: { value: 'Wrong Address' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Additional note' }), { target: { value: 'no such street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject order' }));
    const o = saved('a44');
    expect(o.status).toBe('rejected');
    expect(o.rejectedReason).toBe('Wrong Address — no such street');
    expect(o.rejectedByName).toBe('Ayesha');
    expect(numbers()).not.toContain('#44');
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(numbers()).toContain('#44');
    expect(cardOf(44).querySelector('[data-ap-result]')!.textContent).toMatch(/Rejected — Wrong Address — no such street/);
  });

  it('Cancel in the reject box rejects nothing', async () => {
    await mount();
    fireEvent.click(within(cardOf(44)).getByRole('button', { name: 'Reject' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(saved('a44').status).toBe('pending_approval');
  });

  it('History lists what was decided, with who and when; Back to waiting returns', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Decided orders');
    expect(numbers()).toEqual(['#300', '#301']);
    expect(cardOf(301).querySelector('[data-ap-result]')!.textContent).toMatch(/Accepted by Ayesha/);
    expect(within(cardOf(300)).queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Back to waiting/ }));
    expect(numbers().length).toBe(5);
  });

  it('the processing mode: Auto / Manual, and a mode for each source — saved in the settings', async () => {
    await mount();
    expect(screen.getByRole('button', { name: /Manual approval/ })).toBeInTheDocument();      // the header says which mode it is in
    fireEvent.click(document.querySelector('[data-ap-mode]') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Auto processing' }));
    expect(getSettings().onlineOrderApprovalMode).toBe('auto');
    fireEvent.change(await screen.findByRole('combobox', { name: 'Order Taker mode' }), { target: { value: 'manual' } });
    expect(getSettings().sourceApprovalMode?.order_taker).toBe('manual');
  });

  it('the ⋯ menu: call, WhatsApp and block the customer', async () => {
    const prompt = vi.fn(() => 'Repeat fake orders');
    const had = Object.getOwnPropertyDescriptor(window, 'prompt');
    Object.defineProperty(window, 'prompt', { value: prompt, configurable: true, writable: true });
    await mount();
    fireEvent.click(within(cardOf(218)).getByRole('button', { name: /More for order 218/ }));
    expect(await screen.findByRole('link', { name: /Call customer/ })).toHaveAttribute('href', 'tel:03001234567');
    expect(screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/923001234567\?text=/);
    fireEvent.click(screen.getByRole('button', { name: /Block this customer/ }));
    expect(prompt).toHaveBeenCalled();
    expect(getBlockedCustomers().some(c => /1234567/.test(c.phone) && c.reason === 'Repeat fake orders')).toBe(true);
    if (had) Object.defineProperty(window, 'prompt', had); else delete (window as any).prompt;
  });

  it('no phone on the order: the menu says so instead of offering a call', async () => {
    await mount();
    fireEvent.click(within(cardOf(219)).getByRole('button', { name: /More for order 219/ }));
    expect(await screen.findByText(/No phone number on this order/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Call customer/ })).toBeNull();
  });

  it('nothing waiting: it says so', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!);
    data.orders = [];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(document.querySelector('[data-ap-empty]')!.textContent).toBe('Nothing is waiting for approval.');
    expect(document.querySelector('[data-ap-subtitle]')!.textContent).toBe('0 orders · auto-refreshing');
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/online-approval'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: a tab per source, the Approve & Send button', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-ap-board]')).toBeNull();
    expect(screen.getByRole('tab', { name: /Takeaway QR/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Approve & Send/ }).length).toBeGreaterThan(0);
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-approval.css');
    expect(read('src/styles.css')).toContain('ui-refined-approval.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
