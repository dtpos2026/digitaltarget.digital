// ============================================================
// Printer Health & Print Preview settings.
//
// Client issue: printer kisi doosri jagah/port par connect karne ke baad
// receipt blank aati thi (red light) — jabke "Test Print" theek nikalta tha.
// Wajah: Windows ka printer naam badal jata hai ("(Copy 1)", "USB002" wagera)
// aur settings me purana naam save reh jata hai, is liye job ghalat/ghayab
// printer ko jata hai.
//
// Yeh card:
//   • har configured printer ka live connect status dikhata hai
//   • ek click par Windows ka asal naam dobara detect kar ke save karta hai
//   • Print Preview ON/OFF aur auto-retry count set karta hai
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RefreshCw, Printer, Wifi, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { getPrinters } from '@/lib/electron';
import { matchPrinter } from '@/printing/printerMatch';
import {
  loadPrinterSettings, savePrinterSettings, type PrinterConfig, type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import {
  isPrintPreviewEnabled, setPrintPreviewEnabled, getPrintRetryCount, setPrintRetryCount,
} from '@/lib/printPreferences';

interface Row {
  cfg: PrinterConfig;
  ok: boolean;
  realName: string;
  stage: string;
}

export default function PrinterHealthCard() {
  const [settings, setSettings] = useState<PrinterSettingsDoc | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(isPrintPreviewEnabled());
  const [retry, setRetry] = useState(getPrintRetryCount());

  const scan = useCallback(async () => {
    setBusy(true);
    try {
      const pset = await loadPrinterSettings();
      setSettings(pset);
      const system = await getPrinters().catch(() => []);
      const next: Row[] = pset.printers.map((cfg) => {
        if (cfg.connection === 'lan') {
          return { cfg, ok: !!cfg.lanHost, realName: `${cfg.lanHost || '—'}:${cfg.lanPort || 9100}`, stage: 'lan' };
        }
        const m = matchPrinter(cfg.printerName, system as any);
        return { cfg, ok: !!m.printer, realName: m.name, stage: m.stage };
      });
      setRows(next);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const repairNames = async () => {
    if (!settings) return;
    const fixes = rows.filter(r => r.ok && r.realName && r.cfg.connection !== 'lan' && r.realName !== r.cfg.printerName);
    if (fixes.length === 0) { toast.info('All printer names are already correct'); return; }
    const updated: PrinterSettingsDoc = {
      ...settings,
      printers: settings.printers.map((p) => {
        const f = fixes.find(x => x.cfg.id === p.id);
        return f ? { ...p, printerName: f.realName } : p;
      }),
    };
    await savePrinterSettings(updated);
    toast.success(`${fixes.length} printer name(s) updated to match Windows`);
    scan();
  };

  const broken = rows.filter(r => !r.ok).length;

  return (
    <Card className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Printer Health & Preview</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            After reconnecting a printer, check its status here. If Windows gave it a new name, “Fix printer
            names” sets it right (the most common cause of a blank receipt).
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={scan} disabled={busy}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            Re-detect
          </Button>
          <Button size="sm" variant="secondary" onClick={repairNames} disabled={busy || rows.length === 0}>
            <Wrench className="mr-1.5 h-3.5 w-3.5" />
            Fix printer names
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          No printer is set up yet — add one under “Printers” below.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.cfg.id} className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {r.cfg.connection === 'lan'
                    ? <Wifi className="h-4 w-4 text-muted-foreground" />
                    : <Printer className="h-4 w-4 text-muted-foreground" />}
                  <span className="truncate text-sm font-semibold">{r.cfg.name}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">{r.cfg.role}</Badge>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {r.cfg.connection === 'lan' ? r.realName : (r.cfg.printerName || '— koi Windows printer select nahi —')}
                  {r.ok && r.realName && r.realName !== r.cfg.printerName && r.cfg.connection !== 'lan'
                    ? ` → ${r.realName}` : ''}
                </p>
              </div>
              {r.ok
                ? <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" />Connected</span>
                : <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-destructive"><XCircle className="h-4 w-4" />Not found</span>}
            </div>
          ))}
          {broken > 0 && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {broken} printer(s) not found in Windows. Check the USB cable and power, then press “Re-detect”
              and “Fix printer names” — otherwise bills print blank or not at all.
            </p>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-lg bg-muted/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Print Preview before printing</p>
            <p className="text-xs text-muted-foreground">
              ON = the paid bill shows on screen first and prints when you press Print. OFF = fast silent print (recommended).
            </p>
          </div>
          <Switch
            checked={preview}
            onCheckedChange={(v) => { setPreview(v); setPrintPreviewEnabled(v); toast.success(v ? 'Preview ON' : 'Silent print ON'); }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div>
            <p className="text-sm font-semibold">Auto retry on print failure</p>
            <p className="text-xs text-muted-foreground">How many times a job is retried when the printer is busy or has just reconnected.</p>
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map(n => (
              <Button key={n} size="sm" variant={retry === n ? 'default' : 'outline'}
                      onClick={() => { setRetry(n); setPrintRetryCount(n); }}>
                {n}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
