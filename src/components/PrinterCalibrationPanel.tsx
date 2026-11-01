// ============================================================
// Printer Calibration Panel
// Dedicated screen to fine-tune Left / Right / Top / Bottom
// offsets (mm) per configured printer. Values persist via
// savePrinterSettings() so a saved calibration NEVER breaks
// after other changes — each printer keeps its own numbers.
//
// - +/- nudge buttons (0.5 mm) for precise tuning
// - Negative values allowed (physical offset counter-adjust)
// - Live "Test Print" uses the SAME thermal CSS as real receipts
// - Save per printer OR Save All at once
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Ruler, Save, TestTube, RotateCcw, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  loadPrinterSettings,
  savePrinterSettings,
  subscribePrinterSettings,
  DEFAULT_SIDE_MARGIN_MM,
  type PrinterConfig,
  type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import { isElectron, printReceiptNative } from '@/lib/electron';
import {
  beginThermalPrintDomSession,
  waitForThermalPrintLayout,
} from '@/lib/thermal-print';

type Offsets = Pick<PrinterConfig, 'leftMarginMm' | 'rightMarginMm' | 'topFeedMm' | 'bottomFeedMm'>;

// Equal by default. This panel shipped seeding 3mm left against 10mm right,
// which is the lopsided slip the client reported — configured, not computed.
// A hand-tuned calibration is still honoured; only the starting point is even.
const DEFAULT_OFFSETS: Offsets = {
  leftMarginMm: DEFAULT_SIDE_MARGIN_MM,
  rightMarginMm: DEFAULT_SIDE_MARGIN_MM,
  topFeedMm: 0,
  bottomFeedMm: 0,
};

export default function PrinterCalibrationPanel() {
  const [settings, setSettings] = useState<PrinterSettingsDoc>({ printers: [], deviceAssignments: {} });
  // Draft per printer id — only committed on Save.
  const [drafts, setDrafts] = useState<Record<string, Offsets>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    loadPrinterSettings().then((s) => {
      setSettings(s);
      setDrafts(buildDrafts(s.printers));
    });
    const unsub = subscribePrinterSettings((s) => {
      setSettings(s);
      // Only seed drafts for printers we don't already have a draft for,
      // so in-progress calibration isn't clobbered by cloud sync.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const p of s.printers) {
          if (!next[p.id]) next[p.id] = pickOffsets(p);
        }
        // drop drafts for removed printers
        for (const id of Object.keys(next)) {
          if (!s.printers.find((p) => p.id === id)) delete next[id];
        }
        return next;
      });
    });
    return () => unsub();
  }, []);

  function buildDrafts(printers: PrinterConfig[]): Record<string, Offsets> {
    const out: Record<string, Offsets> = {};
    for (const p of printers) out[p.id] = pickOffsets(p);
    return out;
  }
  function pickOffsets(p: PrinterConfig): Offsets {
    return {
      leftMarginMm: p.leftMarginMm ?? 0,
      rightMarginMm: p.rightMarginMm ?? 0,
      topFeedMm: p.topFeedMm ?? 0,
      bottomFeedMm: p.bottomFeedMm ?? 0,
    };
  }

  function clamp(n: number) {
    if (!Number.isFinite(n)) return 0;
    if (n < -100) return -100;
    if (n > 100) return 100;
    return Math.round(n * 10) / 10;
  }

  function setField(id: string, key: keyof Offsets, val: number) {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || DEFAULT_OFFSETS), [key]: clamp(val) } }));
  }
  function nudge(id: string, key: keyof Offsets, delta: number) {
    const cur = drafts[id]?.[key] ?? 0;
    setField(id, key, cur + delta);
  }
  function resetDraft(id: string) {
    setDrafts((d) => ({ ...d, [id]: { ...DEFAULT_OFFSETS } }));
    toast.info('Draft reset to defaults (save to apply)');
  }

  async function saveOne(p: PrinterConfig) {
    const draft = drafts[p.id] || pickOffsets(p);
    setSaving(p.id);
    try {
      const next: PrinterSettingsDoc = {
        ...settings,
        printers: settings.printers.map((x) => (x.id === p.id ? { ...x, ...draft } : x)),
      };
      await savePrinterSettings(next);
      setSettings(next);
      toast.success(`Calibration saved for ${p.name}`);
    } catch (e: any) {
      toast.error('Save failed: ' + (e?.message || e));
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    setSaving('__all__');
    try {
      const next: PrinterSettingsDoc = {
        ...settings,
        printers: settings.printers.map((x) => ({ ...x, ...(drafts[x.id] || pickOffsets(x)) })),
      };
      await savePrinterSettings(next);
      setSettings(next);
      toast.success('All printer calibrations saved');
    } catch (e: any) {
      toast.error('Save failed: ' + (e?.message || e));
    } finally {
      setSaving(null);
    }
  }

  /** Prints a small test receipt using the draft offsets so the user can
   *  visually confirm alignment BEFORE saving. */
  async function testWithDraft(p: PrinterConfig) {
    if (!isElectron()) {
      toast.error('Test print only works in the Windows EXE app');
      return;
    }
    if (p.connection === 'system' && !p.printerName) {
      toast.error('Select a Windows printer first');
      return;
    }
    const d = drafts[p.id] || pickOffsets(p);
    const portal = document.createElement('div');
    portal.className = 'receipt-print-portal';
    portal.setAttribute('data-active-print', 'true');
    portal.style.cssText = `position:fixed;left:0;top:0;width:${p.paperSize};background:#fff;z-index:99999;`;
    portal.innerHTML = `
      <div class="print-receipt receipt-root" data-paper-size="${p.paperSize}" style="font-family:'Courier New',monospace;font-size:13px;font-weight:700;color:#000;background:#fff;">
        <div style="text-align:center;font-weight:900;font-size:14px;">*** CALIBRATION TEST ***</div>
        <div style="text-align:center;">${p.name}</div>
        <div style="text-align:center;">L:${d.leftMarginMm} R:${d.rightMarginMm} T:${d.topFeedMm} B:${d.bottomFeedMm} mm</div>
        <div style="border-top:1px dashed #000;margin:4px 0;"></div>
        <div>|&lt;-------- LEFT edge check --------</div>
        <div style="text-align:right;">RIGHT edge check --------&gt;|</div>
        <div style="border-top:1px dashed #000;margin:4px 0;"></div>
        <div style="text-align:center;">${new Date().toLocaleTimeString()}</div>
      </div>`;
    document.body.appendChild(portal);
    const root = portal.querySelector('.print-receipt') as HTMLElement | null;
    if (root) {
      root.style.setProperty('--dt-print-padding-top', `${Math.max(0, d.topFeedMm)}mm`);
      root.style.setProperty('--dt-print-padding-right', `${Math.max(0, d.rightMarginMm)}mm`);
      root.style.setProperty('--dt-print-padding-bottom', `${Math.max(0, d.bottomFeedMm)}mm`);
      root.style.setProperty('--dt-print-padding-left', `${Math.max(0, d.leftMarginMm)}mm`);
      root.style.setProperty('--dt-print-offset-top', `${Math.min(0, d.topFeedMm)}mm`);
      root.style.setProperty('--dt-print-offset-left', `${Math.min(0, d.leftMarginMm)}mm`);
      root.style.setProperty('--dt-print-offset-right', `${Math.min(0, d.rightMarginMm)}mm`);
      root.style.setProperty('--dt-print-offset-bottom', `${Math.min(0, d.bottomFeedMm)}mm`);
      if (p.printWidthMm) root.style.setProperty('--dt-print-content-width', `${p.printWidthMm}mm`);
    }
    const cleanup = beginThermalPrintDomSession(root, p.paperSize, undefined, undefined as any);
    await waitForThermalPrintLayout();
    await new Promise((r) => setTimeout(r, 300)); // render settle (blank-print fix)
    try {
      const res = await printReceiptNative({
        printerName: p.printerName,
        silent: true,
        usePrinterDefaultPageSize: true,
        autoCut: p.autoCut,
        paperLabel: p.paperSize,
        topFeedMm: d.topFeedMm,
        bottomFeedMm: d.bottomFeedMm,
        leftMarginMm: d.leftMarginMm,
        rightMarginMm: d.rightMarginMm,
      });
      if (res.success) toast.success('Test print sent ✓ — check alignment');
      else toast.error('Print fail: ' + (res.error || 'unknown'));
    } finally {
      cleanup();
      setTimeout(() => portal.remove(), 800);
    }
  }

  const dirty = (p: PrinterConfig) => {
    const d = drafts[p.id]; if (!d) return false;
    return d.leftMarginMm !== p.leftMarginMm || d.rightMarginMm !== p.rightMarginMm
      || d.topFeedMm !== p.topFeedMm || d.bottomFeedMm !== p.bottomFeedMm;
  };
  const anyDirty = settings.printers.some(dirty);

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Ruler className="h-5 w-5" /> Margin Calibration (per printer)
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Left / Right / Top / Bottom offsets (mm) are saved separately for each printer.
            Negative values are also allowed (to counter-adjust the driver's extra feed).
            <b> Save </b> writes the settings permanently — future changes won't break the calibration.
          </p>
        </div>
        <Button onClick={saveAll} disabled={!anyDirty || saving === '__all__'}>
          <Save className="h-4 w-4 mr-1" /> {saving === '__all__' ? 'Saving…' : 'Save All'}
        </Button>
      </div>

      {settings.printers.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center border rounded">
          No printers configured yet. Add a printer below, then return here to calibrate.
        </p>
      )}

      <div className="space-y-3">
        {settings.printers.map((p) => {
          const d = drafts[p.id] || pickOffsets(p);
          const isDirty = dirty(p);
          return (
            <Card key={p.id} className={`p-4 border-2 ${isDirty ? 'border-primary/60' : ''}`}>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <div className="font-semibold">{p.name} <span className="text-xs text-muted-foreground">({p.role} · {p.paperSize})</span></div>
                  <div className="text-xs text-muted-foreground">
                    {p.connection === 'lan'
                      ? `LAN ${p.lanHost || '—'}:${p.lanPort || 9100}`
                      : (p.printerName || '— no printer selected —')}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => resetDraft(p.id)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => testWithDraft(p)}>
                    <TestTube className="h-3.5 w-3.5 mr-1" /> Test
                  </Button>
                  <Button size="sm" onClick={() => saveOne(p)} disabled={!isDirty || saving === p.id}>
                    <Save className="h-3.5 w-3.5 mr-1" /> {saving === p.id ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NudgeField label="Left (mm)"   v={d.leftMarginMm}
                  onChange={(n) => setField(p.id, 'leftMarginMm', n)}
                  onNudge={(dl) => nudge(p.id, 'leftMarginMm', dl)} />
                <NudgeField label="Right (mm)"  v={d.rightMarginMm}
                  onChange={(n) => setField(p.id, 'rightMarginMm', n)}
                  onNudge={(dl) => nudge(p.id, 'rightMarginMm', dl)} />
                <NudgeField label="Top (mm)"    v={d.topFeedMm}
                  onChange={(n) => setField(p.id, 'topFeedMm', n)}
                  onNudge={(dl) => nudge(p.id, 'topFeedMm', dl)} />
                <NudgeField label="Bottom (mm)" v={d.bottomFeedMm}
                  onChange={(n) => setField(p.id, 'bottomFeedMm', n)}
                  onNudge={(dl) => nudge(p.id, 'bottomFeedMm', dl)} />
              </div>

              {isDirty && (
                <p className="text-xs text-primary mt-2">
                  ⚠️ Unsaved changes — click <b>Save</b> to persist this printer's calibration.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tip: Test-print a short receipt, see which side is cut/blank, then nudge that value by 0.5–1 mm and test again.
        Once the alignment is perfect — press <b>Save</b>. Values are saved with the printer in both cloud and local.
      </p>
    </Card>
  );
}

function NudgeField({ label, v, onChange, onNudge }: {
  label: string; v: number; onChange: (n: number) => void; onNudge: (delta: number) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1 mt-1">
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => onNudge(-0.5)}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Input
          type="number" min={-100} max={100} step={0.5} value={v}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="h-8 text-center"
        />
        <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => onNudge(0.5)}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
