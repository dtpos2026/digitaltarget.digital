// ============================================================================
// v1.77.0 — rider GPS pings are rationed.
//
// Before: the rider app saved the order on every GPS fix (about one a second in a moving vehicle). Each save re-sent
// the whole order (with up to 200 route points) and made the database rebuild the order's item rows.
// After: a write needs 15 s AND 20 m, or a 90 s heartbeat; the route keeps a point per minute or per 120 m, max 60.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shouldSendPing, appendRoutePoint, metresBetween,
  MIN_INTERVAL_MS, HEARTBEAT_MS, MIN_MOVE_M, ROUTE_EVERY_MS, ROUTE_MAX_POINTS,
  type PingPoint, type RoutePoint,
} from '@/lib/riderPing';

// ~1 degree of latitude is 111.2 km, so 0.0001 degree is about 11 m.
const at = (lat: number, lng: number, t: number): PingPoint => ({ lat, lng, at: t });
const T0 = 1_700_000_000_000;

describe('metresBetween', () => {
  it('is zero for the same point and about 111 m for 0.001 degree of latitude', () => {
    expect(metresBetween({ lat: 31.5, lng: 74.3 }, { lat: 31.5, lng: 74.3 })).toBe(0);
    const m = metresBetween({ lat: 31.5, lng: 74.3 }, { lat: 31.501, lng: 74.3 });
    expect(m).toBeGreaterThan(105);
    expect(m).toBeLessThan(118);
  });
});

describe('shouldSendPing', () => {
  const first = at(31.5, 74.3, T0);

  it('always sends the first position', () => {
    expect(shouldSendPing(null, first)).toBe(true);
  });

  it('never sends a fix that is not a number', () => {
    expect(shouldSendPing(null, at(NaN, 74.3, T0))).toBe(false);
    expect(shouldSendPing(first, at(31.5, Infinity, T0 + 60_000))).toBe(false);
  });

  it('holds back fixes that arrive faster than the interval, however far the rider moved', () => {
    expect(shouldSendPing(first, at(31.51, 74.3, T0 + MIN_INTERVAL_MS - 1))).toBe(false);
  });

  it('holds back a fix after the interval when the rider has hardly moved', () => {
    expect(shouldSendPing(first, at(31.50001, 74.3, T0 + MIN_INTERVAL_MS + 1))).toBe(false);
  });

  it('sends once the interval has passed AND the rider moved enough', () => {
    const moved = at(31.5 + (MIN_MOVE_M + 5) / 111_200, 74.3, T0 + MIN_INTERVAL_MS);
    expect(shouldSendPing(first, moved)).toBe(true);
  });

  it('sends a heartbeat when the rider stands still, so "Live" does not look dead', () => {
    expect(shouldSendPing(first, at(31.5, 74.3, T0 + HEARTBEAT_MS))).toBe(true);
    expect(shouldSendPing(first, at(31.5, 74.3, T0 + HEARTBEAT_MS - 1))).toBe(false);
  });

  it('does not stay silent if the phone clock moves backwards', () => {
    expect(shouldSendPing(first, at(31.5, 74.3, T0 - 5_000))).toBe(true);
  });

  it('turns an hour at one fix per second into a few hundred writes at most, not 3,600', () => {
    // A rider driving ~10 m/s (36 km/h), one fix a second.
    let last: PingPoint | null = null;
    let sent = 0;
    for (let s = 0; s < 3600; s++) {
      const p = at(31.5 + (s * 10) / 111_200, 74.3, T0 + s * 1000);
      if (shouldSendPing(last, p)) { last = p; sent++; }
    }
    expect(sent).toBeLessThanOrEqual(3600 / (MIN_INTERVAL_MS / 1000) + 1);   // one per 15 s while moving
    expect(sent).toBeGreaterThan(200);                                         // and it does keep reporting
  });

  it('a rider standing still for an hour costs under 50 writes', () => {
    let last: PingPoint | null = null;
    let sent = 0;
    for (let s = 0; s < 3600; s++) {
      const p = at(31.5, 74.3, T0 + s * 1000);
      if (shouldSendPing(last, p)) { last = p; sent++; }
    }
    expect(sent).toBeLessThanOrEqual(3600 / (HEARTBEAT_MS / 1000) + 1);
  });
});

describe('appendRoutePoint', () => {
  const pt = (lat: number, t: number): PingPoint => ({ lat, lng: 74.3, at: t });
  const iso = (t: number) => new Date(t).toISOString();

  it('starts a route', () => {
    const r = appendRoutePoint(undefined, pt(31.5, T0));
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ lat: 31.5, lng: 74.3, t: iso(T0) });
  });

  it('returns the SAME array when the new fix is close in time and place (nothing to rewrite)', () => {
    const route: RoutePoint[] = [{ lat: 31.5, lng: 74.3, t: iso(T0) }];
    expect(appendRoutePoint(route, pt(31.50005, T0 + 20_000))).toBe(route);
  });

  it('adds a point after a minute even if the rider has not moved', () => {
    const route: RoutePoint[] = [{ lat: 31.5, lng: 74.3, t: iso(T0) }];
    expect(appendRoutePoint(route, pt(31.5, T0 + ROUTE_EVERY_MS))).toHaveLength(2);
  });

  it('adds a point sooner when the rider has moved far', () => {
    const route: RoutePoint[] = [{ lat: 31.5, lng: 74.3, t: iso(T0) }];
    expect(appendRoutePoint(route, pt(31.5 + 200 / 111_200, T0 + 20_000))).toHaveLength(2);
  });

  it('never grows beyond the cap, and keeps the newest points', () => {
    let route: RoutePoint[] = [];
    for (let i = 0; i < ROUTE_MAX_POINTS + 25; i++) route = appendRoutePoint(route, pt(31.5 + i * 0.01, T0 + i * ROUTE_EVERY_MS));
    expect(route).toHaveLength(ROUTE_MAX_POINTS);
    expect(route[route.length - 1].lat).toBeCloseTo(31.5 + (ROUTE_MAX_POINTS + 24) * 0.01, 6);
  });

  it('copes with a route point whose time cannot be read', () => {
    const route: RoutePoint[] = [{ lat: 31.5, lng: 74.3, t: 'not a date' }];
    expect(appendRoutePoint(route, pt(31.5, T0))).toHaveLength(2);
  });
});

describe('the rider app uses the policy', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/pages/RiderAppPage.tsx'), 'utf8');

  it('asks the policy before every order write, per order', () => {
    expect(src).toContain("shouldSendPing(lastPingRef.current.get(o.id) || null, point)");
    expect(src).toContain('appendRoutePoint(delivery.route, point)');
  });

  it('no longer writes an order on every fix', () => {
    // The old shape: an unconditional saveOrder inside the position callback, route sliced to 200.
    expect(src).not.toContain('.slice(-200)');
  });

  it('still moves the rider\'s own dot on every fix', () => {
    const cb = src.indexOf('navigator.geolocation.watchPosition');
    expect(cb).toBeGreaterThan(-1);
    const body = src.slice(cb, cb + 1200);
    expect(body.indexOf('setMyPos')).toBeGreaterThan(-1);
    expect(body.indexOf('setMyPos')).toBeLessThan(body.indexOf('shouldSendPing'));
  });
});
