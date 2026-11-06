// ============================================================
// v1.92.0 — DT Order Taker, the inner screens that were still the cashier's: the Bills tab (OTK-08, OTK-09), the look
// over an order before it goes to the kitchen (OTK-07), the item-options sheet (OTK-05), and the theme of every dialog.
//
// What is pinned:
//   • the rules (lib/orderTakerBills.ts): which bills are open and their state, which lines the kitchen has, the age,
//     the cashier's number;
//   • the Bills tab through the real store: an order taker's own bills only, a bill opened in full with what is not yet
//     sent, Add items opens the bill in the POS (the same retrieve link as before), Call the cashier, search, empty;
//   • the review sheet: lines with steppers, a by-weight line without one, Send disabled when empty;
//   • the POS wiring: an order taker's Send buttons open the review; a cashier's are exactly what they were;
//   • the app's theme reaches dialogs (portalled outside the app) — set on <html> while the app is open, removed after.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import type { CartItem, Order } from '@/lib/types';
import { ageText, billLines, billState, cashierPhone, openBills } from '@/lib/orderTakerBills';
import OrderTakerReview from '@/components/pos/OrderTakerReview';

vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: async () => {} }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const NOW = new Date(2026, 10, 4, 15, 30, 0);
const T = NOW.getTime();
const ago = (m: number) => new Date(T - m * 60000).toISOString();
const line = (id: string, name: string, qty: number, extra: object = {}) => ({ id, menuItemId: id, name, price: 500, quantity: qty, lineTotal: 500 * qty, note: '', pricingType: 'fixed', ...extra });
const order = (o: Partial<Order>): Order => ({
  id: 'o', orderNumber: 1, orderType: 'dining', status: 'running', paymentMethod: 'cash', items: [line('a', 'Zinger', 2)] as any, subtotal: 1000,
  discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 1000, createdAt: ago(5), notes: '', ...o,
} as Order);

// ------------------------------------------------------------------ rules
describe('open bills', () => {
  it('only open bills, longest-open first, with the kitchen\'s state in words', () => {
    const rows = openBills([
      order({ id: 'a', orderNumber: 11, tableName: 'T-03', createdAt: ago(28), kitchenStatus: 'preparing', kotPrinted: true }),
      order({ id: 'b', orderNumber: 12, tableName: 'T-05', createdAt: ago(12), kitchenStatus: 'ready' }),
      order({ id: 'c', orderNumber: 13, orderType: 'takeaway', createdAt: ago(3) }),
      order({ id: 'd', orderNumber: 14, status: 'pending_approval', orderType: 'delivery', createdAt: ago(8) }),
      order({ id: 'e', orderNumber: 15, status: 'paid' }),
      order({ id: 'f', orderNumber: 16, status: 'void' }),
    ], '', T);
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(rows.map(r => r.stateLabel)).toEqual(['Cooking', 'Ready', 'Waiting for approval', 'Not sent yet']);
    expect(rows[0]).toMatchObject({ label: 'Table T-03', items: 2, age: 28, total: 1000 });
    expect(billState(order({ kotPrinted: true, items: [line('a', 'Zinger', 2, { printedQty: 2 })] as any })).label).toBe('Sent to kitchen');
    // found in the browser check: a bill sent once and added to since must not read "Sent to kitchen"
    expect(billState(order({ kotPrinted: true, items: [line('a', 'Zinger', 2, { printedQty: 2 }), line('b', 'Fries', 1, { printedQty: 0 })] as any })).label).toBe('Update not sent');
    expect(billState(order({ status: 'hold' })).state).toBe('hold');
  });

  it('search by table, number or customer', () => {
    const list = [order({ id: 'a', orderNumber: 1041, tableName: 'T-03' }), order({ id: 'b', orderNumber: 1042, orderType: 'takeaway', customer: { id: 'c', name: 'Sara Khan' } as any })];
    expect(openBills(list, 't-03', T).map(r => r.id)).toEqual(['a']);
    expect(openBills(list, '1042', T).map(r => r.id)).toEqual(['b']);
    expect(openBills(list, 'sara', T).map(r => r.id)).toEqual(['b']);
    expect(openBills(list, 'zzz', T)).toEqual([]);
  });

  it('lines show whether the kitchen has them; the age and the cashier\'s number', () => {
    const l = billLines(order({ items: [line('a', 'Pizza', 1, { printedQty: 1, variantName: 'Large', note: ' extra cheese ' }), line('b', 'Fries', 2, { printedQty: 1 }), line('c', 'Gone', 0)] as any }));
    expect(l.map(x => [x.text, x.sent, x.note])).toEqual([['1 × Pizza (Large)', true, 'extra cheese'], ['2 × Fries', false, undefined]]);
    expect([ageText(0), ageText(12), ageText(60), ageText(125)]).toEqual(['just now', '12 min', '1 h', '2 h 5 min']);
    expect(cashierPhone({ phone1: '042-3576 1234' })).toBe('04235761234');
    expect(cashierPhone({ phone1: '', phone2: '+92 300 1112233' })).toBe('+923001112233');
    expect(cashierPhone({})).toBeNull();
    expect(cashierPhone({ phone1: '12' })).toBeNull();
  });
});

// ------------------------------------------------------------------ the Bills tab, through the real store
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seed(orders: Order[], settings: object = { phone1: '042-35761234' }) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', ...settings },
    users: [{ id: 'ot1', name: 'Ali Hassan', username: 'ali', password: 'x', role: 'order_taker', isActive: true }],
    orders, categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 100,
  }));
  localStorage.setItem('pos-user-id', 'ot1');
  localStorage.setItem('pos-user-role', 'order_taker');
  localStorage.setItem('pos-user-name', 'Ali Hassan');
  reload();
}
// an order belongs to the user who created it (lib/cashierScope.orderBelongsTo: cashierId / createdBy)
const mine = (o: Partial<Order>) => order({ cashierId: 'ot1', cashierName: 'Ali Hassan', ...o });
async function mountBills() {
  const { default: OrderTakerBills } = await import('@/components/OrderTakerBills');
  window.location.hash = '#/order-taker/t/bills';
  return render(<HashRouter><OrderTakerBills /></HashRouter>);
}

describe('the Bills tab', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
  afterEach(() => { vi.useRealTimers(); });

  it('an order taker sees their own open bills, and opens one in full', async () => {
    seed([
      mine({ id: 'a', orderNumber: 1041, tableName: 'T-03', createdAt: ago(20), kitchenStatus: 'preparing', kotPrinted: true,
        items: [line('p', 'Chicken Tikka Pizza', 1, { printedQty: 1, variantName: 'Large', note: 'Extra cheese' }), line('f', 'Loaded Fries', 2, { printedQty: 0 })] as any, grandTotal: 1500 }),
      mine({ id: 'b', orderNumber: 1042, tableName: 'T-05', createdAt: ago(5) }),
      order({ id: 'other', orderNumber: 1043, tableName: 'T-07', cashierId: 'someone-else' }),
      mine({ id: 'paid', orderNumber: 1044, status: 'paid' }),
    ]);
    await mountBills();
    const list = await screen.findByText('Table T-03 · #1041');
    expect(list).toBeInTheDocument();
    const rows = document.querySelectorAll('[data-otk-bill]');
    expect([...rows].map(r => (r as HTMLElement).dataset.otkBill)).toEqual(['a', 'b']);   // not the other waiter's, not the paid one

    fireEvent.click(rows[0]);
    const sheet = screen.getByRole('dialog', { name: 'Bill #1041' });
    expect(sheet).toHaveTextContent('Cooking');
    expect(sheet).toHaveTextContent('1 × Chicken Tikka Pizza (Large)');
    expect(sheet).toHaveTextContent('Extra cheese');
    expect(within(sheet).getByText(/1 item is not sent to the kitchen yet/)).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: /Call the cashier/ })).toHaveAttribute('href', 'tel:04235761234');
    // payment, discount and void are not offered here
    expect(within(sheet).queryByRole('button', { name: /pay|void|discount/i })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: /Add items/ }));
    // v1.111.0: "Add items" stays inside the Order Taker app (it used to open the till's root route and so the full software)
    expect(window.location.hash).toBe('#/order-taker/t?retrieve=a');
  });

  it('search, and the empty and no-number states', async () => {
    seed([mine({ id: 'a', orderNumber: 1041, tableName: 'T-03' })], {});
    await mountBills();
    await screen.findByText('Table T-03 · #1041');
    fireEvent.change(screen.getByLabelText('Search bills'), { target: { value: 'nothing here' } });
    expect(await screen.findByText('No bill matches')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search bills'), { target: { value: '' } });
    fireEvent.click(await screen.findByText('Table T-03 · #1041'));
    expect(screen.getByRole('button', { name: /No cashier number set/ })).toBeDisabled();
  });

  it('no open bills: one sentence and one action', async () => {
    seed([]);
    await mountBills();
    expect(await screen.findByText('No open bills')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take an order' })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ the review sheet
describe('review and send', () => {
  const lines = [
    line('a', 'Chicken Tikka Pizza', 1, { variantName: 'Large', note: 'Extra cheese' }),
    line('b', 'Zinger Burger', 2),
    line('w', 'Chicken (by weight)', 1, { pricingType: 'weight', weightGrams: 1500 }),
  ] as unknown as CartItem[];
  it('lines with steppers, a by-weight line without, the total, and Send', () => {
    const calls: string[] = [];
    render(<OrderTakerReview open onClose={() => calls.push('close')} lines={lines} where="Table T-07" total={3350} onQty={(id, d) => calls.push(`${id}${d > 0 ? '+' : '-'}`)} onSend={() => calls.push('send')} />);
    const sheet = screen.getByRole('dialog', { name: 'Review and send' });
    expect(sheet).toHaveTextContent('Table T-07');
    expect(sheet).toHaveTextContent('Chicken Tikka Pizza (Large)');
    expect(sheet).toHaveTextContent('Extra cheese');
    expect(screen.getByRole('button', { name: 'Fewer Chicken Tikka Pizza' })).toBeDisabled();       // one portion: minus would remove it
    fireEvent.click(screen.getByRole('button', { name: 'More Zinger Burger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fewer Zinger Burger' }));
    expect(screen.getByRole('button', { name: 'More Chicken Tikka Pizza' })).toBeEnabled();
    expect(document.querySelector('[data-otk-weight-line]')).toHaveTextContent('1.5 kg');
    expect(screen.queryByRole('button', { name: /Chicken \(by weight\)/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Send to kitchen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the order' }));
    expect(calls).toEqual(['b+', 'b-', 'send', 'close']);
  });
  it('nothing to send: Send is off', () => {
    render(<OrderTakerReview open onClose={() => {}} lines={[]} where="Takeaway" total={0} onQty={() => {}} onSend={() => {}} />);
    expect(screen.getByRole('button', { name: /Send to kitchen/ })).toBeDisabled();
  });
  it('editing a running order says Update', () => {
    render(<OrderTakerReview open onClose={() => {}} lines={lines} where="Table T-07" total={1} editing onQty={() => {}} onSend={() => {}} />);
    expect(screen.getByRole('button', { name: /Update the kitchen/ })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ wiring
describe('the wiring', () => {
  const pos = read('src/pages/POSScreen.tsx');
  it('an order taker\'s Send buttons open the review; a cashier\'s Running button is what it was', () => {
    expect(pos).toContain("onClick={() => { if (cart.length === 0) { toast.error('Cart is empty'); return; } setReviewOpen(true); }}");
    expect(pos).toContain("onClick={() => { if (isOrderTaker) { if (cart.length === 0) { toast.error('Cart is empty'); return; } setReviewOpen(true); } else processOrder('running'); }}");
    // the review is only ever mounted for an order taker, and Send from it is the old send
    expect(pos).toMatch(/\{isOrderTaker && \(\s*<OrderTakerReview/);
    expect(pos).toContain("onSend={() => { setReviewOpen(false); processOrder('running'); }}");
    // a cashier's PAY and Hold paths were not touched
    expect(pos).toContain('onClick={handleDirectPay}');
    expect(pos).toContain("onClick={() => processOrder('hold')}");
  });
  it('the Bills tab is the order taker\'s own page; the cashier keeps hers', () => {
    const page = read('src/pages/OrderTakerPortalPage.tsx');
    expect(page).toContain("const billsLoader = () => import('@/components/OrderTakerBills');");
    expect(page).toContain('<Route path="/bills" element={<OrderTakerBills />} />');
    expect(page).not.toContain("import('@/pages/RunningBillsPage')");
    expect(read('src/App.tsx')).toContain('RunningBillsPage');   // the till still routes to it
  });
  it('the theme reaches portalled dialogs: tokens on <html> while the app is open, bottom sheets on a phone', () => {
    const css = read('src/styles/ui-otk.css');
    expect(css).toContain(':is(.dt-otk, :root[data-app="otk"])');
    expect(css).toContain(':root[data-app="otk"][data-otk-theme="dark"]');
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*:root\[data-app="otk"\] \[role="dialog"\]/);
    // Tailwind 4 centres the dialog with `translate`/`scale`, not `transform`: those are what must be switched off
    expect(css).toContain('translate: none !important; scale: none !important;');
    const page = read('src/pages/OrderTakerPortalPage.tsx');
    expect(page).toContain("root.dataset.app = 'otk';");
    expect(page).toContain("delete root.dataset.app; delete root.dataset.otkTheme;");
  });
});
