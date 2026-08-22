import { useMemo, useState } from 'react';
import {
  getOrders, getInventory, getEmployees, getAttendance,
  getTransactions, getCustomers, getRiders, getCreditPayments,
} from '@/lib/store';
import { isPaidSale, isCreditOrder } from '@/lib/sales';
import {
  TrendingUp, ShoppingBag, Banknote, Sparkles, CreditCard,
  Wallet, Package, Users, Bike, Activity, Clock,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import PlanStatusWidget from '@/components/PlanStatusWidget';
import WorkspaceCodeCard from '@/components/WorkspaceCodeCard';
import { getCurrentScope, orderBelongsTo, listCashierUsers, getShiftStart, resetShift, filterCurrentShift } from '@/lib/cashierScope';
import { getCurrentBusinessDay, getBusinessDayOffset, isInBusinessDay } from '@/lib/businessDay';
import { toast } from 'sonner';



type Range = '1' | '7' | '30';

export default function DashboardPage() {
  const [range, setRange] = useState<Range>('7');
  const days = parseInt(range, 10);

  const scope = useMemo(() => getCurrentScope(), []);
  const cashiers = useMemo(() => scope.restrict ? [] : listCashierUsers(), [scope.restrict]);
  // Admin-only: pick "All" or a specific cashier. Cashier is forced to themselves.
  const [cashierFilter, setCashierFilter] = useState<string>(scope.restrict ? scope.userId : 'all');
  const [shiftStart, setShiftStart] = useState<string>(() => getShiftStart());

  const allOrdersRaw = useMemo(() => getOrders(), []);
  const orders = useMemo(() => {
    if (cashierFilter === 'all') return allOrdersRaw;
    return allOrdersRaw.filter(o => orderBelongsTo(o, cashierFilter));
  }, [allOrdersRaw, cashierFilter]);

  const inventory = useMemo(() => getInventory(), []);
  const employees = useMemo(() => getEmployees(), []);
  const attendance = useMemo(() => getAttendance(), []);
  const transactions = useMemo(() => getTransactions(), []);
  const customers = useMemo(() => getCustomers(), []);
  const riders = useMemo(() => getRiders(), []);
  const creditPayments = useMemo(() => getCreditPayments(), []);


  // Online customer accounts (gender analytics)
  const onlineAccounts = useMemo(() => {
    try {
      const raw = localStorage.getItem('dt-online-accounts-v2');
      const reg = raw ? JSON.parse(raw) : {};
      return Object.values(reg) as Array<{ gender?: 'male' | 'female' }>;
    } catch { return []; }
  }, []);
  const genderSplit = useMemo(() => {
    let male = 0, female = 0, unknown = 0;
    for (const a of onlineAccounts) {
      if (a.gender === 'male') male++;
      else if (a.gender === 'female') female++;
      else unknown++;
    }
    const out = [
      { name: 'Male', value: male },
      { name: 'Female', value: female },
    ];
    if (unknown > 0) out.push({ name: 'Unknown', value: unknown });
    return out.filter(x => x.value > 0);
  }, [onlineAccounts]);

  // Date filter window
  const startDate = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  }, [days]);

  const inRange = (iso?: string) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= startDate.getTime();
  };

  const rangeOrders = orders.filter(o => inRange(o.paidAt || o.createdAt));
  const paidOrders = rangeOrders.filter(isPaidSale);
  const creditOrdersAll = orders.filter(isCreditOrder);

  // KPIs
  const totalSales = paidOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const orderCount = paidOrders.length;
  const avgOrder = orderCount ? Math.round(totalSales / orderCount) : 0;
  const cashIn = paidOrders.filter(o => o.paymentMethod === 'cash').reduce((s, o) => s + o.grandTotal, 0);
  const outstandingCredit = creditOrdersAll.reduce((s, o) => s + (o.grandTotal || 0), 0)
    - creditPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const expensesRange = transactions.filter(t => t.type === 'expense' && inRange(t.date)).reduce((s, t) => s + t.amount, 0);
  const profit = totalSales - expensesRange;

  const kpis = [
    { label: 'Sales', value: `Rs ${totalSales.toLocaleString()}`, icon: Banknote, tone: 'gold' },
    { label: 'Orders', value: orderCount, icon: ShoppingBag, tone: 'primary' },
    { label: 'Avg Order', value: `Rs ${avgOrder.toLocaleString()}`, icon: TrendingUp, tone: 'primary' },
    { label: 'Profit', value: `Rs ${profit.toLocaleString()}`, icon: Activity, tone: 'gold' },
    { label: 'Credits', value: `Rs ${Math.max(0, outstandingCredit).toLocaleString()}`, icon: CreditCard, tone: 'primary' },
    { label: 'Cash', value: `Rs ${cashIn.toLocaleString()}`, icon: Wallet, tone: 'gold' },
  ];

  // Daily sales trend
  const dailyTrend = useMemo(() => {
    const arr: { date: string; sales: number; orders: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const dayOrders = paidOrders.filter(o => (o.paidAt || o.createdAt).startsWith(key));
      arr.push({
        date: d.toLocaleDateString('en-PK', days <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }),
        sales: dayOrders.reduce((s, o) => s + o.grandTotal, 0),
        orders: dayOrders.length,
      });
    }
    return arr;
  }, [paidOrders, days]);

  // Order type pie
  const typeBreakdown = useMemo(() => {
    const types = ['dining', 'takeaway', 'delivery'];
    return types.map(t => ({
      name: t.charAt(0).toUpperCase() + t.slice(1),
      value: paidOrders.filter(o => o.orderType === t).reduce((s, o) => s + o.grandTotal, 0),
    })).filter(t => t.value > 0);
  }, [paidOrders]);

  // Top items
  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; total: number }>();
    paidOrders.forEach(o => o.items.forEach(it => {
      const e = map.get(it.name) || { name: it.name, total: 0 };
      e.total += it.lineTotal;
      map.set(it.name, e);
    }));
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 7);
  }, [paidOrders]);

  // Kitchen status donut (live)
  const kitchenBreakdown = useMemo(() => {
    const running = orders.filter(o => o.status === 'running');
    const buckets = { pending: 0, preparing: 0, ready: 0 };
    running.forEach(o => {
      const k = (o.kitchenStatus || 'pending') as keyof typeof buckets;
      if (k in buckets) buckets[k]++;
    });
    return [
      { name: 'Pending', value: buckets.pending },
      { name: 'Preparing', value: buckets.preparing },
      { name: 'Ready', value: buckets.ready },
    ].filter(b => b.value > 0);
  }, [orders]);

  // Hourly sales (today only for clarity)
  const hourlySales = useMemo(() => {
    const todayKey = new Date().toISOString().split('T')[0];
    const todayPaid = paidOrders.filter(o => (o.paidAt || o.createdAt).startsWith(todayKey));
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}`, sales: 0 }));
    todayPaid.forEach(o => {
      const h = new Date(o.paidAt || o.createdAt).getHours();
      buckets[h].sales += o.grandTotal;
    });
    return buckets.filter((_, i) => i >= 8 && i <= 23); // working hours
  }, [paidOrders]);

  // Payment method split
  const paymentSplit = useMemo(() => {
    const map = new Map<string, number>();
    paidOrders.forEach(o => {
      const k = o.paymentMethod || 'cash';
      map.set(k, (map.get(k) || 0) + o.grandTotal);
    });
    return [...map.entries()].map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));
  }, [paidOrders]);

  // Low stock
  const lowStock = useMemo(() => {
    return inventory
      .filter(i => i.isActive && i.quantity <= (i.lowStockThreshold || 0))
      .sort((a, b) => (a.quantity / Math.max(1, a.lowStockThreshold)) - (b.quantity / Math.max(1, b.lowStockThreshold)))
      .slice(0, 6)
      .map(i => ({ name: i.name, qty: i.quantity, min: i.lowStockThreshold }));
  }, [inventory]);

  // HR attendance today
  const hrToday = useMemo(() => {
    const todayKey = new Date().toISOString().split('T')[0];
    const today = attendance.filter(a => a.date === todayKey);
    const present = today.filter(a => a.status === 'present').length;
    const halfDay = today.filter(a => a.status === 'half-day').length;
    const leave = today.filter(a => a.status === 'leave').length;
    const marked = today.length;
    const absent = Math.max(0, employees.filter(e => e.status === 'active').length - marked) + today.filter(a => a.status === 'absent').length;
    return [
      { name: 'Present', value: present },
      { name: 'Half-day', value: halfDay },
      { name: 'Leave', value: leave },
      { name: 'Absent', value: absent },
    ].filter(b => b.value > 0);
  }, [attendance, employees]);

  // Income vs expense bar
  const incomeExpense = useMemo(() => {
    const arr: { date: string; income: number; expense: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const dayTxns = transactions.filter(t => t.date?.startsWith(key));
      arr.push({
        date: d.toLocaleDateString('en-PK', days <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }),
        income: dayTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
        expense: dayTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
      });
    }
    return arr;
  }, [transactions, days]);

  // Top customers
  const topCustomers = useMemo(() => {
    return [...customers]
      .sort((a, b) => (b.totalSpent || 0) - (a.totalSpent || 0))
      .slice(0, 6)
      .map(c => ({ name: c.name || c.phone || '—', total: c.totalSpent || 0 }));
  }, [customers]);

  // Riders status mini
  const ridersStats = useMemo(() => {
    const active = riders.filter((r: any) => r.isActive !== false).length;
    const onDelivery = orders.filter(o => o.orderType === 'delivery' && o.status === 'running').length;
    return { total: riders.length, active, onDelivery };
  }, [riders, orders]);

  const PIE_COLORS = [
    'hsl(var(--primary))',
    'hsl(var(--gold))',
    'hsl(173, 70%, 42%)',
    'hsl(0, 70%, 55%)',
    'hsl(265, 70%, 55%)',
    'hsl(38, 90%, 50%)',
  ];

  return (
    <div className="p-3 lg:p-4 space-y-3">
      <PlanStatusWidget />
      <WorkspaceCodeCard />
      <div className="rounded-xl bg-gradient-primary px-4 py-3 text-primary-foreground shadow-elegant flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-gold/90 font-semibold">Executive Analytics</span>
          <span className="text-xs text-primary-foreground/80 hidden md:inline">· {new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-black/20 rounded-md p-0.5">
            {(['1', '7', '30'] as Range[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded ${range === r ? 'bg-gold text-primary' : 'text-primary-foreground/80'}`}
              >
                {r === '1' ? 'Today' : `${r}d`}
              </button>
            ))}
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-widest text-gold/80">Revenue</div>
            <div className="text-lg font-extrabold text-gold leading-none">Rs {totalSales.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* ===== v1.0.4 — Business Day strip ===== */}
      <BusinessDayStrip orders={paidOrders.length ? paidOrders : orders.filter(isPaidSale)} allOrders={orders.filter(isPaidSale)} />


      {/* Cashier scope bar — admin filter dropdown OR cashier "own data" badge + shift summary */}
      <div className="rounded-xl border-2 border-primary/20 bg-card p-3 flex flex-wrap items-center gap-3">
        {scope.restrict ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-primary font-bold">My Dashboard</span>
              <span className="text-sm font-extrabold">👤 {scope.name}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                Sirf aapka data — closing time pe hisaab clean
              </span>
            </div>
          </>
        ) : (
          <>
            <span className="text-[10px] uppercase tracking-widest text-gold font-bold">🛡️ Admin View</span>
            <label className="text-[11px] text-muted-foreground font-semibold">Cashier filter:</label>
            <select
              value={cashierFilter}
              onChange={e => setCashierFilter(e.target.value)}
              className="h-8 text-xs rounded-md border bg-background px-2 font-semibold cursor-pointer"
            >
              <option value="all">All Cashiers (Total)</option>
              {cashiers.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.role})</option>
              ))}
            </select>
            {cashierFilter !== 'all' && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/30">
                Sirf {cashiers.find(c => c.id === cashierFilter)?.name || 'cashier'} ka data
              </span>
            )}
          </>
        )}

        {/* Shift summary — only meaningful for cashier scope */}
        {scope.restrict && (() => {
          const myToday = filterCurrentShift(orders).filter(isPaidSale);
          const shiftSales = myToday.reduce((s, o) => s + o.grandTotal, 0);
          const shiftCash = myToday.filter(o => (o.paymentMethod || 'cash') === 'cash').reduce((s, o) => s + o.grandTotal, 0);
          return (
            <div className="ml-auto flex items-center gap-3 text-xs">
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Shift Start</div>
                <div className="font-bold">{new Date(shiftStart).toLocaleString('en-PK')}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Shift Orders</div>
                <div className="font-extrabold text-primary">{myToday.length}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Shift Sales</div>
                <div className="font-extrabold text-gold">Rs {shiftSales.toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Cash</div>
                <div className="font-extrabold text-status-success">Rs {shiftCash.toLocaleString()}</div>
              </div>
              <button
                onClick={() => {
                  if (!confirm('Reset the shift? Sales for the new shift will start from 0.')) return;
                  resetShift();
                  setShiftStart(getShiftStart());
                  toast.success('New shift started');
                }}
                className="text-[10px] font-bold px-2 py-1 rounded-md border border-primary/40 text-primary hover:bg-primary/10"
              >
                🔄 Start New Shift
              </button>
            </div>
          );
        })()}
      </div>



      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {kpis.map(k => (
          <div key={k.label} className="bg-card border rounded-lg p-2.5 shadow-card flex items-center gap-2">
            <div className={`h-9 w-9 rounded-md flex items-center justify-center shrink-0 ${k.tone === 'gold' ? 'bg-gold/15 text-gold' : 'bg-primary/10 text-primary'}`}>
              <k.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold tracking-tight truncate">{k.value}</p>
              <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Sales Trend" subtitle={`Last ${days} day${days > 1 ? 's' : ''}`}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`, 'Sales']} />
              <Line type="monotone" dataKey="sales" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Order Type Split">
          {typeBreakdown.length === 0 ? <EmptyMsg /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={typeBreakdown} cx="50%" cy="50%" outerRadius={75} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {typeBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Top Selling Items">
          {topItems.length === 0 ? <EmptyMsg /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topItems} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`, 'Sales']} />
                <Bar dataKey="total" fill="hsl(var(--gold))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Kitchen Status (Live)">
          {kitchenBreakdown.length === 0 ? <EmptyMsg msg="Kitchen idle" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={kitchenBreakdown} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}>
                  {kitchenBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Hourly Sales (Today)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlySales}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`, 'Sales']} />
              <Bar dataKey="sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Payment Methods">
          {paymentSplit.length === 0 ? <EmptyMsg /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={paymentSplit} cx="50%" cy="50%" outerRadius={75} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {paymentSplit.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Low Stock Alert" icon={Package}>
          {lowStock.length === 0 ? <EmptyMsg msg="All stocked ✓" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={lowStock} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="qty" fill="hsl(0, 70%, 55%)" radius={[0, 4, 4, 0]} name="In Stock" />
                <Bar dataKey="min" fill="hsl(var(--muted-foreground))" radius={[0, 4, 4, 0]} name="Min Level" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Staff Attendance (Today)" icon={Users}>
          {hrToday.length === 0 ? <EmptyMsg msg="No attendance marked" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={hrToday} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}>
                  {hrToday.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Income vs Expense">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={incomeExpense}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="income" fill="hsl(var(--gold))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="hsl(0, 70%, 55%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top Customers" icon={Users}>
          {topCustomers.length === 0 ? <EmptyMsg /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topCustomers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [`Rs ${v.toLocaleString()}`]} />
                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Delivery / Riders" icon={Bike}>
          <div className="grid grid-cols-3 gap-2 h-[200px] items-center">
            <StatTile label="Riders" value={ridersStats.total} tone="primary" />
            <StatTile label="Active" value={ridersStats.active} tone="gold" />
            <StatTile label="On Delivery" value={ridersStats.onDelivery} tone="primary" />
          </div>
        </ChartCard>

        <ChartCard title="Credits Outstanding" icon={CreditCard}>
          <div className="grid grid-cols-2 gap-2 h-[200px] items-center">
            <StatTile label="Pending Bills" value={creditOrdersAll.length} tone="primary" />
            <StatTile label="Balance Rs" value={Math.max(0, outstandingCredit).toLocaleString()} tone="gold" />
          </div>
        </ChartCard>

        <ChartCard title="Customer Gender (Online)" icon={Users}>
          {genderSplit.length === 0 ? <EmptyMsg msg="No online accounts yet" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={genderSplit} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}>
                  {genderSplit.map((entry, i) => (
                    <Cell key={i} fill={
                      entry.name === 'Male' ? 'hsl(217, 70%, 55%)' :
                      entry.name === 'Female' ? 'hsl(330, 75%, 60%)' :
                      'hsl(var(--muted-foreground))'
                    } />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, icon: Icon, children }: { title: string; subtitle?: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="bg-card border rounded-xl shadow-card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
          <h3 className="text-xs font-bold uppercase tracking-wider">{title}</h3>
        </div>
        {subtitle && <span className="text-[9px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyMsg({ msg = 'No data yet' }: { msg?: string }) {
  return <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">{msg}</div>;
}

function StatTile({ label, value, tone }: { label: string; value: any; tone: 'gold' | 'primary' }) {
  return (
    <div className={`rounded-lg p-3 text-center ${tone === 'gold' ? 'bg-gold/10 text-gold' : 'bg-primary/10 text-primary'}`}>
      <div className="text-2xl font-extrabold tracking-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

// ===== v1.0.4 — Business Day Strip =====
// All four widgets respect the Restaurant's Business Day Timing engine (NOT calendar date).
function BusinessDayStrip({ orders, allOrders }: { orders: any[]; allOrders: any[] }) {
  const today = getCurrentBusinessDay();
  const yesterday = getBusinessDayOffset(1);
  const todaySum = allOrders.filter(o => isInBusinessDay(o.paidAt || o.createdAt, today)).reduce((s, o) => s + (o.grandTotal || 0), 0);
  const yesterdaySum = allOrders.filter(o => isInBusinessDay(o.paidAt || o.createdAt, yesterday)).reduce((s, o) => s + (o.grandTotal || 0), 0);
  const shift = filterCurrentShift(allOrders).reduce((s, o) => s + (o.grandTotal || 0), 0);
  const fmt = (d: Date) => d.toLocaleString('en-PK', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const tile = (label: string, value: string, sub: string, tone: 'gold' | 'primary' | 'green' = 'primary') => (
    <div className={`rounded-xl border bg-card p-3 ${tone === 'gold' ? 'border-gold/30' : tone === 'green' ? 'border-green-500/30' : 'border-primary/20'}`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-extrabold ${tone === 'gold' ? 'text-gold' : tone === 'green' ? 'text-green-600' : 'text-primary'}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
  return (
    <div className="rounded-xl border-2 border-gold/30 bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Clock className="h-4 w-4 text-gold" />
        <span className="font-extrabold uppercase tracking-wider text-gold">Business Day Engine</span>
        <span className="text-muted-foreground hidden md:inline">· Window: {fmt(today.start)} → {fmt(today.end)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {tile("Today's Sale", `Rs ${todaySum.toLocaleString()}`, today.label, 'gold')}
        {tile("Yesterday's Sale", `Rs ${yesterdaySum.toLocaleString()}`, yesterday.label, 'primary')}
        {tile('Current Shift', `Rs ${shift.toLocaleString()}`, 'Since shift start', 'green')}
        {tile('Business Day', today.label, `${fmt(today.start)} → ${fmt(today.end)}`, 'primary')}
      </div>
    </div>
  );
}
