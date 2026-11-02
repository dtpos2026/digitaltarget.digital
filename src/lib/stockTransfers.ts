// ============================================================
// STOCK TRANSFERS between branches — the part that moves stock (v1.87.0)
//
//   send:    out of the sending branch's items          → status "in transit"
//   receive: into the receiving branch's items          → status "received" (what arrived; a shortfall is recorded)
//   cancel:  back into the sending branch's items       → status "cancelled" (only while in transit)
//
// Stock only ever moves through adjustStock() with a movement id per line and step ("transfer:<id>:out:<line>"), so a
// retried tap, a replayed sync or a second device can never move the same stock twice (the stock ledger refuses a
// movement id it has seen). The receiving branch's item is found by SKU or name (lib/branchHub.ts matchItem) or created
// for that branch, and its moving-average cost takes in the transferred units at the cost they left with.
// ============================================================
import type { InventoryItem, StockTransfer } from './types';
import { adjustStock, genId, getInventory, getStockTransfers, saveInventoryItem, saveStockTransfer } from './store';
import { carriedCost, costOf, matchItem, nextTransferNumber, validateTransfer, type TransferDraft } from './branchHub';

export type Result = { ok: true; transfer: StockTransfer } | { ok: false; error: string };

const fresh = (id: string) => getStockTransfers().find(t => t.id === id);

/** Sends stock: checks the draft against today's stock, takes it out of the sending branch, records the transfer. */
export function sendTransfer(draft: TransferDraft, by: string, now = new Date()): Result {
  const inventory = getInventory();
  const errors = validateTransfer(draft, inventory);
  if (errors.length) return { ok: false, error: errors[0] };
  const id = genId();
  const lines = draft.lines.filter(l => l.itemId).map(l => {
    const item = inventory.find(i => i.id === l.itemId)!;
    return {
      id: genId(), fromItemId: item.id, itemName: item.name, sku: item.sku || undefined, unit: item.baseUnit || item.unit || '',
      qty: Number(l.qty), unitCost: costOf(item),
    };
  });
  const transfer: StockTransfer = {
    id, number: nextTransferNumber(getStockTransfers()), fromBranchId: draft.fromBranchId, toBranchId: draft.toBranchId,
    status: 'in_transit', lines, note: draft.note?.trim() || undefined, sentAt: now.toISOString(), sentBy: by || undefined, branchId: draft.fromBranchId,
  };
  for (const l of lines) {
    adjustStock(l.fromItemId, l.qty, 'out', `Transfer ${transfer.number} — sent`, { movementId: `transfer:${id}:out:${l.id}`, refType: 'transfer', refId: id });
  }
  saveStockTransfer(transfer);
  return { ok: true, transfer };
}

/**
 * Receives a transfer: what arrived goes into the receiving branch's items (created there when the branch does not
 * stock them yet). `received` maps a line id to what arrived (default: everything sent); the rest is a shortfall.
 */
export function receiveTransfer(id: string, by: string, received: Record<string, number> = {}, now = new Date()): Result {
  const t = fresh(id);
  if (!t) return { ok: false, error: 'This transfer is not on this device yet' };
  if (t.status !== 'in_transit') return { ok: false, error: t.status === 'received' ? 'Already received' : 'This transfer was cancelled' };
  const lines = t.lines.map(l => ({ ...l, receivedQty: Math.max(0, Math.min(l.qty, received[l.id] ?? l.qty)) }));
  for (const l of lines) {
    const inventory = getInventory();
    let dest: InventoryItem | undefined = matchItem(l, inventory, t.toBranchId);
    if (!dest) {
      const src = inventory.find(i => i.id === l.fromItemId);
      dest = {
        id: genId(), name: l.itemName, sku: l.sku || src?.sku || '', categoryId: src?.categoryId || '',
        costPrice: l.unitCost, avgCostPrice: l.unitCost, salePrice: src?.salePrice || 0, quantity: 0,
        unit: src?.unit || l.unit, baseUnit: src?.baseUnit, conversions: src?.conversions, lowStockThreshold: src?.lowStockThreshold || 0,
        image: src?.image, isActive: true, branchId: t.toBranchId,
      };
      saveInventoryItem(dest);
    }
    if (l.receivedQty > 0) {
      const target = getInventory().find(i => i.id === dest!.id)!;
      target.avgCostPrice = carriedCost(Number(target.quantity) || 0, costOf(target), l.receivedQty, l.unitCost);
      if (!Number(target.costPrice)) target.costPrice = l.unitCost;
      saveInventoryItem(target);
      adjustStock(target.id, l.receivedQty, 'in', `Transfer ${t.number} — received`, { movementId: `transfer:${id}:in:${l.id}`, refType: 'transfer', refId: id });
    }
    l.toItemId = dest.id;
  }
  const next: StockTransfer = { ...t, lines, status: 'received', receivedAt: now.toISOString(), receivedBy: by || undefined };
  saveStockTransfer(next);
  return { ok: true, transfer: next };
}

/** Cancels a transfer still in transit: the stock goes back into the sending branch's items. */
export function cancelTransfer(id: string, by: string, reason = '', now = new Date()): Result {
  const t = fresh(id);
  if (!t) return { ok: false, error: 'This transfer is not on this device yet' };
  if (t.status !== 'in_transit') return { ok: false, error: t.status === 'received' ? 'It has already been received' : 'Already cancelled' };
  for (const l of t.lines) {
    adjustStock(l.fromItemId, l.qty, 'in', `Transfer ${t.number} — cancelled, back in stock`, { movementId: `transfer:${id}:back:${l.id}`, refType: 'transfer', refId: id });
  }
  const next: StockTransfer = { ...t, status: 'cancelled', cancelledAt: now.toISOString(), cancelledBy: by || undefined, cancelReason: reason.trim() || undefined };
  saveStockTransfer(next);
  return { ok: true, transfer: next };
}
