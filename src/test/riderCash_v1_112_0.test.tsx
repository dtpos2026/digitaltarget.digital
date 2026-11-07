// v1.112.0 — Rider app: the money still to be taken from customers, on the order card and as one total on Home.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { Order } from '@/lib/types';
import { cashToCollect } from '@/lib/riderApp';
import { OrderCard } from '@/components/rider/RiderTabs';

const o = (over: Partial<Order>): Order => ({ id: 'o', orderNumber: 1, orderType: 'delivery', grandTotal: 1000, deliveryStatus: 'rider_assigned', status: 'running', ...over }) as Order;

describe('cashToCollect', () => {
  it('adds what is to be taken on the orders still in hand, and nothing for the ones that need no cash', () => {
    const r = cashToCollect([
      o({ id: 'a', grandTotal: 1450 }),                                          // cash on delivery
      o({ id: 'b', grandTotal: 650, paymentMethod: 'cash' }),
      o({ id: 'c', grandTotal: 900, status: 'paid' }),                           // paid already
      o({ id: 'd', grandTotal: 800, status: 'complimentary' }),
      o({ id: 'e', grandTotal: 700, deliveryStatus: 'delivered' }),              // done
      o({ id: 'f', grandTotal: 500, deliveryStatus: 'cancelled' }),
    ]);
    expect(r).toEqual({ amount: 2100, count: 2 });
  });
  it('is zero with no orders', () => { expect(cashToCollect([])).toEqual({ amount: 0, count: 0 }); });
});

describe('the order card', () => {
  it('says what to collect, or that there is nothing to collect', () => {
    const { rerender } = render(<OrderCard order={o({ grandTotal: 2450, customer: { name: 'Ali', address: 'Gulberg' } as Order['customer'] })} onOpen={() => {}} />);
    const chip = document.querySelector('[data-rider-collect-chip]')!;
    expect(chip.textContent).toContain('Collect');
    expect(chip.textContent).toContain('2,450');
    rerender(<OrderCard order={o({ grandTotal: 2450, status: 'paid' })} onOpen={() => {}} />);
    expect(document.querySelector('[data-rider-collect-chip]')!.textContent).toBe('Paid already');
    const open = vi.fn();
    rerender(<OrderCard order={o({})} onOpen={open} />);
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('Home', () => {
  const page = readFileSync('src/pages/RiderAppPage.tsx', 'utf8');
  it('shows one "to collect" total only when there is something to collect, above the active orders', () => {
    expect(page).toContain('const cashDue = useMemo(() => cashToCollect(myOrders), [myOrders]);');
    expect(page).toContain('{cashDue.amount > 0 && (');
    expect(page.indexOf('data-rider-cash-due')).toBeLessThan(page.indexOf('<RLabel>My active orders'));
    expect(page).toContain('To collect from customers');
  });
});
