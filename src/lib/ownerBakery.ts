// What the Owner app shows about the bakery side (v1.121.0): today's cake orders, what is going off, what was baked. The same figures
// the desktop screens show (lib/cakeOrders.ts, lib/lots.ts, lib/prep.ts) — pure functions, nothing is stored or worked out twice.
import { balanceOf, dueState, isOpen, paidOf, sortOrders, summarize as summarizeCakes, type CakeOrder } from '@/lib/cakeOrders';
import { daysLeft, effectiveLots, expiryStatus, lotValue, type StockLot } from '@/lib/lots';
import type { ProductionBatch } from '@/lib/prep';

export interface BakerySummary {
  /** the restaurant has used any of this (cake orders, dated stock, batches): otherwise the Owner app shows nothing new */
  used: boolean;
  cakes: { open: number; dueToday: number; overdue: number; balance: number; advance: number };
  expiry: { expired: { lots: number; value: number }; soon: { lots: number; value: number } };
  batches: { count: number; cost: number };
}

/** Lots as they really are (capped to what is on hand), so the Owner app never claims more than the desktop does. */
export function liveLots(lots: StockLot[], onHand: (itemId: string) => number): StockLot[] {
  const by = new Map<string, StockLot[]>();
  for (const l of lots) by.set(l.inventoryItemId, [...(by.get(l.inventoryItemId) ?? []), l]);
  return [...by].flatMap(([id, ls]) => effectiveLots(ls, onHand(id)));
}

export function bakerySummary(input: { cakes: CakeOrder[]; lots: StockLot[]; batches: ProductionBatch[]; onHand: (itemId: string) => number; today: string; soonDays?: number }): BakerySummary {
  const soonDays = input.soonDays ?? 3;
  const c = summarizeCakes(input.cakes, input.today);
  const live = liveLots(input.lots, input.onHand);
  const e = { expired: { lots: 0, value: 0 }, soon: { lots: 0, value: 0 } };
  for (const l of live) {
    const st = expiryStatus(daysLeft(l.expiryDate, input.today), soonDays);
    if (st === 'expired') { e.expired.lots++; e.expired.value += lotValue(l); }
    else if (st === 'today' || st === 'soon') { e.soon.lots++; e.soon.value += lotValue(l); }
  }
  const today = input.batches.filter(b => b.date === input.today);
  return {
    used: input.cakes.length > 0 || input.lots.length > 0 || input.batches.length > 0,
    cakes: { open: c.open, dueToday: c.dueToday, overdue: c.overdue, balance: c.balanceOwed, advance: c.advanceHeld },
    expiry: { expired: { lots: e.expired.lots, value: Math.round(e.expired.value * 100) / 100 }, soon: { lots: e.soon.lots, value: Math.round(e.soon.value * 100) / 100 } },
    batches: { count: today.length, cost: Math.round(today.reduce((s, b) => s + b.totalCost, 0) * 100) / 100 },
  };
}

export interface OwnerCakeRow { id: string; number: string; customer: string; phone?: string; what: string; due: string; tag: 'overdue' | 'today' | 'tomorrow' | null; total: number; paid: number; balance: number; status: CakeOrder['status'] }

/** Open cake orders, the soonest needed first, for the Owner app's list. */
export function cakeRows(cakes: CakeOrder[], today: string): OwnerCakeRow[] {
  return sortOrders(cakes).filter(isOpen).map(o => {
    const d = dueState(o, today);
    return { id: o.id, number: o.number, customer: o.customerName, phone: o.phone, what: o.itemName || o.description, due: `${o.dueDate}${o.dueTime ? ` ${o.dueTime}` : ''}`, tag: d === 'overdue' || d === 'today' || d === 'tomorrow' ? d : null, total: o.total, paid: paidOf(o), balance: balanceOf(o), status: o.status };
  });
}

export interface OwnerExpiryRow { id: string; item: string; expires: string; days: number; status: 'expired' | 'today' | 'soon'; remaining: number; unit: string; value: number }

/** Lots that have expired or go off within `soonDays`, the most urgent first. */
export function expiryRows(lots: StockLot[], onHand: (itemId: string) => number, unitOf: (itemId: string) => string, today: string, soonDays = 7): OwnerExpiryRow[] {
  const out: OwnerExpiryRow[] = [];
  for (const l of liveLots(lots, onHand)) {
    const days = daysLeft(l.expiryDate, today);
    const st = expiryStatus(days, soonDays);
    if (days === null || (st !== 'expired' && st !== 'today' && st !== 'soon')) continue;
    out.push({ id: l.id, item: l.itemName, expires: l.expiryDate!, days, status: st, remaining: l.remaining, unit: unitOf(l.inventoryItemId), value: lotValue(l) });
  }
  return out.sort((a, b) => a.days - b.days);
}
