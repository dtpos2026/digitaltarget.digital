import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, BarChart3, Smartphone, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fbDb, isFirebaseConfigured } from '@/lib/firebase';
import { collection, collectionGroup, getDocs } from 'firebase/firestore';
import { APP_VERSION } from '@/lib/version';
import { compareVersions } from '@/lib/releases';

import { firestoreUnavailable } from '@/lib/legacyFirebaseGuard';
interface DeviceVersionRow {
  tenantId: string;
  tenantName?: string;
  appVersion?: string;
  deviceName?: string;
  lastActiveAt?: any;
  approved?: boolean;
}

/**
 * Super Admin only — reads ALL tenants' devices via a collectionGroup query
 * and shows how many devices are on each app version. Helps verify rollout.
 */
export default function VersionDistributionPanel({ latestVersion }: { latestVersion?: string }) {
  const [rows, setRows] = useState<DeviceVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    if (firestoreUnavailable()) return;   // v1.21.0 — not ported to Supabase yet (version distribution)
    if (!isFirebaseConfigured()) return;
    setLoading(true); setErr(null);
    try {
      // Build tenant-name map
      const nameMap = new Map<string, string>();
      try {
        const ui = await getDocs(collection(fbDb(), 'userIndex'));
        ui.forEach(d => {
          const x: any = d.data();
          if (x?.restaurantName || x?.email) nameMap.set(d.id, x.restaurantName || x.email);
        });
      } catch {}

      const snap = await getDocs(collectionGroup(fbDb(), 'devices'));
      const list: DeviceVersionRow[] = [];
      snap.forEach(d => {
        const x: any = d.data();
        // path: tenants/{tid}/devices/{deviceId}
        const tid = d.ref.parent.parent?.id || '';
        list.push({
          tenantId: tid,
          tenantName: nameMap.get(tid) || tid.slice(0, 8),
          appVersion: x.appVersion,
          deviceName: x.deviceName,
          lastActiveAt: x.lastActiveAt,
          approved: !!x.approved,
        });
      });
      setRows(list);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const target = latestVersion || APP_VERSION;

  const stats = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => {
      const v = r.appVersion || 'unknown';
      m.set(v, (m.get(v) || 0) + 1);
    });
    const arr = Array.from(m.entries()).map(([version, count]) => ({ version, count }));
    arr.sort((a, b) => {
      if (a.version === 'unknown') return 1;
      if (b.version === 'unknown') return -1;
      return compareVersions(b.version, a.version);
    });
    return arr;
  }, [rows]);

  const total = rows.length;
  const upToDate = rows.filter(r => r.appVersion && compareVersions(r.appVersion, target) >= 0).length;
  const outdated = rows.filter(r => r.appVersion && compareVersions(r.appVersion, target) < 0).length;
  const unknown = rows.filter(r => !r.appVersion).length;
  const pct = total ? Math.round((upToDate / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" /> Version Rollout
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Target: <span className="font-mono font-bold">v{target}</span> · {total} device(s) across all tenants
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {err && (
        <div className="text-[11px] bg-red-500/10 text-red-700 rounded-md p-2 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>{err}<div className="text-[10px] opacity-70 mt-0.5">collectionGroup('devices') requires Super Admin Firestore rule.</div></div>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="p-6 flex items-center justify-center text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading device versions…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <StatBox label="Up to date" value={upToDate} color="text-green-600" />
            <StatBox label="Outdated" value={outdated} color="text-amber-600" />
            <StatBox label="Unknown" value={unknown} color="text-muted-foreground" />
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] uppercase font-bold text-muted-foreground">Adoption: {pct}%</div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {stats.length === 0 && (
              <div className="text-[11px] text-muted-foreground italic text-center py-3">No device data yet.</div>
            )}
            {stats.map(s => {
              const isLatest = s.version !== 'unknown' && compareVersions(s.version, target) >= 0;
              const barPct = total ? (s.count / total) * 100 : 0;
              return (
                <div key={s.version} className="flex items-center gap-2 text-xs">
                  <div className="w-20 font-mono font-bold shrink-0">
                    {s.version === 'unknown' ? <span className="text-muted-foreground">unknown</span> : `v${s.version}`}
                  </div>
                  <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
                    <div
                      className={`h-full ${isLatest ? 'bg-green-500/70' : s.version === 'unknown' ? 'bg-gray-400/50' : 'bg-amber-500/70'}`}
                      style={{ width: `${barPct}%` }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-[10px] font-bold">
                      <Smartphone className="h-3 w-3 mr-1" /> {s.count} ({Math.round(barPct)}%)
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2">
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
