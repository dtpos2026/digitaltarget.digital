// ============================================================
// Print Margins Card — device-local. User can tune top/right/
// bottom/left padding from 0 mm upward per machine/printer.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  loadPrintMargins, savePrintMargins, resetPrintMargins,
  DEFAULT_MARGINS, type PrintMargins,
} from '@/lib/printMargins';

export default function PrintMarginsCard() {
  const [m, setM] = useState<PrintMargins>(() => loadPrintMargins());

  useEffect(() => {
    const onChange = () => setM(loadPrintMargins());
    window.addEventListener('dtpos-print-margins-changed', onChange);
    return () => window.removeEventListener('dtpos-print-margins-changed', onChange);
  }, []);

  const upd = (k: keyof PrintMargins, v: string) => {
    const n = parseFloat(v);
    setM(prev => ({ ...prev, [k]: Number.isFinite(n) ? n : 0 }));
  };

  const setWidth = (mm: number) => {
    const next = { ...m, contentWidthMm: mm };
    setM(next);
    savePrintMargins(next);
    toast.success(mm ? `Printable width set to ${mm}mm` : 'Printable width: Auto (full paper)');
  };

  const handleSave = () => {
    savePrintMargins(m);
    toast.success('Print margins saved (is device par)');
  };
  const handleReset = () => {
    resetPrintMargins();
    setM({ ...DEFAULT_MARGINS });
    toast.success('Default margins restored');
  };

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Print Margins (mm)</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Gap from paper edges for Receipt and KOT printing. 0 = right up to the edge. A negative value shifts the content to the opposite side.
          This setting applies <b>only on this device</b> — each machine can tune its own printer.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Top</Label>
          <Input type="number" min={-100} max={100} step={0.5}
            value={m.top} onChange={e => upd('top', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Right</Label>
          <Input type="number" min={-100} max={100} step={0.5}
            value={m.right} onChange={e => upd('right', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Bottom</Label>
          <Input type="number" min={-100} max={100} step={0.5}
            value={m.bottom} onChange={e => upd('bottom', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Left</Label>
          <Input type="number" min={-100} max={100} step={0.5}
            value={m.left} onChange={e => upd('left', e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave}>Save Margins</Button>
        <Button variant="outline" onClick={handleReset}>Reset (4mm equal)</Button>
        <Button variant="outline" onClick={() => { const z = { top: 0, right: 0, bottom: 0, left: 0, contentWidthMm: m.contentWidthMm ?? 0 }; setM(z); savePrintMargins(z); toast.success('All margins set to 0'); }}>
          Set All 0
        </Button>
        <Button variant="outline" onClick={() => { const v = { top: 0, right: 2, bottom: 0, left: 2, contentWidthMm: m.contentWidthMm ?? 0 }; setM(v); savePrintMargins(v); toast.success('Equal 2mm both sides'); }}>
          Equal 2mm
        </Button>
      </div>

      <div className="pt-3 border-t space-y-2">
        <div>
          <Label className="text-xs font-semibold">Printable Width (mm) — universal right-cut fix</Label>
          <p className="text-[11px] text-muted-foreground mt-1">
            Every printer's printable area is different. Choose the width according to your printer here —
            the receipt will print centered and the right side won't be cut off. <b>Auto</b> = full paper width.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { l: 'Auto', v: 0 },
            { l: '48mm (58 paper)', v: 48 },
            { l: '58mm', v: 58 },
            { l: '64mm', v: 64 },
            { l: '68mm (80 paper)', v: 68 },
            { l: '72mm', v: 72 },
          ].map(o => (
            <Button key={o.v} size="sm"
              variant={((m.contentWidthMm ?? 0) === o.v) ? 'default' : 'outline'}
              onClick={() => setWidth(o.v)}>{o.l}</Button>
          ))}
          <div className="flex items-center gap-2">
            <Label className="text-xs">Custom</Label>
            <Input type="number" min={0} max={110} step={0.5} className="w-24"
              value={m.contentWidthMm ?? 0}
              onChange={e => upd('contentWidthMm', e.target.value)}
              onBlur={() => savePrintMargins(m)} />
            <span className="text-xs text-muted-foreground">mm</span>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tip: If there is 3–4 inch of blank space from the top, set the printer driver paper size to “80mm continuous/receipt”; if needed, test with a negative Top value (-10, -20…).
      </p>
    </Card>
  );
}
