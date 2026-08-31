// ============================================================================
// SUPABASE CLIENT
//
// NOTE: adding this file changes nothing yet. Nothing imports it. Firebase
// remains the live backend until the provider swap is done and verified.
//
// ---------------------------------------------------------------------------
// WHY THE CACHED SESSION EXISTS — read this before touching it
// ---------------------------------------------------------------------------
// Firebase exposes `auth.currentUser` SYNCHRONOUSLY. This codebase relies on
// that in 31 places, several of them inside synchronous functions such as
// getTenantId(), which is called on nearly every store read.
//
// Supabase's equivalent, `supabase.auth.getUser()`, is ASYNCHRONOUS. Sprinkling
// `await` through those 31 call sites — or worse, letting them read a
// not-yet-resolved promise — produces intermittent "not logged in" errors that
// appear under load, on slow networks, and almost never on a developer machine.
// That is the single most dangerous trap in this migration.
//
// The fix: keep one module-level cache of the session, updated by
// onAuthStateChange, and expose it through synchronous getters that behave
// exactly like Firebase's currentUser. The 31 call sites then change shape
// minimally and keep their existing control flow.
// ============================================================================

import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Configuration
//
// NO HARDCODED FALLBACKS. src/lib/firebase.ts embeds seven production values as
// defaults (lines 22-29). Firebase web keys are not secrets, so that was
// tolerable. A Supabase service-role key bypasses RLS entirely, and even the
// anon key plus a wrong policy is worth failing loudly over. Missing config
// throws here rather than silently pointing at the wrong project.
// ---------------------------------------------------------------------------
const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;

// Supabase renamed the client-side key from "anon" to "publishable". Both names
// are accepted so a project configured either way works; PUBLISHABLE wins.
//
// Whichever name is used, this must be the CLIENT key. The secret / service_role
// key bypasses Row Level Security completely — if it ever reaches this bundle,
// every tenant's data is readable by anyone who opens devtools. There is a
// guard below that refuses to start if a secret key is detected here.
const SUPABASE_PUBLISHABLE_KEY =
  ((import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY
   ?? (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) as string | undefined;

/**
 * A Supabase JWT carries its role in the payload. A service_role key here is a
 * critical misconfiguration, not a typo — fail loudly rather than silently
 * running the whole app with RLS disabled.
 */
function assertNotSecretKey(key: string): void {
  const looksSecret =
    key.startsWith('sb_secret_') ||
    key.includes('service_role') ||
    (() => {
      try {
        const [, payload] = key.split('.');
        if (!payload) return false;
        const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        return claims?.role === 'service_role';
      } catch { return false; }
    })();

  if (looksSecret) {
    throw new Error(
      'SECURITY: a Supabase SECRET / service_role key was found in the frontend ' +
      'configuration. That key bypasses Row Level Security and must never ship ' +
      'to a browser or the Electron bundle. Use the publishable (anon) key.',
    );
  }
}

export function isSupabaseConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY;
}

let _client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (_client) return _client;
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example).',
    );
  }
  assertNotSecretKey(SUPABASE_PUBLISHABLE_KEY!);
  _client = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,   // Electron has no OAuth redirect
      storageKey: 'dtpos-auth',
    },
    realtime: { params: { eventsPerSecond: 10 } },
    global: { headers: { 'x-application-name': 'dt-pos-enterprise' } },
  });
  return _client;
}

// ---------------------------------------------------------------------------
// Session cache — the synchronous bridge
// ---------------------------------------------------------------------------

export interface CachedIdentity {
  userId: string;
  email: string | null;
  tenantId: string | null;
  branchId: string | null;
  role: string | null;
  allBranches: boolean;
  displayName: string | null;
}

let _session: Session | null = null;
let _identity: CachedIdentity | null = null;
let _ready = false;
let _readyPromise: Promise<void> | null = null;
const _listeners = new Set<(id: CachedIdentity | null) => void>();

function claimsFrom(session: Session | null): CachedIdentity | null {
  if (!session?.user) return null;
  // tenant_id / branch_id / role are injected into the JWT by the
  // custom_access_token_hook (migration 0002). Reading them from the token
  // avoids a database round-trip on every synchronous call.
  const c = (session.user as any).app_metadata ?? {};
  const j = (session as any).user?.user_metadata ?? {};
  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    tenantId: c.tenant_id ?? j.tenant_id ?? null,
    branchId: c.branch_id ?? j.branch_id ?? null,
    role: c.role ?? j.role ?? null,
    allBranches: !!(c.all_branches ?? j.all_branches),
    displayName: j.display_name ?? null,
  };
}

function notifyIdentity() {
  for (const fn of _listeners) {
    try { fn(_identity); } catch (e) { console.error('[supabase] listener failed', e); }
  }
}

function setSession(s: Session | null) {
  _session = s;
  _identity = claimsFrom(s);
  notifyIdentity();
  // JWT claims are only present when the custom access-token hook is enabled.
  // Without it tenant_id/branch_id are null and every tenant-scoped feature
  // (sync, live map, reports) fails with "Restaurant link is missing", so fall
  // back to reading the profile row.
  if (s?.user) void hydrateIdentityFromProfile();
}

let _hydrating: Promise<void> | null = null;

/**
 * Fills tenantId/branchId/role from public.user_profiles when the JWT does not
 * carry them, and picks the tenant's first branch when the profile has none.
 */
export function hydrateIdentityFromProfile(force = false): Promise<void> {
  if (_hydrating && !force) return _hydrating;
  if (!_session?.user?.id) {
    // The persisted session may not have been read yet (no boot call, or a
    // hard refresh straight onto a deep-linked page). Recover it here so the
    // restaurant link never looks "missing" for a signed-in owner.
    _hydrating = (async () => {
      try {
        const { data } = await sb().auth.getSession();
        if (data.session?.user) {
          _session = data.session;
          _identity = claimsFrom(data.session);
          notifyIdentity();
        }
      } catch { /* offline — keep whatever is cached */ }
      finally { _hydrating = null; }
      if (_session?.user?.id) await hydrateIdentityFromProfile(true);
    })();
    return _hydrating;
  }
  const userId = _session.user.id;

  _hydrating = (async () => {
    try {
      const { data: prof } = await sb()
        .from('user_profiles')
        .select('tenant_id, branch_id, role, all_branches, display_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (!prof || !_identity) return;
      let branchId = _identity.branchId ?? (prof as any).branch_id ?? null;
      const tenantId = _identity.tenantId ?? (prof as any).tenant_id ?? null;
      if (!branchId && tenantId) {
        const { data: br } = await sb()
          .from('branches')
          .select('id')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: true })
          .limit(1);
        branchId = br?.[0]?.id ?? null;
      }
      _identity = {
        ..._identity,
        tenantId,
        branchId,
        role: _identity.role ?? (prof as any).role ?? null,
        allBranches: _identity.allBranches || !!(prof as any).all_branches,
        displayName: _identity.displayName ?? (prof as any).display_name ?? null,
      };
      notifyIdentity();
    } catch (e) {
      console.warn('[supabase] identity hydrate failed', e);
    } finally {
      _hydrating = null;
    }
  })();
  return _hydrating;
}

/**
 * Must be awaited once during app boot, BEFORE any synchronous getter is used.
 * Resolves the persisted session from storage and starts the change listener.
 */
export function initSupabaseAuth(): Promise<void> {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    if (!isSupabaseConfigured()) { _ready = true; return; }
    const { data } = await sb().auth.getSession();
    setSession(data.session ?? null);
    if (data.session?.user) await hydrateIdentityFromProfile();
    sb().auth.onAuthStateChange((_event, session) => setSession(session ?? null));
    _ready = true;
  })();
  return _readyPromise;
}

// Boot the session cache as soon as this module loads in the browser, so any
// page (including a deep-linked refresh) has tenant/branch resolved.
if (typeof window !== 'undefined' && isSupabaseConfigured()) {
  void initSupabaseAuth();
}




/** True once initSupabaseAuth() has resolved. */
export function isAuthReady(): boolean { return _ready; }

/**
 * Synchronous — the direct replacement for Firebase `auth.currentUser`.
 *
 * Returns null both when signed out AND when auth has not initialised yet.
 * Callers that must distinguish the two should check isAuthReady(); most do
 * not need to, because the app does not render past the boot gate until
 * initSupabaseAuth() has resolved.
 */
export function currentUser(): User | null {
  return _session?.user ?? null;
}

export function currentSession(): Session | null { return _session; }

/** Synchronous identity, including tenant and branch. */
export function currentIdentity(): CachedIdentity | null { return _identity; }

/** Synchronous tenant id — the replacement for the Firebase-uid-derived one. */
export function currentTenantId(): string | null { return _identity?.tenantId ?? null; }

export function currentBranchId(): string | null { return _identity?.branchId ?? null; }

export function currentRole(): string | null { return _identity?.role ?? null; }

/** Access token for a direct fetch (e.g. an Electron-side request). */
export function accessToken(): string | null { return _session?.access_token ?? null; }

/** Subscribe to identity changes. Returns an unsubscribe function. */
export function onIdentityChange(fn: (id: CachedIdentity | null) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Auth operations
// ---------------------------------------------------------------------------

export async function signInOwner(email: string, password: string) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw error;
  setSession(data.session);
  return data;
}

export async function signUpOwner(email: string, password: string, restaurantName: string) {
  const { data, error } = await sb().auth.signUp({
    email, password,
    options: { data: { display_name: restaurantName } },
  });
  if (error) throw error;
  if (data.session) setSession(data.session);
  return data;
}

export async function signOutUser() {
  await sb().auth.signOut();
  setSession(null);
}

/**
 * Floor staff sign in with a username and PIN, not email/password. The PIN is
 * compared against a bcrypt hash INSIDE Postgres (verify_staff_pin) so the hash
 * never reaches the client. The old model stored `User.pin` in plain text.
 */
export async function verifyStaffPin(tenantId: string, username: string, pin: string) {
  const { data, error } = await sb().rpc('verify_staff_pin', {
    p_tenant: tenantId, p_username: username, p_pin: pin,
  });
  if (error) throw error;
  return data as {
    ok: boolean; user_id?: string; name?: string; role?: string; branch_id?: string;
    permissions?: string[]; feature_permissions?: string[];
    /**
     * v1.31.1 — the flag that existed and was never read.
     *
     * sa_create_restaurant has always set must_change_password on the admin it
     * creates, and nothing anywhere consumed it: not this wrapper, not
     * staffSignIn, not LoginPage. So every restaurant kept the password it was
     * shipped with, and on the live database both admin accounts still opened
     * with the one hardcoded in the repository.
     */
    must_change_password?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Safety-critical RPC wrappers
// ---------------------------------------------------------------------------

/**
 * Allocate the next order number for a branch.
 *
 * ONLINE ONLY, by design. An offline bill keeps a provisional local label and
 * receives its real number when it syncs. Never guess a number offline: that
 * is precisely what let two devices both mint #42.
 */
export async function nextOrderNumber(tenantId: string, branchId: string): Promise<number> {
  const { data, error } = await sb().rpc('next_order_number', {
    p_tenant: tenantId, p_branch: branchId,
  });
  if (error) throw error;
  return data as number;
}

export interface SyncOp {
  op_id: string;          // client-generated UUID — the idempotency key
  entity: 'orders' | 'order_items' | 'order_payments';
  entity_id: string;      // client-generated UUID primary key
  operation: 'insert' | 'update' | 'delete';
  client_seq: number;
  client_time: string;
  data: Record<string, unknown>;
}

export interface SyncResult {
  op_id: string;
  result: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  order_number?: number;
  entity_id?: string;
  reason?: string;
}

/**
 * Push a batch of queued offline operations.
 *
 * The whole batch is one Postgres transaction, so it applies fully or not at
 * all — a half-synced bill is impossible. Replays return 'duplicate' rather
 * than inserting a second row, and a stale copy of a settled order returns
 * 'conflict' rather than resurrecting it.
 *
 * branch_id is taken from the DEVICE record server-side, never from the
 * payload, so a device cannot write into another branch even if its local
 * data were corrupted.
 */
export async function pushSyncBatch(deviceId: string, ops: SyncOp[]): Promise<SyncResult[]> {
  const { data, error } = await sb().rpc('apply_sync_batch', {
    p_device_id: deviceId, p_ops: ops,
  });
  if (error) throw error;
  return (data ?? []) as SyncResult[];
}

/** Cursor-based delta pull. Never a full-collection read. */
export async function pullOrdersDelta(branchId: string, since: string, limit = 500) {
  if (!branchId) throw new Error('Select a branch before reading synced orders');
  const { data, error } = await sb().rpc('pull_orders_delta', {
    p_branch: branchId, p_since: since, p_limit: limit,
  });
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type Bucket = 'menu-images' | 'branding' | 'employee-docs' | 'support-attachments';

/** Path convention {tenant_id}/{entity}/{file} — the storage policies match on it. */
export function tenantPath(entity: string, fileName: string): string {
  const t = currentTenantId();
  if (!t) throw new Error('No tenant in session — cannot build a storage path');
  return `${t}/${entity}/${fileName}`;
}

export async function uploadImage(bucket: Bucket, path: string, file: File | Blob) {
  const { data, error } = await sb().storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return data;
}

export function publicUrl(bucket: Bucket, path: string): string {
  return sb().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Private buckets (employee CNIC photos, support attachments) — signed, short TTL. */
export async function signedUrl(bucket: Bucket, path: string, expiresInSeconds = 300) {
  const { data, error } = await sb().storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFile(bucket: Bucket, path: string) {
  const { error } = await sb().storage.from(bucket).remove([path]);
  if (error) throw error;
}
