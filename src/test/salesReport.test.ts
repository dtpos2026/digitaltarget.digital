// ============================================================
// Tests — Item Sales Report engine (v1.6.0, feedback #2 items 1 & 2)
// Owners reconcile CASH against this — every number hand-checked.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildItemSalesReport, presetRange, settlementLabel } from '@/lib/salesReport';
import type { Order, MenuItem, Category } from '@/lib/types';

const categories: Category[] = [
  { id: 'c-food', name: 'LOCAL FOOD' } as Category,
  { id: 'c-drink', name: 'DRINKS' } as Category,
];
const menu: MenuItem[] = [
  { id: 'm-rice', name: 'CHICKEN RICE', categoryId: 'c-food', price: 250 } as MenuItem,
  { id: 'm-tea', name: 'TEH TARIK', categoryId: 'c-drink', price: 120 } as MenuItem,
  { id: 'm-coffee', name: 'KOPI O', categoryId: 'c-drink', price: 100 } as MenuItem,
];

function line(menuItemId: string, name: string, qty: number, price: number) {
  return {
    id: `${menuItemId}-l`, menuItemId, name, quantity: qty, price,
    lineTotal: qty * price, pricingType: 'fixed', note: '',
  } as any;
}

function mkOrder(id: string, over: Partial<Order> = {}): Order {
  return {
    id, orderNumber: 1, orderType: 'dining', status: 'paid',
    items: [], subtotal: 0, discount: 0, tax: 0,
    serviceCharge: 0, serviceChargePercent: 0, grandTotal: 0,
    createdAt: '2026-07-21T12:00:00.000Z',
    ...over,
  } as Order;
}

describe('category sections match the printed sample structure', () => {
  const orders = [
    mkOrder('o1', {
      items: [line('m-rice', 'CHICKEN RICE', 2, 250), line('m-tea', 'TEH TARIK', 1, 120)],
      grandTotal: 620, paymentMethod: 'cash',
    }),
    mkOrder('o2', {
      items: [line('m-tea', 'TEH TARIK', 3, 120), line('m-coffee', 'KOPI O', 1, 100)],
      grandTotal: 460, paymentMethod: 'card',
    }),
  ];
  const r = buildItemSalesReport(orders, menu, categories);

  it('groups items under their category with qty + amount', () => {
    const food = r.categories.find(c => c.name === 'LOCAL FOOD')!;
    expect(food.rows).toEqual([{ itemId: 'm-rice', name: 'CHICKEN RICE', qty: 2, amount: 500 }]);
    expect(food.subQty).toBe(2);
    expect(food.subAmount).toBe(500);
  });

  it('same item across many orders merges into ONE row (sample style)', () => {
    const drinks = r.categories.find(c => c.name === 'DRINKS')!;
    const tea = drinks.rows.find(x => x.name === 'TEH TARIK')!;
    expect(tea.qty).toBe(4);          // 1 + 3
    expect(tea.amount).toBe(480);     // 120 + 360
  });

  it('category SUB TOTAL and grand TOTAL are exact', () => {
    const drinks = r.categories.find(c => c.name === 'DRINKS')!;
    expect(drinks.subQty).toBe(5);
    expect(drinks.subAmount).toBe(580);   // 480 + 100
    expect(r.totalQty).toBe(7);
    expect(r.totalAmount).toBe(1080);     // 500 + 580
  });

  it('grand total equals the sum of category subtotals (reconciliation)', () => {
    const sum = r.categories.reduce((s, c) => s + c.subAmount, 0);
    expect(r.totalAmount).toBe(sum);
  });
});

describe('SETTLEMENT section (cash/card/etc counts + amounts)', () => {
  it('counts receipts and sums amounts per method like the sample', () => {
    const orders = [
      mkOrder('o1', { items: [line('m-tea', 'TEH TARIK', 1, 120)], grandTotal: 120, paymentMethod: 'cash' }),
      mkOrder('o2', { items: [line('m-tea', 'TEH TARIK', 1, 120)], grandTotal: 120, paymentMethod: 'cash' }),
      mkOrder('o3', { items: [line('m-coffee', 'KOPI O', 2, 100)], grandTotal: 200, paymentMethod: 'card' }),
    ];
    const r = buildItemSalesReport(orders, menu, categories);
    expect(r.settlement).toEqual([
      { method: 'CARD', count: 1, amount: 200 },
      { method: 'CASH', count: 2, amount: 240 },
    ]);
    expect(r.settlementTotal).toEqual({ count: 3, amount: 440 });
  });

  it('split payment lands in BOTH methods with its own amounts', () => {
    const orders = [mkOrder('o1', {
      items: [line('m-rice', 'CHICKEN RICE', 2, 250)],
      grandTotal: 500,
      payments: [
        { id: 'p1', method: 'cash', amount: 300 },
        { id: 'p2', method: 'card', amount: 200 },
      ] as any,
    })];
    const r = buildItemSalesReport(orders, menu, categories);
    expect(r.settlement).toEqual([
      { method: 'CARD', count: 1, amount: 200 },
      { method: 'CASH', count: 1, amount: 300 },
    ]);
    expect(r.settlementTotal.amount).toBe(500);
  });

  it('named account (e.g. JazzCash) is shown by its name', () => {
    const o = mkOrder('o1', { paymentMethod: 'online', paymentAccountName: 'JazzCash' } as any);
    expect(settlementLabel(o)).toBe('JAZZCASH');
  });
});

describe('filters (feedback: category-wise, product-wise, order types)', () => {
  const orders = [
    mkOrder('dine', { orderType: 'dining', items: [line('m-rice', 'CHICKEN RICE', 1, 250)], grandTotal: 250 }),
    mkOrder('take', { orderType: 'takeaway', items: [line('m-tea', 'TEH TARIK', 1, 120)], grandTotal: 120 }),
    mkOrder('deli', { orderType: 'delivery', items: [line('m-coffee', 'KOPI O', 1, 100)], grandTotal: 100 }),
  ];

  it('order-type filter: only takeaway + delivery', () => {
    const r = buildItemSalesReport(orders, menu, categories, { orderTypes: ['takeaway', 'delivery'] });
    expect(r.ordersIncluded).toBe(2);
    expect(r.totalAmount).toBe(220);
    expect(r.byOrderType.map(x => x.orderType)).toEqual(['delivery', 'takeaway']);
  });

  it('category filter: only DRINKS', () => {
    const r = buildItemSalesReport(orders, menu, categories, { categoryIds: ['c-drink'] });
    expect(r.categories).toHaveLength(1);
    expect(r.categories[0].name).toBe('DRINKS');
    expect(r.totalAmount).toBe(220);
  });

  it('product filter: single item only (product-wise print)', () => {
    const r = buildItemSalesReport(orders, menu, categories, { itemIds: ['m-tea'] });
    expect(r.totalQty).toBe(1);
    expect(r.totalAmount).toBe(120);
    expect(r.categories[0].rows[0].name).toBe('TEH TARIK');
  });

  it('date range: only orders inside from..to are counted', () => {
    const old = mkOrder('old', {
      createdAt: '2026-07-10T09:00:00.000Z',
      items: [line('m-rice', 'CHICKEN RICE', 1, 250)], grandTotal: 250,
    });
    const r = buildItemSalesReport([...orders, old], menu, categories, {
      from: new Date('2026-07-21T00:00:00.000Z'),
      to: new Date('2026-07-21T23:59:59.999Z'),
    });
    expect(r.ordersIncluded).toBe(3); // 'old' excluded
  });
});

describe('what never counts as a sale', () => {
  it('void / cancelled / running orders are excluded', () => {
    const orders = [
      mkOrder('v', { status: 'void', items: [line('m-tea', 'TEH TARIK', 5, 120)], grandTotal: 600 }),
      mkOrder('c', { status: 'cancelled', items: [line('m-tea', 'TEH TARIK', 5, 120)], grandTotal: 600 }),
      mkOrder('r', { status: 'running', items: [line('m-tea', 'TEH TARIK', 5, 120)], grandTotal: 600 }),
      mkOrder('ok', { status: 'paid', items: [line('m-tea', 'TEH TARIK', 1, 120)], grandTotal: 120 }),
    ];
    const r = buildItemSalesReport(orders, menu, categories);
    expect(r.ordersIncluded).toBe(1);
    expect(r.totalAmount).toBe(120);
  });

  it('credit/udhaar sales ARE included (they are real sales)', () => {
    const orders = [mkOrder('cr', { status: 'credit_pending', items: [line('m-tea', 'TEH TARIK', 1, 120)], grandTotal: 120 })];
    const r = buildItemSalesReport(orders, menu, categories);
    expect(r.ordersIncluded).toBe(1);
  });
});

describe('presetRange (yesterday / week / month / year)', () => {
  const now = new Date('2026-07-22T15:30:00');

  it('today covers the full local day', () => {
    const { from, to } = presetRange('today', now);
    expect(from.getDate()).toBe(22);
    expect(from.getHours()).toBe(0);
    expect(to.getDate()).toBe(22);
    expect(to.getHours()).toBe(23);
  });

  it('yesterday is exactly the previous day', () => {
    const { from, to } = presetRange('yesterday', now);
    expect(from.getDate()).toBe(21);
    expect(to.getDate()).toBe(21);
  });

  it('week is a rolling 7 days including today', () => {
    const { from, to } = presetRange('week', now);
    expect(from.getDate()).toBe(16);
    expect(to.getDate()).toBe(22);
  });

  it('month starts on the 1st; year starts Jan 1', () => {
    expect(presetRange('month', now).from.getDate()).toBe(1);
    const y = presetRange('year', now).from;
    expect(y.getMonth()).toBe(0);
    expect(y.getDate()).toBe(1);
  });
});
