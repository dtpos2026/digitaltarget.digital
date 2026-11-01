// ============================================================================
// v1.75.0 — order tracking: one definition, shown the same on the customer's web page and in the software
//
// REQUESTED: the customer who orders on the web sees the order move and where the rider is; the software shows the
// same tracking, and the web app and the Windows app are equal.
//
// Pinned: the status/steps/rider/map a customer would see are worked out in one place (trackingView) for every kind
// of order; the panel draws exactly that; the software's tracking dialog draws the same panel from the same order
// and follows the store live; the Delivery Board and Live Riders map follow the store; the customer's page uses the
// shared panel rather than a private copy.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { mount, q } from './_dom';

const read = (f: string) => readFileSync(f, 'utf8');

// The map needs a real browser; the panel's job is to hand it the right positions.
vi.mock('@/components/DeliveryRouteMap', () => ({
  default: (p: any) => (
    <div data-map data-rider={p.rider ? `${p.rider.lat},${p.rider.lng}` : ''} data-customer={p.customer ? `${p.customer.lat},${p.customer.lng}` : ''} data-branch={p.branch ? `${p.branch.lat},${p.branch.lng}` : ''} />
  ),
}));

const store = vi.hoisted(() => ({
  orders: [] as any[],
  listeners: new Set<(c: string) => void>(),
  refreshed: 0,
}));
vi.mock('@/lib/store', () => ({
  getOrders: () => store.orders,
  getSettings: () => ({ restaurantLat: 31.5, restaurantLng: 74.3 }),
  onDataChange: (cb: (c: string) => void) => { store.listeners.add(cb); return () => { store.listeners.delete(cb); }; },
  refreshOrdersFromCloud: async () => { store.refreshed++; },
}));

import { trackingView } from '@/lib/trackingSteps';
import OrderTrackingPanel from '@/components/OrderTrackingPanel';
import OrderTrackingDialog from '@/components/OrderTrackingDialog';

const base = (over: any = {}) => ({
  id: 'o1', orderNumber: 218, orderType: 'delivery', status: 'running', items: [], payments: [],
  subtotal: 3000, discount: 0, grandTotal: 3336, createdAt: '2026-11-01T10:00:00.000Z', ...over,
});
const stepStates = (v: ReturnType<typeof trackingView>) => v.steps.map(s => `${s.key}:${s.done ? 'done' : 'todo'}`);
const flush = async () => { await act(async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); }); };

let m: ReturnType<typeof mount> | null = null;
beforeEach(() => { store.orders = []; store.listeners.clear(); store.refreshed = 0; });
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers(); });

describe('trackingView — the one answer to "where is this order"', () => {
  it('a new delivery order has only "placed" done and says so', () => {
    const v = trackingView(base() as any);
    expect(stepStates(v)).toEqual(['placed:done', 'cooking:todo', 'ready:todo', 'onway:todo', 'delivered:todo']);
    expect(v.currentLabel).toBe('Order Placed');
    expect(v.activeIndex).toBe(1);
    expect(v.finished).toBe(false);
  });

  it('follows the kitchen, then the rider', () => {
    expect(trackingView(base({ kitchenStatus: 'preparing' }) as any).currentLabel).toBe('Kitchen Cooking');
    expect(trackingView(base({ kitchenStatus: 'ready' }) as any).currentLabel).toBe('Ready for Pickup');
    const rider = trackingView(base({ deliveryStatus: 'rider_picked' }) as any);
    expect(stepStates(rider)).toEqual(['placed:done', 'cooking:done', 'ready:done', 'onway:done', 'delivered:todo']);
    expect(rider.currentLabel).toBe('On the Way');
  });

  it('every real delivery status maps to the right step', () => {
    const labels: Record<string, string> = {
      // A rider can take an order that is still cooking, so rider_assigned says nothing about the kitchen.
      pending: 'Order Placed', accepted: 'Order Placed', rider_assigned: 'Order Placed',
      // The restaurant marking it Cooking on the Delivery Board is what the customer should read as "Kitchen Cooking".
      cooking: 'Kitchen Cooking',
      ready: 'Ready for Pickup',
      rider_picked: 'On the Way', onway: 'On the Way', rider_reached: 'On the Way',
      delivered: 'Delivered', cancelled: 'Cancelled',
    };
    for (const [ds, label] of Object.entries(labels)) {
      expect(trackingView(base({ deliveryStatus: ds }) as any).currentLabel, ds).toBe(label);
    }
  });

  it('delivered and cancelled are finished; a cancelled order has no progress', () => {
    expect(trackingView(base({ deliveryStatus: 'delivered' }) as any).finished).toBe(true);
    const c = trackingView(base({ deliveryStatus: 'cancelled' }) as any);
    expect(c.finished).toBe(true);
    expect(c.isCancelled).toBe(true);
    expect(c.activeIndex).toBe(-1);
  });

  it('a dine-in order ends at Served, with no delivery steps', () => {
    const v = trackingView(base({ orderType: 'dining', tableLabel: 'T-07', kitchenStatus: 'ready' }) as any);
    expect(v.steps.map(s => s.key)).toEqual(['placed', 'cooking', 'ready', 'served']);
    expect(v.currentLabel).toBe('Ready to Serve');
    expect(trackingView(base({ orderType: 'dining', tableLabel: 'T-07', kitchenStatus: 'served' }) as any).currentLabel).toBe('Served');
  });

  it('reads the rider, the live position, the customer and the arrival time', () => {
    const v = trackingView(base({
      deliveryStatus: 'onway', riderName: 'Hamza', riderPhone: '03001234567',
      delivery: { riderLat: 31.51, riderLng: 74.31, customerLat: 31.52, customerLng: 74.33, etaMinutes: 12 },
    }) as any);
    expect(v.rider).toEqual({ name: 'Hamza', phone: '03001234567' });
    expect(v.riderPos).toEqual({ lat: 31.51, lng: 74.31 });
    expect(v.customerPos).toEqual({ lat: 31.52, lng: 74.33 });
    expect(v.etaMinutes).toBe(12);
    expect(v.showMap).toBe(true);
  });

  it('never invents a position: no numbers, no map; zero is a real coordinate', () => {
    expect(trackingView(base({ riderName: 'Hamza' }) as any).showMap).toBe(false);
    expect(trackingView(base({ delivery: { riderLat: '31.5', riderLng: null } }) as any).riderPos).toBeNull();
    expect(trackingView(base({ delivery: { riderLat: 0, riderLng: 0 } }) as any).riderPos).toEqual({ lat: 0, lng: 0 });
  });
});

describe('the panel draws what trackingView says', () => {
  it('shows the steps in order with their states', async () => {
    m = mount(<OrderTrackingPanel order={base({ deliveryStatus: 'rider_picked' }) as any} />);
    await flush();
    const rows = Array.from(document.body.querySelectorAll('[data-step]')) as HTMLElement[];
    expect(rows.map(r => `${r.dataset.step}:${r.dataset.state}`)).toEqual([
      'placed:done', 'cooking:done', 'ready:done', 'onway:done', 'delivered:current',
    ]);
  });

  it('shows the rider, a call link and the map with the live position and the branch', async () => {
    m = mount(<OrderTrackingPanel branch={{ lat: 31.5, lng: 74.3 }} order={base({
      deliveryStatus: 'onway', riderName: 'Hamza', riderPhone: '0300 1234567',
      delivery: { riderLat: 31.51, riderLng: 74.31, customerLat: 31.52, customerLng: 74.33, etaMinutes: 9 },
    }) as any} />);
    await flush();
    expect(q('[data-tracking-rider]')!.textContent).toContain('Hamza');
    expect(q<HTMLAnchorElement>('[data-tracking-rider] a')!.getAttribute('href')).toBe('tel:0300 1234567');
    const map = q('[data-map]')!;
    expect(map.getAttribute('data-rider')).toBe('31.51,74.31');
    expect(map.getAttribute('data-customer')).toBe('31.52,74.33');
    expect(map.getAttribute('data-branch')).toBe('31.5,74.3');
    expect(q('[data-tracking-eta]')!.textContent).toContain('9 min');
  });

  it('says so while the rider has not sent a location yet, and hides ETA once finished', async () => {
    m = mount(<OrderTrackingPanel order={base({ deliveryStatus: 'rider_assigned', riderName: 'Hamza', delivery: { customerLat: 31.52, customerLng: 74.33, etaMinutes: 9 } }) as any} />);
    await flush();
    expect(q('[data-tracking-map]')!.textContent).toContain("Waiting for the rider's location");
    m.unmount();
    m = mount(<OrderTrackingPanel order={base({ deliveryStatus: 'delivered', riderName: 'Hamza', delivery: { customerLat: 31.52, customerLng: 74.33, etaMinutes: 9 } }) as any} />);
    await flush();
    expect(q('[data-tracking-eta]')).toBeNull();
  });

  it('a cancelled order shows no progress list; no rider means no rider card', async () => {
    m = mount(<OrderTrackingPanel order={base({ deliveryStatus: 'cancelled' }) as any} />);
    await flush();
    expect(q('[data-tracking-progress]')).toBeNull();
    expect(q('[data-tracking-rider]')).toBeNull();
  });
});

describe('the software shows the same tracking and follows it live', () => {
  it('opens on an order and draws the same panel', async () => {
    store.orders = [base({ deliveryStatus: 'onway', riderName: 'Hamza', customer: { name: 'Sara Khan' }, delivery: { riderLat: 31.51, riderLng: 74.31, customerLat: 31.52, customerLng: 74.33 } })];
    m = mount(<OrderTrackingDialog orderId="o1" onClose={() => {}} />);
    await flush();
    expect(q('[data-testid="order-tracking-dialog"]')!.textContent).toContain('Order #218');
    expect(q('[data-order-tracking="o1"]')).toBeTruthy();
    expect(q('[data-map]')!.getAttribute('data-rider')).toBe('31.51,74.31');
    expect(q('[data-map]')!.getAttribute('data-branch')).toBe('31.5,74.3');
  });

  it('moves when the store says orders changed — a new rider position, a new step', async () => {
    store.orders = [base({ deliveryStatus: 'rider_assigned', riderName: 'Hamza', delivery: { riderLat: 31.51, riderLng: 74.31, customerLat: 31.52, customerLng: 74.33 } })];
    m = mount(<OrderTrackingDialog orderId="o1" onClose={() => {}} />);
    await flush();
    expect(q('[data-step="onway"]')!.getAttribute('data-state')).not.toBe('done');
    store.orders = [base({ deliveryStatus: 'onway', riderName: 'Hamza', delivery: { riderLat: 31.515, riderLng: 74.318, customerLat: 31.52, customerLng: 74.33 } })];
    await act(async () => { store.listeners.forEach(cb => cb('orders')); });
    await flush();
    expect(q('[data-step="onway"]')!.getAttribute('data-state')).toBe('done');
    expect(q('[data-map]')!.getAttribute('data-rider')).toBe('31.515,74.318');
  });

  it('asks the cloud for a refresh every 15 s while the order is moving, and stops when it is finished', async () => {
    vi.useFakeTimers();
    store.orders = [base({ deliveryStatus: 'onway', riderName: 'Hamza' })];
    m = mount(<OrderTrackingDialog orderId="o1" onClose={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_100); });
    expect(store.refreshed).toBe(1);
    store.orders = [base({ deliveryStatus: 'delivered', riderName: 'Hamza' })];
    await act(async () => { store.listeners.forEach(cb => cb('orders')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(store.refreshed).toBe(1);
  });

  it('closed (no order id) draws nothing, and an order that left the device says so', async () => {
    m = mount(<OrderTrackingDialog orderId={null} onClose={() => {}} />);
    await flush();
    expect(q('[data-testid="order-tracking-dialog"]')).toBeNull();
    m.unmount();
    m = mount(<OrderTrackingDialog orderId="gone" onClose={() => {}} />);
    await flush();
    expect(q('[data-testid="order-tracking-dialog"]')!.textContent).toContain('no longer on this device');
  });
});

describe('where it is wired', () => {
  const board = read('src/pages/DeliveryBoardPage.tsx');
  const track = read('src/pages/TrackOrderPage.tsx');
  const live = read('src/pages/LiveRidersMapPage.tsx');
  it('the Delivery Board has a Live tracking button per card, opens the dialog, and follows the store', () => {
    expect(board).toMatch(/data-track-order=\{order\.id\}/);
    expect(board).toMatch(/<OrderTrackingDialog orderId=\{trackingId\}/);
    expect(board).toMatch(/onDataChange\(col => \{[\s\S]*col !== 'orders'/);
  });
  it('the Live Riders map follows the store', () => {
    expect(live).toMatch(/onDataChange\(col => \{[\s\S]*setOrders\(getOrders\(\)\)/);
  });
  it("the customer's page draws the shared panel and has no private copy of the steps", () => {
    expect(track).toMatch(/<OrderTrackingPanel/);
    expect(track).toMatch(/trackingView\(order\)/);
    expect(track).not.toMatch(/Kitchen Cooking/);
    expect(track).not.toMatch(/DeliveryRouteMap/);
  });

  it('the rider app reminds a rider who is not Live, and switches a rider who never chose on at their first claim', () => {
    const rider = read('src/pages/RiderAppPage.tsx');
    expect(rider).toMatch(/myOrders\.length > 0 && !tracking && \(\s*<Card data-rider-live-reminder/);
    expect(rider).toMatch(/localStorage\.getItem\('rider-tracking'\) === null\) \{ localStorage\.setItem\('rider-tracking', '1'\); setTracking\(true\); \}/);
  });
});
