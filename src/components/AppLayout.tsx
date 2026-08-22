import { ReactNode, useState, useEffect } from 'react';
import { useLocation, useNavigate } from '@/lib/hash-router';
import {
  ShoppingCart, LayoutGrid, FileText, Truck, BarChart3,
  Settings, UtensilsCrossed, Database, Users, ChefHat, Menu, X,
  ZoomIn, ZoomOut, Package, LogOut, Wallet, UserCog, MessageCircle, Megaphone,
  Smartphone, ChevronDown, BookOpen, Trash2, Contact, Building2, TrendingUp,
  Percent, Layers, MapPin, Bell, Receipt, RotateCcw, Globe, Lock, Bike, Edit3, UserX, HandCoins, RefreshCw, Ticket, Printer,
} from 'lucide-react';
import { getSettings, getUsers, getBranches, getCurrentBranchId, setCurrentBranchId, canSwitchBranch, onDataChange } from '@/lib/store';
import { loadBranchAccess, filterAllowedBranches, isBranchAllowed } from '@/lib/branchAccess';

import { isPremiumThemeActive, PREMIUM_BRAND_NAME } from '@/lib/premiumTheme';
import { cn } from '@/lib/utils';
import { PAGES, visiblePagesForUser, GROUP_ORDER, type PageGroup } from '@/lib/permissions';
import PersistentWhatsApp from '@/components/PersistentWhatsApp';
import PoweredByBrand from '@/components/PoweredByBrand';
import NewOrderNotifier from '@/components/NewOrderNotifier';
import ServiceCallNotifier from '@/components/ServiceCallNotifier';
import AutoKotPrinter from '@/components/AutoKotPrinter';
import AutoReadyTimer from '@/components/AutoReadyTimer';
import ReadyNotificationBus from '@/components/ReadyNotificationBus';
import ReadyOrderPoller from '@/components/ReadyOrderPoller';
import SupportChatWidget from '@/components/SupportChatWidget';
import SyncStatusBadge from '@/components/SyncStatusBadge';
import HeaderNotificationBar from '@/components/HeaderNotificationBar';
import SyncPendingChip from '@/components/SyncPendingChip';
import BillingStatusBar from '@/components/BillingStatusBar';
import UpdateAvailableBanner from '@/components/UpdateAvailableBanner';
import { toast } from 'sonner';


const ICON_MAP = {
  ShoppingCart, LayoutGrid, FileText, Truck, BarChart3, Settings,
  UtensilsCrossed, Database, Users, ChefHat, Package, Wallet, UserCog,
} as const;

const ICON_BY_KEY: Record<string, any> = {
  pos: ShoppingCart, tables: LayoutGrid,
  bills: FileText, delivery: Truck, pickup: Package, kitchen: ChefHat,
  credits: Receipt,
  'void-bills': X,
  retray: RotateCcw,
  tokens: Ticket,
  'pending-payments': Receipt,
  'bill-reprint': Receipt,
  'printing-center': Printer,
  'foodpanda-orders': Bike,
  'advanced-reports': BarChart3,
  'online-portal': Globe,
  
  'online-approval': Bell,
  'blocked-customers': UserX,
  'blocked-locations': MapPin,
  whatsapp: MessageCircle,
  customers: Contact,
  'customer-map': MapPin,
  crm: Users, wallet: Wallet, campaigns: Bell, zones: MapPin, promotions: Percent, variations: Layers,
  marketing: Megaphone,
  'promo-codes': Percent,
  inventory: Package, dashboard: BarChart3, reports: FileText,
  'reports-center': BarChart3, 'audit-history': FileText, 'admin-sales-history': FileText, 'bill-editor': Edit3,
  'staff-audit': FileText, 'staff-locations': MapPin,
  profitability: TrendingUp, costing: TrendingUp,
  menu: UtensilsCrossed, receiving: Package,
  recipes: BookOpen, wastage: Trash2,
  hr: UserCog, accounts: Wallet, parties: Users, 'daily-wages': HandCoins, settings: Settings,
  backup: Database, users: Users, devices: Smartphone, branches: Building2, version: RefreshCw,
  'branches-map': MapPin,
  'live-map': MapPin,
  'live-riders': MapPin,
  riders: Bike,
};

interface Props {
  children: ReactNode;
  userRole: string;
  onLogout: () => void;
}

function Sidebar({
  userRole, onLogout, mobileOpen, setMobileOpen, collapsed,
}: { userRole: string; onLogout: () => void; mobileOpen: boolean; setMobileOpen: (v: boolean) => void; collapsed: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = getSettings();
  const currentUserId = localStorage.getItem('pos-user-id') || '';
  const user = getUsers().find(u => u.id === currentUserId);
  const [, setPlanTick] = useState(0);
  useEffect(() => {
    const h = () => setPlanTick(t => t + 1);
    window.addEventListener('pos-plan-changed', h);
    return () => window.removeEventListener('pos-plan-changed', h);
  }, []);
  useEffect(() => onDataChange((collection) => {
    if (collection === 'settings' || collection === '*') setPlanTick(t => t + 1);
  }), []);

  const visiblePages = visiblePagesForUser(user, !!settings.costTrackingEnabled, settings);

  // Group pages by their group
  const grouped: Record<PageGroup, typeof visiblePages> = {
    Operations: [], Marketing: [], Inventory: [], Accounts: [], Staff: [], Reports: [], Admin: [],
  };
  visiblePages.forEach(p => {
    if (grouped[p.group]) grouped[p.group].push(p);
  });

  // Track which group is open. Default: all groups containing the active route are open.
  const activeGroup = visiblePages.find(p => p.path === location.pathname)?.group;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('pos-sidebar-groups');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { Operations: true };
  });

  // Ensure active route's group is open
  useEffect(() => {
    if (activeGroup && !openGroups[activeGroup]) {
      setOpenGroups(g => ({ ...g, [activeGroup]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);

  useEffect(() => {
    localStorage.setItem('pos-sidebar-groups', JSON.stringify(openGroups));
  }, [openGroups]);

  const toggleGroup = (g: string) =>
    setOpenGroups(prev => ({ ...prev, [g]: !prev[g] }));

  const handleNav = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-50 bg-gradient-sidebar flex flex-col transition-all duration-200",
      "lg:relative lg:translate-x-0 shadow-elegant",
      collapsed ? "lg:w-[64px]" : "lg:w-[230px]",
      "w-[230px]",
      mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
    )}>
      {/* Brand */}
      <div className={cn(
        "flex items-center gap-2.5 h-14 border-b border-sidebar-border bg-black/20 backdrop-blur-sm",
        collapsed ? "px-2 justify-center" : "px-4"
      )}>
        {(settings.appLogo || settings.logo) ? (
          <img src={settings.appLogo || settings.logo} alt="Logo" className="h-9 w-9 object-contain rounded ring-1 ring-gold/40 shrink-0" />
        ) : (
          <div className="h-9 w-9 rounded bg-gradient-gold flex items-center justify-center shadow-gold shrink-0">
            <ChefHat className="h-5 w-5 text-primary" />
          </div>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-sidebar-foreground truncate leading-tight tracking-tight">
              {isPremiumThemeActive() ? PREMIUM_BRAND_NAME : (settings.name || 'DT POS')}
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-gold/80 font-semibold">
              {isPremiumThemeActive() ? 'Premium Edition' : 'Restaurant System'}
            </div>
          </div>
        )}
        <button className="ml-auto lg:hidden text-sidebar-foreground" onClick={() => setMobileOpen(false)}>
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto pos-scrollbar px-2 space-y-1">
        {GROUP_ORDER.map(groupName => {
          const items = grouped[groupName];
          if (!items || items.length === 0) return null;
          const isOpen = collapsed ? true : (openGroups[groupName] ?? false);

          return (
            <div key={groupName} className="space-y-0.5">
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(groupName)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] font-semibold text-sidebar-foreground/40 hover:text-sidebar-foreground/70 transition-smooth"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", !isOpen && "-rotate-90")} />
                  <span>{groupName}</span>
                </button>
              )}
              {isOpen && (
                <div className="space-y-px">
                  {items.map(item => {
                    const Icon = ICON_BY_KEY[item.key] || ShoppingCart;
                    const active = location.pathname === item.path;
                    return (
                      <button
                        key={item.key}
                        onClick={() => handleNav(item.path)}
                        title={collapsed ? item.title : undefined}
                        className={cn(
                          "w-full h-8 flex items-center gap-2.5 px-3 rounded-md text-[13px] transition-smooth group relative",
                          collapsed && "justify-center px-2",
                          active
                            ? "bg-white/[0.10] text-sidebar-foreground font-semibold"
                            : "text-sidebar-foreground/65 font-medium hover:text-sidebar-foreground hover:bg-white/[0.06]"
                        )}
                      >
                        {active && <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] bg-gold rounded-r-full" />}
                        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-gold" : "opacity-80")} />
                        {!collapsed && <span className="truncate">{item.title}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>


      {/* Footer */}
      <div className="px-3 py-3 border-t border-sidebar-border bg-black/20 space-y-2">
        <PoweredByBrand collapsed={collapsed} />
        <div className={cn("flex items-center gap-2 px-1", collapsed && "justify-center")}>
          <div className="h-7 w-7 rounded-full bg-gradient-gold flex items-center justify-center text-[11px] font-bold text-primary uppercase shrink-0">
            {userRole.slice(0, 1)}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-sidebar-foreground capitalize truncate">{userRole}</div>
                <div className="text-[9px] text-gold/70 uppercase tracking-wider">Signed in</div>
              </div>
              <button
                onClick={onLogout}
                className="h-7 w-7 rounded-md text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-smooth"
                title="Logout"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        {collapsed && (
          <button
            onClick={onLogout}
            className="w-full h-7 rounded-md text-sidebar-foreground/70 hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-smooth"
            title="Logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
}

function BranchSelector() {
  const [access, setAccess] = useState(0);
  useEffect(() => {
    // Branch list comes from the user's real assignments (DB), not the UI role.
    void loadBranchAccess().then(() => setAccess(a => a + 1));
  }, []);
  const branches = filterAllowedBranches((getBranches() || []).filter(b => b.isActive));
  const [current, setCurrent] = useState<string>(getCurrentBranchId() || '');
  useEffect(() => {
    // Single-branch staff never pick a branch; unauthorized selections reset.
    if (branches.length === 1 && current !== branches[0].id) {
      setCurrentBranchId(branches[0].id); setCurrent(branches[0].id);
    } else if (current && !isBranchAllowed(current)) {
      setCurrentBranchId(null); setCurrent('');
    }
  }, [access, branches.length]);
  if (branches.length === 0) return null;

  const hasActive = !!current;
  const canSwitch = canSwitchBranch();

  // Locked branch chip for non-admin/manager users (waiter / cashier / order taker)
  if (!canSwitch) {
    const branch = branches.find(b => b.id === current);
    return (
      <div className="flex items-center gap-1.5 rounded-md px-2 py-1 border bg-primary/10 border-primary/40" title="Your assigned branch (an admin can change it)">
        <Building2 className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-semibold">{branch?.name || 'No branch assigned'}</span>
        <Lock className="h-3 w-3 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-md px-2 py-1 border",
      hasActive ? "bg-primary/10 border-primary/40" : "bg-destructive/10 border-destructive/40"
    )} title="Active branch — new bills save to this branch">
      <Building2 className={cn("h-3.5 w-3.5", hasActive ? "text-primary" : "text-destructive")} />
      <select
        value={current}
        onChange={e => {
          const v = e.target.value;
          setCurrentBranchId(v || null);
          setCurrent(v);
          window.dispatchEvent(new CustomEvent('pos-branch-changed', { detail: v || null }));
          toast.success(v ? 'Active branch changed' : 'Select an active branch');
        }}
        className="h-6 text-[11px] bg-transparent border-0 outline-none font-semibold cursor-pointer"
      >
        <option value="">⚠ Select Branch</option>
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  );
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <div className="hidden md:flex items-center gap-2 bg-muted/50 rounded-md px-2 py-1">
      <span className="text-[11px] font-mono font-bold text-foreground tabular-nums">{time}</span>
      <span className="text-[10px] text-muted-foreground">|</span>
      <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{date}</span>
    </div>
  );
}


export default function AppLayout({ children, userRole, onLogout }: Props) {
  const location = useLocation();
  const [, setSettingsTick] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pos-sidebar-collapsed') === '1');
  const [showLocationPrompt, setShowLocationPrompt] = useState(false);
  const [zoom, setZoom] = useState(() => {
    const saved = localStorage.getItem('desi-pos-zoom');
    return saved ? Number(saved) : 100;
  });

  useEffect(() => {
    document.documentElement.style.fontSize = `${zoom}%`;
    localStorage.setItem('desi-pos-zoom', String(zoom));
  }, [zoom]);

  useEffect(() => {
    localStorage.setItem('pos-sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => onDataChange((collection) => {
    if (collection === 'settings' || collection === '*') setSettingsTick(t => t + 1);
  }), []);

  // ============ Location permission flow ============
  // Only ask once per device unless settings re-enable. Master toggle in Settings → Location & Privacy.
  useEffect(() => {
    const settings = getSettings();
    if (settings.locationTrackingEnabled === false) return;
    if (settings.trackDeviceLocation === false) return;
    const decided = localStorage.getItem('pos-location-decided');
    if (decided) return;
    if (!('geolocation' in navigator)) return;
    // Check current permission state if supported
    const askIfNeeded = () => setShowLocationPrompt(true);
    if ((navigator as any).permissions?.query) {
      (navigator as any).permissions.query({ name: 'geolocation' })
        .then((res: any) => {
          if (res.state === 'granted') {
            localStorage.setItem('pos-location-decided', 'granted');
            captureDeviceLocation();
          } else if (res.state === 'denied') {
            localStorage.setItem('pos-location-decided', 'denied');
          } else {
            askIfNeeded();
          }
        })
        .catch(() => askIfNeeded());
    } else {
      askIfNeeded();
    }
  }, []);

  /**
   * v1.23.0 — push this device's position to whichever backend is active.
   *
   * This only ever wrote to Firestore, so on Supabase no device ever reported
   * a position and the Live Map was permanently empty. The map itself was
   * fine — Leaflet with OpenStreetMap tiles, already in place. It simply had
   * nothing to draw.
   */
  const captureDeviceLocation = async () => {
    if (!('geolocation' in navigator)) return;
    try {
      const { getTenantId, getDeviceId } = await import('@/lib/tenant');
      const { usingSupabaseAuth } = await import('@/lib/authProvider');

      navigator.geolocation.getCurrentPosition(
        async pos => {
          const tid = getTenantId(); if (!tid) return;
          const did = getDeviceId();
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          if (usingSupabaseAuth()) {
            try {
              const { sb } = await import('@/lib/supabase');
              // Match on hardware_id: the local device id is stable across
              // sessions, while the devices.id row is server-generated.
              const { error } = await sb().from('devices')
                .update({
                  lat, lng,
                  last_seen_at: new Date().toISOString(),
                  accuracy_m: Math.round(pos.coords.accuracy ?? 0),
                })
                .eq('tenant_id', tid)
                .eq('hardware_id', did);
              if (error) throw error;
            } catch (e) {
              console.warn('[location] supabase update failed', e);
            }
            return;
          }

          const { isFirebaseConfigured, fbDb } = await import('@/lib/firebase');
          const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
          if (!isFirebaseConfigured()) return;
          await setDoc(doc(fbDb(), 'tenants', tid, 'devices', did), {
            lat, lng,
            locationCapturedAt: serverTimestamp(),
            lastActiveMs: Date.now(),
          }, { merge: true });
        },
        err => { console.info('[location] not available:', err?.message); },
        { enableHighAccuracy: true, timeout: 15000 },
      );
    } catch (e) {
      console.warn('[location] capture failed', e);
    }
  };

  const handleLocationAllow = () => {
    setShowLocationPrompt(false);
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      () => {
        localStorage.setItem('pos-location-decided', 'granted');
        toast.success('Location enabled — restaurant and device are being tracked');
        captureDeviceLocation();
      },
      err => {
        localStorage.setItem('pos-location-decided', 'denied');
        toast.warning('Location denied — the system still works, but map features stay off');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleLocationSkip = () => {
    setShowLocationPrompt(false);
    localStorage.setItem('pos-location-decided', 'skipped');
    toast('Location skipped — you can enable it later from Settings → Location', { icon: '⏭️' });
  };

  // Device heartbeat — every 180s (online threshold is 5 min, so status stays
  // accurate). v1.2.4: was 60s = 1,440 writes/day/device; 3x reduction helps
  // stay inside the Firestore free-tier write quota ("limit exceeded" errors).
  useEffect(() => {
    let cancelled = false;
    const beat = async () => {
      try {
        const { isFirebaseConfigured, fbDb } = await import('@/lib/firebase');
        const { getTenantId, getDeviceId } = await import('@/lib/tenant');
        const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
        if (!isFirebaseConfigured()) return;
        const tid = getTenantId(); if (!tid) return;
        const did = getDeviceId();
        await setDoc(doc(fbDb(), 'tenants', tid, 'devices', did),
          { lastActiveAt: serverTimestamp(), lastActiveMs: Date.now() }, { merge: true });
      } catch {}
    };
    beat();
    const t = setInterval(() => { if (!cancelled) beat(); }, 180000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const currentTitle = PAGES.find(n => n.path === location.pathname)?.title || 'DT POS';
  const settings = getSettings();


  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar userRole={userRole} onLogout={onLogout} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} collapsed={collapsed} />

      {mobileOpen && (
        <div className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <UpdateAvailableBanner />
        {/* Top header */}
        <header className="dt-app-header h-12 flex items-center gap-3 px-4 shrink-0">
          <button className="lg:hidden text-foreground" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <button
            className="hidden lg:flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-smooth"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-5 w-1 rounded-full bg-gradient-gold" />
            <h1 className="text-sm font-bold text-foreground tracking-tight">
              {isPremiumThemeActive() ? PREMIUM_BRAND_NAME : (settings.name || 'DT POS')} <span className="text-muted-foreground font-medium">— {currentTitle}</span>
            </h1>
            <div className="ml-1 flex items-center gap-2">
              <HeaderNotificationBar />
              <SyncPendingChip />
              <BillingStatusBar />
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <BranchSelector />

            <HeaderClock />



            <div className="flex items-center gap-1 bg-muted/50 rounded-md px-1 py-0.5">
              <button onClick={() => setZoom(z => Math.max(70, z - 5))} className="p-1 rounded hover:bg-background transition-smooth" title="Zoom Out">
                <ZoomOut className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <span className="text-[10px] font-mono text-muted-foreground w-9 text-center">{zoom}%</span>
              <button onClick={() => setZoom(z => Math.min(130, z + 5))} className="p-1 rounded hover:bg-background transition-smooth" title="Zoom In">
                <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-muted-foreground border-l border-border pl-3">
              <SyncStatusBadge />
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto bg-background relative">
          {children}
          <PersistentWhatsApp />
          <NewOrderNotifier />
          <ServiceCallNotifier />
          <AutoKotPrinter />
          <AutoReadyTimer />
          <ReadyNotificationBus />
          {/* Beep + toast on ANY order going ready (incl. other devices / delivery prep) */}
          <ReadyOrderPoller types={['dine-in', 'takeaway', 'delivery']} />
          {/* Support chat widget — visible on Dashboard and Settings only */}
          {(location.pathname === '/dashboard' || location.pathname === '/settings') && <SupportChatWidget />}
        </main>
      </div>

      {/* Location permission modal — friendly explain before native prompt */}
      {showLocationPrompt && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border-2 border-primary/40 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg text-primary-foreground">
                <MapPin className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-extrabold">📍 Allow location</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                So the restaurant and this device can be located, letting the Super Admin see your branches on a map,
                aur live customer/rider tracking kaam kare.
              </p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3 text-[11px] space-y-1">
              <div className="flex items-center gap-2">✓ <span>Restaurant ki location</span></div>
              <div className="flex items-center gap-2">✓ <span>The device location (which branch it runs from)</span></div>
              <div className="flex items-center gap-2">✓ <span>Rider live tracking</span></div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleLocationSkip}
                className="flex-1 h-11 rounded-lg border-2 border-border text-xs font-bold hover:bg-muted transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleLocationAllow}
                className="flex-1 h-11 rounded-lg bg-gradient-to-r from-primary to-accent text-primary-foreground text-xs font-extrabold shadow-md hover:opacity-90"
              >
                ✓ Allow Location
              </button>
            </div>
            <p className="text-[10px] text-center text-muted-foreground">
              Settings → 🔒 Location & Privacy you can switch this on or off at any time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
