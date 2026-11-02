// Dedicated Order Taker portal — public URL: #/order-taker/:tenantId
// Mobile/tablet-app style UI (purple theme). Opens on web but looks like an app.
import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from '@/lib/hash-router';
import { initStore, getUsers, setCurrentBranchId, getSettings } from '@/lib/store';
import { getTenantId, getTenantName } from '@/lib/tenant';
import { User } from '@/lib/types';
const posLoader = () => import('@/pages/POSScreen');
const tablesLoader = () => import('@/pages/TablesPage');
const billsLoader = () => import('@/pages/RunningBillsPage');
const POSScreen = lazy(posLoader);
const TablesPage = lazy(tablesLoader);
const RunningBillsPage = lazy(billsLoader);
import AutoKotPrinter from '@/components/AutoKotPrinter';
import AutoReadyTimer from '@/components/AutoReadyTimer';
import ReadyNotificationBus from '@/components/ReadyNotificationBus';
import ReadyOrderPoller from '@/components/ReadyOrderPoller';
import ServiceCallNotifier from '@/components/ServiceCallNotifier';
import { toast } from 'sonner';
import { AlertTriangle, ClipboardList, CloudUpload, FileText, LayoutGrid, LogOut, MapPin, MapPinOff, Moon, ShoppingCart, Store, UserRound, WifiOff } from 'lucide-react';
import PoweredByBrand from '@/components/PoweredByBrand';
import { logStaffAction } from '@/lib/staffAudit';
import { hasLocationConsent, setLocationConsent, startLocationTracking, stopLocationTracking } from '@/lib/staffLocation';
import PortalRestaurantBadge from '@/components/PortalRestaurantBadge';
import StaffProfileCard from '@/components/StaffProfileCard';
import { onSyncStatus } from '@/lib/store';
import { deferredDeadLetterCount, getDeadLetterOps, onDeferredSyncChange, requeueDeadLetter } from '@/lib/deferredSync';
import { useRestaurantIdentity } from '@/hooks/useRestaurantIdentity';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
// v1.89.0 — the phone-app kit shared with DT Rider (cards, toggles, banners, buttons).
import { Banner, RButton, RCard, Toggle } from '@/components/rider/riderUi';

// ===== v1.89.0 — the order-taker screens of the design package (design-project/05b-order-taker-app) =====
//
// The app's own teal look, light or dark (OTK-14), with the tabs at the thumb (POS · Tables · Bills · Me), the
// connection and upload state said at the top (OTK-13), a Me tab with the restaurant, the profile, location sharing,
// the theme and a log out that asks first (OTK-12), and the sign-in in the same look (OTK-02). The POS, Tables and
// Bills screens are the cashier's own screens, unchanged: they take the teal through the colour tokens. Sign-in,
// the portal bootstrap, location consent and logout (which ends the server session) work exactly as before.

const OTK_THEME_KEY = 'otk-theme';

const SESSION_KEY = 'pos-order-taker-session';

export default function OrderTakerPortalPage() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  // Optional Workspace Code — only used to tell two restaurants apart when the
  // same username exists at both. Security still comes from the server.
  const [workspaceCode, setWorkspaceCode] = useState(() => {
    try { return localStorage.getItem('pos-workspace-code') || ''; } catch { return ''; }
  });
  const [needCode, setNeedCode] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [dark, setDark] = useState(() => { try { return localStorage.getItem(OTK_THEME_KEY) === 'dark'; } catch { return false; } });
  const setTheme = (next: boolean) => {
    setDark(next);
    try { localStorage.setItem(OTK_THEME_KEY, next ? 'dark' : 'light'); } catch { /* lasts this session */ }
  };
  const settings = ready ? getSettings() : null;
  const logo = settings?.orderTakerLogo || settings?.logo;

  // Preload all route chunks on mount so tab switches are instant (no loading spinner).
  useEffect(() => {
    posLoader(); tablesLoader(); billsLoader();
  }, []);

  useEffect(() => {
    initStore().then(async () => {
      // ===== v1.29.0 — the reads this app cannot make as `anon` =====
      //
      // Tables, riders and live orders are all authenticated-only, and a staff
      // login creates no Supabase session — so the ordinary cloud load brought
      // back the public menu and nothing else. That is why the tables the
      // restaurant had added were not here. These come through portal_*, which
      // resolves this device's token to one restaurant.
      try {
        const { hasPortalSession, portalBootstrap } = await import('@/lib/portalData');
        if (hasPortalSession()) {
          const res = await portalBootstrap();
          if (res.ok) {
            const { adoptPortalRows } = await import('@/lib/store');
            // v1.43.0 — REPORTED: the app must say which restaurant it is.
            // One build serves every restaurant, so the name comes from the
            // session and is cached for the next cold start.
            try {
              const rest = (res.data as { restaurant?: { name?: string; branchName?: string } }).restaurant;
              if (rest?.name) localStorage.setItem('dt-portal-restaurant', JSON.stringify(rest));
            } catch { /* private mode */ }
            await adoptPortalRows(res.data);
          } else if (res.reason === 'no_session') {
            toast.error(res.message);
          }

        }
      } catch { /* offline: the cached roster below still signs the user in */ }

      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          const u = JSON.parse(raw);
          const found = getUsers().find(x => x.id === u.id && x.role === 'order_taker' && x.isActive)
            || (u.user && u.user.role === 'order_taker' ? (u.user as User) : null);
          if (found) {
            setUser(found);
            localStorage.setItem('pos-user-id', found.id);
            localStorage.setItem('pos-user-role', 'order_taker');
            try { localStorage.setItem('dt_pos_current_user', JSON.stringify({ id: found.id, name: found.name, username: found.username, role: found.role })); } catch {}
            if (found.branchId) setCurrentBranchId(found.branchId);
          }
        }

      } catch {}
      setReady(true);
    });
  }, []);

  // Consent-based location sharing: nothing is recorded until it is switched on.
  const [shareLocation, setShareLocation] = useState(hasLocationConsent());
  useEffect(() => {
    if (user && shareLocation) startLocationTracking();
    else stopLocationTracking();
    return () => stopLocationTracking();
  }, [user, shareLocation]);

  const toggleShareLocation = () => {
    const next = !shareLocation;
    setLocationConsent(next);
    setShareLocation(next);
    toast[next ? 'success' : 'info'](next
      ? 'Location sharing is ON — your route is visible to your manager.'
      : 'Location sharing is OFF.');
  };

  const handleLogin = async () => {
    if (!phone || !pin) { setLoginError('Username / phone and PIN are required'); return; }
    setLoginError('');
    setLoading(true);
    try {
      // 1) Cloud first — ONE app for ALL restaurants. The server resolves
      //    tenant + branch + role from the credentials; the app never picks
      //    the restaurant itself.
      const { portalSignIn } = await import('@/lib/staffPortalAuth');
      const digits = phone.replace(/\D/g, '');
      const candidates = Array.from(new Set([phone.trim(), digits].filter(Boolean))) as string[];
      let serverMessage = '';
      let identity: Awaited<ReturnType<typeof portalSignIn>> | null = null;
      for (const username of candidates) {
        const res = await portalSignIn({ username, password: pin, workspaceCode, expectedRole: 'order_taker' });
        if (res.ok) { identity = res; break; }
        serverMessage = res.message;
        if (res.needWorkspaceCode) setNeedCode(true);
      }

      let u: User | null = null;
      if (identity?.ok) {
        await initStore();
        // The portal token was just minted; pull this restaurant's tables,
        // riders and live orders with it before the screen renders, or the app
        // opens on an empty floor plan.
        try {
          const { portalBootstrap } = await import('@/lib/portalData');
          const boot = await portalBootstrap();
          if (boot.ok) {
            const { adoptPortalRows } = await import('@/lib/store');
            await adoptPortalRows(boot.data);
          }
        } catch { /* signed in; the data can arrive on the next refresh */ }
        const found = getUsers().find(x => x.id === identity.identity.userId);
        u = found || ({
          id: identity.identity.userId,
          name: identity.identity.name,
          username: identity.identity.username,
          role: 'order_taker',
          isActive: true,
          branchId: identity.identity.branchId || undefined,
        } as unknown as User);
      } else {
        // 2) Offline fallback — a device that already holds this restaurant's
        //    staff list can still sign in without the network.
        await initStore();
        u = getUsers().find(x => {
          if (x.role !== 'order_taker' || !x.isActive) return false;
          const userPhone = (x.phone || x.username || '').replace(/\D/g, '');
          const phoneOk = userPhone.length >= 10
            ? userPhone.slice(-10) === digits.slice(-10)
            : (x.username || '').toLowerCase() === phone.trim().toLowerCase();
          return phoneOk && (x.pin || x.password || '') === pin;
        }) || null;
      }

      if (!u) {
        // On the screen, not only in a toast that disappears; lockout messages come from the server unchanged.
        setLoginError(serverMessage || 'Wrong username/phone or PIN — or the account is not active');
        setLoading(false);
        return;
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify({ id: u.id, user: u }));
      localStorage.setItem('pos-user-id', u.id);
      localStorage.setItem('pos-user-role', 'order_taker');
      try { localStorage.setItem('dt_pos_current_user', JSON.stringify({ id: u.id, name: u.name, username: u.username, role: u.role })); } catch {}
      if (u.branchId) setCurrentBranchId(u.branchId);
      setUser(u);
      logStaffAction('LOGIN', { userId: u.id, userName: u.name, userRole: 'order_taker' });
      toast.success(`Welcome ${u.name}`);
    } finally { setLoading(false); }
  };


  const handleLogout = async () => {
    logStaffAction('LOGOUT');
    stopLocationTracking();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('pos-user-id');
    localStorage.removeItem('pos-user-role');

    // v1.47.0 — logging out has to end the SERVER session too.
    //
    // This cleared the local user and left the portal token in place. The
    // screen showed a login form while the device still held a token good for
    // thirty days: everything the portal RPCs serve — this restaurant's menu,
    // tables, live orders and customers — stayed readable from a phone that
    // had been "logged out", and would have stayed readable on a lost one.
    // portalLogout() deletes the session row server-side and clears the cached
    // restaurant, so the next person starts with nothing.
    try {
      const { portalLogout } = await import('@/lib/portalData');
      await portalLogout();
    } catch { /* the local token is gone either way, which is what matters */ }

    setUser(null);
    setPhone(''); setPin('');
  };




  if (!ready) {
    // OTK-01 — the app colour while the session is read, so there is no white flash.
    return (
      <div className="dt-otk flex h-[100dvh] flex-col items-center justify-center gap-4 bg-[linear-gradient(160deg,#134e4a,#0f766e)] text-white">
        <div className="grid h-20 w-20 place-items-center rounded-[22px] bg-white/15"><ClipboardList className="h-10 w-10" /></div>
        <div className="text-[20px] font-extrabold">DT Order Taker</div>
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-white border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  // ============ SIGN IN (OTK-02) ============
  if (!user) {
    const field = 'h-12 w-full rounded-xl border bg-card px-3 text-[16px] outline-none focus:border-primary';
    return (
      <div className="dt-otk min-h-[100dvh]" data-theme={dark ? 'dark' : 'light'} data-otk-app>
        <div className="mx-auto flex min-h-[100dvh] w-full max-w-[420px] flex-col gap-5 px-4 pb-6 pt-10" data-otk-screen="login">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-[hsl(var(--rd-tint))] text-primary">
              {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : <ClipboardList className="h-9 w-9" />}
            </div>
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight">DT Order Taker</h1>
              <p className="text-[14px] text-muted-foreground">{getTenantName() || 'Sign in with the account your restaurant admin created.'}</p>
            </div>
          </div>
          {loginError && <Banner tone="bad" icon={AlertTriangle}>{loginError}</Banner>}
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); void handleLogin(); }}>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">Username / phone</span>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="username or 03xx-xxxxxxx" autoFocus autoComplete="username" className={field} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">PIN / password</span>
              <input type="password" maxLength={64} value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" autoComplete="current-password"
                className={cn(field, 'text-center font-mono tracking-widest')} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">Workspace code {needCode ? '(required)' : '(optional)'}</span>
              <input value={workspaceCode} onChange={e => setWorkspaceCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={12}
                className={cn(field, 'text-center font-mono tracking-widest', needCode && 'border-[hsl(var(--rd-warn))] ring-2 ring-[hsl(var(--rd-warn)/.35)]')} />
            </label>
            <RButton type="submit" variant="primary" size="lg" className="w-full" busy={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </RButton>
          </form>
          <p className="text-center text-[12.5px] text-muted-foreground">
            Ask your restaurant admin for your username, password and Workspace Code (Users &amp; Access → Order Taker).
          </p>
          <div className="mt-auto space-y-2">
            <PoweredByBrand />
            <p className="text-center text-[10px] text-muted-foreground">
              Tenant: <code className="font-mono">{getTenantId()?.slice(0, 8) || 'none'}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const logout = () => {
    // v1.89.0 — asks first, as the rider app has since v1.49.0: one stray tap on the bar used to sign the waiter out.
    if (!window.confirm('Log out of DT Order Taker? You will need your username and PIN to sign back in.')) return;
    void handleLogout();
  };

  // ============ APP SHELL — the phone app (OTK-03, OTK-12, OTK-13, OTK-14) ============
  // Constrained to tablet width even on a desktop browser, so it always works like the app.
  return (
    <div className="dt-otk flex h-[100dvh] justify-center" data-theme={dark ? 'dark' : 'light'} data-otk-app>
      <div className="flex h-[100dvh] w-full max-w-[820px] flex-col bg-background shadow-2xl">
        <OrderTakerNav user={user} logo={logo} onLogout={logout} shareLocation={shareLocation} onToggleLocation={toggleShareLocation} />
        <ConnectionBanners />
        <div className="min-h-0 flex-1 overflow-auto">
          <Suspense fallback={<div className="h-full" />}>
            <Routes>
              <Route path="/" element={<POSScreen />} />
              <Route path="/pos" element={<POSScreen />} />
              <Route path="/tables" element={<TablesPage />} />
              <Route path="/bills" element={<RunningBillsPage />} />
              {/* v1.46.0 — the order taker's own profile: picture, name, phone,
                  and which restaurant this app belongs to. */}
              <Route path="/me" element={<OrderTakerMe shareLocation={shareLocation} onToggleLocation={toggleShareLocation} dark={dark} onDark={setTheme} onLogout={logout} />} />
              <Route path="*" element={<POSScreen />} />
            </Routes>
          </Suspense>
        </div>
        <OrderTakerTabs />
        <AutoKotPrinter />
        <AutoReadyTimer />
        <ReadyNotificationBus />
        <ReadyOrderPoller types={['dine-in']} />
        <ServiceCallNotifier />
      </div>
    </div>
  );
}

function useOtkTabs() {
  const location = useLocation();
  const tid = getTenantId() || '';
  const base = `/order-taker/${tid}`;
  const tabs = [
    { key: 'pos', label: 'POS', title: 'Order Taker', icon: ShoppingCart, path: `${base}` },
    { key: 'tables', label: 'Tables', title: 'Tables', icon: LayoutGrid, path: `${base}/tables` },
    { key: 'bills', label: 'Bills', title: 'Running bills', icon: FileText, path: `${base}/bills` },
    { key: 'me', label: 'Me', title: 'Me', icon: UserRound, path: `${base}/me` },
  ];
  const activeKey = location.pathname.endsWith('/tables') ? 'tables'
    : location.pathname.endsWith('/bills') ? 'bills'
    : location.pathname.endsWith('/me') ? 'me' : 'pos';
  return { tabs, activeKey };
}

/** The top bar (OTK-03): whose app, which restaurant, location sharing, log out. */
function OrderTakerNav({ user, logo, onLogout, shareLocation, onToggleLocation }: {
  user: User; logo?: string; onLogout: () => void;
  shareLocation: boolean; onToggleLocation: () => void;
}) {
  const { tabs, activeKey } = useOtkTabs();
  const r = useRestaurantIdentity();
  const title = tabs.find(t => t.key === activeKey)?.title || 'Order Taker';
  const where = [user.name, r.name || getTenantName() || 'Restaurant', r.workspaceCode].filter(Boolean).join(' · ');
  return (
    <header data-rd-hero className="flex shrink-0 items-center gap-2.5 rounded-none px-3 pb-2.5 pt-[calc(10px+env(safe-area-inset-top,0px))]">
      {logo
        ? <img src={logo} alt="" className="relative z-10 h-10 w-10 rounded-xl object-cover ring-2 ring-white/30" />
        : <span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15"><ClipboardList className="h-5 w-5" /></span>}
      <div className="relative z-10 min-w-0 flex-1">
        <div className="truncate text-[16px] font-extrabold leading-tight">{title}</div>
        <div className="line-clamp-2 text-[12px] leading-snug opacity-85" title={where}>{where}</div>
      </div>
      <button
        type="button"
        aria-pressed={shareLocation}
        onClick={onToggleLocation}
        title={shareLocation ? 'Location sharing is ON — tap to stop' : 'Share my location with my manager'}
        className={cn('relative z-10 inline-flex h-9 items-center gap-1 rounded-full px-3 text-[12.5px] font-extrabold', shareLocation ? 'bg-white/20' : 'bg-white/10 opacity-80')}
      >
        {shareLocation ? <MapPin className="h-4 w-4" /> : <MapPinOff className="h-4 w-4" />}
        {shareLocation ? 'ON' : 'OFF'}
      </button>
      <button type="button" aria-label="Log out" title="Log out" onClick={onLogout} className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-xl hover:bg-white/15">
        <LogOut className="h-5 w-5" />
      </button>
    </header>
  );
}

/** The tabs at the thumb (the design's tab bar), not under the header. */
function OrderTakerTabs() {
  const navigate = useNavigate();
  const { tabs, activeKey } = useOtkTabs();
  return (
    <nav data-rd-tabbar aria-label="Order Taker" className="flex shrink-0">
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          aria-current={activeKey === t.key ? 'page' : undefined}
          onClick={() => navigate(t.path)}
          className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11.5px] font-bold"
        >
          <t.icon className="h-[22px] w-[22px]" />
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/**
 * OTK-13 — what the connection and the upload queue are doing, said at the top of every tab. Orders taken offline
 * go into the deferred queue on this phone and upload through the portal when the connection is back; a change the
 * server kept refusing is "stuck" and can be retried here, as on the till's status bar.
 */
function ConnectionBanners() {
  const [sync, setSync] = useState<{ online: boolean; pending: number }>({ online: true, pending: 0 });
  const [stuck, setStuck] = useState(() => deferredDeadLetterCount());
  useEffect(() => onSyncStatus(s => setSync({ online: s.online, pending: s.pending })), []);
  useEffect(() => {
    const read = () => setStuck(deferredDeadLetterCount());
    const off = onDeferredSyncChange(read);
    const t = setInterval(read, 5000);
    return () => { off?.(); clearInterval(t); };
  }, []);
  const retry = async () => {
    const ops = await getDeadLetterOps();
    for (const op of ops) await requeueDeadLetter(op.id);
    setStuck(deferredDeadLetterCount());
    toast.info(ops.length ? `Sending ${ops.length} again…` : 'Nothing is waiting');
  };
  if (sync.online && sync.pending === 0 && stuck === 0) return null;
  return (
    <div className="shrink-0 space-y-1.5 px-3 pt-2" data-otk-banners>
      {!sync.online && (
        <Banner tone="bad" icon={WifiOff}>
          You are offline. Orders you take are kept on this phone and sent when you are back{sync.pending ? ` (${sync.pending} waiting)` : ''}.
        </Banner>
      )}
      {sync.online && sync.pending > 0 && (
        <Banner tone="info" icon={CloudUpload}>Sending {sync.pending} change{sync.pending === 1 ? '' : 's'}…</Banner>
      )}
      {stuck > 0 && (
        <Banner tone="warn" icon={AlertTriangle} action={<RButton size="sm" onClick={() => void retry()}>Retry</RButton>}>
          {stuck} change{stuck === 1 ? '' : 's'} could not be sent. {stuck === 1 ? 'It is' : 'They are'} saved on this phone.
        </Banner>
      )}
    </div>
  );
}

/** "You are taking orders for" (v1.43.0): so nobody takes orders into the wrong restaurant. */
function RestaurantCard() {
  const r = useRestaurantIdentity();
  const name = r.name || getTenantName() || '';
  return (
    <RCard className="border-transparent bg-[hsl(var(--rd-tint))]" data-otk-restaurant>
      <div className="mb-2 text-[12.5px] text-muted-foreground">You are taking orders for</div>
      {name ? (
        <div className="flex items-center gap-3">
          {r.logoUrl
            ? <img src={r.logoUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><Store className="h-6 w-6" /></span>}
          <div className="min-w-0">
            <div className="text-[19px] font-extrabold leading-tight">{name}</div>
            <div className="text-[13px] text-muted-foreground">
              {[r.branchName, r.workspaceCode && `Workspace ${r.workspaceCode}`].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      ) : <PortalRestaurantBadge showCode />}
    </RCard>
  );
}

/**
 * The Order Taker's own screen (OTK-12): a plain statement of WHICH restaurant this app is signed in to, their
 * picture, name and phone, location sharing, the theme, and log out.
 *
 * REPORTED: "order taker ka apna profile" and "pta ho mera restaurant ye ha".
 */
function OrderTakerMe({ shareLocation, onToggleLocation, dark, onDark, onLogout }: {
  shareLocation: boolean; onToggleLocation: () => void; dark: boolean; onDark: (v: boolean) => void; onLogout: () => void;
}) {
  return (
    <div className="mx-auto max-w-[520px] space-y-3 p-4" data-otk-screen="me">
      <RestaurantCard />
      <StaffProfileCard />
      <RCard className="divide-y py-1">
        <div className="flex items-center gap-3 py-3">
          <MapPin className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 text-[15px]">Share my location with my manager</span>
          <Toggle checked={shareLocation} onChange={() => onToggleLocation()} label="Share my location with my manager" />
        </div>
        <div className="flex items-center gap-3 py-3">
          <Moon className="h-5 w-5 text-muted-foreground" />
          <span className="flex-1 text-[15px]">Dark theme</span>
          <Toggle checked={dark} onChange={onDark} label="Dark theme" />
        </div>
      </RCard>
      <RButton className="w-full" icon={LogOut} onClick={onLogout}>Log out</RButton>
      <p className="text-center text-[12px] text-muted-foreground">DT Order Taker v{APP_VERSION}</p>
      <PoweredByBrand />
    </div>
  );
}
