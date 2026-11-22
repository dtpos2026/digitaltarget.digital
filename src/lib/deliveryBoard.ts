// v1.138.0 — the Delivery board as the design draws it (SW-08): Pending · Cooking · Ready · Rider assigned · On the way (and, behind a
// toggle, Delivered · Cancelled), a rider strip on top ("Ali · 1 order", "Kamran · offline"), and on a card the order, the total, who,
// where and how far — with ONE button (Advance, or Assign rider once it is ready). Pure: orders and riders in, words and groups out.
//
// The old board had no column for an order a rider has been given, nor for one only accepted, nor for one the rider has picked up or
// reached: such an order simply disappeared from the board. Every delivery status now lands in exactly one column.
import type { DeliveryStatus, Order, Rider } from './types';

export type DeliveryColumn = 'pending' | 'cooking' | 'ready' | 'assigned' | 'onway' | 'delivered' | 'cancelled';

export const DELIVERY_COLUMNS: { key: DeliveryColumn; label: string; /** the status a card takes when it is moved here */ status: DeliveryStatus }[] = [
  { key: 'pending', label: 'Pending', status: 'pending' },
  { key: 'cooking', label: 'Cooking', status: 'cooking' },
  { key: 'ready', label: 'Ready', status: 'ready' },
  { key: 'assigned', label: 'Rider assigned', status: 'rider_assigned' },
  { key: 'onway', label: 'On the way', status: 'onway' },
  { key: 'delivered', label: 'Delivered', status: 'delivered' },
  { key: 'cancelled', label: 'Cancelled', status: 'cancelled' },
];
/** The five the design draws; Delivered and Cancelled are history and sit behind a toggle. */
export const ACTIVE_COLUMNS: DeliveryColumn[] = ['pending', 'cooking', 'ready', 'assigned', 'onway'];

/** Which column an order sits in. "Accepted" is still waiting for the kitchen; "picked up" and "reached" are on the road. */
export function deliveryColumn(status: DeliveryStatus | undefined): DeliveryColumn {
  switch (status) {
    case 'cooking': return 'cooking';
    case 'ready': return 'ready';
    case 'rider_assigned': return 'assigned';
    case 'rider_picked': case 'onway': case 'rider_reached': return 'onway';
    case 'delivered': return 'delivered';
    case 'cancelled': return 'cancelled';
    default: return 'pending';
  }
}

export function columnStatus(col: DeliveryColumn): DeliveryStatus {
  return DELIVERY_COLUMNS.find(c => c.key === col)!.status;
}

export const isActiveDelivery = (o: Pick<Order, 'deliveryStatus'>): boolean => ACTIVE_COLUMNS.includes(deliveryColumn(o.deliveryStatus));

export type Advance = { kind: 'status'; label: 'Advance'; to: DeliveryStatus } | { kind: 'assign'; label: 'Assign rider' } | null;

/** The one button on a card: move it on, or — once it is cooked — give it to a rider. Past that the rider's own app moves it. */
export function advanceFor(col: DeliveryColumn): Advance {
  if (col === 'pending') return { kind: 'status', label: 'Advance', to: 'cooking' };
  if (col === 'cooking') return { kind: 'status', label: 'Advance', to: 'ready' };
  if (col === 'ready') return { kind: 'assign', label: 'Assign rider' };
  return null;
}

/** "7 active · 2 riders online". */
export function boardSubtitle(active: number, ridersOnline: number): string {
  return `${active} active · ${ridersOnline} ${ridersOnline === 1 ? 'rider' : 'riders'} online`;
}

export interface RiderChip { id: string; name: string; online: boolean; orders: number; label: string }

/**
 * One chip per rider: "Ali · 1 order", "Hamza · 2 orders", "Kamran · offline". Online riders first, busiest first.
 * `online` is decided by the caller (a recent heartbeat), so the rule lives in one place.
 */
export function riderStrip(riders: Pick<Rider, 'id' | 'name' | 'isActive'>[], orders: Pick<Order, 'riderId' | 'deliveryStatus'>[], isOnline: (id: string) => boolean): RiderChip[] {
  return riders.filter(r => r.isActive).map(r => {
    const mine = orders.filter(o => o.riderId === r.id && isActiveDelivery(o)).length;
    const online = isOnline(r.id);
    const label = !online ? `${r.name} · offline` : mine > 0 ? `${r.name} · ${mine} ${mine === 1 ? 'order' : 'orders'}` : `${r.name} · free`;
    return { id: r.id, name: r.name, online, orders: mine, label };
  }).sort((a, b) => Number(b.online) - Number(a.online) || b.orders - a.orders || a.name.localeCompare(b.name));
}

/** "Sara K." — the first name and the initial of the last, as the design shows it. */
export function shortName(name?: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Customer';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "Gulberg · 2.4 km" — the area (else the first part of the address), then the distance when it is known. */
export function placeLabel(o: Pick<Order, 'customer' | 'delivery'>): string {
  const c = o.customer;
  const area = (c?.area || c?.society || '').trim() || String(c?.address || '').split(',')[0].trim();
  const km = o.delivery?.distanceFromRestaurantKm ?? o.delivery?.distanceKm;
  const dist = typeof km === 'number' && Number.isFinite(km) ? `${km.toFixed(1)} km` : '';
  return [area.length > 26 ? `${area.slice(0, 25)}…` : area, dist].filter(Boolean).join(' · ');
}
