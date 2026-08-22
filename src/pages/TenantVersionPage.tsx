// ============================================================
// Restaurant Admin — My Version Info (v1.0.5)
// ============================================================
// Shows current/installed version, latest available, release notes,
// "Check for Updates" + "Update Now" + own update history.
// ============================================================
import { useEffect, useState } from 'react';
import { getInstalledVersion, APP_VERSION } from '@/lib/version';
import { subscribeLatestRelease, isUpdateAvailable, type SystemRelease } from '@/lib/releases';
import { subscribeTenantAudit, type VersionAuditEntry } from '@/lib/versionAudit';
import { getTenantId } from '@/lib/tenant';
import { RefreshCw, Download, CheckCircle2, AlertTriangle, History, Rocket, FileText } from 'lucide-react';

function tsMs(v: any): number {
  if (!v) return 0;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (v?.seconds) return v.seconds * 1000;
  return 0;
}
function fmt(ms: number) { return ms ? new Date(ms).toLocaleString() : '—'; }

export default function TenantVersionPage() {
  const [installed, setInstalled] = useState<string>(APP_VERSION);
  const [latest, setLatest] = useState<SystemRelease | null>(null);
  const [history, setHistory] = useState<VersionAuditEntry[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => { getInstalledVersion().then(setInstalled).catch(() => {}); }, []);
  useEffect(() => subscribeLatestRelease(setLatest), []);
  useEffect(() => {
    const tid = getTenantId();
    if (!tid) return;
    return subscribeTenantAudit(tid, setHistory);
  }, []);

  const updateAvail = latest ? isUpdateAvailable(installed, latest.version) : false;

  async function checkNow() {
    setChecking(true);
    try {
      const v = await getInstalledVersion();
      setInstalled(v);
    } finally { setTimeout(() => setChecking(false), 600); }
  }

  function updateNow() {
    if (!latest?.desktopUpdateUrl) {
      alert('The update file URL is not configured. Please contact the Super Admin.');
      return;
    }
    try {
      const api: any = (window as any).electronAPI;
      if (api?.openExternal) api.openExternal(latest.desktopUpdateUrl);
      else window.open(latest.desktopUpdateUrl, '_blank');
    } catch {
      window.open(latest.desktopUpdateUrl, '_blank');
    }
  }

  const lastEntry = history[0];

  return (
    <div className="p-4 space-y-4 max-w-[1100px] mx-auto">
      <div>
        <h1 className="text-2xl font-extrabold flex items-center gap-2">
          <Rocket className="h-6 w-6 text-primary" /> Software Version
        </h1>
        <p className="text-xs text-muted-foreground">Apni installed version aur naye updates yahan se check karein.</p>
      </div>

      {/* Version cards */}
      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs font-semibold text-muted-foreground">Current Version</div>
          <div className="text-3xl font-extrabold font-mono mt-1">v{installed}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs font-semibold text-muted-foreground">Latest Available</div>
          <div className="text-3xl font-extrabold font-mono mt-1">{latest ? `v${latest.version}` : '—'}</div>
        </div>
        <div className={`rounded-xl border p-4 ${updateAvail ? 'bg-amber-500/10 border-amber-500/40' : 'bg-emerald-500/10 border-emerald-500/40'}`}>
          <div className="text-xs font-semibold text-muted-foreground">Status</div>
          <div className="text-xl font-extrabold mt-1 flex items-center gap-2">
            {updateAvail
              ? <><AlertTriangle className="h-5 w-5 text-amber-600" /> Update Available</>
              : <><CheckCircle2 className="h-5 w-5 text-emerald-600" /> You're Up to Date</>}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="rounded-xl border bg-card p-3 flex items-center gap-2 flex-wrap">
        <button onClick={checkNow} disabled={checking}
                className="text-sm font-bold px-3 py-2 rounded-md border hover:bg-muted flex items-center gap-2 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} /> Check for Updates
        </button>
        <button onClick={updateNow} disabled={!updateAvail}
                className="text-sm font-bold px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50">
          <Download className="h-4 w-4" /> Update Now
        </button>
        <div className="text-xs text-muted-foreground ml-auto">
          Last Updated: <b>{lastEntry ? fmt(tsMs(lastEntry.at)) : '—'}</b>
          {lastEntry?.updatedBy && <> · By: <b>{lastEntry.updatedBy}</b></>}
        </div>
      </div>

      {/* Release notes */}
      {latest && (
        <div className="rounded-xl border bg-card p-4">
          <div className="text-sm font-bold flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4" /> Release Notes — v{latest.version}
            {latest.title && <span className="text-muted-foreground font-normal">· {latest.title}</span>}
          </div>
          <pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground">
            {latest.notes || 'No release notes provided.'}
          </pre>
        </div>
      )}

      {/* Audit history */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-3 py-2 text-sm font-bold border-b flex items-center gap-2">
          <History className="h-4 w-4" /> My Update History ({history.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr className="text-left">
                <th className="p-2">Date & Time</th>
                <th className="p-2">From</th>
                <th className="p-2">To</th>
                <th className="p-2">Device</th>
                <th className="p-2">Branch</th>
                <th className="p-2">Updated By</th>
                <th className="p-2">Status</th>
                <th className="p-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.map(a => (
                <tr key={a.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 whitespace-nowrap">{fmt(tsMs(a.at))}</td>
                  <td className="p-2 font-mono">{a.oldVersion ? `v${a.oldVersion}` : '—'}</td>
                  <td className="p-2 font-mono">v{a.newVersion}</td>
                  <td className="p-2">{a.deviceName || a.deviceId}</td>
                  <td className="p-2">{a.branchName || '—'}</td>
                  <td className="p-2">{a.updatedBy || '—'}</td>
                  <td className="p-2">
                    {a.status === 'success'
                      ? <span className="text-emerald-700 font-bold">✅ Success</span>
                      : <span className="text-red-700 font-bold">❌ Failed</span>}
                  </td>
                  <td className="p-2 text-muted-foreground">{a.reason || '—'}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No update events recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
