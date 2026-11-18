// ============================================================================
// Stock lots and expiry (v1.117.1) — "what is going off, and use it first".
//
// A bakery's flour keeps for months, its cream for days, its dough for one. A LOT is one receipt (or one batch) of an item with the date
// it spoils. Stock still has one number per item (`quantity`), exactly as before — lots are the dated layers inside it:
//   • a receipt with an expiry date, or a batch with a shelf life, opens a lot;
//   • whatever leaves stock (a sale, wastage, a batch's raw material, a stock-count loss) is taken from the lot that expires first
//     (FEFO — first expired, first out), so what is on the shelf is always the newest;
//   • the Expiry screen lists the lots by days left, and writes off what has expired.
// Stock that has no lot (older stock, items without a date) behaves as before. If the stock number is brought down by hand (a count) the
// lots shrink from the soonest-to-expire end, so a lot can never claim more than is really there.
// Pure functions, dates are the restaurant's local YYYY-MM-DD.
// ============================================================================
export type LotSource = 'receiving' | 'production' | 'opening';

export interface StockLot {
  id: string;
  inventoryItemId: string;
  itemName: string;
  branchId?: string;
  /** YYYY-MM-DD it came in */
  receivedAt: string;
  /** YYYY-MM-DD it goes off; none = does not expire */
  expiryDate?: string;
  /** what it was, in the item's base unit */
  qty: number;
  /** what is left of it, in the item's base unit */
  remaining: number;
  /** cost per base unit */
  unitCost: number;
  source: LotSource;
  /** the receiving entry or the batch it came from */
  refId?: string;
  note?: string;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Soonest to expire first; a lot with no date after all dated ones; ties by arrival. */
export function fefoOrder(a: Pick<StockLot, 'expiryDate' | 'receivedAt'>, b: Pick<StockLot, 'expiryDate' | 'receivedAt'>): number {
  if (a.expiryDate && b.expiryDate && a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
  if (!!a.expiryDate !== !!b.expiryDate) return a.expiryDate ? -1 : 1;
  return a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0;
}

/**
 * Takes `qty` out of the lots, soonest-expiring first. Returns only the lots that changed (with their new `remaining`) and what could
 * not be taken from any lot (stock that had no lot) — that part is simply undated stock, nothing to do.
 */
export function consumeFefo(lots: StockLot[], qty: number): { changed: StockLot[]; unallocated: number } {
  let left = Math.max(0, num(qty));
  const changed: StockLot[] = [];
  for (const l of [...lots].filter(x => num(x.remaining) > 0).sort(fefoOrder)) {
    if (left <= 1e-9) break;
    const take = Math.min(left, num(l.remaining));
    changed.push({ ...l, remaining: r6(num(l.remaining) - take) });
    left = r6(left - take);
  }
  return { changed, unallocated: Math.max(0, left) };
}

/**
 * The lots as they really are, given what is physically on hand: if the lots add up to more than `onHand` (a count brought the stock
 * down, a hand edit), the stock that is missing is taken from the soonest-to-expire end — the newest lots keep their quantity.
 */
export function effectiveLots(lots: StockLot[], onHand: number): StockLot[] {
  let room = Math.max(0, num(onHand));
  const kept = new Map<string, number>();
  for (const l of [...lots].filter(x => num(x.remaining) > 0).sort(fefoOrder).reverse()) {
    const q = Math.min(room, num(l.remaining));
    kept.set(l.id, r6(q)); room = r6(room - q);
  }
  return lots.filter(l => (kept.get(l.id) ?? 0) > 1e-9).map(l => ({ ...l, remaining: kept.get(l.id)! })).sort(fefoOrder);
}

const utc = (ymd: string): number => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };

/** Whole days from `today` to `expiry` (negative = already expired, 0 = expires today); null when there is no date. */
export function daysLeft(expiry: string | undefined, today: string): number | null {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  return Math.round((utc(expiry) - utc(today)) / 86_400_000);
}

export type ExpiryStatus = 'expired' | 'today' | 'soon' | 'ok' | 'none';
/** expired: before today; today: expires today (still usable, last day); soon: within `soonDays`; ok; none: no date. */
export function expiryStatus(days: number | null, soonDays = 7): ExpiryStatus {
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  return days <= soonDays ? 'soon' : 'ok';
}

export const lotValue = (l: Pick<StockLot, 'remaining' | 'unitCost'>): number => Math.round(num(l.remaining) * num(l.unitCost) * 100) / 100;

export interface ExpirySummary { expired: { lots: number; value: number }; today: { lots: number; value: number }; soon: { lots: number; value: number }; ok: number }
export function summarizeLots(lots: StockLot[], today: string, soonDays = 7): ExpirySummary {
  const s: ExpirySummary = { expired: { lots: 0, value: 0 }, today: { lots: 0, value: 0 }, soon: { lots: 0, value: 0 }, ok: 0 };
  for (const l of lots) {
    if (!(num(l.remaining) > 0)) continue;
    const st = expiryStatus(daysLeft(l.expiryDate, today), soonDays);
    if (st === 'expired' || st === 'today' || st === 'soon') { s[st].lots++; s[st].value = Math.round((s[st].value + lotValue(l)) * 100) / 100; }
    else s.ok++;
  }
  return s;
}

/** What has expired, per item: the quantity (base unit) and its value — what "Write off expired" will take out. */
export function expiredByItem(lots: StockLot[], today: string): Map<string, { qty: number; value: number; name: string }> {
  const out = new Map<string, { qty: number; value: number; name: string }>();
  for (const l of lots) {
    if (!(num(l.remaining) > 0) || expiryStatus(daysLeft(l.expiryDate, today)) !== 'expired') continue;
    const cur = out.get(l.inventoryItemId) ?? { qty: 0, value: 0, name: l.itemName };
    cur.qty = r6(cur.qty + num(l.remaining)); cur.value = Math.round((cur.value + lotValue(l)) * 100) / 100;
    out.set(l.inventoryItemId, cur);
  }
  return out;
}

/** A new lot from a receipt or batch. Returns null when there is nothing to track (no quantity). */
export function newLot(input: { id: string; inventoryItemId: string; itemName: string; branchId?: string; receivedAt: string; expiryDate?: string; qty: number; unitCost: number; source: LotSource; refId?: string; note?: string }): StockLot | null {
  const qty = num(input.qty);
  if (!(qty > 0)) return null;
  const expiry = input.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate) ? input.expiryDate : undefined;
  return { id: input.id, inventoryItemId: input.inventoryItemId, itemName: input.itemName, branchId: input.branchId, receivedAt: input.receivedAt, expiryDate: expiry, qty: r6(qty), remaining: r6(qty), unitCost: Math.max(0, num(input.unitCost)), source: input.source, refId: input.refId, note: input.note?.trim() || undefined };
}
