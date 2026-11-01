// ============================================================
// BRANCH PERFORMANCE — every branch side by side, and the group (v1.82.0)
//
// Read-only, like Owner Management: an owner looking at last week's numbers is never one mis-click from editing a
// bill. Every figure is computed by lib/branchCompare.ts from the same rules the Dashboard and Reports use.
// See docs/MULTI-BRANCH-ARCHITECTURE.md (Phase 1).
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Banknote, Building2, Download, Printer, ShoppingBag, TrendingUp, Activity, AlertTriangle, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/hash-router';
import { money } from '@/lib/currency';
import { getBranches, getInventory, getOrders, getTransactions, getUsers, getWastages, onDataChange } from '@/lib/store';
import { authorizedBranchIds, filterAllowedBranches, hasAllBranchAccess } from '@/lib/branchAccess';
import { scopeToBranch } from '@/lib/cashierScope';
import {
  branchWindows, compareBranches, extremes, toCsv, type BranchPeriod, type BranchRow, type Metric,
} from '@/lib/branchCompare';
import { EmptyState, PageHeader, SectionCard, SegmentedControl } from '@/components/ui-kit';
import { TONE_CLASS, type Tone } from '@/components/ui-kit/StatusBadge';
import { cn } from '@/lib/utils';

const rs = (n: number) => money(Math.round(n).toLocaleString('en-PK'));
const pct = (n: number) => `${n}%`;
const PERIOD_LABEL: Record<BranchPeriod, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', month: 'This month' };
const PREV_LABEL: Record<BranchPeriod, string> = { today: 'yesterday', '7d': 'the 7 days before', '30d': 'the 30 days before', month: 'the same days last month' };
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;

const RANK_METRICS: { value: Metric; label: string; fmt: (n: number) => string }[] = [
  { value: 'sales', label: 'Sales', fmt: rs },
  { value: 'orders', label: 'Orders', fmt: n => String(n) },
  { value: 'avg', label: 'Average bill', fmt: rs },
  { value: 'profit', label: 'Profit', fmt: rs },
  { value: 'expenses', label: 'Expenses', fmt: rs },
];

function Change({ v }: { v: number | null }) {
  if (v === null) return <span className="text-[11.5px] text-muted-foreground">new</span>;
  if (v === 0) return <span className="text-[11.5px] text-muted-foreground">no change</span>;
  const up = v > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center text-[11.5px] font-bold tabular-nums', up ? 'text-[hsl(var(--status-success))]' : 'text-[hsl(var(--status-danger))]')}>
      <Icon className="h-3 w-3" />{Math.abs(v)}%
    </span>
  );
}

function GroupCard({ label, value, icon: Icon, tone, change, vs }: { label: string; value: string; icon: typeof Banknote; tone: Tone; change: number | null; vs: string }) {
  return (
    <div className="min-w-0 rounded-[var(--ui-radius-card,1rem)] border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-muted-foreground">{label}</span>
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', TONE_CLASS[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 truncate text-[26px] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground"><Change v={change} /> vs {vs}</div>
    </div>
  );
}

function csvCell(v: string | number) { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function download(name: string, rows: (string | number)[][]) {
  const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function BranchPerformancePage() {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  useEffect(() => onDataChange(() => setTick(t => t + 1)), []);
  const [period, setPeriod] = useState<BranchPeriod>('7d');
  const [metric, setMetric] = useState<Metric>('sales');

  // An owner (all branches) sees the rows saved without a branch; so does a session whose access has not loaded yet
  // (every other branch helper treats "unknown" as permissive — the database is the real boundary).
  const all = hasAllBranchAccess() || authorizedBranchIds() === null;
  const data = useMemo(() => ({
    branches: filterAllowedBranches(getBranches()).map(b => ({ id: b.id, name: b.name })),
    orders: scopeToBranch(getOrders()),
    transactions: scopeToBranch(getTransactions() as any[]) as ReturnType<typeof getTransactions>,
    wastages: scopeToBranch(getWastages() as any[]) as ReturnType<typeof getWastages>,
    inventory: scopeToBranch(getInventory() as any[]) as ReturnType<typeof getInventory>,
    users: getUsers(),
  }), [tick]);

  const nowMs = Date.now();
  const win = useMemo(() => branchWindows(period, nowMs), [period, Math.floor(nowMs / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(() => compareBranches(data, win, { includeUnassigned: all }), [data, win, all]);
  const ex = useMemo(() => extremes(report.rows, metric), [report.rows, metric]);
  const rankFmt = RANK_METRICS.find(m => m.value === metric)!.fmt;
  const chart = report.rows.filter(r => !r.unassigned || r.cur.sales > 0).map(r => ({ id: r.id, name: r.name, value: r.cur[metric as keyof BranchRow['cur']] as number }));
  const vs = PREV_LABEL[period];
  const g = report.group;

  const exportCsv = () => { download(`branch-performance-${period}.csv`, toCsv(report, PERIOD_LABEL[period])); toast.success('Exported'); };

  if (data.branches.length < 2) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 lg:p-6" data-testid="branch-performance">
        <PageHeader title="Branch Performance" description="Compare every branch from one place." />
        <EmptyState
          title="Branch comparison needs two or more branches"
          description="Add your other branches in Settings → Branches. Until then everything in the app works as it does for a single restaurant."
          action={<button type="button" onClick={() => navigate('/branches')} className="rounded-lg border px-3 py-2 text-[13px] font-semibold text-primary hover:bg-primary/10">Open Branches</button>}
        />
      </div>
    );
  }

  const cell = (r: BranchRow, m: Metric, text: string) => (
    <td className={cn('px-3 py-2.5 text-right tabular-nums', ex.best === r.id && m === metric && 'font-extrabold text-[hsl(var(--status-success))]', ex.weakest === r.id && m === metric && 'font-extrabold text-[hsl(var(--status-danger))]')}>{text}</td>
  );

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 lg:p-6" data-testid="branch-performance">
      <PageHeader
        title="Branch Performance"
        description={`${data.branches.length} branches · ${PERIOD_LABEL[period]} · compared with ${vs}`}
        actions={
          <>
            <SegmentedControl<BranchPeriod>
              aria-label="Period"
              value={period}
              onChange={setPeriod}
              options={[{ value: 'today', label: 'Today' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: 'month', label: 'This month' }]}
            />
            <button type="button" onClick={exportCsv} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-card px-3 text-[13px] font-semibold hover:border-primary/40"><Download className="h-3.5 w-3.5" /> Export CSV</button>
            <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-card px-3 text-[13px] font-semibold hover:border-primary/40 print:hidden"><Printer className="h-3.5 w-3.5" /> Print</button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="group-kpis">
        <GroupCard label="Sales — all branches" value={rs(g.cur.sales)} icon={Banknote} tone="accent" change={g.salesChangePct} vs={vs} />
        <GroupCard label="Orders" value={String(g.cur.orders)} icon={ShoppingBag} tone="info" change={g.prev.orders === 0 ? null : Math.round(((g.cur.orders - g.prev.orders) / g.prev.orders) * 1000) / 10} vs={vs} />
        <GroupCard label="Average bill" value={rs(g.cur.avg)} icon={TrendingUp} tone="success" change={g.prev.avg === 0 ? null : Math.round(((g.cur.avg - g.prev.avg) / g.prev.avg) * 1000) / 10} vs={vs} />
        <GroupCard label="Profit (sales − expenses)" value={rs(g.cur.profit)} icon={Activity} tone="warning" change={g.profitChangePct} vs={vs} />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <SectionCard
            title="Ranking"
            description="Branches, best first"
            actions={
              <select value={metric} onChange={e => setMetric(e.target.value as Metric)} aria-label="Rank by" className="h-8 cursor-pointer rounded-lg border bg-background px-2 text-[12.5px] font-semibold outline-none focus:border-primary/60">
                {RANK_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            }
            className="h-full"
          >
            <div className="h-[260px]" data-testid="rank-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(n: number) => (metric === 'orders' || Math.abs(n) < 1000 ? String(n) : Math.abs(n) >= 1000000 ? `${Math.round(n / 100000) / 10}M` : `${Math.round(n / 1000)}k`)} />
                  <YAxis type="category" dataKey="name" tick={axisTick} axisLine={false} tickLine={false} width={96} />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.5)' }} formatter={(v: number) => [rankFmt(v)]} />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]} maxBarSize={28}>
                    {chart.map(c => <Cell key={c.id} fill={ex.best === c.id ? 'hsl(var(--status-success))' : ex.weakest === c.id ? 'hsl(var(--status-danger) / 0.75)' : 'hsl(var(--primary))'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {(ex.best || ex.weakest) && (
              <p className="mt-2 text-[12.5px] text-muted-foreground" data-testid="rank-note">
                {ex.best && <><Trophy className="mr-1 inline h-3.5 w-3.5 text-[hsl(var(--status-success))]" /><b className="text-foreground">{report.rows.find(r => r.id === ex.best)?.name}</b> leads. </>}
                {ex.weakest && <><AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-[hsl(var(--status-danger))]" /><b className="text-foreground">{report.rows.find(r => r.id === ex.weakest)?.name}</b> is the weakest on this measure.</>}
              </p>
            )}
          </SectionCard>
        </div>

        <div className="xl:col-span-7">
          <SectionCard title="Share of the business" description="Each branch's part of the group's sales" className="h-full">
            <ul className="space-y-3" data-testid="share-list">
              {report.rows.map(r => (
                <li key={r.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate font-semibold"><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[11px] font-extrabold text-primary">{r.rank}</span>{r.name}</span>
                    <span className="shrink-0 tabular-nums"><b>{pct(r.sharePct)}</b> <span className="text-muted-foreground">· {rs(r.cur.sales)}</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(r.sharePct > 0 ? 2 : 0, r.sharePct)}%` }} /></div>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Side by side" description="Every figure for the chosen period; stock, open bills and staff are as of now">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-[13px]" data-testid="compare-table">
            <thead>
              <tr className="border-b text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Branch</th><th className="px-3 py-2 text-right">Sales</th><th className="px-3 py-2 text-right">Orders</th>
                <th className="px-3 py-2 text-right">Avg bill</th><th className="px-3 py-2 text-right">Expenses</th><th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2 text-right">Discount</th><th className="px-3 py-2 text-right">Voids</th><th className="px-3 py-2 text-right">Cash</th>
                <th className="px-3 py-2 text-right">Guests</th><th className="px-3 py-2 text-right">Open bills</th><th className="px-3 py-2 text-right">Stock value</th><th className="px-3 py-2 text-right">Staff</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map(r => (
                <tr key={r.id} className={cn('border-b', r.unassigned && 'text-muted-foreground')} data-testid={`row-${r.id}`}>
                  <td className="px-3 py-2.5 font-semibold">
                    <span className="inline-flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.name}</span>
                    {r.unassigned && <span className="ml-2 text-[11px] font-normal">(rows saved without a branch)</span>}
                  </td>
                  <td className={cn('px-3 py-2.5 text-right tabular-nums', ex.best === r.id && metric === 'sales' && 'font-extrabold text-[hsl(var(--status-success))]', ex.weakest === r.id && metric === 'sales' && 'font-extrabold text-[hsl(var(--status-danger))]')}>
                    {rs(r.cur.sales)} <span className="ml-1"><Change v={r.salesChangePct} /></span>
                  </td>
                  {cell(r, 'orders', String(r.cur.orders))}
                  {cell(r, 'avg', rs(r.cur.avg))}
                  {cell(r, 'expenses', rs(r.cur.expenses))}
                  {cell(r, 'profit', rs(r.cur.profit))}
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.cur.discountPct)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.cur.voidPct)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.cur.cashPct)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.cur.customers}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.openBills}{r.amountDue > 0 && <span className="ml-1 text-[11.5px] text-amber-700">({rs(r.amountDue)} due)</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{rs(r.inventoryValue)}{r.lowStock > 0 && <span className="ml-1 rounded-full bg-[hsl(var(--status-danger)/0.12)] px-1.5 py-0.5 text-[11px] font-bold text-[hsl(var(--status-danger))]">{r.lowStock} low</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.staff}</td>
                </tr>
              ))}
              <tr className="bg-muted/40 font-extrabold" data-testid="row-group">
                <td className="px-3 py-2.5">All branches</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{rs(g.cur.sales)} <span className="ml-1"><Change v={g.salesChangePct} /></span></td>
                <td className="px-3 py-2.5 text-right tabular-nums">{g.cur.orders}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{rs(g.cur.avg)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{rs(g.cur.expenses)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{rs(g.cur.profit)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(g.cur.discountPct)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(g.cur.voidPct)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{pct(g.cur.cashPct)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{g.cur.customers}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{g.openBills}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{rs(g.inventoryValue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{g.staff}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1 text-[12px] text-muted-foreground">
          <li>Profit is sales minus expenses, the same figure the Dashboard shows. Payroll is not split by branch, so it is not in these expenses unless it was entered as an expense.</li>
          <li>Discount is a share of what bills were worth before discount; Voids are voided, complimentary and cancelled bills as a share of all bills raised; Guests are distinct customers with a phone or name on a paid bill (the same guest at two branches counts once in the group).</li>
          {all && <li>Rows saved without a branch (older bills, or written by an all-branch sign-in) are listed separately and are included in the group.</li>}
        </ul>
      </SectionCard>

      <SectionCard title="Top items by branch" description="Best three by sales in the period">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="top-items">
          {report.rows.filter(r => !r.unassigned).map(r => (
            <div key={r.id} className="rounded-xl border p-3">
              <div className="mb-2 text-[13.5px] font-extrabold">{r.name}</div>
              {r.topItems.length === 0 ? <div className="text-[12.5px] text-muted-foreground">No sales in this period.</div> : (
                <ol className="space-y-1.5">
                  {r.topItems.map((it, i) => (
                    <li key={it.name} className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="min-w-0 truncate"><span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>{it.name}</span>
                      <span className="shrink-0 font-bold tabular-nums">{rs(it.sales)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
