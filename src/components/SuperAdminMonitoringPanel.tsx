import { useMemo } from 'react';
import { Activity, Wifi, WifiOff, Smartphone, Store, AlertTriangle, Calendar, TrendingUp, Clock, Sparkles } from 'lucide-react';
import { isOnline, tsToMs } from '@/lib/geo';
import { daysUntil, isExpired, tsToDate } from '@/lib/billing';
import { APP_VERSION } from '@/lib/version';
import { compareVersions } from '@/lib/releases';

interface DeviceRow {
  tenantId: string; deviceId: string; approved?: boolean; blocked?: boolean;
  lastActiveAt?: any; loginAt?: any; appVersion?: string; deviceName?: string;
  restaurantName?: string; city?: string; country?: string;
}
interface RestaurantRow {
  id: string; restaurantName?: string; email?: string; approved: boolean;
  plan?: string; planExpiryAt?: any; lastPaymentAt?: any;
}

interface Props {
  devices: DeviceRow[];
  restaurants: RestaurantRow[];
}

/**
 * Phase B — Item #10 — Centralized monitoring panel for Super Admin.
 * Aggregates live device status, version adoption, plan distribution, and billing alerts.
 */
export default function SuperAdminMonitoringPanel({ devices, restaurants }: Props) {
  const approved = useMemo(() => restaurants.filter(r => r.approved), [restaurants]);
  const approvedDevices = useMemo(() => devices.filter(d => d.approved && !d.blocked), [devices]);

  const onlineDevices = useMemo(
    () => approvedDevices.filter(d => isOnline(tsToMs(d.lastActiveAt))),
    [approvedDevices]
  );

  // Tenants with at least one online device = active tenant
  const activeTenantIds = useMemo(() => new Set(onlineDevices.map(d => d.tenantId)), [onlineDevices]);

  // Today logins
  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }, []);
  const todayLogins = devices.filter(d => tsToMs(d.loginAt) >= todayStart).length;

  // Version distribution
  const versionStats = useMemo(() => {
    const m = new Map<string, number>();
    approvedDevices.forEach(d => {
      const v = d.appVersion || 'unknown';
      m.set(v, (m.get(v) || 0) + 1);
    });
    const arr = Array.from(m.entries()).map(([version, count]) => ({ version, count }));
    arr.sort((a, b) => {
      if (a.version === 'unknown') return 1;
      if (b.version === 'unknown') return -1;
      return compareVersions(b.version, a.version);
    });
    return arr;
  }, [approvedDevices]);

  const upToDate = approvedDevices.filter(d => d.appVersion && compareVersions(d.appVersion, APP_VERSION) >= 0).length;
  const adoptionPct = approvedDevices.length ? Math.round((upToDate / approvedDevices.length) * 100) : 0;

  // Plan distribution
  const planStats = useMemo(() => {
    const m = new Map<string, number>();
    approved.forEach(r => {
      const p = r.plan || 'free';
      m.set(p, (m.get(p) || 0) + 1);
    });
    return Array.from(m.entries()).map(([plan, count]) => ({ plan, count }));
  }, [approved]);

  // Billing alerts
  const expiringSoon = useMemo(() => {
    return approved.filter(r => {
      const d = daysUntil(r.planExpiryAt);
      return d !== null && d >= 0 && d <= 7;
    });
  }, [approved]);
  const expired = useMemo(() => approved.filter(r => isExpired(r.planExpiryAt)), [approved]);

  // Recently-active tenants (last 24h)
  const recentActiveTenants = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const map = new Map<string, { name: string; lastMs: number; deviceCount: number }>();
    approvedDevices.forEach(d => {
      const ms = tsToMs(d.lastActiveAt);
      if (ms < cutoff) return;
      const cur = map.get(d.tenantId);
      if (!cur || ms > cur.lastMs) {
        map.set(d.tenantId, {
          name: d.restaurantName || restaurants.find(r => r.id === d.tenantId)?.restaurantName || d.tenantId.slice(0, 8),
          lastMs: ms,
          deviceCount: (cur?.deviceCount || 0) + 1,
        });
      } else if (cur) {
        cur.deviceCount += 1;
      }
    });
    return Array.from(map.values()).sort((a, b) => b.lastMs - a.lastMs).slice(0, 12);
  }, [approvedDevices, restaurants]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-extrabold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> System Monitor
          </h2>
          <p className="text-xs text-muted-foreground">
            Live snapshot of all restaurants, devices and rollout status.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href="#/super-portfolio"
            className="text-xs font-bold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            🏢 Portfolio Dashboard →
          </a>
          <a
            href="#/super-versions"
            className="text-xs font-bold px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700"
          >
            🚀 Version Tracker →
          </a>
          <a
            href="#/super-ai"
            className="text-xs font-bold px-3 py-1.5 rounded-md bg-fuchsia-600 text-white hover:bg-fuchsia-700"
          >
            ✨ AI Assistant &amp; Inbox →
          </a>
          <div className="text-[10px] text-muted-foreground">
            Updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* ===== KPI strip ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi icon={<Store className="h-4 w-4" />} label="Restaurants" value={approved.length} color="text-primary" />
        <Kpi icon={<Wifi className="h-4 w-4" />} label="Active Now" value={activeTenantIds.size} color="text-green-600" />
        <Kpi icon={<Smartphone className="h-4 w-4" />} label="Online Devices" value={onlineDevices.length} sub={`of ${approvedDevices.length}`} color="text-green-600" />
        <Kpi icon={<WifiOff className="h-4 w-4" />} label="Offline Devices" value={approvedDevices.length - onlineDevices.length} color="text-muted-foreground" />
        <Kpi icon={<Calendar className="h-4 w-4" />} label="Today Logins" value={todayLogins} color="text-amber-600" />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label={`v${APP_VERSION} Adoption`} value={`${adoptionPct}%`} color="text-violet-600" />
      </div>

      {/* ===== Alerts ===== */}
      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" /> Billing Alerts
          </div>
          {expired.length > 0 && (
            <div className="text-xs">
              <span className="font-bold text-red-700">{expired.length} expired:</span>{' '}
              <span className="text-muted-foreground">
                {expired.slice(0, 5).map(r => r.restaurantName || r.email).filter(Boolean).join(', ')}
                {expired.length > 5 && ` +${expired.length - 5} more`}
              </span>
            </div>
          )}
          {expiringSoon.length > 0 && (
            <div className="text-xs">
              <span className="font-bold text-amber-700">{expiringSoon.length} expiring in 7 days:</span>{' '}
              <span className="text-muted-foreground">
                {expiringSoon.slice(0, 5).map(r => r.restaurantName || r.email).filter(Boolean).join(', ')}
                {expiringSoon.length > 5 && ` +${expiringSoon.length - 5} more`}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Version distribution */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-extrabold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" /> Version Distribution
          </h3>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {versionStats.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-3 text-center">No device data.</div>
            ) : versionStats.map(s => {
              const isLatest = s.version !== 'unknown' && compareVersions(s.version, APP_VERSION) >= 0;
              const total = approvedDevices.length || 1;
              const pct = (s.count / total) * 100;
              return (
                <div key={s.version} className="flex items-center gap-2 text-xs">
                  <div className="w-20 font-mono font-bold shrink-0">
                    {s.version === 'unknown' ? <span className="text-muted-foreground">unknown</span> : `v${s.version}`}
                  </div>
                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
                    <div
                      className={`h-full ${isLatest ? 'bg-green-500/70' : s.version === 'unknown' ? 'bg-gray-400/50' : 'bg-amber-500/70'}`}
                      style={{ width: `${pct}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-[10px] font-bold">
                      {s.count} ({Math.round(pct)}%)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Plan distribution */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-extrabold flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" /> Plan Distribution
          </h3>
          <div className="space-y-1.5">
            {planStats.length === 0 ? (
              <div className="text-xs text-muted-foreground italic py-3 text-center">No plan data.</div>
            ) : planStats.map(p => {
              const total = approved.length || 1;
              const pct = (p.count / total) * 100;
              return (
                <div key={p.plan} className="flex items-center gap-2 text-xs">
                  <div className="w-24 font-bold capitalize shrink-0">{p.plan}</div>
                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
                    <div className="h-full bg-primary/60" style={{ width: `${pct}%` }} />
                    <div className="absolute inset-0 flex items-center px-2 text-[10px] font-bold">
                      {p.count} ({Math.round(pct)}%)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recently active */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-extrabold flex items-center gap-2">
          <Clock className="h-4 w-4 text-green-600" /> Recently Active (last 24h)
        </h3>
        {recentActiveTenants.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-3 text-center">No active tenants in last 24h.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {recentActiveTenants.map(t => (
              <div key={t.name} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/30 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">{t.name}</div>
                  <div className="text-[10px] text-muted-foreground">{timeAgo(t.lastMs)}</div>
                </div>
                <div className="text-[10px] bg-green-500/15 text-green-700 px-2 py-0.5 rounded-full font-bold whitespace-nowrap">
                  {t.deviceCount} dev
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, color }: { icon: any; label: string; value: any; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
          <div className={`text-xl font-extrabold ${color}`}>{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
        </div>
        <div className={color}>{icon}</div>
      </div>
    </div>
  );
}

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return Math.floor(diff/86400000) + 'd ago';
}
