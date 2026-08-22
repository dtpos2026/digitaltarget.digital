// ============================================================================
// TRACKED ORDER — normalising what the public tracking endpoint returns
//
// public_track_order() is an RPC, not a table read, so its result never passes
// through rowFromDb(). Both store.getOrderFromCloudById() and
// getOrderFromCloudByLookup() used to cast the raw jsonb straight to `Order`
// and hand it to the UI.
//
// That cast was a lie in two directions, and the page paid for both:
//
//   * MISSING FIELDS. The function returned thirteen columns and `items` was
//     not among them, so `order.items` was undefined and TrackOrderPage threw
//     "Cannot read properties of undefined (reading 'length')" before it
//     rendered anything. subtotal and discount were absent too.
//
//   * WRONG NAMES. to_jsonb() of a record yields COLUMN names, so the payload
//     was snake_case (order_number, grand_total, kitchen_status, ...) while
//     every reader expects camelCase. Those fields did not crash — they just
//     silently rendered blank or NaN, which is worse to diagnose.
//
// v1.26.2 fixes the function to return the right shape. This normaliser is the
// second line of defence: a device running against a database that has not had
// the migration applied yet — or any future field that quietly goes missing —
// gets safe defaults instead of a white screen.
// ============================================================================
import type { Order } from './types';

function num(...vals: unknown[]): number {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/** One tracked line. Anything unusable is replaced, never dropped. */
function normalizeItem(raw: any, index: number): Record<string, any> {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    ...r,
    id: firstString(r.id, r.lineId) || `line-${index}`,
    name: firstString(r.name, r.itemName, r.menuItemName) || 'Item',
    quantity: Number(r.quantity ?? r.qty) || 1,
    lineTotal: num(r.lineTotal, r.line_total, r.total, r.amount),
  };
}

/**
 * Turn whatever the tracking endpoint returned into something the tracker can
 * render. Returns null only when there is genuinely no order.
 *
 * Every array is an array and every money field is a number, so `.length`,
 * `.map()` and arithmetic are always safe on the result.
 */
export function normalizeTrackedOrder(raw: unknown): Order | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;
  if (!r.id && !r.orderNumber && !r.order_number) return null;

  const items = Array.isArray(r.items) ? r.items
    : Array.isArray(r.order_items) ? r.order_items
    : [];
  const payments = Array.isArray(r.payments) ? r.payments : [];
  const delivery = r.delivery && typeof r.delivery === 'object' && !Array.isArray(r.delivery)
    ? r.delivery : undefined;

  return {
    ...r,
    id: String(r.id ?? ''),
    orderNumber: Number(r.orderNumber ?? r.order_number) || 0,
    status: firstString(r.status) || 'running',
    orderType: firstString(r.orderType, r.order_type) || 'takeaway',
    tableLabel: firstString(r.tableLabel, r.table_label),

    items: items.map(normalizeItem),
    payments,

    subtotal: num(r.subtotal),
    discount: Number(r.discount ?? r.discount_amount) || 0,
    tax: Number(r.tax ?? r.tax_amount) || 0,
    // `total` is the column the POS writer fills; `grand_total` is the one the
    // customer-website writer fills. Neither writes both, so try all three.
    grandTotal: num(r.grandTotal, r.grand_total, r.total, r.subtotal),

    kitchenStatus: firstString(r.kitchenStatus, r.kitchen_status),
    kitchenStatusAt: firstString(r.kitchenStatusAt, r.kitchen_status_at),
    deliveryStatus: firstString(r.deliveryStatus, r.delivery_status),
    riderName: firstString(r.riderName, r.rider_name),
    riderPhone: firstString(r.riderPhone, r.rider_phone),
    dispatchedAt: firstString(r.dispatchedAt, r.dispatched_at),
    deliveredAt: firstString(r.deliveredAt, r.delivered_at),
    createdAt: firstString(r.createdAt, r.created_at) || new Date().toISOString(),
    ...(delivery ? { delivery } : {}),
  } as unknown as Order;
}
