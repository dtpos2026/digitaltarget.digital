// v1.117.2 — cake orders: taken with an advance, baked for a date, handed over when the balance is paid. Every payment goes to Accounts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { addPayment, balanceOf, canMove, cancelOrder, draftIssues, dueState, nextNumber, paidOf, slipDoc, sortOrders, suggestedAdvance, summarize, type CakeOrder } from '@/lib/cakeOrders';
import { localDay } from '@/lib/productionPlan';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return localDay(d); };

const order = (extra: Partial<CakeOrder> = {}): CakeOrder => ({
  id: 'c1', number: 'CK-0001', createdAt: '2026-11-10T10:00:00Z', customerName: 'Sana', phone: '0300-1', description: '2 lb chocolate, rose topping', quantity: 1,
  dueDate: '2026-11-20', handover: 'pickup', total: 4000, payments: [], status: 'new', updatedAt: '2026-11-10T10:00:00Z', ...extra,
});
const pay = (o: CakeOrder, amount: number, id = 'p1') => { const r = addPayment(o, { id, amount, method: 'cash', at: '2026-11-11T10:00:00Z' }); if (!r.ok) throw new Error(r.reason); return r.order; };

describe('money on an order', () => {
  it('advance first, then the balance; what is owed follows', () => {
    const a = pay(order(), 1500);
    expect(a.payments[0].kind).toBe('advance');
    expect(balanceOf(a)).toBe(2500);
    const b = pay(a, 2500, 'p2');
    expect(b.payments[1].kind).toBe('balance');
    expect(paidOf(b)).toBe(4000);
    expect(balanceOf(b)).toBe(0);
  });
  it('refuses a payment of nothing, more than the balance, or on a closed order', () => {
    expect(addPayment(order(), { id: 'x', amount: 0, method: 'cash', at: 'a' })).toEqual({ ok: false, reason: 'Enter an amount' });
    expect(addPayment(order(), { id: 'x', amount: 5000, method: 'cash', at: 'a' })).toEqual({ ok: false, reason: 'The balance is only 4000' });
    expect(addPayment(order({ status: 'delivered' }), { id: 'x', amount: 1, method: 'cash', at: 'a' })).toEqual({ ok: false, reason: 'This order is closed' });
  });
  it('a hand-over needs the balance paid first; the steps go one way', () => {
    const ready = order({ status: 'ready', payments: pay(order(), 1000).payments });
    expect(canMove(ready, 'delivered')).toEqual({ ok: false, reason: 'Collect the balance of 3000 first' });
    expect(canMove({ ...ready, payments: pay(order(), 4000).payments }, 'delivered').ok).toBe(true);
    expect(canMove(order(), 'delivered').ok).toBe(false);                       // not before it is ready
    expect(canMove(order({ status: 'delivered' }), 'baking').ok).toBe(false);
    expect(canMove(order(), 'ready').ok).toBe(true);                           // a small order can skip "baking"
  });
  it('cancelling can give the advance back (a refund line) or keep it', () => {
    const paid = pay(order(), 1500);
    const r = cancelOrder(paid, true, 'now', 'Ayesha', 'rf1');
    expect(r.ok && r.order.status).toBe('cancelled');
    expect(r.ok && r.refund).toMatchObject({ kind: 'refund', amount: 1500 });
    expect(r.ok && paidOf(r.order)).toBe(0);
    expect(r.ok && balanceOf(r.order)).toBe(0);                                // a cancelled order owes nothing
    const kept = cancelOrder(paid, false, 'now', 'Ayesha', 'rf2');
    expect(kept.ok && paidOf(kept.order)).toBe(1500);
    expect(cancelOrder(order({ status: 'delivered' }), true, 'n', 'a', 'x').ok).toBe(false);
  });
  it('numbers count up from the highest, and half the total is the usual advance', () => {
    expect(nextNumber([])).toBe('CK-0001');
    expect(nextNumber([{ number: 'CK-0007' }, { number: 'CK-0003' }, { number: 'x' }])).toBe('CK-0008');
    expect([suggestedAdvance(4000), suggestedAdvance(3700), suggestedAdvance(0)]).toEqual([2000, 1900, 0]);
  });
});

describe('a new order must say enough', () => {
  const ok = { customerName: 'Sana', phone: '0300-1', description: 'Black forest', quantity: 1, dueDate: '2026-11-25', handover: 'pickup' as const, total: 3000, advance: 1000 };
  it('a complete one has no issues', () => expect(draftIssues(ok, '2026-11-18')).toEqual([]));
  it('names what is missing', () => {
    expect(draftIssues({ ...ok, customerName: ' ' }, 't').join()).toContain('customer’s name');
    expect(draftIssues({ ...ok, phone: '' }, 't').join()).toContain('phone');
    expect(draftIssues({ ...ok, description: '' }, 't').join()).toContain('Describe the cake');
    expect(draftIssues({ ...ok, dueDate: '2026-11-10' }, '2026-11-18').join()).toContain('already past');
    expect(draftIssues({ ...ok, total: 0 }, 't').join()).toContain('total price');
    expect(draftIssues({ ...ok, advance: 5000 }, 't').join()).toContain('more than the total');
    expect(draftIssues({ ...ok, handover: 'delivery' }, 't').join()).toContain('address');
  });
});

describe('the list', () => {
  it('open orders by the day and time they are needed, then the closed ones newest first', () => {
    const l = sortOrders([order({ id: 'late', dueDate: '2026-11-30' }), order({ id: 'done', status: 'delivered', createdAt: '2026-11-12' }), order({ id: 'soon', dueDate: '2026-11-19', dueTime: '10:00' }), order({ id: 'soon2', dueDate: '2026-11-19', dueTime: '09:00' }), order({ id: 'old', status: 'cancelled', createdAt: '2026-11-01' })]);
    expect(l.map(o => o.id)).toEqual(['soon2', 'soon', 'late', 'done', 'old']);
  });
  it('overdue, today, tomorrow; closed orders are never due', () => {
    expect(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-25'].map(d => dueState(order({ dueDate: d }), '2026-11-18'))).toEqual(['overdue', 'today', 'tomorrow', 'later']);
    expect(dueState(order({ status: 'delivered', dueDate: '2026-11-01' }), '2026-11-18')).toBe('done');
  });
  it('the summary: how many are open, due today, overdue, what is still to collect and what is held', () => {
    const s = summarize([order({ id: 'a', dueDate: '2026-11-18', payments: pay(order(), 1000).payments }), order({ id: 'b', dueDate: '2026-11-10' }), order({ id: 'c', status: 'delivered', payments: pay(order(), 4000).payments })], '2026-11-18');
    expect(s).toEqual({ open: 2, dueToday: 1, overdue: 1, balanceOwed: 7000, advanceHeld: 1000 });
  });
  it('the slip carries what the baker and the customer need, and the balance', () => {
    const d = slipDoc(order({ message: 'Happy Birthday Ali', weightKg: 1, payments: pay(order(), 1500).payments }), n => `Rs ${n}`);
    const text = JSON.stringify(d.rows);
    for (const w of ['Sana', 'Happy Birthday Ali', '1 kg', 'Rs 4000', 'Rs 1500', 'Rs 2500']) expect(text).toContain(w);
    expect(d.title).toBe('Cake order CK-0001');
  });
});

// ---------------------------------------------------------------- through the real store
const STORE_KEY = 'desi-pos-data';
const seed = () => {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ', costTrackingEnabled: true },
    users: [{ id: 'u-admin', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    branches: [], accountCategories: [], transactions: [], cakeOrders: [],
    inventory: [{ id: 'fl', name: 'Flour', sku: 'fl', categoryId: 'c', unit: 'kg', baseUnit: 'kg', quantity: 10, costPrice: 100, avgCostPrice: 100, salePrice: 0, lowStockThreshold: 0, isActive: true }], stockLogs: [],
    menuItems: [{ id: 'm1', name: 'Chocolate cake 2 lb', categoryId: 'c', price: 4000, pricingType: 'fixed', isActive: true }],
    recipes: [{ id: 'm1', menuItemId: 'm1', components: [{ inventoryItemId: 'fl', quantity: 800, unit: 'g' }] }],
    categories: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};

describe('through the real store', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });

  it('each payment is posted to Accounts as income "Cake orders", once, and carries its transaction id', async () => {
    const s = await import('@/lib/store');
    s.saveCakeOrder(order({ menuItemId: 'm1', itemName: 'Chocolate cake 2 lb' }));
    const a = s.recordCakePayment('c1', { amount: 2000, method: 'cash', by: 'Ayesha' });
    expect(a.ok).toBe(true);
    const t = s.getTransactions();
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ type: 'income', categoryName: 'Cake orders', amount: 2000, reference: 'CK-0001', partyName: 'Sana' });
    expect(s.getCakeOrders()[0].payments[0].txnId).toBe(t[0].id);
    expect(s.recordCakePayment('c1', { amount: 9999, method: 'cash' })).toEqual({ ok: false, reason: 'The balance is only 2000' });
    expect(s.getTransactions()).toHaveLength(1);                                  // a refused payment posts nothing
    expect(s.getAccountCategories().filter(c => c.name === 'Cake orders')).toHaveLength(1);
    s.recordCakePayment('c1', { amount: 500, method: 'card' });
    expect(s.getAccountCategories().filter(c => c.name === 'Cake orders')).toHaveLength(1);   // the category is reused
  });

  it('baking takes the recipe from stock once and books the ingredient cost; hand-over is refused until the balance is paid', async () => {
    const s = await import('@/lib/store');
    s.saveCakeOrder(order({ menuItemId: 'm1', itemName: 'Chocolate cake 2 lb', quantity: 2 }));
    expect(s.moveCake('c1', 'baking', 'Baker').ok).toBe(true);
    expect(s.getInventory()[0].quantity).toBeCloseTo(8.4, 6);                      // 2 cakes × 0.8 kg
    const cost = s.getTransactions().find(t => t.categoryName === 'Cake ingredients')!;
    expect(cost).toMatchObject({ type: 'expense', amount: 160 });                  // 1.6 kg × 100
    expect(s.getCakeOrders()[0]).toMatchObject({ stockPosted: true, ingredientCost: 160 });
    expect(s.moveCake('c1', 'ready').ok).toBe(true);
    expect(s.getInventory()[0].quantity).toBeCloseTo(8.4, 6);                      // not taken twice
    expect(s.moveCake('c1', 'delivered')).toEqual({ ok: false, reason: 'Collect the balance of 4000 first' });
    s.recordCakePayment('c1', { amount: 4000, method: 'cash' });
    expect(s.moveCake('c1', 'delivered').ok).toBe(true);
    expect(s.getCakeOrders()[0].status).toBe('delivered');
  });

  it('a fully custom cake (no menu item) moves stock nowhere; cancelling with a refund books an expense', async () => {
    const s = await import('@/lib/store');
    s.saveCakeOrder(order());
    s.recordCakePayment('c1', { amount: 1500, method: 'cash' });
    s.moveCake('c1', 'baking');
    expect(s.getInventory()[0].quantity).toBe(10);
    const r = s.cancelCake('c1', true, 'Ayesha');
    expect(r.ok).toBe(true);
    const refund = s.getTransactions().find(t => t.categoryName === 'Cake order refunds')!;
    expect(refund).toMatchObject({ type: 'expense', amount: 1500 });
    expect(s.getCakeOrders()[0]).toMatchObject({ status: 'cancelled' });
    expect(s.cancelCake('c1', true).ok).toBe(false);                               // already closed
  });
});

describe('the Cake Orders screen', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });

  it('a new order is taken with an advance: it appears, the balance is right, the payment is in Accounts', async () => {
    const { default: Page } = await import('@/pages/CakeOrdersPage');
    const s = await import('@/lib/store');
    render(<Page />);
    expect(document.querySelector('[data-cake-save]') as HTMLButtonElement).toBeNull();
    fireEvent.click(document.querySelector('[data-cake-new]')!);
    expect((document.querySelector('[data-cake-save]') as HTMLButtonElement).disabled).toBe(true);
    const set = (sel: string, value: string) => fireEvent.change(document.querySelector(sel)!, { target: { value } });
    set('[data-cake-customer]', 'Sana'); set('[data-cake-phone]', '0300-1'); set('[data-cake-description]', 'Black forest 2 lb');
    set('[data-cake-date]', day(5)); set('[data-cake-total-input]', '3000'); set('[data-cake-advance]', '1000');
    expect(document.querySelector('[data-cake-balance-preview]')!.textContent).toContain('2,000');
    fireEvent.click(document.querySelector('[data-cake-save]')!);
    const o = s.getCakeOrders();
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ number: 'CK-0001', customerName: 'Sana', total: 3000, status: 'new' });
    expect(o[0].payments[0]).toMatchObject({ kind: 'advance', amount: 1000 });
    expect(s.getTransactions()[0]).toMatchObject({ categoryName: 'Cake orders', amount: 1000 });
    expect(document.querySelector(`[data-cake-row="${o[0].id}"]`)).not.toBeNull();
  });

  it('the panel takes the balance, moves the order along, and will not hand over while it is owed', async () => {
    const s = await import('@/lib/store');
    s.saveCakeOrder(order({ status: 'ready', dueDate: day(0) }));
    const { default: Page } = await import('@/pages/CakeOrdersPage');
    render(<Page />);
    expect(document.querySelector('[data-cake-today]')!.textContent).toContain('1 due today');
    fireEvent.click(document.querySelector('[data-cake-row="c1"]')!);
    expect(document.querySelector('[data-cake-balance]')!.textContent).toContain('4,000');
    expect(document.querySelector('[data-cake-owes]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-cake-move="delivered"]')!);
    expect(s.getCakeOrders()[0].status).toBe('ready');                              // refused
    fireEvent.click(document.querySelector('[data-cake-pay-full]')!);
    fireEvent.click(document.querySelector('[data-cake-pay-save]')!);
    expect(s.getCakeOrders()[0].payments).toHaveLength(1);
    fireEvent.click(document.querySelector('[data-cake-move="delivered"]')!);
    expect(s.getCakeOrders()[0].status).toBe('delivered');
    expect(document.querySelector('[data-cake-row="c1"]')).toBeNull();               // the default list shows open orders only
  });

  it('cancelling asks whether to refund the advance', async () => {
    const s = await import('@/lib/store');
    s.saveCakeOrder(order());
    s.recordCakePayment('c1', { amount: 1500, method: 'cash' });
    const { default: Page } = await import('@/pages/CakeOrdersPage');
    render(<Page />);
    fireEvent.click(document.querySelector('[data-cake-row="c1"]')!);
    fireEvent.click(document.querySelector('[data-cake-cancel]')!);
    expect(s.getCakeOrders()[0].status).toBe('new');                                // it asked first
    expect(document.querySelector('[data-cake-refund]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-cake-cancel-confirm]')!);
    expect(s.getCakeOrders()[0].status).toBe('cancelled');
    expect(s.getTransactions().some(t => t.categoryName === 'Cake order refunds')).toBe(true);
  });

  it('is a page of the Operations group with its own cancel right, and a synced document collection', () => {
    expect(read('src/lib/permissions.ts')).toContain("key: 'cake-orders', path: '/cake-orders'");
    expect(read('src/lib/permissions.ts')).toContain("'feat.cake.cancel'");
    expect(read('src/App.tsx')).toContain('path="/cake-orders"');
    expect(read('src/lib/supabaseStore.ts')).toContain("'cakeOrders'");
    expect(read('src/pages/CakeOrdersPage.tsx')).toContain('MasterDetail');
  });
});
