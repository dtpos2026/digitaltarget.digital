// ============================================================================
// v1.79.0 — procurement: purchase orders, receiving against them, reorder suggestions. Expected numbers are worked out by hand.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canTransition, isEditable, isReceivable, nextPoNumber, lineTotal, lineRemaining, poTotals, receivedStatus, validatePo,
  receiveAgainstPo, closeShort, suggestReorders, draftsFromSuggestions,
} from '@/lib/procurement';
import type { PurchaseOrder, PurchaseOrderLine, InventoryItem, ReceivingEntry, Party } from '@/lib/types';

const NOW = '2026-11-01T10:00:00Z';
const NOW_MS = Date.parse(NOW);
let n = 0;
const newId = () => `id${++n}`;

const item = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id, name: id, sku: id, categoryId: 'c', costPrice: 0, salePrice: 0, quantity: 0, unit: 'kg', baseUnit: 'kg', lowStockThreshold: 0, isActive: true, ...over,
} as InventoryItem);

const line = (id: string, itemId: string, qty: number, rate: number, over: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine => ({
  id, inventoryItemId: itemId, itemName: itemId, unit: 'kg', quantity: qty, rate, receivedQty: 0, ...over,
});

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po1', number: 'PO-0001', supplierId: 's1', supplierName: 'Meat Co', status: 'approved',
  lines: [line('l1', 'chicken', 50, 800), line('l2', 'rice', 100, 200)], createdAt: NOW, ...over,
});
const INVENTORY = [item('chicken'), item('rice')];
const ctx = (over: Record<string, unknown> = {}) => ({ now: NOW, by: 'Ali', newId, inventory: INVENTORY, ...over });

describe('status machine', () => {
  it('moves forward only along the allowed paths', () => {
    expect(canTransition('draft', 'approved')).toBe(true);
    expect(canTransition('approved', 'sent')).toBe(true);
    expect(canTransition('sent', 'partial')).toBe(true);
    expect(canTransition('draft', 'received')).toBe(false);      // cannot receive what was never approved
    expect(canTransition('received', 'cancelled')).toBe(false);  // a finished order is final
    expect(canTransition('cancelled', 'draft')).toBe(false);
  });
  it('only a draft can be edited; goods can be received only once approved', () => {
    expect(isEditable({ status: 'draft' })).toBe(true);
    expect(isEditable({ status: 'approved' })).toBe(false);
    for (const s of ['approved', 'sent', 'partial'] as const) expect(isReceivable({ status: s })).toBe(true);
    for (const s of ['draft', 'received', 'cancelled'] as const) expect(isReceivable({ status: s })).toBe(false);
  });
});

describe('numbers and totals', () => {
  it('continues from the highest number and never reuses one after a deletion', () => {
    expect(nextPoNumber([])).toBe('PO-0001');
    expect(nextPoNumber([{ number: 'PO-0001' }, { number: 'PO-0007' }, { number: 'PO-0003' }])).toBe('PO-0008');
    expect(nextPoNumber([{ number: 'legacy-1' }, { number: 'PO-0099' }])).toBe('PO-0100');
  });
  it('line and order totals', () => {
    const p = po({ lines: [line('a', 'chicken', 50, 800, { receivedQty: 20 }), line('b', 'rice', 100, 200)] });
    expect(lineTotal(p.lines[0])).toBe(40000);
    expect(lineRemaining(p.lines[0])).toBe(30);
    expect(poTotals(p)).toEqual({ ordered: 60000, received: 16000, outstanding: 44000 });
  });
  it('received state reflects what arrived', () => {
    expect(receivedStatus(po())).toBe('none');
    expect(receivedStatus(po({ lines: [line('a', 'x', 10, 1, { receivedQty: 4 })] }))).toBe('partial');
    expect(receivedStatus(po({ lines: [line('a', 'x', 10, 1, { receivedQty: 10 }), line('b', 'y', 5, 1, { receivedQty: 5 })] }))).toBe('full');
  });
});

describe('validation', () => {
  it('a good order has no problems', () => { expect(validatePo(po())).toEqual([]); });
  it('names every problem in plain words', () => {
    const msgs = validatePo({ supplierId: '', lines: [line('a', '', 0, -1), line('b', 'rice', 5, 1), line('c', 'rice', 5, 1)] }).map(p => p.message);
    expect(msgs).toContain('Choose a supplier.');
    expect(msgs).toContain('Line 1: choose an item.');
    expect(msgs).toContain('Line 1: quantity must be more than 0.');
    expect(msgs).toContain('Line 1: rate must be 0 or more.');
    expect(msgs).toContain('Line 3: the same item and unit is already on this order.');
  });
  it('an empty order cannot be approved', () => {
    expect(validatePo({ supplierId: 's', lines: [] }).map(p => p.message)).toContain('Add at least one item.');
  });
});

describe('receiving against an order', () => {
  it('partial delivery: stock entries for what arrived, the order becomes "partial", and we owe only for what arrived', () => {
    const r = receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 20 }, { lineId: 'l2', quantity: 0 }], ctx());
    expect(r.ok).toBe(true);
    expect(r.po!.status).toBe('partial');
    expect(r.po!.lines.map(l => l.receivedQty)).toEqual([20, 0]);
    expect(r.entries).toHaveLength(1);                           // the zero line is skipped, not an error
    expect(r.entries[0]).toMatchObject({ inventoryItemId: 'chicken', quantity: 20, unit: 'kg', rate: 800, surcharge: 0, supplierName: 'Meat Co', notes: 'Against PO-0001' });
    expect(r.payable).toMatchObject({ partyId: 's1', amount: 16000, reference: 'PO-0001' });
    expect(r.po!.receipts).toHaveLength(1);
  });

  it('delivering the remainder completes the order', () => {
    const first = receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 20 }], ctx()).po!;
    const second = receiveAgainstPo(first, [{ lineId: 'l1', quantity: 30 }, { lineId: 'l2', quantity: 100 }], ctx());
    expect(second.po!.status).toBe('received');
    expect(second.payable!.amount).toBe(30 * 800 + 100 * 200);
    expect(second.po!.receipts).toHaveLength(2);
  });

  it('refuses more than is still outstanding, and says how much is', () => {
    const r = receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 51 }], ctx());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/51 is more than the 50 still to come/);
    expect(r.entries).toEqual([]);
  });

  it('accepts an over-delivery only when told to', () => {
    const r = receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 55 }], ctx({ allowOver: true }));
    expect(r.ok).toBe(true);
    expect(r.po!.lines[0].receivedQty).toBe(55);
    expect(r.po!.status).toBe('partial');                        // l2 still outstanding
  });

  it('spreads freight over the received lines by value, so the landed cost is right', () => {
    // received value: 10 kg chicken = 8,000 and 40 kg rice = 8,000; freight 1,000 -> 500 each
    const r = receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 10 }, { lineId: 'l2', quantity: 40 }], ctx({ extraCharges: 1000 }));
    expect(r.entries.map(e => e.surcharge)).toEqual([500, 500]);
    expect(r.payable!.amount).toBe(8000 + 8000 + 1000);
    expect(r.po!.receipts![0].extraCharges).toBe(1000);
  });

  it('weights the freight share by value when the lines differ', () => {
    // 10 kg chicken = 8,000 (80%), 10 kg rice = 2,000 (20%); freight 500 -> 400 / 100
    const r = receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 10 }, { lineId: 'l2', quantity: 10 }], ctx({ extraCharges: 500 }));
    expect(r.entries.map(e => e.surcharge)).toEqual([400, 100]);
  });

  it('will not receive against a draft, a finished or a cancelled order', () => {
    for (const status of ['draft', 'received', 'cancelled'] as const) {
      const r = receiveAgainstPo(po({ status }), [{ lineId: 'l1', quantity: 1 }], ctx());
      expect(r.ok, status).toBe(false);
      expect(r.entries).toEqual([]);
    }
  });

  it('needs at least one quantity, a known line, and an item that still exists', () => {
    expect(receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 0 }], ctx()).error).toMatch(/at least one line/);
    expect(receiveAgainstPo(po(), [{ lineId: 'nope', quantity: 1 }], ctx()).error).toMatch(/not on this order/);
    expect(receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 1 }], ctx({ inventory: [] })).error).toMatch(/no longer in inventory/);
  });

  it('does not mutate the order it was given', () => {
    const original = po();
    const snapshot = JSON.stringify(original);
    receiveAgainstPo(original, [{ lineId: 'l1', quantity: 10 }], ctx());
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('closing short finishes a partly received order and records who did it', () => {
    const partial = receiveAgainstPo(po(), [{ lineId: 'l1', quantity: 20 }], ctx()).po!;
    const closed = closeShort(partial, NOW, 'Ali');
    expect(closed.status).toBe('received');
    expect(closed.closedShort).toEqual({ at: NOW, by: 'Ali' });
    expect(closeShort(po(), NOW, 'Ali').status).toBe('approved');   // only a partly received order can be closed short
  });
});

describe('reorder suggestions', () => {
  const day = (d: number) => new Date(NOW_MS - d * 86_400_000).toISOString();
  const logs = (id: string, perDay: number, days = 30) =>
    Array.from({ length: days }, (_, i) => ({ inventoryItemId: id, type: 'sale' as const, quantity: perDay, date: day(i + 1) }));

  it('suggests items at or below their alert level, with the quantity to buy', () => {
    // chicken: alert 10, on hand 4, uses 5 kg/day -> target 10 + 5*7 = 45, need 41; packs of 20 kg -> 3 packs
    const inv = [item('chicken', { lowStockThreshold: 10, quantity: 4, costPrice: 800, conversions: [{ unit: 'Crate', factor: 20 }] }), item('rice', { lowStockThreshold: 10, quantity: 50 })];
    const s = suggestReorders(inv, logs('chicken', 5), [], { nowMs: NOW_MS });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ avgDailyUse: 5, target: 45, needBase: 41, purchaseUnit: 'Crate', suggestedQty: 3 });
    expect(s[0].rate).toBe(16000);                               // 800 per kg × 20 kg crate
    expect(s[0].value).toBe(48000);
  });

  it('ignores use older than the window, and never counts stock purchases or adjustments as use', () => {
    const inv = [item('x', { lowStockThreshold: 10, quantity: 0 })];
    const noise = [
      { inventoryItemId: 'x', type: 'in' as const, quantity: 999, date: day(2) },
      { inventoryItemId: 'x', type: 'adjustment' as const, quantity: 999, date: day(2) },
      { inventoryItemId: 'x', type: 'sale' as const, quantity: 999, date: day(45) },
    ];
    const s = suggestReorders(inv, noise, [], { nowMs: NOW_MS });
    expect(s[0].avgDailyUse).toBe(0);
    expect(s[0].needBase).toBe(10);                              // simply refills to the alert level — never invents demand
  });

  it('takes the supplier and rate from the latest receipt, converted to the purchase unit', () => {
    const inv = [item('rice', { lowStockThreshold: 20, quantity: 5, costPrice: 150, conversions: [{ unit: 'Bag', factor: 25 }] })];
    const rec: ReceivingEntry[] = [
      { id: 'a', supplierName: 'Old Mill', inventoryItemId: 'rice', itemName: 'rice', quantity: 1, unit: 'Bag', baseQty: 25, rate: 3000, baseUnitCost: 120, receivedBy: 'x', notes: '', date: day(40) },
      { id: 'b', supplierName: 'New Mill', inventoryItemId: 'rice', itemName: 'rice', quantity: 2, unit: 'Bag', baseQty: 50, rate: 5000, baseUnitCost: 200, receivedBy: 'x', notes: '', date: day(3) },
    ];
    const s = suggestReorders(inv, [], rec, { nowMs: NOW_MS });
    expect(s[0].supplierName).toBe('New Mill');
    expect(s[0].rate).toBe(5000);                                // 200 per kg × 25 kg bag
    expect(s[0].suggestedQty).toBe(1);                           // need 15 kg -> rounded UP to one 25 kg bag
  });

  it('skips inactive items and items with no alert level; lists the emptiest first', () => {
    const inv = [
      item('half', { lowStockThreshold: 10, quantity: 5 }), item('empty', { lowStockThreshold: 10, quantity: 0 }),
      item('off', { lowStockThreshold: 10, quantity: 0, isActive: false }), item('noalert', { lowStockThreshold: 0, quantity: 0 }),
    ];
    expect(suggestReorders(inv, [], [], { nowMs: NOW_MS }).map(x => x.item.id)).toEqual(['empty', 'half']);
  });

  it('groups drafts by the supplier who last supplied each item, with "no supplier yet" last', () => {
    const parties: Party[] = [{ id: 's1', type: 'supplier', name: 'Meat Co', openingBalance: 0, isActive: true }];
    const inv = [item('chicken', { lowStockThreshold: 10, quantity: 0, costPrice: 800 }), item('salt', { lowStockThreshold: 2, quantity: 0, costPrice: 10 })];
    const rec: ReceivingEntry[] = [{ id: 'a', supplierName: 'meat co ', inventoryItemId: 'chicken', itemName: 'chicken', quantity: 1, unit: 'kg', baseQty: 1, rate: 800, baseUnitCost: 800, receivedBy: 'x', notes: '', date: day(5) }];
    const drafts = draftsFromSuggestions(suggestReorders(inv, [], rec, { nowMs: NOW_MS }), parties, newId);
    expect(drafts.map(d => [d.supplierId, d.lines.map(l => l.itemName)])).toEqual([['s1', ['chicken']], ['', ['salt']]]);
    expect(drafts[0].lines[0]).toMatchObject({ quantity: 10, rate: 800, receivedQty: 0 });
  });
});

describe('the purchase-order collection in the app', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('is a backend document-store collection (no table, tenant-isolated by the module_documents policy)', async () => {
    const ss = await import('@/lib/supabaseStore');
    expect(ss.isDocStoreCollection('purchaseOrders')).toBe(true);
    expect(ss.isDocStoreCollection('waiters')).toBe(true);
  });

  it('exists (empty) in data saved before this release, and a saved order comes back', async () => {
    localStorage.setItem('desi-pos-data', JSON.stringify({ settings: { name: 'T' }, orders: [], menuItems: [], categories: [] }));
    const store = await import('@/lib/store');
    expect(store.getPurchaseOrders()).toEqual([]);
    store.savePurchaseOrder(po({ id: 'p9', status: 'draft' }));
    expect(store.getPurchaseOrders().map(p => p.id)).toEqual(['p9']);
    store.deletePurchaseOrder('p9');
    expect(store.getPurchaseOrders()).toEqual([]);
  });

  it('the realtime channel refreshes purchase orders when a document changes on another device', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/lib/store.ts', 'utf8');
    expect(src).toMatch(/scheduleReload\('riders'\);\s*scheduleReload\('purchaseOrders'\);/);
  });
});
