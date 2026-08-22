import { useMemo } from 'react';
import { getOrders } from '@/lib/store';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { TrendingUp, ShoppingBag, DollarSign, Calendar } from 'lucide-react';

export default function AnalyticsPage() {
  const orders = useMemo(() => getOrders(), []);
  const paidOrders = orders.filter(o => o.status === 'paid');

  // Daily sales (last 7 days)
  const dailySales = useMemo(() => {
    const days: { date: string; sales: number; orders: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayOrders = paidOrders.filter(o => o.paidAt?.startsWith(dateStr) || o.createdAt.startsWith(dateStr));
      days.push({
        date: d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric' }),
        sales: dayOrders.reduce((s, o) => s + o.grandTotal, 0),
        orders: dayOrders.length,
      });
    }
    return days;
  }, [paidOrders]);

  // Top selling items
  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; total: number }>();
    paidOrders.forEach(o => o.items.forEach(item => {
      const e = map.get(item.name) || { name: item.name, qty: 0, total: 0 };
      e.qty += item.quantity;
      e.total += item.lineTotal;
      map.set(item.name, e);
    }));
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  }, [paidOrders]);

  // Order type breakdown
  const typeBreakdown = useMemo(() => {
    const types = ['dining', 'takeaway', 'delivery'];
    return types.map(t => ({
      name: t.charAt(0).toUpperCase() + t.slice(1),
      value: paidOrders.filter(o => o.orderType === t).reduce((s, o) => s + o.grandTotal, 0),
    })).filter(t => t.value > 0);
  }, [paidOrders]);

  const COLORS = ['hsl(210,79%,46%)', 'hsl(38,92%,50%)', 'hsl(173,80%,40%)'];

  const todayStr = new Date().toISOString().split('T')[0];
  const todaySales = paidOrders.filter(o => (o.paidAt || o.createdAt).startsWith(todayStr)).reduce((s, o) => s + o.grandTotal, 0);
  const totalSales = paidOrders.reduce((s, o) => s + o.grandTotal, 0);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <h2 className="text-lg font-bold">Sales Analytics</h2>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <DollarSign className="h-4 w-4" /> Today's Sales
          </div>
          <p className="text-xl font-extrabold text-primary">PKR {todaySales.toLocaleString()}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <TrendingUp className="h-4 w-4" /> Total Sales
          </div>
          <p className="text-xl font-extrabold text-foreground">PKR {totalSales.toLocaleString()}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ShoppingBag className="h-4 w-4" /> Total Orders
          </div>
          <p className="text-xl font-extrabold text-foreground">{paidOrders.length}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Calendar className="h-4 w-4" /> Avg Order
          </div>
          <p className="text-xl font-extrabold text-foreground">
            PKR {paidOrders.length > 0 ? Math.round(totalSales / paidOrders.length).toLocaleString() : '0'}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily Sales Bar Chart */}
        <div className="bg-card border rounded-xl p-4">
          <h3 className="text-sm font-bold mb-3">Last 7 Days Sales</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailySales}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,88%)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`PKR ${v.toLocaleString()}`, 'Sales']} />
              <Bar dataKey="sales" fill="hsl(345,80%,28%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Order Type Pie */}
        <div className="bg-card border rounded-xl p-4">
          <h3 className="text-sm font-bold mb-3">Sales by Type</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={typeBreakdown} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {typeBreakdown.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => [`PKR ${v.toLocaleString()}`]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top Items */}
        <div className="bg-card border rounded-xl p-4 lg:col-span-2">
          <h3 className="text-sm font-bold mb-3">Top Selling Items</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topItems} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,88%)" />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => [`PKR ${v.toLocaleString()}`, 'Sales']} />
              <Bar dataKey="total" fill="hsl(173,80%,40%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
