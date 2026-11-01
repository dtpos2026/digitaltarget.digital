// v1.80.0 — Advanced Floor View: the rules behind the colours, the counts, the layout and the settings.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  FLOOR_STATES, FLOOR_PALETTES, DEFAULT_FLOOR_SETTINGS, FLOOR_SETTINGS_KEY,
  deriveTableState, buildTableViews, countStates, summarise, liveOrderOf, minutesSeated, fmtMinutes,
  normalizeFloorSettings, loadFloorSettings, saveFloorSettings, stateColour, readableText, isHexColour,
  tileSizeOf, snapTo, clampToCanvas, placeTables, autoArrange, canvasSizeFor, nextTableName, chairLayout,
} from '@/lib/floorAdvanced';
import type { DiningTable, Order } from '@/lib/types';

const NOW = new Date('2026-11-01T12:00:00Z').getTime();
const ago = (mins: number) => new Date(NOW - mins * 60000).toISOString();

const table = (o: Partial<DiningTable> = {}): DiningTable => ({ id: 't1', name: 'Table 1', seats: 4, status: 'free', shape: 'square', ...o });
const order = (o: Partial<Order> = {}): Order => ({
  id: 'o1', orderNumber: 1, status: 'running', tableId: 't1', items: [{ id: 'i', name: 'Karahi', quantity: 1, lineTotal: 1500 } as any],
  grandTotal: 1500, createdAt: ago(10), kotPrinted: true, ...o,
} as Order);

describe('table state (one state per table, most urgent first)', () => {
  it('a free table with no bill is available', () => {
    expect(deriveTableState(table(), undefined, NOW, 90)).toBe('available');
  });
  it('seated but no bill yet', () => {
    expect(deriveTableState(table({ status: 'running', seatedAt: ago(5) }), undefined, NOW, 90)).toBe('seated');
  });
  it('a running bill is ordered', () => {
    expect(deriveTableState(table({ status: 'running', seatedAt: ago(20) }), order(), NOW, 90)).toBe('ordered');
  });
  it('items added but the kitchen slip not sent', () => {
    expect(deriveTableState(table({ status: 'running', seatedAt: ago(5) }), order({ kotPrinted: false }), NOW, 90)).toBe('unsent');
  });
  it('an empty bill with an unsent flag is not "unsent" (nothing to send)', () => {
    expect(deriveTableState(table({ status: 'running', seatedAt: ago(5) }), order({ kotPrinted: false, items: [] }), NOW, 90)).toBe('ordered');
  });
  it('food ready outranks ordered and unsent', () => {
    expect(deriveTableState(table({ status: 'running', seatedAt: ago(20) }), order({ kitchenStatus: 'ready', kotPrinted: false }), NOW, 90)).toBe('ready');
  });
  it('a bill on hold', () => {
    expect(deriveTableState(table({ status: 'running', seatedAt: ago(20) }), order({ status: 'hold' }), NOW, 90)).toBe('hold');
  });
  it('over time once the limit is reached, and not a minute before', () => {
    const t = (m: number) => table({ status: 'running', seatedAt: ago(m) });
    expect(deriveTableState(t(89), order(), NOW, 90)).toBe('ordered');
    expect(deriveTableState(t(90), order(), NOW, 90)).toBe('overtime');
  });
  it('the limit is the viewer\'s setting', () => {
    expect(deriveTableState(table({ status: 'running', seatedAt: ago(50) }), order(), NOW, 45)).toBe('overtime');
  });
  it('pending payment and closed come from the table and outrank everything', () => {
    expect(deriveTableState(table({ status: 'pending-payment', seatedAt: ago(500) }), order(), NOW, 90)).toBe('pending-payment');
    expect(deriveTableState(table({ status: 'closed' }), undefined, NOW, 90)).toBe('closed');
  });
  it('a live bill makes the table occupied even when its own status drifted to free', () => {
    expect(deriveTableState(table({ status: 'free' }), order(), NOW, 90)).toBe('ordered');
  });
  it('a free table never shows a timer, even if an old seatedAt is left on it', () => {
    const [v] = buildTableViews([table({ status: 'free', seatedAt: ago(5000) })], [], NOW, 90);
    expect(v.state).toBe('available');
    expect(v.minutes).toBeNull();
  });
});

describe('finding a table\'s live bill (read-only)', () => {
  it('follows the table pointer', () => {
    const o = order({ id: 'a' });
    expect(liveOrderOf(table({ currentOrderId: 'a' }), [o, order({ id: 'b', createdAt: ago(1) })])?.id).toBe('a');
  });
  it('falls back to the newest live bill that names the table when the pointer is stale', () => {
    const old = order({ id: 'old', createdAt: ago(60) });
    const fresh = order({ id: 'fresh', createdAt: ago(5) });
    expect(liveOrderOf(table({ currentOrderId: 'gone' }), [old, fresh])?.id).toBe('fresh');
  });
  it('ignores paid and void bills', () => {
    expect(liveOrderOf(table(), [order({ status: 'paid' as any }), order({ id: 'v', status: 'void' as any })])).toBeUndefined();
  });
  it('does not change anything it is given', () => {
    const t = table({ currentOrderId: 'gone' });
    const copy = JSON.stringify(t);
    liveOrderOf(t, [order()]);
    expect(JSON.stringify(t)).toBe(copy);
  });
});

describe('counts and summary', () => {
  const tables = [
    table({ id: 'a', name: 'T1', seats: 4 }),
    table({ id: 'b', name: 'T2', seats: 2, status: 'running', seatedAt: ago(10), seatedGuests: 2 }),
    table({ id: 'c', name: 'T3', seats: 6, status: 'running', seatedAt: ago(200), seatedGuests: 5 }),
    table({ id: 'd', name: 'T4', seats: 4, status: 'closed' }),
    table({ id: 'e', name: 'T5', seats: 8, status: 'pending-payment', seatedAt: ago(40), seatedGuests: 6 }),
  ];
  const orders = [
    order({ id: 'ob', tableId: 'b', grandTotal: 1000 }),
    order({ id: 'oc', tableId: 'c', grandTotal: 4000 }),
    order({ id: 'oe', tableId: 'e', grandTotal: 3000 }),
  ];
  const views = buildTableViews(tables, orders, NOW, 90);

  it('counts each table exactly once, so the chips add up to the total', () => {
    const c = countStates(views);
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(tables.length);
    expect(c.available).toBe(1);
    expect(c.ordered).toBe(1);
    expect(c.overtime).toBe(1);
    expect(c['pending-payment']).toBe(1);
    expect(c.closed).toBe(1);
  });
  it('has an entry for every state', () => {
    expect(Object.keys(countStates([])).sort()).toEqual([...FLOOR_STATES].sort());
  });
  it('summarises seats, guests, open money and occupancy (closed tables are not counted as open)', () => {
    const s = summarise(views);
    expect(s.tables).toBe(5);
    expect(s.occupied).toBe(3);
    expect(s.available).toBe(1);
    expect(s.seatsTotal).toBe(24);
    expect(s.seatsFree).toBe(4);
    expect(s.pax).toBe(13);
    expect(s.openAmount).toBe(8000);
    expect(s.occupancyPct).toBe(75); // 3 of the 4 tables that are open
  });
  it('an empty floor is 0 %, not NaN', () => {
    expect(summarise([]).occupancyPct).toBe(0);
  });
});

describe('time', () => {
  it('minutes seated, and none when nobody sat', () => {
    expect(minutesSeated(table({ seatedAt: ago(37) }), NOW)).toBe(37);
    expect(minutesSeated(table(), NOW)).toBeNull();
    expect(minutesSeated(table({ seatedAt: 'not a date' }), NOW)).toBeNull();
  });
  it('a clock in the future never shows a negative time', () => {
    expect(minutesSeated(table({ seatedAt: ago(-30) }), NOW)).toBe(0);
  });
  it('formats short and long times', () => {
    expect(fmtMinutes(5)).toBe('5m');
    expect(fmtMinutes(65)).toBe('1:05');
    expect(fmtMinutes(null)).toBe('');
  });
});

describe('colours', () => {
  it('every state has a distinct colour in each palette', () => {
    for (const p of Object.values(FLOOR_PALETTES)) {
      expect(Object.keys(p).sort()).toEqual([...FLOOR_STATES].sort());
      expect(new Set(Object.values(p)).size).toBe(FLOOR_STATES.length);
      Object.values(p).forEach(c => expect(isHexColour(c)).toBe(true));
    }
  });
  it('the owner\'s own colour wins over the palette', () => {
    const s = normalizeFloorSettings({ colors: { available: '#123456' } });
    expect(stateColour('available', s)).toBe('#123456');
    expect(stateColour('seated', s)).toBe(FLOOR_PALETTES.standard.seated);
  });
  it('text on a tile is readable: white on dark, near-black on light', () => {
    expect(readableText('#4f46e5')).toBe('#ffffff');
    expect(readableText('#f0e442')).toBe('#0f172a');
    expect(readableText('#ffffff')).toBe('#0f172a');
    expect(readableText('#000000')).toBe('#ffffff');
  });
  it('every palette colour has a readable label colour', () => {
    // contrast of the chosen text on the tile is at least 3:1 (large bold label) for every default colour
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    for (const p of Object.values(FLOOR_PALETTES)) {
      for (const bg of Object.values(p)) {
        const [hi, lo] = [lum(bg), lum(readableText(bg))].sort((a, b) => b - a);
        expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('rejects colours that are not 6-digit hex', () => {
    expect(isHexColour('#abc')).toBe(false);
    expect(isHexColour('red')).toBe(false);
    expect(isHexColour(undefined)).toBe(false);
  });
});

describe('viewer settings', () => {
  beforeEach(() => localStorage.clear());
  it('defaults', () => {
    expect(normalizeFloorSettings(undefined)).toEqual(DEFAULT_FLOOR_SETTINGS);
    expect(loadFloorSettings()).toEqual(DEFAULT_FLOOR_SETTINGS);
  });
  it('clamps out-of-range numbers instead of trusting them', () => {
    const s = normalizeFloorSettings({ tileSize: 9999, zoom: 0.01, overtimeMinutes: 1, gridSize: 7 });
    expect(s.tileSize).toBe(140);
    expect(s.zoom).toBe(0.5);
    expect(s.overtimeMinutes).toBe(15);
    expect(s.gridSize).toBe(DEFAULT_FLOOR_SETTINGS.gridSize);
  });
  it('drops junk: wrong types, an unknown palette, bad colours', () => {
    const s = normalizeFloorSettings({ showTimer: 'yes', palette: 'neon', colors: { available: 'green', seated: '#ABCDEF', nonsense: '#000000' } });
    expect(s.showTimer).toBe(true);
    expect(s.palette).toBe('standard');
    expect(s.colors).toEqual({ seated: '#abcdef' });
  });
  it('survives a save and a reload', () => {
    saveFloorSettings({ ...DEFAULT_FLOOR_SETTINGS, tileSize: 110, showAmount: false, palette: 'accessible', colors: { overtime: '#ff0000' } });
    const s = loadFloorSettings();
    expect(s.tileSize).toBe(110);
    expect(s.showAmount).toBe(false);
    expect(s.palette).toBe('accessible');
    expect(s.colors.overtime).toBe('#ff0000');
  });
  it('a corrupt stored value falls back to defaults', () => {
    localStorage.setItem(FLOOR_SETTINGS_KEY, '{not json');
    expect(loadFloorSettings()).toEqual(DEFAULT_FLOOR_SETTINGS);
  });
});

describe('layout', () => {
  it('rectangle tables are wider; the others are square', () => {
    expect(tileSizeOf('rectangle', 100)).toEqual({ w: 140, h: 100 });
    expect(tileSizeOf('round', 100)).toEqual({ w: 100, h: 100 });
    expect(tileSizeOf(undefined, 100)).toEqual({ w: 100, h: 100 });
  });
  it('snaps to the grid only when asked', () => {
    expect(snapTo(47, 20, true)).toBe(40);
    expect(snapTo(51, 20, true)).toBe(60);
    expect(snapTo(47.4, 20, false)).toBe(47);
  });
  it('keeps a tile inside the canvas', () => {
    const c = { width: 500, height: 300 };
    expect(clampToCanvas(-10, -10, { w: 100, h: 100 }, c)).toEqual({ x: 0, y: 0 });
    expect(clampToCanvas(900, 900, { w: 100, h: 100 }, c)).toEqual({ x: 400, y: 200 });
  });
  it('tables already placed keep their position; new ones fill free cells without overlapping', () => {
    const tables = [
      table({ id: 'a', name: 'Table 1', x: 20, y: 20 }),
      table({ id: 'b', name: 'Table 10' }),
      table({ id: 'c', name: 'Table 2' }),
    ];
    const out = placeTables(tables, 96, 960);
    expect(out.find(t => t.id === 'a')).toMatchObject({ x: 20, y: 20 });
    const b = out.find(t => t.id === 'b')!, c = out.find(t => t.id === 'c')!;
    expect(`${b.x}:${b.y}`).not.toBe('20:20');
    expect(`${c.x}:${c.y}`).not.toBe(`${b.x}:${b.y}`);
    // natural order: Table 2 is placed before Table 10
    expect(c.x).toBeLessThan(b.x);
  });
  it('placing does not change the tables it was given', () => {
    const tables = [table({ id: 'a' })];
    placeTables(tables, 96, 960);
    expect(tables[0].x).toBeUndefined();
  });
  it('auto-arrange puts every table on its own cell, in natural order', () => {
    const tables = ['Table 10', 'Table 2', 'Table 1'].map((n, i) => table({ id: `t${i}`, name: n }));
    const r = autoArrange(tables, 96, 960);
    expect(r.map(x => x.id)).toEqual(['t2', 't1', 't0']);
    expect(new Set(r.map(x => `${x.x}:${x.y}`)).size).toBe(3);
  });
  it('auto-arrange wraps to a new row when the canvas is full', () => {
    const tables = Array.from({ length: 12 }, (_, i) => table({ id: `t${i}`, name: `Table ${i + 1}` }));
    const r = autoArrange(tables, 96, 960);
    expect(Math.max(...r.map(x => x.y))).toBeGreaterThan(Math.min(...r.map(x => x.y)));
    expect(Math.max(...r.map(x => x.x))).toBeLessThanOrEqual(960);
  });
  it('the canvas grows to hold the furthest tile and never shrinks below the minimum', () => {
    expect(canvasSizeFor([], 96)).toEqual({ width: 960, height: 560 });
    const big = canvasSizeFor([{ x: 1500, y: 900, shape: 'rectangle' }], 100);
    expect(big.width).toBe(1500 + 140 + 40);
    expect(big.height).toBe(900 + 100 + 56);
  });
});

describe('new table names', () => {
  it('continues from the highest number', () => {
    expect(nextTableName([{ name: 'Table 1' }, { name: 'Table 7' }])).toBe('Table 8');
  });
  it('starts at 1 on an empty floor', () => {
    expect(nextTableName([])).toBe('Table 1');
  });
  it('ignores names that are not "Table <number>"', () => {
    expect(nextTableName([{ name: 'Table 2' }, { name: 'Table 1' }, { name: 'Terrace A' }, { name: 'Roof 9' }])).toBe('Table 3');
  });
  it('never repeats a name that is taken, whatever its spacing or case', () => {
    expect(nextTableName([{ name: 'TABLE1' }, { name: 'table 2' }])).toBe('Table 3');
  });
});

describe('chairs', () => {
  it('draws one chair per seat', () => {
    for (const shape of ['round', 'square', 'rectangle'] as const) {
      for (const seats of [1, 2, 4, 6, 8, 12]) {
        expect(chairLayout(shape, seats, 96, 96)).toHaveLength(seats);
      }
    }
  });
  it('caps at 20 and never fewer than 1', () => {
    expect(chairLayout('round', 99, 96, 96)).toHaveLength(20);
    expect(chairLayout('square', 0, 96, 96)).toHaveLength(1);
  });
  it('keeps every chair inside the tile box', () => {
    for (const shape of ['round', 'square', 'rectangle'] as const) {
      for (const c of chairLayout(shape, 8, 134, 96)) {
        expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThanOrEqual(134);
        expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(96);
      }
    }
  });
  it('a wide table puts its first chairs on the long sides', () => {
    const c = chairLayout('rectangle', 2, 140, 100);
    expect(c.map(x => x.rot).sort()).toEqual([0, 180]);
  });
});
