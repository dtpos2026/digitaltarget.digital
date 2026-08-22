// ============================================================
// v1.6.0 — ITEM SALES REPORT PAGE (client feedback #2, items 1 & 2)
//
// Follows the client's printed sample: per-category item rows (Qty/Amt),
// SUB TOTAL per category, grand TOTAL, SETTLEMENT by payment method, and
// an order-type breakdown (dining/takeaway/delivery). Filters:
//   • date presets — Today / Yesterday / Week / Month / Year / Custom range
//   • order types, category-wise, product-wise
// Print: 80mm-styled print window (same pipeline as existing reports).
// ============================================================
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Printer, FileBarChart } from 'lucide-react';
import { getOrders, getMenuItems, getCategories, getSettings } from '@/lib/store';
import {
  buildItemSalesReport, presetRange, type RangePreset, type SalesReportFilters,
} from '@/lib/salesReport';
import { toast } from 'sonner';
import { getShifts, getOrders as getAllOrders } from '@/lib/store';
import { buildCashDrawerReport, formatShiftDuration, type Shift } from '@/lib/shifts';
import { featureActive } from '@/lib/optionalModules';
// v1.15.1 — reports must survive Day Close. Day Close deletes orders from
// the live store, so reading getOrders() alone made every report (and every
// previous-date range) collapse to zero the moment a day was closed.
import { getAllHistoricalOrders } from '@/lib/orderArchive';

const ORDER_TYPES = [
  { v: 'dining', label: 'Dining' },
  { v: 'takeaway', label: 'Takeaway' },
  { v: 'delivery', label: 'Delivery' },
  { v: 'foodpanda', label: 'Foodpanda' },
];

type Preset = RangePreset | 'custom';

export default function ItemSalesReportPage() {
  const [preset, setPreset] = useState<Preset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [types, setTypes] = useState<string[]>([]);          // empty = all
  const [catIds, setCatIds] = useState<string[]>([]);        // empty = all
  const [itemIds, setItemIds] = useState<string[]>([]);      // empty = all
  const [productWise, setProductWise] = useState(false);
  const [itemSearch, setItemSearch] = useState('');

  const categories = useMemo(() => getCategories(), []);
  const menuItems = useMemo(() => getMenuItems(), []);
  const settings = useMemo(() => getSettings(), []);

  const range = useMemo(() => {
    if (preset !== 'custom') return presetRange(preset);
    const from = customFrom ? new Date(customFrom + 'T00:00:00') : undefined;
    const to = customTo ? new Date(customTo + 'T23:59:59.999') : undefined;
    return { from, to };
  }, [preset, customFrom, customTo]);

  const filters: SalesReportFilters = useMemo(() => ({
    from: range.from, to: range.to,
    orderTypes: types.length ? types : undefined,
    categoryIds: catIds.length ? catIds : undefined,
    itemIds: productWise && itemIds.length ? itemIds : undefined,
  }), [range, types, catIds, itemIds, productWise]);

  const report = useMemo(
    () => buildItemSalesReport(getAllHistoricalOrders(getOrders()), menuItems, categories, filters),
    [filters, menuItems, categories],
  );

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const fmtD = (d?: Date) => d ? d.toLocaleDateString('en-GB') : '—';
  const money = (n: number) => n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // v1.11.0 — Shift header + Cash drawer report.
  // Only rendered when the Shifts module is ON and a shift actually falls
  // inside the selected range; otherwise the report honestly omits them
  // rather than printing zeros that reconcile to nothing.
  const shiftForRange: Shift | undefined = useMemo(() => {
    if (!featureActive(settings, 'shiftsEnabled')) return undefined;
    const from = range.from?.getTime() ?? 0;
    const to = range.to?.getTime() ?? Date.now();
    return getShifts()
      .filter(sh => {
        const o = new Date(sh.openedAt).getTime();
        return o >= from && o <= to;
      })
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())[0];
  }, [settings, range.from, range.to]);

  const drawer = useMemo(
    () => (shiftForRange ? buildCashDrawerReport(shiftForRange, getAllHistoricalOrders(getAllOrders())) : null),
    [shiftForRange],
  );

  const printReport = () => {
    if (report.ordersIncluded === 0) { toast.error('No sales in this range'); return; }
    const w = window.open('', '_blank', 'width=380,height=640');
    if (!w) { toast.error('The popup was blocked — please allow it'); return; }
    // v1.11.0 — two flat sections, matching the client's printed sample.
    const catRows = report.categories.map(c =>
      `<div class="row"><span class="nm">${esc(c.name.toUpperCase())}</span><span class="q">${c.subQty}</span><span class="a">${money(c.subAmount)}</span></div>`
    ).join('');
    const prodRows = report.soldProducts.map(r =>
      `<div class="row"><span class="nm">${esc(r.name)}</span><span class="q">${r.qty}</span><span class="a">${money(r.amount)}</span></div>`
    ).join('');
    const settle = report.settlementWithPercent.map(s =>
      `<div class="row"><span class="nm">${esc(s.method)}</span><span class="a">${money(s.amount)}</span><span class="p">${s.percent}%</span></div>`).join('');
    const byType = report.byOrderType.map(t =>
      `<div class="row"><span class="nm">${esc(t.orderType.toUpperCase())}</span><span class="q">${t.count}</span><span class="a">${money(t.amount)}</span></div>`).join('');
    // v1.8.1 sections — Summary / Tax / Transactions blocks from the client sample.
    const sm = report.summary;
    const tx = report.tax;
    const tr = report.transactions;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Item Sales Report</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* v1.14.1 — thermal legibility.
     The report printed faint because the body was normal weight (400) at
     11px. Thermal heads under-burn thin strokes, so light text comes out
     grey and hard to read. The customer receipt never had this problem
     because it renders at weight 800 in Lucida Console. Same treatment
     here: heavier weight, slightly larger base, denser mono stack, and
     forced colour output so the browser cannot "save ink". */
  body {
    width: 72mm; margin: 0 auto;
    font-family: 'Lucida Console', 'Consolas', 'Courier New', monospace;
    font-size: 12px; font-weight: 700; color: #000;
    padding: 2mm 0 6mm;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .c { text-align: center; }
  h1 { font-size: 15px; font-weight: 900; text-align: center; margin: 2px 0; }
  .hd { font-size: 11px; font-weight: 700; text-align: center; }
  .hr { border-top: 1px dashed #000; margin: 4px 0; }
  .row, .kv { line-height: 1.35; }
  .cat { font-weight: 900; margin-top: 5px; text-transform: uppercase; }
  .row { display: flex; gap: 4px; }
  .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .q { width: 9mm; text-align: right; }
  .a { width: 17mm; text-align: right; }
  .p { width: 10mm; text-align: right; }
  .sub { font-weight: 900; border-top: 1px solid #000; margin-top: 1px; }
  .tot { font-weight: 900; font-size: 13px; border-top: 2px solid #000; margin-top: 4px; padding-top: 2px; }
  .sec { font-weight: 900; font-size: 13px; text-align: center; margin-top: 7px; letter-spacing: 1px; text-decoration: underline; }
  .kv { display: flex; }
  .kv .k { flex: 1; } .kv .v { text-align: right; }
</style></head><body>
  <h1>${esc(settings.name || 'Restaurant')}</h1>
  <div class="hd">SHIFT REPORT</div>
  ${shiftForRange ? `
    <div class="hd">${esc(shiftForRange.staffEmail || shiftForRange.staffName)}</div>
    <div class="hd">Start: ${new Date(shiftForRange.openedAt).toLocaleString('en-GB')}</div>
    <div class="hd">End: ${shiftForRange.closedAt ? new Date(shiftForRange.closedAt).toLocaleString('en-GB') : 'still open'}</div>
    <div class="hd">Shift duration: ${formatShiftDuration(shiftForRange.openedAt, shiftForRange.closedAt)}</div>
  ` : ''}
  <div class="hd">From: ${fmtD(range.from)} &nbsp; To: ${fmtD(range.to)}</div>
  <div class="hd">Printed: ${new Date().toLocaleString('en-GB')}</div>
  <div class="hr"></div>

  <div class="sec">Summary</div>
  <div class="kv"><span class="k">Product amount(exc tax)</span><span class="v">${money(sm.productAmountExcTax)}</span></div>
  <div class="kv"><span class="k">Discount</span><span class="v">${money(sm.discount)}</span></div>
  <div class="kv"><span class="k">Service charge</span><span class="v">${money(sm.serviceCharge)}</span></div>
  <div class="kv"><span class="k">Rounding</span><span class="v">${money(sm.rounding)}</span></div>
  <div class="kv sub"><span class="k">Sub-Total</span><span class="v">${money(sm.subTotal)}</span></div>
  <div class="kv"><span class="k">Refund amount(exc tax)</span><span class="v">-${money(sm.refundAmount)}</span></div>
  <div class="kv tot"><span class="k">Actual sales</span><span class="v">${money(sm.actualSales)}</span></div>

  <div class="sec">Tax</div>
  <div class="kv"><span class="k">Taxable(GST)</span><span class="v">${money(tx.taxableAmount)}</span></div>
  <div class="kv"><span class="k">GST(${tx.taxPercent}%)</span><span class="v">${money(tx.actualTax)}</span></div>
  <div class="kv sub"><span class="k">Actual tax</span><span class="v">${money(tx.actualTax)}</span></div>

  <div class="sec">Transactions</div>
  <div class="kv"><span class="k">Checked out</span><span class="v">${tr.checkedOutOrders}</span></div>
  <div class="kv"><span class="k">Average income value</span><span class="v">${money(tr.averageIncomeValue)}</span></div>
  <div class="kv"><span class="k">Sold products</span><span class="v">${tr.soldProducts}</span></div>
  <div class="kv"><span class="k">Refunded</span><span class="v">${tr.refunded}</span></div>
  <div class="kv"><span class="k">Refunded products</span><span class="v">${tr.refundedProducts}</span></div>

  ${drawer ? `
  <div class="sec">Cash drawer report</div>
  <div class="kv"><span class="k">Starting cash</span><span class="v">${money(drawer.startingCash)}</span></div>
  <div class="kv"><span class="k">Order income</span><span class="v">${money(drawer.orderIncome)}</span></div>
  <div class="kv"><span class="k">Pay in</span><span class="v">${money(drawer.payIn)}</span></div>
  <div class="kv"><span class="k">Refund</span><span class="v">-${money(drawer.refund)}</span></div>
  <div class="kv"><span class="k">Pay out</span><span class="v">-${money(drawer.payOut)}</span></div>
  <div class="kv sub"><span class="k">Expected cash</span><span class="v">${money(drawer.expectedCash)}</span></div>
  <div class="kv"><span class="k">Actual ending cash</span><span class="v">${drawer.actualEndingCash === undefined ? '—' : money(drawer.actualEndingCash)}</span></div>
  ${drawer.variance === undefined ? '' : `<div class="kv tot"><span class="k">Variance</span><span class="v">${money(drawer.variance)}</span></div>`}
  ` : ''}

  <div class="sec">Payment Report</div>
  <div class="hr"></div>
  <div class="row" style="font-weight:700"><span class="nm">Method</span><span class="a">Amount</span><span class="p">Percent</span></div>
  ${settle}
  <div class="row tot"><span class="nm">Total</span><span class="a">${money(report.settlementTotal.amount)}</span><span class="p">100%</span></div>

  <div class="sec">Sold categories</div>
  <div class="hr"></div>
  <div class="row" style="font-weight:700"><span class="nm">Products</span><span class="q">Qty</span><span class="a">Amount</span></div>
  ${catRows}
  <div class="row tot"><span class="nm">Total</span><span class="q">${report.totalQty}</span><span class="a">${money(report.totalAmount)}</span></div>

  <div class="sec">Sold products</div>
  <div class="hr"></div>
  <div class="row" style="font-weight:700"><span class="nm">Products</span><span class="q">Qty</span><span class="a">Amount</span></div>
  ${prodRows}
  <div class="row tot"><span class="nm">Total</span><span class="q">${report.totalQty}</span><span class="a">${money(report.totalAmount)}</span></div>

  <div class="sec">ORDER TYPES</div>
  <div class="hr"></div>
  ${byType}

  <div class="hr"></div>
  ${drawer ? '' : `<div class="hd" style="font-size:9px">Cash drawer report: no shift record found in this range</div>`}
  <script>window.onload = () => { window.print(); }</script>
</body></html>`);
    w.document.close();
  };

  const filteredMenu = menuItems.filter(m =>
    (!catIds.length || catIds.includes(m.categoryId))
    && (!itemSearch || m.name.toLowerCase().includes(itemSearch.toLowerCase())));

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <FileBarChart className="h-5 w-5 text-primary" /> Item Sales Report
      </h2>

      {/* Date range */}
      <Card className="p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {([['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 Days'], ['month', 'Month'], ['year', 'Year'], ['custom', 'Custom']] as [Preset, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setPreset(v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${preset === v ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'}`}>
              {label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex gap-2 items-center">
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 text-xs w-40" />
            <span className="text-xs text-muted-foreground">se</span>
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 text-xs w-40" />
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {ORDER_TYPES.map(t => (
            <label key={t.v} className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={!types.length || types.includes(t.v)}
                onCheckedChange={() => toggle(types, t.v, setTypes)} />
              {t.label}
            </label>
          ))}
          <span className="text-[10px] text-muted-foreground self-center">(all unchecked = all included)</span>
        </div>
      </Card>

      {/* Category / product selection */}
      <Card className="p-3 space-y-2">
        <div className="text-xs font-bold">Category-wise</div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map(c => (
            <button key={c.id} onClick={() => toggle(catIds, c.id, setCatIds)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${catIds.includes(c.id) ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'}`}>
              {c.name}
            </button>
          ))}
          {catIds.length > 0 && (
            <button onClick={() => setCatIds([])} className="px-2.5 py-1 rounded-full text-[11px] underline text-muted-foreground">Clear</button>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs font-bold pt-1">
          <Checkbox checked={productWise} onCheckedChange={v => setProductWise(!!v)} />
          Product-wise (selected items only)
        </label>
        {productWise && (
          <div className="space-y-1.5">
            <Input placeholder="Item search..." value={itemSearch} onChange={e => setItemSearch(e.target.value)} className="h-8 text-xs" />
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
              {filteredMenu.slice(0, 60).map(m => (
                <button key={m.id} onClick={() => toggle(itemIds, m.id, setItemIds)}
                  className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${itemIds.includes(m.id) ? 'border-primary bg-primary/10 text-primary font-semibold' : 'hover:bg-accent'}`}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Report preview */}
      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-muted-foreground">
            {fmtD(range.from)} → {fmtD(range.to)} · {report.ordersIncluded} orders
          </div>
          <Button size="sm" onClick={printReport} className="h-8">
            <Printer className="h-3.5 w-3.5 mr-1" /> Print (80mm)
          </Button>
        </div>
        {report.categories.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-6 text-center">No sales in this range or filter set.</p>
        ) : (
          <div className="font-mono text-xs max-w-sm mx-auto border rounded-lg p-3 bg-muted/20">
            {/* ============================================================
                v1.8.1 — SECTIONS FROM THE CLIENT SAMPLE
                Order matches the printed slip the client provided:
                  Summary → Tax → Transactions → Payment Report (%)
                Every number here is derived from data already stamped on
                each order (subtotal / discount / SC / tax / grand-total).
                Cash-drawer / refund workflows are NOT included — see the
                banner below and salesReport.ts notes for the honest gap.
                ============================================================ */}
            {shiftForRange && (
              <div className="mb-2 pb-2 border-b border-dashed text-[11px]">
                <div className="font-bold tracking-widest mb-0.5">Shift Report</div>
                <div>{shiftForRange.staffEmail || shiftForRange.staffName}</div>
                <div>Start: {new Date(shiftForRange.openedAt).toLocaleString('en-GB')}</div>
                <div>End: {shiftForRange.closedAt ? new Date(shiftForRange.closedAt).toLocaleString('en-GB') : 'still open'}</div>
                <div>Shift duration: {formatShiftDuration(shiftForRange.openedAt, shiftForRange.closedAt)}</div>
              </div>
            )}
            <div className="font-bold tracking-widest mb-1">Summary</div>
            <div className="flex gap-2"><span className="flex-1">Product amount(exc tax)</span><span className="text-right">{money(report.summary.productAmountExcTax)}</span></div>
            <div className="flex gap-2"><span className="flex-1">Discount</span><span className="text-right">{money(report.summary.discount)}</span></div>
            <div className="flex gap-2"><span className="flex-1">Service charge</span><span className="text-right">{money(report.summary.serviceCharge)}</span></div>
            <div className="flex gap-2"><span className="flex-1">Rounding</span><span className="text-right">{money(report.summary.rounding)}</span></div>
            <div className="flex gap-2 border-t"><span className="flex-1">Sub-Total</span><span className="text-right">{money(report.summary.subTotal)}</span></div>
            <div className="flex gap-2"><span className="flex-1">Refund amount(exc tax)</span><span className="text-right">-{money(report.summary.refundAmount)}</span></div>
            <div className="flex gap-2 font-bold border-t"><span className="flex-1">Actual sales</span><span className="text-right">{money(report.summary.actualSales)}</span></div>

            <div className="font-bold tracking-widest mt-3 mb-1">Tax</div>
            <div className="flex gap-2"><span className="flex-1">Taxable(GST)</span><span className="text-right">{money(report.tax.taxableAmount)}</span></div>
            <div className="flex gap-2"><span className="flex-1">GST({report.tax.taxPercent}%)</span><span className="text-right">{money(report.tax.actualTax)}</span></div>
            <div className="flex gap-2 font-bold border-t"><span className="flex-1">Actual tax</span><span className="text-right">{money(report.tax.actualTax)}</span></div>

            <div className="font-bold tracking-widest mt-3 mb-1">Transactions</div>
            <div className="flex gap-2"><span className="flex-1">Checked out</span><span className="text-right">{report.transactions.checkedOutOrders}</span></div>
            <div className="flex gap-2"><span className="flex-1">Average income value</span><span className="text-right">{money(report.transactions.averageIncomeValue)}</span></div>
            <div className="flex gap-2"><span className="flex-1">Sold products</span><span className="text-right">{report.transactions.soldProducts}</span></div>
            <div className="flex gap-2"><span className="flex-1">Refunded</span><span className="text-right">{report.transactions.refunded}</span></div>
            <div className="flex gap-2"><span className="flex-1">Refunded products</span><span className="text-right">{report.transactions.refundedProducts}</span></div>

            {drawer && (
              <>
                <div className="font-bold tracking-widest mt-3 mb-1">Cash drawer report</div>
                <div className="flex gap-2"><span className="flex-1">Starting cash</span><span className="text-right">{money(drawer.startingCash)}</span></div>
                <div className="flex gap-2"><span className="flex-1">Order income</span><span className="text-right">{money(drawer.orderIncome)}</span></div>
                <div className="flex gap-2"><span className="flex-1">Pay in</span><span className="text-right">{money(drawer.payIn)}</span></div>
                <div className="flex gap-2"><span className="flex-1">Refund</span><span className="text-right">-{money(drawer.refund)}</span></div>
                <div className="flex gap-2"><span className="flex-1">Pay out</span><span className="text-right">-{money(drawer.payOut)}</span></div>
                <div className="flex gap-2 font-bold border-t"><span className="flex-1">Expected cash</span><span className="text-right">{money(drawer.expectedCash)}</span></div>
                <div className="flex gap-2"><span className="flex-1">Actual ending cash</span><span className="text-right">{drawer.actualEndingCash === undefined ? '—' : money(drawer.actualEndingCash)}</span></div>
                {drawer.variance !== undefined && (
                  <div className={`flex gap-2 font-bold ${Math.abs(drawer.variance) < 0.01 ? 'text-green-700' : 'text-red-700'}`}>
                    <span className="flex-1">Variance</span><span className="text-right">{money(drawer.variance)}</span>
                  </div>
                )}
              </>
            )}
            <div className="font-bold tracking-widest mt-3 mb-1">Payment Report</div>
            <div className="flex gap-2 text-[10px] opacity-70"><span className="flex-1">Method</span><span className="w-16 text-right">Amount</span><span className="w-12 text-right">Percent</span></div>
            {report.settlementWithPercent.map(sr => (
              <div key={sr.method} className="flex gap-2">
                <span className="flex-1">{sr.method}</span>
                <span className="w-16 text-right">{money(sr.amount)}</span>
                <span className="w-12 text-right">{sr.percent}%</span>
              </div>
            ))}
            <div className="flex gap-2 font-bold border-t">
              <span className="flex-1">Total</span>
              <span className="w-16 text-right">{money(report.settlementTotal.amount)}</span>
              <span className="w-12 text-right">100%</span>
            </div>

            {/* v1.11.0 — TWO separate flat sections, exactly like the
                client's printed sample. v1.8.1 nested products inside
                categories, which did not match. */}
            <div className="font-bold tracking-widest mt-3 mb-1">Sold categories</div>
            <div className="flex gap-2 text-[10px] opacity-70">
              <span className="flex-1">Products</span><span className="w-8 text-right">Qty</span><span className="w-20 text-right">Amount</span>
            </div>
            {report.categories.map(c => (
              <div key={c.categoryId} className="flex gap-2">
                <span className="flex-1 truncate uppercase">{c.name}</span>
                <span className="w-8 text-right">{c.subQty}</span>
                <span className="w-20 text-right">{money(c.subAmount)}</span>
              </div>
            ))}
            <div className="flex gap-2 font-bold border-t mt-0.5">
              <span className="flex-1">Total</span>
              <span className="w-8 text-right">{report.totalQty}</span>
              <span className="w-20 text-right">{money(report.totalAmount)}</span>
            </div>

            <div className="font-bold tracking-widest mt-3 mb-1">Sold products</div>
            <div className="flex gap-2 text-[10px] opacity-70">
              <span className="flex-1">Products</span><span className="w-8 text-right">Qty</span><span className="w-20 text-right">Amount</span>
            </div>
            {report.soldProducts.map(r => (
              <div key={r.itemId} className="flex gap-2">
                <span className="flex-1 truncate">{r.name}</span>
                <span className="w-8 text-right">{r.qty}</span>
                <span className="w-20 text-right">{money(r.amount)}</span>
              </div>
            ))}
            <div className="flex gap-2 font-bold border-t mt-0.5">
              <span className="flex-1">Total</span>
              <span className="w-8 text-right">{report.totalQty}</span>
              <span className="w-20 text-right">{money(report.totalAmount)}</span>
            </div>

            <div className="text-center font-bold tracking-widest mt-3">ORDER TYPES</div>
            {report.byOrderType.map(t => (
              <div key={t.orderType} className="flex gap-2">
                <span className="flex-1 uppercase">{t.orderType}</span>
                <span className="w-8 text-right">{t.count}</span>
                <span className="w-20 text-right">{money(t.amount)}</span>
              </div>
            ))}

            {/* Honest gap notice for cash-drawer / shift workflows */}
            <div className="mt-3 pt-2 border-t border-dashed text-[10px] text-muted-foreground italic">
              {drawer
                ? 'The cash drawer and shift header are built from the actual record of this shift.'
                : 'Turn on the Shifts module and open/close a shift to see the cash drawer and shift header — otherwise these figures reconcile against nothing.'}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
