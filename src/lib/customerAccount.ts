// ============================================================================
// The customer's account, on the server.
//
// ===== WHAT THIS REPLACES =====
// `dt-online-accounts-v2` was a localStorage object holding EVERY customer of a
// restaurant, keyed by phone, with a SHA-256 PIN compared in the browser. It
// mirrored to module_documents, but that table is authenticated-only, so an
// anonymous customer could never read or write it. The practical effect: an
// account existed in one browser on one device. Reinstall the app, clear data,
// or use a second phone and both the account and the order history were gone.
//
// Everything here goes through public_customer_* RPCs instead. The app holds a
// session token and nothing else — no key, no other customer's data, and no
// ability to reach a restaurant it was not built for.
//
// The token is per tenant on purpose: one device may legitimately hold accounts
// at several restaurants, and they must not be able to see each other.
// ============================================================================
import { sb, isSupabaseConfigured } from './supabase';
import { getTenantId } from './tenant';

export interface CustomerProfile {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  area: string | null;
  fullAddress: string | null;
  addresses: SavedAddress[];
  dateOfBirth: string | null;
  gender: 'male' | 'female' | null;
  lat: number | null;
  lng: number | null;
  loyaltyPoints: number;
  totalOrders: number;
  lastOrderAt: string | null;
}

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  city?: string;
  lat?: number;
  lng?: number;
}

export interface CustomerOrderSummary {
  id: string;
  orderNumber: number;
  status: string;
  orderType: string | null;
  source: string | null;
  grandTotal: number;
  createdAt: string;
  branchId: string | null;
  riderName: string | null;
  // v1.28.0 — the live state. The panel read `deliveryStatus` long before the
  // RPC returned it, so every order showed as "pending".
  kitchenStatus?: string | null;
  deliveryStatus?: string | null;
  dispatchedAt?: string | null;
  deliveredAt?: string | null;
  items: Array<{ name?: string; quantity?: number; lineTotal?: number }>;
}

/** One order's live detail, for the tracking panel. */
export interface CustomerOrderTrack {
  id: string;
  orderNumber: number;
  status: string;
  orderType: string | null;
  grandTotal: number;
  createdAt: string;
  kitchenStatus: string | null;
  deliveryStatus: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  /** Only present while the delivery is in flight. */
  riderName: string | null;
  riderPhone: string | null;
  etaMinutes: number | null;
  rider: { lat: number; lng: number; pingedAt?: string | null } | null;
  customer: { lat: number; lng: number } | null;
  branch: { lat: number; lng: number } | null;
  items: Array<{ name?: string; quantity?: number; lineTotal?: number }>;
}

type Failure =
  | 'app_disabled' | 'bad_phone' | 'weak_pin' | 'name_required'
  | 'already_registered' | 'blocked' | 'bad_credentials' | 'locked'
  | 'no_session' | 'offline' | 'unknown'
  // v1.28.0 — phone verification
  | 'verification_required' | 'too_many_requests' | 'too_many_attempts'
  | 'bad_code' | 'expired';

export type AccountResult =
  | { ok: true; customer: CustomerProfile }
  | { ok: false; reason: Failure; message: string; retryAt?: string };

/** What to actually show a customer. Never leaks which half of a login failed. */
const MESSAGES: Record<Failure, string> = {
  app_disabled:      'This restaurant’s app is not available right now.',
  bad_phone:         'Enter a valid mobile number.',
  weak_pin:          'Choose a PIN of at least 4 digits.',
  name_required:     'Enter your name.',
  already_registered:'This number already has an account — sign in with your PIN.',
  blocked:           'This account is blocked. Please contact the restaurant.',
  bad_credentials:   'Wrong number or PIN.',
  locked:            'Too many wrong PINs. Try again in a few minutes.',
  no_session:        'Please sign in again.',
  offline:           'You are offline. Connect to sign in.',
  unknown:           'Something went wrong. Please try again.',
  verification_required:
    'This number already has an account with the restaurant. Verify the number to claim it.',
  too_many_requests: 'Too many codes requested. Wait a few minutes and try again.',
  too_many_attempts: 'Too many wrong codes. Request a new one.',
  bad_code:          'That code is not right.',
  expired:           'That code has expired. Request a new one.',
};

const TOKEN_PREFIX = 'dt-customer-token:';
const CACHE_PREFIX = 'dt-customer-profile:';

function tenantKey(prefix: string, tenantId?: string | null): string {
  return prefix + (tenantId || getTenantId() || 'default');
}

export function getCustomerToken(tenantId?: string | null): string | null {
  try { return localStorage.getItem(tenantKey(TOKEN_PREFIX, tenantId)); } catch { return null; }
}

function setCustomerToken(token: string | null, tenantId?: string | null): void {
  try {
    const k = tenantKey(TOKEN_PREFIX, tenantId);
    if (token) localStorage.setItem(k, token);
    else localStorage.removeItem(k);
  } catch { /* private mode */ }
}

/**
 * The last profile the server sent.
 *
 * Kept only so the app can greet the customer by name and prefill checkout
 * while offline. It is a cache, never the source of truth: every sign-in and
 * every profile change goes to the server first.
 */
export function getCachedProfile(tenantId?: string | null): CustomerProfile | null {
  try {
    const raw = localStorage.getItem(tenantKey(CACHE_PREFIX, tenantId));
    return raw ? (JSON.parse(raw) as CustomerProfile) : null;
  } catch { return null; }
}

function cacheProfile(p: CustomerProfile | null, tenantId?: string | null): void {
  try {
    const k = tenantKey(CACHE_PREFIX, tenantId);
    if (p) localStorage.setItem(k, JSON.stringify(p));
    else localStorage.removeItem(k);
  } catch { /* private mode */ }
}

function normalize(raw: any): CustomerProfile {
  return {
    id: String(raw?.id ?? ''),
    name: raw?.name ?? null,
    phone: raw?.phone ?? null,
    email: raw?.email ?? null,
    address: raw?.address ?? null,
    city: raw?.city ?? null,
    area: raw?.area ?? null,
    fullAddress: raw?.fullAddress ?? null,
    addresses: Array.isArray(raw?.addresses) ? raw.addresses : [],
    dateOfBirth: raw?.dateOfBirth ?? null,
    gender: raw?.gender ?? null,
    lat: typeof raw?.lat === 'number' ? raw.lat : null,
    lng: typeof raw?.lng === 'number' ? raw.lng : null,
    loyaltyPoints: Number(raw?.loyaltyPoints ?? 0),
    totalOrders: Number(raw?.totalOrders ?? 0),
    lastOrderAt: raw?.lastOrderAt ?? null,
  };
}

function fail(reason: Failure, retryAt?: string): AccountResult {
  return { ok: false, reason, message: MESSAGES[reason] ?? MESSAGES.unknown, retryAt };
}

async function call(fn: string, args: Record<string, unknown>): Promise<any> {
  if (!isSupabaseConfigured()) throw new Error('offline');
  const { data, error } = await sb().rpc(fn as never, args as never);
  if (error) throw error;
  return data;
}

function settle(raw: any, tenantId?: string | null): AccountResult {
  if (raw?.ok) {
    const profile = normalize(raw.customer);
    if (typeof raw.token === 'string') setCustomerToken(raw.token, tenantId);
    cacheProfile(profile, tenantId);
    return { ok: true, customer: profile };
  }
  const reason = (raw?.reason ?? 'unknown') as Failure;
  // A session the server no longer recognises is worse than useless — it makes
  // the app look signed in while nothing works.
  if (reason === 'no_session') signOutLocal(tenantId);
  return fail(reason, raw?.retryAt);
}

// ---------------------------------------------------------------------------

export async function customerSignup(input: {
  tenantId: string;
  phone: string;
  pin: string;
  name: string;
  email?: string;
  address?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | '';
  lat?: number;
  lng?: number;
  /**
   * Proof that this phone was verified, from verifyOtp().
   *
   * Required only when CLAIMING a profile the restaurant already created from
   * a past order — that record carries the diner's address and history, and
   * knowing their number is not proof of holding it. A brand-new signup needs
   * nothing: there is nothing there to take.
   */
  claimToken?: string;
}): Promise<AccountResult> {
  try {
    const raw = await call('public_customer_signup', {
      p_tenant: input.tenantId,
      p_phone: input.phone,
      p_pin: input.pin,
      p_name: input.name,
      p_email: input.email ?? null,
      p_address: input.address ?? null,
      p_dob: input.dateOfBirth || null,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_gender: input.gender || null,
      p_claim_token: input.claimToken ?? null,
    });
    return settle(raw, input.tenantId);
  } catch (e: any) {
    return fail(e?.message === 'offline' ? 'offline' : 'unknown');
  }
}

/**
 * Ask the restaurant to send a verification code to this number.
 *
 * The code is never returned here — it leaves the database only through the
 * delivery outbox, which no browser can read.
 */
export async function requestOtp(tenantId: string, phone: string): Promise<
  { ok: true; expiresAt: string } | { ok: false; reason: Failure; message: string }
> {
  try {
    const raw = await call('public_customer_request_otp', { p_tenant: tenantId, p_phone: phone });
    if (raw?.ok) return { ok: true, expiresAt: String(raw.expiresAt ?? '') };
    const reason = (raw?.reason ?? 'unknown') as Failure;
    return { ok: false, reason, message: MESSAGES[reason] ?? MESSAGES.unknown };
  } catch (e: any) {
    const reason: Failure = e?.message === 'offline' ? 'offline' : 'unknown';
    return { ok: false, reason, message: MESSAGES[reason] };
  }
}

/** Exchange a correct code for a single-use claim proof. */
export async function verifyOtp(tenantId: string, phone: string, code: string): Promise<
  { ok: true; claimToken: string } | { ok: false; reason: Failure; message: string }
> {
  try {
    const raw = await call('public_customer_verify_otp', {
      p_tenant: tenantId, p_phone: phone, p_code: code,
    });
    if (raw?.ok) return { ok: true, claimToken: String(raw.claimToken ?? '') };
    const reason = (raw?.reason ?? 'unknown') as Failure;
    return { ok: false, reason, message: MESSAGES[reason] ?? MESSAGES.unknown };
  } catch (e: any) {
    const reason: Failure = e?.message === 'offline' ? 'offline' : 'unknown';
    return { ok: false, reason, message: MESSAGES[reason] };
  }
}

export async function customerLogin(tenantId: string, phone: string, pin: string): Promise<AccountResult> {
  try {
    return settle(await call('public_customer_login', {
      p_tenant: tenantId, p_phone: phone, p_pin: pin,
    }), tenantId);
  } catch (e: any) {
    return fail(e?.message === 'offline' ? 'offline' : 'unknown');
  }
}

/** Refresh the signed-in customer. Returns null when nobody is signed in. */
export async function customerMe(tenantId?: string | null): Promise<CustomerProfile | null> {
  const token = getCustomerToken(tenantId);
  if (!token) return null;
  try {
    const r = settle(await call('public_customer_me', { p_token: token }), tenantId);
    return r.ok ? r.customer : null;
  } catch {
    // Offline: the cached profile is the right answer, not a sign-out.
    return getCachedProfile(tenantId);
  }
}

export async function customerUpdate(patch: {
  tenantId?: string | null;
  name?: string;
  email?: string;
  address?: string;
  city?: string;
  dateOfBirth?: string;
  addresses?: SavedAddress[];
  lat?: number;
  lng?: number;
}): Promise<AccountResult> {
  const token = getCustomerToken(patch.tenantId);
  if (!token) return fail('no_session');
  try {
    return settle(await call('public_customer_update', {
      p_token: token,
      p_name: patch.name ?? null,
      p_email: patch.email ?? null,
      p_address: patch.address ?? null,
      p_city: patch.city ?? null,
      p_dob: patch.dateOfBirth || null,
      p_addresses: patch.addresses ?? null,
      p_lat: patch.lat ?? null,
      p_lng: patch.lng ?? null,
    }), patch.tenantId);
  } catch (e: any) {
    return fail(e?.message === 'offline' ? 'offline' : 'unknown');
  }
}

/**
 * The customer's real order history, from the server.
 *
 * This is the whole point of an account: it follows the person, not the phone
 * they happen to be holding.
 */
export async function customerOrders(tenantId?: string | null, limit = 30): Promise<CustomerOrderSummary[]> {
  const token = getCustomerToken(tenantId);
  if (!token) return [];
  try {
    const raw = await call('public_customer_orders', { p_token: token, p_limit: limit });
    if (!raw?.ok) {
      if (raw?.reason === 'no_session') signOutLocal(tenantId);
      return [];
    }
    return (Array.isArray(raw.orders) ? raw.orders : []).map((o: any) => ({
      id: String(o.id),
      orderNumber: Number(o.orderNumber ?? 0),
      status: String(o.status ?? ''),
      orderType: o.orderType ?? null,
      source: o.source ?? null,
      grandTotal: Number(o.grandTotal ?? 0),
      createdAt: String(o.createdAt ?? ''),
      branchId: o.branchId ?? null,
      riderName: o.riderName ?? null,
      kitchenStatus: o.kitchenStatus ?? null,
      deliveryStatus: o.deliveryStatus ?? null,
      dispatchedAt: o.dispatchedAt ?? null,
      deliveredAt: o.deliveredAt ?? null,
      items: Array.isArray(o.items) ? o.items : [],
    }));
  } catch {
    return [];
  }
}


/** Forget this device's session locally, without waiting for the server. */
export function signOutLocal(tenantId?: string | null): void {
  setCustomerToken(null, tenantId);
  cacheProfile(null, tenantId);
}

export async function customerLogout(tenantId?: string | null): Promise<void> {
  const token = getCustomerToken(tenantId);
  signOutLocal(tenantId);
  if (!token) return;
  // Best effort: the local session is already gone either way.
  try { await call('public_customer_logout', { p_token: token }); } catch { /* ignore */ }
}


/**
 * Live tracking for one of the signed-in customer's own orders.
 *
 * The server checks ownership; there is nothing to filter here. A rider
 * position only comes back while the delivery is actually in flight.
 */
export async function customerOrderTrack(
  orderId: string, tenantId?: string | null,
): Promise<CustomerOrderTrack | null> {
  const token = getCustomerToken(tenantId);
  if (!token) return null;
  try {
    const raw = await call('public_customer_order_track', { p_token: token, p_order: orderId });
    if (!raw?.ok) {
      if (raw?.reason === 'no_session') signOutLocal(tenantId);
      return null;
    }
    const o = raw.order ?? {};
    const pt = (v: any) =>
      v && v.lat != null && v.lng != null ? { lat: Number(v.lat), lng: Number(v.lng) } : null;
    const rider = pt(o.rider);
    return {
      id: String(o.id ?? orderId),
      orderNumber: Number(o.orderNumber ?? 0),
      status: String(o.status ?? ''),
      orderType: o.orderType ?? null,
      grandTotal: Number(o.grandTotal ?? 0),
      createdAt: String(o.createdAt ?? ''),
      kitchenStatus: o.kitchenStatus ?? null,
      deliveryStatus: o.deliveryStatus ?? null,
      dispatchedAt: o.dispatchedAt ?? null,
      deliveredAt: o.deliveredAt ?? null,
      cancelledAt: o.cancelledAt ?? null,
      riderName: o.riderName ?? null,
      riderPhone: o.riderPhone ?? null,
      etaMinutes: o.etaMinutes == null ? null : Number(o.etaMinutes),
      rider: rider ? { ...rider, pingedAt: o.rider?.pingedAt ?? null } : null,
      customer: pt(o.customer),
      branch: pt(o.branch),
      items: Array.isArray(o.items) ? o.items : [],
    };
  } catch {
    return null;
  }
}


