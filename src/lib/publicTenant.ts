// Public routes (/order, /track, /rider-portal) get their tenant from the URL.
// Format supported:
//   #/order/{tenantId}
//   #/order?t={tenantId}
//   #/track/{tenantId}   or   #/track?t={tenantId}&o=...&p=...
//   #/rider-portal/{tenantId}
//
// We override the local tenant BEFORE initStore() so all reads/writes go to the right restaurant.

import { setTenant, getTenantId } from './tenant';

// v1.20.1 — '#/reset-password' belongs here for a different reason than the
// rest. The others are tenant-scoped customer pages; this one is a route that
// must render for someone who CANNOT sign in — that is the entire point of a
// password reset. Gating it behind the login screen would make the emailed
// link useless.
//
// It carries no tenant id, so parsePublicTenantId() returns null and
// applyPublicTenantFromUrl() leaves the current tenant untouched.
const PUBLIC_PREFIXES = ['#/order', '#/track', '#/rider-portal', '#/order-taker', '#/reset-password'];

export function isPublicTenantRoute(hash?: string): boolean {
  const h = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  return PUBLIC_PREFIXES.some(p => h.startsWith(p));
}

/** Parse tenantId out of `#/order/abcd` or `#/order?t=abcd`. Returns null if absent. */
export function parsePublicTenantId(hash?: string): string | null {
  const h = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  if (!h) return null;
  // strip leading "#"
  const raw = h.startsWith('#') ? h.slice(1) : h;
  const [path, query = ''] = raw.split('?');
  // path style: /order/{tid} or /track/{tid} or /rider-portal/{tid}
  const parts = path.split('/').filter(Boolean); // ["order","abc"] or ["rider-portal","abc"]
  if (parts.length >= 2 && ['order', 'track', 'rider-portal', 'order-taker'].includes(parts[0])) {
    const candidate = parts[1];
    if (candidate && candidate.length >= 4) return decodeURIComponent(candidate);
  }
  // query style ?t=abc
  if (query) {
    const qs = new URLSearchParams(query);
    const t = qs.get('t') || qs.get('tenant');
    if (t) return t;
  }
  return null;
}

/** Apply tenant from URL synchronously — must be called BEFORE initStore() on public routes. */
export function applyPublicTenantFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (!isPublicTenantRoute()) return getTenantId();
  const tid = parsePublicTenantId();
  if (tid && tid !== getTenantId()) {
    setTenant(tid);
  }
  return getTenantId();
}
