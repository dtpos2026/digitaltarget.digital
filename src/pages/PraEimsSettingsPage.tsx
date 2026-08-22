// ============================================================
// v1.9.0 — PRA EIMS Settings
//
// Every restaurant enters its OWN PRA credentials here. We are the
// software vendor; we hold no PRA account and nothing is shared between
// tenants. The POS ID is issued per branch/counter by PRA at
// e.pra.punjab.gov.pk → Registration → POS Client Registration.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { ShieldCheck, RefreshCw, Download, ExternalLink, AlertTriangle } from 'lucide-react';
import { getSettings, saveSettings } from '@/lib/store';
import {
  PRA_CONFIG_DEFAULT, praConfigReady, praVerifyUrl,
  type PraConfig, type PraEnvironment, type PraTransportMode,
} from '@/lib/praEims';
import { testPraConnection, praBrowserLimitation } from '@/lib/praTransport';
import {
  getPraQueue, getPraLogs, exportPraAudit, retryPraEntry, drainPraQueue,
  onPraQueueChange, clearPraLogs,
  type PraQueueEntry, type PraLogRecord,
} from '@/lib/praQueue';

export default function PraEimsSettingsPage() {
  const [settings, setSettings] = useState(() => getSettings());
  const [cfg, setCfg] = useState<PraConfig>(() => ({
    ...PRA_CONFIG_DEFAULT,
    ...((getSettings() as any).praConfig || {}),
  }));
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string; detail?: string } | null>(null);
  const [queue, setQueue] = useState<PraQueueEntry[]>([]);
  const [logs, setLogs] = useState<PraLogRecord[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const moduleOn = !!(settings as any).praEimsEnabled;
  const ready = praConfigReady(cfg);
  const limitation = useMemo(() => praBrowserLimitation(cfg), [cfg.transport]);

  const refresh = async () => {
    setQueue(await getPraQueue());
    if (showLogs) setLogs(await getPraLogs(60));
  };
  useEffect(() => { void refresh(); }, [showLogs]);
  useEffect(() => onPraQueueChange(() => { void refresh(); }), [showLogs]);

  const persist = (next: PraConfig) => {
    setCfg(next);
    const s = { ...getSettings(), praConfig: next } as any;
    saveSettings(s);
    setSettings(s);
  };

  const runTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const r = await testPraConnection(cfg);
      setStatus(r);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } finally {
      setTesting(false);
    }
  };

  const doExport = async () => {
    const json = await exportPraAudit();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `PRA-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('Audit file downloaded');
  };

  const counts = useMemo(() => ({
    pending: queue.filter(q => q.status === 'pending').length,
    sent: queue.filter(q => q.status === 'sent').length,
    failed: queue.filter(q => q.status === 'failed').length,
  }), [queue]);

  if (!moduleOn) {
    return (
      <div className="p-4 lg:p-6">
        <Card className="p-6 max-w-xl">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> PRA EIMS
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Ye module abhi OFF hai. Settings → Advanced → Features me
            <b> "🧾 PRA EIMS (Punjab Revenue Authority)"</b> ON karein.
            Sirf un restaurants ke liye jo PRA ke saath registered hain.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <ShieldCheck className="h-5 w-5" /> PRA EIMS — Electronic Invoice Monitoring
      </h2>

      {/* How it works — operators consistently misunderstand this */}
      <Card className="p-3 bg-muted/40 text-[11px] leading-relaxed">
        <b>Ye kaise kaam karta hai:</b> PRA ek <b>Software Fiscal Device</b> deta hai jo
        isi Windows computer par install hota hai. POS har bill us local device ko bhejta
        hai, device <b>Fiscal Invoice Number</b> wapas karta hai jo QR ke sath receipt par
        chhapta hai. Device khud periodically PRA ke servers par data bhejta hai — wo
        hamara kaam nahi. Pehle{' '}
        <a className="underline text-primary" href="https://e.pra.punjab.gov.pk" target="_blank" rel="noreferrer">
          e.pra.punjab.gov.pk <ExternalLink className="h-3 w-3 inline" />
        </a>{' '}
        par POS Client Registration kar ke <b>POS ID</b> lein, phir IMS Installer chalayein.
      </Card>

      {limitation && (
        <Card className="p-3 border-amber-400/60 bg-amber-50/60 text-[11px] flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{limitation}</span>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-bold">PRA Integration</Label>
            <p className="text-[11px] text-muted-foreground">
              OFF hone par koi invoice PRA ko nahi jati.
            </p>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => persist({ ...cfg, enabled: !!v })}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">POS ID (PRA Registration Number) *</Label>
            <Input
              value={cfg.posId}
              inputMode="numeric"
              placeholder="e.g. 100000"
              onChange={(e) => persist({ ...cfg, posId: e.target.value.replace(/\D/g, '') })}
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              PRA portal se milta hai — har branch/counter ka alag.
            </p>
          </div>
          <div>
            <Label className="text-xs">Seller PNTN (optional)</Label>
            <Input
              value={cfg.sellerPntn || ''}
              placeholder="1234567-8"
              onChange={(e) => persist({ ...cfg, sellerPntn: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Branch label (sirf hamare logs ke liye)</Label>
            <Input
              value={cfg.branchLabel || ''}
              placeholder="Main Branch"
              onChange={(e) => persist({ ...cfg, branchLabel: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Environment</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(['sandbox', 'production'] as PraEnvironment[]).map(env => (
                <button
                  key={env}
                  type="button"
                  onClick={() => persist({ ...cfg, environment: env })}
                  className={`h-9 rounded-lg border text-xs font-bold capitalize transition-colors ${
                    cfg.environment === env ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                  }`}
                >
                  {env}
                </button>
              ))}
            </div>
            {cfg.environment === 'production' && (
              <p className="text-[10px] text-amber-700 mt-0.5">
                ⚠️ Production me asli invoices PRA record par jati hain.
              </p>
            )}
          </div>
        </div>

        <div>
          <Label className="text-xs">Transport</Label>
          <div className="grid sm:grid-cols-2 gap-2 mt-1">
            {([
              { v: 'local' as PraTransportMode, t: 'Local Fiscal Device', d: 'localhost:8524 — PRA ka recommended tareeqa (Windows desktop)' },
              { v: 'cloud' as PraTransportMode, t: 'PRAL Cloud', d: 'ims.pral.com.pk — token required; for cloud POS' },
            ]).map(o => (
              <button
                key={o.v}
                type="button"
                onClick={() => persist({ ...cfg, transport: o.v })}
                className={`rounded-lg border p-2.5 text-left transition-colors ${
                  cfg.transport === o.v ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                }`}
              >
                <div className="text-xs font-bold">{o.t}</div>
                <div className="text-[10px] text-muted-foreground">{o.d}</div>
              </button>
            ))}
          </div>
        </div>

        {cfg.transport === 'cloud' && (
          <div>
            <Label className="text-xs">PRA Bearer Token *</Label>
            <Input
              type="password"
              value={cfg.cloudToken || ''}
              placeholder="Obtain this from PRA"
              onChange={(e) => persist({ ...cfg, cloudToken: e.target.value })}
            />
          </div>
        )}

        {cfg.transport === 'local' && (
          <div>
            <Label className="text-xs">Local device URL (optional override)</Label>
            <Input
              value={cfg.localBaseUrl || ''}
              placeholder="http://localhost:8524"
              onChange={(e) => persist({ ...cfg, localBaseUrl: e.target.value })}
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-xs">
          <Switch
            checked={cfg.printOnReceipt}
            onCheckedChange={(v) => persist({ ...cfg, printOnReceipt: !!v })}
          />
          Receipt par PRA Invoice Number + QR chhapein
        </label>

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={runTest} disabled={testing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${testing ? 'animate-spin' : ''}`} />
            Test Connection
          </Button>
          <span className={`text-xs font-bold ${ready.ok ? 'text-green-700' : 'text-amber-700'}`}>
            {ready.ok ? '✅ Config mukammal' : `⚠️ ${ready.reason}`}
          </span>
        </div>

        {status && (
          <div className={`rounded-md p-2 text-xs ${status.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            <div className="font-bold">{status.message}</div>
            {status.detail && <div className="mt-0.5 opacity-80 break-words">{status.detail}</div>}
          </div>
        )}
      </Card>

      {/* Submission status */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Submission Status</h3>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => drainPraQueue()}>
              Send Pending
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={doExport}>
              <Download className="h-3 w-3 mr-1" /> Export Audit
            </Button>
          </div>
        </div>
        <div className="flex gap-4 text-xs font-bold">
          <span className="text-amber-700">Pending {counts.pending}</span>
          <span className="text-green-700">Sent {counts.sent}</span>
          <span className="text-red-700">Failed {counts.failed}</span>
        </div>

        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No invoices in the queue.</p>
        ) : (
          <div className="max-h-72 overflow-auto space-y-1">
            {queue.slice().reverse().map(q => (
              <div key={q.id} className="flex items-center gap-2 text-[11px] border rounded px-2 py-1">
                <span className={`w-14 font-bold ${
                  q.status === 'sent' ? 'text-green-700'
                  : q.status === 'failed' ? 'text-red-700' : 'text-amber-700'
                }`}>{q.status}</span>
                <span className="font-mono">#{q.usin}</span>
                {q.praInvoiceNumber && (
                  <a
                    className="font-mono text-primary underline truncate"
                    href={praVerifyUrl(q.praInvoiceNumber)}
                    target="_blank" rel="noreferrer"
                  >{q.praInvoiceNumber}</a>
                )}
                {q.lastError && <span className="text-destructive truncate flex-1">{q.lastError}</span>}
                <span className="ml-auto opacity-60">try {q.attempts}</span>
                {q.status === 'failed' && (
                  <button
                    className="text-primary font-bold underline"
                    onClick={() => retryPraEntry(q.id)}
                  >Retry</button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Audit log */}
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">API Logs (requests &amp; responses)</h3>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowLogs(v => !v)}>
              {showLogs ? 'Hide' : 'Show'}
            </Button>
            <Button
              size="sm" variant="ghost" className="h-7 text-xs"
              onClick={async () => { await clearPraLogs(); setLogs([]); toast.success('Logs clear'); }}
            >Clear</Button>
          </div>
        </div>
        {showLogs && (
          logs.length === 0
            ? <p className="text-xs text-muted-foreground italic">Koi log nahi.</p>
            : (
              <div className="max-h-80 overflow-auto space-y-1">
                {logs.map(l => (
                  <details key={l.id} className="text-[10px] border rounded px-2 py-1">
                    <summary className="cursor-pointer font-mono">
                      {new Date(l.at).toLocaleString('en-GB')} · {l.direction}
                      {' · #'}{l.usin}
                      {l.ok === false && <span className="text-destructive font-bold"> · FAILED</span>}
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all opacity-80">
                      {JSON.stringify(l.data, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            )
        )}
      </Card>
    </div>
  );
}
