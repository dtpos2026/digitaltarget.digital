// ============================================================
// DIAGNOSTICS & MACHINE SETUP
//
// Two jobs that belong together because both are done on the phone to
// support, usually by somebody who is not technical and is having a bad day.
//
//   "Send us the diagnostics"  — one button, one file, everything needed.
//   "Save this machine's setup" — one file that rebuilds a till's calibration
//                                 on a replacement PC in a minute.
//
// The second one exists because every printer margin on a counter was found
// by a person standing at a printer with a ruler. Losing that to a dead hard
// disk is an evening the shop should not spend twice.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LifeBuoy, Download, Upload, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { recentFaults, reportFault, type Fault } from '@/lib/faultLog';
import {
  exportMachineSetup, importMachineSetup, setupFileName, SETUP_KEYS,
} from '@/lib/machineSetup';
import { readPrintLog } from '@/lib/printLog';
import { APP_VERSION } from '@/lib/version';
import { getSettings } from '@/lib/store';
import { isElectron } from '@/lib/electron';

function api(): any {
  return (window as any).electronAPI;
}

/** Hand the browser a file to save. Works the same in Electron. */
function saveJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function DiagnosticsCard() {
  const [faults, setFaults] = useState<Fault[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const shopName = (() => { try { return getSettings().name; } catch { return undefined; } })();

  const refresh = () => setFaults(recentFaults());
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  /**
   * Everything support needs, in one file.
   *
   * Deliberately includes the machine's SETUP as well as the logs: nine times
   * out of ten the answer is in a margin or a printer role, and asking the
   * shop for a second file is a second phone call.
   */
  const exportDiagnostics = async () => {
    setBusy(true);
    try {
      let appLog = '';
      let paths: unknown = null;
      if (isElectron()) {
        try {
          const r = await api()?.dbReadLog?.();
          appLog = r?.success ? String(r.data || '') : `(could not read: ${r?.error})`;
        } catch (e) { appLog = `(could not read: ${e})`; }
        try { paths = await api()?.getDataPaths?.(); } catch { /* not essential */ }
      }
      let printers: unknown = null;
      try {
        const { loadPrinterSettings } = await import('@/lib/printerSettings');
        printers = await loadPrinterSettings();
      } catch (e) { printers = `(could not read: ${e})`; }

      saveJson(`${(shopName || 'DT-POS').replace(/[^A-Za-z0-9]+/g, '-')}-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, {
        format: 'dtpos-diagnostics',
        version: 1,
        exportedAt: new Date().toISOString(),
        appVersion: APP_VERSION,
        platform: navigator.userAgent,
        screen: { width: window.screen?.width, height: window.screen?.height, dpr: window.devicePixelRatio },
        note,
        // The last log lines, not the whole file: a 2 MB log makes a file
        // nobody will send over a phone connection.
        appLogTail: appLog.split('\n').slice(-500).join('\n'),
        faults: recentFaults(),
        printLog: readPrintLog().slice(0, 200),
        printers,
        machineSetup: exportMachineSetup(note, APP_VERSION),
        paths,
      });
      toast.success('Diagnostics file saved. Send that one file to support.');
    } catch (e: any) {
      reportFault('diagnostics: export', e);
      toast.error(`Could not build the diagnostics file: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const exportSetup = () => {
    try {
      saveJson(setupFileName(shopName), exportMachineSetup(note, APP_VERSION));
      toast.success('Machine setup saved. Keep it with the shop’s records.');
    } catch (e: any) {
      reportFault('setup: export', e);
      toast.error(`Could not save the setup: ${e?.message || e}`);
    }
  };

  const importSetup = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importMachineSetup(String(reader.result || ''));
      if (!res.ok) {
        toast.error(res.error || 'That file could not be applied.');
        return;
      }
      toast.success(
        `${res.applied.length} setting(s) restored.`
        + (res.skipped.length ? ` ${res.skipped.length} unknown setting(s) were left alone.` : '')
        + ' Print an alignment slip to confirm on paper.',
      );
    };
    reader.onerror = () => toast.error('That file could not be read.');
    reader.readAsText(file);
  };

  return (
    <Card className="p-4 md:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <LifeBuoy className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-lg font-semibold">Diagnostics &amp; Machine Setup</h3>
          <p className="text-xs text-muted-foreground mt-1">
            One file for support when something goes wrong, and one that
            rebuilds this till&rsquo;s calibration on a replacement computer.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Note (optional)</Label>
        <Input
          placeholder="e.g. Counter 1 — FIT FP-1100 — right margin too wide since Tuesday"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Written into both files. What you were doing when it went wrong is
          usually the most useful line in the whole report.
        </p>
      </div>

      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Recent faults on this machine</Label>
          <div className="flex items-center gap-2">
            {faults.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="h-3 w-3 mr-1" />{faults.length}
              </Badge>
            )}
            <Button size="sm" variant="ghost" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {faults.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing has gone wrong since this machine was started.
          </p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-auto">
            {faults.slice(0, 20).map((f, i) => (
              <div key={i} className="text-[11px] font-mono leading-snug rounded bg-muted/50 px-2 py-1">
                <span className={f.level === 'ERROR' ? 'text-destructive' : 'text-status-warning'}>
                  {f.level}
                </span>{' '}
                <b>{f.where}</b> — {f.detail}
                <span className="text-muted-foreground"> · {new Date(f.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={exportDiagnostics} disabled={busy}>
          <Download className="h-4 w-4 mr-1" /> Save diagnostics for support
        </Button>
        <Button variant="outline" onClick={exportSetup}>
          <Download className="h-4 w-4 mr-1" /> Save this machine&rsquo;s setup
        </Button>
        <label>
          <input
            type="file" accept="application/json,.json" className="hidden"
            onChange={e => { importSetup(e.target.files?.[0] || null); e.currentTarget.value = ''; }}
          />
          <Button variant="outline" asChild>
            <span><Upload className="h-4 w-4 mr-1" /> Restore a setup file</span>
          </Button>
        </label>
      </div>

      <div className="rounded-md bg-muted/40 p-3">
        <p className="text-xs font-medium mb-1.5">The setup file carries</p>
        <ul className="text-[11px] text-muted-foreground space-y-0.5">
          {SETUP_KEYS.map(k => <li key={k.key}>· {k.what}</li>)}
        </ul>
        <p className="text-[11px] text-muted-foreground mt-2">
          It does <b>not</b> carry sales, orders, customers, staff or licence
          keys. This is the machine&rsquo;s setup, not the shop&rsquo;s data —
          those have their own backup, and mixing them would make a settings
          file something you could not safely hand to anybody.
        </p>
      </div>
    </Card>
  );
}
