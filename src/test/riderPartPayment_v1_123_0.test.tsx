// v1.123.0 — a rider can take LESS than what is due at the door: only what was taken is booked, the bill stays part-paid, the rest is still due.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render } from '@testing-library/react';
import type { Order } from '@/lib/types';
import { applyDeliveryCash, deliveryMoney } from '@/lib/riderApp';
import { riderCashLines, riderCashSummary } from '@/lib/riderCash';
import { isPartialSale } from '@/lib/sales';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const order = (extra: Partial<Order> = {}): Order => ({ id: 'o1', orderNumber: 7, status: 'running', orderType: 'delivery', grandTotal: 1500, paymentMethod: 'cash', payments: [], items: [], riderId: 'r1', ...extra } as unknown as Order);
const RIDER = { id: 'r1', name: 'Bilal' };
const AT = '2026-11-18T10:00:00.000Z';

describe('how much was taken', () => {
  it('nothing said = all of it, as before', () => {
    expect(deliveryMoney(order(), null)).toMatchObject({ due: 1500, taken: 1500, shortfall: 0, status: 'paid', refuse: null });
    expect(deliveryMoney(order(), undefined).status).toBe('paid');
  });
  it('less than due: the shortfall stays, the bill is part-paid', () => {
    expect(deliveryMoney(order(), 1000)).toMatchObject({ taken: 1000, shortfall: 500, status: 'partial', refuse: null });
    expect(deliveryMoney(order(), 0)).toMatchObject({ taken: 0, shortfall: 1500, status: 'partial' });
    expect(deliveryMoney(order(), 1500).status).toBe('paid');
  });
  it('more than due, or below zero, is refused', () => {
    expect(deliveryMoney(order(), 2000).refuse).toBe('amount_too_high');
    expect(deliveryMoney(order(), -1).refuse).toBe('bad_amount');
  });
  it('after an advance only the balance counts (advance 500 of 1500, balance 1000)', () => {
    const o = order({ status: 'partial', amountPaid: 500, payments: [{ id: 'a', amount: 500, method: 'cash', at: '' }] as never });
    expect(deliveryMoney(o, 600)).toMatchObject({ due: 1000, taken: 600, shortfall: 400, status: 'partial' });
    expect(deliveryMoney(o, null)).toMatchObject({ taken: 1000, status: 'paid' });
  });
  it('an order already paid, or on credit, has nothing to take, so nothing is booked', () => {
    expect(deliveryMoney(order({ status: 'paid' }), 100).due).toBe(0);
    const credit = applyDeliveryCash(order({ paymentMethod: 'credit', status: 'credit_pending' }), 100, RIDER, AT);
    expect(credit.payments).toHaveLength(0);
  });
});

describe('the order as the phone holds it', () => {
  it('all taken: paid, one payment of the whole amount by this rider', () => {
    const o = applyDeliveryCash(order(), null, RIDER, AT);
    expect(o.status).toBe('paid');
    expect(o.paidAt).toBe(AT);
    expect(o.amountPaid).toBe(1500);
    expect(o.payments).toHaveLength(1);
    expect(o.payments![0]).toMatchObject({ amount: 1500, method: 'cash', by: 'rider', riderId: 'r1' });
  });
  it('part taken: part-paid, only the cash taken is booked, not paid yet, and the balance is still due', () => {
    const o = applyDeliveryCash(order(), 1000, RIDER, AT);
    expect(o.status).toBe('partial');
    expect(isPartialSale(o)).toBe(true);
    expect(o.paidAt).toBeUndefined();
    expect(o.amountPaid).toBe(1000);
    expect(o.payments!.map(p => p.amount)).toEqual([1000]);
  });
  it('nothing taken: part-paid and no payment at all', () => {
    const o = applyDeliveryCash(order(), 0, RIDER, AT);
    expect(o.status).toBe('partial');
    expect(o.payments).toHaveLength(0);
    expect(o.amountPaid).toBe(0);
  });
  it('the rider’s cash to hand over is what was really taken', () => {
    const delivered = applyDeliveryCash(order(), 1000, RIDER, AT);
    expect(riderCashLines([delivered], 'r1')).toMatchObject([{ orderId: 'o1', amount: 1000 }]);
    expect(riderCashSummary([delivered], 'r1', new Date(AT)).due).toBe(1000);
  });
});

describe('the delivery screen', () => {
  const mount = async (o: Order, onConfirm = vi.fn().mockResolvedValue(undefined)) => {
    const { DeliverScreen } = await import('@/components/rider/RiderDelivery');
    const view = render(<DeliverScreen order={o} onBack={() => undefined} onConfirm={onConfirm} />);
    return { view, onConfirm };
  };
  const confirmBtn = () => [...document.querySelectorAll('button')].find(b => /Delivered/.test(b.textContent || '')) as HTMLButtonElement;
  const tick = () => document.querySelector('[role="checkbox"], input[type="checkbox"]') as HTMLElement;

  it('the default is the whole amount: confirm sends nothing (the server books it all, as before)', async () => {
    const { onConfirm } = await mount(order());
    expect(confirmBtn().disabled).toBe(true);                                     // the tick comes first
    fireEvent.click(tick());
    fireEvent.click(confirmBtn());
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
  });
  it('a smaller amount shows what stays unpaid and sends the amount taken', async () => {
    const { onConfirm } = await mount(order());
    fireEvent.change(document.querySelector('[data-rider-cash-input]')!, { target: { value: '1000' } });
    expect(document.querySelector('[data-rider-shortfall]')!.textContent).toContain('500');
    expect(document.body.textContent).toContain('stays unpaid');
    fireEvent.click(tick());
    fireEvent.click(confirmBtn());
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(1000));
  });
  it('"Nothing" sends 0; "All" goes back to the whole amount; changing the amount clears the tick', async () => {
    const { onConfirm } = await mount(order());
    fireEvent.click(document.querySelector('[data-rider-cash-none]')!);
    expect((document.querySelector('[data-rider-cash-input]') as HTMLInputElement).value).toBe('0');
    fireEvent.click(tick()); fireEvent.click(confirmBtn());
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith(0));
    fireEvent.click(document.querySelector('[data-rider-cash-full]')!);
    expect((document.querySelector('[data-rider-cash-input]') as HTMLInputElement).value).toBe('');
    expect(confirmBtn().disabled).toBe(true);
  });
  it('more than the customer owes cannot be confirmed', async () => {
    await mount(order());
    fireEvent.change(document.querySelector('[data-rider-cash-input]')!, { target: { value: '2000' } });
    expect(document.body.textContent).toContain('more than the customer owes');
    fireEvent.click(tick());
    expect(confirmBtn().disabled).toBe(true);
  });
  it('an order with nothing to collect has no cash field', async () => {
    await mount(order({ status: 'paid' }));
    expect(document.querySelector('[data-rider-cash-input]')).toBeNull();
  });
});

describe('the wiring', () => {
  it('the portal call adds p_cash only for a delivery with an amount', () => {
    const src = read('src/lib/portalData.ts');
    expect(src).toContain("if (stage === 'delivered' && typeof cashTaken === 'number'");
    expect(src).toContain('args.p_cash = cashTaken');
  });
  it('the server function and its rollback are in the repo', () => {
    const mig = read('supabase/migrations/20261118100000_v1_123_0_rider_part_payment.sql');
    expect(mig).toContain('p_cash numeric default null');
    expect(mig).toContain("'amount_too_high'");
    expect(mig).toContain('drop function if exists public.portal_order_delivery(text, uuid, text, boolean);');
    expect(read('docs/rollback/2026-11-18-v1_123_0-rider-part-payment-before.sql')).toContain('p_claim boolean DEFAULT false)');
  });
});
