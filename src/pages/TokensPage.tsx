// ============================================================
// v1.3.0 — TOKEN MANAGEMENT
// Dashboard + today's tokens + history, with reprint / complete /
// cancel actions gated by permissions. Prices are hidden entirely when
// the admin turns OFF "Include token revenue in reports".
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Ticket, Clock, CheckCircle2, XCircle, Printer, Search, TrendingUp, RefreshCw,
} from 'lucide-react';
import type { Order } from '@/lib/types';
import { getSettings, getCurrentUser } from '@/lib/store';
import { featureActive } from '@/lib/optionalModules';
import { userHasAccess } from '@/lib/permissions';
import {
  getTokenOrders, computeTokenStats, completeToken, cancelToken,
  markTokenReprinted, tokenRevenueVisible, isSameDay,
} from '@/lib/tokens';
import TokenSlip from '@/components/TokenSlip';

type Tab = 'today' | 'pending' | 'completed' | 'cancelled' | 'history';

export default function TokensPage() {
  const settings = useMemo(() => getSettings(), []);

  // v1.3.1 multi-tenant guard: even a direct URL must not open a module
  // this restaurant has not enabled. Sidebar hides it; this is the backstop.
  if (!featureActive(settings, 'tokenModuleEnabled')) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Ticket className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-semibold">The Token module is off</p>
        <p className="text-sm mt-1">
          Admin ise Settings → Printing me "Token Printing Module" se on kar sakta hai.
        </p>
      </div>
    );
  }
  return <TokensPageInner />;
}

function TokensPageInner() {
  const settings = useMemo(() => getSettings(), []);
  const user = useMemo(() => { try { return getCurrentUser(); } catch { return null; } }, []);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState<Tab>('today');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cashierFilter, setCashierFilter] = useState('');
  const [reprint, setReprint] = useState<Order | null>(null);

  const showMoney = tokenRevenueVisible(settings);
  const isAdmin = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const canReprint = isAdmin || userHasAccess(user as any, 'tokens');
  const canCancel = isAdmin;

  const refresh = () => setOrders(getTokenOrders());
  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('pos-data-change', onChange);
    return () => window.removeEventListener('pos-data-change', onChange);
  }, []);

  const stats = useMemo(() => computeTokenStats(orders), [orders]);

  const cashiers = useMemo(() => {
    const set = new Set<string>();
    orders.forEach(o => { if (o.cashierName) set.add(o.cashierName); });
    return Array.from(set).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    const today = new Date();
    let list = orders.slice().sort((a, b) => (b.tokenNumber || 0) - (a.tokenNumber || 0));

    if (tab === 'today') list = list.filter(o => isSameDay(o.createdAt, today));
    else if (tab === 'pending') list = list.filter(o => (o.tokenStatus || 'pending') === 'pending');
    else if (tab === 'completed') list = list.filter(o => o.tokenStatus === 'completed');
    else if (tab === 'cancelled') list = list.filter(o => o.tokenStatus === 'cancelled');

    if (dateFrom) list = list.filter(o => new Date(o.createdAt) >= new Date(`${dateFrom}T00:00:00`));
    if (dateTo) list = list.filter(o => new Date(o.createdAt) <= new Date(`${dateTo}T23:59:59`));
    if (cashierFilter) list = list.filter(o => o.cashierName === cashierFilter);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(o =>
        String(o.tokenLabel || '').toLowerCase().includes(q)
        || String(o.tokenNumber || '').includes(q)
        || String(o.orderNumber).includes(q)
        || (o.items || []).some(i => i.name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [orders, tab, search, dateFrom, dateTo, cashierFilter]);

  const doComplete = (o: Order) => {
    completeToken(o.id);
    refresh();
    toast.success(`Token ${o.tokenLabel} completed ✓`);
  };

  const doCancel = (o: Order) => {
    if (!canCancel) { toast.error('Only an Admin or Manager can cancel a token'); return; }
    const reason = window.prompt(`Reason for cancelling token ${o.tokenLabel}?`, '');
    if (reason === null) return;
    cancelToken(o.id, reason || 'Cancelled');
    refresh();
    toast.success(`Token ${o.tokenLabel} cancelled — the sale was voided too`);
  };

  const doReprint = (o: Order) => {
    if (!canReprint) { toast.error('Reprinting is not permitted'); return; }
    markTokenReprinted(o.id);
    setReprint(o);
    refresh();
  };

  const statusBadge = (o: Order) => {
    const st = o.tokenStatus || 'pending';
    if (st === 'completed') return <Badge className="bg-emerald-600 text-white">Completed</Badge>;
    if (st === 'cancelled') return <Badge variant="destructive">Cancelled</Badge>;
    return <Badge className="bg-amber-500 text-white">Pending</Badge>;
  };

  const StatCard = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) => (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold">
        {icon}{label}
      </div>
      <div className="text-2xl font-black mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-black flex items-center gap-2">
          <Ticket className="h-5 w-5" /> Token Management
        </h1>
        <Button size="sm" variant="outline" onClick={refresh}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* ===== Dashboard ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard icon={<Ticket className="h-3.5 w-3.5" />} label="Today's Tokens" value={stats.total} />
        <StatCard icon={<Clock className="h-3.5 w-3.5" />} label="Pending" value={stats.pending} />
        <StatCard icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Completed" value={stats.completed} />
        <StatCard icon={<XCircle className="h-3.5 w-3.5" />} label="Cancelled" value={stats.cancelled} />
        {showMoney
          ? <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="Revenue" value={`${money(stats.revenue)}`} />
          : <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="Quantity" value={stats.quantity} sub="Revenue reporting OFF" />}
        <StatCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Avg Time"
          value={stats.avgMinutes === null ? '—' : `${stats.avgMinutes}m`}
          sub={stats.topItem ? `Top: ${stats.topItem.name}` : undefined}
        />
      </div>

      {/* ===== Filters ===== */}
      <Card className="p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['today', 'pending', 'completed', 'cancelled', 'history'] as Tab[]).map(t => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? 'default' : 'outline'}
              onClick={() => setTab(t)}
              className="capitalize"
            >
              {t}
            </Button>
          ))}
        </div>
        <div className="grid sm:grid-cols-4 gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Token / item / bill no" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          <select
            className="border rounded-md px-2 text-sm bg-background"
            value={cashierFilter}
            onChange={e => setCashierFilter(e.target.value)}
          >
            <option value="">All cashiers</option>
            {cashiers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </Card>

      {/* ===== List ===== */}
      <Card className="p-0 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="p-2 text-left">Token</th>
              <th className="p-2 text-left">Item(s)</th>
              <th className="p-2 text-center">Qty</th>
              {showMoney && <th className="p-2 text-right">Amount</th>}
              <th className="p-2 text-left">Cashier</th>
              <th className="p-2 text-left">Time</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(o => {
              const qty = (o.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
              return (
                <tr key={o.id} className="border-t">
                  <td className="p-2 font-black text-base">{o.tokenLabel || o.tokenNumber}</td>
                  <td className="p-2">
                    {(o.items || []).map(i => i.name).join(', ')}
                    <span className="text-[11px] text-muted-foreground block">Bill #{o.orderNumber}</span>
                  </td>
                  <td className="p-2 text-center font-bold">{qty}</td>
                  {showMoney && <td className="p-2 text-right font-bold">{money((o.grandTotal || 0))}</td>}
                  <td className="p-2">{o.cashierName || '—'}</td>
                  <td className="p-2 text-xs">
                    {new Date(o.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </td>
                  <td className="p-2 text-center">{statusBadge(o)}</td>
                  <td className="p-2">
                    <div className="flex gap-1 justify-end">
                      {(o.tokenStatus || 'pending') === 'pending' && (
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => doComplete(o)}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => doReprint(o)} title="Reprint token">
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      {o.tokenStatus !== 'cancelled' && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => doCancel(o)} title="Cancel token">
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showMoney ? 8 : 7} className="p-8 text-center text-muted-foreground">
                  <Ticket className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No tokens found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!reprint} onOpenChange={v => { if (!v) setReprint(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Reprint Token</DialogTitle></DialogHeader>
          {reprint && <TokenSlip order={reprint} settings={settings} autoPrint />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
