// One table on the live floor (v1.110.0, in the look of the owner's reference video): a clean table with a thin ring in its
// state colour, its name and one word for what is happening ("Free", "Ordering", "Ready", "Bill"), small white chairs round it,
// and — when guests are seated — each guest drawn from above (coloured shoulders, a dark head) sitting on a chair, arriving
// with a short walk-in animation. A pill above the table says when somebody is needed (waiter, food ready, bill, booking).
// Presentational — the parent decides where it stands.
import { memo, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { CalendarClock, ConciergeBell, Receipt, Soup, Users } from 'lucide-react';
import {
  FLOOR_STATE_HINT, FLOOR_STATE_LABEL, chairLayout, fmtMinutes, readableText, stateColour, tileSizeOf,
  type FloorSettings, type FloorState,
} from '@/lib/floorAdvanced';
import { guestColour, occupiedChairs, type BookingTiming } from '@/lib/liveFloor';
import type { TableShape } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface FloorTileData {
  id: string;
  name: string;
  seats: number;
  shape?: TableShape;
  state: FloorState;
  minutes: number | null;
  guests: number | null;
  orderNumber?: number;
  amount: number | null;
  /** A guest asked for the waiter from the table's QR code. */
  needsWaiter?: boolean;
  /** The next booking on this table, if one is near. */
  booking?: { label: string; timing: BookingTiming; name: string };
}

interface Props {
  data: FloorTileData;
  settings: FloorSettings;
  x?: number;
  y?: number;
  selected?: boolean;
  dimmed?: boolean;
  editing?: boolean;
  /** Draw in normal flow (the settings preview) instead of at x / y. */
  inline?: boolean;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const CHAIR_SCALE = 1.3;

/** The one word shown under the table's name. */
export const FLOOR_STATE_SHORT: Record<FloorState, string> = {
  available: 'Free', seated: 'Seated', ordered: 'Ordering', unsent: 'Not sent', ready: 'Ready', hold: 'On hold',
  overtime: 'Over time', 'pending-payment': 'Bill', closed: 'Closed',
};

/** What the pill above the table says, if anything. The most urgent thing wins. */
function pillOf(d: FloorTileData): { text: string; tone: string; icon: typeof Users; pulse: boolean } | null {
  if (d.needsWaiter) return { text: 'Needs waiter', tone: '#ef6f3c', icon: ConciergeBell, pulse: true };
  if (d.state === 'pending-payment') return { text: 'Bill', tone: '#8b5cf6', icon: Receipt, pulse: true };
  if (d.state === 'ready') return { text: 'Ready', tone: '#16a34a', icon: Soup, pulse: true };
  if (d.booking && d.state === 'available') {
    return { text: d.booking.label, tone: d.booking.timing === 'late' ? '#dc2626' : '#6366f1', icon: CalendarClock, pulse: d.booking.timing !== 'upcoming' };
  }
  return null;
}

/** One guest, seen from above: shoulders and a head, turned to face the table. */
function Guest({ chair, index, colour }: { chair: { x: number; y: number; w: number; h: number; rot: number }; index: number; colour: string }) {
  const bw = Math.round(chair.w * 1.15);
  const bh = Math.round(chair.h * 1.9);
  const head = Math.round(chair.h * 1.15);
  const rad = (chair.rot * Math.PI) / 180;
  // "outside" is the way the chair's back faces; the guest walks in from there
  const ox = Math.round(Math.sin(rad) * 30), oy = Math.round(-Math.cos(rad) * 30);
  const style = {
    left: chair.x - bw / 2, top: chair.y - bh / 2, width: bw, height: bh, transform: `rotate(${chair.rot}deg)`,
    '--i': index, '--ox': `${ox}px`, '--oy': `${oy}px`,
  } as CSSProperties;
  return (
    <span aria-hidden data-guest className="dt-guest pointer-events-none absolute" style={style}>
      <span
        className="dt-guest-body absolute inset-0 block"
        style={{ '--i': index, '--bx': '0px', '--by': '1.5px' } as CSSProperties}
      >
        <span className="absolute inset-0 rounded-full shadow-[0_2px_5px_-1px_rgba(15,23,42,0.45)]" style={{ background: colour }} />
        <span
          className="absolute left-1/2 rounded-full"
          style={{ width: head, height: head, top: `calc(50% - ${head / 2 - 1}px)`, marginLeft: -head / 2, background: '#2b211c', boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.18)' }}
        />
      </span>
    </span>
  );
}

function FloorTileImpl({ data, settings, x = 0, y = 0, selected, dimmed, editing, inline, onPointerDown, onClick, onDoubleClick, onKeyDown }: Props) {
  const { w, h } = tileSizeOf(data.shape, settings.tileSize);
  const colour = stateColour(data.state, settings);
  const outlined = settings.tileStyle !== 'filled';
  const ink = outlined ? 'hsl(var(--foreground))' : readableText(colour);
  const scale = settings.tileSize / 96;
  const chairs = settings.showChairs ? chairLayout(data.shape, data.seats, w, h, CHAIR_SCALE) : [];
  const chairThick = chairs[0]?.h ?? 0;
  const inset = settings.showChairs ? Math.round(chairThick) + 5 : 4;
  const round = data.shape === 'round';
  const showTimer = settings.showTimer && data.minutes !== null;
  const seatedNow = data.state !== 'available' && data.state !== 'closed';
  const showGuests = settings.showGuests && seatedNow && data.guests !== null;
  const taken = new Set(settings.showChairs && seatedNow && data.guests ? occupiedChairs(data.seats, data.guests) : []);
  const pill = pillOf(data);
  const caption = settings.showAmount && data.amount !== null && data.amount > 0
    ? `${data.orderNumber !== undefined ? `#${data.orderNumber} · ` : ''}${rs(data.amount)}`
    : '';

  const style: CSSProperties = inline
    ? { width: w, height: h + 18 }
    : { position: 'absolute', left: x, top: y, width: w, height: h + 18, touchAction: editing ? 'none' : undefined };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${data.name}, ${FLOOR_STATE_LABEL[data.state]}, ${data.seats} seats`}
      aria-pressed={!!selected}
      title={`${data.name} — ${FLOOR_STATE_LABEL[data.state]}\n${FLOOR_STATE_HINT[data.state]}`}
      data-testid="floor-tile"
      data-table-id={data.id}
      data-state={data.state}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      className={cn(
        'group select-none outline-none transition-[opacity,transform] duration-150',
        editing ? 'cursor-move' : 'cursor-pointer',
        dimmed && 'opacity-25',
        !editing && 'hover:-translate-y-0.5',
      )}
      style={style}
    >
      <div className="relative" style={{ width: w, height: h }}>
        {/* selection ring */}
        {selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-1.5 border-2"
            style={{ borderColor: 'hsl(var(--primary))', borderRadius: round ? 9999 : 22 }}
          />
        )}
        {editing && !selected && (
          <span aria-hidden className="pointer-events-none absolute -inset-1.5 border border-dashed border-muted-foreground/50" style={{ borderRadius: round ? 9999 : 20 }} />
        )}

        {/* chairs: small white stubs; an empty one stays plain */}
        {chairs.map((c, i) => (
          <span
            key={i}
            aria-hidden
            data-chair
            data-taken={taken.has(i) ? '' : undefined}
            className="absolute rounded-[5px] border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.12)]"
            style={{
              left: c.x - c.w / 2, top: c.y - c.h / 2, width: c.w, height: c.h, transform: `rotate(${c.rot}deg)`,
              borderColor: `color-mix(in srgb, ${colour} 28%, hsl(var(--border)))`,
            }}
          />
        ))}

        {/* the table */}
        <div
          className={cn('absolute flex flex-col items-center justify-center text-center shadow-[0_8px_18px_-10px_rgba(15,23,42,0.5)]', seatedNow && 'dt-table-pop')}
          key={seatedNow ? 'seated' : 'free'}
          style={{
            inset, color: ink, borderRadius: round ? 9999 : Math.round(16 * scale),
            background: outlined ? `color-mix(in srgb, ${colour} 3%, hsl(var(--card)))` : colour,
            border: `${Math.max(2, Math.round(2.5 * scale))}px solid ${colour}`,
          }}
        >
          <span className="max-w-full truncate px-1 font-extrabold leading-none tracking-tight" style={{ fontSize: Math.round(16 * scale) }}>{data.name}</span>
          <span className="mt-1.5 inline-flex items-center gap-1 font-bold leading-none" style={{ fontSize: Math.round(10 * scale), color: outlined ? colour : ink }}>
            <span aria-hidden className="inline-block rounded-full" style={{ width: Math.round(6 * scale), height: Math.round(6 * scale), background: outlined ? colour : ink }} />
            {FLOOR_STATE_SHORT[data.state]}
          </span>
          <span className="mt-1 inline-flex items-center gap-1 font-semibold leading-none opacity-70" style={{ fontSize: Math.round(9 * scale) }}>
            {showGuests ? (<><Users style={{ width: Math.round(9 * scale), height: Math.round(9 * scale) }} />{data.guests}/{data.seats}</>) : <>{data.seats} seats</>}
            {showTimer && <><span aria-hidden>·</span><span className="font-mono tabular-nums">{fmtMinutes(data.minutes)}</span></>}
          </span>
        </div>

        {/* guests, drawn last so they sit on top of the chairs */}
        {chairs.map((c, i) => (taken.has(i)
          ? <Guest key={`g${i}`} chair={c} index={Array.from(taken).indexOf(i)} colour={guestColour(data.id, i)} />
          : null))}

        {/* what this table needs */}
        {pill && !editing && (
          <span
            className="dt-pill absolute left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border bg-card px-2 py-[3px] text-[10.5px] font-bold leading-none shadow-md"
            style={{ top: -27, color: pill.tone, borderColor: `color-mix(in srgb, ${pill.tone} 45%, hsl(var(--border)))`, '--ring': `${pill.tone}66` } as CSSProperties}
            data-pulse={pill.pulse ? '' : undefined}
            data-pill={pill.text}
          >
            <pill.icon className="h-3 w-3" aria-hidden />{pill.text}
          </span>
        )}
      </div>
      <div className="mt-0.5 h-4 truncate text-center text-[10.5px] font-semibold leading-4 text-muted-foreground tabular-nums">{caption}</div>
    </div>
  );
}

export default memo(FloorTileImpl);
