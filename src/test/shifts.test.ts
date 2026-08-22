// ============================================================
// Tests — v1.11.0 Shifts + Cash drawer + report structure fix
//
// Cash drawer numbers are reconciliation figures a manager acts on
// (accusing staff of a short drawer), so the arithmetic is asserted
// against hand-computed values, including the client's own sample.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  buildCashDrawerReport, formatShiftDuration, cashTakenOnOrder,
  cashRefundedOnOrder, ordersInShift, type Shift,
} from '@/lib/shifts';
import { buildItemSalesReport } from '@/lib/salesReport';
import type { Order, MenuItem, Category } from '@/lib/types';

function shift(over: Partial<Shift> = {}): Shift {
  return {
    id: 's1', deviceId: 'd1', staffName: 'Abdul',
    openedAt: '2026-07-18T15:52:00.000Z',
    closedAt: '2026-07-22T15:47:00.000Z',
    startingCash: 200, payIns: [], payOuts: [],
    status: 'closed',
    ...over,
  } as Shift;
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', orderNumber: 1, orderType: 'dining', status: 'paid',
    items: [], subtotal: 0, discount: 0, tax: 0,
    serviceCharge: 0, serviceChargePercent: 0, grandTotal: 0,
    createdAt: '2026-07-20T10:00:00.000Z',
    ...over,
  } as Order;
}

describe("client's sample: 200 + 40 + 0 − 0 − 0 = 240 expected, 240 actual", () => {
  const s = shift({ actualEndingCash: 240 });
  const orders = [order({ id: 'a', grandTotal: 40, amountPaid: 40, paymentMethod: 'cash' } as any)];

  it('reproduces the sample exactly', () => {
    const d = buildCashDrawerReport(s, orders);
    expect(d.startingCash).toBe(200);
    expect(d.orderIncome).toBe(40);
    expect(d.payIn).toBe(0);
    expect(d.refund).toBe(0);
    expect(d.payOut).toBe(0);
    expect(d.expectedCash).toBe(240);
    expect(d.actualEndingCash).toBe(240);
    expect(d.variance).toBe(0);          // drawer balances
  });

  it('formats the shift duration like the sample ("3 days 23 hours")', () => {
    expect(formatShiftDuration(s.openedAt, s.closedAt)).toBe('3 days 23 hours');
  });
});

describe('cash drawer arithmetic', () => {
  it('pay in increases and pay out decreases the expected cash', () => {
    const s = shift({
      payIns: [{ id: '1', at: '', amount: 100, reason: 'float', by: 'x' }],
      payOuts: [{ id: '2', at: '', amount: 30, reason: 'bank drop', by: 'x' }],
    });
    const d = buildCashDrawerReport(s, []);
    expect(d.payIn).toBe(100);
    expect(d.payOut).toBe(30);
    expect(d.expectedCash).toBe(270);    // 200 + 0 + 100 − 0 − 30
  });

  it('a SHORT drawer produces a negative variance', () => {
    const d = buildCashDrawerReport(shift({ actualEndingCash: 190 }), []);
    expect(d.expectedCash).toBe(200);
    expect(d.variance).toBe(-10);
  });

  it('an OVER drawer produces a positive variance', () => {
    const d = buildCashDrawerReport(shift({ actualEndingCash: 215 }), []);
    expect(d.variance).toBe(15);
  });

  it('variance is undefined while the shift is still open (nothing counted yet)', () => {
    const d = buildCashDrawerReport(shift({ status: 'open', closedAt: undefined, actualEndingCash: undefined }), []);
    expect(d.actualEndingCash).toBeUndefined();
    expect(d.variance).toBeUndefined();
  });
});

describe('only CASH reaches the drawer', () => {
  it('a card sale contributes nothing to order income', () => {
    const o = order({ grandTotal: 500, amountPaid: 500, paymentMethod: 'card' } as any);
    expect(cashTakenOnOrder(o)).toBe(0);
  });

  it('a split bill contributes ONLY its cash portion', () => {
    const o = order({
      grandTotal: 1000,
      payments: [
        { id: 'p1', method: 'cash', amount: 600, at: '' },
        { id: 'p2', method: 'card', amount: 400, at: '' },
      ],
    } as any);
    expect(cashTakenOnOrder(o)).toBe(600);
  });

  it('void and cancelled sales never count as income', () => {
    for (const status of ['void', 'cancelled'] as const) {
      const o = order({ status, grandTotal: 100, amountPaid: 100, paymentMethod: 'cash' } as any);
      expect(cashTakenOnOrder(o)).toBe(0);
    }
  });

  it('a voided cash sale is counted as a refund out of the drawer', () => {
    const o = order({ status: 'void', amountPaid: 100, paymentMethod: 'cash' } as any);
    expect(cashRefundedOnOrder(o)).toBe(100);
    const d = buildCashDrawerReport(shift(), [o]);
    expect(d.refund).toBe(100);
    expect(d.expectedCash).toBe(100);    // 200 − 100
  });

  it('legacy orders with no payments[] fall back to paymentMethod', () => {
    const o = order({ grandTotal: 250, amountPaid: 250, paymentMethod: 'cash' } as any);
    expect(cashTakenOnOrder(o)).toBe(250);
  });
});

describe('shift windowing', () => {
  it('only orders inside the shift window are counted', () => {
    const s = shift();
    const inside = order({ id: 'in', createdAt: '2026-07-20T10:00:00.000Z' });
    const before = order({ id: 'before', createdAt: '2026-07-01T10:00:00.000Z' });
    const after = order({ id: 'after', createdAt: '2026-07-30T10:00:00.000Z' });
    const got = ordersInShift(s, [inside, before, after]).map(o => o.id);
    expect(got).toEqual(['in']);
  });
});

describe('report structure — Sold categories and Sold products are SEPARATE', () => {
  const categories: Category[] = [
    { id: 'c1', name: 'Drinks' } as Category,
    { id: 'c2', name: 'Rice' } as Category,
  ];
  const menuItems: MenuItem[] = [
    { id: 'i1', name: 'Kopi', categoryId: 'c1' } as MenuItem,
    { id: 'i2', name: 'Milo', categoryId: 'c1' } as MenuItem,
    { id: 'i3', name: 'Biryani', categoryId: 'c2' } as MenuItem,
  ];
  const line = (id: string, name: string, price: number, qty: number) => ({
    id, menuItemId: id, name, pricingType: 'fixed', price,
    quantity: qty, lineTotal: price * qty, note: '',
  });
  const orders = [
    order({ id: 'o1', status: 'paid', grandTotal: 30,
      items: [line('i1', 'Kopi', 5, 2), line('i3', 'Biryani', 20, 1)] as any }),
    order({ id: 'o2', status: 'paid', grandTotal: 8,
      items: [line('i2', 'Milo', 4, 2)] as any }),
  ];

  it('categories carry totals only — no nested products', () => {
    const r = buildItemSalesReport(orders, menuItems, categories);
    const drinks = r.categories.find(c => c.name === 'Drinks')!;
    expect(drinks.subQty).toBe(4);          // 2 Kopi + 2 Milo
    expect(drinks.subAmount).toBe(18);      // 10 + 8
  });

  it('soldProducts is a FLAT list across every category', () => {
    const r = buildItemSalesReport(orders, menuItems, categories);
    const names = r.soldProducts.map(p => p.name).sort();
    expect(names).toEqual(['Biryani', 'Kopi', 'Milo']);
  });

  it('both sections total to the SAME figure (the sample shows 24 / 108.60 twice)', () => {
    const r = buildItemSalesReport(orders, menuItems, categories);
    const catQty = r.categories.reduce((s, c) => s + c.subQty, 0);
    const prodQty = r.soldProducts.reduce((s, p) => s + p.qty, 0);
    expect(catQty).toBe(prodQty);
    expect(prodQty).toBe(r.totalQty);

    const catAmt = r.categories.reduce((s, c) => s + c.subAmount, 0);
    const prodAmt = r.soldProducts.reduce((s, p) => s + p.amount, 0);
    expect(catAmt).toBeCloseTo(prodAmt, 2);
    expect(prodAmt).toBeCloseTo(r.totalAmount, 2);
  });

  it('products are ordered by value, highest first', () => {
    const r = buildItemSalesReport(orders, menuItems, categories);
    const amounts = r.soldProducts.map(p => p.amount);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });
});
