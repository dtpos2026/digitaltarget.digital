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
import { Printer, Plus, Trash2, Save, RefreshCw, Server, TestTube, AlertTriangle, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import { PAPER_PROFILE_LIST, paperProfileOf } from '@/printing/paperProfile';
import {
  loadPrinterSettings,
  savePrinterSettings,
  defaultPrinterConfig,
  isPrintServerEnabled,
  setPrintServerEnabled,
  resetLocalPrinterConfig,
  type PrinterConfig,
  type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import { getPrinters, isElectron, type SystemPrinterInfo } from '@/lib/electron';
import { getSettings } from '@/lib/store';
import { printTestSlip, testModeFor, nextModeAfterBlank, TEST_MODE_LABEL, type TestMode } from '@/printing/testSlip';
import { matchPrinter } from '@/printing/printerMatch';
import { detectPrinterBrand, applyPreset } from '@/lib/printerPresets';
import { autoDetectPrinters } from '@/printing/printerAutoDetect';
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
  { value: 'token', label: 'Tandoor Token Printer' },
];

export default function PrinterSettingsPanel() {
  const [settings, setSettings] = useState<PrinterSettingsDoc>({ printers: [], deviceAssignments: {} });
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinterInfo[]>([]);
  const [printerPorts, setPrinterPorts] = useState<Record<string, { port?: string; driver?: string }>>({});
  const [serverOn, setServerOn] = useState(isPrintServerEnabled());
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFound, setScanFound] = useState<Array<{ host: string; port: number }>>([]);
  const [pending, setPending] = useState<CloudPrintJob[]>([]);
  const [detecting, setDetecting] = useState(false);
  /** The last test print, so the shop can say whether it came out blank. */
  const [lastTest, setLastTest] = useState<{ id: string; mode: TestMode; route: string; success: boolean; error?: string; confirmed?: boolean; exhausted?: boolean } | null>(null);

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

  async function refreshPrinters(showToast = false) {
    if (!isElectron()) return;
    setDetecting(true);
    try {
      // Re-detect is the same pass that runs at startup, not just a list
      // refresh: it re-points a saved name at the device Windows now calls it,
      // and fills the role targets the print queue reads. Pressing this button
      // used to only redraw the list, which is why the fix had to be finished
      // by hand with Detect and then Save.
      const repair = await autoDetectPrinters();
      if (repair.created || repair.relinked.length || repair.filledRoles.length) {
        loadPrinterSettings().then(setSettings);
        if (showToast) toast.success(repair.message);
      }
      const list = await getPrinters();
      setSystemPrinters(list || []);
        try {
          const det = await (window as any).electronAPI?.getPrinterDetails?.();
          if (det?.success && Array.isArray(det.printers)) {
            const map: Record<string, { port?: string; driver?: string }> = {};
            for (const d of det.printers) map[d.Name] = { port: d.PortName, driver: d.DriverName };
            setPrinterPorts(map);
          }
        } catch {}
      if (showToast && !(repair.created || repair.relinked.length || repair.filledRoles.length)) {
        toast.success(`Detected ${list?.length || 0} printer(s) — configuration already correct.`);
      }
    } catch (e: any) {
      if (showToast) toast.error('Detect failed: ' + (e?.message || e));
    } finally {
      setDetecting(false);
    }
  }

  function resetLocal() {
    if (!confirm('Reset local printer config? All saved printers will be removed from this device (the cloud copy stays safe). You will need to re-add them after restarting the app.')) return;
    resetLocalPrinterConfig();
    setSettings({ printers: [], deviceAssignments: {} });
    toast.success('Local printer config cleared');
  }

  // ---------- Diagnostics helpers ----------
  /** Detect duplicate/stale Windows printer entries like "Foo", "Foo(1)", "Foo Copy 1". */
  function baseName(n: string) {
    return n.toLowerCase()
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/\s*(copy|redirected)(\s*\d+)?\s*$/i, '')
      .trim();
  }
  const duplicateGroups = (() => {
    const map = new Map<string, string[]>();
    for (const sp of systemPrinters) {
      const k = baseName(sp.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(sp.name);
    }
    return Array.from(map.values()).filter((g) => g.length > 1);
  })();

  /** Well-known thermal receipt driver keywords. */
  const KNOWN_DRIVERS = ['epson','tm-t','pos','thermal','xprinter','xp-','escpos','esc/pos','blackcopper','black copper','bc-','bc_','bc ','star','citizen','bixolon','generic / text','generic text','receipt'];
  function isKnownDriver(d?: string) {
    if (!d) return false;
    const s = d.toLowerCase();
    return KNOWN_DRIVERS.some((k) => s.includes(k));
  }
  function printerInfo(name?: string) {
    // v1.0.39b: narm matching — "(Copy 1)", extra spaces, name/displayName
    // ke farq ki wajah se pehle jhooti "not detected" warning aati thi.
    return matchPrinter(name, systemPrinters).printer as any;
  }

  function addPrinter() {
    setSettings((s) => ({ ...s, printers: [...s.printers, defaultPrinterConfig()] }));
  }

  /**
   * Probe TCP 9100 across this machine's own subnet to find network printers.
   *
   * Nothing is configured automatically: a host answering on 9100 is very
   * likely a thermal printer, but "very likely" is not "is". The scan reports
   * what it found and the user adds the one they recognise, which is both
   * honest and faster than typing an IP.
   */
  async function scanLan() {
    const api: any = (window as any).electronAPI;
    if (!api?.scanLanPrinters) {
      toast.error('Network scanning is available in the desktop app.');
      return;
    }
    setScanning(true);
    setScanFound([]);
    try {
      const res = await api.scanLanPrinters({ port: 9100 });
      if (!res?.success) {
        toast.error(res?.error || 'Network scan failed.');
        return;
      }
      setScanFound(res.printers || []);
      if (!res.printers?.length) {
        toast.info(`No printer answered on port 9100 across ${(res.subnets || []).join(', ')}. Check that the printer is powered on and on this network.`);
      } else {
        toast.success(`Found ${res.printers.length} device(s) answering on port 9100.`);
      }
    } catch (e: any) {
      toast.error(`Network scan failed: ${e?.message || String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  /** Add a discovered host as a LAN printer, ready to assign a role. */
  function addDiscovered(host: string, port: number) {
    const cfg = {
      ...defaultPrinterConfig(),
      name: `Network printer ${host}`,
      connection: 'lan' as const,
      lanHost: host,
      lanPort: port,
      escposMode: true,
    };
    setSettings((s) => ({ ...s, printers: [...s.printers, cfg] }));
    setScanFound(prev => prev.filter(p => p.host !== host));
    toast.success(`${host} added. Choose its role below, then Save.`);
  }

  function updatePrinter(idx: number, patch: Partial<PrinterConfig>) {
    setSettings((s) => ({
      ...s,
      printers: s.printers.map((p, i) => {
        if (i !== idx) return p;
        const merged = { ...p, ...patch };
        // ============================================================
        // Auto-detect printer brand when user picks a Windows printer.
        // Applies safe defaults (paper size + Windows Driver render mode)
        // for BIXOLON, Epson TM, Xprinter, Black Copper, Rongta, SPRT,
        // Fujitsu, HPRT, Star, Citizen, and generic 58/80mm.
        // Only runs on printer-name change and only when the user hasn't
        // manually tweaked paper size / fallback mode.
        // ============================================================
        if (patch.printerName !== undefined && patch.printerName !== p.printerName) {
          const info = matchPrinter(patch.printerName, systemPrinters).printer as any;
          const preset = detectPrinterBrand(patch.printerName || '', info?.driverName);
          if (preset) {
            const shouldOverride = !p.printerName; // first-time selection only
            const next = shouldOverride ? applyPreset(merged, preset) : merged;
            if (!next.name || next.name === 'New Printer') next.name = preset.brand;
            setTimeout(() => toast.success(`Detected ${preset.brand} — ${preset.paperSize}, ${preset.fallbackMode.toUpperCase()} mode`), 0);
            return next;
          }
        }
        return merged;
      }),
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
      toast.error('LAN test only works in the Windows EXE app');
      return;
    }
    if (!p.lanHost) {
      toast.error('Please enter the Printer IP first');
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
      `*** DT POS TEST PRINT ***\n${p.name}\n${p.lanHost}:${p.lanPort || 9100}\n${new Date().toLocaleString()}\n\nIf this slip printed\nthen the printer setup is OK.\n`,
      { autoCut: p.autoCut, beep: p.beep, bottomFeedLines: 4 },
    );
    const res = await api.printLanEscpos({ host: p.lanHost, port: p.lanPort || 9100, data: bytes });
    if (res.success) toast.success('Test print sent ✓');
    else toast.error('Print fail: ' + res.error);
  }

  /**
   * Test print for a USB/Windows printer — through the SAME route a bill takes
   * on this printer (its Print Mode, and the shop's Fast Billing switch).
   * It used to print through the Windows driver only, so a printer could pass
   * the test while every bill came out blank on the image route.
   */
  async function testSystem(p: PrinterConfig, modeOverride?: TestMode) {
    if (!isElectron()) {
      toast.error('Test print is only available in the Electron app (not in browser)');
      return;
    }
    if (!p.printerName) {
      toast.error('Please select a Windows printer name first');
      return;
    }
    const mode = modeOverride || testModeFor(p, getSettings());
    const res = await printTestSlip(p, mode);
    setLastTest({ id: p.id, mode, route: res.route, success: res.success, error: res.error });
    if (res.success) toast.success(`Test sent (${res.route}). Check the paper and answer below.`);
    else toast.error('Print fail: ' + (res.error || 'unknown'));
  }

  /**
   * The test slip came out blank: move this printer to the next print mode,
   * save it, and print the test again — so the working mode is found on the
   * real printer, not guessed.
   */
  async function onTestBlank(idx: number) {
    const p = settings.printers[idx];
    if (!p || !lastTest || lastTest.id !== p.id) return;
    const next = nextModeAfterBlank(lastTest.mode);
    if (!next) {
      setLastTest({ ...lastTest, exhausted: true });
      return;
    }
    const updated = { ...p, printMode: next } as PrinterConfig;
    const nextSettings = { ...settings, printers: settings.printers.map((q, i) => (i === idx ? updated : q)) };
    setSettings(nextSettings);
    try {
      await savePrinterSettings(nextSettings);
      toast.info(`${p.name || p.printerName}: switched to ${TEST_MODE_LABEL[next]} — printing the test again.`);
    } catch (e: any) {
      toast.error('Could not save the new print mode: ' + (e?.message || e));
      return;
    }
    await testSystem(updated, next);
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
                This device will listen to the cloud print queue and silently print every KOT/receipt automatically.
                Enable this on <b>only one device</b> (the counter PC that has the printer attached).
              </p>
              {!isElectron() && (
                <p className="text-xs text-amber-600 mt-2">
                  ⚠️ Browser mode — silent printing only works in the Windows EXE app.
                  In the browser, a <b>Print Preview</b> dialog will open for every receipt.
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
            <Button size="sm" variant="outline" onClick={() => refreshPrinters(true)} disabled={detecting}>
              <RefreshCw className={`h-4 w-4 mr-1 ${detecting ? 'animate-spin' : ''}`} /> Re-detect
            </Button>
            <Button size="sm" variant="outline" onClick={resetLocal}>
              <Eraser className="h-4 w-4 mr-1 text-destructive" /> Reset Local
            </Button>
            <Button size="sm" variant="outline" onClick={scanLan} disabled={scanning}>
              <Server className={`h-4 w-4 mr-1 ${scanning ? 'animate-pulse' : ''}`} />
              {scanning ? 'Scanning…' : 'Find Network Printers'}
            </Button>
            <Button size="sm" onClick={addPrinter}>
              <Plus className="h-4 w-4 mr-1" /> Add Printer
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        {scanFound.length > 0 && (
          <div className="rounded-md border border-status-info/40 bg-status-info/5 p-3 space-y-2">
            <p className="text-sm font-medium">Devices answering on port 9100</p>
            <p className="text-xs text-muted-foreground">
              These are almost certainly network printers, but the scan cannot be
              certain. Add the one you recognise and send it a test print.
            </p>
            <div className="flex flex-wrap gap-2">
              {scanFound.map(f => (
                <Button key={f.host} size="sm" variant="outline" onClick={() => addDiscovered(f.host, f.port)}>
                  <Plus className="h-3 w-3 mr-1" /> {f.host}:{f.port}
                </Button>
              ))}
            </div>
          </div>
        )}

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
                            <SelectItem key={sp.name} value={sp.name}>
                              {sp.name}
                              {sp.driverName ? ` — ${sp.driverName}` : ''}
                              {sp.portName ? ` [${sp.portName}]` : ''}
                              {sp.isDefault ? ' ★' : ''}
                            </SelectItem>
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
                    {/* Driver / port diagnostics */}
                    {(() => {
                      const info = printerInfo(p.printerName);
                      const preset = detectPrinterBrand(p.printerName || '', info?.driverName);
                      if (!p.printerName) return null;
                      const warnings: string[] = [];
                      if (!info) warnings.push('Printer not detected in Windows — reinstall the driver and press Re-detect.');
                      if (info && !info.portName) warnings.push('Port missing — the printer may be offline or the driver corrupted.');
                      if (info && !preset && !isKnownDriver(info.driverName)) warnings.push(`Unknown driver "${info.driverName || '—'}" — try Fallback Mode "ESC/POS" or "Text".`);
                      const dupGroup = duplicateGroups.find((g) => g.includes(p.printerName));
                      if (dupGroup) warnings.push(`Duplicate/stale entries found: ${dupGroup.join(', ')}. Remove the extra copies from Windows Devices.`);
                      return (
                        <div className="mt-1 space-y-1">
                          {info && (
                            <div className="text-xs text-muted-foreground">
                              Driver: <b>{info.driverName || '—'}</b> · Port: <b>{info.portName || '—'}</b>
                            </div>
                          )}
                          {warnings.map((w, i) => (
                            <div key={i} className="text-xs text-amber-600 flex items-start gap-1">
                              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              <span>{w}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="flex justify-end mt-2">
                      <Button size="sm" variant="outline" onClick={() => testSystem(p)}>
                        <TestTube className="h-3.5 w-3.5 mr-1" /> Test Print
                      </Button>
                    </div>
                    {lastTest && lastTest.id === p.id && lastTest.success && (
                      <div className="mt-2 rounded-md border p-2 text-xs space-y-1.5" data-testid="test-feedback">
                        <div>
                          Test sent via <b>{lastTest.route}</b> (Print Mode: {TEST_MODE_LABEL[lastTest.mode]}).
                          {!lastTest.confirmed && !lastTest.exhausted && ' Did the paper show the test text?'}
                        </div>
                        {lastTest.confirmed ? (
                          <div className="text-status-success font-semibold">✓ This mode works on this printer — bills will print the same way.</div>
                        ) : lastTest.exhausted ? (
                          <div className="text-destructive space-y-1">
                            <div className="font-semibold">Blank in every mode — this points to the paper or the printer, not DT POS:</div>
                            <div>• Thermal paper loaded the wrong way round prints nothing. Scratch the paper with a fingernail: the side that turns grey must face the print head.</div>
                            <div>• Press <b>Windows Driver Test</b> below. If the Windows test page is blank too, it is the paper, the head or the driver.</div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" className="h-7" onClick={() => setLastTest({ ...lastTest, confirmed: true })}>Yes, it printed</Button>
                            <Button size="sm" variant="outline" className="h-7 text-destructive" onClick={() => void onTestBlank(idx)}>
                              Came out blank{nextModeAfterBlank(lastTest.mode) ? ` — try ${TEST_MODE_LABEL[nextModeAfterBlank(lastTest.mode)!]}` : ''}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {p.printerName && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-muted font-mono">
                          Port: {printerPorts[p.printerName]?.port || '—'} · Driver: {printerPorts[p.printerName]?.driver || '—'}
                        </span>
                        <Button size="sm" variant="outline" onClick={async () => {
                          const r = await (window as any).electronAPI?.printWindowsTestPage?.(p.printerName);
                          r?.success ? toast.success('Windows driver test page sent — if THIS also comes out blank, the issue is the driver/paper, not the software')
                                     : toast.error('Test page fail: ' + (r?.error || 'unknown'));
                        }}>Windows Driver Test</Button>
                        <Button size="sm" variant="outline" onClick={() => (window as any).electronAPI?.openPrinterProperties?.(p.printerName)}>
                          Open Port / Properties
                        </Button>
                      </div>
                    )}
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
                        💡 For a LAN/Network printer (Epson, Xprinter, etc.) enter the printer's IP and port (usually <b>9100</b>). The raw ESC/POS protocol will be used — no driver installation needed.
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
                  <Label>Paper Profile</Label>
                  <Select
                    value={p.paperSize}
                    onValueChange={(v) => updatePrinter(idx, { paperSize: v as '58mm' | '80mm' | '110mm' })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAPER_PROFILE_LIST.map((prof) => (
                        <SelectItem key={prof.id} value={prof.id}>{prof.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {paperProfileOf(p.paperSize).printableMm} mm printable ·{' '}
                    {paperProfileOf(p.paperSize).dots} dots ·{' '}
                    {paperProfileOf(p.paperSize).charsFontA} characters per line
                  </p>
                </div>
                <div>
                  <Label>Print Mode</Label>
                  <Select
                    value={p.printMode || 'auto'}
                    onValueChange={(v) => updatePrinter(idx, { printMode: v as any })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automatic (rendered template, sent as RAW)</SelectItem>
                      <SelectItem value="raw">Raw ESC/POS (fastest — plain text slip)</SelectItem>
                      <SelectItem value="driver">Windows driver only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    <b>Raw ESC/POS</b> skips the render step entirely, so it is the
                    fastest path — but it prints a plain text slip rather than the
                    designed template. <b>Automatic</b> keeps the template and still
                    sends one RAW job with no dialog.
                  </p>
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
                <div className="md:col-span-3">
                  <Label>Fallback Print Mode</Label>
                  <Select
                    value={p.fallbackMode || 'html'}
                    onValueChange={(v) => updatePrinter(idx, { fallbackMode: v as any })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="html">HTML / Electron (default — Windows driver render)</SelectItem>
                      <SelectItem value="escpos">Raw ESC/POS (thermal init + cut bytes)</SelectItem>
                      <SelectItem value="text">Generic Text (plain UTF-8, no ESC/POS)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    If you're getting blank/1–2 inch paper: try <b>ESC/POS</b>. For an old "Generic / Text Only" driver, use <b>Generic Text</b>.
                  </p>
                </div>

                <div>
                  <Label>Left Margin (mm)</Label>
                  <Input type="number" min={-100} max={100} step={0.5} value={p.leftMarginMm}
                    onChange={(e) => updatePrinter(idx, { leftMarginMm: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label>Right Margin (mm)</Label>
                  <Input type="number" min={-100} max={100} step={0.5} value={p.rightMarginMm}
                    onChange={(e) => updatePrinter(idx, { rightMarginMm: Number(e.target.value) || 0 })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Top Feed (mm)</Label>
                    <Input type="number" min={-100} max={100} step={0.5} value={p.topFeedMm}
                      onChange={(e) => updatePrinter(idx, { topFeedMm: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <Label>Bottom Feed</Label>
                    <Input type="number" min={-100} max={100} step={0.5} value={p.bottomFeedMm}
                      onChange={(e) => updatePrinter(idx, { bottomFeedMm: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              </div>

              {/* ===== SWITCHES THAT ACTUALLY DO SOMETHING =====
                  Two used to sit here and did not.

                  "ESC/POS" said exactly what Print Mode -> Raw says, and
                  nothing read it: a shop that turned it on got no raw printing
                  and no explanation. Stored values are folded into Print Mode
                  once per machine, so the intent survives the switch going.

                  "Browser Backup" would have restored a fallback that was
                  deliberately removed: at an unattended counter it put a modal
                  print dialog in front of the cashier AND reported the job as
                  successful, so a dead printer both froze the till and hid the
                  failure. The browser build still falls back to the browser's
                  own dialog by itself, which is the real backup and needs no
                  switch. A switch whose honest label would be "freeze the till
                  and hide the error" should not exist.

                  Auto Cut and Beep were in the same state until this release —
                  stored, shown, and read by nothing. They are read now. */}
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t">
                <ToggleRow label="Enabled" v={p.enabled} on={(v) => updatePrinter(idx, { enabled: v })} />
                <ToggleRow label="Auto Cut" v={p.autoCut} on={(v) => updatePrinter(idx, { autoCut: v })} />
                <ToggleRow label="Beep" v={p.beep} on={(v) => updatePrinter(idx, { beep: v })} />
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
    </div>
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
