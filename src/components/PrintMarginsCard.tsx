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
          Gap from the paper edges for receipt and KOT printing. 0 = right to the edge.
          This setting applies <b>to this device only</b> — each machine can tune its own printer.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs">Top</Label>
          <Input type="number" min={0} max={30} step={0.5}
            value={m.top} onChange={e => upd('top', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Right</Label>
          <Input type="number" min={0} max={30} step={0.5}
            value={m.right} onChange={e => upd('right', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Bottom</Label>
          <Input type="number" min={0} max={30} step={0.5}
            value={m.bottom} onChange={e => upd('bottom', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Left</Label>
          <Input type="number" min={0} max={30} step={0.5}
            value={m.left} onChange={e => upd('left', e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave}>Save Margins</Button>
        <Button variant="outline" onClick={handleReset}>Reset (4mm equal)</Button>
        <Button variant="outline" onClick={() => { const z = { top: 0, right: 0, bottom: 0, left: 0 }; setM(z); savePrintMargins(z); toast.success('All margins set to 0'); }}>
          Set All 0
        </Button>
        <Button variant="outline" onClick={() => { const v = { top: 0, right: 2, bottom: 0, left: 2 }; setM(v); savePrintMargins(v); toast.success('Equal 2mm both sides'); }}>
          Equal 2mm
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Tip: if content is cut off on the right, increase the right margin.
        If you want both sides equal, use "Set All 0" ya "Equal 2mm" .
      </p>
    </Card>
  );
}
