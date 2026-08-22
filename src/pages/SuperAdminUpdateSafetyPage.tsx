import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Activity, Database, History, Download, RotateCcw, Wrench, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { fbDb, isFirebaseConfigured } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, limit, collectionGroup } from 'firebase/firestore';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/hash-router';

import { firestoreUnavailable } from '@/lib/legacyFirebaseGuard';
interface Row {
  tenantId: string;
  restaurantName?: string;
  branchName?: string;
  deviceId: string;
  deviceName?: string;
  os?: string;
  installedVersion?: string;
  latestVersion?: string;
  lastSeenAt?: number;
  lastUpdateAt?: number;
  lastBackupAt?: number;
  syncHealth?: string;
  lastLoginAt?: number;
}

interface HistoryEntry {
  id: string;
  tenantId: string;
  deviceId: string;
  deviceName?: string;
  fromVersion: string;
  toVersion: string;
  startedAtMs: number;
  durationMs: number;
  success: boolean;
  rollback?: boolean;
  backupBytes?: number;
  cloudBackup?: boolean;
  updatedBy?: string;
  errorMessage?: string;
}

function fmt(ts?: number) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
}

function ago(ts?: number) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function SuperAdminUpdateSafetyPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (firestoreUnavailable()) return;   // v1.21.0 — not ported to Supabase yet (update safety)
    if (!isFirebaseConfigured()) { setLoading(false); return; }
    setLoading(true);
    try {
      // Pull device docs from versionAudit
      const devSnap = await getDocs(query(collectionGroup(fbDb(), 'deviceVersions'), limit(500)));
      const list: Row[] = devSnap.docs.map(d => {
        const v: any = d.data();
        return {
          tenantId: v.tenantId || d.ref.parent.parent?.id || '',
          restaurantName: v.restaurantName,
          branchName: v.branchName,
          deviceId: v.deviceId || d.id,
          deviceName: v.deviceName,
          os: v.os || v.platform,
          installedVersion: v.installedVersion || v.appVersion,
          latestVersion: v.latestVersion,
          lastSeenAt: v.updatedAtMs || v.lastSeenAt,
          lastUpdateAt: v.lastUpdateAt,
          lastBackupAt: v.lastBackupAt,
          syncHealth: v.syncHealth || 'unknown',
          lastLoginAt: v.lastLoginAt,
        };
      });
      setRows(list);

      // Pull recent update history across tenants
      const histSnap = await getDocs(query(collectionGroup(fbDb(), 'updateHistory'), orderBy('startedAtMs', 'desc'), limit(100)));
      setHistory(histSnap.docs.map(d => d.data() as HistoryEntry));
    } catch (e: any) {
      console.error('[updateSafety load]', e);
      toast.error('Load failed: ' + (e?.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const totalDevices = rows.length;
  const healthy = rows.filter(r => (r.syncHealth || 'unknown') === 'healthy').length;
  const warnings = rows.filter(r => r.syncHealth === 'warning').length;
  const errors = rows.filter(r => r.syncHealth === 'error').length;
  const recentBackups = rows.filter(r => r.lastBackupAt && Date.now() - r.lastBackupAt < 7 * 86400_000).length;
  const successRate = history.length === 0 ? 100 : Math.round(
    (history.filter(h => h.success).length / history.length) * 100
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-green-600" />
            Zero Data Loss — Update Safety Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Fleet-wide backup &amp; update health across all restaurants
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/super')}>← Back</Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Devices</div>
          <div className="text-2xl font-bold">{totalDevices}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Healthy</div>
          <div className="text-2xl font-bold text-green-600">{healthy}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Warnings</div>
          <div className="text-2xl font-bold text-amber-600">{warnings}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Errors</div>
          <div className="text-2xl font-bold text-red-600">{errors}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Update Success</div>
          <div className="text-2xl font-bold">{successRate}%</div>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Backups (Last 7d)</div>
          <div className="text-xl font-semibold">{recentBackups} devices</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Updates Logged</div>
          <div className="text-xl font-semibold">{history.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Failed Updates</div>
          <div className="text-xl font-semibold text-red-600">
            {history.filter(h => !h.success).length}
          </div>
        </Card>
      </div>

      {/* Fleet device table */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4" /> Live Device Fleet
          </h2>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left p-2">Restaurant / Branch</th>
                <th className="text-left p-2">Device</th>
                <th className="text-left p-2">OS</th>
                <th className="text-left p-2">Version</th>
                <th className="text-left p-2">Health</th>
                <th className="text-left p-2">Last Backup</th>
                <th className="text-left p-2">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No devices yet.</td></tr>
              )}
              {rows.map(r => {
                const h = r.syncHealth || 'unknown';
                const tone = h === 'healthy' ? 'default' : h === 'warning' ? 'secondary' : h === 'error' ? 'destructive' : 'outline';
                return (
                  <tr key={`${r.tenantId}_${r.deviceId}`} className="border-b hover:bg-muted/30">
                    <td className="p-2">
                      <div className="font-medium">{r.restaurantName || r.tenantId}</div>
                      <div className="text-xs text-muted-foreground">{r.branchName || '—'}</div>
                    </td>
                    <td className="p-2">{r.deviceName || r.deviceId.slice(0, 8)}</td>
                    <td className="p-2">{r.os || '—'}</td>
                    <td className="p-2">
                      <Badge variant="outline">v{r.installedVersion || '—'}</Badge>
                    </td>
                    <td className="p-2">
                      <Badge variant={tone as any}>{h}</Badge>
                    </td>
                    <td className="p-2 text-xs">{ago(r.lastBackupAt)}</td>
                    <td className="p-2 text-xs">{ago(r.lastSeenAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Update history */}
      <Card className="p-4">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <History className="h-4 w-4" /> Update History (Fleet-wide)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left p-2">When</th>
                <th className="text-left p-2">Device</th>
                <th className="text-left p-2">From → To</th>
                <th className="text-left p-2">Duration</th>
                <th className="text-left p-2">Backup</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">By</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No updates logged yet.</td></tr>
              )}
              {history.map(h => (
                <tr key={h.id} className="border-b hover:bg-muted/30">
                  <td className="p-2 text-xs">{fmt(h.startedAtMs)}</td>
                  <td className="p-2 text-xs">{h.deviceName || h.deviceId.slice(0, 8)}</td>
                  <td className="p-2">
                    <code className="text-xs">v{h.fromVersion} → v{h.toVersion}</code>
                  </td>
                  <td className="p-2 text-xs">{Math.round((h.durationMs || 0) / 100) / 10}s</td>
                  <td className="p-2">
                    {h.cloudBackup ? (
                      <Badge variant="default" className="text-xs">
                        <Database className="h-3 w-3 mr-1" />
                        {Math.round((h.backupBytes || 0) / 1024)}KB
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">none</Badge>
                    )}
                  </td>
                  <td className="p-2">
                    {h.rollback ? (
                      <Badge variant="secondary"><RotateCcw className="h-3 w-3 mr-1" />Rolled back</Badge>
                    ) : h.success ? (
                      <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Success</Badge>
                    ) : (
                      <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />Failed</Badge>
                    )}
                  </td>
                  <td className="p-2 text-xs">{h.updatedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
