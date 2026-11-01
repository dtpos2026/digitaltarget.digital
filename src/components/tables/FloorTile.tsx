// One table on the Advanced floor: the table body in its state colour, chairs around it, a time pill
// and the open amount underneath. Presentational — the parent decides where it stands.
import { memo, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Users } from 'lucide-react';
import {
  FLOOR_STATE_HINT, FLOOR_STATE_LABEL, chairLayout, fmtMinutes, readableText, stateColour, tileSizeOf,
  type FloorSettings, type FloorState,
} from '@/lib/floorAdvanced';
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
const ATTENTION: FloorState[] = ['overtime', 'ready', 'unsent', 'pending-payment'];

function FloorTileImpl({ data, settings, x = 0, y = 0, selected, dimmed, editing, inline, onPointerDown, onClick, onDoubleClick, onKeyDown }: Props) {
  const { w, h } = tileSizeOf(data.shape, settings.tileSize);
  const colour = stateColour(data.state, settings);
  const ink = readableText(colour);
  const scale = settings.tileSize / 96;
  const chairs = settings.showChairs ? chairLayout(data.shape, data.seats, w, h) : [];
  const inset = settings.showChairs ? Math.round(Math.min(w, h) * 0.17 * 0.45) + 7 : 4;
  const round = data.shape === 'round';
  const showTimer = settings.showTimer && data.minutes !== null;
  const showGuests = settings.showGuests && data.state !== 'available' && data.state !== 'closed' && data.guests !== null;
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
        {/* selection / attention ring */}
        {(selected || (ATTENTION.includes(data.state) && !editing)) && (
          <span
            aria-hidden
            className={cn('pointer-events-none absolute -inset-1 rounded-[22px] border-2', !selected && 'animate-pulse')}
            style={{ borderColor: selected ? 'hsl(var(--primary))' : colour, opacity: selected ? 1 : 0.55, borderRadius: round ? 9999 : 18 }}
          />
        )}
        {editing && !selected && (
          <span aria-hidden className="pointer-events-none absolute -inset-1 border border-dashed border-muted-foreground/50" style={{ borderRadius: round ? 9999 : 16 }} />
        )}
        {chairs.map((c, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute rounded-[3px]"
            style={{
              left: c.x - c.w / 2, top: c.y - c.h / 2, width: c.w, height: c.h,
              transform: `rotate(${c.rot}deg)`, background: colour, opacity: 0.55,
            }}
          />
        ))}
        <div
          className="absolute flex flex-col items-center justify-center text-center shadow-[0_6px_16px_-8px_rgba(15,23,42,0.55)] ring-1 ring-black/10"
          style={{ inset, background: colour, color: ink, borderRadius: round ? 9999 : Math.round(14 * scale) }}
        >
          <span className="max-w-full truncate px-1 font-extrabold leading-none tracking-tight" style={{ fontSize: Math.round(15 * scale) }}>{data.name}</span>
          {showGuests ? (
            <span className="mt-1 inline-flex items-center gap-0.5 font-semibold leading-none opacity-90" style={{ fontSize: Math.round(10 * scale) }}>
              <Users style={{ width: Math.round(10 * scale), height: Math.round(10 * scale) }} />{data.guests}/{data.seats}
            </span>
          ) : (
            <span className="mt-1 leading-none opacity-80" style={{ fontSize: Math.round(10 * scale) }}>{data.seats} seats</span>
          )}
        </div>
        {showTimer && (
          <span
            className="absolute left-1/2 -translate-x-1/2 rounded-full px-1.5 py-[1px] font-mono font-bold leading-4 text-white shadow"
            style={{ top: -7, fontSize: Math.round(10 * scale), background: data.state === 'overtime' ? '#b91c1c' : '#0f172a' }}
          >
            {fmtMinutes(data.minutes)}
          </span>
        )}
      </div>
      <div className="mt-0.5 h-4 truncate text-center text-[10.5px] font-semibold leading-4 text-muted-foreground tabular-nums">{caption}</div>
    </div>
  );
}

export default memo(FloorTileImpl);
