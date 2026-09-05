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
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { LogOut, ShoppingCart, LayoutGrid, FileText, ClipboardList, MapPin, MapPinOff, UserRound } from 'lucide-react';
import PoweredByBrand from '@/components/PoweredByBrand';
import { logStaffAction } from '@/lib/staffAudit';
import { hasLocationConsent, setLocationConsent, startLocationTracking, stopLocationTracking } from '@/lib/staffLocation';
import PortalRestaurantBadge from '@/components/PortalRestaurantBadge';
import StaffProfileCard from '@/components/StaffProfileCard';

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
    if (!phone || !pin) { toast.error('Username / phone and PIN are required'); return; }
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
        toast.error(serverMessage || 'Wrong username/phone or PIN — or the account is not active');
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


  const handleLogout = () => {
    logStaffAction('LOGOUT');
    stopLocationTracking();
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('pos-user-id');
    localStorage.removeItem('pos-user-role');
    setUser(null);
    setPhone(''); setPin('');
  };




  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-violet-900 via-purple-800 to-fuchsia-900">
        <div className="animate-spin h-8 w-8 border-4 border-white border-t-transparent rounded-full" />
      </div>
    );
  }

  // ============ LOGIN SCREEN — mobile app style ============
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-900 via-purple-800 to-fuchsia-900 p-4">
        <div className="w-full max-w-[400px] bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl p-6 space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto h-20 w-20 rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-2xl ring-4 ring-white/20 overflow-hidden">
              {logo
                ? <img src={logo} alt="" className="h-full w-full object-cover" />
                : <ClipboardList className="h-10 w-10 text-white" />}
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">DT Order Taker</h1>
            <p className="text-xs text-white/70">{getTenantName() || 'Sign in to your restaurant'}</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-white/80 uppercase tracking-wider">Username / Phone</label>
              <Input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="username or 03xx-xxxxxxx"
                autoFocus
                className="h-12 mt-1 bg-white/10 border-white/20 text-white placeholder:text-white/40 rounded-xl text-base"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-white/80 uppercase tracking-wider">PIN / Password</label>
              <Input
                type="password"
                maxLength={64}
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="••••"
                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
                className="h-12 mt-1 bg-white/10 border-white/20 text-white placeholder:text-white/40 rounded-xl text-lg tracking-widest text-center"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-white/80 uppercase tracking-wider">
                Workspace Code {needCode ? '(required)' : '(optional)'}
              </label>
              <Input
                value={workspaceCode}
                onChange={e => setWorkspaceCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={12}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
                className={`h-11 mt-1 bg-white/10 border-white/20 text-white placeholder:text-white/40 rounded-xl font-mono tracking-widest text-center ${needCode ? 'ring-2 ring-amber-400' : ''}`}
              />
            </div>

            <Button
              onClick={handleLogin}
              disabled={loading}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white font-extrabold text-base shadow-lg"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
            <p className="text-[10px] text-white/60 text-center pt-1">
              Ask your restaurant admin for your username, password and Workspace Code
              (Users &amp; Access → Order Taker).
            </p>
          </div>
          <div className="pt-2"><PoweredByBrand /></div>
          <p className="text-[10px] text-white/50 text-center pt-3 border-t border-white/10">
            Tenant: <code className="font-mono">{getTenantId()?.slice(0, 8) || 'none'}</code>
          </p>
        </div>
      </div>
    );
  }

  // ============ APP SHELL — mobile/tablet app style ============
  // Constrain to ~tablet width even on desktop browsers so it always feels like an app.
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-950 via-purple-900 to-fuchsia-950 flex justify-center">
      <div className="w-full max-w-[820px] flex flex-col h-screen bg-background shadow-2xl">
        <OrderTakerNav
          user={user}
          logo={logo}
          onLogout={handleLogout}
          shareLocation={shareLocation}
          onToggleLocation={toggleShareLocation}
        />
        <div className="flex-1 overflow-auto">
          <Suspense fallback={<div className="h-full" />}>
            <Routes>
              <Route path="/" element={<POSScreen />} />
              <Route path="/pos" element={<POSScreen />} />
              <Route path="/tables" element={<TablesPage />} />
              <Route path="/bills" element={<RunningBillsPage />} />
              {/* v1.46.0 — the order taker's own profile: picture, name, phone,
                  and which restaurant this app belongs to. */}
              <Route path="/me" element={<OrderTakerMe />} />
              <Route path="*" element={<POSScreen />} />
            </Routes>
          </Suspense>
        </div>
        <AutoKotPrinter />
        <AutoReadyTimer />
        <ReadyNotificationBus />
        <ReadyOrderPoller types={['dine-in']} />
        <ServiceCallNotifier />
        {/* Owner + Digital Target branding */}
        <div className="px-2 pb-2 pt-1 bg-background shrink-0">
          <PoweredByBrand />
        </div>
      </div>
    </div>
  );
}

function OrderTakerNav({ user, logo, onLogout, shareLocation, onToggleLocation }: {
  user: User; logo?: string; onLogout: () => void;
  shareLocation: boolean; onToggleLocation: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const tid = getTenantId() || '';
  const base = `/order-taker/${tid}`;
  const tabs = [
    { key: 'pos', label: 'POS', icon: ShoppingCart, path: `${base}` },
    { key: 'tables', label: 'Tables', icon: LayoutGrid, path: `${base}/tables` },
    { key: 'bills', label: 'Bills', icon: FileText, path: `${base}/bills` },
    { key: 'me', label: 'Me', icon: UserRound, path: `${base}/me` },
  ];
  const activeKey = location.pathname.endsWith('/tables') ? 'tables'
    : location.pathname.endsWith('/bills') ? 'bills'
    : location.pathname.endsWith('/me') ? 'me' : 'pos';

  return (
    <>
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 text-white shadow-lg">
        {logo
          ? <img src={logo} alt="" className="h-8 w-8 rounded-lg object-cover ring-2 ring-white/30" />
          : <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center"><ClipboardList className="h-4 w-4" /></div>}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-extrabold leading-tight truncate">Order Taker</div>
          <PortalRestaurantBadge compact showCode />
          <div className="text-[10px] opacity-80 truncate">{user.name} · {getTenantName() || 'Restaurant'}</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className={`h-8 px-2 text-white hover:bg-white/20 ${shareLocation ? 'bg-white/20' : ''}`}
          onClick={onToggleLocation}
          title={shareLocation ? 'Location sharing is ON — tap to stop' : 'Share my location with my manager'}
        >
          {shareLocation ? <MapPin className="h-4 w-4" /> : <MapPinOff className="h-4 w-4 opacity-70" />}
          <span className="ml-1 text-[10px] font-bold">{shareLocation ? 'ON' : 'OFF'}</span>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-white hover:bg-white/20" onClick={onLogout} title="Exit">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Bottom tab bar (mobile app pattern) */}
      <div className="grid grid-cols-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white border-b border-white/10">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => navigate(t.path)}
            className={`flex flex-col items-center justify-center py-2 gap-0.5 transition-all ${
              activeKey === t.key
                ? 'bg-white text-violet-700 font-extrabold'
                : 'text-white/90 hover:bg-white/10'
            }`}
          >
            <t.icon className="h-4 w-4" />
            <span className="text-[10px] font-bold">{t.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * The Order Taker's own screen: their picture, name and phone, and a plain
 * statement of WHICH restaurant this app is signed in to.
 *
 * REPORTED: "order taker ka apna profile" and "pta ho mera restaurant ye ha".
 */
function OrderTakerMe() {
  return (
    <div className="p-3 space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
          You are taking orders for
        </div>
        <PortalRestaurantBadge showCode />
      </div>
      <StaffProfileCard />
    </div>
  );
}
