// ============================================================
// v1.6.0 — ITEM SALES REPORT ENGINE (client feedback #2 items 1 & 2)
//
// Client supplied a printed sample (MR TEH TARIK, Singapore) to follow:
//
//   ITEM SALES REPORT
//   From: <date>  To: <date>      Printed: <datetime>
//   ─ per CATEGORY ─
//     <item name>        qty    amount
//     ...
//     SUB TOTAL          Σqty   Σamount
//   TOTAL                Σqty   Σamount
//   ─ SETTLEMENT ─
//     CASH               count  amount
//     NETS/CARD/...      count  amount
//     TOTAL              count  amount
//
// This module is PURE (no React, no storage): give it orders + filters,
// it returns the report structure. All maths tested against hand-checked
// numbers, because this is what owners reconcile cash against.
//
// Filters supported (all optional):
//   from/to          — inclusive date range on order.createdAt
//   orderTypes       — dining / takeaway / delivery / foodpanda
//   categoryIds      — only these categories
//   itemIds          — only these products ("product-wise print")
// ============================================================

import type { Order, MenuItem, Category } from './types';
import { round2 } from './taxEngine';

export interface SalesReportFilters {
  /** Inclusive start of range (local day start recommended). */
  from?: Date;
  /** Inclusive end of range (local day end recommended). */
  to?: Date;
  orderTypes?: string[];
  categoryIds?: string[];
  itemIds?: string[];
}

export interface ReportRow { itemId: string; name: string; qty: number; amount: number }
export interface ReportCategory {
  categoryId: string;
  name: string;
  rows: ReportRow[];
  subQty: number;
  subAmount: number;
}
export interface SettlementRow { method: string; count: number; amount: number }
export interface OrderTypeRow { orderType: string; count: number; amount: number }

export interface ItemSalesReport {
  from?: string;
  to?: string;
  categories: ReportCategory[];
  totalQty: number;
  totalAmount: number;
  settlement: SettlementRow[];
  settlementTotal: { count: number; amount: number };
  byOrderType: OrderTypeRow[];
  ordersIncluded: number;

  // ============================================================
  // v1.8.1 — sections from the client's report sample.
  //
  // Summary/Tax/Transactions blocks add the fields the audit-facing
  // Singapore-style shift report expects, computed from data already
  // captured on every order (subtotal, discount, service charge, tax,
  // grand total, status). No new POS flow is required to render these.
  //
  // NOT added here (would require new data flows that do not exist yet):
  //   • Cash-drawer report (starting cash, pay-in / pay-out, expected
  //     vs actual ending cash) — needs a cash-management module.
  //   • Refund tracking (refunded amount, refunded products) — needs a
  //     dedicated refund flow, not just status='void'/'cancelled'.
  //   • Shift start/end timestamps — needs a shift-open / shift-close
  //     workflow. Reports currently use the selected date range instead.
  //
  // These are honest omissions, not silent gaps; the report page will
  // note them so the operator is not misled.
  // ============================================================
  summary: {
    productAmountExcTax: number;   // items subtotal before discount/SC/tax
    discount: number;
    serviceCharge: number;
    rounding: number;              // sum of grand-total rounding deltas
    subTotal: number;              // productAmount - discount + SC
    refundAmount: number;          // v1.8.1: informational (see note above)
    actualSales: number;           // net after refunds
  };
  tax: {
    taxableAmount: number;         // base on which GST was calculated
    taxPercent: number;            // dominant rate seen in the range
    actualTax: number;             // sum of tax collected
  };
  transactions: {
    checkedOutOrders: number;      // orders considered SALES in range
    averageIncomeValue: number;    // grand-total per order (mean)
    soldProducts: number;          // sum of item quantities
    refunded: number;
    refundedProducts: number;
  };
  /** v1.8.1: Payment Report with percentages (Method | Amount | Percent). */
  settlementWithPercent: (SettlementRow & { percent: number })[];
  /**
   * v1.11.0 — FLAT product list across every category.
   *
   * The client's printed sample has TWO separate sections: "Sold
   * categories" (category totals only) and "Sold products" (every product
   * in one flat list). v1.8.1 wrongly nested the products inside each
   * category, which does not match the sample. `categories` now feeds the
   * category totals and this feeds the product list.
   */
  soldProducts: ReportRow[];
}

/** Statuses that represent real, countable sales. */
const SALE_STATUSES = new Set(['paid', 'partial', 'credit_pending', 'credit_received']);

function inRange(iso: string, from?: Date, to?: Date): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}

/**
 * ===== v1.18.0 — "final end-of-day amounts do not reflect our actual
 *                  total transactions and revenue" =====
 *
 * Reports filtered on `createdAt` — the moment the bill was OPENED. For a
 * restaurant that is the wrong clock. A dine-in table opened at 2:40 am sits
 * for an hour and settles at 3:40 am; with a business day closing at 3:00 am
 * its revenue was counted against the day that had already been closed and
 * reported. The cash was in tonight's drawer, the sale was on last night's
 * report, and the totals never agreed.
 *
 * Revenue belongs to the day the money was TAKEN. Settlement time wins;
 * `createdAt` is only a fallback for bills with no settlement stamp (older
 * records, complimentary bills).
 */
export function revenueTimestamp(o: Order): string {
  return (o as any).paidAt || (o as any).settledAt || o.createdAt;
}

/** Human label for a settlement line: named account wins over raw method. */
export function settlementLabel(o: Order): string {
  if (o.paymentAccountName) return o.paymentAccountName.toUpperCase();
  const m = (o.paymentMethod || 'cash').toString();
  return m.toUpperCase();
}

/**
 * v1.15.0 — real refunds.
 *
 * Previously "refunds" were inferred from voided orders, which is the
 * wrong model: a VOID means the sale never happened; a REFUND means it
 * happened and money came back. Both are now counted, each from its own
 * source, so a day containing both is stated correctly.
 */
export function buildItemSalesReport(
  orders: Order[],
  menuItems: MenuItem[],
  categories: Category[],
  f: SalesReportFilters = {},
  refunds: { at: string; total: number; lines?: { quantity: number }[] }[] = [],
): ItemSalesReport {
  const catById = new Map(categories.map(c => [c.id, c]));
  const menuById = new Map(menuItems.map(m => [m.id, m]));
  const wantCat = f.categoryIds?.length ? new Set(f.categoryIds) : null;
  const wantItem = f.itemIds?.length ? new Set(f.itemIds) : null;
  const wantType = f.orderTypes?.length ? new Set(f.orderTypes) : null;

  // ---- pick the orders ----
  const included = orders.filter(o =>
    SALE_STATUSES.has(o.status)
    && inRange(revenueTimestamp(o), f.from, f.to)
    && (!wantType || wantType.has(o.orderType)),
  );

  // ---- per item aggregation ----
  type Agg = { itemId: string; name: string; categoryId: string; qty: number; amount: number };
  const byItem = new Map<string, Agg>();
  for (const o of included) {
    for (const line of o.items || []) {
      const menu = menuById.get(line.menuItemId || line.id);
      const categoryId = menu?.categoryId || (line as any).categoryId || 'uncat';
      if (wantCat && !wantCat.has(categoryId)) continue;
      const itemKey = line.menuItemId || line.id || line.name;
      if (wantItem && !wantItem.has(itemKey)) continue;
      const qty = Number(line.quantity) || 0;
      // line total: prefer stored lineTotal; fall back to price×qty
      const amount = typeof (line as any).lineTotal === 'number'
        ? (line as any).lineTotal
        : (Number(line.price) || 0) * qty;
      const cur = byItem.get(itemKey) || {
        itemId: itemKey,
        name: line.name || menu?.name || 'Unknown',
        categoryId,
        qty: 0,
        amount: 0,
      };
      cur.qty += qty;
      cur.amount = round2(cur.amount + amount);
      byItem.set(itemKey, cur);
    }
  }

  // ---- group into categories (sample format) ----
  const byCat = new Map<string, ReportCategory>();
  for (const agg of byItem.values()) {
    const cat = byCat.get(agg.categoryId) || {
      categoryId: agg.categoryId,
      name: catById.get(agg.categoryId)?.name || (agg.categoryId === 'uncat' ? 'OTHERS' : agg.categoryId),
      rows: [],
      subQty: 0,
      subAmount: 0,
    };
    cat.rows.push({ itemId: agg.itemId, name: agg.name, qty: agg.qty, amount: agg.amount });
    cat.subQty += agg.qty;
    cat.subAmount = round2(cat.subAmount + agg.amount);
    byCat.set(agg.categoryId, cat);
  }
  const cats = Array.from(byCat.values());
  cats.forEach(c => c.rows.sort((a, b) => a.name.localeCompare(b.name)));
  cats.sort((a, b) => a.name.localeCompare(b.name));

  const totalQty = cats.reduce((s, c) => s + c.subQty, 0);
  const totalAmount = round2(cats.reduce((s, c) => s + c.subAmount, 0));

  // ---- settlement (per payment method/account, like the sample) ----
  // Split payments contribute to EACH method with their own amount; the
  // order counts once per method it touched (sample counts receipts).
  const settle = new Map<string, SettlementRow>();
  const addSettle = (label: string, amount: number) => {
    const cur = settle.get(label) || { method: label, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount = round2(cur.amount + amount);
    settle.set(label, cur);
  };
  for (const o of included) {
    const pays = (o.payments || []).filter(p => (p.amount || 0) > 0);
    if (pays.length > 0) {
      // group this order's payments by method label first
      const perMethod = new Map<string, number>();
      for (const p of pays) {
        const label = (p as any).accountName?.toUpperCase?.() || (p.method || 'cash').toUpperCase();
        perMethod.set(label, round2((perMethod.get(label) || 0) + (p.amount || 0)));
      }
      for (const [label, amt] of perMethod) addSettle(label, amt);
    } else {
      // legacy orders without payment entries
      addSettle(settlementLabel(o), Number(o.grandTotal) || 0);
    }
  }
  const settlement = Array.from(settle.values()).sort((a, b) => a.method.localeCompare(b.method));
  const settlementTotal = {
    count: included.length,
    amount: round2(settlement.reduce((s, r) => s + r.amount, 0)),
  };

  // ---- order-type breakdown (dining / takeaway / delivery) ----
  const byType = new Map<string, OrderTypeRow>();
  for (const o of included) {
    const cur = byType.get(o.orderType) || { orderType: o.orderType, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount = round2(cur.amount + (Number(o.grandTotal) || 0));
    byType.set(o.orderType, cur);
  }
  const byOrderType = Array.from(byType.values()).sort((a, b) => a.orderType.localeCompare(b.orderType));

  // ============================================================
  // v1.8.1 — Summary / Tax / Transactions blocks (client sample)
  //
  // Everything below is computed from fields the POS already stamps on
  // every order (subtotal, discount, tax, serviceCharge, grandTotal,
  // taxPercent, items[].quantity). Refund/cash-drawer fields are left
  // at zero honestly — they need workflows that do not exist yet.
  // ============================================================
  let productAmountExcTax = 0;
  let discountTotal = 0;
  let serviceChargeTotal = 0;
  let roundingTotal = 0;
  let subTotalRunning = 0;
  let taxableAmount = 0;
  let taxTotal = 0;
  let soldProducts = 0;
  const taxRates = new Map<number, number>();      // rate → order count
  const REFUND_STATUSES = new Set(['void', 'cancelled']);
  // v1.12.1 — a bill voided by a table MERGE is not a refund: nothing was
  // returned to the customer, the items simply moved onto another bill.
  // Counting it as a refund double-subtracted it from Actual sales.
  const refundOrders = orders.filter(o =>
    REFUND_STATUSES.has(o.status)
    && !(o as any).mergedIntoOrderId
    && inRange(revenueTimestamp(o), f.from, f.to)
    && (!wantType || wantType.has(o.orderType))
  );
  // v1.15.0 — real refunds recorded through the refund flow.
  const rangeRefunds = (refunds || []).filter(r => inRange(r.at, f.from, f.to));
  const realRefundAmount = round2(rangeRefunds.reduce((s, r) => s + (Number(r.total) || 0), 0));
  const realRefundedUnits = rangeRefunds.reduce(
    (s, r) => s + (r.lines || []).reduce((n, l) => n + (Number(l.quantity) || 0), 0), 0,
  );

  // Legacy void-as-refund is still counted, so restaurants that used voids
  // that way do not see their historical figures change under them.
  const refundAmount = round2(
    refundOrders.reduce((s, o) => s + (Number(o.grandTotal) || 0), 0) + realRefundAmount,
  );
  const refundedProducts = refundOrders.reduce(
    (s, o) => s + (o.items || []).reduce((n, l) => n + (Number(l.quantity) || 0), 0),
    0,
  ) + realRefundedUnits;

  for (const o of included) {
    const sub = Number(o.subtotal) || 0;
    const disc = Number(o.discount) || 0;
    const sc = Number(o.serviceCharge) || 0;
    const tax = Number(o.tax) || 0;
    const gt = Number(o.grandTotal) || 0;

    productAmountExcTax = round2(productAmountExcTax + sub);
    discountTotal = round2(discountTotal + disc);
    serviceChargeTotal = round2(serviceChargeTotal + sc);
    subTotalRunning = round2(subTotalRunning + (sub - disc + sc));
    taxTotal = round2(taxTotal + tax);
    taxableAmount = round2(taxableAmount + (sub - disc + sc));
    // Rounding = grand-total minus arithmetic sum of its parts.
    const arithmetic = round2(sub - disc + sc + tax);
    roundingTotal = round2(roundingTotal + (gt - arithmetic));

    const rate = Number((o as any).taxPercent) || 0;
    if (rate > 0) taxRates.set(rate, (taxRates.get(rate) || 0) + 1);

    for (const line of o.items || []) soldProducts += Number(line.quantity) || 0;
  }
  // Dominant rate seen in the range (matches the sample's "GST(9%)" line).
  const dominantRate = Array.from(taxRates.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 0;

  const actualSales = round2(subTotalRunning + taxTotal + roundingTotal - refundAmount);
  const averageIncomeValue = included.length > 0
    ? round2(subTotalRunning + taxTotal + roundingTotal) / included.length
    : 0;

  // ---- Payment Report with percentages (sample column: Percent) ----
  const settlementWithPercent = settlement.map(r => ({
    ...r,
    percent: settlementTotal.amount > 0
      ? round2((r.amount / settlementTotal.amount) * 100)
      : 0,
  }));

  // v1.11.0 — flatten every category's rows into one product list and
  // merge duplicates (the same item can appear under one category only,
  // but this stays correct if that ever changes).
  const productMap = new Map<string, ReportRow>();
  for (const c of cats) {
    for (const r of c.rows) {
      const prev = productMap.get(r.itemId);
      if (prev) {
        prev.qty = round2(prev.qty + r.qty);
        prev.amount = round2(prev.amount + r.amount);
      } else {
        productMap.set(r.itemId, { ...r });
      }
    }
  }
  const soldProductRows = Array.from(productMap.values())
    .sort((a, b) => b.amount - a.amount);

  return {
    from: f.from?.toISOString(),
    to: f.to?.toISOString(),
    categories: cats,
    soldProducts: soldProductRows,
    totalQty,
    totalAmount,
    settlement,
    settlementTotal,
    byOrderType,
    ordersIncluded: included.length,
    summary: {
      productAmountExcTax,
      discount: discountTotal,
      serviceCharge: serviceChargeTotal,
      rounding: roundingTotal,
      subTotal: subTotalRunning,
      refundAmount,
      actualSales,
    },
    tax: {
      taxableAmount,
      taxPercent: dominantRate,
      actualTax: taxTotal,
    },
    transactions: {
      checkedOutOrders: included.length,
      averageIncomeValue: round2(averageIncomeValue),
      soldProducts,
      refunded: refundOrders.length + rangeRefunds.length,
      refundedProducts,
    },
    settlementWithPercent,
  };
}

// ---------- date-range presets (feedback item 2) ----------
export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'year';

export function presetRange(preset: RangePreset, now = new Date()): { from: Date; to: Date } {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  if (preset === 'today') return { from: start, to: end };
  if (preset === 'yesterday') {
    const f = new Date(start); f.setDate(f.getDate() - 1);
    const t = new Date(end); t.setDate(t.getDate() - 1);
    return { from: f, to: t };
  }
  if (preset === 'week') {
    const f = new Date(start); f.setDate(f.getDate() - 6); // rolling 7 days incl. today
    return { from: f, to: end };
  }
  if (preset === 'month') {
    const f = new Date(start); f.setDate(1);
    return { from: f, to: end };
  }
  // year
  const f = new Date(start); f.setMonth(0, 1);
  return { from: f, to: end };
}
