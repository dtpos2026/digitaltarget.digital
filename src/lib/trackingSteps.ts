// ============================================================================
// ORDER TRACKING — one definition of "where is this order", for every screen.
//
// REQUESTED (v1.75.0): the customer on the web sees the order move and where the rider is; the same tracking must
// show in the software, and the web app and the Windows app must show exactly the same thing.
//
// Before this, the steps were worked out inside TrackOrderPage (customer site), a second copy sat in
// CustomerOrderTracker (signed-in customers) and the software's Delivery Board had no tracking view at all. Three
// answers to one question is how two screens end up disagreeing. This file is the single answer: pure functions of an
// Order, no React, no network.
// ============================================================================
import type { Order } from '@/lib/types';

export type TrackStepKey = 'placed' | 'cooking' | 'ready' | 'onway' | 'delivered' | 'served';
export type TrackStepIcon = 'check' | 'chef' | 'package' | 'bike';

export interface TrackStep {
  key: TrackStepKey;
  label: string;
  icon: TrackStepIcon;
  done: boolean;
  /** ISO time the step happened, when it is known. */
  at?: string;
}

export interface LatLng { lat: number; lng: number }

export interface TrackingView {
  isDineIn: boolean;
  isCancelled: boolean;
  steps: TrackStep[];
  /** Index of the step in progress, or -1 when finished or cancelled. */
  activeIndex: number;
  /** The one phrase for "the status right now". */
  currentLabel: string;
  rider: { name: string; phone?: string } | null;
  /** Live rider position, when the rider app has sent one. */
  riderPos: LatLng | null;
  customerPos: LatLng | null;
  etaMinutes: number | null;
  /** True when there is something worth drawing on a map. */
  showMap: boolean;
  /** True once nothing further will change (delivered, served, cancelled) — callers can stop polling. */
  finished: boolean;
}

/** Stages from which the food has left the kitchen. (rider_assigned is not one: a rider may take an order that is still cooking.) */
const OUT_OF_KITCHEN = ['ready', 'onway', 'rider_picked', 'rider_reached', 'delivered'];
/** Stages in which the rider has the order. */
const WITH_RIDER = ['onway', 'rider_picked', 'rider_reached', 'delivered'];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (lat: unknown, lng: unknown): LatLng | null => (finite(lat) && finite(lng) ? { lat, lng } : null);

export function trackingView(order: Order): TrackingView {
  const ds = order.deliveryStatus || 'pending';
  const ks = order.kitchenStatus || 'pending';
  const o = order as any;
  const isDineIn = !!o.tableLabel || o.orderType === 'dining' || o.orderType === 'dine-in' || o.type === 'dine-in';
  const isCancelled = ds === 'cancelled';
  const kitchenCooking = ks === 'preparing' || ks === 'ready' || ks === 'served';
  const kitchenReady = ks === 'ready' || ks === 'served';

  const steps: TrackStep[] = isDineIn
    ? [
        { key: 'placed', label: 'Order Placed', icon: 'check', done: true, at: order.createdAt },
        { key: 'cooking', label: 'Kitchen Cooking', icon: 'chef', done: kitchenCooking, at: order.kitchenStatusAt },
        { key: 'ready', label: 'Ready to Serve', icon: 'package', done: kitchenReady },
        { key: 'served', label: 'Served', icon: 'check', done: ks === 'served', at: o.servedAt },
      ]
    : [
        { key: 'placed', label: 'Order Placed', icon: 'check', done: true, at: order.createdAt },
        { key: 'cooking', label: 'Kitchen Cooking', icon: 'chef', done: kitchenCooking || ds === 'cooking' || OUT_OF_KITCHEN.includes(ds), at: order.kitchenStatusAt },
        { key: 'ready', label: 'Ready for Pickup', icon: 'package', done: kitchenReady || OUT_OF_KITCHEN.includes(ds) },
        { key: 'onway', label: 'On the Way', icon: 'bike', done: WITH_RIDER.includes(ds), at: order.delivery?.onTheWayAt || order.dispatchedAt },
        { key: 'delivered', label: 'Delivered', icon: 'check', done: ds === 'delivered', at: order.deliveredAt },
      ];

  const activeIndex = isCancelled ? -1 : steps.findIndex(s => !s.done);
  const completedLabel = isDineIn ? 'Served' : 'Delivered';
  const currentLabel = isCancelled ? 'Cancelled' : activeIndex === -1 ? completedLabel : steps[activeIndex - 1]?.label || 'Order Placed';

  const d = order.delivery;
  const riderPos = pos(d?.riderLat, d?.riderLng);
  const customerPos = pos(d?.customerLat, d?.customerLng);
  const eta = d?.etaMinutes;

  return {
    isDineIn,
    isCancelled,
    steps,
    activeIndex,
    currentLabel,
    rider: order.riderName ? { name: order.riderName, phone: order.riderPhone || undefined } : null,
    riderPos,
    customerPos,
    etaMinutes: finite(eta) ? eta : null,
    showMap: !!(riderPos || customerPos),
    finished: isCancelled || activeIndex === -1,
  };
}
