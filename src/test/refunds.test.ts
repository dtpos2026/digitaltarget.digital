// ============================================================
// Tests — v1.15.0 Refunds
//
// A refund hands real money back, so every limit is asserted against
// hand-computed numbers. The rules that matter:
//   never return more than was PAID
//   never return more units than were SOLD
//   limits accumulate across several partial refunds
//   tax comes back in the same proportion it was charged
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  buildRefund, refundableQty, refundedQtyForLine, maxRefundable,
  netUnitValue, effectiveTaxRate, cashOutOfDrawer, refundedProductCount,
  type Refund,
} from '@/lib/refunds';
import type { Order, CartItem } from '@/lib/types';

const line = (id: string, name: string, price: number, qty: number): CartItem => ({
  id, menuItemId: `m-${id}`, name, pricingType: 'fixed',
  price, quantity: qty, lineTotal: price * qty, note: '',
} as CartItem);

function order(over: Partial<Order> = {}): Order {
  const items = over.items || [line('l1', 'Biryani', 500, 2), line('l2', 'Coke', 100, 1)];
  const subtotal = items.reduce((s, l) => s + l.lineTotal, 0);
  return {
    id: 'o1', orderNumber: 101, orderType: 'dining', status: 'paid',
    items, subtotal, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0,
    grandTotal: subtotal, amountPaid: subtotal,
    createdAt: '2026-07-27T10:00:00.000Z',
    ...over,
  } as Order;
}

const refund = (over: Partial<Refund> = {}): Refund => ({
  id: 'r1', orderId: 'o1', orderNumber: 101, at: '2026-07-27T11:00:00.000Z',
  by: 'staff', reason: 'test', kind: 'partial',
  lines: [], payments: [], subtotal: 0, tax: 0, total: 0,
  restocked: false, deviceId: 'd1',
  ...over,
} as Refund);

const req = (quantities: Record<string, number>, total: number, method = 'cash') => ({
  quantities, reason: 'Item kharab tha', by: 'staff',
  payments: [{ method, amount: total }], restock: false,
});

describe('refund amount is based on what the customer PAID', () => {
  it('a full refund returns the whole bill', () => {
    const o = order();
    const r = buildRefund(o, [], req({ l1: 2, l2: 1 }, 1100));
    expect(r.ok).toBe(true);
    expect(r.preview!.total).toBe(1100);
    expect(r.preview!.kind).toBe('full');
  });

  it('a partial refund returns only the chosen units', () => {
    const r = buildRefund(order(), [], req({ l1: 1 }, 500));
    expect(r.ok).toBe(true);
    expect(r.preview!.total).toBe(500);
    expect(r.preview!.kind).toBe('partial');
  });

  it('a bill discount reduces what comes back — never refund more than was taken', () => {
    // 1100 of goods, 110 discount, so the customer paid 990.
    const o = order({ discount: 110, grandTotal: 990, amountPaid: 990 });
    const r = buildRefund(o, [], req({ l1: 2, l2: 1 }, 990));
    expect(r.ok).toBe(true);
    expect(r.preview!.total).toBeCloseTo(990, 2);
  });

  it('tax comes back in the proportion it was charged', () => {
    // 1000 goods + 9% GST = 1090 paid.
    const o = order({
      items: [line('l1', 'Dish', 1000, 1)],
      subtotal: 1000, tax: 90, grandTotal: 1090, amountPaid: 1090,
    });
    const r = buildRefund(o, [], req({ l1: 1 }, 1090));
    expect(r.ok).toBe(true);
    expect(r.preview!.subtotal).toBe(1000);
    expect(r.preview!.tax).toBeCloseTo(90, 2);
    expect(r.preview!.total).toBeCloseTo(1090, 2);
  });

  it('half the goods returns half the tax', () => {
    const o = order({
      items: [line('l1', 'Dish', 500, 2)],
      subtotal: 1000, tax: 90, grandTotal: 1090, amountPaid: 1090,
    });
    const r = buildRefund(o, [], req({ l1: 1 }, 545));
    expect(r.preview!.subtotal).toBe(500);
    expect(r.preview!.tax).toBeCloseTo(45, 2);
  });
});

describe('limits — the rules that protect the till', () => {
  it('cannot refund more units than were sold', () => {
    const r = buildRefund(order(), [], req({ l1: 5 }, 2500));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/can be refunded/);
  });

  it('limits ACCUMULATE across several partial refunds', () => {
    const prior = [refund({
      lines: [{ lineId: 'l1', menuItemId: 'm-l1', name: 'Biryani', quantity: 1, unitAmount: 500, amount: 500 }],
      total: 500,
    })];
    // one unit already returned, so only one remains
    expect(refundableQty(order().items[0], prior)).toBe(1);
    const tooMuch = buildRefund(order(), prior, req({ l1: 2 }, 1000));
    expect(tooMuch.ok).toBe(false);

    const justRight = buildRefund(order(), prior, req({ l1: 1 }, 500));
    expect(justRight.ok).toBe(true);
  });

  it('the money cap shrinks as refunds are issued', () => {
    const o = order();
    expect(maxRefundable(o, [])).toBe(1100);
    expect(maxRefundable(o, [refund({ total: 400 })])).toBe(700);
    expect(maxRefundable(o, [refund({ total: 400 }), refund({ total: 700 })])).toBe(0);
  });

  it('a partially-paid bill can only return what it actually took', () => {
    const o = order({ status: 'partial', amountPaid: 300 });
    expect(maxRefundable(o, [])).toBe(300);
    const r = buildRefund(o, [], req({ l1: 2, l2: 1 }, 1100));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/maximum allowed/);
  });

  it('a VOID bill cannot be refunded — no money was ever kept', () => {
    const r = buildRefund(order({ status: 'void' }), [], req({ l1: 1 }, 500));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/[Vv]oid/);
  });

  it('the returned money must match the refund total', () => {
    const r = buildRefund(order(), [], {
      quantities: { l1: 1 }, reason: 'x', by: 's',
      payments: [{ method: 'cash', amount: 999 }], restock: false,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/does not match/);
  });

  it('a reason is compulsory — an unexplained refund is unauditable', () => {
    const r = buildRefund(order(), [], {
      quantities: { l1: 1 }, reason: '   ', by: 's',
      payments: [{ method: 'cash', amount: 500 }], restock: false,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/reason for the refund is required/i);
  });

  it('selecting nothing is rejected', () => {
    expect(buildRefund(order(), [], req({}, 0)).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('netUnitValue accounts for the bill discount', () => {
    const o = order({ discount: 110, grandTotal: 990, amountPaid: 990 });
    // Biryani line is 1000/1100 of the bill, so it carries 100 of the discount:
    // (1000 - 100) / 2 units = 450 each
    expect(netUnitValue(o.items[0], o)).toBeCloseTo(450, 2);
  });

  it('effectiveTaxRate reflects what was actually charged', () => {
    // Items must genuinely total 1000 — the rate is derived from the lines,
    // not from a `subtotal` field, so that a tampered header cannot skew
    // how much tax gets refunded.
    const o = order({
      items: [line('l1', 'Dish', 1000, 1)],
      subtotal: 1000, tax: 90, grandTotal: 1090, amountPaid: 1090,
    });
    expect(effectiveTaxRate(o)).toBeCloseTo(0.09, 4);
  });

  it('a zero-tax bill has a zero rate, never NaN', () => {
    expect(effectiveTaxRate(order())).toBe(0);
  });

  it('only cash refunds leave the drawer', () => {
    expect(cashOutOfDrawer(refund({ payments: [{ method: 'cash', amount: 300 }] }))).toBe(300);
    expect(cashOutOfDrawer(refund({ payments: [{ method: 'NETS', amount: 300 }] }))).toBe(0);
    expect(cashOutOfDrawer(refund({
      payments: [{ method: 'cash', amount: 200 }, { method: 'card', amount: 100 }],
    }))).toBe(200);
  });

  it('refundedProductCount totals units across every refund', () => {
    const rs = [
      refund({ lines: [{ lineId: 'a', menuItemId: 'm', name: 'X', quantity: 2, unitAmount: 1, amount: 2 }] }),
      refund({ lines: [{ lineId: 'b', menuItemId: 'm', name: 'Y', quantity: 3, unitAmount: 1, amount: 3 }] }),
    ];
    expect(refundedProductCount(rs)).toBe(5);
  });

  it('refundedQtyForLine counts only the line asked about', () => {
    const rs = [refund({
      lines: [
        { lineId: 'l1', menuItemId: 'm', name: 'X', quantity: 2, unitAmount: 1, amount: 2 },
        { lineId: 'l2', menuItemId: 'm', name: 'Y', quantity: 1, unitAmount: 1, amount: 1 },
      ],
    })];
    expect(refundedQtyForLine('l1', rs)).toBe(2);
    expect(refundedQtyForLine('l2', rs)).toBe(1);
    expect(refundedQtyForLine('l9', rs)).toBe(0);
  });
});
