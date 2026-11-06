// ============================================================
// LIVE FLOOR (v1.110.0) — the pure rules behind the animated floor: where guests sit, how a booking is judged, what a
// counter or a door looks like. No store, no network: the Tables page hands in the rows and writes back what this returns.
// ============================================================
import type { DiningTable, FloorFixture, FloorFixtureKind, TableReservation } from '@/lib/types';

// ------------------------------------------------------------------ guests on chairs

/**
 * Which chairs are taken when `guests` people sit at a table of `seats` chairs. They are spread round the table rather than
 * packed on one side — two people at a four-seater sit opposite each other, as people do.
 */
export function occupiedChairs(seats: number, guests: number): number[] {
  const n = Math.max(1, Math.floor(seats) || 1);
  const g = Math.max(0, Math.min(n, Math.floor(guests) || 0));
  if (g === 0) return [];
  const taken = new Set<number>();
  for (let i = 0; i < g; i++) taken.add(Math.min(n - 1, Math.round((i * n) / g)));
  for (let c = 0; taken.size < g && c < n; c++) taken.add(c);       // a rounding clash is filled from the first free chair
  return Array.from(taken).sort((a, b) => a - b);
}

/** Buttons offered when asking "how many guests?" — every chair, capped so a long table stays one row. */
export function partyOptions(seats: number): number[] {
  const n = Math.max(1, Math.min(12, Math.floor(seats) || 1));
  return Array.from({ length: n }, (_, i) => i + 1);
}

// ------------------------------------------------------------------ bookings

export const BOOKING_SOON_MIN = 30;       // a booking this close to its time (or past it) is shown on the table
export const BOOKING_LATE_MIN = 15;       // this long after the time, the guests are "late"
export const BOOKING_CLASH_MIN = 90;      // two bookings on one table must be at least this far apart

export type BookingTiming = 'upcoming' | 'soon' | 'late';

export const activeBookings = (list: TableReservation[] | undefined): TableReservation[] =>
  (list || []).filter(r => r.status === 'booked');

export function bookingTiming(r: TableReservation, nowMs: number): BookingTiming {
  const mins = (new Date(r.at).getTime() - nowMs) / 60000;
  if (mins < -BOOKING_LATE_MIN) return 'late';
  if (mins <= BOOKING_SOON_MIN) return 'soon';
  return 'upcoming';
}

/** The booking to show on a table now: the next one starting within `windowMin`, or one that is already late. */
export function nextBookingFor(tableId: string, list: TableReservation[] | undefined, nowMs: number, windowMin = 180): TableReservation | undefined {
  return activeBookings(list)
    .filter(r => r.tableId === tableId)
    .filter(r => { const mins = (new Date(r.at).getTime() - nowMs) / 60000; return mins <= windowMin && mins >= -120; })
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0];
}

export function bookingLabel(r: TableReservation, locale?: string): string {
  const t = new Date(r.at);
  const time = Number.isNaN(t.getTime()) ? '—' : t.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `${time} · ${r.guests}`;
}

export interface BookingInput { tableId: string; name: string; phone?: string; guests: number; at: string; note?: string }

/** The first reason a booking cannot be saved, or null. */
export function bookingProblem(
  input: BookingInput, table: Pick<DiningTable, 'seats'> | undefined, existing: TableReservation[] | undefined, nowMs: number,
): string | null {
  if (!table) return 'Pick a table.';
  if (!input.name.trim()) return 'Who is the booking for? Type a name.';
  const digits = (input.phone || '').replace(/\D/g, '');
  if (input.phone && input.phone.trim() && digits.length < 5) return 'The phone number looks too short.';
  const g = Math.floor(input.guests);
  if (!Number.isFinite(g) || g < 1) return 'How many guests? At least 1.';
  if (g > table.seats) return `This table has ${table.seats} chairs — pick a bigger table or fewer guests.`;
  const at = new Date(input.at).getTime();
  if (!Number.isFinite(at)) return 'Pick the date and time.';
  if (at < nowMs - 5 * 60000) return 'That time has already passed.';
  const clash = activeBookings(existing).find(r => r.tableId === input.tableId && Math.abs(new Date(r.at).getTime() - at) < BOOKING_CLASH_MIN * 60000);
  if (clash) return `${clash.name} is already booked on this table at ${bookingLabel(clash).split(' · ')[0]}.`;
  return null;
}

/** The next whole half hour from `nowMs` — the default time of a new booking, as a value for <input type="datetime-local">. */
export function defaultBookingTime(nowMs: number): string {
  const d = new Date(Math.ceil((nowMs + 15 * 60000) / (30 * 60000)) * 30 * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ------------------------------------------------------------------ counters, doors and the rest

export interface FixtureKindDef { kind: FloorFixtureKind; label: string; w: number; h: number }
export const FIXTURE_KINDS: FixtureKindDef[] = [
  { kind: 'zone', label: 'Main hall', w: 420, h: 260 },
  { kind: 'counter', label: 'Counter', w: 200, h: 56 },
  { kind: 'cashier', label: 'Cashier', w: 120, h: 56 },
  { kind: 'kitchen', label: 'Kitchen', w: 200, h: 80 },
  { kind: 'entrance', label: 'Entrance', w: 110, h: 40 },
  { kind: 'washroom', label: 'Washroom', w: 110, h: 70 },
  { kind: 'bar', label: 'Drinks bar', w: 180, h: 56 },
  { kind: 'plant', label: 'Plants', w: 56, h: 56 },
  { kind: 'stairs', label: 'Stairs', w: 90, h: 70 },
];

export const fixtureDef = (kind: FloorFixtureKind): FixtureKindDef => FIXTURE_KINDS.find(k => k.kind === kind) ?? FIXTURE_KINDS[0];

export function newFixture(kind: FloorFixtureKind, floorId: string | undefined, at: { x: number; y: number }, id: string): FloorFixture {
  const d = fixtureDef(kind);
  return { id, ...(floorId ? { floorId } : {}), kind, label: d.label, x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)), w: d.w, h: d.h };
}

/** Fixtures that belong to the floor on screen. `floorId` undefined = the flat layout (no floors). */
export const fixturesOnFloor = (all: FloorFixture[] | undefined, floorId: string | undefined): FloorFixture[] =>
  (all || []).filter(f => (f.floorId || undefined) === (floorId || undefined));

/** Keep a fixture inside the canvas and a sensible size. */
export function clampFixture(f: FloorFixture, canvas: { width: number; height: number }): FloorFixture {
  const w = Math.max(30, Math.min(600, Math.round(f.w) || 60));
  const h = Math.max(30, Math.min(400, Math.round(f.h) || 60));
  return { ...f, w, h, x: Math.max(0, Math.min(canvas.width - w, Math.round(f.x))), y: Math.max(0, Math.min(canvas.height - h, Math.round(f.y))) };
}

/** The bottom-right corner of the furthest fixture, so the canvas can grow to hold it. */
export function fixturesExtent(list: FloorFixture[]): { width: number; height: number } {
  return list.reduce((m, f) => ({ width: Math.max(m.width, f.x + f.w + 24), height: Math.max(m.height, f.y + f.h + 24) }), { width: 0, height: 0 });
}

// ------------------------------------------------------------------ guests (the people drawn on the chairs)

/** The colours the guests' shoulders are drawn in — the same set every time, so a table looks the same on every till. */
export const GUEST_COLOURS = ['#ef6f8e', '#2ec4b6', '#9b7bea', '#f59e42', '#3b82f6', '#22c55e'] as const;

const hash = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

/** One guest's colour: fixed by the table and the chair, so it does not change when the screen redraws. */
export const guestColour = (tableId: string, chairIndex: number): string => GUEST_COLOURS[(hash(tableId) + chairIndex * 7) % GUEST_COLOURS.length];

/** Match a service call's label ("Table 5", "T-05", "5") to a table's name. Compared by its digits and letters only. */
export function callMatchesTable(callLabel: string, tableName: string): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/\btable\b/g, '').replace(/[^a-z0-9]/g, '').replace(/^t(?=\d)/, '').replace(/^0+(?=\d)/, '');
  const a = norm(callLabel), b = norm(tableName);
  return !!a && !!b && a === b;
}
