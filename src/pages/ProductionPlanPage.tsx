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
import { EmptyState, FilterBar, PageHeader } from '@/components/layout/PageFrame';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getBranches, getCategories, getMenuItems, getOrders } from '@/lib/store';
import { scopeToBranch } from '@/lib/cashierScope';
import { buildPlan, localDay, planAsCsv, planAsText } from '@/lib/productionPlan';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProductionSheetPanel from '@/components/production/ProductionSheetPanel';
import ReportActions from '@/components/ReportActions';
import type { ReportDoc } from '@/lib/reportExport';
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
  // the same figures as on screen, for Print / PDF / POS / JPG
  const reportDoc = (): ReportDoc => {
    const day1 = WEEKDAYS[target.getDay()];
    return {
      title: 'Production plan', subtitle: `${day1} ${day}`, meta: branch !== 'all' ? [{ label: 'Branch', value: labelOf(branch) }] : [], filename: `production-plan-${day}`,
      columns: perBranch
        ? [{ key: 'item', label: 'Item' }, ...plan.columns.map(c => ({ key: c, label: labelOf(c), align: 'right' as const })), { key: 'total', label: 'Total', align: 'right' as const }]
        : [{ key: 'item', label: 'Item' }, { key: 'history', label: `Sold on the last ${weeks} ${day1}s`, align: 'right' as const }, { key: 'average', label: 'Average', align: 'right' as const }, { key: 'make', label: 'Make', align: 'right' as const }],
      rows: rows.map((r): Record<string, string | number> => perBranch
        ? { item: r.name, ...Object.fromEntries(r.perColumn.map(c => [c.col, c.qty])), total: r.total }
        : { item: r.name, history: r.history[plan.columns[0]].join(' · '), average: r.average[plan.columns[0]], make: r.perColumn[0].qty }),
      totals: perBranch ? { ...Object.fromEntries(plan.columns.map((c, i) => [c, rows.reduce((s, r) => s + r.perColumn[i].qty, 0)])), total: totalPieces } : { make: totalPieces },
      notes: [`Average of the days the branch traded, plus ${buffer}%${batch > 1 ? `, rounded up to trays of ${batch}` : ''}.`],
    };
  };
  const toggleCat = (id: string) => setCats(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));

  return (
    <div className="space-y-4 p-4 lg:p-6" data-production-plan>
      <PageHeader
        icon={<Wheat />} title="Production" subtitle="Plan tomorrow from the same weekday’s sales, then track what was made, sold and left — branch by branch"
        actions={<>
          <Button size="sm" variant="outline" onClick={copy} disabled={totalPieces === 0} data-plan-copy><Copy className="mr-1 h-3.5 w-3.5" /> Copy</Button>
          <Button size="sm" variant="outline" asChild disabled={totalPieces === 0}>
            <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" data-plan-whatsapp><MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp</a>
          </Button>
          <Button size="sm" variant="outline" onClick={csv} disabled={totalPieces === 0} data-plan-csv><Download className="mr-1 h-3.5 w-3.5" /> CSV</Button>
          <ReportActions build={reportDoc} disabled={totalPieces === 0} />
        </>}
      />

      <Tabs defaultValue="plan">
        <TabsList>
          <TabsTrigger value="plan" data-tab-plan>Plan</TabsTrigger>
          <TabsTrigger value="sheet" data-tab-sheet>Day sheet</TabsTrigger>
        </TabsList>
        <TabsContent value="plan" className="space-y-4">

      <FilterBar label="Plan settings">
        <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">Plan for
          <Input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="w-40" data-plan-date />
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">Look back
          <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} data-plan-weeks>
            {[2, 4, 6, 8].map(w => <option key={w} value={w}>{w} × {WEEKDAYS[target.getDay()]}s</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">Extra on top (%)
          <Input type="number" min={0} max={50} value={buffer} onChange={e => setBuffer(Math.min(50, Math.max(0, Number(e.target.value) || 0)))} className="w-28" data-plan-buffer />
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">Round up to
          <select value={batch} onChange={e => setBatch(Number(e.target.value))} data-plan-batch>
            {[1, 6, 12, 24].map(b => <option key={b} value={b}>{b === 1 ? 'Single pieces' : `Trays of ${b}`}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">Branch
          <select value={branch} onChange={e => setBranch(e.target.value)} data-plan-branch>
            <option value="all">{branches.length > 1 ? 'Every branch (one column each)' : 'All'}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </FilterBar>
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

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" data-plan-total><CalendarDays className="mr-1 h-3 w-3" /> {WEEKDAYS[target.getDay()]} {day}</Badge>
        <Badge variant="outline">{rows.length} item{rows.length === 1 ? '' : 's'}</Badge>
        <Badge variant="outline">{totalPieces} pieces in all</Badge>
        {Object.keys(edits).length > 0 && <button type="button" onClick={() => setEdits({})} className="text-xs font-semibold text-primary underline" data-plan-reset>Back to the suggested numbers</button>}
      </div>

      {rows.length === 0 ? (
        <div data-plan-empty>
          <EmptyState icon={<Wheat />} title="Not enough sales history yet" hint="A plan needs sales on the same weekday of at least one earlier week. It fills itself in as you trade." />
        </div>
      ) : (
        <Table data-plan-table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              {!perBranch && <TableHead className="text-right">Sold on the last {weeks} {WEEKDAYS[target.getDay()]}s</TableHead>}
              {!perBranch && <TableHead className="text-right">Average</TableHead>}
              {plan.columns.map(c => <TableHead key={c} className="text-right">{perBranch ? labelOf(c) : 'Make'}</TableHead>)}
              {perBranch && <TableHead className="text-right">Total</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.itemId} data-plan-row={r.itemId}>
                <TableCell className="font-semibold">{r.name}{r.tradingDays < 2 && <Badge variant="outline" className="ml-2 text-[10px] font-normal" title="Only one earlier day to go on">few days of history</Badge>}</TableCell>
                {!perBranch && <TableCell className="text-right tabular-nums text-muted-foreground">{r.history[plan.columns[0]].join(' · ')}</TableCell>}
                {!perBranch && <TableCell className="text-right tabular-nums">{r.average[plan.columns[0]]}</TableCell>}
                {r.perColumn.map(c => (
                  <TableCell key={c.col} className="text-right">
                    <Input type="number" min={0} value={c.qty} aria-label={`${r.name}${perBranch ? ` — ${c.label}` : ''}`} data-plan-qty={`${r.itemId}|${c.col}`}
                      onChange={e => setEdits(x => ({ ...x, [`${r.itemId}|${c.col}`]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
                      className={cn('ml-auto w-20 text-right font-bold tabular-nums', edits[`${r.itemId}|${c.col}`] !== undefined && 'border-primary')} />
                  </TableCell>
                ))}
                {perBranch && <TableCell className="text-right font-extrabold tabular-nums" data-plan-row-total>{r.total}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">All items</TableCell>
              {!perBranch && <TableCell colSpan={2} />}
              {plan.columns.map((c, i) => <TableCell key={c} className="text-right font-bold tabular-nums">{rows.reduce((s, r) => s + r.perColumn[i].qty, 0)}</TableCell>)}
              {perBranch && <TableCell className="text-right font-bold tabular-nums">{totalPieces}</TableCell>}
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <p className="text-[11px] text-muted-foreground">
        The suggestion is the average of the days the branch actually traded (a closed day is not counted as zero) plus the extra percentage, rounded up. Weighed items are not planned. Change any number before sharing.
      </p>
        </TabsContent>
        <TabsContent value="sheet"><ProductionSheetPanel /></TabsContent>
      </Tabs>
    </div>
  );
}
