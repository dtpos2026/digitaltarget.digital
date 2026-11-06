// Seating and booking a table (v1.110.0). Tapping a free table asks "how many guests?" and shows the table as it will look:
// every number you pick adds a guest on a chair. "Book for later" keeps a name, a phone, the number of guests and the time.
import { useMemo, useState } from 'react';
import { CalendarClock, Minus, Phone, Plus, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import FloorTile from './FloorTile';
import { DEFAULT_FLOOR_SETTINGS } from '@/lib/floorAdvanced';
import {
  bookingLabel, bookingTiming, defaultBookingTime, partyOptions, activeBookings,
} from '@/lib/liveFloor';
import { addReservation, getReservations, setReservationStatus } from '@/lib/tableReservations';
import type { DiningTable, TableReservation } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  table: DiningTable;
  guests: number;
  onGuests: (n: number) => void;
  /** Seat the guests now. `reservationId` is set when a booking is being honoured. */
  onSeat: (guests: number, reservationId?: string) => void;
}

const PREVIEW = { ...DEFAULT_FLOOR_SETTINGS, tileSize: 132, showChairs: true, showGuests: true, showTimer: false, showAmount: false };
const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

export default function TableSeatPanel({ table, guests, onGuests, onSeat }: Props) {
  const [tab, setTab] = useState<'seat' | 'book'>('seat');
  const [version, setVersion] = useState(0);
  const total = table.seats;
  const g = Math.max(1, Math.min(total, guests || 1));
  const mine = useMemo(
    () => activeBookings(getReservations()).filter(r => r.tableId === table.id).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
    [table.id, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const due = mine.find(r => bookingTiming(r, Date.now()) !== 'upcoming');

  // ---- the booking form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [bookGuests, setBookGuests] = useState(Math.min(total, 2));
  const [at, setAt] = useState(() => defaultBookingTime(Date.now()));
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const book = () => {
    const r = addReservation({ tableId: table.id, name, phone, guests: bookGuests, at, note }, table);
    if (!r.ok) { setProblem(r.reason); return; }
    setProblem(null); setName(''); setPhone(''); setNote(''); setVersion(v => v + 1);
    toast.success(`${table.name} booked for ${r.reservation.name} · ${bookingLabel(r.reservation)}`);
  };
  const cancel = (r: TableReservation) => { setReservationStatus(r.id, 'cancelled'); setVersion(v => v + 1); };

  const tabBtn = (id: 'seat' | 'book', label: string) => (
    <button
      type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      className={cn('flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition-colors', tab === id ? 'bg-background shadow' : 'text-muted-foreground hover:text-foreground')}
    >{label}</button>
  );

  return (
    <div className="space-y-3 border-t pt-3" data-testid="seat-panel">
      <div className="flex rounded-xl bg-muted p-0.5" role="tablist" aria-label="Seat or book">
        {tabBtn('seat', 'Seat guests')}{tabBtn('book', `Book for later${mine.length ? ` · ${mine.length}` : ''}`)}
      </div>

      {tab === 'seat' ? (
        <>
          {due && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-300/60 bg-indigo-50 p-2.5 text-[12px] text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200" data-testid="seat-due-booking">
              <span className="min-w-0"><b className="block truncate">{due.name}</b>booked for {bookingLabel(due)} guests</span>
              <Button size="sm" onClick={() => onSeat(Math.min(total, due.guests), due.id)}>Seat them ({Math.min(total, due.guests)})</Button>
            </div>
          )}

          {/* the table as it will be: every guest picked sits on a chair */}
          <div className="flex justify-center rounded-2xl border bg-muted/30 px-6 pb-3 pt-7" data-testid="seat-preview" aria-hidden>
            <FloorTile
              inline
              settings={PREVIEW}
              data={{ id: table.id, name: table.name, seats: total, shape: table.shape, state: 'seated', minutes: null, guests: g, amount: null }}
            />
          </div>

          <div>
            <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground">How many guests?</div>
            <div className="mb-2 flex flex-wrap justify-center gap-1.5">
              {partyOptions(total).map(n => (
                <button
                  key={n} type="button" onClick={() => onGuests(n)} aria-pressed={n === g} aria-label={`${n} guest${n > 1 ? 's' : ''}`}
                  className={cn('flex h-9 w-9 items-center justify-center rounded-full border-2 text-[13px] font-extrabold transition-all',
                    n === g ? 'scale-105 border-primary bg-primary text-primary-foreground shadow-md' : 'border-border bg-muted text-muted-foreground hover:border-primary')}
                >{n}</button>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button aria-label="Fewer guests" size="icon" variant="outline" className="h-8 w-8" onClick={() => onGuests(Math.max(1, g - 1))}><Minus className="h-3.5 w-3.5" /></Button>
              <div className="min-w-[72px] rounded-lg bg-muted px-4 py-1.5 text-center text-lg font-bold" data-testid="seat-count">{g} <span className="text-xs font-normal text-muted-foreground">/ {total}</span></div>
              <Button aria-label="More guests" size="icon" variant="outline" className="h-8 w-8" onClick={() => onGuests(Math.min(total, g + 1))}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
            {total > 12 && <p className="mt-1 text-center text-[11px] text-muted-foreground">Use + for more than 12.</p>}
          </div>

          <Button onClick={() => onSeat(g, due && g === Math.min(total, due.guests) ? due.id : undefined)} className="w-full bg-status-running font-bold text-white hover:bg-status-running/90">
            ✓ Seat {g} guest{g > 1 ? 's' : ''} &amp; start order
          </Button>
        </>
      ) : (
        <div className="space-y-2.5" data-testid="book-form">
          <label className="block text-[12px] font-semibold">Name
            <span className="relative mt-1 block"><UserRound className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <input className="h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-[13px]" value={name} onChange={e => setName(e.target.value)} placeholder="Who is it for?" /></span>
          </label>
          <label className="block text-[12px] font-semibold">Phone <span className="font-normal text-muted-foreground">(optional)</span>
            <span className="relative mt-1 block"><Phone className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <input className="h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-[13px]" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="03xx xxxxxxx" /></span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[12px] font-semibold">How many guests?</div>
              <div className="mt-1 flex items-center gap-1.5">
                <Button aria-label="Fewer guests booked" size="icon" variant="outline" className="h-9 w-9" onClick={() => setBookGuests(n => Math.max(1, n - 1))}><Minus className="h-3.5 w-3.5" /></Button>
                <span className="min-w-[2.5rem] text-center text-[15px] font-bold tabular-nums" data-testid="book-count">{Math.min(total, bookGuests)}</span>
                <Button aria-label="More guests booked" size="icon" variant="outline" className="h-9 w-9" onClick={() => setBookGuests(n => Math.min(total, n + 1))}><Plus className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            <label className="block text-[12px] font-semibold">When
              <input type="datetime-local" className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-[12.5px]" value={at} onChange={e => setAt(e.target.value)} />
            </label>
          </div>
          <label className="block text-[12px] font-semibold">Note <span className="font-normal text-muted-foreground">(optional)</span>
            <input className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-[13px]" value={note} onChange={e => setNote(e.target.value)} placeholder="Birthday, window seat …" />
          </label>
          {problem && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] font-semibold text-destructive" data-testid="book-problem">{problem}</p>}
          <Button className="w-full" onClick={book}><CalendarClock className="mr-1.5 h-4 w-4" />Book {table.name}</Button>

          {mine.length > 0 && (
            <ul className="divide-y rounded-xl border" data-testid="book-list">
              {mine.map(r => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1"><b className="block truncate">{r.name}</b><span className="text-muted-foreground">{when(r.at)} · {r.guests} guest{r.guests > 1 ? 's' : ''}</span></span>
                  <Button size="sm" variant="outline" onClick={() => { setTab('seat'); onGuests(Math.min(total, r.guests)); }}>Seat</Button>
                  <button type="button" aria-label={`Cancel booking for ${r.name}`} className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => cancel(r)}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
