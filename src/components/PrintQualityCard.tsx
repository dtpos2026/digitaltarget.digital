// ============================================================
// Print Quality Card — device-local. Controls how dark/sharp the
// thermal raster print comes out. Templates/design are untouched.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import {
  loadPrintQuality, savePrintQuality, resetPrintQuality, WEIGHT_LABELS,
  type PrintQuality, type TextWeight,
} from '@/lib/printQuality';

export default function PrintQualityCard() {
  const [q, setQ] = useState<PrintQuality>(() => loadPrintQuality());

  useEffect(() => {
    const onChange = () => setQ(loadPrintQuality());
    window.addEventListener('dtpos-print-quality-changed', onChange);
    return () => window.removeEventListener('dtpos-print-quality-changed', onChange);
  }, []);

  const manual = q.mode === 'manual';

  const save = (next: PrintQuality) => {
    setQ(next);
    savePrintQuality(next);
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Print Quality</h3>
        <p className="text-sm text-muted-foreground">
          How heavy, dark and sharp slips print on this computer. Templates and layout are not changed.
        </p>
      </div>

      <div className="space-y-2" data-testid="text-weight">
        <Label className="font-medium">Text weight</Label>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(WEIGHT_LABELS) as TextWeight[]).map(w => (
            <Button key={w} type="button" size="sm" variant={q.weight === w ? 'default' : 'outline'}
                    onClick={() => { save({ ...q, weight: w }); toast.success(`Text weight: ${WEIGHT_LABELS[w].label}`); }}>
              {WEIGHT_LABELS[w].label}{w === 'standard' ? ' ✓' : ''}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{WEIGHT_LABELS[q.weight].hint}</p>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <Label className="font-medium">Manual adjust</Label>
          <p className="text-xs text-muted-foreground">Off = Auto: darkness and boldness follow the text weight above, at high resolution.</p>
        </div>
        <Switch
          checked={manual}
          onCheckedChange={(on) => save({ ...q, mode: on ? 'manual' : 'auto' })}
        />
      </div>

      <div className={manual ? 'space-y-5' : 'space-y-5 opacity-50 pointer-events-none'}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Darkness</Label>
            <span className="text-sm font-medium tabular-nums">{q.darkness} / 10</span>
          </div>
          <Slider
            value={[q.darkness]}
            min={1}
            max={10}
            step={1}
            onValueChange={([v]) => setQ({ ...q, darkness: v })}
            onValueCommit={([v]) => save({ ...q, darkness: v })}
          />
          <p className="text-xs text-muted-foreground">Light (1) — Dark (10)</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Resolution</Label>
            <span className="text-sm font-medium tabular-nums">{q.scale}x</span>
          </div>
          <Slider
            value={[q.scale]}
            min={1}
            max={3}
            step={1}
            onValueChange={([v]) => setQ({ ...q, scale: v })}
            onValueCommit={([v]) => save({ ...q, scale: v })}
          />
          <p className="text-xs text-muted-foreground">2x recommended — the sharpest small text.</p>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label className="font-medium">Thicken strokes</Label>
            <p className="text-xs text-muted-foreground">Adds one dot to every stroke — only for a faint printer.</p>
          </div>
          <Switch checked={q.bold} onCheckedChange={(on) => save({ ...q, bold: on })} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={() => { resetPrintQuality(); toast.success('Print quality reset to Auto, Standard weight'); }}
        >
          Reset to Auto (Standard)
        </Button>
      </div>
    </Card>
  );
}
