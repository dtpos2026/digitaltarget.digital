import { useState, useEffect } from 'react';
import { money } from '@/lib/currency';
import { getOrders, getSettings, refreshOrdersFromCloud, onDataChange } from '@/lib/store';
import { Order } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Wallet, Eye, Printer } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReceiptPreview from '@/components/ReceiptPreview';
import ReceivePaymentButton from '@/components/ReceivePaymentButton';
import { balanceDue, isPartialSale } from '@/lib/sales';
import { enqueueReceipt } from '@/lib/printQueue';
import { toast } from 'sonner';

export default function PendingPaymentsPage() {
  const settings = getSettings();
  const [search, setSearch] = useState('');
  const [view, setView] = useState<Order | null>(null);
  const [orders, setOrders] = useState<Order[]>(() => loadPending());

  function loadPending(): Order[] {
    return getOrders().filter(o => isPartialSale(o));
  }
  const refresh = () => setOrders(loadPending());

  useEffect(() => {
    let cancel = false;
    const pull = async () => {
      try { await refreshOrdersFromCloud(); } catch {}
      if (!cancel) refresh();
    };
    pull();
    const t = setInterval(pull, 10000);
    const unsub = onDataChange((col) => { if (!cancel && col === 'orders') refresh(); });
    return () => { cancel = true; clearInterval(t); unsub(); };
  }, []);

  const filtered = orders.filter(o => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.orderNumber.toString().includes(q) ||
      (o.customer?.name || '').toLowerCase().includes(q) ||
      (o.customer?.phone || '').toLowerCase().includes(q) ||
      (o.tableName || '').toLowerCase().includes(q)
    );
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalDue = filtered.reduce((s, o) => s + balanceDue(o), 0);
  const totalPaid = filtered.reduce((s, o) => s + Number(o.amountPaid || 0), 0);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Wallet className="h-5 w-5 text-amber-600" /> Pending Payments — Partial Bills
        </h2>
        <Input
          placeholder="Search bill #, customer, table…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-[10px] uppercase text-muted-foreground">Pending Bills</p>
          <p className="text-2xl font-extrabold">{filtered.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase text-muted-foreground">Total Received</p>
          <p className="text-2xl font-extrabold text-status-success">{money(totalPaid)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[10px] uppercase text-muted-foreground">Total Due</p>
          <p className="text-2xl font-extrabold text-amber-600">{money(totalDue)}</p>
        </Card>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bills are partially pending.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(o => (
            <Card key={o.id} className="p-4 space-y-2 border-amber-200 bg-amber-50/40">
              <div className="flex items-center justify-between">
                <span className="font-bold">#{o.orderNumber}</span>
                <Badge className="text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/30 border">partial</Badge>
              </div>
              {o.customer?.name && <p className="text-xs text-muted-foreground">Customer: {o.customer.name}{o.customer.phone ? ` · ${o.customer.phone}` : ''}</p>}
              {o.tableName && <p className="text-xs text-muted-foreground">Table: {o.tableName}</p>}
              <div className="text-xs space-y-0.5">
                <div className="flex justify-between"><span>Total:</span><span className="font-bold">{money(o.grandTotal)}</span></div>
                <div className="flex justify-between text-status-success"><span>Paid:</span><span className="font-bold">{money(Number(o.amountPaid || 0))}</span></div>
                <div className="flex justify-between text-amber-700 text-sm"><span>Due:</span><span className="font-extrabold">{money(balanceDue(o))}</span></div>
              </div>
              {!!o.payments?.length && (
                <div className="text-[10px] bg-muted/50 rounded p-1.5 space-y-0.5">
                  {o.payments.map(p => (
                    <div key={p.id} className="flex justify-between">
                      <span>{p.method === 'cash' ? '💵 Cash' : `🏦 ${p.accountName || 'Online'}`}</span>
                      <span className="font-bold">{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">{new Date(o.createdAt).toLocaleString('en-PK')}</p>
              <div className="flex gap-1.5 flex-wrap">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setView(o)}>
                  <Eye className="h-3 w-3 mr-1" /> View
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                  enqueueReceipt(o, { force: true });
                  toast.success(`Receipt #${o.orderNumber} sent`);
                }}>
                  <Printer className="h-3 w-3 mr-1" /> Reprint
                </Button>
                <ReceivePaymentButton order={o} onUpdated={refresh} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!view} onOpenChange={() => setView(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Order #{view?.orderNumber}</DialogTitle></DialogHeader>
          {view && <ReceiptPreview order={view} settings={settings} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
