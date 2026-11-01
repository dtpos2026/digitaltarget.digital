// ============================================================
// MODERN DASHBOARD — the same numbers as before (DashboardPage's
// useDashboardData is untouched), organised by importance:
//   1. the headline numbers      2. the business day
//   3. sales over time           4. what is selling / how it is paid
//   5. what needs attention now  6. everything else, one click away
// Only figures the system already computes are shown; nothing is invented.
// ============================================================
import { useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, Banknote, Bike, ChevronDown, CreditCard, Percent, ShoppingBag, Sparkles, TrendingUp, Users, Utensils, Wallet,
} from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getSettings, getTables, getUsers } from '@/lib/store';
import { useUiLook } from '@/lib/uiStyle';
import PlanStatusWidget from '@/components/PlanStatusWidget';
import { EmptyState, PageHeader, SectionCard, SegmentedControl, StatCard, StatusBadge } from '@/components/ui-kit';
import { isPaidSale } from '@/lib/sales';
import { filterCurrentShift, getShiftStart, resetShift } from '@/lib/cashierScope';
import { cn } from '@/lib/utils';
import { businessDayFigures, type DashboardData, type Range } from '@/pages/DashboardPage';

/** Categorical palette: the accent first, then colours that stay apart from it and from each other. */
const PALETTE = ['hsl(var(--primary))', 'hsl(173 58% 36%)', 'hsl(38 92% 50%)', 'hsl(212 75% 50%)', 'hsl(265 55% 55%)', 'hsl(340 70% 55%)'];
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`;

const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid hsl(var(--border))', boxShadow: 'var(--ui-shadow-pop)', fontSize: 12, padding: '8px 10px' },
  labelStyle: { fontWeight: 700 },
  cursor: { fill: 'hsl(var(--muted) / 0.6)' },
} as const;
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;

/** A donut with its own legend beneath: name, amount and share — no lines pointing at slices. */
function Donut({ data, money = true }: { data: { name: string; value: number }[]; money?: boolean }) {
  const total = data.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v: number) => [money ? rs(v) : v]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2">
        {data.map((x, i) => (
          <li key={x.name} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{x.name}</span>
            <span className="tabular-nums text-muted-foreground">{money ? rs(x.value) : x.value}</span>
            <span className="w-10 text-right font-bold tabular-nums">{total ? Math.round((x.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked rows with a bar behind the number — easier to read than a chart with 90px of label space. */
function RankedBars({ rows, format = rs, tone = 'primary' }: { rows: { name: string; value: number }[]; format?: (n: number) => string; tone?: 'primary' | 'danger' }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.name + i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate font-semibold"><span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>{r.name}</span>
            <span className="shrink-0 font-bold tabular-nums">{format(r.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', tone === 'danger' ? 'bg-[hsl(var(--status-danger))]' : 'bg-primary')}
              style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

const Empty = ({ title = 'Nothing to show yet', description }: { title?: string; description?: string }) => (
  <EmptyState className="border-0 bg-transparent py-8" title={title} description={description} />
);

/** DT Retail look: "Good afternoon, <name>" with Refresh and New Sale. */
function RetailHero({ onRefresh }: { onRefresh: () => void }) {
  const navigate = useNavigate();
  let name = '';
  let shop = '';
  try {
    name = getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || ''))?.name || '';
    shop = getSettings().name || '';
  } catch { /* store not ready */ }
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return (
    <div data-dtr="hero">
      <div className="min-w-0 flex-1">
        <h2>{greeting}{name ? `, ${name}` : ''}</h2>
        <p>Here is how {shop || 'your restaurant'} is doing today.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" data-tone="glass" onClick={() => { onRefresh(); toast.success('Figures refreshed'); }}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        <button type="button" data-tone="solid" onClick={() => navigate('/')}>
          <ShoppingBag className="h-4 w-4" /> New Sale
        </button>
      </div>
    </div>
  );
}

export default function ModernDashboard({ d }: { d: DashboardData }) {
  const {
    range, setRange, days, scope, cashiers, cashierFilter, setCashierFilter, shiftStart, setShiftStart,
    orders, orderCount, avgOrder, totalSales, profit, cashIn, outstandingCredit, creditOrdersAll,
    dailyTrend, typeBreakdown, topItems, kitchenBreakdown, hourlySales, paymentSplit, lowStock,
    hrToday, incomeExpense, topCustomers, ridersStats, genderSplit,
  } = d;
  const [more, setMore] = useState(false);
  const retail = useUiLook() === 'retail';
  const paidAll = orders.filter(isPaidSale);
  const fig = businessDayFigures(paidAll);
  const rangeLabel = range === '1' ? 'Today' : `Last ${days} days`;
  const long = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });

  const otherPaid = paymentSplit.filter(p => p.name.toLowerCase() !== 'cash').reduce((sum, p) => sum + p.value, 0);
  const discountsGiven = paidAll.reduce((sum, o) => sum + (o.discount || 0), 0);
  const floorTables = retail ? getTables() : [];
  const occupiedTables = floorTables.filter(t => t.status !== 'free' && t.status !== 'closed').length;

  const myShift = scope.restrict ? filterCurrentShift(orders).filter(isPaidSale) : [];
  const shiftSales = myShift.reduce((s, o) => s + o.grandTotal, 0);
  const shiftCash = myShift.filter(o => (o.paymentMethod || 'cash') === 'cash').reduce((s, o) => s + o.grandTotal, 0);

  return (
    <div className="mx-auto w-full max-w-[var(--ui-page-max)] space-y-5 p-4 lg:p-6" data-testid="modern-dashboard">
      <PlanStatusWidget />

      {retail && <RetailHero onRefresh={d.refresh} />}

      <PageHeader
        description={<>{long} · Business day {fig.today.label}</>}
        actions={
          <>
            {!scope.restrict && (
              <label className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
                Cashier
                <select
                  value={cashierFilter}
                  onChange={e => setCashierFilter(e.target.value)}
                  className="h-9 cursor-pointer rounded-[10px] border border-input bg-card px-3 text-[13px] font-semibold text-foreground outline-none focus:border-primary/60"
                >
                  <option value="all">All cashiers</option>
                  {cashiers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
                </select>
              </label>
            )}
            <SegmentedControl<Range>
              aria-label="Period"
              value={range}
              onChange={setRange}
              options={[{ value: '1', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]}
            />
          </>
        }
      />

      {scope.restrict && (
        <SectionCard
          title={`My shift — ${scope.name}`}
          description="Only your own bills are counted here."
          actions={
            <button
              type="button"
              onClick={() => {
                if (!confirm('Reset shift? Sales for the new shift will start from 0.')) return;
                resetShift();
                setShiftStart(getShiftStart());
                toast.success('New shift started');
              }}
              className="rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Start new shift
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Shift started" value={<span className="text-[15px]">{new Date(shiftStart).toLocaleString('en-PK')}</span>} />
            <StatCard label="Shift orders" value={myShift.length} icon={ShoppingBag} />
            <StatCard label="Shift sales" value={rs(shiftSales)} icon={Banknote} />
            <StatCard label="Cash" value={rs(shiftCash)} icon={Wallet} tone="success" />
          </div>
        </SectionCard>
      )}

      {/* 1 — the headline numbers for the chosen period */}
      <div data-dtr-kpis="lead" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Sales" value={rs(totalSales)} hint={rangeLabel} icon={Banknote} />
        <StatCard label="Orders" value={orderCount} hint={rangeLabel} icon={ShoppingBag} tone="info" />
        <StatCard label="Average order" value={rs(avgOrder)} hint="Per paid bill" icon={TrendingUp} tone="success" />
        <StatCard label="Profit" value={rs(profit)} hint="Sales minus expenses" icon={Activity} tone="warning" />
      </div>

      {/* DT Retail: the second row of headline cards — how the money came in, what was given away, floor load. */}
      {retail && (
        <div data-dtr-kpis="second" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Cash" value={rs(cashIn)} hint={rangeLabel} icon={Wallet} tone="success" />
          <StatCard label="Card / Bank / Other" value={rs(otherPaid)} hint={rangeLabel} icon={CreditCard} tone="accent" />
          <StatCard label="Discounts given" value={rs(discountsGiven)} hint={rangeLabel} icon={Percent} tone="warning" />
          <StatCard label="Tables occupied" value={`${occupiedTables} / ${floorTables.length}`} hint="Dine-in running bills" icon={Utensils} tone="danger" />
        </div>
      )}

      {/* 2 — the business day, on the restaurant's own clock */}
      <SectionCard
        title="Business day"
        description={`${fig.fmt(fig.today.start)} → ${fig.fmt(fig.today.end)}`}
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          {[
            ['Today’s sale', rs(fig.todaySum), fig.today.label],
            ['Yesterday’s sale', rs(fig.yesterdaySum), fig.yesterday.label],
            ['Current shift', rs(fig.shift), 'Since shift start'],
            ['Cash received', rs(cashIn), rangeLabel],
          ].map(([label, value, hint]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[12.5px] font-semibold text-muted-foreground">{label}</dt>
              <dd className="mt-1 truncate text-[20px] font-extrabold tracking-tight tabular-nums">{value}</dd>
              <div className="truncate text-[12px] text-muted-foreground">{hint}</div>
            </div>
          ))}
        </dl>
      </SectionCard>

      {/* 3 — sales over time, and how they split */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Sales trend" description={rangeLabel} className="lg:col-span-2">
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} width={56} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [rs(v), 'Sales']} />
                <Area type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#salesFill)" dot={false} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Order types" description={rangeLabel}>
          {typeBreakdown.length === 0 ? <Empty /> : <Donut data={typeBreakdown} />}
        </SectionCard>
      </div>

      {/* 4 — what sells, when, and how it is paid */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Top selling items" description={rangeLabel}>
          {topItems.length === 0 ? <Empty /> : <RankedBars rows={topItems.map(t => ({ name: t.name, value: t.total }))} />}
        </SectionCard>
        <SectionCard title="Sales by hour" description="Today">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlySales} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [rs(v), 'Sales']} labelFormatter={h => `${h}:00`} />
                <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Payment methods" description={rangeLabel}>
          {paymentSplit.length === 0 ? <Empty /> : <Donut data={paymentSplit} />}
        </SectionCard>
      </div>

      {/* 5 — what needs attention right now */}
      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard
          title="Kitchen — live"
          actions={<StatusBadge tone={kitchenBreakdown.length ? 'warning' : 'success'}>{kitchenBreakdown.length ? 'Open orders' : 'Idle'}</StatusBadge>}
        >
          {kitchenBreakdown.length === 0 ? <Empty title="Kitchen is idle" description="No running orders right now." /> : <Donut data={kitchenBreakdown} money={false} />}
        </SectionCard>
        <SectionCard
          title="Low stock"
          actions={lowStock.length > 0 ? <StatusBadge tone="danger">{lowStock.length} to reorder</StatusBadge> : undefined}
        >
          {lowStock.length === 0 ? <Empty title="Everything is stocked" description="No item is at or below its minimum level." />
            : <RankedBars tone="danger" rows={lowStock.map(l => ({ name: `${l.name} (min ${l.min})`, value: l.qty }))} format={n => `${n} left`} />}
        </SectionCard>
        <SectionCard title="Delivery and credit">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Riders" value={ridersStats.total} hint={`${ridersStats.active} active`} icon={Bike} tone="info" />
            <StatCard label="On delivery" value={ridersStats.onDelivery} hint="Running orders" icon={Bike} tone="warning" />
            <StatCard label="Credit bills" value={creditOrdersAll.length} hint="Pending" icon={CreditCard} tone="accent" />
            <StatCard label="Credit balance" value={rs(Math.max(0, outstandingCredit))} hint="Outstanding" icon={Wallet} tone="danger" />
          </div>
        </SectionCard>
      </div>

      {/* 6 — everything else, folded away */}
      <button
        type="button"
        onClick={() => setMore(m => !m)}
        aria-expanded={more}
        className="flex w-full items-center justify-center gap-2 rounded-[var(--ui-radius-card,1rem)] border border-dashed bg-card/60 py-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Sparkles className="h-4 w-4" /> {more ? 'Hide more insights' : 'Show more insights'}
        <ChevronDown className={cn('h-4 w-4 transition-transform', more && 'rotate-180')} />
      </button>
      {more && (
        <div className="grid gap-3 lg:grid-cols-2">
          <SectionCard title="Income vs expense" description={rangeLabel}>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={incomeExpense} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [rs(v)]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="income" fill="hsl(var(--status-success))" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expense" fill="hsl(var(--status-danger))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
          <SectionCard title="Top customers" actions={<Users className="h-4 w-4 text-muted-foreground" />}>
            {topCustomers.length === 0 ? <Empty /> : <RankedBars rows={topCustomers.map(c => ({ name: c.name, value: c.total }))} />}
          </SectionCard>
          <SectionCard title="Staff attendance" description="Today">
            {hrToday.length === 0 ? <Empty title="No attendance marked" /> : <Donut data={hrToday} money={false} />}
          </SectionCard>
          <SectionCard title="Customer gender" description="Online accounts">
            {genderSplit.length === 0 ? <Empty title="No online accounts yet" /> : <Donut data={genderSplit} money={false} />}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
