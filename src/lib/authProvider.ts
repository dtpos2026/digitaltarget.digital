// ============================================================================
// AUTH ADAPTER — one synchronous surface over two backends
//
// The problem this solves, stated plainly:
//
//   Firebase exposes `auth.currentUser` SYNCHRONOUSLY. This codebase depends
//   on that in ~22 places, several inside synchronous functions that run on
//   every store read. Supabase's `getUser()` is ASYNCHRONOUS.
//
//   Replacing currentUser with `await getUser()` everywhere would either
//   require making a large amount of synchronous business logic async, or —
//   far worse — leave call sites reading a not-yet-resolved value. That
//   produces intermittent "not logged in" errors: they appear under load, on
//   slow connections, at a client's till, and almost never on a dev machine.
//
// The fix: one module-level session cache, populated once at boot and kept
// current by the backend's own change listener. Everything below is
// synchronous and safe to call from existing code unchanged.
//
// ---------------------------------------------------------------------------
// A SECOND, SUBTLER TRAP — tenant identity
//
// Under Firebase, `tenant_id === user.uid`. The owner's auth uid WAS the
// tenant id, so the two were interchangeable and the code treats them that way.
//
// Under Supabase they are DIFFERENT UUIDs: the auth user id, and a separate
// tenants.id resolved through user_profiles. Any code that keeps using `uid`
// as the tenant will silently read the wrong tenant's data — or, with RLS on,
// read nothing at all and look like data loss.
//
// So this adapter deliberately exposes `uid()` and `tenantId()` as SEPARATE
// accessors. Under Firebase they return the same value; under Supabase they do
// not. Call sites must ask for the one they actually mean.
// ============================================================================

import { getSettings } from './store';

// ---------------------------------------------------------------------------
// Which backend?
// ---------------------------------------------------------------------------
//
// ⚠️ This flag CANNOT be read from cloud settings, and the first version of
// this file made exactly that mistake.
//
// getSettings() reads the tenant-scoped local cache, which is populated from
// the cloud — and reaching the cloud requires being signed in. So at the
// moment initAuth() runs there is no tenant, no settings, and the flag always
// evaluated to false. The Supabase path was unreachable: the toggle could be
// switched on in Settings and nothing would happen, because by the next boot
// the same chicken-and-egg applied again.
//
// The backend choice is therefore a LOCAL, per-device setting in localStorage,
// available synchronously before anything else loads. The Admin toggle in
// Settings still drives it — syncBackendFlagFromSettings() mirrors the cloud
// value down to the device once settings are actually available.
const BACKEND_KEY = 'dtpos-auth-backend';

/** Kept only so existing imports keep compiling. Supabase is the only value. */
export type AuthBackend = 'supabase';

/**
 * Which backend should authenticate?
 *
 * ===== THE BUG THIS FIXES =====
 * This used to read the device flag alone:
 *
 *     return localStorage.getItem(BACKEND_KEY) === 'supabase';
 *
 * On a fresh browser that key does not exist, so the answer was "Firebase" and
 * the Super Admin — whose account lives ONLY in Supabase — was sent to
 * Firebase and got `auth/invalid-credential`.
 *
 * It is a chicken-and-egg: the flag is per-device, but it cannot be set until
 * someone has already logged in, and they cannot log in until the flag is set.
 *
 * Resolution order now:
 *   1. An explicit device choice, once one has been made or learned.
 *   2. Otherwise Supabase, IF this build is configured for it. A build that
 *      ships VITE_SUPABASE_URL is a Supabase build; that is the intent.
 *   3. Otherwise Firebase.
 *
 * Legacy restaurants are protected by the fallback in authSignIn(): a Firebase
 * account that fails against Supabase is retried against Firebase, and the
 * device remembers. Nobody is locked out either way.
 */
export function usingSupabaseAuth(): boolean {
  // ===== v1.25.3 — HARD PINNED =====
  // This used to consult a per-device localStorage flag and fall back to
  // Firebase when the flag was absent or the build looked unconfigured. Two
  // things went wrong with that:
  //
  //   * A fresh browser has no flag, so the answer was "Firebase", and the
  //     Super Admin — whose account exists only in Supabase — was sent to a
  //     backend that no longer exists and told the credentials were invalid.
  //   * A single stale flag on one till pinned that machine to a dead backend
  //     permanently, with no way for the operator to see why.
  //
  // Firebase is gone. There is exactly one backend, so there is nothing left
  // to resolve and no state that can put a device on the wrong path.
  return true;
}

/** True when this build carries Supabase configuration. */
function supabaseBuildConfigured(): boolean {
  const env = (import.meta as any).env ?? {};
  return !!env.VITE_SUPABASE_URL
    && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
}

export function rememberBackend(b: AuthBackend = 'supabase'): void {
  try { localStorage.setItem(BACKEND_KEY, b); } catch { /* ignore */ }
}

/**
 * Is Supabase even an option on this build?
 *
 * Read from env, NOT from tenant settings. The backend has to be decided
 * BEFORE the user signs in, and tenant settings cannot be loaded until after
 * they have — that circular dependency is what caused
 * `Firebase: Error (auth/invalid-credential)` on the Super Admin login: the
 * device had no stored preference, so it defaulted to Firebase and tried to
 * authenticate an account that only exists in Supabase.
 */
export function supabaseAvailable(): boolean {
  const url = (import.meta as any).env?.VITE_SUPABASE_URL;
  const key = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY
           ?? (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
  return !!url && !!key;
}

/**
 * Why Supabase is unavailable, in words an operator can act on.
 *
 * ===== THE FAILURE THIS EXISTS TO PREVENT =====
 * Vite bakes VITE_* variables into the bundle AT BUILD TIME. They are not read
 * at runtime. So a build made without .env.local silently contains no Supabase
 * configuration — supabaseAvailable() returns false, the app quietly falls back
 * to Firebase, and an account that only exists in Supabase is rejected with
 * `Firebase: Error (auth/invalid-credential)`.
 *
 * That message points at the wrong system entirely. Nothing is wrong with the
 * credentials; the build simply has no idea Supabase exists. Rather than let
 * that happen again, the login screen now says so directly.
 */
export function supabaseUnavailableReason(): string | null {
  const env = (import.meta as any).env ?? {};
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;

  if (!url && !key) {
    return 'This build was compiled without Supabase configuration. '
      + 'Create .env.local with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, '
      + 'then rebuild — Vite reads these at BUILD time, not at run time.';
  }
  if (!url) return 'VITE_SUPABASE_URL is missing from this build. Add it and rebuild.';
  if (!key) {
    return 'VITE_SUPABASE_PUBLISHABLE_KEY is missing from this build. Add it and rebuild.';
  }
  return null;
}

/** Is the signed-in user a platform super admin? Supabase only. */
export async function checkSuperAdmin(): Promise<boolean> {
  if (!usingSupabaseAuth()) return false;
  const id = uid();
  if (!id) return false;
  try {
    const { sb } = await import('./supabase');
    const { data, error } = await sb()
      .from('super_admins').select('user_id')
      .eq('user_id', id).eq('is_active', true).maybeSingle();
    if (error) { console.warn('[auth] super admin check failed', error.message); return false; }
    return !!data;
  } catch { return false; }
}

export interface ResolvedSignIn {
  user: AuthUser;
  backend: 'supabase';
  superAdmin: boolean;
  tenantId: string | null;
}

/** Sign in. Supabase is the only backend; nothing is resolved or guessed. */
export async function resolveAndSignIn(email: string, password: string): Promise<ResolvedSignIn> {
  // ===== v1.25.3 — no backend resolution, because there is only one =====
  // The previous version tried Supabase, then retried Firebase on a
  // credentials failure. That fallback is now actively harmful: the Firebase
  // SDK is stubbed out, so the retry throws `[firebase-removed] ...` and that
  // — not the real Supabase error — is what the operator saw on screen.
  //
  // A genuinely wrong password must report a wrong password.
  const reason = supabaseUnavailableReason();
  if (reason) throw new Error(reason);

  const user = await authSignIn(email, password);
  const superAdmin = await checkSuperAdmin();
  return { user, backend: 'supabase', superAdmin, tenantId: authTenantId() };
}

/** Set the device's backend. Takes effect on the next boot. */
/**
 * Forget the device's backend choice, so the next sign-in resolves from the
 * build configuration again. Used after a transient failure — never after a
 * successful sign-in.
 */
export function clearRememberedBackend(): void {
  try { localStorage.removeItem(BACKEND_KEY); } catch { /* ignore */ }
}

export function setAuthBackend(backend: AuthBackend): void {
  try { localStorage.setItem(BACKEND_KEY, backend); } catch { /* ignore */ }
}

/**
 * Mirror the Admin's cloud toggle down to this device.
 *
 * Called AFTER settings are loaded. Deliberately does not re-init auth: the
 * session is already established on the other backend, and swapping providers
 * underneath a running app would sign the cashier out mid-shift. It applies on
 * the next start, which is also when a staged rollout should apply.
 */
export function syncBackendFlagFromSettings(): void {
  try {
    // Backend selection is a build/session concern, never a restaurant
    // feature. This build is cloud-backed; allowing an old settings value to
    // select removed Firebase code caused successful local saves to retry
    // forever instead of reaching the database.
    const want: AuthBackend = 'supabase';
    if (localStorage.getItem(BACKEND_KEY) !== want) {
      localStorage.setItem(BACKEND_KEY, want);
      console.info(`[auth] backend will switch to ${want} on next restart`);
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// The cached session
// ---------------------------------------------------------------------------

export interface AuthUser {
  uid: string;            // auth user id (Firebase uid / Supabase user id)
  email: string | null;
  displayName?: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  /** Resolved tenant. Under Firebase this equals user.uid; under Supabase it does not. */
  tenantId: string | null;
  branchId: string | null;
  role: string | null;
  token: string | null;
}

const EMPTY: AuthState = { user: null, tenantId: null, branchId: null, role: null, token: null };

let _state: AuthState = EMPTY;
let _ready = false;
let _readyPromise: Promise<void> | null = null;
const _listeners = new Set<(u: AuthUser | null) => void>();

function publish(next: AuthState) {
  const prevUid = _state.user?.uid ?? null;
  _state = next;
  if ((next.user?.uid ?? null) !== prevUid) {
    for (const fn of _listeners) {
      try { fn(next.user); } catch (e) { console.error('[auth] listener failed', e); }
    }
  }
}

// ---------------------------------------------------------------------------
// Synchronous accessors — the drop-in replacements
// ---------------------------------------------------------------------------

/** Synchronous. Replaces `fbAuth().currentUser`. */
export function currentAuthUser(): AuthUser | null { return _state.user; }

/** Synchronous. The auth user id — NOT necessarily the tenant. */
export function uid(): string | null { return _state.user?.uid ?? null; }

/**
 * Synchronous. The tenant this user belongs to.
 * Firebase: same as uid(). Supabase: resolved from the JWT claims.
 */
export function authTenantId(): string | null { return _state.tenantId; }

export function authBranchId(): string | null { return _state.branchId; }
export function authRole(): string | null { return _state.role; }
export function authToken(): string | null { return _state.token; }

/**
 * True once the session has been restored from storage.
 *
 * Callers that must distinguish "signed out" from "not resolved yet" should
 * check this. Most do not need to: App.tsx awaits waitForAuthReady() before
 * rendering anything that reads the session.
 */
export function isAuthReady(): boolean { return _ready; }

/** Replaces `onAuthStateChanged`. Fires immediately with the current value. */
export function onAuthUserChanged(fn: (u: AuthUser | null) => void): () => void {
  _listeners.add(fn);
  try { fn(_state.user); } catch { /* ignore */ }
  return () => { _listeners.delete(fn); };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Resolve the persisted session once, then keep it current.
 * MUST be awaited during app boot, before any synchronous accessor is trusted.
 */
export function initAuth(): Promise<void> {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    try {
      await initSupabase();
    } catch (e) {
      console.error('[auth] init failed', e);
    } finally {
      _ready = true;
    }
  })();
  return _readyPromise;
}

export function waitForAuthReady(): Promise<void> {
  return _readyPromise ?? initAuth();
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

function stateFromSupabaseSession(session: any): AuthState {
  if (!session?.user) return EMPTY;
  // tenant_id / branch_id / role are injected by custom_access_token_hook.
  const meta = session.user.app_metadata ?? {};
  return {
    user: {
      uid: session.user.id,
      email: session.user.email ?? null,
      displayName: meta.display_name ?? session.user.user_metadata?.display_name ?? null,
    },
    // NOT the uid. Null here just means the JWT hook is not registered —
    // resolveTenantFromDb() below fills it in from user_profiles.
    tenantId: meta.tenant_id ?? null,
    branchId: meta.branch_id ?? null,
    role: meta.role ?? null,
    token: session.access_token ?? null,
  };
}

/**
 * Resolve tenant / branch / role from the database when the token does not
 * carry them.
 *
 * ===== WHY THIS EXISTS =====
 * The design put tenant_id into the JWT via custom_access_token_hook, which is
 * fast and avoids a query on every read. But that hook has to be switched on
 * by hand in the Supabase dashboard — and if nobody does, the token has no
 * tenant, `authTenantId()` returns null, and a user who signed in perfectly
 * well is told their account "is not linked to a restaurant".
 *
 * Depending on a dashboard toggle that the application cannot verify, and
 * failing with a message that blames the account, is a bad trade. So the JWT
 * remains the fast path, and this is the fallback: one query against
 * user_profiles, which RLS already lets a user read for themselves.
 *
 * The app now works whether or not the hook was ever registered.
 */
async function resolveTenantFromDb(userId: string): Promise<Partial<AuthState>> {
  try {
    const { sb } = await import('./supabase');
    const { data, error } = await sb()
      .from('user_profiles')
      .select('tenant_id, branch_id, role, display_name, all_branches')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) { console.warn('[auth] tenant lookup failed', error.message); return {}; }
    if (!data) return {};
    return {
      tenantId: (data as any).tenant_id ?? null,
      branchId: (data as any).branch_id ?? null,
      role: (data as any).role ?? null,
    };
  } catch (e) {
    console.warn('[auth] tenant lookup threw', e);
    return {};
  }
}

/** Publish a Supabase session, filling in the tenant from the DB if needed. */
async function publishSupabaseSession(session: any): Promise<void> {
  const base = stateFromSupabaseSession(session);
  if (base.user && !base.tenantId) {
    const extra = await resolveTenantFromDb(base.user.uid);
    publish({ ...base, ...extra });
    return;
  }
  publish(base);
}

async function initSupabase(): Promise<void> {
  const { sb, isSupabaseConfigured } = await import('./supabase');
  if (!isSupabaseConfigured()) {
    console.warn('[auth] Supabase selected but not configured — staying signed out');
    return;
  }
  const { data } = await sb().auth.getSession();
  await publishSupabaseSession(data.session);

  sb().auth.onAuthStateChange((_event, session) => {
    void publishSupabaseSession(session);
  });

  if (data.session && !stateFromSupabaseSession(data.session).tenantId) {
    console.warn(
      '[auth] signed in but the token carries no tenant_id. Register ' +
      'custom_access_token_hook under Authentication -> Hooks, then sign in again.',
    );
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function signInSupabase(email: string, password: string): Promise<void> {
  const { sb } = await import('./supabase');
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw error;
  // Await the tenant lookup: the login screen checks authTenantId()
  // immediately afterwards, and a race here reads as "no restaurant".
  await publishSupabaseSession(data.session);
}


/**
 * Sign in against the CURRENTLY resolved backend. No fallback here.
 *
 * Fallback belongs to resolveAndSignIn(), which is the orchestrator the login
 * page uses. Duplicating it here would mean two layers each retrying the other
 * backend, and resolveAndSignIn would then report the wrong `backend` value —
 * so the login page would send a legacy Firebase owner down the Supabase
 * tenant path, or vice versa.
 */
export async function authSignIn(email: string, password: string): Promise<AuthUser> {
  await signInSupabase(email, password);
  if (!_state.user) throw new Error('sign-in produced no session');
  return _state.user;
}


export async function authSignUp(
  email: string, password: string, displayName?: string,
): Promise<AuthUser> {
  const { sb } = await import('./supabase');
  const { data, error } = await sb().auth.signUp({
    email, password, options: { data: { display_name: displayName ?? '' } },
  });
  if (error) throw error;
  if (data.session) await publishSupabaseSession(data.session);
  return { uid: data.user!.id, email: data.user!.email ?? null, displayName };
}

/**
 * Send a password-reset link.
 *
 * ===== A DELIBERATE SECURITY CHOICE =====
 * This ALWAYS reports success, even when the address is unknown. Reporting
 * "no such account" would turn the reset form into an account-enumeration
 * oracle: anyone could discover which restaurant owners hold accounts on the
 * platform, simply by trying addresses.
 *
 * The person who owns the mailbox learns the truth either way — they either
 * receive a link or they do not.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const addr = email.trim().toLowerCase();
  if (!addr) throw new Error('Enter your email address first');

  try {
    const { sb } = await import('./supabase');
    await sb().auth.resetPasswordForEmail(addr, {
      redirectTo: `${window.location.origin}/#/reset-password`,
    });
  } catch (e) {
    // Logged for support, never surfaced — see the note above.
    console.warn('[auth] password reset request failed', e);
  }
}

/** Complete the reset once the user has followed the emailed link. */
export async function completePasswordReset(newPassword: string): Promise<void> {
  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  const { sb } = await import('./supabase');
  const { error } = await sb().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function authSignOut(): Promise<void> {
  try {
    const { sb } = await import('./supabase');
    await sb().auth.signOut();
  } finally {
    // Clear locally even if the network call failed, or the UI would show a
    // signed-in state that no longer exists.
    publish(EMPTY);
  }
}

/** Replaces `user.getIdToken()`. Returns the cached token; refresh is automatic. */
export async function authGetToken(_forceRefresh = false): Promise<string | null> {
  const { sb } = await import('./supabase');
  const { data } = await sb().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Create the tenant for a freshly signed-up owner.
 * Supabase only — under Firebase the tenant IS the uid, so there is nothing
 * to create.
 */
export async function bootstrapTenant(
  restaurantName: string, slug: string, branchName = 'Main Branch',
): Promise<{ tenantId: string; branchId: string }> {
  const { sb } = await import('./supabase');
  const { data, error } = await sb().rpc('bootstrap_restaurant', {
    p_restaurant_name: restaurantName, p_slug: slug, p_branch_name: branchName,
  });
  if (error) throw error;
  // The new claims only appear in a refreshed token.
  await sb().auth.refreshSession();
  const { data: s } = await sb().auth.getSession();
  await publishSupabaseSession(s.session);
  const r = data as { tenant_id: string; branch_id: string };
  return { tenantId: r.tenant_id, branchId: r.branch_id };
}

/** Test seam only. */
export function __setAuthStateForTest(s: Partial<AuthState>): void {
  publish({ ...EMPTY, ...s });
  _ready = true;
}
