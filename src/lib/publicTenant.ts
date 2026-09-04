// Public routes (/order, /track, /rider-portal) get their tenant from the URL.
// Format supported:
//   #/order/{tenantId}
//   #/order?t={tenantId}
//   #/track/{tenantId}   or   #/track?t={tenantId}&o=...&p=...
//   #/rider-portal/{tenantId}
//
// We override the local tenant BEFORE initStore() so all reads/writes go to the right restaurant.

import { setTenant, getTenantId } from './tenant';

// ===== v1.29.5 — a packaged app is built for ONE restaurant =====
//
// REPORTED: "customer APK ko pata hona chahiye ke wo kis restaurant ka hai aur
// sara data wahin jaye."
//
// scripts/build-app.mjs stamps the restaurant into the bundle's index.html, in
// <head>, before any application code runs — so this is a plain synchronous
// read, not a fetch. (dt-app.json carries the same id, but reading it is async
// and the tenant has to be settled before initStore().)
//
// A browser has no such stamp and gets null, which is correct: the website
// serves every restaurant and takes the one in the link.
declare global {
  // eslint-disable-next-line no-var
  var __DT_APP_TENANT__: string | undefined;
}

export function packagedTenantId(): string | null {
  try {
    const v = (globalThis as { __DT_APP_TENANT__?: unknown }).__DT_APP_TENANT__;
    return typeof v === 'string' && v.length >= 4 ? v : null;
  } catch {
    return null;
  }
}

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

/**
 * Is this a slug rather than a tenant uuid?
 *
 * REPORTED: "jo link bane customer order website ka, mere domain sath ho —
 * digitaltarget.digital/buttbbqorder". Every tenant already has a slug, so a
 * readable link only needs the slug turned back into the id the app routes on.
 */
export function looksLikeSlug(v: string | null | undefined): boolean {
  if (!v) return false;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return !UUID.test(v) && /^[a-z0-9][a-z0-9-]{1,60}$/i.test(v);
}

/**
 * Turn a slug in the URL into a real tenant, once.
 *
 * Kept OUT of applyPublicTenantFromUrl because that one must stay synchronous —
 * it runs before initStore() and the tenant has to be settled by then. A uuid
 * link therefore behaves exactly as it always did, with no await anywhere near
 * the boot path; only a slug link pays for a round trip, and only on first open.
 */
export async function resolveSlugTenant(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const raw = parsePublicTenantId();
  if (!looksLikeSlug(raw)) return null;
  try {
    const { sb, isSupabaseConfigured } = await import('./supabase');
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await sb().rpc('public_tenant_by_slug' as never, { p_slug: raw } as never);
    if (error) return null;
    const id = (data as { tenantId?: string } | null)?.tenantId ?? null;
    if (id) setTenant(id, (data as { name?: string }).name);
    return id;
  } catch {
    return null;
  }
}

/** Apply tenant from URL synchronously — must be called BEFORE initStore() on public routes. */
export function applyPublicTenantFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const packaged = packagedTenantId();

  if (!isPublicTenantRoute()) {
    // Off a public route, the packaged id is used ONLY to give a fresh install
    // its restaurant. Deliberately not "always force it": this runs on every
    // App render, and a rider or order taker who has signed in has already had
    // their tenant set by staffPortalAuth. Overwriting it here every render
    // would fight that sign-in.
    if (packaged && !getTenantId()) setTenant(packaged);
    return getTenantId();
  }

  // On a public route the LINK still decides — a customer who opens a specific
  // restaurant's link inside any build gets that restaurant. The packaged id is
  // the fallback for a link that carries none.
  const tid = parsePublicTenantId() ?? packaged;
  if (tid && tid !== getTenantId()) {
    setTenant(tid);
  }
  return getTenantId();
}
