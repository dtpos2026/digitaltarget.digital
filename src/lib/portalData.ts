// ============================================================================
// v1.29.0 — what the Rider and Order Taker apps read, and how
//
// THE BUG THIS EXISTS FOR
//
// Signed into the Order Taker app, the menu appeared and the tables did not —
// and the restaurant has twelve. No riders to hand a delivery to. In the Rider
// app, no orders at all. All three apps then reported "saved locally, cloud
// sync issue".
//
// One cause. portalSignIn() verifies the staff member server-side and binds the
// device to the resolved restaurant, but creates no Supabase session, because
// POS staff are user_profiles rows and have no auth.users account to sign into.
// Every read afterwards therefore went as `anon`, and the policies answered
// exactly as written:
//
//     menu_items, categories     public read      -> the menu appeared
//     dining_tables              authenticated    -> no tables
//     user_profiles              authenticated    -> no riders
//     orders                     anon may INSERT  -> no orders
//
// RLS was right. The portal was asking as a stranger.
//
// This is the other half: the login now mints an opaque portal token, and these
// read through portal_* — SECURITY DEFINER functions that resolve the token to
// one restaurant and return only its rows. The tenant is never sent; it is
// carried by the token, so a tampered request changes nothing.
// ============================================================================
import { sb, isSupabaseConfigured } from './supabase';

const TOKEN_KEY = 'dt-portal-token';

export interface PortalRider {
  id: string; name: string; username: string;
  phone: string | null; branchId: string | null; isActive: boolean;
}

export interface PortalBootstrap {
  tables: any[];
  floors: any[];
  riders: PortalRider[];
  orders: any[];
}

// --------------------------------------------------------------- the token
export function getPortalToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setPortalToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode — the app still works, just not across reloads */ }
}

/** True when this device holds a portal session it can read with. */
export function hasPortalSession(): boolean {
  return getPortalToken().length >= 32;
}

// ----------------------------------------------------------------- reading
//
// Every call answers { ok: false, reason: 'no_session' } rather than throwing
// when the token has expired or the staff member was deactivated, so a caller
// can tell "signed out" from "the network is down" — the two need opposite
// responses and the old code could not distinguish them at all.
type PortalResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'no_session' | 'offline' | 'error'; message: string };

async function call<T>(fn: string, args: Record<string, unknown>, pick: (r: any) => T): Promise<PortalResult<T>> {
  const token = getPortalToken();
  if (!token) return { ok: false, reason: 'no_session', message: 'This device is not signed in.' };
  if (!isSupabaseConfigured()) {
    return { ok: false, reason: 'error', message: 'This build has no server configured.' };
  }
  try {
    const { data, error } = await sb().rpc(fn as never, { p_token: token, ...args } as never);
    if (error) return { ok: false, reason: 'offline', message: error.message };
    const res = data as any;
    if (!res?.ok) {
      if (res?.reason === 'no_session' || res?.reason === 'inactive') {
        setPortalToken(null);
        return {
          ok: false,
          reason: 'no_session',
          message: res.reason === 'inactive'
            ? 'This account has been switched off. Ask the restaurant admin.'
            : 'Your session has expired — sign in again.',
        };
      }
      return { ok: false, reason: 'error', message: res?.reason ?? 'The server refused the request.' };
    }
    return { ok: true, data: pick(res) };
  } catch (e: any) {
    return { ok: false, reason: 'offline', message: e?.message || 'Could not reach the server' };
  }
}

/**
 * Like call(), but for RPCs where `ok: false` is a legitimate ANSWER rather
 * than a failure — "that password is wrong" is not the same kind of event as
 * "the server is unreachable", and flattening the two loses everything the
 * answer carried (how many tries are left, how long a lockout runs).
 *
 * An expired or revoked session is still handled as a session problem, so a
 * dead token clears itself exactly as it does everywhere else.
 */
async function callRaw<T extends { ok?: boolean; reason?: string }>(
  fn: string, args: Record<string, unknown>,
): Promise<PortalResult<T>> {
  const token = getPortalToken();
  if (!token) return { ok: false, reason: 'no_session', message: 'This device is not signed in.' };
  if (!isSupabaseConfigured()) {
    return { ok: false, reason: 'error', message: 'This build has no server configured.' };
  }
  try {
    const { data, error } = await sb().rpc(fn as never, { p_token: token, ...args } as never);
    if (error) return { ok: false, reason: 'offline', message: error.message };
    const res = data as T;
    if (res?.reason === 'no_session' || res?.reason === 'inactive') {
      setPortalToken(null);
      return {
        ok: false,
        reason: 'no_session',
        message: res.reason === 'inactive'
          ? 'This account has been switched off. Ask the restaurant admin.'
          : 'Your session has expired — sign in again.',
      };
    }
    return { ok: true, data: res };
  } catch (e: any) {
    return { ok: false, reason: 'offline', message: e?.message || 'Could not reach the server' };
  }
}

/** Everything the portal needs on the way in — one round trip, not four. */
export function portalBootstrap(): Promise<PortalResult<PortalBootstrap>> {
  return call('portal_bootstrap', {}, (r) => ({
    tables: Array.isArray(r.tables) ? r.tables : [],
    floors: Array.isArray(r.floors) ? r.floors : [],
    riders: Array.isArray(r.riders) ? r.riders : [],
    orders: Array.isArray(r.orders) ? r.orders : [],
    // v1.43.0 — the menu and the restaurant's identity travel with everything
    // else, from the same token, in the same round trip.
    categories: Array.isArray(r.categories) ? r.categories : undefined,
    menuItems:  Array.isArray(r.menuItems)  ? r.menuItems  : undefined,
    restaurant: (r.restaurant ?? null) as PortalRestaurant | null,
  }));
}

/** The live orders this staff member may act on. */
export function portalOrders(limit = 150): Promise<PortalResult<any[]>> {
  return call('portal_orders', { p_limit: limit }, (r) => (Array.isArray(r.orders) ? r.orders : []));
}

/** The riders an order taker can hand a delivery to. */
export function portalRiders(): Promise<PortalResult<PortalRider[]>> {
  return call('portal_riders', {}, (r) => (Array.isArray(r.riders) ? r.riders : []));
}

/** Tables and floors, branch-scoped to this staff member. */
export function portalTables(): Promise<PortalResult<{ tables: any[]; floors: any[] }>> {
  return call('portal_tables', {}, (r) => ({
    tables: Array.isArray(r.tables) ? r.tables : [],
    floors: Array.isArray(r.floors) ? r.floors : [],
  }));
}

/** Confirm the session is still good, and who it belongs to. */
export function portalMe(): Promise<PortalResult<Record<string, any>>> {
  return call('portal_me', {}, (r) => r);
}

/** Which restaurant this app belongs to — name, branch, logo, workspace code. */
export interface PortalRestaurant {
  ok?: boolean;
  tenantId?: string;
  name?: string;
  slug?: string;
  workspaceCode?: string;
  branchName?: string;
  logoUrl?: string | null;
}

/**
 * REPORTED: "Rider App mein wazeh hona chahiye ke ye kis restaurant ki app
 * hai." The staff apps are one build serving every restaurant, so the identity
 * has to come from the session rather than the bundle.
 */
export function portalRestaurant(): Promise<PortalResult<PortalRestaurant>> {
  return call('portal_restaurant', {}, (r) => r as PortalRestaurant);
}

/**
 * This rider's finished deliveries, and their totals.
 *
 * REPORTED: "Rider ke completed orders ka record nazar nahi aata." Kept apart
 * from portal_orders, which returns the LIVE list — a working screen wants the
 * few, a history wants the many, and mixing them makes both slower.
 */
export function portalMyHistory(limit = 100): Promise<PortalResult<{
  orders: Array<Record<string, unknown>>;
  totals: { delivered?: number; today?: number; earnings?: number };
}>> {
  return call('portal_my_history', { p_limit: limit }, (r) => ({
    orders: Array.isArray(r.orders) ? r.orders : [],
    totals: (r.totals ?? {}) as { delivered?: number; today?: number; earnings?: number },
  }));
}

// ===== v1.41.0 — the writes =====
//
// Every read above goes through a portal_* SECURITY DEFINER function because a
// portal app holds a token, not a Supabase session. The WRITES did not: they
// went straight at the table as `anon`, and an UPDATE that RLS filters does
// NOT raise — it matches zero rows and returns success. So a rider's Claim was
// saved locally, reported as saved, and never reached the server. Proven
// against the live database:
//
//     set role anon; update orders ... ;  ->  no error, rows affected = 0
//
// These are the missing halves. The server decides everything that matters —
// which restaurant, which rider, whether the order was already claimed — so a
// token is the only thing the app has to hold.

/** Claim an unassigned delivery. Refused if another rider already took it. */
export function portalClaimOrder(orderId: string): Promise<PortalResult<any>> {
  return call('portal_order_delivery',
    { p_order: orderId, p_stage: 'rider_assigned', p_claim: true }, (r) => r);
}

/** Move a delivery this rider already owns to its next stage. */
export function portalSetDeliveryStage(orderId: string, stage: string): Promise<PortalResult<any>> {
  return call('portal_order_delivery',
    { p_order: orderId, p_stage: stage, p_claim: false }, (r) => r);
}

/** A rider or order taker editing their OWN name, phone or photo. */
export function portalUpdateMe(
  patch: { name?: string; phone?: string; photo?: string | null },
): Promise<PortalResult<any>> {
  return call('portal_update_me', {
    p_name: patch.name ?? null,
    p_phone: patch.phone ?? null,
    p_photo: patch.photo === undefined ? null : patch.photo,
  }, (r) => r);
}

/**
 * Ask this restaurant's own managers whether a password is theirs.
 *
 * The POS route (verify_manager_password) needs a Supabase session and is not
 * granted to anon, so an Order Taker could never reach it — a correct password
 * came back "Not Valid". This resolves the restaurant from the TOKEN; there is
 * no tenant parameter to spoof, and five wrong tries lock this SESSION for
 * fifteen minutes.
 */
export function portalVerifyManager(password: string): Promise<PortalResult<{
  ok?: boolean; name?: string; reason?: string;
  attemptsLeft?: number; retryAfterSeconds?: number;
}>> {
  return callRaw('portal_verify_manager', { p_password: password });
}

/** End the session server-side, so a lost phone stops being a way in. */
export async function portalLogout(): Promise<void> {
  const token = getPortalToken();
  setPortalToken(null);
  // Same reason as clearTenant(): the next rider to sign in on this phone
  // must not see the previous restaurant's name in the header.
  try {
    localStorage.removeItem('dt-restaurant-identity');
    localStorage.removeItem('dt-portal-restaurant');
  } catch { /* private mode */ }
  if (!token || !isSupabaseConfigured()) return;
  try { await sb().rpc('portal_logout' as never, { p_token: token } as never); }
  catch { /* the local token is already gone, which is what matters here */ }
}
