// ============================================================
// OWNER OVERVIEW — a calmer arrangement of the dashboard's own numbers (v1.80.0).
//
//   headline cards with a trend line and the change since the period before
//   │ the service area (where deliveries went)
//   order rate (week / month / year) │ how the sales split by order type
//   recent orders │ system status and the look & templates in use
//
// It uses the brand colours and the active theme (every colour is a design token). The standard dashboard is
// still one click away, and nothing here is estimated — see lib/dashboardOverview.ts.
// ============================================================
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, Bike, CheckCircle2, Cloud, CloudOff, CreditCard, LayoutDashboard, MapPin, Package, Palette,
  Printer, Receipt, RefreshCw, Search, ShoppingBag, TrendingUp, Utensils,
} from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { getBranches, getMenuItems, getSettings, getTransactions, getUsers, onSyncStatus } from '@/lib/store';
import { money } from '@/lib/currency';
import { computeDistance } from '@/lib/delivery';
import { APP_VERSION } from '@/lib/version';
import { getTheme, useUiStyle } from '@/lib/uiStyle';
import { ALL_PREMIUM_TEMPLATES } from '@/lib/premiumReceiptTemplates';
import { localDb } from '@/lib/localDb';
import { cn } from '@/lib/utils';
import PlanStatusWidget from '@/components/PlanStatusWidget';
import { EmptyState, SectionCard, SegmentedControl } from '@/components/ui-kit';
import { TONE_CLASS, type Tone } from '@/components/ui-kit/StatusBadge';
import type { DashboardData, Range } from '@/pages/DashboardPage';
import {
  deliveryPoints, pctChange, periodWindows, peakBucket, rateBuckets, recentRows, sparkSeries, totalsIn,
  typeShares, type Metric, type PillTone, type RateMode,
} from '@/lib/dashboardOverview';

const LeafletMap = lazy(() => import('@/components/LeafletMap'));

const rs = (n: number) => money(Math.round(n).toLocaleString('en-PK'));
const TYPE_COLOURS = ['hsl(var(--primary))', 'hsl(173 58% 38%)', 'hsl(38 92% 50%)', 'hsl(265 55% 55%)'];
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;
const PILL: Record<PillTone, string> = {
  success: 'bg-[hsl(var(--status-success)/0.14)] text-[hsl(var(--status-success))]',
  info: 'bg-[hsl(var(--status-info)/0.13)] text-[hsl(var(--status-info))]',
  warning: 'bg-amber-500/15 text-amber-700',
  danger: 'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))]',
  neutral: 'bg-muted text-muted-foreground',
};

function Spark({ data, id, positive }: { data: number[]; id: string; positive: boolean }) {
  const rows = data.map((v, i) => ({ i, v }));
  const colour = positive ? 'hsl(var(--status-success))' : 'hsl(var(--status-danger))';
  return (
    <div className="h-[44px] w-[112px] shrink-0" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.28} />
              <stop offset="100%" stopColor={colour} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={colour} strokeWidth={2} fill={`url(#sp-${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Delta({ pct, vs }: { pct: number | null; vs: string }) {
  if (pct === null) return <span className="text-[12px] text-muted-foreground">No sales {vs} to compare</span>;
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[12px]">
      <span className={cn('inline-flex items-center gap-0.5 font-bold tabular-nums', pct === 0 ? 'text-muted-foreground' : up ? 'text-[hsl(var(--status-success))]' : 'text-[hsl(var(--status-danger))]')}>
        {pct !== 0 && <Icon className="h-3.5 w-3.5" />}{Math.abs(pct)}%
      </span>
      <span className="text-muted-foreground">vs {vs}</span>
    </span>
  );
}

interface KpiProps { id: string; label: string; value: string; icon: typeof Banknote; tone: Tone; pct: number | null; vs: string; series: number[] }
function Kpi({ id, label, value, icon: Icon, tone, pct, vs, series }: KpiProps) {
  return (
    <div data-testid={`kpi-${id}`} className="min-w-0 rounded-[var(--ui-radius-card,1rem)] border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-muted-foreground">{label}</span>
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', TONE_CLASS[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[26px] font-extrabold leading-none tracking-tight tabular-nums" data-testid={`kpi-${id}-value`}>{value}</div>
          <div className="mt-2"><Delta pct={pct} vs={vs} /></div>
        </div>
        <Spark data={series} id={id} positive={pct === null || pct >= 0} />
      </div>
    </div>
  );
}

function ServiceArea({ orders, days }: { orders: DashboardData['orders']; days: number }) {
  const branches = useMemo(() => { try { return getBranches(); } catch { return []; } }, []);
  const settings = useMemo(() => getSettings(), []);
  const w = periodWindows(days, Date.now()).cur;
  const pts = useMemo(() => deliveryPoints(orders, w), [orders, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const homes = branches.filter(b => b.lat != null && b.lng != null);
  const home = homes[0] ? { lat: homes[0].lat!, lng: homes[0].lng! }
    : settings.restaurantLat != null && settings.restaurantLng != null ? { lat: settings.restaurantLat, lng: settings.restaurantLng } : null;
  const avgKm = home && pts.length ? pts.reduce((s, p) => s + computeDistance(home, p), 0) / pts.length : null;
  const center: [number, number] | undefined = home ? [home.lat, home.lng]
    : pts.length ? [pts.reduce((s, p) => s + p.lat, 0) / pts.length, pts.reduce((s, p) => s + p.lng, 0) / pts.length] : undefined;
  const markers = useMemo(() => [
    ...homes.map(b => ({ id: `b-${b.id}`, lat: b.lat!, lng: b.lng!, title: b.name, color: 'gold' as const })),
    ...(homes.length === 0 && home ? [{ id: 'home', lat: home.lat, lng: home.lng, title: settings.name || 'Restaurant', color: 'gold' as const }] : []),
    ...pts.slice(0, 300).map((p, i) => ({ id: `d-${i}`, lat: p.lat, lng: p.lng, title: 'Delivery', color: 'blue' as const })),
  ], [homes.length, pts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const circles = homes.filter(b => (b.serviceRadiusKm || 0) > 0).map(b => ({ id: `c-${b.id}`, lat: b.lat!, lng: b.lng!, radiusM: (b.serviceRadiusKm || 0) * 1000, color: 'hsl(var(--primary))', fillOpacity: 0.06, weight: 1.5 }));

  return (
    <SectionCard
      title="Service area"
      description={pts.length ? `${pts.length} delivery drop-off${pts.length === 1 ? '' : 's'}${avgKm !== null ? ` · ${avgKm.toFixed(1)} km on average` : ''}` : 'Where deliveries go'}
      className="h-full"
    >
      {markers.length === 0 ? (
        <EmptyState className="border-0 bg-transparent py-8" title="No locations yet" description="Delivery orders with the customer's GPS pin, and branches with a map position, appear here." />
      ) : (
        <div className="relative z-0 h-[218px] overflow-hidden rounded-xl border" data-testid="service-area-map">
          <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-muted-foreground">Loading map…</div>}>
            <LeafletMap markers={markers} circles={circles} center={center} zoom={11} height="100%" />
          </Suspense>
        </div>
      )}
    </SectionCard>
  );
}

function OrderRate({ orders }: { orders: DashboardData['orders'] }) {
  const [mode, setMode] = useState<RateMode>('monthly');
  const buckets = useMemo(() => rateBuckets(orders, mode, Date.now()), [orders, mode]);
  const peak = peakBucket(buckets);
  const title = mode === 'weekly' ? 'Orders this week' : mode === 'monthly' ? 'Orders in the last 12 months' : 'Orders by year';
  return (
    <SectionCard
      title="Order rate"
      description={title}
      actions={
        <SegmentedControl<RateMode>
          aria-label="Order rate period"
          value={mode}
          onChange={setMode}
          options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]}
        />
      }
      className="h-full"
    >
      {!peak ? (
        <EmptyState className="border-0 bg-transparent py-10" title="No paid orders in this period" description="Orders appear here as bills are paid." />
      ) : (
        <>
          <div className="mb-1 text-[12.5px] text-muted-foreground" data-testid="rate-peak">
            Busiest: <b className="text-foreground">{peak.label}</b> · {peak.orders} order{peak.orders === 1 ? '' : 's'} · {rs(peak.sales)}
          </div>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 8, right: 4, left: -14, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted) / 0.55)', radius: 8 }}
                  content={({ active, payload }) => {
                    const b = active && payload?.[0]?.payload;
                    if (!b) return null;
                    return (
                      <div className="rounded-xl border bg-card px-3 py-2 text-[12px] shadow-lg">
                        <div className="font-bold">{b.label}</div>
                        <div className="text-primary font-extrabold tabular-nums">{b.orders} orders</div>
                        <div className="text-muted-foreground tabular-nums">{rs(b.sales)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="orders" radius={[8, 8, 0, 0]} maxBarSize={34}>
                  {buckets.map(b => <Cell key={b.key} fill={peak && b.key === peak.key ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.22)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function OrderTypes({ orders, days }: { orders: DashboardData['orders']; days: number }) {
  const w = periodWindows(days, Date.now()).cur;
  const rows = useMemo(() => typeShares(orders, w), [orders, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, r) => s + r.orders, 0);
  return (
    <SectionCard title="Order types" description={days <= 1 ? 'Today, by sales' : `Last ${days} days, by sales`} className="h-full">
      {rows.length === 0 ? (
        <EmptyState className="border-0 bg-transparent py-10" title="Nothing sold yet" />
      ) : (
        <div className="flex flex-col items-center">
          <div className="relative mt-2 h-[160px] w-full max-w-[300px]" data-testid="order-types-gauge">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="sales" startAngle={180} endAngle={0} cx="50%" cy="100%" innerRadius="70%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {rows.map((r, i) => <Cell key={r.key} fill={TYPE_COLOURS[i % TYPE_COLOURS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Orders</div>
              <div className="text-[28px] font-extrabold leading-none tabular-nums">{total}</div>
            </div>
          </div>
          <ul className="mt-4 w-full divide-y rounded-xl border">
            {rows.map((r, i) => (
              <li key={r.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: TYPE_COLOURS[i % TYPE_COLOURS.length] }} />
                <span className="w-9 shrink-0 font-extrabold tabular-nums">{r.pct}%</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{rs(r.sales)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

/** Also used by the DT Refined dashboard (SW-02's orders table). */
export function RecentOrders({ orders }: { orders: DashboardData['orders'] }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const menu = useMemo(() => { try { return getMenuItems(); } catch { return []; } }, []);
  const rows = useMemo(() => recentRows(orders, menu, 8, q), [orders, menu, q]);
  return (
    <SectionCard
      title="Recent orders"
      description="Newest first"
      actions={
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search customer or bill…"
              aria-label="Search recent orders"
              className="h-8 w-[190px] rounded-lg border bg-background pl-8 pr-2 text-[12.5px] outline-none focus:border-primary/60"
            />
          </label>
          <button type="button" onClick={() => navigate('/admin-sales-history')} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold text-primary hover:bg-primary/10">View all</button>
        </div>
      }
      className="h-full"
    >
      {rows.length === 0 ? (
        <EmptyState className="border-0 bg-transparent py-8" title={q ? 'No order matches' : 'No orders yet'} description={q ? 'Try a bill number, a customer name or an item.' : 'Bills appear here as soon as they are made.'} />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[13px]" data-testid="recent-orders">
            <thead>
              <tr className="border-b text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2">Code</th><th className="px-2 py-2">Menu</th><th className="px-2 py-2">Customer</th>
                <th className="px-2 py-2 text-right">Price</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-2 py-2.5 font-bold tabular-nums">{r.code}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {r.image
                        ? <img src={r.image} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                        : <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-[13px] font-extrabold text-primary">{r.item.charAt(0).toUpperCase()}</span>}
                      <span className="min-w-0">
                        <span className="block max-w-[200px] truncate font-semibold">{r.item}</span>
                        {r.extra > 0 && <span className="block text-[11.5px] text-muted-foreground">+{r.extra} more</span>}
                      </span>
                    </div>
                  </td>
                  <td className="max-w-[160px] truncate px-2 py-2.5">{r.customer}</td>
                  <td className="px-2 py-2.5 text-right font-bold tabular-nums">{rs(r.total)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">{new Date(r.when).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="px-2 py-2.5"><span className={cn('inline-block rounded-full px-2.5 py-1 text-[11.5px] font-bold', PILL[r.status.tone])}>{r.status.label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function SystemCard() {
  const [snap, setSnap] = useState<{ online: boolean; pending: number; lastError?: string }>({ online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0 });
  const [prints, setPrints] = useState<number | null>(null);
  useEffect(() => onSyncStatus(setSnap), []);
  useEffect(() => {
    let off = false;
    const read = async () => { try { const q = await localDb.readPrintQueue(); if (!off) setPrints(q.length); } catch { if (!off) setPrints(null); } };
    read();
    const t = setInterval(read, 15000);
    return () => { off = true; clearInterval(t); };
  }, []);
  const rows: { label: string; value: string; tone: Tone; icon: typeof Cloud }[] = [
    { label: 'Connection', value: snap.online ? 'Online' : 'Offline — working locally', tone: snap.online ? 'success' : 'danger', icon: snap.online ? Cloud : CloudOff },
    { label: 'Cloud sync', value: snap.lastError ? 'Needs attention' : snap.pending > 0 ? `${snap.pending} change${snap.pending === 1 ? '' : 's'} waiting` : 'Everything saved', tone: snap.lastError ? 'danger' : snap.pending > 0 ? 'warning' : 'success', icon: RefreshCw },
    { label: 'Print queue', value: prints === null ? 'Not available' : prints > 0 ? `${prints} waiting` : 'Empty', tone: prints ? 'warning' : 'success', icon: Printer },
  ];
  return (
    <SectionCard title="System status" description={`DT POS v${APP_VERSION}`}>
      <ul className="space-y-3" data-testid="system-status">
        {rows.map(r => (
          <li key={r.label} className="flex items-center gap-3">
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', TONE_CLASS[r.tone])}><r.icon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-muted-foreground">{r.label}</span>
              <span className="block truncate text-[13.5px] font-bold">{r.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function LooksCard() {
  const navigate = useNavigate();
  const style = useUiStyle();
  const settings = getSettings();
  const themeName = style === 'modern' ? getTheme().name : 'DT Enterprise';
  const design = settings.receiptDesign || 'standard';
  const tpl = ALL_PREMIUM_TEMPLATES.find(t => t.id === design);
  const receiptName = tpl?.name || String(design).replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
  const rows = [
    { label: 'Interface', value: style === 'modern' ? `Modern · ${themeName}` : 'DT Enterprise (classic)', icon: Palette, to: '/settings?tab=theme' },
    { label: 'Receipt template', value: receiptName, icon: Receipt, to: '/settings?tab=receiptstyle' },
  ];
  return (
    <SectionCard title="Look and templates" description="What guests and staff see">
      <ul className="space-y-2" data-testid="looks-card">
        {rows.map(r => (
          <li key={r.label}>
            <button type="button" onClick={() => navigate(r.to)} className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
              <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px]', TONE_CLASS.accent)}><r.icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-muted-foreground">{r.label}</span>
                <span className="block truncate text-[13.5px] font-bold">{r.value}</span>
              </span>
              <span className="text-[12px] font-semibold text-primary">Change</span>
            </button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** The design package's "Needs attention" list (SW-02): only things the system can actually see. */
function NeedsAttention({ d }: { d: DashboardData }) {
  const navigate = useNavigate();
  const awaiting = d.orders.filter(o => o.status === 'pending_approval').length;
  const items: { key: string; text: string; tone: 'warning' | 'danger' | 'info'; to: string }[] = [];
  if (awaiting > 0) items.push({ key: 'approval', text: `${awaiting} online order${awaiting === 1 ? '' : 's'} await${awaiting === 1 ? 's' : ''} approval`, tone: 'warning', to: '/online-approval' });
  for (const l of d.lowStock.slice(0, 3)) items.push({ key: `low-${l.name}`, text: `${l.name} is at ${l.qty} (minimum ${l.min})`, tone: 'danger', to: '/inventory' });
  if (d.lowStock.length > 3) items.push({ key: 'low-more', text: `${d.lowStock.length - 3} more item${d.lowStock.length - 3 === 1 ? '' : 's'} below the minimum`, tone: 'danger', to: '/inventory' });
  if (d.outstandingCredit > 0) items.push({ key: 'credit', text: `${rs(d.outstandingCredit)} is owed on credit`, tone: 'info', to: '/credits' });
  const tone = { warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800', danger: 'border-[hsl(var(--status-danger)/0.3)] bg-[hsl(var(--status-danger)/0.08)] text-[hsl(var(--status-danger))]', info: 'border-[hsl(var(--status-info)/0.3)] bg-[hsl(var(--status-info)/0.08)] text-[hsl(var(--status-info))]' };
  return (
    <SectionCard title="Needs attention" description="Only what needs someone now">
      {items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--status-success)/0.3)] bg-[hsl(var(--status-success)/0.08)] px-3 py-3 text-[13px] font-semibold text-[hsl(var(--status-success))]" data-testid="attention-clear">
          <CheckCircle2 className="h-4 w-4" /> Nothing needs attention right now.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="attention-list">
          {items.map(i => (
            <li key={i.key}>
              <button type="button" onClick={() => navigate(i.to)} className={cn('flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold', tone[i.tone])}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{i.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function LiveStrip({ d }: { d: DashboardData }) {
  const navigate = useNavigate();
  const open = d.orders.filter(o => o.status === 'running' || o.status === 'hold').length;
  const items: { label: string; value: string; icon: typeof Utensils; tone: Tone; to: string }[] = [
    { label: 'Open bills', value: String(open), icon: Utensils, tone: open ? 'info' : 'neutral', to: '/running-bills' },
    { label: 'On delivery', value: String(d.ridersStats.onDelivery), icon: Bike, tone: d.ridersStats.onDelivery ? 'info' : 'neutral', to: '/delivery' },
    { label: 'Low stock', value: String(d.lowStock.length), icon: Package, tone: d.lowStock.length ? 'danger' : 'success', to: '/inventory' },
    { label: 'Credit owed', value: rs(Math.max(0, d.outstandingCredit)), icon: CreditCard, tone: d.outstandingCredit > 0 ? 'warning' : 'neutral', to: '/credits' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="live-strip">
      {items.map(i => (
        <button key={i.label} type="button" onClick={() => navigate(i.to)} className="flex items-center gap-3 rounded-[var(--ui-radius-card,1rem)] border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:border-primary/40">
          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', TONE_CLASS[i.tone])}><i.icon className="h-[18px] w-[18px]" /></span>
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-muted-foreground">{i.label}</span>
            <span className="block truncate text-[17px] font-extrabold leading-tight tabular-nums">{i.value}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function OverviewDashboard({ d, onSwitch }: { d: DashboardData; onSwitch: () => void }) {
  const { range, setRange, days, scope, cashiers, cashierFilter, setCashierFilter, orders } = d;
  const transactions = useMemo(() => { try { return getTransactions(); } catch { return []; } }, [d.orders]);
  const now = Date.now();
  const win = useMemo(() => periodWindows(days, now), [days, Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = useMemo(() => totalsIn(orders, transactions, win.cur), [orders, transactions, win]);
  const prev = useMemo(() => totalsIn(orders, transactions, win.prev), [orders, transactions, win]);
  const vs = days <= 1 ? 'yesterday' : `previous ${days} days`;
  const spark = (m: Metric) => sparkSeries(orders, transactions, win.cur, win.bucket, m);

  let name = '';
  let shop = '';
  try { name = getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || ''))?.name || ''; shop = getSettings().name || ''; } catch { /* store not ready */ }
  const h = new Date().getHours();
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const long = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 lg:p-6" data-testid="overview-dashboard">
      <PlanStatusWidget />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[24px] font-extrabold tracking-tight">Dashboard</h2>
          <p className="text-[13px] text-muted-foreground">{greeting}{name ? `, ${name}` : ''} · {long}{shop ? ` · ${shop}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!scope.restrict && (
            <label className="flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
              Cashier
              <select value={cashierFilter} onChange={e => setCashierFilter(e.target.value)} className="h-9 cursor-pointer rounded-[10px] border border-input bg-card px-3 text-[13px] font-semibold text-foreground outline-none focus:border-primary/60">
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
          <button type="button" onClick={d.refresh} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-card px-3 text-[13px] font-semibold hover:border-primary/40" aria-label="Refresh figures">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button type="button" onClick={onSwitch} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-card px-3 text-[13px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground" data-testid="switch-standard">
            <LayoutDashboard className="h-3.5 w-3.5" /> Standard view
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-7">
          <Kpi id="sales" label="Sales" value={rs(cur.sales)} icon={Banknote} tone="accent" pct={pctChange(cur.sales, prev.sales)} vs={vs} series={spark('sales')} />
          <Kpi id="orders" label="Orders" value={String(cur.orders)} icon={ShoppingBag} tone="info" pct={pctChange(cur.orders, prev.orders)} vs={vs} series={spark('orders')} />
          <Kpi id="avg" label="Average order" value={rs(cur.avg)} icon={TrendingUp} tone="success" pct={pctChange(cur.avg, prev.avg)} vs={vs} series={spark('avg')} />
          <Kpi id="profit" label="Profit" value={rs(cur.profit)} icon={Activity} tone="warning" pct={pctChange(cur.profit, prev.profit)} vs={vs} series={spark('profit')} />
        </div>
        <div className="xl:col-span-5"><ServiceArea orders={orders} days={days} /></div>

        <div className="xl:col-span-8"><OrderRate orders={orders} /></div>
        <div className="xl:col-span-4"><OrderTypes orders={orders} days={days} /></div>

        <div className="xl:col-span-12"><LiveStrip d={d} /></div>

        <div className="xl:col-span-8"><RecentOrders orders={orders} /></div>
        <div className="space-y-4 xl:col-span-4">
          <NeedsAttention d={d} />
          <SystemCard />
          <LooksCard />
        </div>
      </div>
    </div>
  );
}

