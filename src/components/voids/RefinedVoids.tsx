// v1.143.0 — Void / comp / cancel in the design's shape (SW-40): "Needs a manager", a search with All · Void · Complimentary · Cancelled, and one table —
// Bill · Status · Amount · Reason · By · When. Print (what is shown) and the reprint count are kept.
import { useState } from 'react';
import { Printer, Search } from 'lucide-react';
import { money } from '@/lib/currency';
import type { Order } from '@/lib/types';
import { billSub, exitRows, KIND_LABEL, VOID_FILTERS, voidTotalsLine, whenLabel, type ExitRow, type VoidFilter } from '@/lib/voidBoard';

export interface RefinedVoidsProps {
  orders: Order[];
  onPrint: (title: string, rows: ExitRow[]) => void;
  now?: number;
}

export default function RefinedVoids({ orders, onPrint, now = Date.now() }: RefinedVoidsProps) {
  const [filter, setFilter] = useState<VoidFilter>('all');
  const [q, setQ] = useState('');
  const rows = exitRows(orders, filter, q);
  const title = filter === 'all' ? 'Void, complimentary and cancelled bills' : `${KIND_LABEL[filter]} bills`;
  return (
    <div data-vd-page className="vd-root">
      <div className="vd-head">
        <div className="vd-titles"><h1 data-vd-title>Void / comp / cancel</h1><p>Needs a manager</p></div>
        <button type="button" className="vd-btn" data-vd-print disabled={rows.length === 0} onClick={() => onPrint(title, rows)}><Printer aria-hidden className="h-4 w-4" />Print</button>
      </div>
      <div className="vd-filters" role="search" aria-label="Filter bills">
        <label className="vd-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label="Search void, comp and cancel" placeholder="Search void / comp / cancel…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div role="group" aria-label="Kind" className="vd-chips">
          {VOID_FILTERS.map(f => <button key={f.key} type="button" data-vd-filter={f.key} aria-pressed={filter === f.key} className="vd-chip" onClick={() => setFilter(f.key)}>{f.label}</button>)}
        </div>
        <span className="vd-totals" data-vd-totals>{voidTotalsLine(rows, money)}</span>
      </div>
      <div className="vd-card" data-vd-table>
        {rows.length === 0 ? (
          <div className="vd-empty" data-vd-empty>{orders.some(o => o.status === 'void' || o.status === 'complimentary' || o.status === 'cancelled') ? 'No bills match.' : 'No void, complimentary or cancelled bills yet.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table data-roomy className="w-full text-[14px]">
              <thead><tr><th>Bill</th><th>Status</th><th className="text-right">Amount</th><th>Reason</th><th>By</th><th>When</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.order.id} data-vd-row={r.order.orderNumber} data-kind={r.kind}>
                    <td>
                      <span className="vd-bill">#{r.order.orderNumber}</span>
                      <span className="vd-sub">{billSub(r.order)}{r.order.reprintCount ? ` · reprinted ${r.order.reprintCount}×` : ''}</span>
                    </td>
                    <td><span className="vd-pill" data-kind={r.kind}>{KIND_LABEL[r.kind]}</span></td>
                    <td className="text-right tabular-nums">{money(r.order.grandTotal)}</td>
                    <td className="vd-reason" title={r.reason}>{r.reason || '—'}</td>
                    <td>{r.by || '—'}</td>
                    <td className="tabular-nums">{whenLabel(r.at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
