// ============================================================================
// PROCUREMENT — purchase orders, receiving against them, reorder suggestions (v1.79.0).
//
// WHY: the benchmark analysis (docs/COMPETITIVE-ANALYSIS-TECHNOSYS.md) found goods receiving but no purchase order anywhere in
// the product — no approval, no "what did we order vs what arrived", no suggestion of what to buy. Stock alerts told an owner
// an item was low and left the rest to memory and a phone call.
//
// PURE: no store, no clock, no ids generated here except through the arguments, so the whole workflow is testable.
// Persistence and stock movement stay where they already live: receiving still goes through saveReceivingEntry(), which owns
// the stock quantity and the moving-average cost. This module only decides WHAT to receive and keeps the PO's books.
// ============================================================================
import type { InventoryItem, ReceivingEntry, StockLog, Party, PurchaseOrder, PurchaseOrderLine, PoStatus } from './types';
import { getBaseUnit, toBaseQty } from './units';

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const r3 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000;

// ---------------------------------------------------------------- status machine
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: 'Draft', approved: 'Approved', sent: 'Sent to supplier', partial: 'Partly received', received: 'Received', cancelled: 'Cancelled',
};

const NEXT: Record<PoStatus, PoStatus[]> = {
  draft: ['approved', 'cancelled'],
  approved: ['sent', 'cancelled', 'draft'],
  sent: ['partial', 'received', 'cancelled'],
  partial: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};
export const canTransition = (from: PoStatus, to: PoStatus) => NEXT[from]?.includes(to) ?? false;
/** Can lines still be edited? Only before approval: an approved order is what the supplier was told. */
export const isEditable = (po: Pick<PurchaseOrder, 'status'>) => po.status === 'draft';
/** Can goods still be received against it? */
export const isReceivable = (po: Pick<PurchaseOrder, 'status'>) => po.status === 'approved' || po.status === 'sent' || po.status === 'partial';

// ---------------------------------------------------------------- numbers and totals
/** PO-0001, PO-0002 … continuing from the highest number already used (never reusing one after a deletion). */
export function nextPoNumber(existing: Pick<PurchaseOrder, 'number'>[]): string {
  let max = 0;
  for (const p of existing) { const m = /^PO-(\d+)$/.exec(p.number || ''); if (m) max = Math.max(max, Number(m[1])); }
  return `PO-${String(max + 1).padStart(4, '0')}`;
}

export const lineTotal = (l: Pick<PurchaseOrderLine, 'quantity' | 'rate'>) => r2((Number(l.quantity) || 0) * (Number(l.rate) || 0));
export const lineRemaining = (l: Pick<PurchaseOrderLine, 'quantity' | 'receivedQty'>) => Math.max(0, r3((Number(l.quantity) || 0) - (Number(l.receivedQty) || 0)));

export function poTotals(po: Pick<PurchaseOrder, 'lines'>): { ordered: number; received: number; outstanding: number } {
  let ordered = 0, received = 0;
  for (const l of po.lines) { ordered += lineTotal(l); received += r2((Number(l.receivedQty) || 0) * (Number(l.rate) || 0)); }
  return { ordered: r2(ordered), received: r2(received), outstanding: r2(Math.max(0, ordered - received)) };
}

/** What to call the order's state given what has arrived (the PO's own status says what was DONE, this says what is true). */
export function receivedStatus(po: Pick<PurchaseOrder, 'lines'>): 'none' | 'partial' | 'full' {
  const any = po.lines.some(l => (Number(l.receivedQty) || 0) > 0);
  if (!any) return 'none';
  return po.lines.every(l => lineRemaining(l) <= 0) ? 'full' : 'partial';
}

// ---------------------------------------------------------------- validation
export interface PoProblem { field: string; message: string }

/** Everything wrong with a purchase order, or []. An order with a problem cannot be approved. */
export function validatePo(po: Pick<PurchaseOrder, 'supplierId' | 'lines'>): PoProblem[] {
  const out: PoProblem[] = [];
  if (!po.supplierId) out.push({ field: 'supplier', message: 'Choose a supplier.' });
  if (!po.lines.length) out.push({ field: 'lines', message: 'Add at least one item.' });
  const seen = new Set<string>();
  po.lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.inventoryItemId) out.push({ field: `line${n}`, message: `Line ${n}: choose an item.` });
    if (!(Number(l.quantity) > 0)) out.push({ field: `line${n}`, message: `Line ${n}: quantity must be more than 0.` });
    if (!(Number(l.rate) >= 0) || !Number.isFinite(Number(l.rate))) out.push({ field: `line${n}`, message: `Line ${n}: rate must be 0 or more.` });
    const key = `${l.inventoryItemId}|${l.unit}`;
    if (l.inventoryItemId && seen.has(key)) out.push({ field: `line${n}`, message: `Line ${n}: the same item and unit is already on this order.` });
    seen.add(key);
  });
  return out;
}

// ---------------------------------------------------------------- receiving
export interface ReceiptInput { lineId: string; quantity: number }

export interface ReceiveResult {
  ok: boolean;
  error?: string;
  po?: PurchaseOrder;
  /** Entries for saveReceivingEntry(): it applies the stock and the moving-average cost. */
  entries: ReceivingEntry[];
  /** The supplier ledger line to record: what we now owe. */
  payable?: { partyId: string; amount: number; description: string; reference: string };
}

/**
 * Receive goods against an order.
 *
 * Rules, each pinned by a test:
 *  - only an approved / sent / partly received order can be received against;
 *  - a quantity of 0 (or less) on a line is skipped, not an error — the form posts every line;
 *  - nothing may be received beyond what is still outstanding on a line, unless `allowOver` (a supplier sometimes sends extra);
 *  - `extraCharges` (freight, loading) are spread over the received lines in proportion to their value, so the moving-average
 *    cost reflects the landed cost, exactly as a direct goods-receiving note does;
 *  - the order becomes "received" when every line is complete, otherwise "partial";
 *  - the amount owed is the value of what arrived plus the extra charges — never the value of what was merely ordered.
 */
export function receiveAgainstPo(
  po: PurchaseOrder,
  receipts: ReceiptInput[],
  ctx: { now: string; by: string; newId: () => string; extraCharges?: number; allowOver?: boolean; inventory: InventoryItem[] },
): ReceiveResult {
  if (!isReceivable(po)) return { ok: false, error: `A ${PO_STATUS_LABEL[po.status].toLowerCase()} order cannot be received against.`, entries: [] };
  const inv = new Map(ctx.inventory.map(i => [i.id, i]));
  const wanted = receipts.filter(r => Number(r.quantity) > 0);
  if (!wanted.length) return { ok: false, error: 'Enter a received quantity on at least one line.', entries: [] };

  for (const r of wanted) {
    const l = po.lines.find(x => x.id === r.lineId);
    if (!l) return { ok: false, error: 'A received line is not on this order.', entries: [] };
    if (!inv.get(l.inventoryItemId)) return { ok: false, error: `${l.itemName} is no longer in inventory, so its stock cannot be updated.`, entries: [] };
    if (!ctx.allowOver && Number(r.quantity) > lineRemaining(l) + 1e-9) {
      return { ok: false, error: `${l.itemName}: ${r.quantity} is more than the ${lineRemaining(l)} still to come.`, entries: [] };
    }
  }

  const extra = Math.max(0, Number(ctx.extraCharges) || 0);
  const valueOf = (r: ReceiptInput) => (Number(r.quantity) || 0) * (po.lines.find(x => x.id === r.lineId)!.rate || 0);
  const totalValue = wanted.reduce((s, r) => s + valueOf(r), 0);

  const entries: ReceivingEntry[] = [];
  let payable = 0;
  const lines = po.lines.map(l => {
    const r = wanted.find(x => x.lineId === l.id);
    if (!r) return l;
    const qty = Number(r.quantity);
    // Spread the extra charges by value; a zero-value delivery (free goods) takes an equal share instead.
    const share = extra <= 0 ? 0 : totalValue > 0 ? extra * (valueOf(r) / totalValue) : extra / wanted.length;
    payable += qty * (l.rate || 0) + share;
    entries.push({
      id: ctx.newId(), supplierName: po.supplierName, inventoryItemId: l.inventoryItemId, itemName: l.itemName,
      quantity: qty, unit: l.unit, rate: l.rate, surcharge: r2(share), receivedBy: ctx.by,
      notes: `Against ${po.number}`, date: ctx.now,
    });
    return { ...l, receivedQty: r3((Number(l.receivedQty) || 0) + qty) };
  });

  const next: PurchaseOrder = { ...po, lines, status: 'partial', receipts: [...(po.receipts || []), { at: ctx.now, by: ctx.by, extraCharges: r2(extra), lines: wanted.map(r => ({ lineId: r.lineId, quantity: Number(r.quantity) })) }] };
  next.status = receivedStatus(next) === 'full' ? 'received' : 'partial';
  return {
    ok: true, po: next, entries,
    payable: { partyId: po.supplierId, amount: r2(payable), description: `Goods received against ${po.number}`, reference: po.number },
  };
}

/** Close an order that will receive nothing more (the supplier short-shipped and will not send the rest). */
export function closeShort(po: PurchaseOrder, now: string, by: string): PurchaseOrder {
  if (po.status !== 'partial') return po;
  return { ...po, status: 'received', closedShort: { at: now, by }, };
}

// ---------------------------------------------------------------- reorder suggestions
export interface ReorderOptions {
  nowMs: number;
  /** Days of recent use to average. */
  windowDays?: number;
  /** Days of stock to order up to, on top of the alert level. */
  coverDays?: number;
}

export interface ReorderSuggestion {
  item: InventoryItem;
  onHand: number;                    // base unit
  alertLevel: number;                // base unit
  avgDailyUse: number;               // base unit / day, over the window
  target: number;                    // base unit: alert level + cover days of use
  needBase: number;                  // base unit to buy
  purchaseUnit: string;
  suggestedQty: number;              // in purchase unit, rounded UP to whole packs
  rate: number;                      // per purchase unit, from the latest receipt (else cost price × pack)
  supplierName?: string;             // who last supplied it
  lastReceivedAt?: string;
  value: number;
}

/**
 * Items at or below their alert level, with how much to buy.
 *
 *   average daily use = stock taken out (sales and issues) in the window ÷ window days
 *   target            = alert level + average daily use × cover days
 *   need              = target − on hand           (only when on hand ≤ alert level)
 *   buy               = need, rounded UP to whole packs of the item's first purchase unit (else its base unit)
 *
 * A stock count that was never adjusted for use shows zero average use, and the suggestion then simply refills to the alert
 * level plus nothing — it never invents demand.
 */
export function suggestReorders(inventory: InventoryItem[], stockLogs: Pick<StockLog, 'inventoryItemId' | 'type' | 'quantity' | 'date'>[], receiving: ReceivingEntry[], opts: ReorderOptions): ReorderSuggestion[] {
  const windowDays = opts.windowDays ?? 30, coverDays = opts.coverDays ?? 7;
  const since = opts.nowMs - windowDays * 86_400_000;
  const used = new Map<string, number>();
  for (const l of stockLogs) {
    if ((l.type !== 'sale' && l.type !== 'out') || !(Date.parse(l.date) >= since)) continue;
    used.set(l.inventoryItemId, (used.get(l.inventoryItemId) || 0) + Math.abs(Number(l.quantity) || 0));
  }
  const last = new Map<string, ReceivingEntry>();
  for (const e of receiving) {
    if (!e.inventoryItemId) continue;
    const cur = last.get(e.inventoryItemId);
    if (!cur || Date.parse(e.date) > Date.parse(cur.date)) last.set(e.inventoryItemId, e);
  }

  const out: ReorderSuggestion[] = [];
  for (const item of inventory) {
    if (item.isActive === false) continue;
    const alertLevel = Number(item.lowStockThreshold) || 0;
    const onHand = Number(item.quantity) || 0;
    if (alertLevel <= 0 || onHand > alertLevel) continue;
    const avg = (used.get(item.id) || 0) / windowDays;
    const target = alertLevel + avg * coverDays;
    const needBase = Math.max(0, target - onHand);
    if (needBase <= 0) continue;

    const pack = item.conversions?.find(c => c.factor > 0);
    const purchaseUnit = pack ? pack.unit : getBaseUnit(item);
    const factor = pack ? pack.factor : 1;
    const suggestedQty = Math.ceil(needBase / factor - 1e-9);
    const lastE = last.get(item.id);
    // Rate per purchase unit: the latest receipt's, converted if it was bought in another unit; else cost price × pack size.
    let rate = (item.avgCostPrice ?? item.costPrice ?? 0) * factor;
    if (lastE) {
      const perBase = lastE.baseUnitCost && lastE.baseUnitCost > 0 ? lastE.baseUnitCost : lastE.baseQty ? (lastE.rate * lastE.quantity) / lastE.baseQty : 0;
      if (perBase > 0) rate = perBase * factor;
    }
    out.push({
      item, onHand, alertLevel, avgDailyUse: r3(avg), target: r3(target), needBase: r3(needBase), purchaseUnit, suggestedQty,
      rate: r2(rate), supplierName: lastE?.supplierName, lastReceivedAt: lastE?.date, value: r2(suggestedQty * rate),
    });
  }
  // Emptiest first: how far below the alert level, as a share of it.
  return out.sort((a, b) => (a.onHand / a.alertLevel) - (b.onHand / b.alertLevel));
}

/** Turn suggestions into draft order lines, grouped by the supplier who last supplied each item. */
export function draftsFromSuggestions(
  suggestions: ReorderSuggestion[], parties: Party[], newId: () => string,
): { supplierId: string; supplierName: string; lines: PurchaseOrderLine[] }[] {
  const byName = new Map(parties.filter(p => p.type === 'supplier' && p.isActive !== false).map(p => [p.name.trim().toLowerCase(), p]));
  const groups = new Map<string, { supplierId: string; supplierName: string; lines: PurchaseOrderLine[] }>();
  for (const s of suggestions) {
    const party = s.supplierName ? byName.get(s.supplierName.trim().toLowerCase()) : undefined;
    const key = party?.id || '';
    const g = groups.get(key) || { supplierId: party?.id || '', supplierName: party?.name || '', lines: [] };
    g.lines.push({ id: newId(), inventoryItemId: s.item.id, itemName: s.item.name, unit: s.purchaseUnit, quantity: s.suggestedQty, rate: s.rate, receivedQty: 0 });
    groups.set(key, g);
  }
  // A group with a known supplier first, the "no supplier yet" group last.
  return [...groups.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1));
}

/** Base-unit quantity of a PO line (for showing what it adds to stock). */
export function lineBaseQty(line: Pick<PurchaseOrderLine, 'quantity' | 'unit'>, item: InventoryItem | undefined): number {
  return item ? r3(toBaseQty(item, Number(line.quantity) || 0, line.unit)) : Number(line.quantity) || 0;
}
