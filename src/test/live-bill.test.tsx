// ============================================================
// LIVE BILL ON THE CUSTOMER DISPLAY — customer-facing only.
//
// What is pinned:
//   • only an allow-list of fields can reach the customer's screen: item names,
//     quantities, amounts and the totals — never a cashier, waiter, rider, table
//     note, kitchen instruction, phone, address or payment account;
//   • a malformed, stale or future-dated bill reads as "no bill";
//   • publishing writes one key (and clears it), and an unchanged bill is not re-sent;
//   • another window hears it through the `storage` event;
//   • the panel shows items and totals per the Display settings, and the words the
//     receipt uses for discount and service charge;
//   • it only runs when Settings → Display → "Enable Display Screen" is on.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LIVE_BILL_KEY, LIVE_BILL_MAX_AGE_MS, __resetLiveBillForTests, parseLiveBill, publishLiveBill, subscribeLiveBill, toLiveBill, type LiveBill,
} from '@/lib/liveBill';
import LiveBillPanel from '@/components/LiveBillPanel';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const NOW = 1_800_000_000_000;

const source = (over: any = {}) => ({
  orderType: 'takeaway',
  lines: [
    { name: 'Zinger Burger', variantName: 'Large', quantity: 2, lineTotal: 1100, note: 'no onion — tell Ali in the kitchen', price: 550, printedQty: 1, station: 'Grill' },
    { name: 'Cola', quantity: 1, lineTotal: 120 },
  ],
  subtotal: 1220, discount: 122, discountLabel: 'Discount 10%', serviceCharge: 110, serviceChargeLabel: 'Service Charge (10%)',
  tax: 0, delivery: 0, total: 1208, received: 1500,
  // Things that exist on an order and must never travel:
  cashierName: 'Ali', waiterName: 'Bilal', riderName: 'Kamran', customer: { phone: '0300-1234567', address: 'House 5' },
  paymentAccountName: 'Meezan 0123', notes: 'VIP', tableName: 'T4',
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  __resetLiveBillForTests();
});

describe('what the customer screen is given', () => {
  it('only names, quantities, amounts and totals', () => {
    const bill = toLiveBill(source() as any, NOW)!;
    expect(bill).toEqual({
      v: 1, at: NOW, orderType: 'takeaway',
      lines: [{ name: 'Zinger Burger (Large)', qty: 2, amount: 1100 }, { name: 'Cola', qty: 1, amount: 120 }],
      itemCount: 3, subtotal: 1220,
      discount: 122, discountLabel: 'Discount 10%',
      serviceCharge: 110, serviceChargeLabel: 'Service Charge (10%)',
      tax: 0, delivery: 0, total: 1208, received: 1500, change: 292,
    });
    const json = JSON.stringify(bill);
    for (const secret of ['Ali', 'Bilal', 'Kamran', '0300', 'House 5', 'Meezan', 'VIP', 'T4', 'kitchen', 'Grill', 'onion']) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it('an empty cart is no bill at all', () => {
    expect(toLiveBill(source({ lines: [] }) as any)).toBeNull();
    expect(toLiveBill(source({ lines: [{ name: 'Zero', quantity: 0, lineTotal: 0 }] }) as any)).toBeNull();
  });

  it('labels appear only with an amount, and change only once cash was typed', () => {
    const b = toLiveBill(source({ discount: 0, serviceCharge: 0, received: 0 }) as any)!;
    expect(b.discountLabel).toBeUndefined();
    expect(b.serviceChargeLabel).toBeUndefined();
    expect(b.received).toBeUndefined();
    expect(b.change).toBeUndefined();
  });

  it('tidies names and caps a runaway cart', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ name: `Item\u0007 ${i}`, quantity: 1, lineTotal: 10 }));
    const b = toLiveBill(source({ lines: many }) as any)!;
    expect(b.lines).toHaveLength(80);
    expect(b.lines[0].name).toBe('Item  0');
    expect(toLiveBill(source({ lines: [{ name: 'x'.repeat(500), quantity: 1, lineTotal: 1 }] }) as any)!.lines[0].name).toHaveLength(60);
  });

  it('an unknown order type is shown as no type', () => {
    expect(toLiveBill(source({ orderType: 'foodpanda' }) as any)!.orderType).toBe('other');
  });
});

describe('reading a published bill', () => {
  it('round-trips', () => {
    const b = toLiveBill(source() as any, NOW)!;
    expect(parseLiveBill(JSON.stringify(b), NOW + 1000)).toEqual(b);
  });
  it('ignores stale, future-dated and malformed bills', () => {
    const b = toLiveBill(source() as any, NOW)!;
    expect(parseLiveBill(JSON.stringify(b), NOW + LIVE_BILL_MAX_AGE_MS + 1)).toBeNull();
    expect(parseLiveBill(JSON.stringify({ ...b, at: NOW + 5 * 60_000 }), NOW)).toBeNull();
    for (const bad of ['', 'nope', '{}', '{"v":2}', JSON.stringify({ ...b, lines: [] }), JSON.stringify({ ...b, at: 'x' })]) {
      expect(parseLiveBill(bad, NOW), bad).toBeNull();
    }
  });
  it('re-applies the allow-list, so a tampered bill cannot carry anything extra', () => {
    const tampered = { ...toLiveBill(source() as any, NOW)!, cashierName: 'Ali', lines: [{ name: 'Cola', qty: 1, amount: 120, phone: '0300' }] };
    const back = parseLiveBill(JSON.stringify(tampered), NOW)!;
    expect(JSON.stringify(back)).not.toMatch(/Ali|0300|phone|cashier/);
    expect(back.lines).toEqual([{ name: 'Cola', qty: 1, amount: 120 }]);
  });
});

describe('publishing', () => {
  it('writes one key, and clears it', () => {
    const b = toLiveBill(source() as any)!;
    publishLiveBill(b);
    expect(parseLiveBill(localStorage.getItem(LIVE_BILL_KEY))).toMatchObject({ total: 1208 });
    publishLiveBill(null);
    expect(localStorage.getItem(LIVE_BILL_KEY)).toBeNull();
  });
  it('does not re-send an unchanged bill', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem'); // happy-dom: the method lives on the instance
    publishLiveBill(toLiveBill(source() as any, NOW));
    publishLiveBill(toLiveBill(source() as any, NOW + 5000)); // same bill, later
    expect(spy.mock.calls.filter(c => c[0] === LIVE_BILL_KEY)).toHaveLength(1);
    publishLiveBill(toLiveBill(source({ total: 999 }) as any, NOW + 6000));
    expect(spy.mock.calls.filter(c => c[0] === LIVE_BILL_KEY)).toHaveLength(2);
    spy.mockRestore();
  });
  it('another window hears it', () => {
    const seen: Array<LiveBill | null> = [];
    const stop = subscribeLiveBill(b => seen.push(b));
    expect(seen).toEqual([null]); // nothing yet
    const b = toLiveBill(source() as any)!;
    localStorage.setItem(LIVE_BILL_KEY, JSON.stringify(b));
    window.dispatchEvent(new StorageEvent('storage', { key: LIVE_BILL_KEY, newValue: JSON.stringify(b) }));
    expect(seen.at(-1)).toMatchObject({ total: 1208 });
    localStorage.removeItem(LIVE_BILL_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: LIVE_BILL_KEY, newValue: null }));
    expect(seen.at(-1)).toBeNull();
    stop();
  });
});

describe('the panel on the Customer Display', () => {
  const bill = toLiveBill(source() as any)!;
  const t = { typeScale: 1 };

  it('shows each item and the totals in the receipt’s words', () => {
    render(<LiveBillPanel bill={bill} showItems showTotal currency="Rs" template={t} />);
    const panel = screen.getByTestId('live-bill');
    expect(panel.textContent).toMatch(/Your order/);
    expect(panel.textContent).toMatch(/Takeaway · 3 items/);
    expect(screen.getByTestId('live-bill-lines').textContent).toMatch(/2 ×Zinger Burger \(Large\)1,100/);
    expect(panel.textContent).toMatch(/Discount 10%-122/);
    expect(panel.textContent).toMatch(/Service Charge \(10%\)110/);
    expect(screen.getByTestId('live-bill-total').textContent).toMatch(/TOTAL\s*Rs 1,208/);
    expect(panel.textContent).toMatch(/Paid 1,500.*Change 292/);
    expect(panel.textContent).not.toMatch(/Tax|Delivery/); // zero lines are left out
  });

  it('follows “Show Live Order Items” and “Show Total Amount”', () => {
    const { rerender } = render(<LiveBillPanel bill={bill} showItems={false} showTotal currency="Rs" template={t} />);
    expect(screen.queryByTestId('live-bill-lines')).toBeNull();
    expect(screen.getByTestId('live-bill-total')).toBeTruthy();
    rerender(<LiveBillPanel bill={bill} showItems showTotal={false} currency="Rs" template={t} />);
    expect(screen.getByTestId('live-bill-lines')).toBeTruthy();
    expect(screen.queryByTestId('live-bill-total')).toBeNull();
  });
});

describe('it is switched on and wired where it should be', () => {
  it('the POS publishes only with “Enable Display Screen” on, and clears on leaving', () => {
    const pos = read('pages/POSScreen.tsx');
    expect(pos).toMatch(/const liveBillOn = !!settings\.displayEnabled && !isOrderTaker;/);
    expect(pos).toMatch(/useEffect\(\(\) => \(\) => publishLiveBill\(null\), \[\]\)/);
    expect(pos).toMatch(/if \(!liveBillOn\) publishLiveBill\(null\)/);
  });
  it('the Customer Display shows it only with the setting on, and uses the two display switches', () => {
    const cd = read('pages/CustomerDisplayPage.tsx');
    expect(cd).toMatch(/const showBill = !!liveBill && !!settings\.displayEnabled;/);
    expect(cd).toMatch(/showItems=\{settings\.displayShowItems !== false\}/);
    expect(cd).toMatch(/showTotal=\{settings\.displayShowTotal !== false\}/);
  });
  it('the Kitchen Display never shows prices or customer contact details', () => {
    for (const f of ['pages/KitchenDisplayPage.tsx', 'pages/KdsTvPage.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/grandTotal|lineTotal|paymentMethod|customer\??\.phone/);
    }
  });
});
