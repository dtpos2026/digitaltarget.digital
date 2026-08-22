// ============================================================================
// v1.26.2 — the order tracker crash, pinned
//
// REPORTED: the tracker showed "Something went wrong — Cannot read properties
// of undefined (reading 'length')".
//
// public_track_order() is an RPC, so its result never passes through
// rowFromDb(). The client cast the raw jsonb straight to `Order`. The function
// selected thirteen columns and returned to_jsonb() of them, which means:
//
//   * no `items` key at all  -> TrackOrderPage's `order.items.length` threw
//   * COLUMN names, so snake_case -> orderNumber / grandTotal / kitchenStatus
//     were all undefined and rendered blank, silently
//
// The payload below is that exact shape, copied from the deployed function.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { normalizeTrackedOrder } from '@/lib/trackedOrder';

/** Precisely what the old public_track_order() returned. */
const LEGACY_PAYLOAD = {
  id: 'c0b6bc67-409f-446b-9b4f-fa9931481e9d',
  order_number: 1003,
  status: 'paid',
  order_type: 'dining',
  table_label: null,
  grand_total: 590,
  kitchen_status: 'served',
  delivery_status: null,
  rider_name: null,
  dispatched_at: null,
  delivered_at: null,
  created_at: '2026-08-22T13:33:32.382355+00:00',
  updated_at: '2026-08-22T13:33:48.991642+00:00',
};

describe('the payload that crashed the tracker', () => {
  it('produces an items array instead of undefined', () => {
    const o = normalizeTrackedOrder(LEGACY_PAYLOAD)!;
    expect(Array.isArray(o.items)).toBe(true);
    expect(() => o.items.length).not.toThrow();
    expect(o.items).toHaveLength(0);
  });

  it('recovers the fields that were silently blank, not just the crashing one', () => {
    // These never threw — they rendered empty, which is harder to notice and
    // was the actual reason the tracker was useless even before the crash.
    const o = normalizeTrackedOrder(LEGACY_PAYLOAD)!;
    expect(o.orderNumber).toBe(1003);
    expect(o.grandTotal).toBe(590);
    expect(o.orderType).toBe('dining');
    expect((o as any).kitchenStatus).toBe('served');
    expect(o.createdAt).toBe('2026-08-22T13:33:32.382355+00:00');
  });

  it('gives payments an array too', () => {
    expect(normalizeTrackedOrder(LEGACY_PAYLOAD)!.payments).toEqual([]);
  });
});

describe('the v1.26.2 payload passes through intact', () => {
  const CURRENT = {
    id: 'ord-1', orderNumber: 1003, status: 'paid', orderType: 'dining',
    tableLabel: null,
    items: [
      { id: 'a', name: 'Anda Shami Burger', quantity: 1, lineTotal: 130 },
      { id: 'b', name: 'BANANA ICE CREAM (L)', quantity: 1, lineTotal: 280 },
    ],
    payments: [], subtotal: 590, discount: 0, grandTotal: 590,
    kitchenStatus: 'served', deliveryStatus: null,
    createdAt: '2026-08-22T13:33:32.382355+00:00',
    delivery: { riderLat: 31.5, riderLng: 74.3, etaMinutes: 12 },
  };

  it('keeps the lines and the money', () => {
    const o = normalizeTrackedOrder(CURRENT)!;
    expect(o.items).toHaveLength(2);
    expect(o.items[0].name).toBe('Anda Shami Burger');
    expect(o.subtotal).toBe(590);
    expect(o.grandTotal).toBe(590);
  });

  it('keeps the live delivery tracking block', () => {
    const o = normalizeTrackedOrder(CURRENT)! as any;
    expect(o.delivery.riderLat).toBe(31.5);
    expect(o.delivery.etaMinutes).toBe(12);
  });
});

describe('the two order writers disagree about which column holds the total', () => {
  // Verified against live data: the POS writer fills `total` and leaves
  // grand_total at 0; public_place_order fills grand_total and leaves `total`
  // at 0. A reader that trusts either one alone shows 0 for half the orders.
  it('takes the total from the POS writer', () => {
    expect(normalizeTrackedOrder({ id: 'x', total: 590, grand_total: 0 })!.grandTotal).toBe(590);
  });

  it('takes the total from the customer-website writer', () => {
    expect(normalizeTrackedOrder({ id: 'x', total: 0, grand_total: 460 })!.grandTotal).toBe(460);
  });

  it('falls back to the subtotal rather than showing nothing', () => {
    expect(normalizeTrackedOrder({ id: 'x', subtotal: 250 })!.grandTotal).toBe(250);
  });

  it('reports a genuinely free order as 0, not as a missing value', () => {
    expect(normalizeTrackedOrder({ id: 'x', total: 0, grand_total: 0, subtotal: 0 })!.grandTotal).toBe(0);
  });
});

describe('nothing usable is ever turned into a crash', () => {
  it('returns null for an empty response rather than a broken order', () => {
    expect(normalizeTrackedOrder(null)).toBeNull();
    expect(normalizeTrackedOrder(undefined)).toBeNull();
    expect(normalizeTrackedOrder({})).toBeNull();
    expect(normalizeTrackedOrder([])).toBeNull();
  });

  it('repairs a line with no name, id or total instead of dropping it', () => {
    // A missing line is a customer asking why their food is not on the list.
    const o = normalizeTrackedOrder({ id: 'x', items: [{}, { name: 'Tea' }] })!;
    expect(o.items).toHaveLength(2);
    expect(o.items[0].name).toBe('Item');
    expect(o.items[0].id).toBe('line-0');
    expect(o.items[0].lineTotal).toBe(0);
    expect(o.items[1].name).toBe('Tea');
  });

  it('survives items arriving as something that is not an array', () => {
    for (const bad of [null, 'nope', 42, {}]) {
      const o = normalizeTrackedOrder({ id: 'x', items: bad })!;
      expect(Array.isArray(o.items)).toBe(true);
    }
  });
});

// ============================================================================
// The store seam: getOrderFromCloudByLookup / getOrderFromCloudById used to
// cast the RPC's raw jsonb straight to Order. These drive the real store
// functions with the real (old) RPC payload.
// ============================================================================
import { vi, beforeEach } from 'vitest';

const trackPublicOrder = vi.fn(async () => LEGACY_PAYLOAD as any);
vi.mock('@/lib/publicPortal.functions', () => ({
  trackPublicOrder: (...a: any[]) => trackPublicOrder(...(a as [])),
  submitPublicOrder: vi.fn(),
  createPublicWaiterCall: vi.fn(),
}));

const { setTenant } = await import('@/lib/tenant');
const store = await import('@/lib/store');

describe('the store never hands the UI an unrenderable order', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dtpos-auth-backend', 'supabase');
    localStorage.setItem('desi-pos-data', JSON.stringify({
      orders: [], settings: {}, categories: [], menuItems: [], tables: [],
    }));
    setTenant('c96dcc1a-a45c-4912-a092-c5a9d6dd4111', 'Probe');
    trackPublicOrder.mockClear();
  });

  it('getOrderFromCloudByLookup returns an order whose items can be counted', async () => {
    const o = await store.getOrderFromCloudByLookup(1003, '', '');
    expect(o).not.toBeNull();
    // The line that threw: TrackOrderPage renders `order.items.length`.
    expect(() => (o as any).items.length).not.toThrow();
    expect((o as any).items).toEqual([]);
    expect(o!.orderNumber).toBe(1003);
    expect(o!.grandTotal).toBe(590);
  });

  it('getOrderFromCloudById does the same', async () => {
    const o = await store.getOrderFromCloudById('trk-1');
    expect(o).not.toBeNull();
    expect(() => (o as any).items.length).not.toThrow();
    expect((o as any).kitchenStatus).toBe('served');
  });

  it('a null answer stays null rather than becoming a broken order', async () => {
    trackPublicOrder.mockResolvedValueOnce(null as any);
    expect(await store.getOrderFromCloudByLookup(999, '', '')).toBeNull();
  });
});
