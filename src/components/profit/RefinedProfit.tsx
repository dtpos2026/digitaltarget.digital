// v1.150.0 — Profit & loss in the design's shape (SW-27): the Summary card (Net sales · Food cost · Gross profit · Expenses · Net profit and its margin)
// beside "Margin by item" (Item · Sold · Price · Cost · Margin). The page owns the figures and the date range; this is the picture and the clicks.
import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { money } from '@/lib/currency';
import { ITEM_SORTS, itemRows, marginTone, soldLabel, type ItemFigure, type ItemSort, type PlSummary } from '@/lib/profitBoard';

export interface RefinedProfitProps {
  summary: PlSummary;
  items: ItemFigure[];
  /** the window in words, under the title */
  subtitle: string;
  bills: number;
  /** the date range control and the export menu are the page's; they sit in the header */
  filter: ReactNode;
  exportMenu: ReactNode;
  /** shown when fewer than half of the active dishes have a recipe */
  coverage: { withRecipes: number; active: number } | null;
}

const m = (n: number) => money(Math.round(n));

export default function RefinedProfit(p: RefinedProfitProps) {
  const [sort, setSort] = useState<ItemSort>('sold');
  const s = p.summary;
  const rows = itemRows(p.items, sort);
  const neg = s.netProfit < 0;
  return (
    <div className="pl-root" data-pl-page>
      <div className="pl-head">
        <div className="pl-titles"><h1 data-pl-title>Profit &amp; loss</h1><p data-pl-subtitle>{p.subtitle}</p></div>
        <div className="pl-head-actions">{p.exportMenu}</div>
      </div>
      <div className="pl-filter">{p.filter}</div>
      {p.coverage && (
        <div className="pl-notice" role="note" data-pl-notice><AlertTriangle aria-hidden className="h-4 w-4" />
          <span>Only {p.coverage.withRecipes} of {p.coverage.active} active menu items have recipes. Add recipes (Inventory → Recipes) for an accurate food cost.</span>
        </div>
      )}
      <div className="pl-grid">
        <section className="pl-card" data-pl-summary aria-label="Summary">
          <h2>Summary</h2>
          <dl>
            <div className="pl-line"><dt>Net sales</dt><dd data-pl-line="netSales">{m(s.netSales)}</dd></div>
            <div className="pl-line"><dt>Food cost</dt><dd data-pl-line="foodCost">{s.foodCost > 0 ? '− ' : ''}{m(s.foodCost)}</dd></div>
            {s.foodCost > 0 && <p className="pl-note" data-pl-foodpct>{s.foodCostPct}% of the sales of dishes with a recipe · target 30–35%</p>}
            <hr />
            <div className="pl-line"><dt>Gross profit</dt><dd data-pl-line="grossProfit">{m(s.grossProfit)}</dd></div>
            {s.wastage > 0 && <div className="pl-line"><dt>Wastage</dt><dd data-pl-line="wastage">− {m(s.wastage)}</dd></div>}
            <div className="pl-line"><dt>Expenses</dt><dd data-pl-line="expenses">{s.expenses > 0 ? '− ' : ''}{m(s.expenses)}</dd></div>
            <p className="pl-note">Expenses are the entries on Accounts → Expenses for the same dates.</p>
            <hr />
            <div className="pl-net" data-pl-net data-neg={neg ? '' : undefined}><dt>Net profit</dt><dd data-pl-line="netProfit">{neg ? '− ' : ''}{m(Math.abs(s.netProfit))}</dd></div>
            <p className="pl-note" data-pl-margin>Margin {s.marginPct}% · {p.bills} {p.bills === 1 ? 'bill' : 'bills'}</p>
          </dl>
        </section>
        <section className="pl-card pl-items" data-pl-items aria-label="Margin by item">
          <div className="pl-items-head">
            <h2>Margin by item</h2>
            <div role="group" aria-label="Order" className="pl-seg">
              {ITEM_SORTS.map(o => <button key={o.key} type="button" data-pl-sort={o.key} aria-pressed={sort === o.key} onClick={() => setSort(o.key)}>{o.label}</button>)}
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="pl-empty" data-pl-empty>No sales in these dates.</div>
          ) : (
            <div className="overflow-x-auto">
              <table data-roomy className="w-full text-[14px]">
                <thead><tr><th>Item</th><th className="text-right">Sold</th><th className="text-right">Price</th><th className="text-right">Cost</th><th className="text-right">Margin</th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.name} data-pl-row={r.name}>
                      <td className="pl-name">{r.name}</td>
                      <td className="text-right tabular-nums">{soldLabel(r.qty)}</td>
                      <td className="text-right tabular-nums">{m(r.price)}</td>
                      <td className="text-right tabular-nums" data-none={r.unitCost == null ? '' : undefined}>{r.unitCost == null ? 'no recipe' : m(r.unitCost)}</td>
                      <td className="pl-margin" data-tone={r.margin == null ? undefined : marginTone(r.margin)}>{r.margin == null ? '—' : `${r.margin}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
