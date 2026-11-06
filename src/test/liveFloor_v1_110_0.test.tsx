// v1.110.0 — the Live floor: guests drawn on their chairs, "how many guests?" when seating, bookings, counters / doors / zones.
// The pure rules first, then the tile, the seat panel and the real Tables page.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { Toaster } from 'sonner';
import {
  GUEST_COLOURS, activeBookings, bookingLabel, bookingProblem, bookingTiming, callMatchesTable, clampFixture, defaultBookingTime,
  fixturesExtent, fixturesOnFloor, guestColour, newFixture, nextBookingFor, occupiedChairs, partyOptions, FIXTURE_KINDS,
} from '@/lib/liveFloor';
import FloorTile from '@/components/tables/FloorTile';
import TableSeatPanel from '@/components/tables/TableSeatPanel';
import { DEFAULT_FLOOR_SETTINGS } from '@/lib/floorAdvanced';
import TablesPage from '@/pages/TablesPage';
import { addReservation, getFixtures, getReservations, saveFixtures, setReservationStatus } from '@/lib/tableReservations';
import { deleteFloor, deleteOrder, deleteTable, getFloors, getOrders, getTables, saveSettings, getSettings, saveTable } from '@/lib/store';
import type { DiningTable, TableReservation } from '@/lib/types';

const NOW = new Date('2026-11-06T19:00:00').getTime();
const at = (mins: number) => new Date(NOW + mins * 60000).toISOString();
const booking = (o: Partial<TableReservation> = {}): TableReservation => ({
  id: 'b1', tableId: 't1', name: 'Ayesha', guests: 4, at: at(20), status: 'booked', createdAt: at(-60), ...o,
});
const table = (o: Partial<DiningTable> = {}): DiningTable => ({ id: 't1', name: 'T1', seats: 4, status: 'free', shape: 'square', ...o });

describe('guests on chairs', () => {
  it('spreads guests round the table: two at a four-seater sit opposite each other', () => {
    expect(occupiedChairs(4, 2)).toEqual([0, 2]);
    expect(occupiedChairs(4, 1)).toEqual([0]);
    expect(occupiedChairs(4, 4)).toEqual([0, 1, 2, 3]);
    expect(occupiedChairs(6, 3)).toEqual([0, 2, 4]);
  });
  it('never seats more guests than chairs, never repeats a chair, and seats nobody for zero', () => {
    for (let seats = 1; seats <= 12; seats++) for (let g = 0; g <= seats + 3; g++) {
      const c = occupiedChairs(seats, g);
      expect(c.length).toBe(Math.min(g, seats));
      expect(new Set(c).size).toBe(c.length);
      expect(c.every(i => i >= 0 && i < seats)).toBe(true);
    }
  });
  it('offers one button per chair, at most twelve', () => {
    expect(partyOptions(4)).toEqual([1, 2, 3, 4]);
    expect(partyOptions(20)).toHaveLength(12);
    expect(partyOptions(0)).toEqual([1]);
  });
  it('gives a guest the same colour every time', () => {
    expect(guestColour('t1', 0)).toBe(guestColour('t1', 0));
    expect(GUEST_COLOURS).toContain(guestColour('t9', 3));
    expect(new Set([0, 1, 2, 3].map(i => guestColour('t1', i))).size).toBeGreaterThan(1);
  });
  it('matches a waiter call to a table by its number, not by a lookalike', () => {
    expect(callMatchesTable('Table 5', '5')).toBe(true);
    expect(callMatchesTable('Table 5', 'T5')).toBe(true);
    expect(callMatchesTable('T-05', 'Table 5')).toBe(true);
    expect(callMatchesTable('Table 5', 'T15')).toBe(false);
    expect(callMatchesTable('', 'T5')).toBe(false);
  });
});

describe('bookings — the rules', () => {
  const ok = { tableId: 't1', name: 'Ayesha', guests: 3, at: at(60) };
  it('accepts a good booking', () => { expect(bookingProblem(ok, table(), [], NOW)).toBeNull(); });
  it('says what is wrong, one thing at a time', () => {
    expect(bookingProblem(ok, undefined, [], NOW)).toMatch(/table/i);
    expect(bookingProblem({ ...ok, name: '  ' }, table(), [], NOW)).toMatch(/name/i);
    expect(bookingProblem({ ...ok, phone: '123' }, table(), [], NOW)).toMatch(/phone/i);
    expect(bookingProblem({ ...ok, guests: 0 }, table(), [], NOW)).toMatch(/guests/i);
    expect(bookingProblem({ ...ok, guests: 5 }, table(), [], NOW)).toMatch(/4 chairs/);
    expect(bookingProblem({ ...ok, at: 'nope' }, table(), [], NOW)).toMatch(/date and time/i);
    expect(bookingProblem({ ...ok, at: at(-30) }, table(), [], NOW)).toMatch(/passed/i);
  });
  it('refuses two bookings on one table within 90 minutes, but not on another table or later', () => {
    const existing = [booking({ at: at(60) })];
    expect(bookingProblem({ ...ok, at: at(100) }, table(), existing, NOW)).toMatch(/already booked/);
    expect(bookingProblem({ ...ok, at: at(160) }, table(), existing, NOW)).toBeNull();
    expect(bookingProblem({ ...ok, tableId: 't2', at: at(100) }, table({ id: 't2' }), existing, NOW)).toBeNull();
    expect(bookingProblem({ ...ok, at: at(100) }, table(), [booking({ at: at(60), status: 'cancelled' })], NOW)).toBeNull();
  });
  it('judges timing: upcoming, soon, late', () => {
    expect(bookingTiming(booking({ at: at(90) }), NOW)).toBe('upcoming');
    expect(bookingTiming(booking({ at: at(20) }), NOW)).toBe('soon');
    expect(bookingTiming(booking({ at: at(-5) }), NOW)).toBe('soon');
    expect(bookingTiming(booking({ at: at(-30) }), NOW)).toBe('late');
  });
  it('shows a table only its own near booking, soonest first', () => {
    const list = [booking({ id: 'x', at: at(200) }), booking({ id: 'a', at: at(90) }), booking({ id: 'o', tableId: 't2', at: at(10) }), booking({ id: 'c', at: at(10), status: 'cancelled' })];
    expect(nextBookingFor('t1', list, NOW)?.id).toBe('a');
    expect(nextBookingFor('t1', list, NOW, 60)).toBeUndefined();
    expect(nextBookingFor('t3', list, NOW)).toBeUndefined();
    expect(activeBookings(list)).toHaveLength(3);
  });
  it('proposes the next half hour for a new booking and labels a booking by time and guests', () => {
    expect(defaultBookingTime(new Date('2026-11-06T19:05:00').getTime())).toBe('2026-11-06T19:30');
    expect(defaultBookingTime(new Date('2026-11-06T19:20:00').getTime())).toBe('2026-11-06T20:00');
    expect(bookingLabel(booking({ at: '2026-11-06T20:15:00' }), 'en-US')).toMatch(/8:15\s?PM · 4/);
  });
});

describe('counters, doors and zones — the rules', () => {
  it('offers zone, counter, cashier, kitchen, entrance, washroom, bar, plants and stairs', () => {
    expect(FIXTURE_KINDS.map(k => k.kind)).toEqual(['zone', 'counter', 'cashier', 'kitchen', 'entrance', 'washroom', 'bar', 'plant', 'stairs']);
  });
  it('places a new one with its default label and size, on the floor on screen', () => {
    const f = newFixture('counter', 'f1', { x: 40.4, y: -10 }, 'id1');
    expect(f).toMatchObject({ id: 'id1', floorId: 'f1', kind: 'counter', label: 'Counter', x: 40, y: 0, w: 200, h: 56 });
    expect(newFixture('zone', undefined, { x: 0, y: 0 }, 'z').floorId).toBeUndefined();
  });
  it('keeps each floor’s fixtures apart', () => {
    const all = [newFixture('counter', 'f1', { x: 0, y: 0 }, 'a'), newFixture('plant', 'f2', { x: 0, y: 0 }, 'b'), newFixture('zone', undefined, { x: 0, y: 0 }, 'c')];
    expect(fixturesOnFloor(all, 'f1').map(f => f.id)).toEqual(['a']);
    expect(fixturesOnFloor(all, undefined).map(f => f.id)).toEqual(['c']);
  });
  it('clamps a fixture inside the canvas and to a sensible size, and tells the canvas how far it must reach', () => {
    const f = clampFixture({ ...newFixture('counter', undefined, { x: 0, y: 0 }, 'a'), x: 5000, y: -5, w: 5, h: 9999 }, { width: 960, height: 560 });
    expect(f.w).toBe(30); expect(f.h).toBe(400);
    expect(f.x).toBe(930); expect(f.y).toBe(0);
    expect(fixturesExtent([{ ...f, x: 100, y: 200, w: 200, h: 56 }])).toEqual({ width: 324, height: 280 });
    expect(fixturesExtent([])).toEqual({ width: 0, height: 0 });
  });
});

describe('the table tile', () => {
  const data = (o: object = {}) => ({ id: 't1', name: 'T1', seats: 4, shape: 'square' as const, state: 'seated' as const, minutes: 14, guests: 2, amount: null, ...o });
  afterEach(cleanup);

  it('draws one guest per seated person, each on its own chair, walking in one after the other', () => {
    const { container } = render(<FloorTile inline data={data({ guests: 3 })} settings={DEFAULT_FLOOR_SETTINGS} />);
    const guests = container.querySelectorAll('[data-guest]');
    expect(guests).toHaveLength(3);
    expect(Array.from(guests).map(g => (g as HTMLElement).style.getPropertyValue('--i'))).toEqual(['0', '1', '2']);
    expect(container.querySelectorAll('[data-chair]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-chair][data-taken]')).toHaveLength(3);
  });
  it('draws nobody at a free table, and nobody when chairs are switched off', () => {
    expect(render(<FloorTile inline data={data({ state: 'available', guests: null, minutes: null })} settings={DEFAULT_FLOOR_SETTINGS} />).container.querySelectorAll('[data-guest]')).toHaveLength(0);
    cleanup();
    expect(render(<FloorTile inline data={data()} settings={{ ...DEFAULT_FLOOR_SETTINGS, showChairs: false }} />).container.querySelectorAll('[data-guest]')).toHaveLength(0);
  });
  it('says in one word what is happening, and keeps the guests/seats count', () => {
    render(<FloorTile inline data={data({ state: 'ordered' })} settings={DEFAULT_FLOOR_SETTINGS} />);
    expect(screen.getByTestId('floor-tile').textContent).toMatch(/Ordering/);
    expect(screen.getByTestId('floor-tile').textContent).toMatch(/2\/4/);
  });
  it('shows a pill for what the table needs, most urgent first', () => {
    const { rerender } = render(<FloorTile inline data={data({ state: 'pending-payment' })} settings={DEFAULT_FLOOR_SETTINGS} />);
    expect(screen.getByTestId('floor-tile').querySelector('[data-pill]')?.getAttribute('data-pill')).toBe('Bill');
    rerender(<FloorTile inline data={data({ state: 'pending-payment', needsWaiter: true })} settings={DEFAULT_FLOOR_SETTINGS} />);
    expect(screen.getByTestId('floor-tile').querySelector('[data-pill]')?.getAttribute('data-pill')).toBe('Needs waiter');
    rerender(<FloorTile inline data={data({ state: 'ready' })} settings={DEFAULT_FLOOR_SETTINGS} />);
    expect(screen.getByTestId('floor-tile').querySelector('[data-pill]')?.getAttribute('data-pill')).toBe('Ready');
    rerender(<FloorTile inline data={data({ state: 'available', guests: null, minutes: null, booking: { label: '8:15 PM · 4', timing: 'soon', name: 'Ayesha' } })} settings={DEFAULT_FLOOR_SETTINGS} />);
    expect(screen.getByTestId('floor-tile').querySelector('[data-pill]')?.getAttribute('data-pill')).toBe('8:15 PM · 4');
    rerender(<FloorTile inline data={data({ state: 'seated' })} settings={DEFAULT_FLOOR_SETTINGS} />);
    expect(screen.getByTestId('floor-tile').querySelector('[data-pill]')).toBeNull();
  });
});

describe('bookings and fixtures in the settings document', () => {
  beforeEach(() => { saveSettings({ ...getSettings(), tableReservations: [], floorFixtures: [] }); });

  it('saves a booking, refuses a clash, and cancelling frees the time', () => {
    const t = table({ id: 'tt1' });
    const when = new Date(Date.now() + 3 * 3600000).toISOString();
    const r = addReservation({ tableId: 'tt1', name: '  Ayesha ', phone: ' 0300 1234567 ', guests: 3, at: when }, t);
    expect(r.ok).toBe(true);
    expect(getReservations()).toHaveLength(1);
    expect(getReservations()[0]).toMatchObject({ name: 'Ayesha', phone: '0300 1234567', guests: 3, status: 'booked', tableId: 'tt1' });
    const clash = addReservation({ tableId: 'tt1', name: 'Bilal', guests: 2, at: new Date(Date.now() + 3.5 * 3600000).toISOString() }, t);
    expect(clash).toMatchObject({ ok: false });
    expect((clash as { reason: string }).reason).toMatch(/already booked/);
    setReservationStatus(getReservations()[0].id, 'cancelled');
    expect(addReservation({ tableId: 'tt1', name: 'Bilal', guests: 2, at: new Date(Date.now() + 3.5 * 3600000).toISOString() }, t).ok).toBe(true);
  });
  it('keeps fixtures in the settings so every till shows the same floor', () => {
    saveFixtures([newFixture('counter', undefined, { x: 10, y: 10 }, 'f1')]);
    expect(getFixtures()).toHaveLength(1);
    expect(getSettings().floorFixtures?.[0].label).toBe('Counter');
  });
});

describe('the seat panel', () => {
  beforeEach(() => { saveSettings({ ...getSettings(), tableReservations: [], floorFixtures: [] }); });
  afterEach(cleanup);
  const mountPanel = (onSeat = vi.fn(), t = table({ id: 'sp1', seats: 4 })) => {
    let g = 2;
    const ui = () => <><Toaster /><TableSeatPanel table={t} guests={g} onGuests={n => { g = n; view.rerender(ui()); }} onSeat={onSeat} /></>;
    const view = render(ui());
    return { onSeat, view, get guests() { return g; } };
  };

  it('asks how many guests, and the table in the preview fills as the number goes up', () => {
    mountPanel();
    expect(screen.getByText('How many guests?')).toBeInTheDocument();
    expect(screen.getByTestId('seat-preview').querySelectorAll('[data-guest]')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '4 guests' }));
    expect(screen.getByTestId('seat-preview').querySelectorAll('[data-guest]')).toHaveLength(4);
    expect(screen.getByTestId('seat-count').textContent).toMatch(/4\s*\/\s*4/);
    fireEvent.click(screen.getByRole('button', { name: 'Fewer guests' }));
    expect(screen.getByTestId('seat-preview').querySelectorAll('[data-guest]')).toHaveLength(3);
  });
  it('seats exactly the number chosen', () => {
    const { onSeat } = mountPanel();
    fireEvent.click(screen.getByRole('button', { name: '3 guests' }));
    fireEvent.click(screen.getByRole('button', { name: /Seat 3 guests/ }));
    expect(onSeat).toHaveBeenCalledWith(3, undefined);
  });
  it('books for later: refuses an empty name, keeps a good booking, lists it and lets it be cancelled', () => {
    mountPanel();
    fireEvent.click(screen.getByRole('tab', { name: /Book for later/ }));
    fireEvent.click(screen.getByRole('button', { name: /Book T1|Book sp1|Book T/ }));
    expect(screen.getByTestId('book-problem').textContent).toMatch(/name/i);
    fireEvent.change(screen.getByPlaceholderText('Who is it for?'), { target: { value: 'Ayesha Khan' } });
    const later = new Date(Date.now() + 5 * 3600000); const p = (n: number) => String(n).padStart(2, '0');
    fireEvent.change(screen.getByLabelText('When'), { target: { value: `${later.getFullYear()}-${p(later.getMonth() + 1)}-${p(later.getDate())}T${p(later.getHours())}:${p(later.getMinutes())}` } });
    fireEvent.click(screen.getByRole('button', { name: 'More guests booked' }));
    fireEvent.click(screen.getByRole('button', { name: /^Book / }));
    expect(screen.queryByTestId('book-problem')).toBeNull();
    const list = screen.getByTestId('book-list');
    expect(within(list).getByText('Ayesha Khan')).toBeInTheDocument();
    expect(getReservations()[0]).toMatchObject({ name: 'Ayesha Khan', guests: 3, tableId: 'sp1' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking for Ayesha Khan' }));
    expect(screen.queryByTestId('book-list')).toBeNull();
    expect(getReservations()[0].status).toBe('cancelled');
  });
  it('offers to seat a booking that is due, with its guests, and says which booking was honoured', () => {
    const t = table({ id: 'sp2', seats: 6 });
    saveSettings({ ...getSettings(), tableReservations: [booking({ id: 'due1', tableId: 'sp2', guests: 5, at: new Date(Date.now() + 10 * 60000).toISOString() })] });
    const { onSeat } = mountPanel(vi.fn(), t);
    const banner = screen.getByTestId('seat-due-booking');
    expect(banner.textContent).toMatch(/Ayesha/);
    fireEvent.click(within(banner).getByRole('button', { name: /Seat them \(5\)/ }));
    expect(onSeat).toHaveBeenCalledWith(5, 'due1');
  });
});

describe('the Tables page', () => {
  const reset = () => {
    getTables().forEach(t => deleteTable(t.id)); getFloors().forEach(f => deleteFloor(f.id)); getOrders().forEach(o => deleteOrder(o.id));
    localStorage.clear(); localStorage.setItem('pos-user-role', 'admin');
    saveSettings({ ...getSettings(), tableReservations: [], floorFixtures: [] });
  };
  beforeEach(() => { cleanup(); reset(); saveTable({ id: 'pt1', name: 'T1', seats: 4, status: 'running', shape: 'square', seatedAt: new Date(Date.now() - 600000).toISOString(), seatedGuests: 3 } as DiningTable); saveTable({ id: 'pt2', name: 'T2', seats: 4, status: 'free', shape: 'round' } as DiningTable); });
  afterEach(cleanup);
  const mount = () => render(<HashRouter><Toaster /><TablesPage /></HashRouter>);

  it('opens on the live floor with the seated guests drawn on their chairs', () => {
    mount();
    expect(screen.getByTestId('advanced-floor')).toBeInTheDocument();
    const t1 = screen.getAllByTestId('floor-tile').find(t => t.getAttribute('data-table-id') === 'pt1')!;
    expect(t1.querySelectorAll('[data-guest]')).toHaveLength(3);
    const t2 = screen.getAllByTestId('floor-tile').find(t => t.getAttribute('data-table-id') === 'pt2')!;
    expect(t2.querySelectorAll('[data-guest]')).toHaveLength(0);
  });
  it('asks how many guests when a free table is opened', () => {
    mount();
    fireEvent.doubleClick(screen.getAllByTestId('floor-tile').find(t => t.getAttribute('data-table-id') === 'pt2')!);
    expect(screen.getByTestId('seat-panel')).toBeInTheDocument();
    expect(screen.getByText('How many guests?')).toBeInTheDocument();
  });
  it('lets the owner add a counter in Edit mode and keeps it in the settings', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Edit layout/ }));
    fireEvent.change(screen.getByLabelText('Fixture type'), { target: { value: 'cashier' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(getFixtures()).toHaveLength(1);
    expect(getFixtures()[0]).toMatchObject({ kind: 'cashier', label: 'Cashier' });
    expect(screen.getAllByTestId('floor-fixture')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Main cashier' } });
    expect(getFixtures()[0].label).toBe('Main cashier');
    fireEvent.click(screen.getByRole('button', { name: /Remove Main cashier/ }));
    expect(getFixtures()).toHaveLength(0);
  });
  it('puts a booking pill on a free table that is booked soon', () => {
    saveSettings({ ...getSettings(), tableReservations: [booking({ id: 'pb', tableId: 'pt2', guests: 3, at: new Date(Date.now() + 20 * 60000).toISOString() })] });
    mount();
    const t2 = screen.getAllByTestId('floor-tile').find(t => t.getAttribute('data-table-id') === 'pt2')!;
    expect(t2.querySelector('[data-pill]')?.getAttribute('data-pill')).toMatch(/· 3$/);
  });
});
