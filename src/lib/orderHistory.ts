// ============================================================
// Order Edit History & KOT Revision helpers
// ------------------------------------------------------------
// - diffAndLogEdits: compare prev vs next order, return new
//   OrderEditLog entries (append-only).
// - pushKotRevision: append a KotRevision (with kotNo auto-inc).
// - buildKotRevisionFromDiff: turn a printedQty diff map into a
//   KotRevision payload for the kitchen.
// All entries capture user + device for audit trail (Phase 6).
// ============================================================
import type { Order, OrderEditLog, OrderEditAction, KotRevision, KotRevisionLine, KotRevisionType, CartItem } from './types';
import { getDeviceMeta } from './tenant';

function getCurrentUser(): { id?: string; name?: string; role?: string } {
  try {
    const id = localStorage.getItem('pos-user-id') || undefined;
    const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null');
    return { id, name: u?.name || u?.username, role: u?.role };
  } catch { return {}; }
}

export function makeEditLog(action: OrderEditAction, fields: Partial<OrderEditLog> = {}): OrderEditLog {
  const u = getCurrentUser();
  let device: string | undefined;
  try { device = getDeviceMeta().deviceName; } catch {}
  return {
    at: new Date().toISOString(),
    action,
    userUid: u.id,
    userName: u.name,
    userRole: u.role,
    deviceName: device,
    ...fields,
  };
}

/** Append an edit log entry to an order (in place, returns new array). */
export function appendEditLog(order: Order, action: OrderEditAction, fields: Partial<OrderEditLog> = {}): OrderEditLog[] {
  const entry = makeEditLog(action, fields);
  return [...(order.editLogs || []), entry];
}

/** Diff the items of prev vs next; produce edit-log entries for ADD / QTY_UP / QTY_DOWN / CANCEL. */
export function diffItemEdits(prev: CartItem[] | undefined, next: CartItem[] | undefined): OrderEditLog[] {
  const prevMap = new Map<string, CartItem>();
  (prev || []).forEach(it => prevMap.set(it.id, it));
  const nextMap = new Map<string, CartItem>();
  (next || []).forEach(it => nextMap.set(it.id, it));
  const logs: OrderEditLog[] = [];
  // additions & updates
  for (const it of next || []) {
    const p = prevMap.get(it.id);
    if (!p) {
      logs.push(makeEditLog('ADD', { itemId: it.id, itemName: it.name, newValue: it.quantity }));
    } else if ((p.quantity || 0) < (it.quantity || 0)) {
      logs.push(makeEditLog('QTY_UP', { itemId: it.id, itemName: it.name, oldValue: p.quantity, newValue: it.quantity }));
    } else if ((p.quantity || 0) > (it.quantity || 0)) {
      logs.push(makeEditLog('QTY_DOWN', { itemId: it.id, itemName: it.name, oldValue: p.quantity, newValue: it.quantity }));
    }
  }
  // removed lines
  for (const p of prev || []) {
    if (!nextMap.has(p.id)) {
      logs.push(makeEditLog('CANCEL', { itemId: p.id, itemName: p.name, oldValue: p.quantity, newValue: 0 }));
    }
  }
  return logs;
}

/** Detect higher-level changes (discount, status, payment). */
export function diffOrderMeta(prev: Order, next: Order): OrderEditLog[] {
  const logs: OrderEditLog[] = [];
  if ((prev.discount || 0) !== (next.discount || 0)) {
    logs.push(makeEditLog('DISCOUNT', { oldValue: prev.discount || 0, newValue: next.discount || 0 }));
  }
  if (prev.status !== next.status) {
    if (next.status === 'void') logs.push(makeEditLog('VOID', { oldValue: prev.status, newValue: 'void', reason: next.voidReason }));
    else if (next.status === 'complimentary') logs.push(makeEditLog('COMPLIMENTARY', { oldValue: prev.status, newValue: 'complimentary', reason: next.complimentaryReason }));
    else if (next.status === 'cancelled') logs.push(makeEditLog('CANCEL_ORDER', { oldValue: prev.status, newValue: 'cancelled', reason: next.cancelReason }));
    else if (next.status === 'paid') logs.push(makeEditLog('PAYMENT', { oldValue: prev.status, newValue: `paid (PKR ${next.grandTotal})` }));
    else logs.push(makeEditLog('STATUS', { oldValue: prev.status, newValue: next.status }));
  }
  return logs;
}

/** Build a KotRevision payload from current items + a delta map (item.id -> delta). */
export function buildKotRevision(opts: {
  kotNo: number;
  items: CartItem[];
  deltas: Record<string, number>;   // positive = added, negative = cancelled
  isFirst?: boolean;
}): KotRevision {
  const u = getCurrentUser();
  let device: string | undefined;
  try { device = getDeviceMeta().deviceName; } catch {}
  const lines: KotRevisionLine[] = [];
  let hasAdd = false, hasCancel = false, hasQtyUp = false;
  for (const [itemId, delta] of Object.entries(opts.deltas)) {
    if (!delta) continue;
    const it = opts.items.find(x => x.id === itemId);
    const name = it?.name || itemId;
    lines.push({ itemId, name, deltaQty: delta, newQty: it?.quantity, note: it?.note });
    if (delta > 0) {
      if (opts.isFirst) hasAdd = true;
      else if ((it?.quantity || 0) === delta) hasAdd = true;
      else hasQtyUp = true;
    } else hasCancel = true;
  }
  let type: KotRevisionType;
  if (opts.isFirst) type = 'NEW';
  else if (hasAdd && !hasCancel && !hasQtyUp) type = 'ADD_ITEMS';
  else if (hasQtyUp && !hasCancel && !hasAdd) type = 'QTY_UPDATE';
  else if (hasCancel && !hasAdd && !hasQtyUp) type = 'CANCEL_ITEM';
  else type = 'MIXED';
  return {
    kotNo: opts.kotNo,
    type,
    lines,
    createdAt: new Date().toISOString(),
    createdByUid: u.id,
    createdByName: u.name,
    createdByRole: u.role,
    deviceName: device,
  };
}

/** Next KOT number for an order. */
export function nextKotNo(order: Order): number {
  const list = order.kotRevisions || [];
  return list.length > 0 ? Math.max(...list.map(r => r.kotNo)) + 1 : 1;
}
