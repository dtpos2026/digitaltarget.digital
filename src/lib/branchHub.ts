// ============================================================
// BRANCH MANAGEMENT — the pure part (v1.87.0)
//
// The owner's view of each branch beyond its takings: is it live right now, what stock does it hold and what is
// running low, who works there, which tills are online, how it stands against its targets — and stock moving between
// branches. No new tables: branches, inventory, users, devices and orders are the existing records; transfers and
// targets are documents in the existing document store. Every rule here is pure so it can be tested.
// ============================================================
import type { BranchTarget, InventoryItem, Order, StockTransfer, StockTransferLine } from './types';

const MIN = 60_000;

// ------------------------------------------------------------------ live status
export interface DeviceRow { id: string; label: string; platform?: string; branchId?: string | null; lastSeenAt?: string | null; approved?: boolean; blocked?: boolean }
export interface LiveStatus { lastBillAt: string | null; devicesOnline: number; devicesTotal: number; live: boolean }

/** A device counts as online when it was seen in the last 5 minutes (the heartbeat runs every 3). */
export const isOnline = (d: DeviceRow, now: number) => !!d.lastSeenAt && !d.blocked && now - Date.parse(d.lastSeenAt) <= 5 * MIN;

/**
 * A branch is "live" when one of its tills was seen in the last 5 minutes or it made a bill in the last 30.
 * Blocked devices and devices awaiting approval are not counted.
 */
export function liveStatus(orders: Order[], devices: DeviceRow[], branchId: string, now: number): LiveStatus {
  let last = 0;
  for (const o of orders) {
    if (String(o.branchId || '') !== branchId) continue;
    const t = Date.parse(o.createdAt);
    if (Number.isFinite(t) && t > last && t <= now + MIN) last = t;
  }
  const mine = devices.filter(d => String(d.branchId || '') === branchId && d.approved !== false && !d.blocked);
  const online = mine.filter(d => isOnline(d, now)).length;
  return { lastBillAt: last ? new Date(last).toISOString() : null, devicesOnline: online, devicesTotal: mine.length, live: online > 0 || (last > 0 && now - last <= 30 * MIN) };
}

// ------------------------------------------------------------------ stock
export const costOf = (i: Pick<InventoryItem, 'avgCostPrice' | 'costPrice'>) => Number(i.avgCostPrice ?? i.costPrice ?? 0) || 0;
export const branchItems = (inventory: InventoryItem[], branchId: string) => inventory.filter(i => i.isActive !== false && String(i.branchId || '') === branchId);

/** A branch's stock: how many items, what it is worth at cost, and how many are at or below their reorder level. */
export function branchStock(inventory: InventoryItem[], branchId: string): { items: number; value: number; low: number } {
  const mine = branchItems(inventory, branchId);
  return {
    items: mine.length,
    value: Math.round(mine.reduce((s, i) => s + Math.max(0, Number(i.quantity) || 0) * costOf(i), 0)),
    low: mine.filter(i => Number(i.quantity) <= Number(i.lowStockThreshold || 0)).length,
  };
}

// ------------------------------------------------------------------ staff
export interface StaffRow { id: string; name: string; role: string; branchId?: string | null; active: boolean }

/** Who works at a branch (assigned to it) and who works across all branches (no branch lock: owners, managers). */
export function staffOf(staff: StaffRow[], branchId: string): { assigned: StaffRow[]; everywhere: StaffRow[] } {
  const byName = (a: StaffRow, b: StaffRow) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name);
  return {
    assigned: staff.filter(s => String(s.branchId || '') === branchId).sort(byName),
    everywhere: staff.filter(s => !s.branchId).sort(byName),
  };
}

// ------------------------------------------------------------------ targets
export interface TargetProgress { target: number; actual: number; pct: number; expected: number; onTrack: boolean | null }

/**
 * Money taken against a target. For the month, "expected" is where the branch should be by today if it sells evenly
 * (target × day of month ÷ days in month), and on track means at or above that. Null when there is no target.
 */
export function targetProgress(actual: number, target: number | undefined, kind: 'daily' | 'monthly', now = new Date()): TargetProgress | null {
  const t = Number(target) || 0;
  if (t <= 0) return null;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expected = kind === 'monthly' ? Math.round((t * now.getDate()) / days) : t;
  return { target: t, actual, pct: Math.round((actual / t) * 100), expected, onTrack: actual >= expected };
}

/** A target typed by the owner: empty clears it; otherwise a whole positive amount. */
export function parseTarget(text: string): number | undefined | null {
  const t = String(text).replace(/[,\s]/g, '').replace(/^rs\.?/i, '');
  if (!t) return undefined;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n < 1_000_000_000 ? n : null;
}

export const targetFor = (targets: BranchTarget[], branchId: string) => targets.find(t => t.branchId === branchId);

// ------------------------------------------------------------------ stock transfers
export interface TransferDraft { fromBranchId: string; toBranchId: string; lines: { itemId: string; qty: number }[]; note?: string }

/** Everything that stops a transfer from being sent, in words; empty when it can go. */
export function validateTransfer(d: TransferDraft, inventory: InventoryItem[]): string[] {
  const errors: string[] = [];
  if (!d.fromBranchId || !d.toBranchId) errors.push('Choose both branches');
  else if (d.fromBranchId === d.toBranchId) errors.push('A branch cannot send stock to itself');
  const lines = d.lines.filter(l => l.itemId);
  if (!lines.length) errors.push('Add at least one item');
  const seen = new Set<string>();
  for (const l of lines) {
    const item = inventory.find(i => i.id === l.itemId);
    if (!item || String(item.branchId || '') !== d.fromBranchId || item.isActive === false) { errors.push('An item is not in the sending branch’s stock'); continue; }
    if (seen.has(l.itemId)) errors.push(`${item.name} is listed twice`);
    seen.add(l.itemId);
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) errors.push(`${item.name}: enter how much to send`);
    else if (qty > (Number(item.quantity) || 0) + 1e-9) errors.push(`${item.name}: only ${Number(item.quantity) || 0} ${item.baseUnit || item.unit || ''} in stock`.trim());
  }
  return [...new Set(errors)];
}

/** "TR-0007": one more than the highest number this device has seen (for people; the id is what the system uses). */
export function nextTransferNumber(transfers: StockTransfer[]): string {
  let max = 0;
  for (const t of transfers) { const m = /^TR-(\d+)$/.exec(t.number || ''); if (m) max = Math.max(max, Number(m[1])); }
  return `TR-${String(max + 1).padStart(4, '0')}`;
}

const norm = (s?: string) => (s || '').trim().toLowerCase();
const unitOf = (i: Pick<InventoryItem, 'baseUnit' | 'unit'>) => norm(i.baseUnit || i.unit);

/**
 * The receiving branch's item for a line: the same SKU when both have one, otherwise the same name in the same unit.
 * Undefined when the receiving branch does not stock it yet (it is created on receipt).
 */
export function matchItem(line: Pick<StockTransferLine, 'itemName' | 'sku' | 'unit'>, inventory: InventoryItem[], toBranchId: string): InventoryItem | undefined {
  const there = inventory.filter(i => String(i.branchId || '') === toBranchId && i.isActive !== false);
  if (line.sku) { const bySku = there.find(i => i.sku && norm(i.sku) === norm(line.sku)); if (bySku) return bySku; }
  return there.find(i => norm(i.name) === norm(line.itemName) && (!line.unit || !unitOf(i) || unitOf(i) === norm(line.unit)));
}

/** Moving-average cost after stock arrives at a cost: what the receiving branch's units are worth together. */
export function carriedCost(haveQty: number, haveCost: number, inQty: number, inCost: number): number {
  const a = Math.max(0, Number(haveQty) || 0), b = Math.max(0, Number(inQty) || 0);
  if (a + b <= 0) return Number(inCost) || Number(haveCost) || 0;
  return Math.round(((a * (Number(haveCost) || 0) + b * (Number(inCost) || 0)) / (a + b)) * 100) / 100;
}

/** The numbers of a transfer: lines, units sent and received, value at cost, and what went missing on the way. */
export function transferTotals(t: StockTransfer): { lines: number; sent: number; received: number; value: number; shortfall: number } {
  let sent = 0, received = 0, value = 0, shortfall = 0;
  for (const l of t.lines) {
    sent += l.qty;
    value += l.qty * l.unitCost;
    if (t.status === 'received') {
      const r = l.receivedQty ?? l.qty;
      received += r;
      shortfall += Math.max(0, l.qty - r);
    }
  }
  const r2 = (n: number) => Math.round(n * 1000) / 1000;
  return { lines: t.lines.length, sent: r2(sent), received: r2(received), value: Math.round(value), shortfall: r2(shortfall) };
}

/** Transfers that concern a branch, newest first; "incoming in transit" first, as they need someone. */
export function transfersFor(transfers: StockTransfer[], branchId?: string): StockTransfer[] {
  const mine = branchId ? transfers.filter(t => t.fromBranchId === branchId || t.toBranchId === branchId) : transfers;
  const rank = (t: StockTransfer) => (t.status === 'in_transit' ? 0 : 1);
  return [...mine].sort((a, b) => rank(a) - rank(b) || Date.parse(b.sentAt) - Date.parse(a.sentAt));
}

/** A received quantity typed on receipt: 0 … what was sent. */
export function parseReceived(text: string, sent: number): number | null {
  const t = String(text).replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= sent + 1e-9 ? n : null;
}
