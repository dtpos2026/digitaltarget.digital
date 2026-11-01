// ============================================================================
// RIDER GPS PING POLICY — how often a rider's position is allowed to reach the database.
//
// WHY THIS EXISTS (v1.77.0, egress): the rider app saved the order on EVERY GPS fix. With high accuracy on, a phone in
// a moving vehicle reports about once a second, and each save
//   • sends the whole order (its `data` JSON, which also carried up to 200 route points),
//   • makes the database delete and re-insert every row of that order's items (`sync_order_items_mirror` runs on each
//     orders write), and
//   • is read back by every till that pulls orders.
// One rider on one order for one hour was therefore ~3,600 full-order writes. The customer's map does not need that:
// it refreshes every ~15–20 s and a person cannot see a 5 m move on a map.
//
// The rule, in one place so the rider app and the tests agree:
//   send a ping when the rider has moved at least MIN_MOVE_M since the last one AND MIN_INTERVAL_MS has passed,
//   or — standing still — every HEARTBEAT_MS, so "Live" does not look dead;
//   keep a route point only every ROUTE_EVERY_MS / ROUTE_MIN_MOVE_M, and never more than ROUTE_MAX_POINTS.
// The rider's own screen still follows every fix; only the database write is rationed.
// ============================================================================

export const MIN_INTERVAL_MS = 15_000;
export const HEARTBEAT_MS = 90_000;
export const MIN_MOVE_M = 20;
export const ROUTE_EVERY_MS = 60_000;
export const ROUTE_MIN_MOVE_M = 120;
export const ROUTE_MAX_POINTS = 60;

export interface PingPoint { lat: number; lng: number; at: number }
export interface RoutePoint { lat: number; lng: number; t: string }

const R = 6_371_000;
/** Great-circle distance in metres. Self-contained so the policy has no dependency on the delivery module. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const valid = (p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Whether a new fix should be written to the database, given the last position that was written. */
export function shouldSendPing(last: PingPoint | null, next: PingPoint): boolean {
  if (!valid(next)) return false;
  if (!last) return true;
  const elapsed = next.at - last.at;
  if (elapsed < 0) return true;                       // the clock moved back: do not get stuck silent
  if (elapsed >= HEARTBEAT_MS) return true;
  if (elapsed < MIN_INTERVAL_MS) return false;
  return metresBetween(last, next) >= MIN_MOVE_M;
}

/**
 * The route with this fix added, or the same array when the fix is too close in time and space to the last point.
 * Returns the SAME array reference when nothing is added, so callers can skip a rewrite.
 */
export function appendRoutePoint(route: RoutePoint[] | undefined, p: PingPoint): RoutePoint[] {
  const list = route || [];
  const last = list[list.length - 1];
  if (last) {
    const lastAt = Date.parse(last.t);
    const sinceMs = Number.isFinite(lastAt) ? p.at - lastAt : Infinity;
    if (sinceMs < ROUTE_EVERY_MS && metresBetween(last, p) < ROUTE_MIN_MOVE_M) return list;
  }
  const next = [...list, { lat: p.lat, lng: p.lng, t: new Date(p.at).toISOString() }];
  return next.length > ROUTE_MAX_POINTS ? next.slice(-ROUTE_MAX_POINTS) : next;
}
