// ============================================================
// PER-SLIP MARGIN SETTLEMENT
//
// One margin pair per KIND of slip, because the slips are cut and handled
// differently: a KOT is torn off and spiked, a bill is handed over, a token
// goes in a pocket. The right margin that squares a KOT on the spike is not
// the one that centres a bill.
//
// Every field starts EMPTY, meaning inherit. An empty field changes nothing —
// the printer's own calibration and then the device default still apply, so
// an untouched installation prints exactly as it did before this card
// existed. Only a number the shop types actually overrides anything.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Rows3, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  SLIP_KINDS,
  loadSlipMargins,
  saveSlipMargins,
  type SlipMarginMap,
  type SlipKind,
} from '@/lib/slipMargins';
import { loadPrintMargins } from '@/lib/printMargins';

/** '' means inherit; anything else is a number the shop typed. */
type Draft = Record<SlipKind, { left: string; right: string }>;

function toDraft(map: SlipMarginMap): Draft {
  const d = {} as Draft;
  for (const { kind } of SLIP_KINDS) {
    const m = map[kind] || {};
    d[kind] = {
      left: m.left === undefined ? '' : String(m.left),
      right: m.right === undefined ? '' : String(m.right),
    };
  }
  return d;
}

export default function SlipMarginsCard() {
  const [draft, setDraft] = useState<Draft>(() => toDraft({}));
  const [dirty, setDirty] = useState(false);
  const device = loadPrintMargins();

  useEffect(() => { setDraft(toDraft(loadSlipMargins())); }, []);

  const set = (kind: SlipKind, side: 'left' | 'right', value: string) => {
    setDraft(prev => ({ ...prev, [kind]: { ...prev[kind], [side]: value } }));
    setDirty(true);
  };

  const nudge = (kind: SlipKind, side: 'left' | 'right', delta: number) => {
    setDraft(prev => {
      const current = Number(prev[kind][side]);
      const base = Number.isFinite(current) && prev[kind][side] !== ''
        ? current
        : (side === 'left' ? device.left : device.right);
      const next = Math.max(0, Math.min(20, Math.round((base + delta) * 10) / 10));
      return { ...prev, [kind]: { ...prev[kind], [side]: String(next) } };
    });
    setDirty(true);
  };

  const save = () => {
    const map: SlipMarginMap = {};
    for (const { kind } of SLIP_KINDS) {
      const l = draft[kind].left.trim();
      const r = draft[kind].right.trim();
      if (l === '' && r === '') continue;
      map[kind] = {
        left: l === '' ? undefined : Number(l),
        right: r === '' ? undefined : Number(r),
      };
    }
    saveSlipMargins(map);
    setDraft(toDraft(loadSlipMargins()));
    setDirty(false);
    toast.success('Slip margins saved. Print one of each to confirm on paper.');
  };

  const clearAll = () => {
    saveSlipMargins({});
    setDraft(toDraft({}));
    setDirty(false);
    toast.success('All slip margins set back to inherit.');
  };

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Rows3 className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-lg font-semibold">Print Margin Settlement</h3>
          <p className="text-xs text-muted-foreground mt-1">
            A separate left/right margin for each kind of slip. Leave a field
            <b> empty to inherit</b> — the printer's own calibration, then this
            device's margins ({device.left}&nbsp;/&nbsp;{device.right}&nbsp;mm).
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {SLIP_KINDS.map(({ kind, label, hint }) => (
          <div key={kind} className="rounded-md border p-3 space-y-2">
            <div>
              <Label className="text-sm font-medium">{label}</Label>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['left', 'right'] as const).map(side => (
                <div key={side} className="space-y-1">
                  <Label className="text-xs capitalize">{side} margin (mm)</Label>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="outline" className="h-8 px-2"
                      onClick={() => nudge(kind, side, -0.5)}>−</Button>
                    <Input
                      type="number" min={0} max={20} step={0.5}
                      placeholder="inherit"
                      value={draft[kind][side]}
                      onChange={e => set(kind, side, e.target.value)}
                      className="h-8 text-center"
                    />
                    <Button type="button" size="sm" variant="outline" className="h-8 px-2"
                      onClick={() => nudge(kind, side, 0.5)}>+</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={!dirty}>
          <Save className="h-4 w-4 mr-1" /> Save margins
        </Button>
        <Button variant="outline" onClick={clearAll}>
          <RotateCcw className="h-4 w-4 mr-1" /> Reset all to inherit
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        On an 80&nbsp;mm roll the head can only mark the middle ~72&nbsp;mm, so
        about 4&nbsp;mm of each edge is blank paper no setting can print on.
        A margin here is added <i>on top of</i> that.
      </p>
    </Card>
  );
}
