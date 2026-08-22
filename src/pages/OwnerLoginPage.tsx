import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Lock, Store, Shield, LogIn, Loader2, MonitorSmartphone } from 'lucide-react';
import dtLogo from '@/assets/digital-target-logo.png';
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
import LoginMarketingPanel, { LoginVersionBadge } from '@/components/LoginMarketingPanel';
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
              pendingUnsubRef.current = watchDeviceApproval(reg.deviceId, async (s) => {
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
              });
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
    <div
      className="min-h-screen relative overflow-hidden text-white"
      style={{ background: 'linear-gradient(135deg, #10002b 0%, #240046 45%, #3c096c 100%)' }}
    >
      {/* Decorative glows */}
      <div className="absolute top-0 -left-32 h-[28rem] w-[28rem] rounded-full bg-purple-500/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/3 h-[24rem] w-[24rem] rounded-full bg-fuchsia-600/15 blur-3xl pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.05]" style={{
        backgroundImage: 'radial-gradient(circle, #c9a84c 1px, transparent 1px)',
        backgroundSize: '38px 38px',
      }} />

      <LoginVersionBadge />

      <div className="relative z-10 min-h-screen grid lg:grid-cols-2">
        <LoginMarketingPanel />

        <div className="flex items-center justify-center p-6 lg:p-10">
          <div className="w-full max-w-md">
            {pendingDevice ? (
              <div className="rounded-3xl border border-gold/25 bg-white/[0.04] backdrop-blur-xl p-8 shadow-elegant text-center space-y-4">
                <div className="h-16 w-16 mx-auto rounded-2xl ring-1 ring-gold/40 bg-white/5 flex items-center justify-center">
                  <MonitorSmartphone className="h-8 w-8 text-gold" />
                </div>
                <h2 className="text-2xl font-extrabold">Waiting for Device Approval</h2>
                <p className="text-sm text-white/80">
                  Aap ka device <b>{pendingDevice.deviceName}</b> Super Admin ki approval ka intezaar kar raha hai.
                  Approval hote hi ye screen <b>khud b khud aage barhegi</b> — dobara login karne ki zaroorat nahi.
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-white/70">
                  <Loader2 className="h-4 w-4 animate-spin" /> Live listening for approval…
                </div>
                <div className="text-[11px] text-white/50">
                  Device limit cross hone par admin se rabta karein: <b>0345-1873354</b>
                </div>
                <Button variant="outline" className="w-full text-white border-white/30 hover:bg-white/10" onClick={cancelPendingWait}>
                  Cancel & Logout
                </Button>
              </div>
            ) : (
            <div className="rounded-3xl border border-gold/25 bg-white/[0.04] backdrop-blur-xl p-8 shadow-elegant">
              {(initialEmail || initialRemember) && (
                <button
                  type="button"
                  onClick={handleSwitchAccount}
                  disabled={loading || !!pendingDevice}
                  className="mb-3 inline-flex items-center gap-1 text-xs text-white/80 hover:text-white disabled:opacity-50"
                >
                  ← Switch Account
                </button>
              )}
              <div className="flex flex-col items-center text-center mb-6">
                <div className="h-16 w-16 rounded-2xl ring-1 ring-gold/40 bg-white/5 p-2 flex items-center justify-center">
                  <img src={dtLogo} alt="Digital Target" className="h-full w-full object-contain" />
                </div>
                <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Welcome Back!</h2>
                <p className="mt-1 text-sm text-white/70">Sign in to your restaurant account</p>
                <div className="mt-3 h-[1px] w-24 bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
              </div>

              <div className="space-y-5">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1.5 block">Email / Username</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
                    <Input
                      type="email"
                      placeholder="owner@restaurant.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="pl-9 h-12 bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-gold focus:ring-gold/20"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-white/70 font-bold">Password</label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={resetSending}
                      className="text-[10px] uppercase tracking-widest text-gold/80 hover:text-gold font-bold disabled:opacity-50"
                    >
                      {resetSending ? 'Sending…' : 'Forgot password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
                    <Input
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-9 h-12 bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-gold focus:ring-gold/20"
                      onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-white/10 accent-gold"
                  />
                  Remember my email on this device
                </label>

                {timedOut && (
                  <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-100">
                    <p className="font-bold mb-1">Login failed</p>
                    <p>Server slow ho raha hai. Internet stable ho to Retry dabayein.</p>
                    <button
                      type="button"
                      onClick={() => { setTimedOut(false); handleSubmit(); }}
                      className="mt-2 text-xs font-bold underline"
                    >Retry</button>
                  </div>
                )}

                <Button
                  className="w-full h-12 text-sm font-bold tracking-wider text-white hover:opacity-95 shadow-lg uppercase"
                  style={{ background: 'linear-gradient(90deg, #7b2cbf 0%, #9d4edd 50%, #c77dff 100%)' }}
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  {loading ? 'Please wait…' : 'Sign In'}
                </Button>

                {loading && slowLogin && (
                  <div className="rounded-md border border-gold/30 bg-gold/10 p-3 text-xs text-white/90 text-center">
                    <p className="mb-1">Taking longer than usual…</p>
                    <button
                      type="button"
                      onClick={() => { setLoading(false); setSlowLogin(false); setTimeout(() => handleSubmit(), 60); }}
                      className="text-xs font-bold underline text-gold"
                    >Tap to retry</button>
                  </div>
                )}

                <p className="text-[11px] text-white/55 text-center pt-1 leading-relaxed">
                  New restaurant accounts are created only by the Digital Target Super Admin.
                  To open an account, contact <b className="text-gold">0345-1873354</b>.
                </p>


                {info && (
                  <div className="mt-2 rounded-lg border border-gold/30 bg-gold/10 p-3 text-xs text-white flex gap-2">
                    <Shield className="h-4 w-4 shrink-0 text-gold mt-0.5" />
                    <span>{info}</span>
                  </div>
                )}

                {!isCloudConfigured() && (
                  <p className="text-[10px] text-red-300 text-center pt-2">
                    ⚠ This build has no Supabase configuration — set
                    VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY and rebuild.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setShowContact(true)}
                  className="block w-full text-center text-xs text-white/70 hover:text-white pt-2 transition"
                >
                  Need an account?{' '}
                  <span className="text-gold font-semibold underline underline-offset-2">
                    Contact Digital Target
                  </span>
                </button>

              </div>
            </div>
            )}
          </div>
        </div>
      </div>

      <ContactDigitalTargetDialog open={showContact} onClose={() => setShowContact(false)} />

      <div className="relative z-10 text-center text-[10px] tracking-[0.3em] uppercase text-white/50 pb-4">

        © {new Date().getFullYear()} Digital Target — All Rights Reserved
      </div>
    </div>
  );
}
