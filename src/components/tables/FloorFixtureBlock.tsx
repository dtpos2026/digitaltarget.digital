// A counter, the cashier, the kitchen pass, a door, a zone … drawn on the live floor (v1.110.0). In Live mode it is only
// scenery; in Edit mode it can be picked up, moved and renamed like a table.
import { memo, type CSSProperties, type PointerEvent } from 'react';
import { Bath, ChefHat, DoorOpen, Flower2, Footprints, Store, Wallet, Wine } from 'lucide-react';
import type { FloorFixture, FloorFixtureKind } from '@/lib/types';
import { cn } from '@/lib/utils';

const ICON: Record<Exclude<FloorFixtureKind, 'zone' | 'entrance'>, typeof Store> = {
  counter: Store, cashier: Wallet, kitchen: ChefHat, washroom: Bath, bar: Wine, plant: Flower2, stairs: Footprints,
};
const ZONE_TINTS = [
  { fg: '#6d5bd0', bg: 'rgba(109, 91, 208, 0.06)' },     // violet
  { fg: '#0f9d8a', bg: 'rgba(15, 157, 138, 0.07)' },     // teal
  { fg: '#d97706', bg: 'rgba(217, 119, 6, 0.06)' },      // amber
  { fg: '#2563eb', bg: 'rgba(37, 99, 235, 0.06)' },      // blue
];
const NEUTRAL = { fg: '#64748b', bg: 'rgba(100, 116, 139, 0.045)' };
/** The main dining area stays neutral; other zones get a quiet tint so they can be told apart at a glance. */
const tintOf = (label: string) => (/main|hall|dining|ground/i.test(label) ? NEUTRAL : ZONE_TINTS[Array.from(label).reduce((a, c) => a + c.charCodeAt(0), 0) % ZONE_TINTS.length]);

interface Props {
  fixture: FloorFixture;
  x?: number;
  y?: number;
  selected?: boolean;
  editing?: boolean;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
}

function FloorFixtureBlockImpl({ fixture: f, x = f.x, y = f.y, selected, editing, onPointerDown, onClick }: Props) {
  const base: CSSProperties = { position: 'absolute', left: x, top: y, width: f.w, height: f.h, zIndex: f.kind === 'zone' ? 0 : 1, touchAction: editing ? 'none' : undefined };
  const ring = selected ? 'outline outline-2 outline-offset-2 outline-primary' : editing ? 'outline outline-1 outline-dashed outline-offset-2 outline-muted-foreground/40' : '';
  const common = {
    'data-testid': 'floor-fixture', 'data-fixture-id': f.id, 'data-kind': f.kind, onPointerDown, onClick,
    className: cn('select-none', editing ? 'cursor-move' : 'pointer-events-none', ring),
    style: base, 'aria-label': editing ? `${f.label} (${f.kind})` : undefined,
  } as const;

  if (f.kind === 'zone') {
    const t = tintOf(f.label);
    return (
      <div {...common} className={cn(common.className, 'rounded-3xl border-[1.5px] border-dashed')} style={{ ...base, borderColor: `${t.fg}55`, background: t.bg }}>
        <span className="absolute left-4 top-3 inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.14em]" style={{ color: t.fg }}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: t.fg }} />{f.label}
        </span>
      </div>
    );
  }
  if (f.kind === 'entrance') {
    return (
      <div {...common} className={cn(common.className, 'flex flex-col items-center justify-end gap-1')}>
        <span className="inline-flex items-center gap-1 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-primary"><DoorOpen className="h-3 w-3" aria-hidden />{f.label}</span>
        <span aria-hidden className="h-1.5 w-full rounded-full bg-primary/80" />
      </div>
    );
  }
  const Icon = ICON[f.kind];
  const dark = f.kind === 'kitchen';
  return (
    <div
      {...common}
      className={cn(common.className, 'flex items-center justify-center gap-2 rounded-2xl border px-3 shadow-sm', dark ? 'border-transparent bg-foreground text-background' : 'bg-muted/60 text-muted-foreground')}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate text-[11.5px] font-bold uppercase tracking-wider">{f.label}</span>
    </div>
  );
}

export default memo(FloorFixtureBlockImpl);
