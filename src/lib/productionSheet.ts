// ============================================================================
// Production day sheet (v1.115.1) — what was planned, what was made, what sold, what was left, per branch and per day.
//
// The bakery question after the day: "we made 120, we sold 96 — where are the other 24?" The sheet answers it with three numbers:
//   unsold     = made − sold                 what must still be on the shelf (or was given away / wasted / eaten)
//   left over  = what the baker counted on the shelf at closing (typed in; empty = not counted yet)
//   gap        = unsold − left over          pieces that are not on the shelf and were not sold: waste, giveaways, errors
// Waste % = unsold ÷ made — the share of the day's baking that did not sell (the bakery's one number to bring down).
// Stored as one small document per branch and day in the synced document store (no new table). Pure functions.
// ============================================================================
export interface SheetLine { menuItemId: string; name: string; planned: number; made: number; leftover: number | null }

export interface ProductionSheet {
  id: string;
  /** YYYY-MM-DD, the restaurant's local day */
  date: string;
  /** the branch that baked it; empty for a restaurant with one branch */
  branchId?: string;
  lines: SheetLine[];
  note?: string;
  updatedAt: string;
  updatedBy?: string;
}

export const sheetId = (date: string, branchId?: string): string => `${branchId || 'main'}:${date}`;

const whole = (v: unknown): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
export const cleanLeftover = (v: unknown): number | null => (v === '' || v === null || v === undefined ? null : whole(v));

export interface Reconciled { itemId: string; name: string; planned: number; made: number; sold: number; unsold: number; leftover: number | null; gap: number | null; wastePct: number | null }

export function reconcile(lines: SheetLine[], sold: Map<string, number>): Reconciled[] {
  return lines.map(l => {
    const s = sold.get(l.menuItemId) ?? 0;
    const unsold = l.made - s;                                // may be negative: more sold than made today (yesterday's stock)
    return {
      itemId: l.menuItemId, name: l.name, planned: l.planned, made: l.made, sold: s, unsold,
      leftover: l.leftover, gap: l.leftover === null ? null : unsold - l.leftover,
      wastePct: l.made > 0 ? Math.round((Math.max(0, unsold) / l.made) * 1000) / 10 : null,
    };
  });
}

export interface SheetTotals { planned: number; made: number; sold: number; unsold: number; gap: number; counted: number; wastePct: number | null }
export function totals(rows: Reconciled[]): SheetTotals {
  const t = { planned: 0, made: 0, sold: 0, unsold: 0, gap: 0, counted: 0 };
  for (const r of rows) {
    t.planned += r.planned; t.made += r.made; t.sold += r.sold; t.unsold += Math.max(0, r.unsold);
    if (r.gap !== null) { t.gap += r.gap; t.counted++; }
  }
  return { ...t, wastePct: t.made > 0 ? Math.round((t.unsold / t.made) * 1000) / 10 : null };
}

/** A new sheet from the plan's figures (item id → suggested number): planned is filled, nothing is made yet. */
export function sheetFromPlan(date: string, branchId: string | undefined, plan: { itemId: string; name: string; qty: number }[], by?: string): ProductionSheet {
  return {
    id: sheetId(date, branchId), date, ...(branchId ? { branchId } : {}),
    lines: plan.filter(p => p.qty > 0).map(p => ({ menuItemId: p.itemId, name: p.name, planned: whole(p.qty), made: 0, leftover: null })),
    updatedAt: new Date().toISOString(), ...(by ? { updatedBy: by } : {}),
  };
}

/** One more batch of an item that is already on the sheet (a tray of 12 came out of the oven). Negative never goes below zero. */
export function addMade(sheet: ProductionSheet, menuItemId: string, pieces: number): ProductionSheet {
  return { ...sheet, lines: sheet.lines.map(l => (l.menuItemId === menuItemId ? { ...l, made: Math.max(0, l.made + Math.floor(pieces)) } : l)) };
}

export function setLine(sheet: ProductionSheet, menuItemId: string, patch: Partial<Pick<SheetLine, 'planned' | 'made' | 'leftover'>>): ProductionSheet {
  return {
    ...sheet,
    lines: sheet.lines.map(l => (l.menuItemId !== menuItemId ? l : {
      ...l,
      ...(patch.planned !== undefined ? { planned: whole(patch.planned) } : {}),
      ...(patch.made !== undefined ? { made: whole(patch.made) } : {}),
      ...(patch.leftover !== undefined ? { leftover: cleanLeftover(patch.leftover) } : {}),
    })),
  };
}

export function addItem(sheet: ProductionSheet, menuItemId: string, name: string): ProductionSheet {
  if (sheet.lines.some(l => l.menuItemId === menuItemId)) return sheet;
  return { ...sheet, lines: [...sheet.lines, { menuItemId, name, planned: 0, made: 0, leftover: null }] };
}
