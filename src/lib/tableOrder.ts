// ============================================================
// v1.15.1 — "I put the tables in running number in the Floor Map,
//            but in Grid it doesn't go in order."
//
// The Grid never sorted at all. `filteredTables` only filtered by floor and
// then rendered whatever order the store happened to hold — which is insert
// order, reshuffled by every cloud sync. The client's screenshot shows the
// result: Table 4, 1, 2, 3, 5 / 6, 10, 11, 8, 9.
//
// Floor Map, by contrast, positions tables by the x/y the manager dragged
// them to. So the two views could never agree.
//
// Rule below: if the floor map has been arranged, the Grid follows it —
// reading left-to-right, top-to-bottom, exactly how a person reads a room.
// Otherwise fall back to the table NAME in natural numeric order, so
// "Table 9" comes before "Table 10" (a plain string sort puts 10 first,
// which is the other half of what the client was seeing).
import type { DiningTable } from './types';

/** Rows within this many pixels count as the same row of the floor plan. */
const ROW_BAND_PX = 60;

/**
 * Natural comparison: splits digits from text so Table 2 < Table 10.
 * Falls back to plain locale compare for names without numbers.
 */
export function compareNatural(a: string, b: string): number {
  const rx = /(\d+)|(\D+)/g;
  const ax = String(a || '').toLowerCase().match(rx) || [];
  const bx = String(b || '').toLowerCase().match(rx) || [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const an = Number(ax[i]);
    const bn = Number(bx[i]);
    const bothNum = !Number.isNaN(an) && !Number.isNaN(bn);
    if (bothNum) {
      if (an !== bn) return an - bn;
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

function hasLayout(tables: DiningTable[]): boolean {
  return tables.some(t => Number.isFinite(t.x as number) && Number.isFinite(t.y as number));
}

/**
 * Grid display order. Pure and non-mutating — returns a new array.
 *
 * Tables placed on the floor map lead, in reading order; anything never
 * dragged onto the map follows in natural name order. That way arranging
 * the map really does drive the grid, which is what was asked for, without
 * hiding tables that have no coordinates yet.
 */
export function sortTablesForGrid(tables: DiningTable[]): DiningTable[] {
  const list = tables.slice();
  if (!hasLayout(list)) {
    return list.sort((a, b) => compareNatural(a.name, b.name));
  }
  const placed = list.filter(t => Number.isFinite(t.x as number) && Number.isFinite(t.y as number));
  const loose = list.filter(t => !(Number.isFinite(t.x as number) && Number.isFinite(t.y as number)));

  placed.sort((a, b) => {
    const rowA = Math.round((a.y as number) / ROW_BAND_PX);
    const rowB = Math.round((b.y as number) / ROW_BAND_PX);
    if (rowA !== rowB) return rowA - rowB;
    const dx = (a.x as number) - (b.x as number);
    if (dx !== 0) return dx;
    return compareNatural(a.name, b.name);
  });
  loose.sort((a, b) => compareNatural(a.name, b.name));
  return [...placed, ...loose];
}
