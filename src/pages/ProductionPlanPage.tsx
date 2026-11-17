// Production Plan (v1.115.0) — for a bakery / café / restaurant chain. The evening before, it says how much of each item to make
// tomorrow, from what the same weekday sold over the last few weeks, with one column per branch so the central bakery knows how
// much to send where. Everything is a suggestion: every figure can be changed before it is shared.
import { useMemo, useState } from 'react';
import { CalendarDays, Copy, Download, MessageCircle, Wheat } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageTitle } from '@/components/layout/PageFrame';
import { getBranches, getCategories, getMenuItems, getOrders } from '@/lib/store';
import { scopeToBranch } from '@/lib/cashierScope';
import { buildPlan, localDay, planAsCsv, planAsText } from '@/lib/productionPlan';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return localDay(d); };
const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

export default function ProductionPlanPage() {
  const orders = useMemo(() => scopeToBranch(getOrders()), []);
  const items = useMemo(() => getMenuItems().filter(m => m.isActive !== false), []);
  const categories = useMemo(() => getCategories(), []);
  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false), []);

  const [day, setDay] = useState(tomorrow);
  const [weeks, setWeeks] = useState(4);
  const [buffer, setBuffer] = useState(10);
  const [batch, setBatch] = useState(1);
  const [branch, setBranch] = useState<string>('all');
  const [cats, setCats] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, number>>({});

  const target = parseDay(day);
  const perBranch = branch === 'all' && branches.length > 1;
  const columnIds = perBranch ? branches.map(b => b.id) : branch !== 'all' ? [branch] : undefined;
  const labelOf = (id: string) => (id === 'all' ? 'All' : branches.find(b => b.id === id)?.name || 'Branch');

  const plan = useMemo(() => buildPlan({
    orders: branch !== 'all' ? orders.filter(o => o.branchId === branch) : orders,
    items: items.map(m => ({ id: m.id, name: m.name, categoryId: m.categoryId, pricingType: m.pricingType, isActive: m.isActive })),
    target, weeks, bufferPct: buffer, batch,
    branchIds: columnIds, categoryIds: cats.length ? cats : undefined,
  }), [orders, items, day, weeks, buffer, batch, branch, cats]); // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (itemId: string, col: string, suggested: number) => edits[`${itemId}|${col}`] ?? suggested;
  const rows = plan.rows.map(r => {
    const perColumn = plan.columns.map(c => ({ col: c, label: labelOf(c), qty: cell(r.itemId, c, r.forecast[c]) }));
    return { ...r, perColumn, total: perColumn.reduce((s, c) => s + c.qty, 0) };
  });
  const totalPieces = rows.reduce((s, r) => s + r.total, 0);
  const title = `Production plan — ${WEEKDAYS[target.getDay()]} ${day}${branch !== 'all' ? ` — ${labelOf(branch)}` : ''}`;
  const text = planAsText(title, rows.map(r => ({ name: r.name, perColumn: r.perColumn.map(c => ({ label: c.label, qty: c.qty })), total: r.total })));

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Plan copied — paste it into WhatsApp'); } catch { toast.error('Could not copy. Use the WhatsApp button instead.'); }
  };
  const csv = () => {
    const body = planAsCsv(plan.columns.map(labelOf), rows.map(r => ({ name: r.name, perColumn: r.perColumn.map(c => c.qty), total: r.total })));
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `production-plan-${day}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const toggleCat = (id: string) => setCats(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));

  return (
    <div className="space-y-4 p-4 lg:p-6" data-production-plan>
      <div className="flex flex-wrap items-center gap-3">
        <PageTitle icon={Wheat} subtitle="What to make tomorrow, from what the same weekday sold — for every branch">Production Plan</PageTitle>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={totalPieces === 0} data-plan-copy><Copy className="mr-1 h-3.5 w-3.5" /> Copy</Button>
          <Button size="sm" variant="outline" asChild disabled={totalPieces === 0}>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" data-plan-whatsapp><MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp</a>
          </Button>
          <Button size="sm" variant="outline" onClick={csv} disabled={totalPieces === 0} data-plan-csv><Download className="mr-1 h-3.5 w-3.5" /> CSV</Button>
        </div>
      </div>

      <Card className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[11px] font-bold text-muted-foreground">Plan for
            <Input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="mt-1 h-9 text-sm" data-plan-date />
          </label>
          <label className="text-[11px] font-bold text-muted-foreground">Look back
            <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} data-plan-weeks className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground">
              {[2, 4, 6, 8].map(w => <option key={w} value={w}>{w} × {WEEKDAYS[target.getDay()]}s</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-muted-foreground">Extra on top (%)
            <Input type="number" min={0} max={50} value={buffer} onChange={e => setBuffer(Math.min(50, Math.max(0, Number(e.target.value) || 0)))} className="mt-1 h-9 text-sm" data-plan-buffer />
          </label>
          <label className="text-[11px] font-bold text-muted-foreground">Round up to
            <select value={batch} onChange={e => setBatch(Number(e.target.value))} data-plan-batch className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground">
              {[1, 6, 12, 24].map(b => <option key={b} value={b}>{b === 1 ? 'Single pieces' : `Trays of ${b}`}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-muted-foreground">Branch
            <select value={branch} onChange={e => setBranch(e.target.value)} data-plan-branch className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground">
              <option value="all">{branches.length > 1 ? 'Every branch (one column each)' : 'All'}</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
        {categories.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5" data-plan-cats>
            <span className="mr-1 text-[11px] font-bold text-muted-foreground">Only</span>
            {categories.map(c => (
              <button key={c.id} type="button" aria-pressed={cats.includes(c.id)} onClick={() => toggleCat(c.id)}
                className={cn('h-8 rounded-full border-2 px-3 text-xs font-semibold', cats.includes(c.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50')}>{c.name}</button>
            ))}
            {cats.length > 0 && <button type="button" onClick={() => setCats([])} className="text-xs font-semibold text-muted-foreground underline">All categories</button>}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" data-plan-total><CalendarDays className="mr-1 h-3 w-3" /> {WEEKDAYS[target.getDay()]} {day}</Badge>
        <Badge variant="outline">{rows.length} item{rows.length === 1 ? '' : 's'}</Badge>
        <Badge variant="outline">{totalPieces} pieces in all</Badge>
        {Object.keys(edits).length > 0 && <button type="button" onClick={() => setEdits({})} className="text-xs font-semibold text-primary underline" data-plan-reset>Back to the suggested numbers</button>}
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground" data-plan-empty>
          <Wheat className="mx-auto mb-2 h-10 w-10 opacity-50" />
          Not enough sales history yet. A plan needs sales on the same weekday of at least one earlier week — it fills itself in as you trade.
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card" data-plan-table>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Item</th>
                {!perBranch && <th className="px-3 py-2 text-right">Sold on the last {weeks} {WEEKDAYS[target.getDay()]}s</th>}
                {!perBranch && <th className="px-3 py-2 text-right">Average</th>}
                {plan.columns.map(c => <th key={c} className="px-3 py-2 text-right">{perBranch ? labelOf(c) : 'Make'}</th>)}
                {perBranch && <th className="px-3 py-2 text-right">Total</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.itemId} className="border-b last:border-0" data-plan-row={r.itemId}>
                  <td className="px-3 py-2 font-semibold">{r.name}{r.tradingDays < 2 && <span className="ml-2 text-[10px] font-normal text-amber-700" title="Only one earlier day to go on">few days of history</span>}</td>
                  {!perBranch && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.history[plan.columns[0]].map(n => n).join(' · ')}</td>}
                  {!perBranch && <td className="px-3 py-2 text-right tabular-nums">{r.average[plan.columns[0]]}</td>}
                  {r.perColumn.map(c => (
                    <td key={c.col} className="px-2 py-1.5 text-right">
                      <input type="number" min={0} value={c.qty} aria-label={`${r.name}${perBranch ? ` — ${c.label}` : ''}`} data-plan-qty={`${r.itemId}|${c.col}`}
                        onChange={e => setEdits(x => ({ ...x, [`${r.itemId}|${c.col}`]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                        className={cn('h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm font-bold tabular-nums', edits[`${r.itemId}|${c.col}`] !== undefined && 'border-primary')} />
                    </td>
                  ))}
                  {perBranch && <td className="px-3 py-2 text-right font-extrabold tabular-nums" data-plan-row-total>{r.total}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-bold">
                <td className="px-3 py-2">All items</td>
                {!perBranch && <td colSpan={2} />}
                {plan.columns.map((c, i) => <td key={c} className="px-3 py-2 text-right tabular-nums">{rows.reduce((s, r) => s + r.perColumn[i].qty, 0)}</td>)}
                {perBranch && <td className="px-3 py-2 text-right tabular-nums">{totalPieces}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        The suggestion is the average of the days the branch actually traded (a closed day is not counted as zero) plus the extra percentage, rounded up. Weighed items are not planned. Change any number before sharing.
      </p>
    </div>
  );
}
