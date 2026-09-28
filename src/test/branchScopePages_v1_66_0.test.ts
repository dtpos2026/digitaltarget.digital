// v1.66.0 — order-list screens read through the branch filter.
// The filter's behaviour is proved in the cashierScope tests; this only stops a
// screen going back to reading every branch's bills raw.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const pages = ['RunningBillsPage','PendingPaymentsPage','PickupOrdersPage','BillReprintPage',
  'DeliveryBoardPage','KitchenDisplayPage','KdsTvPage','OnlinePortalPage'];

describe('order screens are branch-scoped', () => {
  for (const name of pages) {
    it(`${name} never reads getOrders() unscoped`, () => {
      const src = readFileSync(`src/pages/${name}.tsx`, 'utf8');
      const raw = src.split('\n').filter(l =>
        /getOrders\(\)/.test(l) && !/scope(ToBranch|Orders)\(getOrders\(\)\)/.test(l));
      expect(raw).toEqual([]);
    });
  }
});
