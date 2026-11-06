// DT Order Taker — the app's own Tables tab (v1.111.0).
//
// REPORTED by the owner after using the app: the Tables tab showed the SOFTWARE's Tables page — QR code buttons, Grid / Floor Map /
// Live floor switch, Edit layout, Customize. An order taker needs one thing here: see which tables are free, and start an order on one.
// So this screen shows the same live tables (guests drawn on their chairs) in a grid that fits a phone, with floor chips on top.
// Tap a free table → "How many guests?" → the order screen opens on that table. Tap a busy table → its order opens.
// The software's Tables page is untouched and still what a cashier or manager sees.
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { useLocation, useNavigate } from '@/lib/hash-router';
import { getFloors, getOrders, getTables, onDataChange, saveTable } from '@/lib/store';
import { setReservationStatus } from '@/lib/tableReservations';
import { buildTableViews, loadFloorSettings, type FloorSettings, type TableView } from '@/lib/floorAdvanced';
import type { DiningTable } from '@/lib/types';
import FloorTile from '@/components/tables/FloorTile';
import TableSeatPanel from '@/components/tables/TableSeatPanel';
import { RBadge, Sheet } from '@/components/rider/riderUi';
import { cn } from '@/lib/utils';

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export default function OrderTakerTables() {
  const navigate = useNavigate();
  const base = (useLocation().pathname.match(/^\/order-taker(\/[^/]+)?/) || ['/order-taker'])[0];
  const [tables, setTables] = useState(() => getTables());
  const [orders, setOrders] = useState(() => getOrders());
  const [floors, setFloors] = useState(() => getFloors());
  const [tick, setTick] = useState(0);
  const [floor, setFloor] = useState<string>('all');
  const [seating, setSeating] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState(2);

  useEffect(() => onDataChange(col => {
    if (col === 'tables') setTables(getTables());
    if (col === 'orders') setOrders(getOrders());
    if (col === 'floors') setFloors(getFloors());
  }), []);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(id); }, []);

  const settings: FloorSettings = useMemo(() => ({ ...loadFloorSettings(), tileSize: 84, showChairs: true, showGuests: true, showTimer: true, showAmount: true }), []);
  const views = useMemo(() => buildTableViews(tables, orders, Date.now(), settings.overtimeMinutes), [tables, orders, tick, settings.overtimeMinutes]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortedFloors = useMemo(() => floors.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)), [floors]);
  const shown = useMemo(() => views
    .filter(v => floor === 'all' || (floor === 'none' ? !v.table.floorId : v.table.floorId === floor))
    .sort((a, b) => natural(a.table.name, b.table.name)), [views, floor]);
  const free = views.filter(v => v.state === 'available').length;

  const openTable = (v: TableView) => {
    const t = v.table;
    if (v.state === 'available') { setGuests(Math.min(t.seats, 2) || 1); setSeating(t); return; }
    if (v.order) { navigate(`${base}?retrieve=${encodeURIComponent(v.order.id)}`); return; }
    navigate(`${base}?table=${encodeURIComponent(t.id)}&guests=${t.seatedGuests || Math.min(t.seats, 2) || 1}`);
  };

  const seat = (t: DiningTable, n: number, reservationId?: string) => {
    const g = Math.max(1, Math.min(t.seats, n || 1));
    saveTable({ ...t, status: 'running', seatedAt: new Date().toISOString(), seatedGuests: g });
    if (reservationId) setReservationStatus(reservationId, 'seated');
    setSeating(null);
    navigate(`${base}?table=${encodeURIComponent(t.id)}&guests=${g}`);
  };

  const chip = (id: string, label: string, count?: number) => (
    <button key={id} type="button" aria-pressed={floor === id} onClick={() => setFloor(id)} data-testid={`otk-floor-${id}`}
      className={cn('h-10 shrink-0 rounded-full border px-4 text-[14px] font-semibold', floor === id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>
      {label}{count !== undefined && <span className="ml-1.5 tabular-nums opacity-80">{count}</span>}
    </button>
  );

  return (
    <div className="mx-auto max-w-[560px] space-y-3 p-4 pb-6" data-otk-screen="tables">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] font-extrabold tracking-tight">Tables</h1>
        <RBadge tone="ok">{free} free</RBadge>
        <RBadge tone="info">{views.length - free} busy</RBadge>
      </div>
      {sortedFloors.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Floors">
          {chip('all', 'All')}
          {sortedFloors.map(f => chip(f.id, f.name, views.filter(v => v.table.floorId === f.id).length))}
          {views.some(v => !v.table.floorId) && chip('none', 'Other')}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-[14px] text-muted-foreground">No tables here yet. The restaurant adds tables in the software.</p>
      ) : (
        <div className="grid grid-cols-3 gap-x-1 gap-y-3 pt-6" data-testid="otk-table-grid">
          {shown.map(v => (
            <div key={v.table.id} className="flex justify-center">
              <FloorTile
                inline
                settings={settings}
                data={{
                  id: v.table.id, name: v.table.name, seats: v.table.seats, shape: v.table.shape, state: v.state, minutes: v.minutes, guests: v.guests,
                  orderNumber: v.order?.orderNumber, amount: v.amount,
                }}
                onClick={() => openTable(v)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTable(v); } }}
              />
            </div>
          ))}
        </div>
      )}
      <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" aria-hidden />Tap a free table to seat guests, a busy one to open its order.</p>

      <Sheet open={!!seating} onClose={() => setSeating(null)} label="Seat guests">
        {seating && (
          <div className="rounded-3xl bg-card p-4" data-otk-seat-sheet>
            <h2 className="text-[19px] font-extrabold">{seating.name}</h2>
            <TableSeatPanel table={seating} guests={guests} onGuests={setGuests} onSeat={(n, rid) => seat(seating, n, rid)} />
          </div>
        )}
      </Sheet>
    </div>
  );
}
