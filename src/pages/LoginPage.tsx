import { useState } from 'react';
import { usingSupabaseAuth, authTenantId } from '@/lib/authProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getUsers, getSettings, setCurrentBranchId } from '@/lib/store';
import { Lock, User as UserIcon, LogIn, Eye, EyeOff, ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import dtLogo from '@/assets/digital-target-logo.png';
import LoginMarketingPanel, { LoginVersionBadge } from '@/components/LoginMarketingPanel';
import ContactDigitalTargetDialog from '@/components/ContactDigitalTargetDialog';

interface Props {
  onLogin: (userId: string, role: string) => void;
}

const REMEMBER_KEY = 'pos-remember-username';
const SAVED_USERNAME_KEY = 'pos-saved-username';

export default function LoginPage({ onLogin }: Props) {
  // Remember Me defaults ON — staff username Windows aur Web dono pe yaad rehta hai.
  const rememberPref = typeof localStorage !== 'undefined' ? localStorage.getItem(REMEMBER_KEY) : null;
  const initialRemember = rememberPref !== '0';
  const initialUsername = (typeof localStorage !== 'undefined' && localStorage.getItem(SAVED_USERNAME_KEY)) || '';
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(initialRemember);
  const [showContact, setShowContact] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const settings = getSettings();

  const handleLogin = async () => {
    setTimedOut(false);
    setLoading(true);

    // ===== v1.21.3 — POS user login on Supabase =====
    // The path below reads getUsers() from the LOCAL store and compares
    // `u.password === password` in plain text. That is the Firebase-era model,
    // where staff records lived in the cached `users` array with the password
    // stored as-is.
    //
    // On Supabase, staff live in `user_profiles` and the password is a bcrypt
    // hash that never leaves the database — so the local array is empty and a
    // plaintext comparison could never match. The result was "Invalid username
    // or password" for credentials that were perfectly correct.
    //
    // verify_staff_pin() does the comparison inside Postgres, which is also
    // the only place the hash exists.
    if (usingSupabaseAuth()) {
      try {
        // ===== v1.25.2 — wait for the tenant, do not guess =====
        // authTenantId() is populated asynchronously: the session restores
        // first, then the tenant is resolved (from the JWT claims, or from
        // user_profiles when the claims hook is not registered). On a second
        // login the POS screen can render before that finishes.
        //
        // Reading it too early gave null, and the RPC was then called with a
        // null tenant — which matches no user, so the answer came back "not
        // ok" and the screen said "Invalid username or password" for entirely
        // correct credentials.
        const { waitForAuthReady } = await import('@/lib/authProvider');
        await waitForAuthReady();

        let tenantId = authTenantId();
        if (!tenantId) {
          // Last resort: ask the database directly. Better one extra query
          // than telling the operator their password is wrong.
          const { currentAuthUser } = await import('@/lib/authProvider');
          const uid = currentAuthUser()?.uid;
          if (uid) {
            const { sb: sbc } = await import('@/lib/supabase');
            const { data: prof } = await sbc()
              .from('user_profiles').select('tenant_id').eq('user_id', uid).maybeSingle();
            tenantId = (prof as any)?.tenant_id ?? null;
          }
        }
        if (!tenantId) {
          // The restaurant this device belongs to, remembered from the last
          // owner sign-in. The session can lapse; the restaurant does not.
          const { getTenantId } = await import('@/lib/tenant');
          tenantId = getTenantId();
        }

        if (!tenantId) {
          setLoading(false);
          // Deliberately NOT "invalid password": nothing is wrong with the
          // credentials, the device simply has no restaurant attached.
          toast.error('This device is not linked to a restaurant yet. Sign in with the owner email first.');
          return;
        }

        // Verified server-side (service role) so it does not depend on a live
        // browser session, and so the failure reason is exact.
        const { staffSignIn } = await import('@/lib/staffAuth.functions');
        const r0 = await staffSignIn({
          data: { tenantId, username: username.trim(), password },
        });

        setLoading(false);
        if (!r0.ok) { toast.error(r0.message); return; }

        const r = {
          ok: true as const,
          user_id: r0.userId,
          name: r0.name,
          role: r0.role,
          branch_id: r0.branchId,
          permissions: r0.permissions,
        };


        try {
          localStorage.setItem('dt_pos_current_user', JSON.stringify({
            id: r.user_id, name: r.name, username: username.trim().toLowerCase(), role: r.role,
          }));
          localStorage.setItem('pos-user-id', r.user_id || '');
        } catch { /* storage unavailable */ }

        // ===== v1.21.4 — THE EMPTY SIDEBAR =====
        // getCurrentUser() and the sidebar both resolve the signed-in user by
        // scanning the LOCAL `users` array:
        //
        //     getUsers().find(u => u.id === localStorage['pos-user-id'])
        //
        // On Supabase that array is empty — staff live in `user_profiles`. So
        // the lookup returned undefined, visiblePagesForUser() hit its
        // `if (!user) return []` guard, and the sidebar rendered NOTHING.
        //
        // The POS opened to a blank shell with no error, which read as "the
        // software has no modules".
        //
        // Mirroring the authenticated user into the local store keeps every
        // existing permission and role check working unchanged — they were
        // never the problem, they simply had nobody to check.
        try {
          const { saveUserLocal } = await import('@/lib/store');
          saveUserLocal({
            id: r.user_id || '',
            username: username.trim().toLowerCase(),
            name: r.name || username,
            role: (r.role || 'cashier') as any,
            password: '',                       // the hash stays in Postgres
            permissions: (r.permissions ?? []) as string[],
            branchId: r.branch_id ?? undefined,
            isActive: true,
          } as any);
        } catch (e) {
          console.error('[login] could not cache the POS user locally', e);
        }

        try {
          if (remember) {
            localStorage.setItem(REMEMBER_KEY, '1');
            localStorage.setItem(SAVED_USERNAME_KEY, username);
          } else {
            localStorage.setItem(REMEMBER_KEY, '0');
            localStorage.removeItem(SAVED_USERNAME_KEY);
          }
        } catch { /* storage unavailable */ }

        if (r.branch_id && r.role !== 'admin' && r.role !== 'manager') {
          setCurrentBranchId(r.branch_id);
        }
        onLogin(r.user_id || '', (r.role || 'cashier') as any);
        toast.success(`Welcome, ${r.name || username}`);
      } catch (e: any) {
        setLoading(false);
        toast.error(e?.message || 'Login failed. Please try again.');
      }
      return;
    }

    // 5s safety timeout — staff login is local lookup; if it stalls beyond
    // that the cache is in a bad state, show retry.
    const timer = setTimeout(() => { setLoading(false); setTimedOut(true); }, 25000);
    try {
      const users = getUsers();
      const user = users.find(u => u.username === username && u.password === password && u.isActive);
      clearTimeout(timer);
      setLoading(false);
      if (user) {
        try { localStorage.setItem('dt_pos_current_user', JSON.stringify({ id: user.id, name: user.name, username: user.username, role: user.role })); } catch {}
        // Remember Me persistence
        try {
          if (remember) {
            localStorage.setItem(REMEMBER_KEY, '1');
            localStorage.setItem(SAVED_USERNAME_KEY, username);
          } else {
            localStorage.setItem(REMEMBER_KEY, '0');
            localStorage.removeItem(SAVED_USERNAME_KEY);
          }
        } catch {}
        if (user.branchId && user.role !== 'admin' && user.role !== 'manager') {
          setCurrentBranchId(user.branchId);
        }
        onLogin(user.id, user.role);
        toast.success(`Welcome, ${user.name}`);
      } else {
        // The device flag may still say "firebase" from a legacy sign-in while
        // the staff account actually lives in the cloud. Try the cloud check
        // before declaring the credentials wrong.
        const { getTenantId } = await import('@/lib/tenant');
        const tid = getTenantId();
        if (tid) {
          try {
            const { staffSignIn } = await import('@/lib/staffAuth.functions');
            const r0 = await staffSignIn({ data: { tenantId: tid, username: username.trim(), password } });
            if (r0.ok) {
              try {
                localStorage.setItem('dt_pos_current_user', JSON.stringify({
                  id: r0.userId, name: r0.name, username: username.trim().toLowerCase(), role: r0.role,
                }));
                localStorage.setItem('pos-user-id', r0.userId);
              } catch {}
              try {
                const { saveUserLocal } = await import('@/lib/store');
                saveUserLocal({
                  id: r0.userId, username: username.trim().toLowerCase(), name: r0.name,
                  role: r0.role as any, password: '', permissions: r0.permissions,
                  branchId: r0.branchId ?? undefined, isActive: true,
                } as any);
              } catch {}
              if (r0.branchId && r0.role !== 'admin' && r0.role !== 'manager') setCurrentBranchId(r0.branchId);
              onLogin(r0.userId, r0.role);
              toast.success(`Welcome, ${r0.name}`);
              return;
            }
            toast.error(r0.message);
            return;
          } catch { /* fall through to the generic message */ }
        }
        toast.error('Invalid username or password');
      }

    } catch (e) {
      clearTimeout(timer);
      setLoading(false);
      toast.error('Login failed. Please try again.');
    }
  };

  // "Back" -> switch back to Owner Email/Password screen.
  // "Refresh & Clear Cache" -> wipe local cache (IDB / localStorage / SW) so
  // a stuck/stale login can recover instantly without manually clearing browser data.
  const handleBackToOwner = async () => {
    try {
      const { forceLogoutAndWipe } = await import('@/lib/sessionIsolation');
      await forceLogoutAndWipe();
    } catch {}
    try { sessionStorage.setItem('pos-intentional-logout', '1'); } catch {}
    try { window.location.reload(); } catch {}
  };

  const handleRefreshCache = async () => {
    toast.info('Clearing local cache…');
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    try {
      // wipe IndexedDB
      const dbs: any = (indexedDB as any).databases ? await (indexedDB as any).databases() : [];
      for (const d of dbs) { if (d?.name) indexedDB.deleteDatabase(d.name); }
    } catch {}
    try {
      // keep saved username for convenience, drop everything else local.
      // v1.2.4: emergency backups (unsynced-work snapshots) MUST survive —
      // they are the only recovery path if the cloud never got the data.
      const saved = localStorage.getItem(SAVED_USERNAME_KEY);
      const rem = localStorage.getItem(REMEMBER_KEY);
      const backups: [string, string][] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('dt-pos-emergency-backup::')) {
          const v = localStorage.getItem(k);
          if (v) backups.push([k, v]);
        }
      }
      localStorage.clear();
      sessionStorage.clear();
      if (saved) localStorage.setItem(SAVED_USERNAME_KEY, saved);
      if (rem) localStorage.setItem(REMEMBER_KEY, rem);
      for (const [k, v] of backups) { try { localStorage.setItem(k, v); } catch {} }
    } catch {}
    setTimeout(() => window.location.reload(), 400);
  };

  const brandLogo = settings.appLogo || settings.logo || dtLogo;

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

        {/* Right form */}
        <div className="flex items-center justify-center p-6 lg:p-10">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-gold/25 bg-white/[0.04] backdrop-blur-xl p-8 shadow-elegant">
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={handleBackToOwner}
                  className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white"
                  title="Go back to the owner email/password screen"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </button>
                <button
                  type="button"
                  onClick={handleRefreshCache}
                  className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white"
                  title="Clear the local cache (IndexedDB / Service Worker) to enable instant login"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh &amp; Clear Cache
                </button>
              </div>
              <div className="flex flex-col items-center text-center mb-6">
                <div className="h-16 w-16 rounded-2xl ring-1 ring-gold/40 bg-white/5 p-2 flex items-center justify-center">
                  <img src={brandLogo} alt="Logo" className="h-full w-full object-contain" />
                </div>
                <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Welcome Back!</h2>
                <p className="mt-1 text-sm text-white/70">Sign in to your restaurant account</p>
                <div className="mt-3 h-[1px] w-24 bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
              </div>

              <div className="space-y-5">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1.5 block">Username</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
                    <Input
                      placeholder="Enter your username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="pl-9 h-12 bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-gold focus:ring-gold/20"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1.5 block">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-9 pr-10 h-12 bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-gold focus:ring-gold/20"
                      onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                      className="h-4 w-4 rounded border-white/30 bg-white/10 accent-gold"
                    />
                    <span className="text-white/80">Remember me</span>
                  </label>
                  <span className="text-gold/90 font-semibold">Contact Admin</span>
                </div>

                <Button
                  className="w-full h-12 text-sm font-bold tracking-wider text-white hover:opacity-95 shadow-lg uppercase"
                  style={{ background: 'linear-gradient(90deg, #7b2cbf 0%, #9d4edd 50%, #c77dff 100%)' }}
                  onClick={handleLogin}
                  disabled={loading}
                >
                  <LogIn className="h-4 w-4 mr-2" /> {loading ? 'Signing in…' : 'Sign In'}
                </Button>

                {timedOut && (
                  <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-100">
                    <p className="font-bold mb-1">Login failed</p>
                    <p>Login slow ho raha hai. Internet/cache check karein ya Retry dabayein.</p>
                    <button
                      type="button"
                      onClick={() => { setTimedOut(false); handleLogin(); }}
                      className="mt-2 text-xs font-bold underline"
                    >Retry</button>
                  </div>
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
