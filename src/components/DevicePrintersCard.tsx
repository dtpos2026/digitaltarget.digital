// ============================================================
// Device Printers Card — PER-PC (local) printer configuration.
//
// Sirf iss PC ke liye printer selection, margins, silent print,
// paper size etc. save karta hai. Firebase me kuch save NAHI hota,
// isliye multi-device setups me har PC apna printer set kar sakta hai
// bina doosre PCs ki printing tootne ke.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Printer, RefreshCw, Save, TestTube, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import {
  getLocalPrinterSettings, saveLocalPrinterSettings, listInstalledPrinters,
  isDesktopApp, type LocalPrinterSettings, type LocalPrinterConfig, type LocalPaperSize,
} from '@/lib/localPrinterSettings';
import { getDeviceId } from '@/lib/tenant';
import { printReceiptNative, isElectron } from '@/lib/electron';

const ROLE_LABEL: Record<'receipt' | 'kot' | 'rider', string> = {
  receipt: 'Customer Receipt Printer',
  kot: 'Kitchen (KOT) Printer',
  rider: 'Delivery / Rider Printer',
};

export default function DevicePrintersCard() {
  const [settings, setSettings] = useState<LocalPrinterSettings>(() => getLocalPrinterSettings());
  const [installed, setInstalled] = useState<{ name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const deviceId = getDeviceId();

  useEffect(() => { refreshPrinters(); }, []);

  async function refreshPrinters() {
    const list = await listInstalledPrinters();
    setInstalled(list);
  }

  function update(role: 'receipt' | 'kot' | 'rider', patch: Partial<LocalPrinterConfig>) {
    setSettings(s => {
      const cur = (s[role] as LocalPrinterConfig | undefined) || {
        printerName: '', paperSize: '80mm', leftMarginMm: 3, rightMarginMm: 3,
        topMarginMm: 0, bottomMarginMm: 0, feedLines: 3, autoCut: true, copies: 1, enabled: true,
      };
      return { ...s, [role]: { ...cur, ...patch } } as LocalPrinterSettings;
    });
  }

  function save() {
    setSaving(true);
    try {
      saveLocalPrinterSettings(settings);
      toast.success('Device printer settings saved (this PC only)');
    } finally { setSaving(false); }
  }

  async function testPrint(role: 'receipt' | 'kot' | 'rider') {
    const cfg = settings[role];
    if (!cfg?.printerName) { toast.error('Please select a printer first'); return; }
    if (!isElectron()) { toast.info('Test print only works in the Windows app'); return; }
    // Check printer still installed
    const stillThere = installed.some(p => p.name === cfg.printerName);
    if (!stillThere) {
      toast.error(`Selected printer "${cfg.printerName}" not found on this device. Please select printer again.`);
      return;
    }
    try {
      const res = await printReceiptNative({
        printerName: cfg.printerName,
        silent: settings.silentPrint,
        copies: cfg.copies || 1,
      } as any);
      if (res?.success) toast.success('Test print sent');
      else toast.error(res?.error || 'Test print failed');
    } catch (e: any) {
      toast.error(e?.message || 'Test print failed');
    }
  }

  const renderRow = (role: 'receipt' | 'kot' | 'rider') => {
    const cfg = (settings[role] as LocalPrinterConfig | undefined);
    if (!cfg) return null;
    return (
      <div key={role} className="border rounded-lg p-3 space-y-3 bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <Printer className="h-4 w-4" />
            <span>{ROLE_LABEL[role]}</span>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Enabled</Label>
            <Switch checked={cfg.enabled} onCheckedChange={(v) => update(role, { enabled: v })} />
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Printer</Label>
            {installed.length > 0 ? (
              <Select value={cfg.printerName} onValueChange={(v) => update(role, { printerName: v })}>
                <SelectTrigger><SelectValue placeholder="Select installed printer" /></SelectTrigger>
                <SelectContent>
                  {installed.map(p => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={cfg.printerName}
                onChange={(e) => update(role, { printerName: e.target.value })}
                placeholder="e.g. EPSON TM-T20 Receipt"
              />
            )}
          </div>
          <div>
            <Label className="text-xs">Paper size</Label>
            <Select value={cfg.paperSize} onValueChange={(v: LocalPaperSize) => update(role, { paperSize: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="58mm">58 mm</SelectItem>
                <SelectItem value="80mm">80 mm</SelectItem>
                <SelectItem value="A4">A4</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div><Label className="text-xs">Left mm</Label><Input type="number" value={cfg.leftMarginMm} onChange={(e) => update(role, { leftMarginMm: Number(e.target.value) || 0 })} /></div>
          <div><Label className="text-xs">Right mm</Label><Input type="number" value={cfg.rightMarginMm} onChange={(e) => update(role, { rightMarginMm: Number(e.target.value) || 0 })} /></div>
          <div><Label className="text-xs">Top mm</Label><Input type="number" value={cfg.topMarginMm} onChange={(e) => update(role, { topMarginMm: Number(e.target.value) || 0 })} /></div>
          <div><Label className="text-xs">Bottom mm</Label><Input type="number" value={cfg.bottomMarginMm} onChange={(e) => update(role, { bottomMarginMm: Number(e.target.value) || 0 })} /></div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <div><Label className="text-xs">Feed lines</Label><Input type="number" value={cfg.feedLines} onChange={(e) => update(role, { feedLines: Number(e.target.value) || 0 })} /></div>
          <div><Label className="text-xs">Copies</Label><Input type="number" min={1} value={cfg.copies} onChange={(e) => update(role, { copies: Math.max(1, Number(e.target.value) || 1) })} /></div>
          <div className="flex items-center gap-2 pb-2"><Switch checked={cfg.autoCut} onCheckedChange={(v) => update(role, { autoCut: v })} /><Label className="text-xs">Auto cut</Label></div>
          <Button size="sm" variant="outline" onClick={() => testPrint(role)}><TestTube className="h-3.5 w-3.5 mr-1" />Test print</Button>
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-base">
            <Monitor className="h-4 w-4" /> Device Printers (This PC only)
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            These settings are saved locally on this device. They are NOT synced to other PCs, so each cashier can choose their own installed printer.
            <br />Device ID: <code className="text-[10px]">{deviceId}</code>
            {!isDesktopApp() && <span className="ml-2 text-amber-600">(Browser mode — silent print requires the Windows app)</span>}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refreshPrinters}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3 p-2 rounded border bg-primary/5">
        <Switch checked={settings.silentPrint} onCheckedChange={(v) => setSettings(s => ({ ...s, silentPrint: v }))} />
        <div>
          <div className="text-sm font-medium">Silent print (Windows app)</div>
          <div className="text-xs text-muted-foreground">No preview / no browser dialog. Prints directly to the selected printer.</div>
        </div>
      </div>

      {renderRow('receipt')}
      {renderRow('kot')}
      {renderRow('rider')}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-2" /> Save device settings
        </Button>
      </div>
    </Card>
  );
}
