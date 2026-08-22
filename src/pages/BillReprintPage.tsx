import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getOrders, getSettings, onDataChange, refreshOrdersFromCloud, correctOrderPayment, getCurrentUser, getPaymentAccounts } from '@/lib/store';
import { Order } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Printer, Eye, Lock, History, Receipt, Search } from 'lucide-react';
import ReceiptPreview from '@/components/ReceiptPreview';
import { enqueueReceipt } from '@/lib/printQueue';
import { toast } from 'sonner';
import { logReprint, getReprintLog, fetchCloudReprintLog, ReprintAuditEntry } from '@/lib/reprintAudit';
import ManagerAuthDialog from '@/components/ManagerAuthDialog';
import { CreditCard } from 'lucide-react';

type Filter = 'all' | 'paid' | 'partial' | 'running' | 'void' | 'cancelled' | 'foodpanda';

export default function BillReprintPage() {
  const settings = getSettings();
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<Order | null>(null);
  const [log, setLog] = useState<ReprintAuditEntry[]>(() => getReprintLog());
  // v1.6.0 — payment correction (feedback #2 item 5)
  const [correctTarget, setCorrectTarget] = useState<Order | null>(null);
  const [correctAuth, setCorrectAuth] = useState(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    refreshOrdersFromCloud().then(() => setOrders(getOrders())).catch(() => {});
    const off = onDataChange((col) => { if (col === 'orders' || col === '*') setOrders(getOrders()); });
    fetchCloudReprintLog().then(cloud => {
      const local = getReprintLog();
      const map = new Map<string, ReprintAuditEntry>();
      [...cloud, ...local].forEach(e => map.set(e.id, e));
      setLog(Array.from(map.values()).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()));
    });
    return () => off();
  }, []);

  const filtered = useMemo(() => {
    let arr = [...orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (filter === 'foodpanda') arr = arr.filter(o => o.orderType === 'foodpanda');
    else if (filter !== 'all') arr = arr.filter(o => o.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      arr = arr.filter(o =>
        o.orderNumber.toString().includes(q) ||
        (o.customer?.name || '').toLowerCase().includes(q) ||
        (o.customer?.phone || '').toLowerCase().includes(q) ||
        (o.tableName || '').toLowerCase().includes(q),
      );
    }
    return arr.slice(0, 500);
  }, [orders, search, filter]);

  const reprint = (o: Order) => {
    try {
      enqueueReceipt(o, { force: true });
      const entry = logReprint({ orderId: o.id, billNumber: o.orderNumber, orderStatus: o.status, type: 'receipt' });
      setLog(prev => [entry, ...prev]);
      toast.success(`Bill #${o.orderNumber} — customer receipt sent to the printer`);
    } catch {
      toast.error('Print failed');
    }
  };

  const statusColor = (s: string) => {
    if (s === 'paid') return 'bg-status-success/15 text-status-success border-status-success/30';
    if (s === 'running') return 'bg-blue-500/15 text-blue-700 border-blue-500/30';
    if (s === 'partial') return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
    if (s === 'void' || s === 'cancelled') return 'bg-destructive/15 text-destructive border-destructive/30';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-md">
          <Receipt className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight">Bill Reprint</h1>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Lock className="h-3 w-3" /> Read-only. Cashier purana bill <b>edit nahi</b> kar sakta — sirf reprint.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowLog(true)}>
          <History className="h-3.5 w-3.5 mr-1" /> Reprint History ({log.length})
        </Button>
      </div>

      <Card className="p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Bill #, customer, phone, table…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">All ({orders.length})</TabsTrigger>
            <TabsTrigger value="paid">Paid</TabsTrigger>
            <TabsTrigger value="partial">Partial</TabsTrigger>
            <TabsTrigger value="running">Running</TabsTrigger>
            <TabsTrigger value="foodpanda">Foodpanda</TabsTrigger>
            <TabsTrigger value="void">Void</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          </TabsList>
        </Tabs>
      </Card>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No bills mile is filter par.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(o => (
            <Card key={o.id} className="p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm">#{o.orderNumber}</span>
                <div className="flex gap-1 flex-wrap">
                  <Badge className={`text-[10px] ${statusColor(o.status)}`}>{o.status}</Badge>
                  <Badge variant="secondary" className="capitalize text-[10px]">{o.orderType}</Badge>
                </div>
              </div>
              {o.customer?.name && <p className="text-[11px] text-muted-foreground truncate">{o.customer.name}{o.customer.phone ? ` · ${o.customer.phone}` : ''}</p>}
              {o.tableName && <p className="text-[11px] text-muted-foreground">Table: {o.tableName}</p>}
              <p className="text-xs">{(o.items || []).length} items · <b className="text-primary">{money(o.grandTotal)}</b></p>
              <p className="text-[10px] text-muted-foreground">{new Date(o.createdAt).toLocaleString('en-PK')}</p>
              <div className="flex gap-1.5 pt-1">
                <Button size="sm" variant="outline" className="flex-1 h-7 text-[11px]" onClick={() => setView(o)}>
                  <Eye className="h-3 w-3 mr-1" /> View
                </Button>
                <Button size="sm" className="flex-1 h-7 text-[11px]" onClick={() => reprint(o)}>
                  <Printer className="h-3 w-3 mr-1" /> Reprint
                </Button>
                {['paid', 'partial', 'credit_received'].includes(o.status) && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]"
                    title="Correct the payment method (cash ↔ card)"
                    onClick={() => { setCorrectTarget(o); setCorrectAuth(false); }}>
                    <CreditCard className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* v1.6.0 — Payment correction: pehle manager auth, phir method select.
          Paisa nahi badalta — sirf method/account; audit trail order par
          hamesha rehta hai. */}
      {correctTarget && !correctAuth && (
        <ManagerAuthDialog
          open={!!correctTarget}
          reason={`Bill #${correctTarget.orderNumber} ki payment correction`}
          onAuthorized={() => setCorrectAuth(true)}
          onCancel={() => setCorrectTarget(null)}
        />
      )}
      {correctTarget && correctAuth && (
        <Dialog open onOpenChange={() => setCorrectTarget(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> Payment Correction — #{correctTarget.orderNumber}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Abhi: <b className="uppercase">{correctTarget.paymentAccountName || correctTarget.paymentMethod || 'cash'}</b>
                {' '}· Rs.{correctTarget.grandTotal?.toLocaleString()} — amount nahi badlegi, sirf method.
              </p>
              <div className="grid gap-1.5">
                {(() => {
                  const accounts = getPaymentAccounts().filter((a: any) => !a.disabled);
                  const options: { label: string; method: string; accountId?: string; accountName?: string }[] = [
                    { label: '💵 CASH', method: 'cash' },
                    ...accounts.filter((a: any) => a.type !== 'cash').map((a: any) => ({
                      label: `💳 ${a.name}`, method: 'online', accountId: a.id, accountName: a.name,
                    })),
                    { label: '🏦 CARD (generic)', method: 'card' },
                  ];
                  return options.map(op => (
                    <Button
                      key={op.label}
                      variant="outline"
                      className="justify-start h-9 text-sm"
                      onClick={() => {
                        const user = getCurrentUser();
                        const r = correctOrderPayment(correctTarget.id,
                          { method: op.method, accountId: op.accountId, accountName: op.accountName },
                          user?.name || user?.username || 'manager');
                        if (r.ok) {
                          toast.success(`#${correctTarget.orderNumber} is now recorded against ${op.accountName || op.method.toUpperCase()}`);
                          setOrders(getOrders());
                        } else toast.error(r.error || 'Correction fail');
                        setCorrectTarget(null);
                      }}
                    >
                      {op.label}
                    </Button>
                  ));
                })()}
              </div>
              {(correctTarget.paymentCorrections?.length || 0) > 0 && (
                <div className="text-[10px] text-muted-foreground border-t pt-1.5">
                  Pichli corrections: {correctTarget.paymentCorrections!.map(c =>
                    `${c.fromMethod || '—'}→${c.toAccountName || c.toMethod} (${c.by})`).join(' · ')}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!view} onOpenChange={() => setView(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Bill #{view?.orderNumber}
              <Badge variant="outline" className="text-[10px]"><Lock className="h-3 w-3 mr-1" /> Read-only</Badge>
            </DialogTitle>
          </DialogHeader>
          {view && <ReceiptPreview order={view} settings={settings} />}
          {view && (
            <div className="flex gap-2 pt-2 border-t">
              <Button size="sm" className="flex-1" onClick={() => { reprint(view); }}>
                <Printer className="h-4 w-4 mr-1" /> Reprint Customer Receipt
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showLog} onOpenChange={setShowLog}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reprint Audit History</DialogTitle>
          </DialogHeader>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No reprints yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-2">Date / Time</th>
                  <th className="p-2">Bill #</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Reprinted By</th>
                  <th className="p-2">Type</th>
                </tr>
              </thead>
              <tbody>
                {log.map(e => (
                  <tr key={e.id} className="border-t">
                    <td className="p-2">{new Date(e.at).toLocaleString('en-PK')}</td>
                    <td className="p-2 font-bold">#{e.billNumber}</td>
                    <td className="p-2"><Badge className={`text-[10px] ${statusColor(e.orderStatus)}`}>{e.orderStatus}</Badge></td>
                    <td className="p-2">{e.reprintedBy}{e.reprintedByRole ? ` (${e.reprintedByRole})` : ''}</td>
                    <td className="p-2 capitalize">{e.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
