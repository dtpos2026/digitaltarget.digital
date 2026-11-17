// v1.115.0 — the cash a rider takes at the door: the rider's app shows what is still to hand over, the cashier receives it in Riders, and both fall to zero together.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { Order } from '@/lib/types';
import { riderCashLines, riderCashSummary, settleRiderCash } from '@/lib/riderCash';
import { historyRows } from '@/lib/riderApp';
import { RecordSheet } from '@/components/rider/RiderTabs';

const R = 'rider-1';
const o = (id: string, n: number, payments: unknown[], over: Partial<Order> = {}): Order =>
  ({ id, orderNumber: n, riderId: R, deliveryStatus: 'delivered', deliveredAt: '2026-11-17T09:00:00.000Z', grandTotal: 1000, payments, ...over }) as unknown as Order;
const cash = (amount: number, at = '2026-11-17T09:00:00.000Z', riderId = R) => ({ id: `p${amount}`, amount, method: 'cash', at, by: 'rider', riderId });

describe('what the rider took', () => {
  const orders = [
    o('a', 1, [cash(1000)]),
    o('b', 2, [cash(600), cash(150)]),                                   // two payments on one order add up
    o('c', 3, [{ id: 'x', amount: 500, method: 'card', riderId: R, at: '2026-11-17T10:00:00.000Z' }]),   // card is not cash in hand
    o('d', 4, [cash(700, '2026-11-17T11:00:00.000Z', 'someone-else')]),  // another rider's money
    o('e', 5, [cash(400)], { riderId: 'someone-else' }),
    o('f', 6, [cash(300)], { cashHandedOverAt: '2026-11-16T20:00:00.000Z', cashHandedOverBy: 'Cashier' }),
    o('g', 7, [], {}),
  ];
  it('lists cash lines per order, only this rider\'s, only cash', () => {
    const lines = riderCashLines(orders, R);
    expect(lines.map(l => [l.orderNumber, l.amount])).toEqual(expect.arrayContaining([[1, 1000], [2, 750], [6, 300]]));
    expect(lines).toHaveLength(3);
  });
  it('splits what is still to hand over from what the cashier already received, and what was taken today', () => {
    const s = riderCashSummary(orders, R, new Date('2026-11-17T18:00:00'));
    expect(s.due).toBe(1750);
    expect(s.dueCount).toBe(2);
    expect(s.handedOver).toBe(300);
  });
  it('an empty or odd list is safe', () => {
    expect(riderCashSummary([], R).due).toBe(0);
    expect(riderCashLines([{ id: 'z' } as Order], R)).toEqual([]);
  });
});

describe('the cashier receives the cash', () => {
  const orders = [o('a', 1, [cash(1000)]), o('f', 6, [cash(300)], { cashHandedOverAt: '2026-11-16T20:00:00.000Z' }), o('h', 8, [cash(200)], { riderId: 'other' })];
  it('stamps only this rider\'s open orders, once, and leaves settled ones and other riders alone', () => {
    const changed = settleRiderCash(orders, R, 'Ayesha', '2026-11-17T20:00:00.000Z');
    expect(changed.map(c => c.id)).toEqual(['a']);
    expect(changed[0].cashHandedOverAt).toBe('2026-11-17T20:00:00.000Z');
    expect(changed[0].cashHandedOverBy).toBe('Ayesha');
    const after = orders.map(x => changed.find(c => c.id === x.id) || x);
    expect(riderCashSummary(after, R).due).toBe(0);
    expect(settleRiderCash(after, R, 'Ayesha')).toEqual([]);          // nothing left to receive: a second tap changes nothing
  });
});

describe('the rider\'s record', () => {
  it('carries the cash and its hand-over from the server\'s rows', () => {
    const rows = historyRows([{ id: 'a', orderNumber: 1, grandTotal: 1000, deliveredAt: '2026-11-17T09:00:00.000Z', cashCollected: 1000, handedOverAt: null }, { id: 'b', orderNumber: 2, grandTotal: 500, deliveredAt: '2026-11-17T10:00:00.000Z', cashCollected: 0, handedOverAt: '2026-11-17T20:00:00Z' }]);
    const a = rows.find(r => r.id === 'a')!, b = rows.find(r => r.id === 'b')!;
    expect(a.cashCollected).toBe(1000);
    expect(a.handedOverAt).toBeUndefined();
    expect(b.cashCollected).toBeUndefined();
    expect(b.handedOverAt).toBe('2026-11-17T20:00:00Z');
  });
  it('the order sheet says whether the cash is still to hand over', () => {
    const base = { id: 'a', orderNumber: '12', customerName: 'Ali', address: '', total: 1000, deliveredAt: '2026-11-17T09:00:00.000Z' };
    const { rerender } = render(<RecordSheet r={{ ...base, cashCollected: 1000 }} onClose={() => {}} />);
    expect(document.querySelector('[data-rider-record-cash]')!.textContent).toContain('to hand over');
    rerender(<RecordSheet r={{ ...base, cashCollected: 1000, handedOverAt: '2026-11-17T20:00:00Z' }} onClose={() => {}} />);
    expect(document.querySelector('[data-rider-record-cash]')!.textContent).toContain('handed over');
    rerender(<RecordSheet r={base} onClose={() => {}} />);
    expect(document.querySelector('[data-rider-record-cash]')).toBeNull();
  });
});

describe('the screens and the migration', () => {
  it('Home shows the server\'s figure only when there is some; Riders has the chip, the card and the button', () => {
    const home = readFileSync('src/pages/RiderAppPage.tsx', 'utf8');
    expect(home).toContain('(history?.totals?.cashUnsettled ?? 0) > 0 && (');
    expect(home).toContain('Cash to hand over');
    const riders = readFileSync('src/pages/RidersListPage.tsx', 'utf8');
    for (const k of ['data-rider-cash-chip', 'data-rider-cash-card', 'Receive cash', 'settleRiderCash(orders, rider.id, by)']) expect(riders, k).toContain(k);
  });
  it('the history function is read-only, keeps its signature and adds only fields', () => {
    const m = readFileSync('supabase/migrations/20261117110000_v1_115_0_rider_cash_history.sql', 'utf8');
    expect(m).toContain('create or replace function public.portal_my_history(p_token text, p_limit integer default 100)');
    expect(m).toContain('stable');
    for (const k of ["'cashCollected'", "'handedOverAt'", "'cashUnsettled'", "'cashUnsettledCount'", "'cashToday'", "'delivered', count(*)", "'earnings'"]) expect(m, k).toContain(k);
    expect(readFileSync('docs/rollback/2026-11-17-v1_115_0-rider-cash-history-before.sql', 'utf8')).toContain("'earnings', coalesce(sum((o.data->>'grandTotal')::numeric), 0))");
  });
});
