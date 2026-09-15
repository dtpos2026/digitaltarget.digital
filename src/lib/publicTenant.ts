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
  if (UUID.test(v)) return false;

  // v1.56.1 — the /i flag here would have broken every link already printed.
  //
  // The restaurant's existing links look like
  //   https://digitaltarget.digital/#/order/wPVCIB1zx8fZtPrvVzcBLR0poM73
  // — a 28-character Firebase uid from the original hosting. Case-insensitive,
  // that matched the slug pattern, so this said "slug", the lookup found no
  // restaurant of that name, and the link that had worked for a year would
  // have started failing.
  //
  // Slugs are GENERATED, and generated lowercase with hyphens ('butt',
  // 'butt-bbq', 'butt-grilled-fish-restaurant'). An id is not. Two rules, both
  // drawn from the live data rather than guessed:
  //   * any uppercase letter means it is an id, not a slug;
  //   * a long unbroken alphanumeric run with no hyphen is an id too — no
  //     slug the generator produces is 20+ characters without one.
  if (/[A-Z]/.test(v)) return false;
  if (!v.includes('-') && v.length >= 20) return false;
  return /^[a-z0-9][a-z0-9-]{1,60}$/.test(v);
}

// ===== v1.56.1 — the readable link broke every page that used it =====
//
// REPORTED: "phly is type ky auto link hoty thy website or order taker, ye usi
// restaurant py rhta tha, na ky koi error aty thy, lkn jb sy apny change kyi
// han ... who shi nhi han", and "rider web order taker mean all portal py
// refresh ky data show ni krty".
//
// Both are the same fault, and it is here. v1.42.0 started handing out
// `/#/order/butt` instead of `/#/order/<uuid>` so the link would carry the
// restaurant's name. But applyPublicTenantFromUrl() takes whatever is in that
// URL segment and calls setTenant() with it — so the tenant id became the
// literal string "butt", and every read after it asked for
// `tenant_id = 'butt'`. There is no such restaurant.
//
// Worse in two ways:
//
//   1. applyPublicTenantFromUrl() runs on EVERY App render, not once. So even
//      on the two pages that did call resolveSlugTenant(), the next render
//      compared the slug in the URL against the resolved uuid, found them
//      different, and put the slug back. The resolution could not survive.
//
//   2. resolveSlugTenant() was only ever called from OnlineOrderPage and
//      TrackOrderPage. `/#/rider-portal/butt` and `/#/order-taker/butt` were
//      never resolved at all, so those portals sat on a tenant id of "butt"
//      permanently — which is exactly why a refresh showed nothing.
//
// The uuid links kept working throughout, which is why the old ones were fine.
//
// THE FIX, in three parts: a slug is never installed as a tenant id; the
// mapping is cached so a refresh resolves it without a round trip; and every
// public route resolves, not just two of them.

const SLUG_CACHE_KEY = 'dt-slug-tenants';

type SlugCache = Record<string, { id: string; name?: string }>;

function readSlugCache(): SlugCache {
  try {
    const raw = localStorage.getItem(SLUG_CACHE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v as SlugCache : {};
  } catch { return {}; }
}

function writeSlugCache(slug: string, id: string, name?: string): void {
  try {
    const c = readSlugCache();
    c[slug.toLowerCase()] = { id, name };
    localStorage.setItem(SLUG_CACHE_KEY, JSON.stringify(c));
  } catch { /* private mode — it still resolves, just with a round trip */ }
}

/**
 * The tenant a slug resolved to last time, with no network.
 *
 * This is what makes a REFRESH work. Without it the page reloads, has a slug
 * and no tenant, and has to wait for a round trip before it can read anything —
 * which on a slow connection is indistinguishable from the restaurant being
 * empty.
 */
export function cachedSlugTenant(slug: string | null | undefined): { id: string; name?: string } | null {
  if (!slug) return null;
  return readSlugCache()[slug.toLowerCase()] ?? null;
}

/**
 * Turn a slug in the URL into a real tenant.
 *
 * Kept OUT of applyPublicTenantFromUrl because that one must stay synchronous —
 * it runs before initStore() and the tenant has to be settled by then. A uuid
 * link therefore behaves exactly as it always did, with no await anywhere near
 * the boot path; a slug link pays for one round trip, once, and is cached.
 *
 * Returns the tenant id, or null when the slug is unknown — never a slug.
 */
export async function resolveSlugTenant(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const raw = parsePublicTenantId();
  if (!looksLikeSlug(raw)) return null;

  const hit = cachedSlugTenant(raw);
  if (hit?.id) {
    if (hit.id !== getTenantId()) setTenant(hit.id, hit.name);
    // Cached, but not trusted forever: a restaurant that renames itself gets a
    // new slug, and the old cache entry would quietly send this device to
    // whichever restaurant held that name before. Re-check in the background —
    // the page has already rendered, so this costs the customer nothing.
    void askServerForSlug(raw!).then(fresh => {
      if (fresh?.id && fresh.id !== hit.id) {
        setTenant(fresh.id, fresh.name);
        // The screen is already rendering the wrong restaurant's data at this
        // point. Reloading is the honest correction.
        try { window.location.reload(); } catch { /* nothing else to do */ }
      }
    });
    return hit.id;
  }

  const fresh = await askServerForSlug(raw!);
  if (fresh?.id) setTenant(fresh.id, fresh.name);
  return fresh?.id ?? null;
}

/** One lookup. Writes the cache on success; never throws. */
async function askServerForSlug(slug: string): Promise<{ id: string; name?: string } | null> {
  try {
    const { sb, isSupabaseConfigured } = await import('./supabase');
    if (!isSupabaseConfigured()) return null;
    const { data, error } = await sb().rpc('public_tenant_by_slug' as never, { p_slug: slug } as never);
    if (error) {
      // Not silent: a link that cannot be resolved is the difference between
      // "this restaurant has no menu" and "we could not find this restaurant",
      // and the customer deserves the second message.
      console.error('[public-tenant] could not resolve link', slug, error.message);
      return null;
    }
    const id = (data as { tenantId?: string } | null)?.tenantId ?? null;
    const name = (data as { name?: string } | null)?.name;
    if (!id) {
      console.error('[public-tenant] no restaurant has the link name', slug);
      return null;
    }
    writeSlugCache(slug, id, name);
    return { id, name };
  } catch (e) {
    console.error('[public-tenant] could not resolve link', slug, e);
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
  const fromUrl = parsePublicTenantId();

  // v1.56.1 — a slug is NOT a tenant id, and must never be installed as one.
  //
  // This is the whole bug. `#/order/butt` used to setTenant('butt') here, on
  // every render, so `tenant_id = 'butt'` went to the database and nothing
  // came back — and on the two pages that did resolve the slug, the very next
  // render overwrote the resolved uuid with the slug again.
  //
  // The cache lets a refresh resolve with no round trip; a first-ever visit
  // leaves the tenant untouched and waits for resolveSlugTenant(), which the
  // boot path awaits before rendering a public route.
  if (looksLikeSlug(fromUrl)) {
    const hit = cachedSlugTenant(fromUrl);
    const id = hit?.id ?? packaged ?? null;
    if (id && id !== getTenantId()) setTenant(id, hit?.name);
    return getTenantId();
  }

  const tid = fromUrl ?? packaged;
  if (tid && tid !== getTenantId()) {
    setTenant(tid);
  }
  return getTenantId();
}
