import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  runFullDiagnostic,
  detectInstalledPrinters,
  pingPrinter,
  restartSpooler,
  clearPrintQueue,
  formatReportText,
  type DiagnosticReport,
  type CheckResult,
} from '@/lib/printerDiagnostics';
import {
  loadPrinterSettings,
  savePrinterSettings,
  defaultPrinterConfig,
  type PrinterConfig,
  type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import { readPrintLog, clearPrintLog, lastSuccessful, lastFailed, appendPrintLog } from '@/lib/printLog';
import { electronPrintReceipt, isElectronPrintAvailable } from '@/printing';
import { buildEscposFromText } from '@/printing/escpos';
import { isElectron } from '@/lib/electron';
import {
  Activity, Plug, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Wifi, Printer,
  FileText, Download, Wrench, ListChecks, FlaskConical, Server, Trash2, Settings2,
} from 'lucide-react';

function StatusDot({ status }: { status: CheckResult['status'] }) {
  const map: Record<CheckResult['status'], string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    fail: 'bg-red-500',
    info: 'bg-blue-500',
    skip: 'bg-muted-foreground/40',
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${map[status]}`} />;
}

function StatusIcon({ status }: { status: CheckResult['status'] }) {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  if (status === 'fail') return <XCircle className="w-4 h-4 text-red-600" />;
  if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-amber-600" />;
  return <Activity className="w-4 h-4 text-muted-foreground" />;
}

export default function PrinterDiagnosticsPage() {
  const { toast } = useToast();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [installed, setInstalled] = useState<any[]>([]);
  const [settings, setSettings] = useState<PrinterSettingsDoc>({ printers: [], deviceAssignments: {} });
  const [printLog, setPrintLog] = useState(() => readPrintLog());
  const [newIp, setNewIp] = useState('');
  const [newPort, setNewPort] = useState('9100');
  const [newName, setNewName] = useState('');

  const electronOk = isElectron();
  const printOk = isElectronPrintAvailable();

  const refreshAll = async () => {
    setRunning(true);
    try {
      const [det, st, rep] = await Promise.all([
        detectInstalledPrinters(),
        loadPrinterSettings(),
        runFullDiagnostic(),
      ]);
      setInstalled(det);
      setSettings(st);
      setReport(rep);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const onLog = () => setPrintLog(readPrintLog());
    window.addEventListener('dtpos-print-log-changed', onLog);
    return () => window.removeEventListener('dtpos-print-log-changed', onLog);
  }, []);

  // ----- Add LAN printer -----
  const addLanPrinter = async () => {
    if (!newIp.trim()) {
      toast({ title: 'Enter IP address', variant: 'destructive' });
      return;
    }
    const ping = await pingPrinter(newIp.trim(), Number(newPort) || 9100);
    if (!ping.ok) {
      toast({ title: 'Cannot reach printer', description: ping.error || 'No response', variant: 'destructive' });
      return;
    }
    const cfg: PrinterConfig = {
      ...defaultPrinterConfig(),
      name: newName.trim() || `LAN ${newIp.trim()}`,
      connection: 'lan',
      lanHost: newIp.trim(),
      lanPort: Number(newPort) || 9100,
      escposMode: true,
    };
    const next = { ...settings, printers: [...settings.printers, cfg] };
    await savePrinterSettings(next);
    setSettings(next);
    setNewIp(''); setNewName(''); setNewPort('9100');
    toast({ title: 'Printer added', description: `${cfg.name} • ${ping.ms}ms` });
  };

  const deletePrinter = async (id: string) => {
    const next = { ...settings, printers: settings.printers.filter((p) => p.id !== id) };
    await savePrinterSettings(next);
    setSettings(next);
  };

  // ----- Auto fixes -----
  const doRestartSpooler = async () => {
    const r = await restartSpooler();
    toast({
      title: r.success ? 'Spooler restarted' : 'Could not restart spooler',
      description: r.error || 'Re-running diagnostic...',
      variant: r.success ? 'default' : 'destructive',
    });
    await refreshAll();
  };
  const doClearQueue = async () => {
    const r = await clearPrintQueue();
    toast({
      title: r.success ? `Cleared ${r.cleared ?? 0} job(s)` : 'Could not clear queue',
      description: r.error,
      variant: r.success ? 'default' : 'destructive',
    });
    await refreshAll();
  };

  // ----- Test prints -----
  const sampleReceiptHtml = useMemo(() => `
    <div class="receipt-print-portal" data-active-print="true" style="font-family: monospace; width: 80mm; padding: 4mm;">
      <div style="text-align:center; font-weight:700;">DT POS — TEST RECEIPT</div>
      <div style="text-align:center; font-size: 11px;">${new Date().toLocaleString()}</div>
      <hr/>
      <div>Sample Item 1 ............. Rs. 250</div>
      <div>Sample Item 2 ............. Rs. 450</div>
      <hr/>
      <div style="text-align:right; font-weight:700;">TOTAL: Rs. 700</div>
      <hr/>
      <div style="text-align:center;">★ If you can read this, printing works ★</div>
    </div>
  `, []);

  const doBrowserPrint = () => {
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    w.document.write(`<html><head><title>Test</title><style>@page{size:80mm auto;margin:0}body{margin:0;padding:0}</style></head><body>${sampleReceiptHtml}</body></html>`);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch {} }, 400);
    appendPrintLog({ printType: 'test', status: 'success', printerName: 'Browser dialog' });
  };

  const doSilentTestPrint = async (label = 'Silent test') => {
    const start = Date.now();
    const r = await electronPrintReceipt({ paperWidth: '80mm' });
    appendPrintLog({
      printType: 'test',
      status: r.success ? 'success' : 'failed',
      error: r.error,
      ms: Date.now() - start,
      printerName: label,
    });
    toast({
      title: r.success ? 'Test print sent' : 'Test print failed',
      description: r.error || `Sent in ${Date.now() - start}ms`,
      variant: r.success ? 'default' : 'destructive',
    });
  };

  const doRawEscposTest = async (cfg: PrinterConfig) => {
    if (!cfg.lanHost) return;
    const bytes = buildEscposFromText('DT POS RAW ESC/POS TEST\n\nIf you see this, ESC/POS works.\n', {
      autoCut: true, beep: cfg.beep, topFeedLines: 0, bottomFeedLines: 3,
    });
    if (!isElectron() || !(window as any).electronAPI?.printLanEscpos) {
      toast({ title: 'Raw ESC/POS only available in Windows EXE', variant: 'destructive' });
      return;
    }
    const r = await (window as any).electronAPI.printLanEscpos({
      host: cfg.lanHost, port: cfg.lanPort || 9100, data: bytes,
    });
    appendPrintLog({
      printType: 'raw',
      status: r.success ? 'success' : 'failed',
      error: r.error,
      printerName: `${cfg.name} (${cfg.lanHost})`,
    });
    toast({
      title: r.success ? 'Raw ESC/POS sent' : 'ESC/POS failed',
      description: r.error,
      variant: r.success ? 'default' : 'destructive',
    });
  };

  // ----- Diagnostic report export -----
  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([formatReportText(report)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dtpos-printer-report-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendToSupport = () => {
    if (!report) return;
    const text = formatReportText(report);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
  };

  const sLast = lastSuccessful();
  const fLast = lastFailed();

  return (
    <div className="container max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Wrench className="w-6 h-6" /> Printer Management & Diagnostic Center
          </h1>
          <p className="text-sm text-muted-foreground">
            Auto-detect, configure, test and troubleshoot every printer — USB, LAN, Shared, Windows or ESC/POS thermal.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={refreshAll} disabled={running} variant="outline">
            <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button onClick={() => doSilentTestPrint('Quick test')} disabled={!printOk}>
            <Printer className="w-4 h-4" /> Quick Silent Test
          </Button>
        </div>
      </div>

      {!electronOk && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="py-3 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
            <div>
              You're in <b>Browser mode</b>. Spooler diagnostics, printer auto-detection, raw ESC/POS, and auto-fixes
              only work in the <b>DT POS Windows app</b>. You can still configure printers and run a browser print dialog test.
            </div>
          </CardContent>
        </Card>
      )}

      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="py-4">
            <div className="text-xs text-muted-foreground">OK Checks</div>
            <div className="text-2xl font-bold text-emerald-600">{report.summary.ok}</div>
          </CardContent></Card>
          <Card><CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Warnings</div>
            <div className="text-2xl font-bold text-amber-600">{report.summary.warn}</div>
          </CardContent></Card>
          <Card><CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Failures</div>
            <div className="text-2xl font-bold text-red-600">{report.summary.fail}</div>
          </CardContent></Card>
          <Card><CardContent className="py-4">
            <div className="text-xs text-muted-foreground">Printers Detected</div>
            <div className="text-2xl font-bold">{installed.length}</div>
          </CardContent></Card>
        </div>
      )}

      <Tabs defaultValue="health" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="health"><ListChecks className="w-4 h-4 mr-1" />Health Check</TabsTrigger>
          <TabsTrigger value="detect"><Printer className="w-4 h-4 mr-1" />Detection</TabsTrigger>
          <TabsTrigger value="network"><Wifi className="w-4 h-4 mr-1" />Network Printer</TabsTrigger>
          <TabsTrigger value="test"><FlaskConical className="w-4 h-4 mr-1" />Test Center</TabsTrigger>
          <TabsTrigger value="wizard"><Wrench className="w-4 h-4 mr-1" />Troubleshooting</TabsTrigger>
          <TabsTrigger value="report"><FileText className="w-4 h-4 mr-1" />Diagnostic Report</TabsTrigger>
          <TabsTrigger value="log"><Activity className="w-4 h-4 mr-1" />Print Log</TabsTrigger>
        </TabsList>

        {/* ===== Health Check ===== */}
        <TabsContent value="health">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ListChecks className="w-5 h-5" /> Printer Health Check</CardTitle>
              <CardDescription>
                {report?.rootCause && <span><b>Root cause:</b> {report.rootCause} — <i>{report.recommendation}</i></span>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!report && <div className="text-sm text-muted-foreground">Running diagnostic…</div>}
              {report?.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-3 p-2 border rounded-md">
                  <StatusDot status={c.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <StatusIcon status={c.status} />{c.label}
                    </div>
                    {c.detail && <div className="text-xs text-muted-foreground mt-0.5">{c.detail}</div>}
                    {c.fix && <div className="text-xs mt-1"><b>Fix:</b> {c.fix}</div>}
                  </div>
                  {c.autoFix === 'restart-spooler' && (
                    <Button size="sm" variant="outline" onClick={doRestartSpooler}>Auto-Fix</Button>
                  )}
                  {c.autoFix === 'clear-queue' && (
                    <Button size="sm" variant="outline" onClick={doClearQueue}>Clear Queue</Button>
                  )}
                  {c.autoFix === 'reconnect-lan' && (
                    <Button size="sm" variant="outline" onClick={refreshAll}>Re-check</Button>
                  )}
                </div>
              ))}
              <div className="flex gap-2 pt-2 flex-wrap">
                <Button variant="outline" onClick={doRestartSpooler}><Server className="w-4 h-4" />Restart Spooler</Button>
                <Button variant="outline" onClick={doClearQueue}><Trash2 className="w-4 h-4" />Clear Print Queue</Button>
                <Button variant="outline" onClick={refreshAll}><RefreshCw className="w-4 h-4" />Re-run all checks</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Detection ===== */}
        <TabsContent value="detect">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Printer className="w-5 h-5" /> Installed Windows Printers</CardTitle>
              <CardDescription>Auto-detected from the Windows print system.</CardDescription>
            </CardHeader>
            <CardContent>
              {installed.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  {electronOk ? 'No printers found in Windows.' : 'Detection only available in Windows EXE.'}
                </div>
              )}
              <div className="grid gap-2">
                {installed.map((p: any, i) => (
                  <div key={i} className="p-3 border rounded-md">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium">{p.name}</div>
                      <div className="flex gap-1">
                        {p.isDefault && <Badge variant="default">Default</Badge>}
                        <Badge variant="outline">{p.status === 0 ? 'Online' : `status ${p.status}`}</Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5">
                      <span><b>Driver:</b> {p.driverName || '—'}</span>
                      <span><b>Port:</b> {p.portName || '—'}</span>
                      <span><b>Display:</b> {p.displayName || p.name}</span>
                      {p.description && <span className="col-span-full"><b>Desc:</b> {p.description}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Network Printer ===== */}
        <TabsContent value="network">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wifi className="w-5 h-5" /> Add Network (LAN) Printer</CardTitle>
              <CardDescription>Enter the printer IP. Most thermal printers use port 9100.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Printer Name</Label>
                  <Input placeholder="Kitchen Printer" value={newName} onChange={(e) => setNewName(e.target.value)} />
                </div>
                <div>
                  <Label>IP Address</Label>
                  <Input placeholder="192.168.1.50" value={newIp} onChange={(e) => setNewIp(e.target.value)} />
                </div>
                <div>
                  <Label>Port</Label>
                  <Input placeholder="9100" value={newPort} onChange={(e) => setNewPort(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={async () => {
                  if (!newIp) return;
                  const r = await pingPrinter(newIp.trim(), Number(newPort) || 9100);
                  toast({
                    title: r.ok ? `Reachable in ${r.ms}ms` : 'Not reachable',
                    description: r.error,
                    variant: r.ok ? 'default' : 'destructive',
                  });
                }}><Plug className="w-4 h-4" />Test Connection</Button>
                <Button onClick={addLanPrinter} variant="default"><CheckCircle2 className="w-4 h-4" />Save Printer</Button>
              </div>

              <div className="pt-4">
                <h3 className="font-medium mb-2">Configured Network Printers</h3>
                {settings.printers.filter((p) => p.connection === 'lan').length === 0 && (
                  <div className="text-sm text-muted-foreground">None yet.</div>
                )}
                <div className="grid gap-2">
                  {settings.printers.filter((p) => p.connection === 'lan').map((p) => (
                    <div key={p.id} className="p-3 border rounded-md flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.lanHost}:{p.lanPort} • {p.role} • {p.paperSize}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={async () => {
                          const r = await pingPrinter(p.lanHost!, p.lanPort || 9100);
                          toast({
                            title: r.ok ? `Ping OK (${r.ms}ms)` : 'Ping failed',
                            description: r.error,
                            variant: r.ok ? 'default' : 'destructive',
                          });
                        }}><Wifi className="w-4 h-4" />Ping</Button>
                        <Button size="sm" variant="outline" onClick={() => doRawEscposTest(p)}>Raw ESC/POS</Button>
                        <Button size="sm" variant="destructive" onClick={() => deletePrinter(p.id)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Test Center ===== */}
        <TabsContent value="test">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Print Test Center</CardTitle>
              <CardDescription>Verify silent print, paper width, and ESC/POS communication.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Button onClick={() => doSilentTestPrint('Test Receipt')} disabled={!printOk}>Print Test Receipt</Button>
                <Button variant="outline" onClick={doBrowserPrint}>Browser Print Dialog</Button>
                <Button variant="outline" onClick={() => doSilentTestPrint('Logo')} disabled={!printOk}>Print Logo</Button>
                <Button variant="outline" onClick={() => doSilentTestPrint('Kitchen Ticket')} disabled={!printOk}>Print Kitchen Ticket</Button>
                <Button variant="outline" onClick={() => doSilentTestPrint('Customer Receipt')} disabled={!printOk}>Print Customer Receipt</Button>
                <Button variant="outline" onClick={() => doSilentTestPrint('QR Test')} disabled={!printOk}>Print QR Test</Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Raw ESC/POS test is available per-printer in the <b>Network Printer</b> tab.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
                <Card className="border-emerald-300/50">
                  <CardContent className="py-3 text-sm">
                    <div className="text-xs text-muted-foreground">Last successful print</div>
                    {sLast ? (
                      <div>
                        <div className="font-medium">{sLast.printType} • {sLast.printerName || '—'}</div>
                        <div className="text-xs text-muted-foreground">{new Date(sLast.at).toLocaleString()}</div>
                      </div>
                    ) : <div className="text-muted-foreground">No successful prints yet.</div>}
                  </CardContent>
                </Card>
                <Card className="border-red-300/50">
                  <CardContent className="py-3 text-sm">
                    <div className="text-xs text-muted-foreground">Last failed print</div>
                    {fLast ? (
                      <div>
                        <div className="font-medium">{fLast.printType} • {fLast.printerName || '—'}</div>
                        <div className="text-xs text-red-600">{fLast.error}</div>
                        <div className="text-xs text-muted-foreground">{new Date(fLast.at).toLocaleString()}</div>
                      </div>
                    ) : <div className="text-muted-foreground">No failures recorded.</div>}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Troubleshooting Wizard ===== */}
        <TabsContent value="wizard">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wrench className="w-5 h-5" /> Troubleshooting Wizard</CardTitle>
              <CardDescription>If printing fails, walk through these steps in order.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                { t: 'Printer Offline', why: 'The printer is powered off or in error state.', fix: 'Power-cycle the printer. Check the status light. Re-run Health Check.' },
                { t: 'Wrong Driver', why: 'Windows is using a non-thermal driver.', fix: 'Install vendor driver, or "Generic / Text Only" for ESC/POS. Re-run detection.' },
                { t: 'Wrong Printer Selected', why: 'A non-receipt printer is set as default.', fix: 'Windows Settings → Printers → set thermal printer as default. Or assign per-role in Printer Settings.' },
                { t: 'USB Disconnected', why: 'USB cable loose or port changed.', fix: 'Re-seat the cable. Try a different USB port. Confirm the printer appears under Devices.' },
                { t: 'LAN Cable Disconnected / IP Changed', why: 'Switch unplugged or DHCP gave a new IP.', fix: 'Re-check IP from printer self-test page. Update the IP under Network Printer tab.' },
                { t: 'Windows Print Spooler Stopped', why: 'Service crashed or was stopped.', fix: 'Use "Restart Spooler" in Health Check. Requires running DT POS as Administrator.' },
                { t: 'Print Queue Blocked', why: 'A stuck job is blocking all new ones.', fix: 'Use "Clear Print Queue". Then retry the print.' },
                { t: 'Invalid Paper Width', why: 'Receipt rendered at 58mm but printer expects 80mm (or vice versa).', fix: 'Open Printer Settings → set correct Paper Size and Margins.' },
                { t: 'Blank Receipt', why: 'HTML rendered empty, or ESC/POS commands rejected.', fix: 'Re-run Diagnostic Report. If "Receipt content empty" appears, the order data is missing; if "ESC/POS timeout" the LAN printer is unreachable.' },
              ].map((step, i) => (
                <div key={i} className="p-3 border rounded-md">
                  <div className="font-medium">{i + 1}. {step.t}</div>
                  <div className="text-xs text-muted-foreground mt-1"><b>Why:</b> {step.why}</div>
                  <div className="text-xs mt-1"><b>Fix:</b> {step.fix}</div>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={refreshAll}><RefreshCw className="w-4 h-4" />Re-run diagnosis</Button>
                <Button onClick={() => doSilentTestPrint('Wizard test')} disabled={!printOk}><Printer className="w-4 h-4" />Try Print Again</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Report ===== */}
        <TabsContent value="report">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Auto Diagnostic Report</CardTitle>
              <CardDescription>Send this report to DT POS support if a problem persists.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Button onClick={refreshAll} variant="outline" disabled={running}>
                  <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />Regenerate
                </Button>
                <Button onClick={downloadReport} disabled={!report}><Download className="w-4 h-4" />Download .txt</Button>
                <Button onClick={sendToSupport} disabled={!report} variant="default">Send via WhatsApp</Button>
              </div>
              <Textarea
                readOnly
                className="font-mono text-xs h-96"
                value={report ? formatReportText(report) : 'Generating…'}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Print Log ===== */}
        <TabsContent value="log">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> Print Log</CardTitle>
              <CardDescription>Last 500 print attempts on this device.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end mb-2">
                <Button size="sm" variant="outline" onClick={() => { clearPrintLog(); setPrintLog([]); }}>
                  <Trash2 className="w-4 h-4" />Clear log
                </Button>
              </div>
              {printLog.length === 0 && <div className="text-sm text-muted-foreground">No prints yet.</div>}
              <div className="space-y-1 max-h-[500px] overflow-auto">
                {printLog.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 p-2 border rounded text-xs">
                    {e.status === 'success'
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      : e.status === 'skipped'
                        ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        : <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{e.printType}{e.stage ? ` (${e.stage})` : ''} • {e.printerName || '—'} {e.billNumber ? `• #${e.billNumber}` : ''}</div>
                      <div className="text-muted-foreground">{new Date(e.at).toLocaleString()} {e.ms ? `• ${e.ms}ms` : ''}</div>
                      {e.error && <div className={e.status === 'skipped' ? 'text-amber-600' : 'text-red-600'}>{e.error}</div>}
                    </div>
                  </div>
                ))}

              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground flex items-center gap-2">
          <Settings2 className="w-4 h-4" />
          For paper size, margins, role assignment (Counter / Kitchen / Delivery / Bar / Bakery / Reports), auto-cut and cash drawer settings, open <b>Printer Settings</b>.
        </CardContent>
      </Card>
    </div>
  );
}
