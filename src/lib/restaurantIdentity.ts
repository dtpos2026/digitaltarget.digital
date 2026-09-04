// ============================================================================
// "her fountion ko pta ho mera resrurant ye ha" — one answer to
// "which restaurant am I?", shared by every screen of every app.
//
// Before this, four different screens worked it out four different ways: the
// POS header read the local settings document, the Workspace Code card read
// `tenants` (and gave up when there was no cloud session), the Rider badge
// read a portal RPC, and the Order Taker read nothing at all. So the same
// device could show a name in one place, a dash in another, and no workspace
// code anywhere.
//
// There is now exactly one resolver. It answers from cache first so the header
// paints on the first frame and still says the right thing with no signal,
// then refreshes from whichever source this session actually has:
//
//   portal session  -> portal_restaurant()      (rider / order taker, no auth.uid())
//   cloud session   -> tenants + get_workspace_code()
//   staff PIN login -> the code staff_login_check already handed back
//
// Every path is read-only and tenant-scoped on the server; nothing here can
// widen what a session may see.
// ============================================================================
import { supabase } from '@/integrations/supabase/client';
import { getTenantId } from '@/lib/tenant';

export interface RestaurantIdentity {
  tenantId: string | null;
  name: string;
  branchName: string;
  workspaceCode: string;
  logoUrl: string | null;
  /** Where the answer came from — shown in diagnostics, never to the cashier. */
  source: 'cache' | 'portal' | 'cloud' | 'local' | 'none';
}

const CACHE_KEY = 'dt-restaurant-identity';
/** The Rider badge shipped in v1.43.0 with its own key; keep reading it. */
const LEGACY_PORTAL_KEY = 'dt-portal-restaurant';

const EMPTY: RestaurantIdentity = {
  tenantId: null, name: '', branchName: '', workspaceCode: '', logoUrl: null, source: 'none',
};

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch { return null; }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** What we already know, with no network. Safe to call during render. */
export function cachedIdentity(): RestaurantIdentity {
  const tid = getTenantId();
  const c = readJson(CACHE_KEY) ?? readJson(LEGACY_PORTAL_KEY);
  if (!c) return { ...EMPTY, tenantId: tid };

  // A cache written for another restaurant must never leak into this one.
  const cachedTid = str(c.tenantId) || null;
  if (tid && cachedTid && cachedTid !== tid) return { ...EMPTY, tenantId: tid };

  return {
    tenantId: cachedTid ?? tid,
    name: str(c.name),
    branchName: str(c.branchName),
    workspaceCode: str(c.workspaceCode).toUpperCase(),
    logoUrl: str(c.logoUrl) || null,
    source: 'cache',
  };
}

function writeCache(id: RestaurantIdentity) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      tenantId: id.tenantId, name: id.name, branchName: id.branchName,
      workspaceCode: id.workspaceCode, logoUrl: id.logoUrl,
    }));
  } catch { /* private mode — the live read still works, it just won't persist */ }
}

/** Merge a fresh answer over the cache: a blank field never erases a known one. */
function merge(base: RestaurantIdentity, next: Partial<RestaurantIdentity>): RestaurantIdentity {
  return {
    tenantId: next.tenantId || base.tenantId,
    name: next.name || base.name,
    branchName: next.branchName || base.branchName,
    workspaceCode: (next.workspaceCode || base.workspaceCode).toUpperCase(),
    logoUrl: next.logoUrl ?? base.logoUrl,
    source: next.source ?? base.source,
  };
}

let inflight: Promise<RestaurantIdentity> | null = null;

/**
 * Resolve the identity for whatever kind of session this is.
 * Never throws: a failure leaves the cached answer standing, because a stale
 * name is far better than an empty header.
 */
export async function resolveRestaurantIdentity(): Promise<RestaurantIdentity> {
  if (inflight) return inflight;
  inflight = (async () => {
    let id = cachedIdentity();
    try {
      // --- 1. Rider / Order Taker: an opaque portal token, no auth.uid(). ---
      const { hasPortalSession, portalRestaurant } = await import('@/lib/portalData');
      if (hasPortalSession()) {
        const res = await portalRestaurant();
        if (res.ok && res.data) {
          const d = res.data;
          id = merge(id, {
            tenantId: str(d.tenantId) || id.tenantId,
            name: str(d.name),
            branchName: str(d.branchName),
            workspaceCode: str(d.workspaceCode),
            logoUrl: str(d.logoUrl) || null,
            source: 'portal',
          });
          writeCache(id);
          return id;
        }
        // A portal device has no other source — keep the cache, do not fall
        // through to the cloud reads, which would fail for a different reason
        // and look like a different bug.
        return id;
      }
    } catch { /* fall through to the cloud reads */ }

    const tid = getTenantId();
    if (!tid) return id;
    id = merge(id, { tenantId: tid });

    // --- 2. POS with a cloud session: read the row itself. ---
    try {
      const { data } = await supabase
        .from('tenants').select('name, workspace_code').eq('id', tid).maybeSingle();
      const row = data as { name?: string; workspace_code?: string } | null;
      if (row?.workspace_code) {
        id = merge(id, {
          name: str(row.name),
          workspaceCode: str(row.workspace_code),
          source: 'cloud',
        });
      }
    } catch { /* offline, or no cloud session — the RPC below may still work */ }

    // --- 2b. The name the owner actually set. ---
    //
    // tenants.name is the name the row was CREATED with; the owner renames the
    // restaurant in POS Settings, which writes tenant_settings. The staff apps
    // read the same setting (portal_restaurant, v1.45.0), so both sides of the
    // system name the restaurant the same way.
    try {
      const { data } = await supabase
        .from('tenant_settings').select('settings').eq('tenant_id', tid);
      for (const r of (data ?? []) as Array<{ settings?: Record<string, unknown> }>) {
        const n = str(r.settings?.name);
        const logo = str(r.settings?.logo);
        if (n) id = merge(id, { name: n });
        if (logo) id = merge(id, { logoUrl: logo });
      }
    } catch { /* the tenants name stands */ }

    // --- 3. Same session, different route: SECURITY DEFINER, same guard. ---
    if (!id.workspaceCode) {
      try {
        const { data } = await supabase.rpc('get_workspace_code', { _tenant_id: tid });
        const wc = str(data);
        if (wc) id = merge(id, { workspaceCode: wc, source: 'cloud' });
      } catch { /* ignore */ }
    }

    // --- 4. Staff PIN login: no auth.uid() at all. staff_login_check handed
    //        the code back at sign-in (v1.39.0); use it rather than telling the
    //        person at the till to go and ask the owner. ---
    if (!id.workspaceCode) {
      try {
        const { getSavedWorkspaceCode } = await import('@/lib/staffPortalAuth');
        const wc = getSavedWorkspaceCode();
        if (wc) id = merge(id, { workspaceCode: wc, source: 'local' });
      } catch { /* ignore */ }
    }

    if (id.workspaceCode || id.name) writeCache(id);
    return id;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Drop the cache on sign-out, so the next restaurant starts clean. */
export function clearRestaurantIdentity() {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(LEGACY_PORTAL_KEY);
  } catch { /* ignore */ }
}
