// ============================================================
// DT REFINED DASHBOARD — the design package's SW-02, built (v1.85.0)
//
//   greeting · restaurant · branch · weekday                         Today | Week | Month   Export
//   Sales │ Orders │ Average bill │ Open bills
//   Sales — last 7 days (2/3)                                       │ Payment mix (1/3)
//   Top items │ Orders by hour │ Needs attention
//   Recent orders
//
// Shown when the DT Refined theme is on (Settings → Appearance). Every figure comes from lib/refinedDashboard.ts, which
// uses the same "paid sale" rule as the reports; there is no sample data. The standard dashboard is one click away.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Banknote, BellRing, Calculator, CheckCircle2, ChefHat, Clock, Download, LayoutDashboard, PackageX, Plus, Receipt, ShoppingBag, UtensilsCrossed, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/hash-router';
import { getCurrentBranch, getMenuItems, getSettings, getUsers, onDataChange } from '@/lib/store';
import { money } from '@/lib/currency';
import { getCurrentBusinessDay } from '@/lib/businessDay';
import { pctChange } from '@/lib/dashboardOverview';
import {
  attentionItems, compareWindows, dailySales, dashboardCsv, highlightHour, hourLabel, kpisIn, openBills, ordersByHour,
  paymentMix, toCsvText, topItemsByQty, weekdayName, type Attention,
} from '@/lib/refinedDashboard';
import { tileHue, tileInitials } from '@/lib/tileLook';
import { cn } from '@/lib/utils';
import PlanStatusWidget from '@/components/PlanStatusWidget';
import { SectionCard } from '@/components/ui-kit';
import { RecentOrders } from '@/components/dashboard/OverviewDashboard';
import type { DashboardData, Range } from '@/pages/DashboardPage';

const rs = (n: number) => money(Math.round(n).toLocaleString('en-PK'));
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;
/** Payment mix colours: the theme's accent first, then the design package's teal, orange and blue. */
const MIX_COLOURS = ['hsl(var(--primary))', 'hsl(173 80% 26%)', 'hsl(17 88% 40%)', 'hsl(224 76% 48%)', 'hsl(330 65% 45%)', 'hsl(45 90% 40%)'];
const PERIODS: { value: Range; label: string; title: string }[] = [
  { value: '1', label: 'Today', title: 'Today so far' },
  { value: '7', label: 'Week', title: 'The last 7 days' },
  { value: '30', label: 'Month', title: 'The last 30 days' },
];
const NO_DATA = 'No data for this period';

function Up({ up, children }: { up: boolean | null; children: React.ReactNode }) {
  if (up === null) return <span className="font-semibold text-muted-foreground">{children}</span>;
  return (
    <span className={cn('inline-flex items-center gap-1', up ? 'text-[hsl(142_72%_29%)]' : 'text-[hsl(0_72%_51%)]')}>
      <span aria-hidden className="text-[10px]">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {children}
    </span>
  );
}

/** A tinted area sparkline across the bottom of a KPI card (the reference's KPI cards). Pure SVG; nothing when there is no shape to draw. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2 || values.every(v => v === values[0])) return null;
  const max = Math.max(...values); const min = Math.min(...values); const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 26 - ((v - min) / span) * 22] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg data-kpi-spark viewBox="0 0 100 30" preserveAspectRatio="none" className="block h-full w-full" aria-hidden>
      <polygon points={`0,30 ${line} 100,30`} fill="hsl(var(--primary) / .12)" />
      <polyline points={line} fill="none" stroke="hsl(var(--primary) / .55)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ id, label, value, icon: Icon, children, spark }: { id: string; label: string; value: string; icon: typeof Banknote; children: React.ReactNode; spark?: number[] }) {
  return (
    <div data-stat-card data-testid={`sw02-kpi-${id}`} className="min-w-0 overflow-hidden rounded-[var(--ui-radius-card,1rem)] border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="pt-1 text-[13px] font-semibold text-muted-foreground">{label}</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary"><Icon className="h-[18px] w-[18px]" /></span>
      </div>
      <div className="mt-1 truncate text-[28px] font-extrabold leading-tight tracking-tight tabular-nums" data-testid={`sw02-kpi-${id}-value`}>{value}</div>
      <div className="mt-1.5 line-clamp-2 text-[12.5px] font-bold" data-testid={`sw02-kpi-${id}-note`}>{children}</div>
      {spark && spark.length > 1 && <div className="-mx-5 -mb-5 mt-3 h-11" data-testid={`sw02-kpi-${id}-spark`}><Sparkline values={spark} /></div>}
    </div>
  );
}

const Empty = ({ h = 'h-[220px]' }: { h?: string }) => (
  <div className={cn('grid place-items-center rounded-xl border border-dashed text-[13px] font-semibold text-muted-foreground', h)}>{NO_DATA}</div>
);

const ATTENTION_ICON: Record<string, typeof Clock> = { approval: BellRing, stale: Receipt, credit: Wallet };
const ATTENTION_TONE: Record<Attention['tone'], string> = {
  warning: 'border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
};

export default function RefinedDashboard({ d, onSwitch }: { d: DashboardData; onSwitch: () => void }) {
  const navigate = useNavigate();
  const { range, setRange, days, scope, cashiers, cashierFilter, setCashierFilter, orders } = d;

  // Keep the figures current: refresh when orders or stock change (at most every 3 s) and move the clock each minute.
  const [now, setNow] = useState(() => Date.now());
  const refreshRef = useRef(d.refresh);
  refreshRef.current = d.refresh;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onDataChange(c => {
      if (t || !(c === '*' || c === 'orders' || c === 'inventory' || c === 'creditPayments')) return;
      t = setTimeout(() => { t = null; refreshRef.current(); setNow(Date.now()); }, 3000);
    });
    const clock = setInterval(() => setNow(Date.now()), 60000);
    return () => { off(); if (t) clearTimeout(t); clearInterval(clock); };
  }, []);

  const minute = Math.floor(now / 60000);
  const cmp = useMemo(() => compareWindows(days, now), [days, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = useMemo(() => kpisIn(orders, cmp.cur), [orders, cmp]);
  const prev = useMemo(() => kpisIn(orders, cmp.prev), [orders, cmp]);
  const open = useMemo(() => openBills(orders), [orders]);
  const trendDays = Math.max(7, days);
  const trend = useMemo(() => dailySales(orders, trendDays, now), [orders, trendDays, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const mix = useMemo(() => paymentMix(orders, cmp.cur), [orders, cmp]);
  let menu: ReturnType<typeof getMenuItems> = [];
  try { menu = getMenuItems(); } catch { /* store not ready */ }
  const top = useMemo(() => topItemsByQty(orders, menu, cmp.cur, 5), [orders, menu, cmp]);
  const today = days <= 1;
  const nowHour = new Date(now).getHours();
  const hours = useMemo(() => ordersByHour(orders, cmp.cur, today ? [nowHour] : []), [orders, cmp, today, nowHour]);
  const mark = highlightHour(hours, today, now);
  const dayStart = useMemo(() => { try { return getCurrentBusinessDay().startMs; } catch { const x = new Date(now); x.setHours(0, 0, 0, 0); return x.getTime(); } }, [minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const attention = useMemo(
    () => attentionItems({ orders, lowStock: d.lowStock, outstandingCredit: d.outstandingCredit, dayStartMs: dayStart, money: rs }),
    [orders, d.lowStock, d.outstandingCredit, dayStart],
  );

  let name = '';
  let shop = '';
  let branch = '';
  try {
    name = getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || ''))?.name || '';
    shop = getSettings().name || '';
    branch = getCurrentBranch()?.name || '';
  } catch { /* store not ready */ }
  const h = new Date(now).getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const sub = [shop, branch, weekdayName(now)].filter(Boolean).join(' · ');
  const periodLabel = today ? 'Today' : `Last ${days} days`;

  const salesPct = pctChange(cur.sales, prev.sales);
  const avgPct = pctChange(cur.avg, prev.avg);
  const orderDiff = cur.orders - prev.orders;

  const exportCsv = () => {
    const rows = dashboardCsv({ shop: [shop, branch].filter(Boolean).join(' · ') || 'DT POS', periodLabel, generatedAt: new Date(), kpis: cur, prev, vs: cmp.vs, open: open.total, days: trend, mix: mix.rows, top, hours });
    try {
      const blob = new Blob([toCsvText(rows)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dashboard-${today ? 'today' : `${days}-days`}-${new Date(now).toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.success('Dashboard exported');
    } catch { toast.error('Could not export on this device'); }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 lg:p-6" data-testid="refined-dashboard">
      <PlanStatusWidget />

      {/* Greeting and period */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[26px] font-extrabold leading-tight tracking-tight">{greeting}{name ? `, ${name}` : ''}</h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!scope.restrict && cashiers.length > 0 && (
            <select
              value={cashierFilter}
              onChange={e => setCashierFilter(e.target.value)}
              aria-label="Cashier"
              className="h-10 cursor-pointer rounded-[10px] border border-input bg-card px-3 text-[13px] font-semibold text-foreground outline-none focus:border-primary/60"
            >
              <option value="all">All cashiers</option>
              {cashiers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
            </select>
          )}
          <div role="tablist" aria-label="Period" className="inline-flex items-center gap-0.5 rounded-xl bg-muted p-1" data-testid="sw02-period">
            {PERIODS.map(p => (
              <button
                key={p.value}
                type="button"
                role="tab"
                title={p.title}
                aria-selected={range === p.value}
                onClick={() => setRange(p.value)}
                className={cn(
                  'h-8 rounded-[9px] px-4 text-[13px] font-semibold transition-colors',
                  range === p.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-[10px] border bg-card px-4 text-[13.5px] font-bold shadow-sm hover:border-primary/40" data-testid="sw02-export">
            <Download className="h-4 w-4" /> Export
          </button>
          <button type="button" onClick={onSwitch} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-semibold text-muted-foreground hover:text-foreground" data-testid="switch-standard" title="The previous dashboard, with every chart">
            <LayoutDashboard className="h-3.5 w-3.5" /> Standard view
          </button>
        </div>
      </div>

      {/* Hero: the day in one number, the two things a till does next, and the best sellers as plates (the reference's promo banner) */}
      <div
        data-testid="refined-hero"
        className="relative overflow-hidden rounded-[24px] p-6 text-primary-foreground sm:p-7"
        style={{ background: 'linear-gradient(115deg, hsl(var(--primary)) 0%, hsl(var(--primary) / .82) 52%, hsl(var(--primary) / .58) 100%)' }}
      >
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 right-40 h-56 w-56 rounded-full bg-white/10" />
        <div className="relative grid items-center gap-5 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-[.08em] opacity-85">{today ? 'Today so far' : periodLabel}</p>
            <div className="mt-1 truncate text-[38px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[44px]" data-testid="refined-hero-sales">{rs(cur.sales)}</div>
            <p className="mt-2 text-[14px] font-medium opacity-90" data-testid="refined-hero-line">
              {cur.orders} order{cur.orders === 1 ? '' : 's'} · {open.total} open bill{open.total === 1 ? '' : 's'}
              {salesPct !== null && salesPct !== 0 ? ` · ${salesPct > 0 ? '▲' : '▼'} ${Math.abs(salesPct)}% vs ${cmp.vs}` : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <button type="button" onClick={() => navigate('/')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-card px-5 text-[14px] font-bold text-primary shadow-sm hover:brightness-105" data-testid="refined-hero-new">
                <Plus className="h-4 w-4" /> New order
              </button>
              <button type="button" onClick={() => navigate('/kitchen')} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/35 bg-white/10 px-5 text-[14px] font-bold hover:bg-white/20" data-testid="refined-hero-kitchen">
                <ChefHat className="h-4 w-4" /> Kitchen
              </button>
            </div>
          </div>
          <div className="hidden items-center md:flex" aria-hidden data-testid="refined-hero-plates">
            {(top.length ? top.slice(0, 3) : [null, null, null]).map((t, i) => (
              <span
                key={t?.key ?? i}
                className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white/90 bg-white/20 shadow-xl', i === 1 ? 'z-10 h-36 w-36' : 'h-28 w-28', i > 0 && '-ml-6')}
              >
                {t?.image
                  ? <img src={t.image} alt="" className="h-full w-full object-cover" />
                  : <UtensilsCrossed className={i === 1 ? 'h-12 w-12 opacity-80' : 'h-9 w-9 opacity-70'} />}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Four KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi id="sales" label={today ? 'Sales today' : `Sales · ${periodLabel.toLowerCase()}`} value={rs(cur.sales)} icon={Banknote} spark={trend.map(p => p.sales)}>
          {cur.sales === 0 && prev.sales === 0
            ? <Up up={null}>No sales yet{today ? ' today' : ''}</Up>
            : salesPct === null
              ? <Up up={null}>Nothing sold {cmp.vs} to compare</Up>
              : <Up up={salesPct === 0 ? null : salesPct > 0}>{Math.abs(salesPct)}% vs {cmp.vs}</Up>}
        </Kpi>
        <Kpi id="orders" label="Orders" value={String(cur.orders)} icon={ShoppingBag} spark={trend.map(p => p.orders)}>
          {cur.orders === 0 && prev.orders === 0
            ? <Up up={null}>No orders yet{today ? ' today' : ''}</Up>
            : orderDiff === 0
            ? <Up up={null}>Same as {cmp.vs}</Up>
            : <Up up={orderDiff > 0}>{Math.abs(orderDiff)} {orderDiff > 0 ? 'more' : 'fewer'} than {cmp.vs}</Up>}
        </Kpi>
        <Kpi id="avg" label="Average bill" value={rs(cur.avg)} icon={Calculator} spark={trend.map(p => (p.orders ? p.sales / p.orders : 0))}>
          {avgPct === null || cur.orders === 0
            ? <Up up={null}>{cur.orders === 0 ? 'No bills yet' : `No bills ${cmp.vs} to compare`}</Up>
            : <Up up={avgPct === 0 ? null : avgPct > 0}>{Math.abs(avgPct)}% vs {cmp.vs}</Up>}
        </Kpi>
        <Kpi id="open" label="Open bills" value={String(open.total)} icon={Clock}>
          {open.total === 0
            ? <span className="font-semibold text-muted-foreground">Nothing running right now</span>
            : <button type="button" onClick={() => navigate('/running-bills')} className="text-[hsl(142_72%_29%)] hover:underline">{open.byType.map(t => `${t.count} ${t.word}`).join(' · ')}</button>}
        </Kpi>
      </div>

      {/* Sales trend (2/3) + payment mix (1/3) */}
      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title={`Sales — last ${trendDays} days`}
          actions={<button type="button" onClick={() => navigate('/reports-center')} className="rounded-full bg-primary/10 px-3 py-1 text-[12px] font-bold text-primary hover:bg-primary/15">Reports Center</button>}
        >
          {trend.every(p => p.sales === 0) ? <Empty h="h-[240px]" /> : (
            <div className="h-[240px]" data-testid="sw02-trend">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 10, right: 8, left: -6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sw02-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={trendDays > 10 ? 'preserveStartEnd' : 0} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} width={56} tickFormatter={v => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip
                    cursor={{ stroke: 'hsl(var(--primary) / 0.35)' }}
                    content={({ active, payload }) => {
                      const p = active && payload?.[0]?.payload;
                      if (!p) return null;
                      return (
                        <div className="rounded-xl border bg-card px-3 py-2 text-[12px] shadow-lg">
                          <div className="font-bold">{p.label}</div>
                          <div className="font-extrabold tabular-nums text-primary">{rs(p.sales)}</div>
                          <div className="tabular-nums text-muted-foreground">{p.orders} order{p.orders === 1 ? '' : 's'}</div>
                        </div>
                      );
                    }}
                  />
                  <Area type="linear" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#sw02-fill)" dot={{ r: 3.5, fill: 'hsl(var(--primary))', strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Payment mix" description={mix.total > 0 ? `${rs(mix.total)} · ${periodLabel.toLowerCase()}` : undefined}>
          {mix.rows.length === 0 ? <Empty h="h-[240px]" /> : (
            <div className="flex flex-wrap items-center gap-5" data-testid="sw02-mix">
              <div className="h-[170px] w-[170px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mix.rows} dataKey="amount" nameKey="name" innerRadius="64%" outerRadius="100%" startAngle={90} endAngle={-270} paddingAngle={0} stroke="none" isAnimationActive={false}>
                      {mix.rows.map((r, i) => <Cell key={r.key} fill={MIX_COLOURS[i % MIX_COLOURS.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-[120px] flex-1 space-y-2 text-[13px] sm:max-w-[320px]">
                {mix.rows.map((r, i) => (
                  <li key={r.key} className="flex items-center gap-2" title={rs(r.amount)}>
                    <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: MIX_COLOURS[i % MIX_COLOURS.length] }} />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="font-bold tabular-nums">{r.pct}%</span>
                  </li>
                ))}
                {mix.credit > 0 && <li className="pt-1 text-[11.5px] text-muted-foreground">Credit is counted in Sales once it is collected.</li>}
              </ul>
            </div>
          )}
        </SectionCard>
      </div>

      {/* Top items · orders by hour · needs attention */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Top items" description={top.length ? `By quantity · ${periodLabel.toLowerCase()}` : undefined}>
          {top.length === 0 ? <Empty h="h-[250px]" /> : (
            <ul className="space-y-3" data-testid="sw02-top">
              {top.map(t => (
                <li key={t.key} className="flex items-center gap-3">
                  {t.image
                    ? <img src={t.image} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-[10px] object-cover" />
                    : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[12px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, hsl(${tileHue(t.name)} 75% 52%), hsl(${tileHue(t.name)} 70% 40%))` }}>{tileInitials(t.name)}</span>}
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{t.name}</span>
                  <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{t.qty} sold</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Orders by hour"
          description={mark ? `${mark.why === 'now' ? 'Now' : 'Busiest'}: ${hourLabel(mark.hour)} · ${hours.find(b => b.hour === mark.hour)?.orders ?? 0} order${(hours.find(b => b.hour === mark.hour)?.orders ?? 0) === 1 ? '' : 's'}` : undefined}
        >
          {hours.length === 0 ? <Empty h="h-[250px]" /> : (
            <div className="h-[250px]" data-testid="sw02-hours">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hours} margin={{ top: 8, right: 2, left: -24, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="4 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted) / 0.6)', radius: 6 }}
                    content={({ active, payload }) => {
                      const b = active && payload?.[0]?.payload;
                      if (!b) return null;
                      return <div className="rounded-xl border bg-card px-3 py-2 text-[12px] shadow-lg"><b>{hourLabel(b.hour)}</b> · {b.orders} order{b.orders === 1 ? '' : 's'}</div>;
                    }}
                  />
                  <Bar dataKey="orders" radius={[5, 5, 0, 0]} maxBarSize={22}>
                    {hours.map(b => <Cell key={b.hour} fill={mark && b.hour === mark.hour ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.45)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Needs attention" className="lg:col-span-2 xl:col-span-1">
          {attention.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" data-testid="sw02-attention-clear">
              <CheckCircle2 className="h-4 w-4" /> Nothing needs attention right now.
            </div>
          ) : (
            <ul className="space-y-2.5" data-testid="sw02-attention">
              {attention.map(a => {
                const Icon = ATTENTION_ICON[a.key] || (a.tone === 'danger' ? PackageX : BellRing);
                return (
                  <li key={a.key}>
                    <button type="button" onClick={() => navigate(a.to)} className={cn('flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[13.5px] font-semibold transition-shadow hover:shadow-sm', ATTENTION_TONE[a.tone])}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" /> <span>{a.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <RecentOrders orders={orders} />
    </div>
  );
}
