// ============================================================
// Tests — v1.8.1 Sales report sections (client sample)
//
// Verifies the new Summary / Tax / Transactions / Payment-percent
// blocks compute correctly from ordinary order fields. Numbers are
// hand-derived so a regression in the money maths fails loudly.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildItemSalesReport } from '@/lib/salesReport';
import type { Order, MenuItem, Category } from '@/lib/types';

const cat = (id: string, name: string): Category => ({ id, name } as Category);
const menu = (id: string, name: string, categoryId: string): MenuItem =>
  ({ id, name, categoryId, pricingType: 'fixed', price: 0, ratePerKg: 0, isActive: true } as MenuItem);

/** Small builder that stamps the fields a real POS bill carries. */
function order(over: Partial<Order> & { paidLine?: { itemId: string; name: string; price: number; qty: number } }): Order {
  const line = over.paidLine ?? { itemId: 'i1', name: 'Item', price: 100, qty: 1 };
  const subtotal = line.price * line.qty;
  const discount = over.discount ?? 0;
  const serviceCharge = over.serviceCharge ?? 0;
  const tax = over.tax ?? 0;
  const grandTotal = over.grandTotal ?? (subtotal - discount + serviceCharge + tax);
  return {
    id: over.id || 'o',
    orderNumber: 1,
    orderType: over.orderType || 'takeaway',
    status: over.status || 'paid',
    items: [{
      id: line.itemId, menuItemId: line.itemId, name: line.name,
      pricingType: 'fixed', price: line.price, quantity: line.qty,
      lineTotal: subtotal, note: '',
    }] as any,
    subtotal,
    discount,
    tax,
    serviceCharge,
    serviceChargePercent: 0,
    grandTotal,
    createdAt: over.createdAt || '2026-07-24T10:00:00.000Z',
    ...over,
  } as Order;
}

const menuItems = [menu('i1', 'Item', 'c1'), menu('i2', 'Ice Cream', 'c2')];
const categories = [cat('c1', 'Food'), cat('c2', 'Desserts')];

describe('Summary section', () => {
  it('aggregates product / discount / SC / tax exactly from order fields', () => {
    const orders = [
      order({ id: 'a', paidLine: { itemId: 'i1', name: 'X', price: 100, qty: 1 }, serviceCharge: 10, tax: 9.9, grandTotal: 119.9 }),
      order({ id: 'b', paidLine: { itemId: 'i1', name: 'X', price: 200, qty: 1 }, discount: 20, serviceCharge: 18, tax: 17.82, grandTotal: 215.82 }),
    ];
    const r = buildItemSalesReport(orders, menuItems, categories);
    expect(r.summary.productAmountExcTax).toBe(300);           // 100 + 200
    expect(r.summary.discount).toBe(20);
    expect(r.summary.serviceCharge).toBe(28);                  // 10 + 18
    expect(r.summary.subTotal).toBe(308);                      // 300 - 20 + 28
    expect(r.tax.actualTax).toBeCloseTo(27.72, 2);
    // Actual sales = subTotal + tax + rounding - refund
    expect(r.summary.actualSales).toBeCloseTo(335.72, 2);
  });

  it('rounding delta is captured when grandTotal != arithmetic parts', () => {
    // Bill priced at 100 but system rounded to a whole 100 (0.72 dropped).
    const o = order({ paidLine: { itemId: 'i1', name: 'X', price: 91, qty: 1 }, tax: 8.19, grandTotal: 100 });
    const r = buildItemSalesReport([o], menuItems, categories);
    expect(r.summary.rounding).toBeCloseTo(0.81, 2);          // 100 - (91 + 8.19)
    expect(r.summary.actualSales).toBeCloseTo(100, 2);
  });

  it('refunds subtract from actual sales without touching the paid summary', () => {
    const paid = order({ id: 'p', paidLine: { itemId: 'i1', name: 'X', price: 500, qty: 1 } });
    const voided = order({ id: 'v', status: 'void', paidLine: { itemId: 'i1', name: 'X', price: 200, qty: 1 } });
    const r = buildItemSalesReport([paid, voided], menuItems, categories);
    expect(r.summary.productAmountExcTax).toBe(500);          // only paid counts as sale
    expect(r.summary.refundAmount).toBe(200);
    expect(r.summary.actualSales).toBe(300);                  // 500 - 200
    expect(r.transactions.refunded).toBe(1);
    expect(r.transactions.refundedProducts).toBe(1);
  });
});

describe('Tax section', () => {
  it('reports the dominant tax rate + total collected', () => {
    const orders = [
      order({ id: 'a', paidLine: { itemId: 'i1', name: 'X', price: 100, qty: 1 }, tax: 9, grandTotal: 109, taxPercent: 9 } as any),
      order({ id: 'b', paidLine: { itemId: 'i1', name: 'X', price: 200, qty: 1 }, tax: 18, grandTotal: 218, taxPercent: 9 } as any),
      order({ id: 'c', paidLine: { itemId: 'i1', name: 'X', price: 300, qty: 1 }, tax: 15, grandTotal: 315, taxPercent: 5 } as any),
    ];
    const r = buildItemSalesReport(orders, menuItems, categories);
    expect(r.tax.taxPercent).toBe(9);                          // 2 orders at 9% vs 1 at 5%
    expect(r.tax.actualTax).toBe(42);                          // 9 + 18 + 15
  });

  it('reports zero rate cleanly when no order carries a stamped percent', () => {
    const r = buildItemSalesReport([order({})], menuItems, categories);
    expect(r.tax.taxPercent).toBe(0);
    expect(r.tax.actualTax).toBe(0);
  });
});

describe('Transactions section', () => {
  it('counts orders, sold products, and computes average income per bill', () => {
    const orders = [
      order({ id: 'a', paidLine: { itemId: 'i1', name: 'X', price: 100, qty: 2 } }),
      order({ id: 'b', paidLine: { itemId: 'i2', name: 'Y', price: 50, qty: 3 } }),
    ];
    const r = buildItemSalesReport(orders, menuItems, categories);
    expect(r.transactions.checkedOutOrders).toBe(2);
    expect(r.transactions.soldProducts).toBe(5);               // 2 + 3
    expect(r.transactions.averageIncomeValue).toBe(175);       // (200 + 150) / 2
  });

  it('average income is 0 (never NaN) when no orders match the range', () => {
    const r = buildItemSalesReport([], menuItems, categories);
    expect(r.transactions.averageIncomeValue).toBe(0);
    expect(Number.isFinite(r.transactions.averageIncomeValue)).toBe(true);
  });
});

describe('Payment Report — with percent column (client sample)', () => {
  it('percent adds up to 100 across every method', () => {
    const cash = order({ id: 'a', paidLine: { itemId: 'i1', name: 'X', price: 700, qty: 1 } });
    (cash as any).payments = [{ id: 'p', method: 'cash', amount: 700, at: cash.createdAt }];
    const card = order({ id: 'b', paidLine: { itemId: 'i1', name: 'X', price: 300, qty: 1 } });
    (card as any).payments = [{ id: 'p', method: 'card', amount: 300, at: card.createdAt }];
    const r = buildItemSalesReport([cash, card], menuItems, categories);
    const totalPct = r.settlementWithPercent.reduce((s, x) => s + x.percent, 0);
    expect(totalPct).toBe(100);
    // 700 / 1000 = 70%, 300 / 1000 = 30%
    const byMethod = new Map(r.settlementWithPercent.map(x => [x.method, x.percent]));
    expect(byMethod.get('CASH')).toBe(70);
    expect(byMethod.get('CARD')).toBe(30);
  });

  it('safely reports 0% when no settlements exist (empty range)', () => {
    const r = buildItemSalesReport([], menuItems, categories);
    expect(r.settlementWithPercent).toHaveLength(0);
    expect(r.settlementTotal.amount).toBe(0);
  });
});
