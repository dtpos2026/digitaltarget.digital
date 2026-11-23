import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Users, ShoppingBag, TrendingUp, Repeat } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { getCustomers, getOrders, getBranches, getPromoCodes, getSettings } from '@/lib/store';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageTitle } from '@/components/layout/PageFrame';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/hash-router';
import { useThemeId, useUiStyle } from '@/lib/uiStyle';
import { isRefinedTheme } from '@/lib/uiThemes';
import { addToPendingQueue, normalizePhone } from '@/lib/whatsapp';
import RefinedCrm, { type OfferMessage } from '@/components/crm/RefinedCrm';
import { atRiskList, birthdayCustomers, crmFigures, peopleIn, signupsByMonth, DAY_MS, WINDOW_DAYS } from '@/lib/crmBoard';

// ===== v1.57.0 — "customer tu CRM module click karein to atak jata hai" =====
//
// getCustomers() and getOrders() each return a FRESH array on every call —
// they hand back loadData().customers / .orders, a new object identity each
// time. They were called in the component body, so every render produced new
// arrays, and the useMemo below listed those arrays as its dependencies.
//
// A dependency whose identity changes on every render defeats the memo
// completely: the whole computation — sorting every customer by lifetime
// spend, reducing every paid order, bucketing the lot — ran again on each
// render, including on the branch dropdown opening and on every parent
// re-render. The memo looked like a cache and was never once a cache.
//
// On top of that this page's chunk carries recharts, so the first click pays
// for a large lazy import as well. That part is expected; the recompute was
// not, and it is what made the screen sit there.
//
// Read once, into state. The page is a report over a point in time, so a
// stable snapshot is also the more correct thing to render.
export default function CrmInsightsPage() {
  const refined = useUiStyle() === 'modern' && isRefinedTheme(useThemeId());
  const navigate = useNavigate();
  const [nowMs] = useState(() => Date.now());
  const [customers] = useState(() => getCustomers());
  const [branches] = useState(() => getBranches());
  const [branchId, setBranchId] = useState<string>('all');
  const [allOrders] = useState(() =>
    getOrders().filter(o => o.status === 'paid' || o.status === 'credit_received'));
  const orders = useMemo(
    () => (branchId === 'all' ? allOrders : allOrders.filter(o => o.branchId === branchId)),
    [allOrders, branchId],
  );

  const insights = useMemo(() => {
    const totalCustomers = customers.length;
    const totalOrders = orders.length;
    const totalGmv = orders.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const avgBasket = totalOrders ? totalGmv / totalOrders : 0;

    // Repeat customer %
    const repeat = customers.filter(c => c.totalOrders > 1).length;
    const repeatPct = totalCustomers ? (repeat / totalCustomers) * 100 : 0;

    // Order frequency buckets
    const buckets = { '1 Order': 0, '2-5 Orders': 0, '5-10 Orders': 0, '10+ Orders': 0 };
    customers.forEach(c => {
      if (c.totalOrders <= 1) buckets['1 Order']++;
      else if (c.totalOrders <= 5) buckets['2-5 Orders']++;
      else if (c.totalOrders <= 10) buckets['5-10 Orders']++;
      else buckets['10+ Orders']++;
    });
    const freqData = Object.entries(buckets).map(([name, value]) => ({ name, value }));

    // Signups by month (last 6 months)
    const monthMap: Record<string, number> = {};
    customers.forEach(c => {
      const m = (c.createdAt || '').slice(0, 7);
      if (m) monthMap[m] = (monthMap[m] || 0) + 1;
    });
    const signupData = Object.entries(monthMap).sort().slice(-6).map(([month, count]) => ({ month, count }));

    // Top 10 customers
    const top = [...customers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10);

    return { totalCustomers, totalOrders, totalGmv, avgBasket, repeatPct, freqData, signupData, top };
  }, [customers, orders]);

  // v1.151.0 — DT Refined: the design's "CRM insights" (SW-20): four cards, "Orders per customer" and "At risk — send an offer". Worked out from the paid bills of the
  // last 90 days (see lib/crmBoard.ts); the old totals, top customers and sign-ups are kept below; the branch picker is kept.
  const crm = useMemo(() => {
    if (!refined) return null;
    const people = peopleIn(orders, nowMs - WINDOW_DAYS * DAY_MS, nowMs + 1, nowMs);
    return { people, atRisk: atRiskList(people), figures: crmFigures(orders, customers, nowMs), birthdays: birthdayCustomers(customers, new Date(nowMs)), signups: signupsByMonth(customers) };
  }, [refined, orders, customers, nowMs]);
  if (refined && crm) {
    const queue = (msgs: OfferMessage[]) => {
      let n = 0;
      for (const m of msgs) { const phone = normalizePhone(m.phone) || m.phone.replace(/\D/g, ''); if (phone) { addToPendingQueue(phone, m.message, m.name); n += 1; } }
      toast.success(`${n} ${n === 1 ? 'message' : 'messages'} added to the WhatsApp queue`, { action: { label: 'Open WhatsApp', onClick: () => navigate('/whatsapp') } });
    };
    return (
      <RefinedCrm
        figures={crm.figures} people={crm.people} atRisk={crm.atRisk} birthdays={crm.birthdays} signups={crm.signups}
        totals={{ customers: insights.totalCustomers, orders: insights.totalOrders, sales: insights.totalGmv, avgBasket: insights.avgBasket }}
        top={insights.top} restaurant={getSettings().name || ''} promoCodes={getPromoCodes().filter(c => c.code && (c as any).isActive !== false).map(c => c.code)}
        branchPicker={branches.length > 0 ? (
          <select className="crm-branch" aria-label="Branch" value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="all">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : null}
        onQueue={queue}
        onChat={(phone, message) => navigate(`/whatsapp?phone=${encodeURIComponent(phone)}&message=${encodeURIComponent(message)}`)}
      />
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <PageTitle icon={Users} subtitle="Customer analytics, retention & order frequency">CRM Insights</PageTitle>
        </div>
        {branches.length > 0 && (
          <div className="min-w-[200px]">
            <label className="text-xs text-muted-foreground">Branch</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Total Customers</span><Users className="h-4 w-4 text-muted-foreground" /></div>
          <div className="text-2xl font-bold mt-1">{insights.totalCustomers}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Total Orders</span><ShoppingBag className="h-4 w-4 text-muted-foreground" /></div>
          <div className="text-2xl font-bold mt-1">{insights.totalOrders}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">GMV (Paid)</span><TrendingUp className="h-4 w-4 text-muted-foreground" /></div>
          <div className="text-2xl font-bold mt-1 text-primary">{money(insights.totalGmv)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Repeat %</span><Repeat className="h-4 w-4 text-muted-foreground" /></div>
          <div className="text-2xl font-bold mt-1">{insights.repeatPct.toFixed(1)}%</div>
          <div className="text-xs text-muted-foreground">Avg basket: {money(Math.round(insights.avgBasket))}</div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-2">Sign-ups by Month</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={insights.signupData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-2">Order Frequency</h3>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={insights.freqData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Top customers */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b"><h3 className="font-semibold">Top 10 Customers (by Spend)</h3></div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase">
            <tr><th className="text-left p-3">#</th><th className="text-left p-3">Name</th><th className="text-left p-3">Phone</th><th className="text-right p-3">Orders</th><th className="text-right p-3">Total Spent</th><th className="text-left p-3">Last Order</th></tr>
          </thead>
          <tbody>
            {insights.top.length === 0 && <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">No customers yet</td></tr>}
            {insights.top.map((c, i) => (
              <tr key={c.id} className="border-t">
                <td className="p-3">{i + 1}</td>
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3">{c.phone}</td>
                <td className="p-3 text-right">{c.totalOrders}</td>
                <td className="p-3 text-right font-bold text-primary">{money(c.totalSpent)}</td>
                <td className="p-3 text-xs">{c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
