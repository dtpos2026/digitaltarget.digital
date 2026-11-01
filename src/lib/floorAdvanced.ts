// ============================================================
// Advanced Floor View — the pure part (v1.80.0)
//
// What it is: an additional view on the Tables page. The Grid and the Floor Map
// are untouched. This file holds everything that can be decided without a
// screen: which colour a table gets, how tables are counted, where chairs sit,
// how a floor is auto-arranged, and the viewer's own settings.
//
// What it does NOT invent: every state below is derived from data the system
// already keeps (the table row and its live bill). There is no reservation
// module in this app, so there is no "Reserved" state — showing one would be a
// placeholder, not a feature.
// ============================================================
import type { DiningTable, Order, TableShape } from './types';
import { isLiveOrder, sortOrdersNewestFirst } from './orderOrder';

/** One state per table at a time. Order = how urgent it is for the floor manager (most urgent first). */
export type FloorState =
  | 'closed'
  | 'pending-payment'
  | 'overtime'
  | 'ready'
  | 'hold'
  | 'unsent'
  | 'ordered'
  | 'seated'
  | 'available';

export const FLOOR_STATES: FloorState[] = [
  'available', 'seated', 'ordered', 'unsent', 'ready', 'hold', 'overtime', 'pending-payment', 'closed',
];

export const FLOOR_STATE_LABEL: Record<FloorState, string> = {
  available: 'Available',
  seated: 'Seated',
  ordered: 'Ordered',
  unsent: 'KOT not sent',
  ready: 'Food ready',
  hold: 'On hold',
  overtime: 'Over time',
  'pending-payment': 'Pending payment',
  closed: 'Closed',
};

export const FLOOR_STATE_HINT: Record<FloorState, string> = {
  available: 'Free — can be seated',
  seated: 'Guests seated, no items yet',
  ordered: 'A bill is running',
  unsent: 'Items added but the kitchen slip has not been sent',
  ready: 'The kitchen marked the food ready to serve',
  hold: 'The bill is on hold',
  overtime: 'Seated longer than the limit set for this view',
  'pending-payment': 'The guest is paying',
  closed: 'Closed for the day',
};

// ------------------------------------------------------------------ palettes
export type FloorPalette = 'standard' | 'accessible';

export const FLOOR_PALETTES: Record<FloorPalette, Record<FloorState, string>> = {
  standard: {
    available: '#16a34a',
    seated: '#0ea5e9',
    ordered: '#4f46e5',
    unsent: '#f59e0b',
    ready: '#0d9488',
    hold: '#8b5cf6',
    overtime: '#dc2626',
    'pending-payment': '#c026d3',
    closed: '#64748b',
  },
  // Okabe–Ito based: still told apart by people with red/green colour blindness.
  accessible: {
    available: '#009e73',
    seated: '#56b4e9',
    ordered: '#0072b2',
    unsent: '#e69f00',
    ready: '#f0e442',
    hold: '#cc79a7',
    overtime: '#d55e00',
    'pending-payment': '#7b3fa0',
    closed: '#6b7280',
  },
};

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColour = (v: unknown): v is string => typeof v === 'string' && HEX.test(v.trim());

/** White or near-black, whichever reads better on `hex` (WCAG relative luminance). */
export function readableText(hex: string): '#ffffff' | '#0f172a' {
  if (!isHexColour(hex)) return '#ffffff';
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  // contrast with white = 1.05 / (lum + 0.05); with near-black ≈ (lum + 0.05) / 0.06
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.06 ? '#ffffff' : '#0f172a';
}

// ------------------------------------------------------------------ settings
export const FLOOR_SETTINGS_KEY = 'dtpos-floor-advanced-v1';

export type TileStyle = 'outlined' | 'filled';

export interface FloorSettings {
  /** 'outlined' = the DT design package's floor plan (SW-10): a card with a coloured border; 'filled' = solid colour. */
  tileStyle: TileStyle;
  /** Tile size in px at 100 % zoom. */
  tileSize: number;
  zoom: number;
  showTimer: boolean;
  showGuests: boolean;
  showAmount: boolean;
  showChairs: boolean;
  showGrid: boolean;
  snap: boolean;
  gridSize: number;
  /** Minutes seated before a table turns "Over time". */
  overtimeMinutes: number;
  palette: FloorPalette;
  /** Per-state colour the owner picked; wins over the palette. */
  colors: Partial<Record<FloorState, string>>;
}

export const DEFAULT_FLOOR_SETTINGS: FloorSettings = {
  tileStyle: 'outlined',
  tileSize: 96,
  zoom: 1,
  showTimer: true,
  showGuests: true,
  showAmount: true,
  showChairs: true,
  showGrid: true,
  snap: true,
  gridSize: 20,
  overtimeMinutes: 90,
  palette: 'standard',
  colors: {},
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Reads anything (a half-written or old value) into a valid settings object. Never throws. */
export function normalizeFloorSettings(raw: unknown): FloorSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_FLOOR_SETTINGS;
  const colors: Partial<Record<FloorState, string>> = {};
  if (r.colors && typeof r.colors === 'object') {
    for (const s of FLOOR_STATES) {
      const c = (r.colors as Record<string, unknown>)[s];
      if (isHexColour(c)) colors[s] = c.trim().toLowerCase();
    }
  }
  return {
    tileStyle: r.tileStyle === 'filled' ? 'filled' : 'outlined',
    tileSize: Math.round(clamp(num(r.tileSize, d.tileSize), 72, 140)),
    zoom: Math.round(clamp(num(r.zoom, d.zoom), 0.5, 1.5) * 100) / 100,
    showTimer: bool(r.showTimer, d.showTimer),
    showGuests: bool(r.showGuests, d.showGuests),
    showAmount: bool(r.showAmount, d.showAmount),
    showChairs: bool(r.showChairs, d.showChairs),
    showGrid: bool(r.showGrid, d.showGrid),
    snap: bool(r.snap, d.snap),
    gridSize: [10, 20, 40].includes(num(r.gridSize, d.gridSize)) ? num(r.gridSize, d.gridSize) : d.gridSize,
    overtimeMinutes: Math.round(clamp(num(r.overtimeMinutes, d.overtimeMinutes), 15, 480)),
    palette: r.palette === 'accessible' ? 'accessible' : 'standard',
    colors,
  };
}

export function loadFloorSettings(): FloorSettings {
  try { return normalizeFloorSettings(JSON.parse(localStorage.getItem(FLOOR_SETTINGS_KEY) || 'null')); }
  catch { return { ...DEFAULT_FLOOR_SETTINGS, colors: {} }; }
}
export function saveFloorSettings(s: FloorSettings): void {
  try { localStorage.setItem(FLOOR_SETTINGS_KEY, JSON.stringify(normalizeFloorSettings(s))); } catch { /* private mode / full */ }
}

export function stateColour(state: FloorState, s: FloorSettings): string {
  return s.colors[state] || FLOOR_PALETTES[s.palette][state];
}

// ------------------------------------------------------------------ state
/**
 * The live bill of a table, without changing anything.
 * The table's own pointer wins when it still points at a live bill; otherwise the
 * newest live bill that names this table. (The Tables page repairs stale
 * pointers; this view only reads.)
 */
export function liveOrderOf(table: DiningTable, orders: Order[]): Order | undefined {
  if (table.currentOrderId) {
    const byPointer = orders.find(o => o.id === table.currentOrderId && isLiveOrder(o));
    if (byPointer) return byPointer;
  }
  return sortOrdersNewestFirst(orders.filter(o => o.tableId === table.id && isLiveOrder(o)))[0];
}

export function minutesSeated(table: DiningTable, nowMs: number): number | null {
  if (!table.seatedAt) return null;
  const t = new Date(table.seatedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60000));
}

export function deriveTableState(table: DiningTable, order: Order | undefined, nowMs: number, overtimeMinutes: number): FloorState {
  if (table.status === 'closed') return 'closed';
  if (table.status === 'pending-payment') return 'pending-payment';
  const occupied = !!order || table.status === 'running';
  if (!occupied) return 'available';
  const mins = minutesSeated(table, nowMs);
  if (mins !== null && mins >= overtimeMinutes) return 'overtime';
  if (order?.kitchenStatus === 'ready') return 'ready';
  if (order?.status === 'hold') return 'hold';
  if (order && order.items.length > 0 && order.kotPrinted === false) return 'unsent';
  if (order) return 'ordered';
  return 'seated';
}

export interface TableView {
  table: DiningTable;
  order?: Order;
  state: FloorState;
  /** Minutes since the guests sat down; null when nobody is seated. */
  minutes: number | null;
  guests: number | null;
  amount: number | null;
}

export function buildTableViews(tables: DiningTable[], orders: Order[], nowMs: number, overtimeMinutes: number): TableView[] {
  return tables.map(table => {
    const order = liveOrderOf(table, orders);
    const state = deriveTableState(table, order, nowMs, overtimeMinutes);
    const occupied = state !== 'available' && state !== 'closed';
    return {
      table,
      order,
      state,
      minutes: occupied ? minutesSeated(table, nowMs) : null,
      guests: occupied ? (table.seatedGuests ?? null) : null,
      amount: order ? Number(order.grandTotal || 0) : null,
    };
  });
}

export function countStates(views: TableView[]): Record<FloorState, number> {
  const out = Object.fromEntries(FLOOR_STATES.map(s => [s, 0])) as Record<FloorState, number>;
  for (const v of views) out[v.state]++;
  return out;
}

export interface FloorSummary {
  tables: number;
  occupied: number;
  available: number;
  seatsTotal: number;
  seatsFree: number;
  /** Guests seated right now (only what was recorded when seating). */
  pax: number;
  /** Sum of the open bills. */
  openAmount: number;
  /** Share of tables in use, 0–100. */
  occupancyPct: number;
}

export function summarise(views: TableView[]): FloorSummary {
  let occupied = 0, available = 0, seatsTotal = 0, seatsFree = 0, pax = 0, openAmount = 0, open = 0;
  for (const v of views) {
    seatsTotal += v.table.seats || 0;
    if (v.state === 'closed') continue;
    open++;
    if (v.state === 'available') { available++; seatsFree += v.table.seats || 0; continue; }
    occupied++;
    pax += v.guests ?? 0;
    openAmount += v.amount ?? 0;
  }
  return {
    tables: views.length,
    occupied,
    available,
    seatsTotal,
    seatsFree,
    pax,
    openAmount,
    occupancyPct: open ? Math.round((occupied / open) * 100) : 0,
  };
}

export function fmtMinutes(mins: number | null): string {
  if (mins === null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}m`;
}

// ------------------------------------------------------------------ geometry
export interface TileSize { w: number; h: number }
/** A rectangle table is wider than it is tall; round and square tables are square. */
export function tileSizeOf(shape: TableShape | undefined, base: number): TileSize {
  return shape === 'rectangle' ? { w: Math.round(base * 1.4), h: base } : { w: base, h: base };
}

/** Snaps to the grid, or leaves the value alone when snapping is off. */
export function snapTo(v: number, grid: number, on: boolean): number {
  return on && grid > 0 ? Math.round(v / grid) * grid : Math.round(v);
}

/** Keeps a tile inside the canvas. */
export function clampToCanvas(x: number, y: number, size: TileSize, canvas: { width: number; height: number }) {
  return {
    x: clamp(x, 0, Math.max(0, canvas.width - size.w)),
    y: clamp(y, 0, Math.max(0, canvas.height - size.h)),
  };
}

const hasXY = (t: DiningTable) => Number.isFinite(t.x as number) && Number.isFinite(t.y as number);

/**
 * Natural order (Table 2 before Table 10). Local copy of the rule in tableOrder.ts so this
 * file stays free of page imports.
 */
function natural(a: string, b: string): number {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Where every table of a floor stands. Tables the manager already placed keep their spot
 * (so the Floor Map and this view share one layout); tables never placed fill free cells of a
 * tidy grid, in natural name order.
 */
export function placeTables(tables: DiningTable[], base: number, canvasWidth: number): Array<DiningTable & { x: number; y: number }> {
  const cellW = Math.round(base * 1.7);
  const cellH = Math.round(base * 1.6);
  const margin = 20;
  const cols = Math.max(1, Math.floor((canvasWidth - margin) / cellW));
  const placed = tables.filter(hasXY);
  const taken = new Set(placed.map(t => `${Math.round(((t.x as number) - margin) / cellW)}:${Math.round(((t.y as number) - margin) / cellH)}`));
  const loose = tables.filter(t => !hasXY(t)).sort((a, b) => natural(a.name, b.name));
  const pos = new Map<string, { x: number; y: number }>();
  let i = 0;
  for (const t of loose) {
    let col = i % cols, row = Math.floor(i / cols);
    while (taken.has(`${col}:${row}`)) { i++; col = i % cols; row = Math.floor(i / cols); }
    taken.add(`${col}:${row}`);
    pos.set(t.id, { x: margin + col * cellW, y: margin + row * cellH });
    i++;
  }
  return tables.map(t => (hasXY(t) ? (t as DiningTable & { x: number; y: number }) : { ...t, ...pos.get(t.id)! }));
}

/** A tidy grid for the whole floor, in natural name order. Returns only the changed coordinates. */
export function autoArrange(tables: DiningTable[], base: number, canvasWidth: number): Array<{ id: string; x: number; y: number }> {
  const cellW = Math.round(base * 1.7);
  const cellH = Math.round(base * 1.6);
  const margin = 20;
  const cols = Math.max(1, Math.floor((canvasWidth - margin) / cellW));
  return tables
    .slice()
    .sort((a, b) => natural(a.name, b.name))
    .map((t, i) => ({ id: t.id, x: margin + (i % cols) * cellW, y: margin + Math.floor(i / cols) * cellH }));
}

/** The canvas is at least as large as the screen needs, and grows to hold every tile. */
export function canvasSizeFor(tables: Array<{ x: number; y: number; shape?: TableShape }>, base: number, min = { width: 960, height: 560 }) {
  let w = min.width, h = min.height;
  for (const t of tables) {
    const s = tileSizeOf(t.shape, base);
    w = Math.max(w, t.x + s.w + 40);
    h = Math.max(h, t.y + s.h + 56);
  }
  return { width: w, height: h };
}

/**
 * "Table 7" when the highest "Table N" is 6. Names that are not "Table <number>" (a bar, a booth, "Roof 1")
 * are ignored when counting, and a name already in use is never handed out again.
 */
export function nextTableName(existing: Array<{ name: string }>): string {
  let max = 0;
  for (const t of existing) {
    const m = /^table\s*(\d+)$/i.exec((t.name || '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  const names = new Set(existing.map(t => (t.name || '').trim().toLowerCase()));
  let n = max + 1;
  while (names.has(`table ${n}`)) n++;
  return `Table ${n}`;
}

// ------------------------------------------------------------------ chairs
export interface Chair { x: number; y: number; w: number; h: number; rot: number }

/**
 * Chair marks around a table of `w × h`, drawn in a box that already includes `pad` for the chairs.
 * Round tables spread chairs evenly on a circle; square and rectangle tables spread them over the four
 * sides, longer sides first.
 */
export function chairLayout(shape: TableShape | undefined, seats: number, w: number, h: number): Chair[] {
  const n = clamp(Math.round(seats) || 1, 1, 20);
  const cx = w / 2, cy = h / 2;
  const cw = Math.max(9, Math.round(Math.min(w, h) * 0.17));
  const ch = Math.max(5, Math.round(cw * 0.45));
  const out: Chair[] = [];
  if (shape === 'round') {
    const r = Math.min(w, h) / 2 - ch / 2 - 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, w: cw, h: ch, rot: (a * 180) / Math.PI + 90 });
    }
    return out;
  }
  // sides: top, bottom get more when the table is wide
  const wide = w >= h * 1.2;
  const sides = wide ? [0, 2, 1, 3] : [0, 1, 2, 3]; // fill order: top, bottom, right, left (wide) / top, right, bottom, left
  const count = [0, 0, 0, 0]; // top, right, bottom, left
  for (let i = 0; i < n; i++) count[sides[i % 4]]++;
  const ins = ch / 2 + 1;
  const spread = (k: number, len: number) => Array.from({ length: k }, (_, i) => ((i + 1) / (k + 1)) * len);
  spread(count[0], w).forEach(x => out.push({ x, y: ins, w: cw, h: ch, rot: 0 }));
  spread(count[1], h).forEach(y => out.push({ x: w - ins, y, w: cw, h: ch, rot: 90 }));
  spread(count[2], w).forEach(x => out.push({ x, y: h - ins, w: cw, h: ch, rot: 180 }));
  spread(count[3], h).forEach(y => out.push({ x: ins, y, w: cw, h: ch, rot: 270 }));
  return out;
}
