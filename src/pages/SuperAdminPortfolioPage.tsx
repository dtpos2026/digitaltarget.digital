import { firestoreUnavailable } from '@/lib/legacyFirebaseGuard';
// ============================================================
// Super Admin Portfolio Dashboard (v1.0.4)
// Global business view across ALL restaurants for the Super Admin.
// - Top KPI strip
// - Per-restaurant card grid (today/month sale, devices, plan, expiry)
// - Charts: daily sales, top restaurants
// - Date+Time presets (Today / Yesterday / Week / Month / Custom)
// All sales aggregated via the Business Day engine.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import {
  collection, collectionGroup, getDocs, onSnapshot, query, where, orderBy, limit,
} from 'firebase/firestore';
import { fbDb, isFirebaseConfigured } from '@/lib/firebase';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line } from 'recharts';
import { Store, Users, Wifi, Banknote, ShoppingBag, Activity, Calendar, AlertTriangle, Building2 } from 'lucide-react';
import DateTimeRangeFilter, { type DateTimeRange } from '@/components/DateTimeRangeFilter';
import { getCurrentBusinessDay, getBusinessDayRange } from '@/lib/businessDay';
import { isOnline, tsToMs } from '@/lib/geo';
import { daysUntil, isExpired } from '@/lib/billing';

interface TenantRow {
  id: string;
  restaurantName?: string;
  ownerName?: string;
  email?: string;
  approved?: boolean;
  plan?: string;
  planExpiryAt?: any;
}
interface DeviceRow {
  tenantId: string; deviceId: string;
  approved?: boolean; blocked?: boolean;
  lastActiveAt?: any; appVersion?: string; restaurantName?: string;
}
interface OrderRow {
  tenantId: string;
  grandTotal?: number;
  paidAt?: string; createdAt?: string;
  status?: string;
  branchId?: string;
  customerName?: string;
}

function tsToISO(v: any): string | undefined {
  if (!v) return;
  if (typeof v === 'string') return v;
  if (typeof v?.toMillis === 'function') return new Date(v.toMillis()).toISOString();
  if (v?.seconds) return new Date(v.seconds * 1000).toISOString();
  return;
}

export default function SuperAdminPortfolioPage() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateTimeRange>(() => {
    const w = getCurrentBusinessDay();
    return { startMs: w.startMs, endMs: w.endMs, preset: 'today' };
  });

  // Real-time tenants
  useEffect(() => {
    // v1.19.7 — a Firestore subscription on a Supabase session never
    // fires and never errors, so the loading state below would hang
    // forever. Settle immediately with an empty view instead.
    if (firestoreUnavailable()) { setLoading?.(false); return; }
    if (!isFirebaseConfigured()) return;
    const unsub = onSnapshot(collection(fbDb(), 'restaurants'), (snap) => {
      setTenants(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    }, () => {});
    return () => unsub();
  }, []);

  // Real-time devices (collection group)
  useEffect(() => {
    // v1.19.7 — a Firestore subscription on a Supabase session never
    // fires and never errors, so the loading state below would hang
    // forever. Settle immediately with an empty view instead.
    if (firestoreUnavailable()) { setLoading?.(false); return; }
    if (!isFirebaseConfigured()) return;
    const unsub = onSnapshot(collectionGroup(fbDb(), 'devices'), (snap) => {
      setDevices(snap.docs.map((d) => {
        const data = d.data() as any;
        const tenantId = d.ref.parent.parent?.id || '';
        return { tenantId, deviceId: d.id, ...data };
      }));
    }, () => {});
    return () => unsub();
  }, []);

  // Orders — pull once per range change (collectionGroup orders by paidAt window)
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    setLoading(true);
    const startIso = new Date(range.startMs).toISOString();
    const endIso = new Date(range.endMs).toISOString();
    (async () => {
      try {
        const monthBack = getBusinessDayRange(30);
        const fromIso = new Date(Math.min(monthBack.startMs, range.startMs)).toISOString();
        const q = query(
          collectionGroup(fbDb(), 'orders'),
          where('paidAt', '>=', fromIso),
          orderBy('paidAt', 'desc'),
          limit(5000),
        );
        const snap = await getDocs(q);
        const rows: OrderRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const tenantId = d.ref.parent.parent?.id || '';
          return { tenantId, ...data };
        });
        setOrders(rows);
      } catch (e) {
        console.warn('[Portfolio] orders fetch failed', e);
        setOrders([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [range.startMs, range.endMs]);

  const approvedTenants = useMemo(() => tenants.filter((t) => t.approved !== false), [tenants]);
  const approvedDevices = useMemo(() => devices.filter((d) => d.approved !== false && !d.blocked), [devices]);
  const onlineDevices = useMemo(() => approvedDevices.filter((d) => isOnline(tsToMs(d.lastActiveAt))), [approvedDevices]);

  const inRange = (iso?: string) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= range.startMs && t < range.endMs;
  };
  const monthBack = getBusinessDayRange(30);
  const inMonth = (iso?: string) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= monthBack.startMs && t < monthBack.endMs;
  };

  const paidInRange = orders.filter((o) => inRange(o.paidAt || o.createdAt) && o.status !== 'void' && o.status !== 'cancelled');
  const paidInMonth = orders.filter((o) => inMonth(o.paidAt || o.createdAt) && o.status !== 'void' && o.status !== 'cancelled');

  const totalSales = paidInRange.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const totalOrders = paidInRange.length;
  const monthRevenue = paidInMonth.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const activeSubs = approvedTenants.filter((t) => !isExpired(t.planExpiryAt)).length;
  const expiredSubs = approvedTenants.filter((t) => isExpired(t.planExpiryAt)).length;
  const totalBranches = new Set(orders.map((o) => `${o.tenantId}:${o.branchId || 'main'}`)).size || approvedTenants.length;

  // Per-restaurant aggregates
  const perTenant = useMemo(() => {
    return approvedTenants.map((t) => {
      const tOrdersDay = paidInRange.filter((o) => o.tenantId === t.id);
      const tOrdersMonth = paidInMonth.filter((o) => o.tenantId === t.id);
      const tDevices = approvedDevices.filter((d) => d.tenantId === t.id);
      const tOnline = onlineDevices.filter((d) => d.tenantId === t.id).length;
      const branchCount = new Set(orders.filter((o) => o.tenantId === t.id).map((o) => o.branchId || 'main')).size || 1;
      return {
        id: t.id,
        name: t.restaurantName || t.email || t.id.slice(0, 8),
        owner: t.ownerName || t.email || '—',
        branches: branchCount,
        devicesOnline: tOnline,
        devicesTotal: tDevices.length,
        todaySale: tOrdersDay.reduce((s, o) => s + (o.grandTotal || 0), 0),
        monthSale: tOrdersMonth.reduce((s, o) => s + (o.grandTotal || 0), 0),
        ordersToday: tOrdersDay.length,
        plan: t.plan || 'free',
        expiryDays: daysUntil(t.planExpiryAt),
        expired: isExpired(t.planExpiryAt),
      };
    }).sort((a, b) => b.todaySale - a.todaySale);
  }, [approvedTenants, approvedDevices, onlineDevices, orders, paidInRange, paidInMonth]);

  // Charts
  const dailySales = useMemo(() => {
    const days = 14;
    const out: { d: string; sales: number; orders: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const w = getBusinessDayRange(i + 1);
      const dayStart = w.endMs - 1; // rough; reuse window per offset
      // Simpler: per i, use single-day window via offset
      const ref = new Date(Date.now() - i * 86400000);
      const dayLabel = ref.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
      const dayOrders = orders.filter((o) => {
        const t = new Date(o.paidAt || o.createdAt || 0).getTime();
        const dStart = new Date(ref); dStart.setHours(0, 0, 0, 0);
        const dEnd = new Date(dStart); dEnd.setDate(dEnd.getDate() + 1);
        return t >= dStart.getTime() && t < dEnd.getTime() && o.status !== 'void';
      });
      out.push({
        d: dayLabel,
        sales: dayOrders.reduce((s, o) => s + (o.grandTotal || 0), 0),
        orders: dayOrders.length,
      });
    }
    return out;
  }, [orders]);

  const topRestaurants = perTenant.slice(0, 8).map((t) => ({ name: t.name, sales: t.monthSale }));

  return (
    <div className="container max-w-7xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" /> Portfolio Dashboard
          </h1>
          <p className="text-xs text-muted-foreground">Global view across all restaurants. Sales follow the Business Day engine.</p>
        </div>
        <DateTimeRangeFilter value={range} onChange={setRange} />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <Kpi icon={<Store className="h-4 w-4" />} label="Restaurants" value={approvedTenants.length} tone="primary" />
        <Kpi icon={<Building2 className="h-4 w-4" />} label="Branches" value={totalBranches} tone="primary" />
        <Kpi icon={<Wifi className="h-4 w-4" />} label="Online Devices" value={onlineDevices.length} sub={`of ${approvedDevices.length}`} tone="green" />
        <Kpi icon={<Banknote className="h-4 w-4" />} label="Today's Sale" value={`Rs ${totalSales.toLocaleString()}`} tone="gold" />
        <Kpi icon={<Activity className="h-4 w-4" />} label="Month Revenue" value={`Rs ${monthRevenue.toLocaleString()}`} tone="gold" />
        <Kpi icon={<ShoppingBag className="h-4 w-4" />} label="Orders" value={totalOrders} tone="primary" />
        <Kpi icon={<Users className="h-4 w-4" />} label="Active Subs" value={activeSubs} tone="green" />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Expired" value={expiredSubs} tone="red" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Daily Sales (last 14 days)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dailySales}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="d" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Top Restaurants (this month)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topRestaurants} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
              <Tooltip />
              <Bar dataKey="sales" fill="hsl(var(--gold))" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Per-restaurant grid */}
      <div className="space-y-2">
        <h2 className="text-sm font-extrabold flex items-center gap-2">
          <Store className="h-4 w-4" /> Restaurants ({perTenant.length})
        </h2>
        {loading && perTenant.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-6">Loading…</div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {perTenant.map((t) => (
            <div key={t.id} className="rounded-xl border bg-card p-3 space-y-2 hover:shadow-md transition">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-extrabold text-sm truncate">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{t.owner}</div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${t.expired ? 'bg-red-500/15 text-red-700' : 'bg-green-500/15 text-green-700'}`}>
                    {t.plan.toUpperCase()}
                  </span>
                  {t.expiryDays != null && (
                    <span className={`text-[9px] ${t.expired ? 'text-red-700' : t.expiryDays <= 7 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                      {t.expired ? 'Expired' : `${t.expiryDays}d left`}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px]">
                <Stat label="Branches" value={t.branches} />
                <Stat label="Online" value={`${t.devicesOnline}/${t.devicesTotal}`} tone={t.devicesOnline > 0 ? 'green' : 'muted'} />
                <Stat label="Today" value={`Rs ${t.todaySale.toLocaleString()}`} tone="gold" />
                <Stat label="Month" value={`Rs ${t.monthSale.toLocaleString()}`} tone="primary" />
                <Stat label="Orders" value={t.ordersToday} />
              </div>
            </div>
          ))}
        </div>
        {!loading && perTenant.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-6">No restaurants yet.</div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: any; label: string; value: any; sub?: string; tone: 'primary' | 'gold' | 'green' | 'red' }) {
  const color = tone === 'gold' ? 'text-gold' : tone === 'green' ? 'text-green-600' : tone === 'red' ? 'text-red-600' : 'text-primary';
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-1">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
          <div className={`text-lg font-extrabold ${color}`}>{value}</div>
          {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
        </div>
        <div className={color}>{icon}</div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: any }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: 'gold' | 'primary' | 'green' | 'muted' }) {
  const color = tone === 'gold' ? 'text-gold' : tone === 'green' ? 'text-green-600' : tone === 'muted' ? 'text-muted-foreground' : 'text-primary';
  return (
    <div className="bg-muted/30 rounded px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xs font-extrabold ${color}`}>{value}</div>
    </div>
  );
}
