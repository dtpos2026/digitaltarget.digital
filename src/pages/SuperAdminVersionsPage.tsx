import { firestoreUnavailable } from '@/lib/legacyFirebaseGuard';
// ============================================================
// Super Admin — Version Management & Update Tracking (v1.0.5)
// ============================================================
// Single dashboard showing:
//  - Summary KPIs (total / updated / pending / failed / latest / oldest)
//  - Per-restaurant rows with current vs latest version and status badge
//  - Full audit history (who, when, where, success/fail + reason)
//  - Filters: version, restaurant, branch, status, date, updatedBy
//  - Bulk-push: send "Update Available" notification to selected tenants
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { collection, collectionGroup, onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { fbDb, isFirebaseConfigured } from '@/lib/firebase';
import { subscribeLatestRelease, compareVersions, type SystemRelease } from '@/lib/releases';
import { subscribeGlobalAudit, getUpdateStatus, type VersionAuditEntry, type UpdateStatus } from '@/lib/versionAudit';
import { Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Bell, Filter, Download, History, Rocket } from 'lucide-react';

interface Tenant { id: string; restaurantName?: string; ownerName?: string; }
interface Device {
  tenantId: string; deviceId: string;
  deviceName?: string;
  branchId?: string; branchName?: string;
  appVersion?: string; currentVersion?: string;
  updateStatus?: UpdateStatus;
  lastVersionSyncAt?: any;
  lastUpdatedBy?: string;
  approved?: boolean;
}

function tsMs(v: any): number {
  if (!v) return 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (v?.seconds) return v.seconds * 1000;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  return 0;
}
function fmtDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function statusBadge(s: UpdateStatus) {
  const map: Record<UpdateStatus, { label: string; cls: string; icon: any }> = {
    updated:   { label: '✅ Updated',          cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40', icon: CheckCircle2 },
    available: { label: '⚠ Update Available',  cls: 'bg-amber-500/15 text-amber-700 border-amber-500/40',     icon: AlertTriangle },
    updating:  { label: '🔄 Updating',          cls: 'bg-sky-500/15 text-sky-700 border-sky-500/40',           icon: RefreshCw },
    failed:    { label: '❌ Update Failed',     cls: 'bg-red-500/15 text-red-700 border-red-500/40',           icon: XCircle },
  };
  const m = map[s] || map.updated;
  return <span className={`text-[11px] font-bold px-2 py-1 rounded-md border ${m.cls}`}>{m.label}</span>;
}

export default function SuperAdminVersionsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [audit, setAudit] = useState<VersionAuditEntry[]>([]);
  const [latest, setLatest] = useState<SystemRelease | null>(null);

  // Filters
  const [fVersion, setFVersion] = useState('');
  const [fRestaurant, setFRestaurant] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fStatus, setFStatus] = useState<'' | UpdateStatus>('');
  const [fUser, setFUser] = useState('');
  const [fFromDate, setFFromDate] = useState('');
  const [fToDate, setFToDate] = useState('');
  const [selectedTenants, setSelectedTenants] = useState<Set<string>>(new Set());

  useEffect(() => {
    // v1.19.7 — a Firestore subscription on a Supabase session never
    // fires and never errors, so the loading state below would hang
    // forever. Settle immediately with an empty view instead.
    if (firestoreUnavailable()) return;
    if (!isFirebaseConfigured()) return;
    const u1 = onSnapshot(collection(fbDb(), 'restaurants'),
      s => setTenants(s.docs.map(d => ({ id: d.id, ...(d.data() as any) }))), () => {});
    const u2 = onSnapshot(collectionGroup(fbDb(), 'devices'), s => {
      setDevices(s.docs.map(d => {
        const data = d.data() as any;
        return { tenantId: d.ref.parent.parent?.id || '', deviceId: d.id, ...data };
      }));
    }, () => {});
    const u3 = subscribeGlobalAudit(setAudit);
    const u4 = subscribeLatestRelease(setLatest);
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const latestVersion = latest?.version || '';
  const tenantById = useMemo(() => Object.fromEntries(tenants.map(t => [t.id, t])), [tenants]);

  // Per-tenant rollup
  interface Row {
    tenantId: string;
    restaurantName: string;
    currentVersion: string; // min installed version across tenant's approved devices
    latestVersion: string;
    status: UpdateStatus;
    lastUpdatedAt: number;
    lastUpdatedBy: string;
    deviceName: string;
    branchName: string;
    deviceCount: number;
  }
  const rows: Row[] = useMemo(() => {
    return tenants.map(t => {
      const myDevs = devices.filter(d => d.tenantId === t.id && d.approved !== false);
      // Latest stamped device wins for "Updated By / Device"
      const lastDev = [...myDevs].sort((a, b) => tsMs(b.lastVersionSyncAt) - tsMs(a.lastVersionSyncAt))[0];
      // Tenant "current" = MIN installed version (so update needed if ANY device behind)
      const versions = myDevs.map(d => d.currentVersion || d.appVersion || '').filter(Boolean);
      versions.sort((a, b) => compareVersions(a, b));
      const cur = versions[0] || '';
      const status: UpdateStatus = lastDev?.updateStatus === 'failed' ? 'failed'
                                  : lastDev?.updateStatus === 'updating' ? 'updating'
                                  : getUpdateStatus(cur, latestVersion);
      return {
        tenantId: t.id,
        restaurantName: t.restaurantName || t.ownerName || t.id,
        currentVersion: cur || '—',
        latestVersion: latestVersion || '—',
        status,
        lastUpdatedAt: tsMs(lastDev?.lastVersionSyncAt),
        lastUpdatedBy: lastDev?.lastUpdatedBy || '—',
        deviceName: lastDev?.deviceName || '—',
        branchName: lastDev?.branchName || (lastDev?.branchId ? lastDev.branchId : '—'),
        deviceCount: myDevs.length,
      };
    });
  }, [tenants, devices, latestVersion]);

  // KPIs
  const kpis = useMemo(() => {
    const updated = rows.filter(r => r.status === 'updated').length;
    const pending = rows.filter(r => r.status === 'available' || r.status === 'updating').length;
    const failed  = rows.filter(r => r.status === 'failed').length;
    const allCurVers = rows.map(r => r.currentVersion).filter(v => v && v !== '—');
    allCurVers.sort((a, b) => compareVersions(a, b));
    return {
      total: rows.length,
      updated, pending, failed,
      latest: latestVersion || '—',
      oldest: allCurVers[0] || '—',
    };
  }, [rows, latestVersion]);

  // Filtered rows
  const filteredRows = rows.filter(r => {
    if (fVersion && !r.currentVersion.includes(fVersion)) return false;
    if (fRestaurant && !r.restaurantName.toLowerCase().includes(fRestaurant.toLowerCase())) return false;
    if (fBranch && !(r.branchName || '').toLowerCase().includes(fBranch.toLowerCase())) return false;
    if (fStatus && r.status !== fStatus) return false;
    if (fUser && !(r.lastUpdatedBy || '').toLowerCase().includes(fUser.toLowerCase())) return false;
    if (fFromDate) {
      const fromMs = new Date(fFromDate).getTime();
      if (r.lastUpdatedAt && r.lastUpdatedAt < fromMs) return false;
    }
    if (fToDate) {
      const toMs = new Date(fToDate).getTime() + 24 * 3600 * 1000;
      if (r.lastUpdatedAt && r.lastUpdatedAt > toMs) return false;
    }
    return true;
  });

  // Filtered audit
  const filteredAudit = audit.filter(a => {
    const rn = a.restaurantName || tenantById[a.tenantId]?.restaurantName || '';
    if (fRestaurant && !rn.toLowerCase().includes(fRestaurant.toLowerCase())) return false;
    if (fBranch && !(a.branchName || '').toLowerCase().includes(fBranch.toLowerCase())) return false;
    if (fUser && !(a.updatedBy || '').toLowerCase().includes(fUser.toLowerCase())) return false;
    if (fVersion && !`${a.newVersion} ${a.oldVersion || ''}`.includes(fVersion)) return false;
    if (fStatus === 'failed' && a.status !== 'failed') return false;
    const t = tsMs(a.at);
    if (fFromDate && t && t < new Date(fFromDate).getTime()) return false;
    if (fToDate && t && t > new Date(fToDate).getTime() + 24 * 3600 * 1000) return false;
    return true;
  });

  const toggleSel = (id: string) => {
    setSelectedTenants(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const selectAllPending = () => {
    setSelectedTenants(new Set(filteredRows.filter(r => r.status === 'available' || r.status === 'failed').map(r => r.tenantId)));
  };

  async function pushNotification() {
    if (!latest) { alert('No released version is available. Publish one from Release Manager first.'); return; }
    if (selectedTenants.size === 0) { alert('Select restaurants.'); return; }
    const msg = `New version v${latest.version} available. Kindly update from Settings → Updates.`;
    try {
      for (const tid of selectedTenants) {
        await setDoc(doc(fbDb(), 'tenants', tid, 'notifications', `update-${latest.version}`), {
          type: 'update-available',
          version: latest.version,
          title: `New Update Available (v${latest.version})`,
          message: msg,
          createdAt: serverTimestamp(),
          read: false,
        }, { merge: true });
      }
      alert(`✅ Notification sent to ${selectedTenants.size} restaurant(s).`);
      setSelectedTenants(new Set());
    } catch (e: any) {
      alert(`Failed: ${e?.message || e}`);
    }
  }

  function exportAuditCsv() {
    const header = ['Date', 'Restaurant', 'Branch', 'Device', 'User', 'Old Version', 'New Version', 'Status', 'Reason'];
    const lines = filteredAudit.map(a => [
      fmtDate(tsMs(a.at)),
      a.restaurantName || tenantById[a.tenantId]?.restaurantName || a.tenantId,
      a.branchName || '',
      a.deviceName || a.deviceId,
      a.updatedBy || '',
      a.oldVersion || '',
      a.newVersion || '',
      a.status,
      a.reason || '',
    ].map(c => `"${String(c).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `version-audit-${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Rocket className="h-6 w-6 text-primary" /> Version Management & Update Tracking
          </h1>
          <p className="text-xs text-muted-foreground">
            Har restaurant aur device ka current version, update status aur full audit history — ek dashboard pe.
          </p>
        </div>
        <a href="#/super-portfolio" className="text-xs font-bold px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70">
          ← Back to Portfolio
        </a>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<Activity className="h-4 w-4" />} label="Total Restaurants" value={kpis.total} cls="text-primary" />
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Updated" value={kpis.updated} cls="text-emerald-600" />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Pending" value={kpis.pending} cls="text-amber-600" />
        <Kpi icon={<XCircle className="h-4 w-4" />} label="Failed" value={kpis.failed} cls="text-red-600" />
        <Kpi icon={<Rocket className="h-4 w-4" />} label="Latest Version" value={`v${kpis.latest}`} cls="text-violet-600" />
        <Kpi icon={<History className="h-4 w-4" />} label="Oldest Active" value={`v${kpis.oldest}`} cls="text-slate-600" />
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card p-3">
        <div className="flex items-center gap-2 mb-2 text-sm font-bold">
          <Filter className="h-4 w-4" /> Filters
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <input className="px-2 py-1.5 rounded-md border bg-background text-sm" placeholder="Version"
                 value={fVersion} onChange={e => setFVersion(e.target.value)} />
          <input className="px-2 py-1.5 rounded-md border bg-background text-sm" placeholder="Restaurant"
                 value={fRestaurant} onChange={e => setFRestaurant(e.target.value)} />
          <input className="px-2 py-1.5 rounded-md border bg-background text-sm" placeholder="Branch"
                 value={fBranch} onChange={e => setFBranch(e.target.value)} />
          <select className="px-2 py-1.5 rounded-md border bg-background text-sm" value={fStatus}
                  onChange={e => setFStatus(e.target.value as any)}>
            <option value="">Any Status</option>
            <option value="updated">✅ Updated</option>
            <option value="available">⚠ Update Available</option>
            <option value="updating">🔄 Updating</option>
            <option value="failed">❌ Failed</option>
          </select>
          <input className="px-2 py-1.5 rounded-md border bg-background text-sm" placeholder="Updated By"
                 value={fUser} onChange={e => setFUser(e.target.value)} />
          <input type="date" className="px-2 py-1.5 rounded-md border bg-background text-sm"
                 value={fFromDate} onChange={e => setFFromDate(e.target.value)} />
          <input type="date" className="px-2 py-1.5 rounded-md border bg-background text-sm"
                 value={fToDate} onChange={e => setFToDate(e.target.value)} />
        </div>
      </div>

      {/* Bulk push */}
      <div className="rounded-xl border bg-card p-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          Selected: <b>{selectedTenants.size}</b> restaurant(s)
        </div>
        <div className="flex items-center gap-2">
          <button onClick={selectAllPending}
                  className="text-xs font-bold px-3 py-1.5 rounded-md border hover:bg-muted">
            Select all pending/failed
          </button>
          <button onClick={pushNotification}
                  className="text-xs font-bold px-3 py-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1">
            <Bell className="h-3 w-3" /> Push "Update Available"
          </button>
        </div>
      </div>

      {/* Restaurant table */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-3 py-2 text-sm font-bold border-b">
          Restaurants ({filteredRows.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2"><input type="checkbox"
                    checked={filteredRows.length > 0 && filteredRows.every(r => selectedTenants.has(r.tenantId))}
                    onChange={e => {
                      if (e.target.checked) setSelectedTenants(new Set(filteredRows.map(r => r.tenantId)));
                      else setSelectedTenants(new Set());
                    }} /></th>
                <th className="p-2">Restaurant</th>
                <th className="p-2">Current</th>
                <th className="p-2">Latest</th>
                <th className="p-2">Status</th>
                <th className="p-2">Last Updated</th>
                <th className="p-2">Updated By</th>
                <th className="p-2">Device</th>
                <th className="p-2">Branch</th>
                <th className="p-2">Devices</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => (
                <tr key={r.tenantId} className="border-t hover:bg-muted/40">
                  <td className="p-2"><input type="checkbox" checked={selectedTenants.has(r.tenantId)}
                                            onChange={() => toggleSel(r.tenantId)} /></td>
                  <td className="p-2 font-semibold">{r.restaurantName}</td>
                  <td className="p-2 font-mono">v{r.currentVersion}</td>
                  <td className="p-2 font-mono">v{r.latestVersion}</td>
                  <td className="p-2">{statusBadge(r.status)}</td>
                  <td className="p-2">{fmtDate(r.lastUpdatedAt)}</td>
                  <td className="p-2">{r.lastUpdatedBy}</td>
                  <td className="p-2">{r.deviceName}</td>
                  <td className="p-2">{r.branchName}</td>
                  <td className="p-2 text-center">{r.deviceCount}</td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No restaurants match filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit history */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-3 py-2 text-sm font-bold border-b flex items-center justify-between">
          <span className="flex items-center gap-2"><History className="h-4 w-4" /> Update History ({filteredAudit.length})</span>
          <button onClick={exportAuditCsv} className="text-xs font-bold px-2 py-1 rounded-md border hover:bg-muted flex items-center gap-1">
            <Download className="h-3 w-3" /> Export CSV
          </button>
        </div>
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr className="text-left">
                <th className="p-2">Date & Time</th>
                <th className="p-2">Restaurant</th>
                <th className="p-2">Branch</th>
                <th className="p-2">Device</th>
                <th className="p-2">User</th>
                <th className="p-2">Old</th>
                <th className="p-2">New</th>
                <th className="p-2">Status</th>
                <th className="p-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredAudit.map(a => (
                <tr key={a.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 whitespace-nowrap">{fmtDate(tsMs(a.at))}</td>
                  <td className="p-2">{a.restaurantName || tenantById[a.tenantId]?.restaurantName || a.tenantId}</td>
                  <td className="p-2">{a.branchName || '—'}</td>
                  <td className="p-2">{a.deviceName || a.deviceId}</td>
                  <td className="p-2">{a.updatedBy || '—'}</td>
                  <td className="p-2 font-mono">{a.oldVersion ? `v${a.oldVersion}` : '—'}</td>
                  <td className="p-2 font-mono">v{a.newVersion}</td>
                  <td className="p-2">
                    {a.status === 'success'
                      ? <span className="text-emerald-700 font-bold">✅ Success</span>
                      : <span className="text-red-700 font-bold">❌ Failed</span>}
                  </td>
                  <td className="p-2 text-muted-foreground">{a.reason || '—'}</td>
                </tr>
              ))}
              {filteredAudit.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No history yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, cls }: { icon: any; label: string; value: any; cls?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className={`text-xs font-semibold flex items-center gap-1 ${cls || ''}`}>{icon}{label}</div>
      <div className="text-2xl font-extrabold mt-1">{value}</div>
    </div>
  );
}
