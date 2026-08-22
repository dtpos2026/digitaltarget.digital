import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Download, Wrench, RotateCcw, Database, History, CheckCircle2, AlertTriangle, CloudUpload } from 'lucide-react';
import {
  runManualBackup, listUpdateHistory, listUpdateBackups,
  getLastBackupAt, getSyncHealth, getLastInspectAt,
  fetchBackupJson,
  type UpdateHistoryEntry,
} from '@/lib/updateSafety';
import { inspectDatabase, repairDatabase, type InspectionResult } from '@/lib/syncRepair';
import { getInstalledVersion } from '@/lib/version';
import { toast } from 'sonner';

function ago(ts?: number | null) {
  if (!ts) return 'Never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function UpdateSafetyPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<UpdateHistoryEntry[]>([]);
  const [backups, setBackups] = useState<Array<{ id: string; bytes: number; createdAtMs: number; kind?: string }>>([]);
  const [inspectResult, setInspectResult] = useState<InspectionResult | null>(null);
  const [version, setVersion] = useState('1.0.9');
  const [, force] = useState(0);

  async function refresh() {
    const [h, b, v] = await Promise.all([
      listUpdateHistory(20),
      listUpdateBackups(10),
      getInstalledVersion(),
    ]);
    setHistory(h); setBackups(b); setVersion(v);
  }

  useEffect(() => { refresh(); }, []);

  async function doBackup(downloadLocal: boolean) {
    setBusy('backup');
    try {
      const res = await runManualBackup({ downloadLocally: downloadLocal });
      if (res.ok) toast.success(`Backup saved (${Math.round(res.bytes / 1024)}KB)${res.cloud ? ' to cloud' : ''}${res.local ? ' locally' : ''}`);
      else toast.error('Backup failed');
      await refresh();
      force(x => x + 1);
    } finally { setBusy(null); }
  }

  function doInspect() {
    setBusy('inspect');
    try {
      const r = inspectDatabase();
      setInspectResult(r);
      toast.success(`Inspection complete — ${r.issues.length} issue(s) found`);
      force(x => x + 1);
    } finally { setBusy(null); }
  }

  function doRepair() {
    if (!confirm('Repair will remove duplicate rows and assign IDs to corrupt entries. Continue?')) return;
    setBusy('repair');
    try {
      const r = repairDatabase();
      setInspectResult(r);
      toast.success(`Repaired ${r.repaired.reduce((s, x) => s + x.count, 0)} record(s)`);
      force(x => x + 1);
    } finally { setBusy(null); }
  }

  async function doDownload(id: string) {
    setBusy('download');
    try {
      const json = await fetchBackupJson(id);
      if (!json) { toast.error('Backup not found'); return; }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `dtpos-backup-${id}.json`;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    } finally { setBusy(null); }
  }

  const lastBackup = getLastBackupAt();
  const lastInspect = getLastInspectAt();
  const health = getSyncHealth();

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-green-600" />
          Update Safety — Zero Data Loss
        </h1>
        <p className="text-sm text-muted-foreground">
          Backup, inspect, and repair your data. Every update creates an automatic snapshot.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Current Version</div>
          <div className="text-xl font-bold">v{version}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Last Backup</div>
          <div className="text-xl font-semibold">{ago(lastBackup)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Last Inspection</div>
          <div className="text-xl font-semibold">{ago(lastInspect)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Sync Health</div>
          <Badge variant={health === 'healthy' ? 'default' : health === 'warning' ? 'secondary' : health === 'error' ? 'destructive' : 'outline'}
            className={health === 'healthy' ? 'bg-green-600' : ''}>
            {health}
          </Badge>
        </Card>
      </div>

      {/* Actions */}
      <Card className="p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Database className="h-4 w-4" /> Backup &amp; Recovery
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => doBackup(false)} disabled={busy !== null}>
            <CloudUpload className="h-4 w-4 mr-2" />
            Backup to Cloud Now
          </Button>
          <Button variant="outline" onClick={() => doBackup(true)} disabled={busy !== null}>
            <Download className="h-4 w-4 mr-2" />
            Download Local Copy
          </Button>
          <Button variant="outline" onClick={doInspect} disabled={busy !== null}>
            <ShieldCheck className="h-4 w-4 mr-2" />
            Inspect Database
          </Button>
          <Button variant="secondary" onClick={doRepair} disabled={busy !== null}>
            <Wrench className="h-4 w-4 mr-2" />
            Repair Issues
          </Button>
        </div>
        {inspectResult && (
          <div className="border-t pt-3 mt-2 text-sm space-y-2">
            <div className="flex items-center gap-2">
              {inspectResult.health === 'healthy' ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              <span>
                Scanned <strong>{inspectResult.totalRecords}</strong> records in{' '}
                {inspectResult.durationMs}ms — Status:{' '}
                <Badge variant={inspectResult.health === 'healthy' ? 'default' : 'destructive'}
                  className={inspectResult.health === 'healthy' ? 'bg-green-600' : ''}>
                  {inspectResult.health}
                </Badge>
              </span>
            </div>
            {inspectResult.issues.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Issues found:</div>
                <ul className="text-xs space-y-0.5">
                  {inspectResult.issues.map((i, idx) => (
                    <li key={idx}>
                      • <code>{i.collection}</code>: {i.count} {i.type}
                      {i.detail ? ` (${i.detail})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {inspectResult.repaired.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Repaired:</div>
                <ul className="text-xs space-y-0.5">
                  {inspectResult.repaired.map((i, idx) => (
                    <li key={idx}>
                      ✓ <code>{i.collection}</code>: {i.count} {i.type}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Backups list */}
      <Card className="p-4">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Database className="h-4 w-4" /> Available Cloud Backups
        </h2>
        {backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No backups yet. Click "Backup to Cloud Now" above.</p>
        ) : (
          <div className="space-y-2">
            {backups.map(b => (
              <div key={b.id} className="flex items-center justify-between border rounded p-2 text-sm">
                <div>
                  <div className="font-mono text-xs">{b.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {ago(b.createdAtMs)} • {Math.round(b.bytes / 1024)}KB
                    {b.kind ? ` • ${b.kind}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => doDownload(b.id)} disabled={busy !== null}>
                  <Download className="h-3 w-3 mr-1" /> Download
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* History */}
      <Card className="p-4">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <History className="h-4 w-4" /> Update History (This Restaurant)
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No updates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left p-2">When</th>
                  <th className="text-left p-2">From → To</th>
                  <th className="text-left p-2">Backup</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b">
                    <td className="p-2 text-xs">{new Date(h.startedAtMs).toLocaleString()}</td>
                    <td className="p-2"><code className="text-xs">v{h.fromVersion} → v{h.toVersion}</code></td>
                    <td className="p-2 text-xs">
                      {h.cloudBackup ? `${Math.round((h.backupBytes || 0) / 1024)}KB ✓` : '—'}
                    </td>
                    <td className="p-2">
                      {h.success ? (
                        <Badge className="bg-green-600">Success</Badge>
                      ) : (
                        <Badge variant="destructive">Failed</Badge>
                      )}
                      {h.rollback && <Badge variant="secondary" className="ml-1">Rolled back</Badge>}
                    </td>
                    <td className="p-2 text-xs">{h.updatedBy || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
