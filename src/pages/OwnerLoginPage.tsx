import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Lock, Store, Shield, LogIn, Loader2, MonitorSmartphone } from 'lucide-react';
import { toast } from 'sonner';
// isCloudConfigured replaces isFirebaseConfigured: the question is whether a
// cloud backend exists, which on this build means Supabase and nothing else.
import { isCloudConfigured } from '@/lib/cloudMode';
import { setTenant, getDeviceMeta, enrichDeviceMeta, fetchDeviceNetworkInfo } from '@/lib/tenant';
import { usingSupabaseAuth, supabaseAvailable, resolveAndSignIn, authSignIn, authSignOut,
         authTenantId, authBranchId, currentAuthUser,
         supabaseUnavailableReason } from '@/lib/authProvider';
import { registerThisDevice } from '@/lib/supabaseSync';
import { APP_VERSION } from '@/lib/version';
import { effectiveDeviceLimit, setCurrentTenantPlan, setCurrentTenantOverrides } from '@/lib/plans';
import { setCurrentTenantExpiry, tsToDate, isExpired } from '@/lib/billing';
import LoginShell from '@/components/LoginShell';
import { isOwnerAppRoute } from '@/lib/appEntry';
import { BRAND } from '@/lib/brand';
import ContactDigitalTargetDialog from '@/components/ContactDigitalTargetDialog';

interface Props {
  onSuccess: (opts: { superAdmin: boolean }) => void;
}

const OWNER_REMEMBER_KEY = 'pos-owner-remember-email';
const OWNER_SAVED_EMAIL_KEY = 'pos-owner-saved-email';
const LOGIN_TIMEOUT_MS = 15000;
const ACCOUNT_CHECK_TIMEOUT_MS = 7000;
const DEVICE_CHECK_TIMEOUT_MS = 10000;
const DEVICE_APPROVED_KEY_PREFIX = 'pos-owner-device-approved:';

/**
 * Reject a promise that takes too long, so a stalled network call can never
 * leave the login screen spinning forever.
 *
 * Note: this was accidentally deleted alongside the Firestore helpers it sat
 * next to; it is still used by the Supabase device-registration step below.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Request timed out'): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { window.clearTimeout(t); resolve(value); },
      (error) => { window.clearTimeout(t); reject(error); },
    );
  });
}

// FastDocResult / decodeFirestoreValue / getUserIndexFast / getDeviceDocFast
// were deleted with the legacy Firebase login path in v1.25.3. They spoke
// to https://firestore.googleapis.com directly, bypassing the SDK stub.

function approvedDeviceKey(uid: string, deviceId: string) {
  return `${DEVICE_APPROVED_KEY_PREFIX}${uid}:${deviceId}`;
}

function rememberApprovedDevice(uid: string, deviceId: string) {
  try { localStorage.setItem(approvedDeviceKey(uid, deviceId), String(Date.now())); } catch {}
}

function forgetApprovedDevice(uid: string, deviceId: string) {
  try { localStorage.removeItem(approvedDeviceKey(uid, deviceId)); } catch {}
}

function hasRecentApprovedDevice(uid: string, deviceId: string) {
  try {
    const value = Number(localStorage.getItem(approvedDeviceKey(uid, deviceId)) || 0);
    return value > 0 && Date.now() - value < 1000 * 60 * 60 * 24 * 14;
  } catch { return false; }
}

export default function OwnerLoginPage({ onSuccess }: Props) {
  // Sign-up has been removed — only Super Admin can create restaurant accounts.
  // Remember Me defaults to ON — owner ka email Windows aur Web dono pe save rehta hai
  // jab tak owner khud "Switch Account" press karke clear na kare.
  const rememberPref = typeof localStorage !== 'undefined' ? localStorage.getItem(OWNER_REMEMBER_KEY) : null;
  const initialRemember = rememberPref !== '0'; // default true
  const initialEmail = (typeof localStorage !== 'undefined' && localStorage.getItem(OWNER_SAVED_EMAIL_KEY)) || '';
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [resetSending, setResetSending] = useState(false);
  const [remember, setRemember] = useState(initialRemember);
  const [restaurantName, setRestaurantName] = useState('');
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Task 6c — after ~10s of loading, show a "Taking longer than usual?" hint
  // with a Retry action so the user is never stuck on a silent spinner.
  const [slowLogin, setSlowLogin] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // Pending-device wait state: keeps user signed in and listens for approval
  // so admin's approval auto-proceeds the login without re-entering credentials.
  const [pendingDevice, setPendingDevice] = useState<{ tid: string; deviceId: string; deviceName: string } | null>(null);
  const pendingUnsubRef = useRef<null | (() => void)>(null);
  const approvalCbRef = useRef<null | ((s: { approved: boolean; blocked: boolean }) => void | Promise<void>)>(null);
  const [checking, setChecking] = useState(false);
  const ownerApp = isOwnerAppRoute();
  /** OWN-03 "Check again": ask the server now instead of waiting for the next poll. */
  const checkApprovalNow = async () => {
    if (!pendingDevice) return;
    setChecking(true);
    try {
      const { sb } = await import('@/lib/supabase');
      const { data } = await sb().from('devices').select('approved,blocked').eq('id', pendingDevice.deviceId).maybeSingle();
      const row = data as { approved?: boolean; blocked?: boolean } | null;
      if (row) await approvalCbRef.current?.({ approved: !!row.approved, blocked: !!row.blocked });
      if (row && !row.approved && !row.blocked) toast.info('Not approved yet.');
    } catch { toast.error('Could not check. Are you online?'); }
    finally { setChecking(false); }
  };
  useEffect(() => () => { pendingUnsubRef.current?.(); }, []);

  // Hard timeout safety net so loader never spins forever.
  useEffect(() => {
    if (!loading) { setTimedOut(false); return; }
    const t = setTimeout(() => { setTimedOut(true); setLoading(false); }, LOGIN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loading]);

  // Task 6c — flip slowLogin after 10s while a login is in progress; reset otherwise.
  useEffect(() => {
    if (!loading) { setSlowLogin(false); return; }
    const t = setTimeout(() => setSlowLogin(true), 10000);
    return () => clearTimeout(t);
  }, [loading]);

  // "← Switch Account" back button — only meaningful when an email is already
  // prefilled OR a tenant was previously cached on this device. Wipes session
  // and remembered email so user can switch to a different restaurant cleanly.
  const handleSwitchAccount = async () => {
    if (loading || pendingDevice) return;
    try {
      const { forceLogoutAndWipe } = await import('@/lib/sessionIsolation');
      await forceLogoutAndWipe();
    } catch {}
    try {
      localStorage.removeItem(OWNER_REMEMBER_KEY);
      localStorage.removeItem(OWNER_SAVED_EMAIL_KEY);
    } catch {}
    setEmail(''); setPassword(''); setRemember(false);
    setInfo(null); setTimedOut(false);
    toast.info('Switched. Please sign in with another account.');
  };

  // Persist (or clear) remembered email — called after a successful login.
  const persistRememberMe = () => {
    try {
      if (remember && email) {
        localStorage.setItem(OWNER_REMEMBER_KEY, '1');
        localStorage.setItem(OWNER_SAVED_EMAIL_KEY, email);
      } else {
        // Explicitly opted-out — record '0' so we don't auto-restore next time.
        localStorage.setItem(OWNER_REMEMBER_KEY, '0');
        localStorage.removeItem(OWNER_SAVED_EMAIL_KEY);
      }
    } catch {}
  };


  /**
   * Send a password-reset link to the address already typed above.
   *
   * The confirmation deliberately does NOT reveal whether the account exists:
   * a different message for a known and an unknown address would let anyone
   * enumerate which restaurant owners have accounts here.
   */
  const handleForgotPassword = async () => {
    const addr = email.trim();
    if (!addr) {
      toast.error('Enter your email address first, then press Forgot password');
      return;
    }
    setResetSending(true);
    try {
      const { sendPasswordReset } = await import('@/lib/authProvider');
      await sendPasswordReset(addr);
      toast.success(
        `If an account exists for ${addr}, a reset link is on its way. ` +
        'Check your inbox and the spam folder.',
        { duration: 7000 },
      );
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the reset link');
    } finally {
      setResetSending(false);
    }
  };

  const handleSubmit = async () => {
    if (!isCloudConfigured()) {
      toast.error(supabaseUnavailableReason() ?? 'No backend is configured for this build.');
      return;
    }
    if (!email || !password) {
      toast.error('Enter an email and password');
      return;
    }
    setLoading(true);
    setInfo(null);
    try {

      // ===== v1.25.3 — one backend, one path =====
      // This used to be the Supabase half of a two-backend flow, with a
      // `if (r.backend === 'firebase')` escape into a parallel Firestore
      // login below it. Both are gone: Supabase is the only backend, so
      // there is nothing to resolve and no second path to fall into.
      const sbMissing = supabaseUnavailableReason();
      if (sbMissing) {
        console.error('[auth] Supabase unavailable:', sbMissing);
      }

      if (supabaseAvailable()) {
        const r = await resolveAndSignIn(email.trim(), password);

        {
        // ===== SUPER ADMIN =====
        // Super admins have no tenant by design — they belong to the platform,
        // not to a restaurant. Check this BEFORE the tenant guard, or every
        // super admin login would be rejected as "not linked to a restaurant".
        if (r.superAdmin) {
          setLoading(false);
          onSuccess({ superAdmin: true });
          return;
        }

        const tid = r.tenantId;
        if (!tid) {
          // Signed in, but no tenant. Either the owner has not bootstrapped a
          // restaurant yet, or the JWT claims hook is not registered in the
          // Supabase dashboard — in which case every RLS-protected read would
          // silently return empty and look like data loss. Say so plainly.
          await authSignOut();
          setLoading(false);
          toast.error(
            'Signed in, but this account is not linked to a restaurant. '
            + 'Run the restaurant setup, or check that the access-token hook is '
            + 'registered in Supabase.',
          );
          return;
        }

        // ===== v1.21.4 — carry the plan and feature overrides across =====
        // The sidebar filters every module through featureEnabled(plan, key).
        // The Firebase path sets the plan at login; this one did not, so the
        // app fell back to 'trial' — which allows only a handful of pages.
        // A restaurant on Enterprise saw a Trial sidebar and looked stripped.
        try {
          const { sb } = await import('@/lib/supabase');
          const [tRes, sRes] = await Promise.all([
            sb().from('tenants').select('plan, plan_expires_at').eq('id', tid).maybeSingle(),
            sb().from('tenant_settings').select('settings')
              .eq('tenant_id', tid)
              .eq('branch_id', '00000000-0000-0000-0000-000000000000').maybeSingle(),
          ]);
          setCurrentTenantPlan((tRes.data as any)?.plan || 'trial');
          setCurrentTenantOverrides(
            ((sRes.data as any)?.settings?.featureOverrides) ?? null,
          );
        } catch (e) {
          console.error('[login] could not load plan/overrides', e);
          // Deliberately do NOT fall back to 'trial' silently here — leaving
          // the previous value is safer than downgrading a paying restaurant
          // to a Trial sidebar because one query failed.
        }

        setTenant(tid, currentAuthUser()?.displayName || email.trim());

        // Register this machine as a billing device before anything can sync.
        // apply_sync_batch reads the BRANCH from the device row and refuses an
        // unregistered or unapproved one, so without this every push would
        // fail with "device not approved for this tenant" and the queue would
        // silently back off — bills stacking up locally with no visible cause.
        try {
          const meta = await enrichDeviceMeta(getDeviceMeta()).catch(() => getDeviceMeta());
          // Owners carry no home branch, and skipping registration for them
          // left the panel with zero devices and an empty Live Map. Fall back
          // to the restaurant's first branch so every till registers on login.
          let branch = authBranchId();
          if (!branch) {
            const { sb } = await import('@/lib/supabase');
            const { data: b } = await sb().from('branches')
              .select('id').eq('tenant_id', tid).order('sort_order').limit(1).maybeSingle();
            branch = (b as any)?.id ?? null;
          }
          if (branch) {
            const net = await withTimeout(fetchDeviceNetworkInfo(), 2500, 'ip').catch(() => ({} as any));
            const reg = await registerThisDevice(
              meta.deviceId, meta.deviceName || 'POS', branch,
              meta.platform, APP_VERSION,
              {
                ...meta,
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
                ip: net?.ip ?? null, city: net?.city ?? null,
                region: net?.region ?? null, country: net?.country ?? null,
                isp: net?.isp ?? null,
                lastLoginAt: new Date().toISOString(),
                lastLoginEmail: email.trim(),
              },
              net?.ip ?? null,
            );
            const { startDeviceHeartbeat } = await import('@/lib/supabaseSync');

            if (reg.blocked) {
              await authSignOut();
              setInfo(reg.reason || 'This device has been blocked by Super Admin. Contact Digital Target support to unblock.');
              setLoading(false);
              return;
            }

            if (!reg.approved) {
              // Device limit is full — this machine must be approved before it
              // can open the POS. Wait live so the cashier never re-logs in.
              const { watchDeviceApproval } = await import('@/lib/supabaseSync');
              pendingUnsubRef.current?.();
              setPendingDevice({
                tid, deviceId: reg.deviceId,
                deviceName: meta.deviceName || 'This device',
              });
              setLoading(false);
              const onApprovalState = async (s: { approved: boolean; blocked: boolean }) => {
                if (s.blocked) {
                  pendingUnsubRef.current?.(); pendingUnsubRef.current = null;
                  setPendingDevice(null);
                  await authSignOut();
                  setInfo('This device has been blocked by Super Admin.');
                  return;
                }
                if (s.approved) {
                  pendingUnsubRef.current?.(); pendingUnsubRef.current = null;
                  setPendingDevice(null);
                  startDeviceHeartbeat(reg.deviceId);
                  onSuccess({ superAdmin: false });
                }
              };
              // v1.92.0 — kept so the Owner app's "Check again" runs exactly the same decision as the live listener.
              approvalCbRef.current = onApprovalState;
              pendingUnsubRef.current = watchDeviceApproval(reg.deviceId, onApprovalState);
              return;
            }

            startDeviceHeartbeat(reg.deviceId);
          } else {
            console.info('[auth] no branch for this restaurant — register the device from Settings');
          }
        } catch (e: any) {
          // Never block a login on a network failure: the cashier must be able
          // to bill offline. A device the server already knows keeps working.
          console.error('[auth] device registration failed', e);
        }



        setLoading(false);
        onSuccess({ superAdmin: false });
        return;
        }
      }

      // ===== v1.25.3 — the legacy Firebase login path has been DELETED =====
      //
      // Roughly 300 lines lived here: a second, parallel sign-in flow that
      // resolved the tenant through Firestore (userIndex -> tenants doc ->
      // device approval), including two hand-rolled fetches straight to
      // https://firestore.googleapis.com. Those were the last Firebase
      // network endpoints anywhere in the shipped bundle.
      //
      // The block was already unreachable: the branch above returns for every
      // Supabase sign-in, and resolveAndSignIn() no longer reports a
      // 'firebase' backend. But "unreachable" is not "gone" — it still
      // compiled, still shipped, and still gave a wrong-password error the
      // wrong name, because the retry hit the removed SDK stub and surfaced
      // `[firebase-removed] signInWithEmailAndPassword` instead of the real
      // Supabase message.
      //
      // Reaching this line now means supabaseAvailable() was false, i.e. the
      // build carries no Supabase configuration. Say exactly that, rather
      // than blaming the operator's password.
      throw new Error(
        supabaseUnavailableReason()
        ?? 'Sign-in could not be completed: no backend is configured for this build.',
      );

    } catch (e: any) {
      console.error(e);
      // Offline fallback — if browser is offline OR Firebase throws a network error
      // AND we have a cached session for this email, restore it locally.
      const msg = String(e?.code || e?.message || '');
      const looksOffline = !navigator.onLine || /network|offline|timeout|failed to fetch/i.test(msg);
      if (looksOffline) {
        try {
          const { readCachedSession, canOfflineLogin } = await import('@/lib/offlineSession');
          if (canOfflineLogin(email.trim())) {
            const c = readCachedSession(email.trim())!;
            setTenant(c.tenantId, c.tenantName || email.trim());
            toast.success('Offline login: cached session restored');
            setLoading(false);
            onSuccess({ superAdmin: false });
            return;
          }
        } catch {}
      }
      toast.error(e?.message || 'Failed');
      setTimedOut(true);
      setLoading(false);
    }
  };

  // Cancel pending-wait and fully sign out
  const cancelPendingWait = async () => {
    pendingUnsubRef.current?.(); pendingUnsubRef.current = null;
    setPendingDevice(null);
    try { await authSignOut(); } catch {}
    setInfo(null);
  };


  
  return (
    <>
      <LoginShell>
        {pendingDevice ? (
          <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-6 sm:p-7 text-center space-y-4">
            <div className="h-14 w-14 mx-auto rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
              <MonitorSmartphone className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold">Waiting for Device Approval</h2>
            {ownerApp ? (
              <p className="text-sm text-muted-foreground" data-owner-pending-copy>
                <b className="text-foreground">{pendingDevice.deviceName}</b> is a new device. It must be approved once from a device that is already signed in
                (More → Devices), or by Digital Target. This screen continues by itself when it is approved.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aap ka device <b className="text-foreground">{pendingDevice.deviceName}</b> Super Admin ki approval ka intezaar kar raha hai.
                Approval hote hi ye screen <b className="text-foreground">khud b khud aage barhegi</b> — dobara login karne ki zaroorat nahi.
              </p>
            )}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Live listening for approval…
            </div>
            <div className="text-[11px] text-muted-foreground">
              If the device limit is reached, contact the admin: <b className="text-foreground">{BRAND.phoneShort}</b>
            </div>
            {ownerApp && (
              <Button className="w-full" disabled={checking} onClick={() => void checkApprovalNow()}>
                {checking ? 'Checking…' : 'Check again'}
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={cancelPendingWait}>
              {ownerApp ? 'Sign in with another account' : 'Cancel & Logout'}
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm p-6 sm:p-7">
            {(initialEmail || initialRemember) && (
              <button
                type="button"
                onClick={handleSwitchAccount}
                disabled={loading || !!pendingDevice}
                className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                ← Switch Account
              </button>
            )}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-11 w-11 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
                <Lock className="h-5 w-5" />
              </div>
              <div className="leading-tight">
                <h2 className="text-xl font-bold">Welcome back</h2>
                <p className="text-xs text-muted-foreground">Sign in to your restaurant account</p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="text-xs font-semibold mb-1.5 block">Email / Username</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="owner@restaurant.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="pl-9 h-11"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold">Password</label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetSending}
                    className="text-xs text-primary hover:underline font-semibold disabled:opacity-50"
                  >
                    {resetSending ? 'Sending…' : 'Forgot password?'}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="pl-9 h-11"
                    onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                Remember my email on this device
              </label>

              {timedOut && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <p className="font-bold mb-1">Login failed</p>
                  <p>The server is slow. Once the internet is stable, press Retry.</p>
                  <button
                    type="button"
                    onClick={() => { setTimedOut(false); handleSubmit(); }}
                    className="mt-2 text-xs font-bold underline"
                  >Retry</button>
                </div>
              )}

              <Button
                className="w-full h-12 text-sm font-bold tracking-wider hover:opacity-95 shadow-sm uppercase"
                onClick={handleSubmit}
                disabled={loading}
              >
                <LogIn className="h-4 w-4 mr-2" />
                {loading ? 'Please wait…' : 'Sign In'}
              </Button>

              {loading && slowLogin && (
                <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-xs text-center">
                  <p className="mb-1">Taking longer than usual…</p>
                  <button
                    type="button"
                    onClick={() => { setLoading(false); setSlowLogin(false); setTimeout(() => handleSubmit(), 60); }}
                    className="text-xs font-bold underline text-primary"
                  >Tap to retry</button>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground text-center pt-1 leading-relaxed">
                New restaurant accounts are created only by the Digital Target Super Admin.
                To open an account, contact <b className="text-foreground">{BRAND.phoneShort}</b>.
              </p>

              {info && (
                <div className="mt-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs flex gap-2">
                  <Shield className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                  <span>{info}</span>
                </div>
              )}

              {!isCloudConfigured() && (
                <p className="text-[10px] text-destructive text-center pt-2">
                  ⚠ This build has no Supabase configuration — set
                  VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY and rebuild.
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowContact(true)}
                className="block w-full text-center text-xs text-muted-foreground hover:text-foreground pt-2 transition"
              >
                Need an account?{' '}
                <span className="text-primary font-semibold underline underline-offset-2">
                  Contact Digital Target
                </span>
              </button>
            </div>
          </div>
        )}
      </LoginShell>

      <ContactDigitalTargetDialog open={showContact} onClose={() => setShowContact(false)} />
    </>
  );
}
