// v1.137.0 — the Kitchen display in the design's shape (SW-11): a dark full-screen board, the stations across the top, then three
// columns — New · Cooking · Ready — of tickets. Each ticket: order · type · table on the left of a coloured header, how long it has
// waited on the right, the items as "1 × Zinger Burger" with the cook's note under, and ONE button.
// This is the picture only: the page owns the orders, the sound and the saving. DT Refined shows it; every other look keeps the old page.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck, CheckCircle, Maximize2, Minimize2, MoreHorizontal, Tv, Volume2, VolumeX, Wifi, WifiOff, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { onSyncStatus } from '@/lib/store';
import type { CartItem, Order } from '@/lib/types';
import {
  actionFor, ageLabel, ageTone, boardTitle, columnOf, itemLine, KDS_COLUMNS, ticketTitle, waitedMinutes,
  type KdsAction, type KdsColumn,
} from '@/lib/kitchenBoard';

export interface BoardTicket { order: Order; items: CartItem[] }

export interface KitchenBoardProps {
  tickets: BoardTicket[];
  /** The stations (kitchens) the restaurant has; with none, only "All stations" is shown. */
  stations: { id: string; name: string }[];
  /** 'all', a station id, or '__none__' (items no station owns). */
  station: string;
  onStation: (id: string) => void;
  /** The station an item belongs to, for the hover title. */
  stationOf: (item: CartItem) => string | undefined;
  branchName?: string | null;
  restaurantName?: string | null;
  prepMinutes: number;
  warnMinutes: number;
  soundOn: boolean;
  onToggleSound: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onAct: (order: Order, action: KdsAction) => void;
  /** "Served": the ticket leaves the board for good (kitchen status → delivered). */
  onServe: (order: Order) => void;
  onClose: () => void;
  /** "TV mode & displays" in the options menu (the page owns the dialog). */
  onOpenTvMode: () => void;
  now?: number;
}

const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function LiveChip() {
  const [snap, setSnap] = useState<{ online: boolean; pending: number }>({ online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0 });
  useEffect(() => onSyncStatus(s => setSnap({ online: s.online, pending: s.pending })), []);
  const tone = !snap.online ? 'bad' : snap.pending > 0 ? 'warn' : 'ok';
  const label = !snap.online ? 'Offline' : snap.pending > 0 ? `${snap.pending} waiting` : 'Live';
  const Icon = snap.online ? Wifi : WifiOff;
  return (
    <span data-kb-live data-tone={tone} className="kb-live"><Icon aria-hidden className="h-3.5 w-3.5" />{label}</span>
  );
}

function Ticket({ t, col, now, prep, warn, onAct, onServe, stationOf }: {
  t: BoardTicket; col: KdsColumn; now: number; prep: number; warn: number;
  onAct: KitchenBoardProps['onAct']; onServe: KitchenBoardProps['onServe']; stationOf: KitchenBoardProps['stationOf'];
}) {
  const { order, items } = t;
  const mins = waitedMinutes(order, now);
  const tone = ageTone(mins, prep, warn);
  const act = actionFor(col);
  const who = [order.customer?.name, order.waiterName].filter(Boolean).join(' · ');
  return (
    <article data-kb-ticket data-column={col} data-tone={tone} data-state={tone === 'bad' ? 'late' : order.status === 'hold' ? 'hold' : 'ok'} className="kb-ticket">
      <header className="kb-th" title={who || undefined}>
        <span className="kb-th-title">{ticketTitle(order)}{order.status === 'hold' && <em className="kb-hold">Hold</em>}</span>
        <span className="kb-th-age" data-kb-age><ClockMark />{ageLabel(col, mins)}</span>
      </header>
      <div className="kb-tb">
        {items.map(it => (
          <div key={it.id} data-kb-item title={stationOf(it) || undefined}>
            <b>{itemLine(it)}</b>
            {it.note && <div className="kb-note">{it.note}</div>}
          </div>
        ))}
        {order.notes && <div className="kb-note" data-kb-order-note>{order.notes}</div>}
        <div className="kb-actions">
          <button type="button" data-kb-action={act.to === 'recall' ? 'recall' : act.to} data-kb-primary={col !== 'ready' ? '' : undefined} className="kb-btn" onClick={() => onAct(order, act)}>{act.label}</button>
          {col === 'ready' && (
            <button type="button" data-kb-action="delivered" className="kb-btn kb-btn-icon" title="Served — take it off the board" aria-label="Mark served" onClick={() => onServe(order)}><CheckCheck aria-hidden className="h-4 w-4" /></button>
          )}
        </div>
      </div>
    </article>
  );
}

const ClockMark = () => (
  <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export default function KitchenBoard(p: KitchenBoardProps) {
  const now = p.now ?? Date.now();
  const cols: Record<KdsColumn, BoardTicket[]> = { new: [], cooking: [], ready: [] };
  for (const t of p.tickets) cols[columnOf(t.order)].push(t);
  const delayed = p.tickets.filter(t => ageTone(waitedMinutes(t.order, now), p.prepMinutes, p.warnMinutes) === 'bad').length;
  const stationTabs = [{ id: 'all', name: 'All stations' }, ...(p.stations.length ? [...p.stations, { id: '__none__', name: 'Unassigned' }] : [])];
  const [menu, setMenu] = useState(false);

  // Esc leaves the board, as the close button does.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) p.onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const board = (
    <div data-kb-board role="region" aria-label="Kitchen display" className="kb-root">
      <div className="kb-top">
        <h1 className="kb-title" data-kb-title>{boardTitle(p.branchName, p.restaurantName)}</h1>
        <div className="kb-seg" role="tablist" aria-label="Station">
          {stationTabs.map(s => (
            <button key={s.id} type="button" role="tab" aria-selected={p.station === s.id} data-on={p.station === s.id ? '' : undefined} onClick={() => p.onStation(s.id)}>{s.name}</button>
          ))}
        </div>
        <span className="kb-grow" />
        {delayed > 0 && <span data-kb-delayed className="kb-late">{delayed} delayed</span>}
        <LiveChip />
        <time className="kb-clock" data-kb-clock>{clock(now)}</time>
        <Popover open={menu} onOpenChange={setMenu}>
          <PopoverTrigger asChild>
            <button type="button" className="kb-icon" aria-label="Kitchen display options" data-kb-more><MoreHorizontal className="h-4 w-4" /></button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1.5" data-kb-menu>
            <button type="button" className="kb-menu" onClick={() => { p.onToggleSound(); setMenu(false); }}>
              {p.soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}{p.soundOn ? 'Sound alerts on' : 'Sound alerts off'}
            </button>
            <button type="button" className="kb-menu" onClick={() => { p.onToggleFullscreen(); setMenu(false); }}>
              {p.fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}{p.fullscreen ? 'Leave full screen' : 'Full screen'}
            </button>
            <button type="button" className="kb-menu" onClick={() => { setMenu(false); p.onOpenTvMode(); }}>
              <Tv className="h-4 w-4" />TV mode &amp; displays
            </button>
          </PopoverContent>
        </Popover>
        <button type="button" className="kb-icon" aria-label="Close the kitchen display" data-kb-close onClick={p.onClose}><X className="h-4 w-4" /></button>
      </div>

      <div className="kb-cols">
        {KDS_COLUMNS.map(c => (
          <section key={c.key} className="kb-col" data-kb-column={c.key} aria-label={c.label}>
            <div className="kb-col-head"><span className="kb-dot" data-column={c.key} /><b>{c.label}</b><span className="kb-count">{cols[c.key].length}</span></div>
            {cols[c.key].map(t => (
              <Ticket key={t.order.id} t={t} col={c.key} now={now} prep={p.prepMinutes} warn={p.warnMinutes} onAct={p.onAct} onServe={p.onServe} stationOf={p.stationOf} />
            ))}
            {cols[c.key].length === 0 && p.tickets.length > 0 && <div className="kb-empty">Nothing here</div>}
          </section>
        ))}
        {p.tickets.length === 0 && (
          <div className="kb-all-clear" data-kb-empty>
            <CheckCircle className="h-10 w-10" aria-hidden />
            <p>All orders completed!</p>
            {p.station !== 'all' && <span>(filtered to the selected station)</span>}
          </div>
        )}
      </div>
    </div>
  );
  // On <body>, so no shell around the page (sidebar, bar, a transformed ancestor) can sit over or inside the board.
  return typeof document === 'undefined' ? board : createPortal(board, document.body);
}
