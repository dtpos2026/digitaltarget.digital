// ============================================================
// Printer Settings Panel
// Manage restaurant-level printer configurations (cloud-synced)
// and toggle THIS device as the silent "Print Server" (EXE only).
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Printer, Plus, Trash2, Save, RefreshCw, Server, TestTube } from 'lucide-react';
import { toast } from 'sonner';
import {
  loadPrinterSettings,
  savePrinterSettings,
  defaultPrinterConfig,
  isPrintServerEnabled,
  setPrintServerEnabled,
  type PrinterConfig,
  type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import { getPrinters, isElectron, printReceiptNative } from '@/lib/electron';
import { MAX_TOP_MARGIN_MM, clampTopMarginMm } from '@/lib/thermal-print';
import { getPrintDiags, clearPrintDiags, summarisePrintDiag, type PrintDiagEntry } from '@/lib/printDiagnostics';
import { getPageHeightStrategy, setPageHeightStrategy, type PageHeightStrategy } from '@/lib/printPageStrategy';
import { beginThermalPrintDomSession, getThermalPaperWidthMicrons } from '@/lib/thermal-print';
import {
  subscribePendingJobs,
  retryCloudJob,
  type CloudPrintJob,
} from '@/lib/cloudPrintJobs';
import PrintModeBadge from './PrintModeBadge';
import PrintSpeedTestPanel from './PrintSpeedTestPanel';
import LocalPrintFailedPanel from './LocalPrintFailedPanel';
import DemoHealthCheckCard from './DemoHealthCheckCard';

const ROLE_OPTIONS: { value: PrinterConfig['role']; label: string }[] = [
  { value: 'counter', label: 'Counter Receipt Printer' },
  { value: 'kitchen', label: 'Kitchen Printer (KOT)' },
  { value: 'delivery', label: 'Delivery / Rider Printer' },
  { value: 'display', label: 'Customer Display' },
];

export default function PrinterSettingsPanel() {
  const [settings, setSettings] = useState<PrinterSettingsDoc>({ printers: [], deviceAssignments: {} });
  const [systemPrinters, setSystemPrinters] = useState<{ name: string }[]>([]);
  const [serverOn, setServerOn] = useState(isPrintServerEnabled());
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<CloudPrintJob[]>([]);

  useEffect(() => {
    loadPrinterSettings().then(setSettings);
  }, []);

  useEffect(() => {
    refreshPrinters();
  }, []);

  useEffect(() => {
    const unsub = subscribePendingJobs(setPending, { max: 20 });
    return () => unsub();
  }, []);

  async function refreshPrinters() {
    if (!isElectron()) return;
    try {
      const list = await getPrinters();
      setSystemPrinters(list || []);
    } catch {}
  }

  function addPrinter() {
    setSettings((s) => ({ ...s, printers: [...s.printers, defaultPrinterConfig()] }));
  }

  function updatePrinter(idx: number, patch: Partial<PrinterConfig>) {
    setSettings((s) => ({
      ...s,
      printers: s.printers.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  }

  function removePrinter(idx: number) {
    setSettings((s) => ({ ...s, printers: s.printers.filter((_, i) => i !== idx) }));
  }

  async function save() {
    setSaving(true);
    try {
      await savePrinterSettings(settings);
      toast.success('Printer settings saved');
    } catch (e: any) {
      toast.error('Save failed: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  function toggleServer(on: boolean) {
    setPrintServerEnabled(on);
    setServerOn(on);
    toast.success(on ? 'This device is now the Print Server' : 'Print Server disabled on this device');
  }

  async function testLan(p: PrinterConfig) {
    const api = (window as any).electronAPI;
    if (!api?.printLanEscpos || !api?.testLanPrinter) {
      toast.error('The LAN test only works in the Windows desktop app');
      return;
    }
    if (!p.lanHost) {
      toast.error('Enter the printer IP first');
      return;
    }
    toast.info(`Connecting to ${p.lanHost}:${p.lanPort || 9100}…`);
    const ping = await api.testLanPrinter({ host: p.lanHost, port: p.lanPort || 9100 });
    if (!ping.success) {
      toast.error('Connect fail: ' + ping.error);
      return;
    }
    const { buildEscposFromText } = await import('@/printing/escpos');
    const bytes = buildEscposFromText(
      `*** DT POS TEST PRINT ***\n${p.name}\n${p.lanHost}:${p.lanPort || 9100}\n${new Date().toLocaleString()}\n\nIf this slip printed,\nthe printer setup is OK.\n`,
      { autoCut: p.autoCut, beep: p.beep, bottomFeedLines: 4 },
    );
    const res = await api.printLanEscpos({ host: p.lanHost, port: p.lanPort || 9100, data: bytes });
    if (res.success) toast.success('Test print sent ✓');
    else toast.error('Print fail: ' + res.error);
  }

  /** Test print for USB/Windows printer — opens a tiny receipt via Electron silent print. */
  async function testSystem(p: PrinterConfig) {
    if (!isElectron()) {
      toast.error('Test print is only available in the desktop app, not in the browser');
      return;
    }
    if (!p.printerName) {
      toast.error('Select a Windows printer name first');
      return;
    }
    // Build a tiny in-DOM portal so electron silent print captures it
    const portal = document.createElement('div');
    portal.className = 'receipt-print-portal';
    portal.setAttribute('data-active-print', 'true');
    portal.style.cssText = 'position:fixed;left:0;top:0;width:' + p.paperSize + ';background:#fff;z-index:99999;font-family:"Courier New",monospace;font-size:12px;padding:4mm;';
    portal.innerHTML = `
      <div style="text-align:center;font-weight:bold;font-size:14px;">*** DT POS TEST ***</div>
      <div style="text-align:center;">${p.name}</div>
      <div style="text-align:center;">${p.printerName}</div>
      <div style="text-align:center;">${new Date().toLocaleString()}</div>
      <div style="text-align:center;margin-top:6px;">If this slip printed,<br/>the printer setup is OK ✓</div>
      <div style="height:8mm;"></div>`;
    document.body.appendChild(portal);
    // Activate the thermal print session so ONLY the slip prints —
    // previously the whole app screen printed behind the test slip.
    const endSession = beginThermalPrintDomSession(portal, (p.paperSize as any) || '80mm');
    await new Promise(r => setTimeout(r, 250));
    try {
      const res = await printReceiptNative({
        printerName: p.printerName,
        silent: true,
        pageWidthMicrons: getThermalPaperWidthMicrons((p.paperSize as any) || '80mm'),
        usePrinterDefaultPageSize: true,
        autoCut: p.autoCut,
      });
      if (res.success) toast.success('Test print sent ✓');
      else toast.error('Print fail: ' + (res.error || 'unknown'));
    } finally {
      setTimeout(() => { endSession(); portal.remove(); }, 800);
    }
  }


  // Role-mapping summary (per role -> assigned enabled printer)
  const roleMap = ROLE_OPTIONS.map(r => ({
    role: r.value,
    label: r.label,
    printer: settings.printers.find(p => p.enabled && p.role === r.value),
  }));

  return (
    <div className="space-y-6">
      {/* System Readiness */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">System Readiness</h2>
        <DemoHealthCheckCard />
      </div>

      {/* Mode badge + Print Server toggle */}
      <Card className="p-4">

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Server className="h-5 w-5 mt-1 text-primary" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Silent Print Server (Windows EXE)</h3>
                <PrintModeBadge />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                This device listens to the cloud print queue and silently prints every KOT and receipt.
                Enable on <b>one device only</b> (the counter PC the printers are attached to).
              </p>
              {!isElectron() && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠️ Browser mode — silent printing only works in the Windows desktop app.
                  Browser me <b>Print Preview</b> dialog will open for every receipt.
                </p>
              )}
            </div>
          </div>
          <Switch checked={serverOn} onCheckedChange={toggleServer} disabled={!isElectron()} />
        </div>
      </Card>

      {/* Role mapping summary */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Printer className="h-5 w-5" /> Printer Role Mapping
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {roleMap.map(rm => (
            <div key={rm.role} className="flex items-center justify-between border rounded p-2 text-sm">
              <div>
                <div className="font-medium">{rm.label}</div>
                <div className="text-xs text-muted-foreground">
                  {rm.printer ? `${rm.printer.name} · ${rm.printer.printerName || rm.printer.lanHost || '—'}` : '⚠️ Not assigned'}
                </div>
              </div>
              {rm.printer && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => rm.printer!.connection === 'lan' ? testLan(rm.printer!) : testSystem(rm.printer!)}
                >
                  <TestTube className="h-3.5 w-3.5 mr-1" /> Test
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>


      {/* Printer configs */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Printer className="h-5 w-5" /> Restaurant Printers
          </h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refreshPrinters}>
              <RefreshCw className="h-4 w-4 mr-1" /> Detect
            </Button>
            <Button size="sm" onClick={addPrinter}>
              <Plus className="h-4 w-4 mr-1" /> Add Printer
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        {settings.printers.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No printers configured. Click "Add Printer" to add one.
          </p>
        )}

        <div className="space-y-4">
          {settings.printers.map((p, idx) => (
            <Card key={p.id} className="p-4 border-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Label</Label>
                  <Input value={p.name} onChange={(e) => updatePrinter(idx, { name: e.target.value })} />
                </div>
                <div>
                  <Label>Printer Role</Label>
                  <Select
                    value={p.role}
                    onValueChange={(v) => updatePrinter(idx, { role: v as PrinterConfig['role'] })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Connection Type</Label>
                  <Select
                    value={p.connection || 'system'}
                    onValueChange={(v) => updatePrinter(idx, {
                      connection: v as PrinterConfig['connection'],
                      escposMode: v === 'lan' ? true : p.escposMode,
                    })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">USB / Windows Printer</SelectItem>
                      <SelectItem value="lan">LAN / Network (IP)</SelectItem>
                      <SelectItem value="bluetooth">Bluetooth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(p.connection || 'system') === 'system' && (
                  <div className="md:col-span-3">
                    <Label>Windows Printer Name</Label>
                    {systemPrinters.length > 0 ? (
                      <Select
                        value={p.printerName}
                        onValueChange={(v) => updatePrinter(idx, { printerName: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Select printer..." /></SelectTrigger>
                        <SelectContent>
                          {systemPrinters.map((sp) => (
                            <SelectItem key={sp.name} value={sp.name}>{sp.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={p.printerName}
                        placeholder="e.g. EPSON TM-T82"
                        onChange={(e) => updatePrinter(idx, { printerName: e.target.value })}
                      />
                    )}
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="outline" onClick={() => testSystem(p)}>
                        <TestTube className="h-3.5 w-3.5 mr-1" /> Test Print
                      </Button>
                    </div>
                  </div>
                )}


                {p.connection === 'lan' && (
                  <>
                    <div className="md:col-span-2">
                      <Label>Printer IP Address</Label>
                      <Input
                        value={p.lanHost || ''}
                        placeholder="e.g. 192.168.1.50"
                        onChange={(e) => updatePrinter(idx, { lanHost: e.target.value.trim() })}
                      />
                    </div>
                    <div>
                      <Label>Port</Label>
                      <Input
                        type="number"
                        value={p.lanPort || 9100}
                        placeholder="9100"
                        onChange={(e) => updatePrinter(idx, { lanPort: Number(e.target.value) || 9100 })}
                      />
                    </div>
                    <div className="md:col-span-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground flex-1">
                        💡 LAN/Network printer (Epson, Xprinter, etc.) enter the printer IP and port (usually <b>9100</b>) ). The raw ESC/POS protocol is used — no driver install needed.
                      </p>
                      <Button size="sm" variant="outline" onClick={() => testLan(p)}>
                        Test Print
                      </Button>
                    </div>
                  </>
                )}

                {p.connection === 'bluetooth' && (
                  <div className="md:col-span-3">
                    <Label>Bluetooth Device Name</Label>
                    <Input
                      value={p.printerName}
                      placeholder="e.g. BlueTooth Printer"
                      onChange={(e) => updatePrinter(idx, { printerName: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Pair the Bluetooth printer in Windows first, then enter its name here.
                    </p>
                  </div>
                )}

                <div>
                  <Label>Paper Size</Label>
                  <Select
                    value={p.paperSize}
                    onValueChange={(v) => updatePrinter(idx, { paperSize: v as '58mm' | '80mm' })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="58mm">58 mm</SelectItem>
                      <SelectItem value="80mm">80 mm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Copies</Label>
                  <Input type="number" min={1} value={p.copies}
                    onChange={(e) => updatePrinter(idx, { copies: Math.max(1, Number(e.target.value) || 1) })} />
                </div>
                <div>
                  <Label>Print Width (mm, optional)</Label>
                  <Input type="number" min={0} value={p.printWidthMm || ''}
                    onChange={(e) => updatePrinter(idx, { printWidthMm: Number(e.target.value) || undefined })} />
                </div>

                <div>
                  <Label>Left Margin (mm)</Label>
                  <Input type="number" min={0} value={p.leftMarginMm}
                    onChange={(e) => updatePrinter(idx, { leftMarginMm: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label>Right Margin (mm)</Label>
                  <Input type="number" min={0} value={p.rightMarginMm}
                    onChange={(e) => updatePrinter(idx, { rightMarginMm: Number(e.target.value) || 0 })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Top Feed (mm) — max {MAX_TOP_MARGIN_MM}</Label>
                    <Input type="number" min={0} max={MAX_TOP_MARGIN_MM} value={p.topFeedMm}
                      onChange={(e) => updatePrinter(idx, { topFeedMm: clampTopMarginMm(Number(e.target.value)) })} />
                    {p.topFeedMm >= MAX_TOP_MARGIN_MM * 0.8 && (
                      <p className="text-[10px] text-amber-600 mt-0.5">⚠️ This will feed a lot of blank paper</p>
                    )}
                  </div>
                  <div>
                    <Label>Bottom Feed</Label>
                    <Input type="number" min={0} value={p.bottomFeedMm}
                      onChange={(e) => updatePrinter(idx, { bottomFeedMm: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-4 border-t">
                <ToggleRow label="Enabled" v={p.enabled} on={(v) => updatePrinter(idx, { enabled: v })} />
                <ToggleRow label="Auto Cut" v={p.autoCut} on={(v) => updatePrinter(idx, { autoCut: v })} />
                <ToggleRow label="Beep" v={p.beep} on={(v) => updatePrinter(idx, { beep: v })} />
                <ToggleRow label="ESC/POS" v={p.escposMode} on={(v) => updatePrinter(idx, { escposMode: v })} />
                <ToggleRow label="Browser Backup" v={p.browserBackup} on={(v) => updatePrinter(idx, { browserBackup: v })} />
              </div>

              <div className="flex justify-end mt-3">
                <Button size="sm" variant="ghost" onClick={() => removePrinter(idx)}>
                  <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </Card>

      {/* Live queue */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Pending / Failed Print Jobs ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending jobs. ✅</p>
        ) : (
          <div className="space-y-2">
            {pending.map((j) => (
              <div key={j.id} className="flex items-center justify-between text-sm border rounded p-2">
                <div>
                  <span className="font-medium uppercase">{j.type}</span>
                  {' · '}role: {j.role}
                  {j.orderNumber ? ` · #${j.orderNumber}` : ''}
                  {' · '}
                  <span className={j.status === 'failed' ? 'text-destructive' : 'text-amber-600'}>
                    {j.status}
                  </span>
                  {j.error && <div className="text-xs text-destructive mt-1">{j.error}</div>}
                </div>
                {j.status === 'failed' && (
                  <Button size="sm" variant="outline" onClick={() => retryCloudJob(j.id)}>
                    Reprint
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Local failed jobs (device queue) — Phase-2 */}
      <LocalPrintFailedPanel />

      {/* Print speed instrumentation — Phase-2 */}
      <PrintSpeedTestPanel />

      {/* v1.5.3 — Windows driver page strategy (top-blank fix switch) */}
      <PageStrategyPanel />

      {/* v1.5.2 — Print diagnostics. Shows exactly which path printed and with
          what margins/page height, so a "blank paper at top" report can be
          diagnosed from facts instead of guesswork. */}
      <PrintDiagnosticsPanel />
    </div>
  );
}

function PageStrategyPanel() {
  const [strategy, setStrategy] = useState<PageHeightStrategy>(getPageHeightStrategy());
  const apply = (v: PageHeightStrategy) => {
    setPageHeightStrategy(v);
    setStrategy(v);
    toast.success(v === 'driver'
      ? 'Driver mode ON — now print a real receipt and check the top margin'
      : 'Measured mode ON — now print a real receipt and check the top margin');
  };
  return (
    <Card className="p-3 space-y-2 border-amber-300/60">
      <h3 className="text-sm font-bold">📏 Top Blank Paper Fix (for this device)</h3>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        The blank paper before a receipt is fed by the Windows printer driver when it is given a
        custom page height — every driver behaves differently. If on this machine there is extra blank paper
        receipt ke <b>upar</b> select <b>"Driver Mode"</b> ,
        then print a real receipt (not a test print) and look. Whichever mode works, <b>asli receipt</b> 
        leave it selected — this setting applies only to this computer.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => apply('measured')}
          className={`rounded-lg border p-2.5 text-left transition-colors ${strategy === 'measured' ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
        >
          <div className="text-xs font-bold">Measured (default)</div>
          <div className="text-[10px] text-muted-foreground">
            The app sends the exact content height. Best for most printers.
          </div>
        </button>
        <button
          type="button"
          onClick={() => apply('driver')}
          className={`rounded-lg border p-2.5 text-left transition-colors ${strategy === 'driver' ? 'border-primary bg-primary/10' : 'hover:bg-accent'}`}
        >
          <div className="text-xs font-bold">Driver Mode</div>
          <div className="text-[10px] text-muted-foreground">
            Let the driver own "80mm x Receipt" setting decide the page height.
            For Black Copper units that feed a blank top.
          </div>
        </button>
      </div>
      {strategy === 'driver' && (
        <p className="text-[10px] text-amber-700">
          Note: Driver Mode me Windows ke printer properties me paper size
          "80mm x Receipt" (or similar) — otherwise the driver may assume A4.
        </p>
      )}
    </Card>
  );
}

function PrintDiagnosticsPanel() {
  const [entries, setEntries] = useState<PrintDiagEntry[]>([]);
  const refresh = () => setEntries(getPrintDiags());
  useEffect(() => { refresh(); }, []);

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">🔍 Print Diagnostics (last {entries.length})</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={refresh}>Refresh</Button>
          <Button
            size="sm" variant="ghost" className="h-7 text-xs"
            onClick={() => { clearPrintDiags(); refresh(); }}
          >Clear</Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Har print ki asal tafseel — kaunsa raasta (Windows driver ya LAN),
        page height and top margin. If a printing problem persists, send these details to support.
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No print records yet.</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-auto">
          {entries.map((e, i) => (
            <div
              key={i}
              className={`text-[11px] font-mono rounded px-2 py-1 ${e.success ? 'bg-muted/50' : 'bg-destructive/10 text-destructive'}`}
            >
              <span className="opacity-60">
                {new Date(e.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              {' — '}
              {summarisePrintDiag(e)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ToggleRow({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <Switch checked={v} onCheckedChange={on} />
    </div>
  );
}
