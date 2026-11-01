// ============================================================
// SHIFT REPORT — client ke sample receipt ka exact format.
// Sections: Summary · Tax · Transactions · Cash drawer report ·
// Payment Report (with %) · Sold categories · Sold products.
// Prints on 80mm thermal (proven printNode pipeline).
// ============================================================
import { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getOrders, getMenuItems, getCategories, getSettings } from '@/lib/store';
import { getAllHistoricalOrders } from '@/lib/orderArchive';
import { isPaidSale, isPartialSale, isVoidish, paidRevenue } from '@/lib/sales';
import type { Order } from '@/lib/types';
import { printNode } from '@/printing';
import { loadPrinterSettings, resolvePrinterForRole } from '@/lib/printerSettings';
import { wantsRaw } from '@/printing/printMode';
import { resolveSlipMargin } from '@/lib/slipMargins';
import { getDeviceId } from '@/lib/tenant';
import { reportMoney, reportTime, thermalReportHtml, type ReportBlock, type ThermalReportDoc } from '@/printing/thermalReport';

export interface ShiftReportRange {
  from: Date;
  to: Date;
  label: string;
  /** Cash drawer opening float (settings/day-close se aata hai) */
  startingCash?: number;
  /** Counted cash at close (agar user ne dala ho) */
  actualEndingCash?: number;
  staffName?: string;
}

export function buildShiftReportData(range: ShiftReportRange) {
  const settings: any = getSettings();
  const menu = getMenuItems();
  const cats = getCategories();
  const catName = new Map(cats.map((c: any) => [c.id, c.name]));
  const itemCat = new Map(menu.map((m: any) => [m.id, m.categoryId]));

  // FIX: live orders become empty after Day Close — include archive too,
  // otherwise Shift Report showed '0 orders' and older dates weren't found.
  const all = getAllHistoricalOrders(getOrders());
  const inRange = (o: Order) => {
    const t = new Date((o as any).paidAt || (o as any).updatedAt || o.createdAt || 0).getTime();
    return t >= range.from.getTime() && t <= range.to.getTime();
  };

  const sales = all.filter(o => inRange(o) && !isVoidish(o) && (isPaidSale(o) || isPartialSale(o)));
  const refunds = all.filter(o => inRange(o) && isVoidish(o));

  let productAmount = 0, discount = 0, serviceCharge = 0, taxTotal = 0, net = 0, soldQty = 0;
  const byCat = new Map<string, { qty: number; amount: number }>();
  const byProd = new Map<string, { qty: number; amount: number }>();
  const byPay = new Map<string, number>();
  const byType = new Map<string, { orders: number; amount: number }>();

  for (const o of sales) {
    const rev = paidRevenue(o);
    net += rev;
    productAmount += Number((o as any).subtotal || 0);
    discount += Number((o as any).discount ?? (o as any).discountAmount ?? 0);
    serviceCharge += Number((o as any).serviceCharge || 0);
    taxTotal += Number((o as any).tax || 0);

    const pm = String((o as any).paymentMethod || 'cash');
    byPay.set(pm, (byPay.get(pm) || 0) + rev);

    const ot = String(o.orderType || 'dining');
    const tRow = byType.get(ot) || { orders: 0, amount: 0 };
    tRow.orders++; tRow.amount += rev; byType.set(ot, tRow);

    for (const it of ((o.items || []) as any[])) {
      const q = Number(it.quantity || 0);
      const amt = Number(it.lineTotal || 0);
      soldQty += q;
      const cname = catName.get(itemCat.get(it.menuItemId) || '') || 'Uncategorized';
      const c = byCat.get(cname) || { qty: 0, amount: 0 };
      c.qty += q; c.amount += amt; byCat.set(cname, c);
      const p = byProd.get(it.name) || { qty: 0, amount: 0 };
      p.qty += q; p.amount += amt; byProd.set(it.name, p);
    }
  }

  let refundAmount = 0, refundedProducts = 0;
  for (const o of refunds) {
    refundAmount += Number((o as any).grandTotal || 0);
    for (const it of ((o.items || []) as any[])) refundedProducts += Number(it.quantity || 0);
  }

  const subTotal = productAmount - discount + serviceCharge + taxTotal;
  const rounding = Math.round((net - subTotal) * 100) / 100;
  const checkedOut = sales.length;
  const avgIncome = checkedOut ? net / checkedOut : 0;

  const cashIncome = byPay.get('cash') || 0;
  const startingCash = Number(range.startingCash || 0);
  const expectedCash = startingCash + cashIncome;
  const payTotal = Array.from(byPay.values()).reduce((a, b) => a + b, 0);

  const taxPct = Number(settings.taxPercent) || 0;
  const taxable = taxPct > 0 ? Math.round((taxTotal / (taxPct / 100)) * 100) / 100 : 0;

  return {
    settings,
    range,
    summary: { productAmount, discount, serviceCharge, temporaryCharge: 0, rounding, subTotal, refundAmount, actualSales: net },
    tax: { taxable, taxPct, taxAmount: taxTotal },
    transactions: { checkedOut, avgIncome, soldProducts: soldQty, refunded: refunds.length, refundedProducts },
    drawer: { startingCash, orderIncome: cashIncome, payIn: 0, refund: refundAmount, payOut: 0, expectedCash, actualEndingCash: Number(range.actualEndingCash ?? expectedCash) },
    payments: Array.from(byPay.entries()).map(([m, amt]) => ({ method: m, amount: amt, percent: payTotal ? (amt / payTotal) * 100 : 0 })).sort((a, b) => b.amount - a.amount),
    payTotal,
    types: Array.from(byType.entries()).map(([k, v]) => ({ type: k, ...v })).sort((a, b) => b.amount - a.amount),
    categories: Array.from(byCat.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount),
    products: Array.from(byProd.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount),
    totals: { catQty: Array.from(byCat.values()).reduce((a, b) => a + b.qty, 0), catAmt: Array.from(byCat.values()).reduce((a, b) => a + b.amount, 0) },
  };
}

const TYPE_LABEL: Record<string, string> = { dining: 'Dine-In', takeaway: 'Takeaway', delivery: 'Delivery', foodpanda: 'Online / Drive' };

/**
 * The shift report as a thermal report document — the same sections as the
 * client's sample receipt, on the shared professional 80 mm layout (restaurant
 * header, title band, wrapping rows, aligned tables, boxed total).
 */
export function shiftReportDoc(d: ReturnType<typeof buildShiftReportData>): ThermalReportDoc {
  const s: any = d.settings;
  const sym = s.currencySymbol || 'Rs';
  const m = (n: number) => reportMoney(n, sym);
  const neg = (n: number) => (Number(n) ? `-${m(n)}` : m(0));
  const taxLabel = s.countryTaxLabel || 'GST';
  const pct = (n: number) => `${Number(n || 0).toFixed(1)}%`;
  const blocks: ReportBlock[] = [
    { kind: 'section', title: 'Summary' },
    { kind: 'row', label: 'Product amount (excl. tax)', value: m(d.summary.productAmount) },
    { kind: 'row', label: 'Discount', value: neg(d.summary.discount) },
    { kind: 'row', label: 'Service charge', value: m(d.summary.serviceCharge) },
    { kind: 'row', label: 'Temporary charge', value: m(d.summary.temporaryCharge) },
    { kind: 'row', label: 'Rounding', value: m(d.summary.rounding) },
    { kind: 'row', label: 'Sub-total', value: m(d.summary.subTotal) },
    { kind: 'row', label: 'Refund amount (excl. tax)', value: neg(d.summary.refundAmount) },
    { kind: 'total', label: 'Actual sales', value: m(d.summary.actualSales) },

    { kind: 'section', title: 'Tax' },
    { kind: 'row', label: `Taxable (${taxLabel})`, value: m(d.tax.taxable) },
    { kind: 'row', label: `${taxLabel} (${d.tax.taxPct}%)`, value: m(d.tax.taxAmount) },
    { kind: 'row', label: 'Actual tax', value: m(d.tax.taxAmount), bold: true },

    { kind: 'section', title: 'Transactions' },
    { kind: 'row', label: 'Checked out', value: String(d.transactions.checkedOut) },
    { kind: 'row', label: 'Average bill value', value: m(d.transactions.avgIncome) },
    { kind: 'row', label: 'Sold products', value: String(d.transactions.soldProducts) },
    { kind: 'row', label: 'Refunded', value: String(d.transactions.refunded) },
    { kind: 'row', label: 'Refunded products', value: String(d.transactions.refundedProducts) },

    { kind: 'section', title: 'Cash drawer' },
    { kind: 'row', label: 'Starting cash', value: m(d.drawer.startingCash) },
    { kind: 'row', label: 'Order income (cash)', value: m(d.drawer.orderIncome) },
    { kind: 'row', label: 'Pay in', value: m(d.drawer.payIn) },
    { kind: 'row', label: 'Refund', value: neg(d.drawer.refund) },
    { kind: 'row', label: 'Pay out', value: m(d.drawer.payOut) },
    { kind: 'row', label: 'Expected cash', value: m(d.drawer.expectedCash), bold: true },
    { kind: 'row', label: 'Actual ending cash', value: m(d.drawer.actualEndingCash), bold: true },

    { kind: 'section', title: 'Payment report' },
    { kind: 'table', head: ['Method', 'Amount', '%'], rows: d.payments.map(p => [p.method.toUpperCase(), m(p.amount), pct(p.percent)]), foot: ['Total', m(d.payTotal), d.payTotal ? '100%' : ''] },

    { kind: 'section', title: 'Order types' },
    { kind: 'table', head: ['Type', 'Orders', 'Amount'], rows: d.types.map(t => [TYPE_LABEL[t.type] || t.type, String(t.orders), m(t.amount)]) },

    { kind: 'section', title: 'Sold categories' },
    { kind: 'table', head: ['Category', 'Qty', 'Amount'], rows: d.categories.map(c => [c.name, String(c.qty), m(c.amount)]), foot: ['Total', String(d.totals.catQty), m(d.totals.catAmt)] },

    { kind: 'section', title: 'Sold products' },
    { kind: 'table', head: ['Product', 'Qty', 'Amount'], rows: d.products.map(p => [p.name, String(p.qty), m(p.amount)]), foot: ['Total', String(d.totals.catQty), m(d.totals.catAmt)] },
  ];
  return {
    title: 'Shift Report',
    meta: [
      ['Staff', String(d.range.staffName || s.email || '-')],
      ['Start', reportTime(d.range.from)],
      ['End', reportTime(d.range.to)],
      ['Shift', d.range.label],
    ],
    blocks,
  };
}

/** Shift report HTML — thermal 80 mm (also the on-screen preview). */
export function shiftReportHtml(d: ReturnType<typeof buildShiftReportData>): string {
  return thermalReportHtml(shiftReportDoc(d), d.settings);
}

export async function printShiftReport(range: ShiftReportRange): Promise<{ success: boolean; error?: string }> {
  const data = buildShiftReportData(range);
  const settings: any = data.settings;
  const paperWidth = (settings.paperSize as '58mm' | '80mm') || '80mm';

  let printerName: string | undefined;
  let counterCfg: any = undefined;
  let printMode: string | undefined;
  let marginLeftMm: number | undefined;
  let marginRightMm: number | undefined;
  let contentWidthMm: number | undefined;
  try {
    const pset = await loadPrinterSettings();
    const cfg: any = resolvePrinterForRole(pset, 'counter', getDeviceId());
    counterCfg = cfg;
    if (cfg && (cfg.connection || 'system') === 'system' && cfg.printerName) printerName = cfg.printerName;
    printMode = cfg?.printMode;
    marginLeftMm = cfg?.leftMarginMm;
    marginRightMm = cfg?.rightMarginMm;
    contentWidthMm = cfg?.printWidthMm;
  } catch {}
  if (!printerName) printerName = settings.defaultPrinter || undefined;

  // ===== FAST BILLING =====
  // The report is a slip like any other. Without this the shop-wide switch
  // produced a raw bill, a raw KOT, a raw token — and a rendered report.
  if (wantsRaw({ printerConfig: counterCfg, settings })) {
    try {
      const { buildShiftReportBytes } = await import('@/printing/escposBuilder');
      // The report is the fourth slip kind, and it gets its margins the same
      // way the other three do: its own per-slip setting, then the printer's
      // calibration, then this device's. Reading only the shop-level value is
      // what made Printer Center's margins look like decoration.
      const { resolveSlipMargin } = await import('@/lib/slipMargins');
      const { loadPrintMargins } = await import('@/lib/printMargins');
      const device = loadPrintMargins();
      const m = resolveSlipMargin('report', counterCfg?.leftMarginMm, counterCfg?.rightMarginMm, device.left, device.right);
      const bytes = buildShiftReportBytes(data, settings, {
        paper: counterCfg?.paperSize,
        leftMm: m.left,
        rightMm: m.right,
        contentWidthMm: counterCfg?.printWidthMm,
        autoCut: counterCfg ? counterCfg.autoCut !== false : undefined,
        beep: counterCfg ? !!counterCfg.beep : undefined,
      });
      const api: any = (window as any).electronAPI;
      if (api?.printRaw && bytes.length > 40) {
        const res = await api.printRaw({ printerName, data: bytes, copies: 1 });
        if (res?.success) {
          console.info('[DT-Print] shift report path=raw-escpos', { printer: printerName });
          return { success: true };
        }
        console.warn('[DT-Print] raw shift report unavailable, falling back to the rendered path:', res?.error);
      }
    } catch (e: any) {
      console.warn('[DT-Print] raw shift report threw, falling back to the rendered path:', e?.message || e);
    }
  }

  const portal = document.createElement('div');
  portal.className = 'receipt-print-portal';
  portal.setAttribute('aria-hidden', 'true');
  portal.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;';
  const inner = document.createElement('div');
  inner.className = 'print-receipt bg-white text-black';
  inner.setAttribute('data-paper-size', paperWidth);
  // Reports used to come out faint: the shared report stylesheet keeps the
  // text solid black and bold (700, headings 900) with smoothing off.
  inner.style.cssText = `width:${paperWidth};color:#000;background:#fff;`;
  inner.innerHTML = shiftReportHtml(data);
  portal.appendChild(inner);
  document.body.appendChild(portal);
  try {
    // The shift report is a slip like any other: Paper Save and the printer's
    // own geometry apply to it too. It used to pass neither, so a shop with
    // Paper Save on got a compact receipt, a compact KOT, a compact token —
    // and a full-length shift report.
    return await printNode(portal, {
      paperWidth, printerName, silent: true, copies: 1,
      printMode: (printMode || (settings.fastRawPrintMode ? 'raw' : undefined)) as any,
      compact: !!settings.receiptCompactMode,
      compactFontSize: settings.receiptCompactFontSize,
      compactLineHeight: settings.receiptCompactLineHeight,
      marginLeftMm: resolveSlipMargin('report', marginLeftMm, marginRightMm).left,
      marginRightMm: resolveSlipMargin('report', marginLeftMm, marginRightMm).right,
      contentWidthMm,
      logType: 'other',
    });
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) };
  } finally {
    setTimeout(() => { try { portal.remove(); } catch {} }, 500);
  }
}

/** On-screen preview (same layout). */
export default function ShiftReportPreview({ range }: { range: ShiftReportRange }) {
  const data = useMemo(() => buildShiftReportData(range), [range.from.getTime(), range.to.getTime(), range.startingCash, range.actualEndingCash]);
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={ref}
      className="bg-white text-black mx-auto"
      style={{ width: 320, fontFamily: 'monospace', fontSize: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}
      dangerouslySetInnerHTML={{ __html: shiftReportHtml(data) }}
    />
  );
}
