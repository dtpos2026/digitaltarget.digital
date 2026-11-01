// "Customize" panel of the Advanced floor view: tile size, what a tile shows, the colour of every state,
// the over-time limit — with a live strip of sample tiles so the effect is visible while you change it.
import { RotateCcw } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_FLOOR_SETTINGS, FLOOR_PALETTES, FLOOR_STATES, FLOOR_STATE_HINT, FLOOR_STATE_LABEL, stateColour,
  type FloorPalette, type FloorSettings, type FloorState,
} from '@/lib/floorAdvanced';
import FloorTile, { type FloorTileData } from './FloorTile';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: FloorSettings;
  onChange: (next: FloorSettings) => void;
}

const SAMPLE: FloorTileData[] = [
  { id: 's1', name: '07', seats: 4, shape: 'square', state: 'available', minutes: null, guests: null, amount: null },
  { id: 's2', name: '12', seats: 4, shape: 'round', state: 'ordered', minutes: 24, guests: 3, orderNumber: 41, amount: 3850 },
  { id: 's3', name: '03', seats: 6, shape: 'rectangle', state: 'overtime', minutes: 112, guests: 5, orderNumber: 38, amount: 9200 },
  { id: 's4', name: '09', seats: 2, shape: 'square', state: 'pending-payment', minutes: 63, guests: 2, orderNumber: 40, amount: 2100 },
];

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{label}</span>
        {hint && <span className="block text-[11.5px] text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

export default function FloorSettingsSheet({ open, onOpenChange, settings, onChange }: Props) {
  const set = <K extends keyof FloorSettings>(k: K, v: FloorSettings[K]) => onChange({ ...settings, [k]: v });
  const setColour = (s: FloorState, hex: string) => onChange({ ...settings, colors: { ...settings.colors, [s]: hex } });
  const clearColour = (s: FloorState) => {
    const colors = { ...settings.colors };
    delete colors[s];
    onChange({ ...settings, colors });
  };
  const customCount = Object.keys(settings.colors).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="floor-settings">
        <SheetHeader>
          <SheetTitle>Customize the floor view</SheetTitle>
          <SheetDescription>These choices are kept on this device. They change how tables look, never the tables themselves.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 rounded-xl border bg-muted/30 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Preview</div>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1" data-testid="floor-settings-preview">
            {SAMPLE.map(s => <FloorTile key={s.id} data={s} settings={settings} inline />)}
          </div>
        </div>

        <section className="mt-5">
          <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">Size</h3>
          <div className="mt-3">
            <div className="mb-2 flex justify-between text-[13px] font-semibold"><span>Table size</span><span className="tabular-nums text-muted-foreground">{settings.tileSize}px</span></div>
            <Slider min={72} max={140} step={4} value={[settings.tileSize]} onValueChange={([v]) => set('tileSize', v)} aria-label="Table size" />
          </div>
          <div className="mt-4">
            <div className="mb-2 flex justify-between text-[13px] font-semibold"><span>Over-time after</span><span className="tabular-nums text-muted-foreground">{settings.overtimeMinutes} min</span></div>
            <Slider min={15} max={240} step={5} value={[Math.min(240, settings.overtimeMinutes)]} onValueChange={([v]) => set('overtimeMinutes', v)} aria-label="Over-time limit in minutes" />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">A seated table turns “Over time” once guests have been there this long.</p>
          </div>
        </section>

        <section className="mt-5 divide-y">
          <h3 className="pb-2 text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">On each table</h3>
          <Toggle label="Time seated" checked={settings.showTimer} onChange={v => set('showTimer', v)} />
          <Toggle label="Guests" hint="Guests seated / chairs" checked={settings.showGuests} onChange={v => set('showGuests', v)} />
          <Toggle label="Open bill" hint="Bill number and amount under the table" checked={settings.showAmount} onChange={v => set('showAmount', v)} />
          <Toggle label="Chairs" checked={settings.showChairs} onChange={v => set('showChairs', v)} />
        </section>

        <section className="mt-5 divide-y">
          <h3 className="pb-2 text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">Floor</h3>
          <Toggle label="Grid" hint="Dotted guide lines" checked={settings.showGrid} onChange={v => set('showGrid', v)} />
          <Toggle label="Snap to grid" hint="While arranging, tables jump to the grid" checked={settings.snap} onChange={v => set('snap', v)} />
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-muted-foreground">Colours</h3>
            {customCount > 0 && (
              <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => set('colors', {})}>
                Reset {customCount} custom colour{customCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Colour set">
            {([['standard', 'Standard'], ['accessible', 'Colour-blind safe']] as [FloorPalette, string][]).map(([p, label]) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={settings.palette === p}
                onClick={() => set('palette', p)}
                className={`rounded-lg border px-3 py-2 text-left text-[13px] font-semibold transition-colors ${settings.palette === p ? 'border-primary bg-primary/10' : 'hover:bg-muted/50'}`}
              >
                {label}
                <span className="mt-1.5 flex gap-0.5">
                  {FLOOR_STATES.map(s => <span key={s} className="h-2 flex-1 rounded-sm" style={{ background: FLOOR_PALETTES[p][s] }} />)}
                </span>
              </button>
            ))}
          </div>
          <ul className="mt-3 divide-y rounded-lg border">
            {FLOOR_STATES.map(s => (
              <li key={s} className="flex items-center gap-3 px-3 py-2">
                <input
                  type="color"
                  aria-label={`Colour for ${FLOOR_STATE_LABEL[s]}`}
                  value={stateColour(s, settings)}
                  onChange={e => setColour(s, e.target.value)}
                  className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{FLOOR_STATE_LABEL[s]}</span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">{FLOOR_STATE_HINT[s]}</span>
                </span>
                {settings.colors[s] && (
                  <button type="button" onClick={() => clearColour(s)} className="text-[12px] font-semibold text-primary hover:underline" aria-label={`Reset ${FLOOR_STATE_LABEL[s]} colour`}>
                    Reset
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-6 flex justify-end border-t pt-4">
          <Button variant="outline" size="sm" onClick={() => onChange({ ...DEFAULT_FLOOR_SETTINGS, colors: {}, zoom: settings.zoom })}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore defaults
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
