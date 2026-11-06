// ============================================================
// ADVANCED FLOOR VIEW — an additional way to look at the dining floor (v1.80.0).
//
// The Grid and the Floor Map on the Tables page are untouched. This view adds:
//   • floors as tabs, plus an Overview of every floor at a glance
//   • one colour per table state (derived from the table and its live bill)
//   • a status bar that counts every table once, and filters the floor when tapped
//   • a Live mode (tap a table, act on it) and an Edit mode (drag, snap, add, rename, re-seat)
//   • a Customize panel (size, what a tile shows, colours, over-time limit), kept per device
//
// Every action that touches a bill (move, merge, split, seat, pay) is handed back to the Tables
// page, so there is exactly one implementation of each and nothing here can drift from it.
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  ArrowRightLeft, Bike, Combine, Eye, History, Layers, LayoutGrid, Maximize2, Minus, PencilRuler, Plus, QrCode, Settings2,
  ShoppingBag, Split, Trash2, Utensils, Wand2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/currency';
import { deleteTable, genId, getCurrentUser, onDataChange, saveFloor, saveTable } from '@/lib/store';
import { fetchServiceCalls, type ServiceCall } from '@/lib/serviceCalls';
import { getFixtures, getReservations, saveFixtures } from '@/lib/tableReservations';
import {
  FIXTURE_KINDS, bookingLabel, bookingTiming, callMatchesTable, clampFixture, fixturesExtent, fixturesOnFloor, newFixture, nextBookingFor,
} from '@/lib/liveFloor';
import type { DiningTable, Floor, FloorFixture, FloorFixtureKind, Order, TableShape } from '@/lib/types';
import {
  FLOOR_STATES, FLOOR_STATE_HINT, FLOOR_STATE_LABEL, autoArrange, buildTableViews, canvasSizeFor, clampToCanvas, countStates,
  fmtMinutes, loadFloorSettings, nextTableName, placeTables, readableText, saveFloorSettings, snapTo, stateColour, summarise, tileSizeOf,
  type FloorSettings, type FloorState, type TableView,
} from '@/lib/floorAdvanced';
import { cn } from '@/lib/utils';
import FloorTile from './FloorTile';
import FloorFixtureBlock from './FloorFixtureBlock';
import FloorSettingsSheet from './FloorSettingsSheet';

export type FloorBillAction = 'transfer' | 'merge' | 'split';

interface Props {
  tables: DiningTable[];
  orders: Order[];
  floors: Floor[];
  /** Open the page's table dialog (seat guests, edit the bill, pay, free). */
  onOpenTable: (t: DiningTable) => void;
  onBillAction: (t: DiningTable, action: FloorBillAction) => void;
  onShowQr: (t: DiningTable) => void;
  onShowHistory: (t: DiningTable) => void;
  onAllQrs: () => void;
  /** Take-away and delivery start at the order screen. */
  onNewOrder: (type: 'takeaway' | 'delivery') => void;
  /** Called after this view saved a table or a floor, so the page re-reads them. */
  onChanged: () => void;
}

type FloorKey = 'overview' | 'flat' | 'none' | string;
const SHAPES: { value: TableShape; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
  { value: 'rectangle', label: 'Long' },
];
const rs = (n: number) => money(Math.round(n).toLocaleString('en-PK'));

function canEditLayout(): boolean {
  try {
    const role = getCurrentUser()?.role || localStorage.getItem('pos-user-role') || '';
    return role === 'admin' || role === 'manager';
  } catch { return false; }
}

export default function AdvancedFloorView({ tables, orders, floors, onOpenTable, onBillAction, onShowQr, onShowHistory, onAllQrs, onNewOrder, onChanged }: Props) {
  const [settings, setSettings] = useState<FloorSettings>(() => loadFloorSettings());
  const updateSettings = useCallback((next: FloorSettings) => { setSettings(next); saveFloorSettings(next); }, []);

  const hasFloors = floors.length > 0;
  const sortedFloors = useMemo(() => floors.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)), [floors]);
  const hasUnassigned = hasFloors && tables.some(t => !t.floorId || !floors.some(f => f.id === t.floorId));
  const [floorKey, setFloorKey] = useState<FloorKey>(hasFloors ? 'overview' : 'flat');
  // a floor that was deleted elsewhere: fall back instead of showing an empty page
  const effectiveKey: FloorKey = !hasFloors ? 'flat'
    : floorKey === 'overview' || (floorKey === 'none' && hasUnassigned) || sortedFloors.some(f => f.id === floorKey) ? floorKey : 'overview';

  const [mode, setMode] = useState<'live' | 'edit'>('live');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FloorState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ---- counters / doors / zones, bookings and waiter calls: all live in the shared settings, so every till sees the same floor
  const [fixtures, setFixtures] = useState<FloorFixture[]>(() => getFixtures());
  const [bookings, setBookings] = useState(() => getReservations());
  useEffect(() => onDataChange(col => { if (col === 'settings') { setFixtures(getFixtures()); setBookings(getReservations()); } }), []);
  const [calls, setCalls] = useState<ServiceCall[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => { if (typeof document !== 'undefined' && document.hidden) return; fetchServiceCalls().then(list => { if (alive) setCalls((list || []).filter(c => !c.acked)); }).catch(() => { /* no calls feed here */ }); };
    load();
    const id = setInterval(load, 45000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  /** Save the fixtures and show them at once (the settings change event arrives a moment later). */
  const commitFixtures = (next: FloorFixture[]) => { setFixtures(next); saveFixtures(next); };
  const editable = useMemo(canEditLayout, []);
  const editing = mode === 'edit' && editable;

  // ---- states for every table, once per render
  const nowMs = Date.now();
  const allViews = useMemo(() => buildTableViews(tables, orders, nowMs, settings.overtimeMinutes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, orders, settings.overtimeMinutes, Math.floor(nowMs / 30000)]);

  const floorTables = useMemo(() => {
    if (effectiveKey === 'flat' || effectiveKey === 'overview') return tables;
    if (effectiveKey === 'none') return tables.filter(t => !t.floorId || !floors.some(f => f.id === t.floorId));
    return tables.filter(t => t.floorId === effectiveKey);
  }, [tables, floors, effectiveKey]);
  const floorIds = useMemo(() => new Set(floorTables.map(t => t.id)), [floorTables]);
  const views = useMemo(() => allViews.filter(v => floorIds.has(v.table.id)), [allViews, floorIds]);
  const counts = useMemo(() => countStates(views), [views]);
  const summary = useMemo(() => summarise(views), [views]);

  // ---- canvas
  const baseCanvasW = 960;
  const placed = useMemo(() => placeTables(floorTables, settings.tileSize, baseCanvasW), [floorTables, settings.tileSize]);
  const baseCanvas = useMemo(() => canvasSizeFor(placed as any, settings.tileSize), [placed, settings.tileSize]);
  const floorIdForFixtures = effectiveKey !== 'flat' && effectiveKey !== 'overview' && effectiveKey !== 'none' ? effectiveKey : undefined;
  const floorFixtures = useMemo(() => fixturesOnFloor(fixtures, floorIdForFixtures), [fixtures, floorIdForFixtures]);
  const canvas = useMemo(() => {
    const ext = fixturesExtent(floorFixtures);
    return { width: Math.max(baseCanvas.width, ext.width), height: Math.max(baseCanvas.height, ext.height) };
  }, [baseCanvas, floorFixtures]);
  const viewById = useMemo(() => new Map(views.map(v => [v.table.id, v] as const)), [views]);

  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The floor fits the width of the screen until the user zooms by hand ("Fit" brings it back).
  const [autoFit, setAutoFit] = useState(true);
  const [boxW, setBoxW] = useState(0);
  const zoom = autoFit && boxW > 0 ? Math.round(Math.max(0.7, Math.min(1, (boxW - 4) / canvas.width)) * 100) / 100 : settings.zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setBoxW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [effectiveKey]);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; offX: number; offY: number; moved: boolean } | null>(null);
  const [fxDrag, setFxDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const fxRef = useRef<{ id: string; offX: number; offY: number; moved: boolean } | null>(null);

  const selected = selectedId ? tables.find(t => t.id === selectedId) || null : null;
  const selectedView = selected ? viewById.get(selected.id) || allViews.find(v => v.table.id === selected.id) : undefined;
  useEffect(() => { if (selectedId && !tables.some(t => t.id === selectedId)) setSelectedId(null); }, [tables, selectedId]);

  const setZoom = (z: number) => { setAutoFit(false); updateSettings({ ...settings, zoom: Math.round(Math.max(0.5, Math.min(1.5, z)) * 100) / 100 }); };
  const fit = () => setAutoFit(true);

  // ---- dragging (edit mode only; positions are the same ones the Floor Map uses)
  const onTilePointerDown = (e: PointerEvent<HTMLDivElement>, t: DiningTable & { x: number; y: number }) => {
    if (!editing || e.button !== 0) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { id: t.id, offX: (e.clientX - rect.left) / zoom - t.x, offY: (e.clientY - rect.top) / zoom - t.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedId(t.id);
  };
  const onFixturePointerDown = (e: PointerEvent<HTMLDivElement>, f: FloorFixture) => {
    if (!editing || e.button !== 0) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    fxRef.current = { id: f.id, offX: (e.clientX - rect.left) / zoom - f.x, offY: (e.clientY - rect.top) / zoom - f.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelectedFixtureId(f.id); setSelectedId(null);
  };
  const onStagePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const fx = fxRef.current;
    const box = stageRef.current?.getBoundingClientRect();
    if (fx && box) {
      const f = floorFixtures.find(x => x.id === fx.id);
      if (f) {
        const c = clampFixture({ ...f, x: snapTo((e.clientX - box.left) / zoom - fx.offX, settings.gridSize, settings.snap), y: snapTo((e.clientY - box.top) / zoom - fx.offY, settings.gridSize, settings.snap) }, { width: Math.max(canvas.width, f.x + f.w + 200), height: Math.max(canvas.height, f.y + f.h + 200) });
        fx.moved = true;
        setFxDrag({ id: fx.id, x: c.x, y: c.y });
      }
      return;
    }
    const d = dragRef.current;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const t = placed.find(p => p.id === d.id);
    if (!t) return;
    const size = tileSizeOf(t.shape, settings.tileSize);
    const rawX = (e.clientX - rect.left) / zoom - d.offX;
    const rawY = (e.clientY - rect.top) / zoom - d.offY;
    const p = clampToCanvas(snapTo(rawX, settings.gridSize, settings.snap), snapTo(rawY, settings.gridSize, settings.snap), size, canvas);
    d.moved = true;
    setDrag({ id: d.id, ...p });
  };
  const onStagePointerUp = () => {
    const fx = fxRef.current;
    if (fx) {
      fxRef.current = null;
      if (fx.moved && fxDrag && fxDrag.id === fx.id) commitFixtures(fixtures.map(f => (f.id === fx.id ? { ...f, x: fxDrag.x, y: fxDrag.y } : f)));
      setFxDrag(null);
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) { setDrag(null); return; }
    const t = tables.find(x => x.id === d.id);
    if (t && drag && drag.id === d.id) { saveTable({ ...t, x: drag.x, y: drag.y }); onChanged(); }
    setDrag(null);
  };
  const nudge = (e: KeyboardEvent<HTMLDivElement>, t: DiningTable & { x: number; y: number }) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(t.id); if (!editing) onOpenTable(t); return; }
    if (!editing) return;
    const step = settings.snap ? settings.gridSize : 10;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    const p = clampToCanvas(snapTo(t.x + m[0], settings.gridSize, settings.snap), snapTo(t.y + m[1], settings.gridSize, settings.snap), tileSizeOf(t.shape, settings.tileSize), canvas);
    saveTable({ ...(tables.find(x => x.id === t.id) || t), x: p.x, y: p.y });
    onChanged();
  };

  // ---- edit tools
  const currentFloorId = effectiveKey !== 'flat' && effectiveKey !== 'overview' && effectiveKey !== 'none' ? effectiveKey : undefined;
  const addTable = () => {
    const name = nextTableName(tables);
    const draft: DiningTable = { id: genId(), name, seats: 4, status: 'free', shape: 'square', ...(currentFloorId ? { floorId: currentFloorId } : {}) };
    const pos = placeTables([...floorTables, draft], settings.tileSize, baseCanvasW).find(t => t.id === draft.id)!;
    saveTable({ ...draft, x: pos.x, y: pos.y });
    setSelectedId(draft.id);
    onChanged();
    toast.success(`${name} added`);
  };
  const arrange = () => {
    if (!floorTables.length) return;
    if (!window.confirm(`Arrange ${floorTables.length} table${floorTables.length > 1 ? 's' : ''} in a tidy grid? Their places on the Floor Map change too.`)) return;
    const r = autoArrange(floorTables, settings.tileSize, baseCanvasW);
    r.forEach(p => { const t = tables.find(x => x.id === p.id); if (t) saveTable({ ...t, x: p.x, y: p.y }); });
    onChanged();
    toast.success('Floor arranged');
  };
  const addFloor = () => {
    const name = window.prompt('Floor name (e.g. Ground, First Floor, Rooftop, Car Dining)');
    if (!name || !name.trim()) return;
    if (floors.some(f => f.name.trim().toLowerCase() === name.trim().toLowerCase())) { toast.error('A floor with that name already exists'); return; }
    const f: Floor = { id: genId(), name: name.trim(), sortOrder: floors.length };
    saveFloor(f);
    onChanged();
    setFloorKey(f.id);
  };
  const removeTable = (t: DiningTable) => {
    const v = allViews.find(x => x.table.id === t.id);
    if (v && v.state !== 'available') { toast.error(`${t.name} is in use — settle or free it first`); return; }
    if (!window.confirm(`Delete ${t.name}? This cannot be undone.`)) return;
    deleteTable(t.id);
    setSelectedId(null);
    onChanged();
    toast.success(`${t.name} deleted`);
  };

  const [fxKind, setFxKind] = useState<FloorFixtureKind>('counter');
  const addFixture = () => {
    const f = newFixture(fxKind, floorIdForFixtures, { x: 40, y: Math.max(40, canvas.height - 120) }, genId());
    commitFixtures([...fixtures, f]);
    setSelectedFixtureId(f.id); setSelectedId(null);
    toast.success(`${f.label} added — drag it into place`);
  };
  const selectedFixture = selectedFixtureId ? floorFixtures.find(f => f.id === selectedFixtureId) || null : null;
  const patchFixture = (patch: Partial<FloorFixture>) => {
    if (!selectedFixture) return;
    commitFixtures(fixtures.map(f => (f.id === selectedFixture.id ? clampFixture({ ...f, ...patch }, { width: Math.max(canvas.width, 1200), height: Math.max(canvas.height, 900) }) : f)));
  };
  const removeFixture = () => {
    if (!selectedFixture) return;
    commitFixtures(fixtures.filter(f => f.id !== selectedFixture.id));
    setSelectedFixtureId(null);
  };

  // ---- table properties draft (edit mode)
  const [draft, setDraft] = useState<{ name: string; seats: string; shape: TableShape; floorId: string } | null>(null);
  useEffect(() => {
    setDraft(selected ? { name: selected.name, seats: String(selected.seats), shape: selected.shape || 'square', floorId: selected.floorId || '' } : null);
  }, [selected?.id, selected?.name, selected?.seats, selected?.shape, selected?.floorId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!(selected && draft && (draft.name !== selected.name || Number(draft.seats) !== selected.seats || draft.shape !== (selected.shape || 'square') || draft.floorId !== (selected.floorId || '')));
  const applyDraft = () => {
    if (!selected || !draft) return;
    const name = draft.name.trim();
    const seats = Math.round(Number(draft.seats));
    if (!name) return toast.error('Give the table a name');
    if (!Number.isFinite(seats) || seats < 1 || seats > 20) return toast.error('Seats must be between 1 and 20');
    if (tables.some(t => t.id !== selected.id && t.name.trim().toLowerCase() === name.toLowerCase())) return toast.error(`There is already a table called “${name}”`);
    saveTable({ ...selected, name, seats, shape: draft.shape, floorId: draft.floorId || undefined });
    onChanged();
    toast.success('Table updated');
  };

  // ---- derived for the panel
  const sv: TableView | undefined = selectedView;
  const hasBill = !!sv?.order;
  const available = sv?.state === 'available';

  // ---- floor overview data
  const overview = useMemo(() => {
    const groups: { key: string; name: string; views: TableView[] }[] = sortedFloors.map(f => ({ key: f.id, name: f.name, views: allViews.filter(v => v.table.floorId === f.id) }));
    const orphan = allViews.filter(v => !v.table.floorId || !floors.some(f => f.id === v.table.floorId));
    if (orphan.length) groups.push({ key: 'none', name: 'Unassigned', views: orphan });
    return groups;
  }, [allViews, sortedFloors, floors]);

  const tabClass = (on: boolean) => cn(
    'shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors',
    on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );

  return (
    <div className="space-y-3" data-testid="advanced-floor">
      {/* ---------- toolbar ---------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2 shadow-card">
        <div className="flex min-w-0 basis-full items-center gap-1 overflow-x-auto sm:basis-0 sm:flex-1" role="tablist" aria-label="Floors">
          {hasFloors && (
            <button role="tab" aria-selected={effectiveKey === 'overview'} className={tabClass(effectiveKey === 'overview')} onClick={() => setFloorKey('overview')}>
              <span className="inline-flex items-center gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Overview</span>
            </button>
          )}
          {sortedFloors.map(f => (
            <button key={f.id} role="tab" aria-selected={effectiveKey === f.id} className={tabClass(effectiveKey === f.id)} onClick={() => setFloorKey(f.id)}>
              {f.name}
              <span className="ml-1.5 rounded-full bg-black/10 px-1.5 text-[11px] tabular-nums">{tables.filter(t => t.floorId === f.id).length}</span>
            </button>
          ))}
          {hasUnassigned && (
            <button role="tab" aria-selected={effectiveKey === 'none'} className={tabClass(effectiveKey === 'none')} onClick={() => setFloorKey('none')}>Unassigned</button>
          )}
          {!hasFloors && <span className="px-2 text-[13px] font-semibold text-muted-foreground">All tables</span>}
          {editing && (
            <button className="shrink-0 rounded-lg border border-dashed px-3 py-2 text-[13px] font-semibold text-primary hover:bg-primary/10" onClick={addFloor}>
              <Plus className="mr-1 inline h-3.5 w-3.5" />Floor
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {editable && (
            <div className="flex rounded-lg bg-muted p-0.5" role="group" aria-label="Mode">
              <button className={cn('flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold', mode === 'live' ? 'bg-background shadow' : 'text-muted-foreground')} aria-pressed={mode === 'live'} onClick={() => setMode('live')}>
                <Eye className="h-3.5 w-3.5" /> Live
              </button>
              <button className={cn('flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold', mode === 'edit' ? 'bg-background shadow' : 'text-muted-foreground')} aria-pressed={mode === 'edit'} onClick={() => { setMode('edit'); if (effectiveKey === 'overview') setFloorKey(sortedFloors[0]?.id ?? 'flat'); }}>
                <PencilRuler className="h-3.5 w-3.5" /> Edit layout
              </button>
            </div>
          )}
          <div className="flex items-center rounded-lg border bg-background" role="group" aria-label="Zoom">
            <button className="p-2 text-muted-foreground hover:text-foreground" aria-label="Zoom out" onClick={() => setZoom(zoom - 0.1)}><Minus className="h-3.5 w-3.5" /></button>
            <button className="min-w-[3.25rem] px-1 text-[12px] font-bold tabular-nums" aria-label="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button className="p-2 text-muted-foreground hover:text-foreground" aria-label="Zoom in" onClick={() => setZoom(zoom + 0.1)}><Plus className="h-3.5 w-3.5" /></button>
            <button className="border-l p-2 text-muted-foreground hover:text-foreground" aria-label="Fit to screen" title="Fit to screen" onClick={fit}><Maximize2 className="h-3.5 w-3.5" /></button>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSettingsOpen(true)} data-testid="floor-customize">
            <Settings2 className="h-4 w-4" /> Customize
          </Button>
        </div>
      </div>

      {/* ---------- body ---------- */}
      {effectiveKey === 'overview' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="floor-overview">
          {overview.map(g => {
            const c = countStates(g.views);
            const s = summarise(g.views);
            return (
              <button
                key={g.key}
                onClick={() => setFloorKey(g.key)}
                className="group flex flex-col items-stretch justify-start rounded-2xl border bg-card p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elegant"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[15px] font-extrabold tracking-tight">{g.name}</div>
                    <div className="text-[12.5px] text-muted-foreground">{s.tables} table{s.tables === 1 ? '' : 's'} · {s.seatsTotal} seats</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[22px] font-extrabold leading-none tabular-nums">{s.occupancyPct}%</div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">in use</div>
                  </div>
                </div>
                <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  {FLOOR_STATES.filter(st => c[st] > 0).map(st => (
                    <span key={st} style={{ width: `${(c[st] / Math.max(1, g.views.length)) * 100}%`, background: stateColour(st, settings) }} />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {FLOOR_STATES.filter(st => c[st] > 0).map(st => (
                    <span key={st} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ background: stateColour(st, settings) }} />{c[st]} {FLOOR_STATE_LABEL[st].toLowerCase()}
                    </span>
                  ))}
                  {g.views.length === 0 && <span className="text-[12px] text-muted-foreground">No tables yet</span>}
                </div>
                {s.openAmount > 0 && <div className="mt-3 border-t pt-2 text-[12.5px] text-muted-foreground">Open bills <b className="text-foreground tabular-nums">{rs(s.openAmount)}</b></div>}
              </button>
            );
          })}
          {overview.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No floors yet.</p>}
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* canvas */}
          <div
            ref={scrollRef}
            className="relative max-h-[calc(100vh-17rem)] min-h-[420px] overflow-auto rounded-2xl border bg-card shadow-card"
            data-testid="advanced-floor-canvas"
          >
            <div style={{ width: canvas.width * zoom, height: canvas.height * zoom }}>
              <div
                ref={stageRef}
                onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp}
                onPointerCancel={onStagePointerUp}
                onClick={e => { if (e.target === e.currentTarget) { setSelectedId(null); setSelectedFixtureId(null); } }}
                className="relative origin-top-left"
                style={{
                  width: canvas.width, height: canvas.height, transform: `scale(${zoom})`,
                  backgroundImage: settings.showGrid || editing ? 'radial-gradient(circle, hsl(var(--muted-foreground) / 0.28) 1px, transparent 1.2px)' : undefined,
                  backgroundSize: `${settings.gridSize}px ${settings.gridSize}px`,
                }}
              >
                {placed.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Utensils className="h-8 w-8 opacity-40" />
                    No tables on this floor{editing ? '.' : ' yet.'}
                    {editing && <Button size="sm" onClick={addTable}><Plus className="mr-1 h-4 w-4" />Add the first table</Button>}
                  </div>
                )}
                {[...floorFixtures].sort((a, b) => (a.kind === 'zone' ? 0 : 1) - (b.kind === 'zone' ? 0 : 1)).map(f => {
                  const pos = fxDrag && fxDrag.id === f.id ? fxDrag : f;
                  return (
                    <FloorFixtureBlock
                      key={f.id}
                      fixture={f}
                      x={pos.x}
                      y={pos.y}
                      selected={selectedFixtureId === f.id}
                      editing={editing}
                      onPointerDown={e => onFixturePointerDown(e, f)}
                      onClick={() => { if (editing && !fxRef.current?.moved) { setSelectedFixtureId(f.id); setSelectedId(null); } }}
                    />
                  );
                })}
                {placed.map(t => {
                  const v = viewById.get(t.id);
                  if (!v) return null;
                  const pos = drag && drag.id === t.id ? drag : t;
                  const booking = nextBookingFor(t.id, bookings, nowMs);
                  const needsWaiter = calls.some(c => callMatchesTable(c.tableLabel, t.name));
                  return (
                    <FloorTile
                      key={t.id}
                      data={{
                        id: t.id, name: t.name, seats: t.seats, shape: t.shape, state: v.state, minutes: v.minutes, guests: v.guests, orderNumber: v.order?.orderNumber, amount: v.amount,
                        needsWaiter,
                        booking: booking ? { label: bookingLabel(booking), timing: bookingTiming(booking, nowMs), name: booking.name } : undefined,
                      }}
                      settings={settings}
                      x={pos.x}
                      y={pos.y}
                      selected={selectedId === t.id}
                      dimmed={!!focus && v.state !== focus}
                      editing={editing}
                      onPointerDown={e => onTilePointerDown(e, t)}
                      onClick={() => { if (!dragRef.current?.moved) { setSelectedId(t.id); setSelectedFixtureId(null); } }}
                      onDoubleClick={() => { if (!editing) onOpenTable(t); }}
                      onKeyDown={e => nudge(e, t)}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* actions panel */}
          <aside className="rounded-2xl border bg-card shadow-card" data-testid="floor-actions">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-[14px] font-extrabold tracking-tight">{editing ? 'Layout tools' : 'Floor plan actions'}</h3>
              {selected && <button className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Clear selection" onClick={() => setSelectedId(null)}><X className="h-4 w-4" /></button>}
            </div>

            <div className="space-y-4 p-4">
              {selected && sv ? (
                <div className="rounded-xl border p-3" style={{ borderColor: stateColour(sv.state, settings) }} data-testid="floor-selected">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[16px] font-extrabold">{selected.name}</div>
                      <div className="text-[12px] text-muted-foreground">{selected.seats} chairs · {SHAPES.find(s => s.value === (selected.shape || 'square'))?.label}</div>
                    </div>
                    <span className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: stateColour(sv.state, settings), color: readableText(stateColour(sv.state, settings)) }}>
                      {FLOOR_STATE_LABEL[sv.state]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{FLOOR_STATE_HINT[sv.state]}</p>
                  {(sv.minutes !== null || sv.order) && (
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
                      {sv.minutes !== null && <div><dt className="text-muted-foreground">Seated for</dt><dd className="font-bold tabular-nums">{fmtMinutes(sv.minutes)}</dd></div>}
                      {sv.guests !== null && <div><dt className="text-muted-foreground">Guests</dt><dd className="font-bold tabular-nums">{sv.guests} / {selected.seats}</dd></div>}
                      {sv.order && <div><dt className="text-muted-foreground">Bill</dt><dd className="font-bold tabular-nums">#{sv.order.orderNumber}</dd></div>}
                      {sv.amount !== null && <div><dt className="text-muted-foreground">Amount</dt><dd className="font-bold tabular-nums">{rs(sv.amount)}</dd></div>}
                    </dl>
                  )}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed p-4 text-center text-[13px] text-muted-foreground">
                  {editing ? 'Tap a table to change its name, chairs or shape — drag it to move it.' : 'Tap a table to act on it. Double-tap to open it.'}
                </p>
              )}

              {!editing && (
                <>
                  <section>
                    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Quick action</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <ActionButton icon={ArrowRightLeft} label="Move table" disabled={!selected || !hasBill} onClick={() => selected && onBillAction(selected, 'transfer')} />
                      <ActionButton icon={Combine} label="Merge table" disabled={!selected || !hasBill} onClick={() => selected && onBillAction(selected, 'merge')} />
                      <ActionButton icon={Split} label="Split checks" disabled={!selected || !hasBill} onClick={() => selected && onBillAction(selected, 'split')} />
                      <ActionButton icon={Layers} label={available ? 'Seat guests' : 'Open table'} disabled={!selected} onClick={() => selected && onOpenTable(selected)} />
                    </div>
                  </section>
                  <section>
                    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">New order</h4>
                    <div className="space-y-2">
                      <ActionButton wide primary icon={Utensils} label="Dine-in" hint={available ? undefined : 'Pick an available table'} disabled={!available} onClick={() => selected && onOpenTable(selected)} />
                      <ActionButton wide primary icon={ShoppingBag} label="Take away" onClick={() => onNewOrder('takeaway')} />
                      <ActionButton wide primary icon={Bike} label="Delivery" onClick={() => onNewOrder('delivery')} />
                    </div>
                  </section>
                  <section>
                    <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Other</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <ActionButton icon={QrCode} label="Table QR" disabled={!selected} onClick={() => selected && onShowQr(selected)} />
                      <ActionButton icon={QrCode} label="All QRs" onClick={onAllQrs} />
                      <ActionButton icon={History} label="Dine history" disabled={!selected} onClick={() => selected && onShowHistory(selected)} />
                    </div>
                  </section>
                </>
              )}

              {editing && (
                <>
                  <section className="grid grid-cols-2 gap-2">
                    <ActionButton icon={Plus} label="Add table" onClick={addTable} />
                    <ActionButton icon={Wand2} label="Tidy up" disabled={!floorTables.length} onClick={arrange} />
                  </section>
                  <section className="space-y-2" data-testid="floor-fixtures-tools">
                    <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Counters, doors &amp; zones</h4>
                    <div className="flex gap-2">
                      <select aria-label="Fixture type" className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-[13px]" value={fxKind} onChange={e => setFxKind(e.target.value as FloorFixtureKind)}>
                        {FIXTURE_KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                      </select>
                      <Button size="sm" onClick={addFixture}><Plus className="mr-1 h-4 w-4" />Add</Button>
                    </div>
                    {selectedFixture && (
                      <div className="space-y-2 rounded-xl border p-3" data-testid="floor-fixture-props">
                        <label className="block text-[12px] font-semibold">Label
                          <input className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-[13px]" value={selectedFixture.label} onChange={e => patchFixture({ label: e.target.value.slice(0, 40) })} />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-[12px] font-semibold">Width
                            <input type="number" min={30} max={600} className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-[13px]" value={selectedFixture.w} onChange={e => patchFixture({ w: Number(e.target.value) })} />
                          </label>
                          <label className="block text-[12px] font-semibold">Height
                            <input type="number" min={30} max={400} className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-[13px]" value={selectedFixture.h} onChange={e => patchFixture({ h: Number(e.target.value) })} />
                          </label>
                        </div>
                        <Button variant="outline" size="sm" className="w-full" onClick={removeFixture}><Trash2 className="mr-1 h-4 w-4 text-destructive" />Remove {selectedFixture.label}</Button>
                      </div>
                    )}
                  </section>
                  {selected && draft && (
                    <section className="space-y-3" data-testid="floor-properties">
                      <h4 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Table properties</h4>
                      <label className="block text-[12px] font-semibold">Name
                        <input className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-[13px]" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                      </label>
                      <label className="block text-[12px] font-semibold">Chairs
                        <input type="number" min={1} max={20} className="mt-1 h-9 w-full rounded-lg border bg-background px-3 text-[13px]" value={draft.seats} onChange={e => setDraft({ ...draft, seats: e.target.value })} />
                      </label>
                      <div>
                        <div className="mb-1 text-[12px] font-semibold">Shape</div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {SHAPES.map(s => (
                            <button key={s.value} type="button" aria-pressed={draft.shape === s.value} onClick={() => setDraft({ ...draft, shape: s.value })}
                              className={cn('rounded-lg border px-2 py-1.5 text-[12.5px] font-semibold', draft.shape === s.value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted/50')}>{s.label}</button>
                          ))}
                        </div>
                      </div>
                      {hasFloors && (
                        <label className="block text-[12px] font-semibold">Floor
                          <select className="mt-1 h-9 w-full rounded-lg border bg-background px-2 text-[13px]" value={draft.floorId} onChange={e => setDraft({ ...draft, floorId: e.target.value })}>
                            <option value="">Unassigned</option>
                            {sortedFloors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        </label>
                      )}
                      <div className="flex gap-2">
                        <Button className="flex-1" disabled={!dirty} onClick={applyDraft}>Save changes</Button>
                        <Button variant="outline" size="icon" aria-label={`Delete ${selected.name}`} onClick={() => removeTable(selected)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </section>
                  )}
                  <p className="text-[11.5px] text-muted-foreground">Moving a table saves at once and updates the Floor Map too. Arrow keys nudge the selected table.</p>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ---------- status bar ---------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card px-3 py-2.5 shadow-card" data-testid="floor-statusbar">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {FLOOR_STATES.map(s => (
            <button
              key={s}
              type="button"
              aria-pressed={focus === s}
              title={`${FLOOR_STATE_LABEL[s]} — ${FLOOR_STATE_HINT[s]}`}
              onClick={() => setFocus(f => (f === s ? null : s))}
              disabled={effectiveKey === 'overview'}
              className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] font-semibold transition-colors disabled:cursor-default',
                focus === s ? 'border-primary bg-primary/10' : 'border-transparent enabled:hover:bg-muted/60',
                (effectiveKey === 'overview' ? countStates(allViews)[s] : counts[s]) === 0 && 'opacity-50')}
            >
              <span className="grid h-5 min-w-[1.35rem] place-items-center rounded px-1 text-[11px] font-extrabold tabular-nums" style={{ background: stateColour(s, settings), color: readableText(stateColour(s, settings)) }}>
                {effectiveKey === 'overview' ? countStates(allViews)[s] : counts[s]}
              </span>
              {FLOOR_STATE_LABEL[s]}
            </button>
          ))}
        </div>
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
          {(() => {
            const s = effectiveKey === 'overview' ? summarise(allViews) : summary;
            return (
              <>
                <div><dt className="inline">Tables </dt><dd className="inline font-bold text-foreground tabular-nums">{s.tables}</dd></div>
                <div><dt className="inline">In use </dt><dd className="inline font-bold text-foreground tabular-nums">{s.occupancyPct}%</dd></div>
                <div><dt className="inline">Free seats </dt><dd className="inline font-bold text-foreground tabular-nums">{s.seatsFree}/{s.seatsTotal}</dd></div>
                <div><dt className="inline">Guests </dt><dd className="inline font-bold text-foreground tabular-nums">{s.pax}</dd></div>
                <div><dt className="inline">Open bills </dt><dd className="inline font-bold text-foreground tabular-nums">{rs(s.openAmount)}</dd></div>
              </>
            );
          })()}
        </dl>
      </div>

      <FloorSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onChange={updateSettings} />
    </div>
  );
}

function ActionButton({ icon: Icon, label, hint, onClick, disabled, wide, primary }: { icon: typeof Plus; label: string; hint?: string; onClick: () => void; disabled?: boolean; wide?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled && hint ? hint : undefined}
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        wide ? 'w-full justify-start' : 'justify-start',
        primary ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-background hover:bg-muted/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {hint && disabled && <span className="truncate text-[11px] font-medium opacity-80">{hint}</span>}
    </button>
  );
}
