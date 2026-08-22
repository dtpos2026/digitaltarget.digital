import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Phone, MapPin, Wallet, Printer, History, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCreditOrders, getCreditPayments, getCreditOrderSummary,
  recordCreditPayment, getSettings, getUsers, deleteCreditPayment,
} from '@/lib/store';
import { Order, PaymentMethod } from '@/lib/types';
import ReceiptPreview from '@/components/ReceiptPreview';

type FilterT = 'all' | 'unpaid' | 'partial' | 'paid';

export default function CreditsPage() {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);

  const [filter, setFilter] = useState<FilterT>('all');
  const [search, setSearch] = useState('');
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payNote, setPayNote] = useState('');
  const [historyOrder, setHistoryOrder] = useState<Order | null>(null);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  const settings = getSettings();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const orders = useMemo(() => getCreditOrders(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payments = useMemo(() => getCreditPayments(), [tick]);

  const enriched = useMemo(() => {
    return orders.map(o => ({ order: o, sum: getCreditOrderSummary(o.id) }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (filter !== 'all') list = list.filter(x => x.sum.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(({ order }) =>
        (order.creditCustomerName || order.customer?.name || '').toLowerCase().includes(q) ||
        (order.creditCustomerPhone || order.customer?.phone || '').includes(q) ||
        order.orderNumber.toString().includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.order.createdAt).getTime() - new Date(a.order.createdAt).getTime());
  }, [enriched, filter, search]);

  const totals = useMemo(() => {
    let total = 0, paid = 0, balance = 0;
    enriched.forEach(({ sum }) => { total += sum.total; paid += sum.paid; balance += sum.balance; });
    return { total, paid, balance };
  }, [enriched]);

  const openReceive = (o: Order) => {
    const s = getCreditOrderSummary(o.id);
    setPayOrder(o);
    setPayAmount(String(s.balance));
    setPayMethod('cash');
    setPayNote('');
  };

  const confirmReceive = () => {
    if (!payOrder) return;
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { toast.error('Enter an amount'); return; }
    const s = getCreditOrderSummary(payOrder.id);
    if (amt > s.balance + 0.01) { toast.error(`Max receivable: PKR ${s.balance.toLocaleString()}`); return; }
    const currentUserId = localStorage.getItem('pos-user-id') || '';
    const userName = getUsers().find(u => u.id === currentUserId)?.name || '';
    recordCreditPayment(payOrder.id, amt, payMethod, payNote || undefined, userName);
    toast.success(`Payment received: PKR ${amt.toLocaleString()}`);
    setPayOrder(null);
    refresh();
  };

  const deletePayment = (id: string) => {
    if (!confirm('Delete this payment?')) return;
    deleteCreditPayment(id);
    refresh();
  };

  const statusColor = (s: 'unpaid' | 'partial' | 'paid') =>
    s === 'paid' ? 'bg-status-success/15 text-status-success border-status-success/30'
    : s === 'partial' ? 'bg-status-warning/15 text-status-warning border-status-warning/30'
    : 'bg-destructive/15 text-destructive border-destructive/30';

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Receipt className="h-6 w-6 text-primary" />
        <h2 className="text-lg font-bold">Credits / Udhaar</h2>
        <Badge variant="secondary" className="ml-auto">{enriched.length} customers</Badge>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card border rounded-xl p-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Credit</p>
          <p className="text-xl font-extrabold mt-1">PKR {totals.total.toLocaleString()}</p>
        </div>
        <div className="bg-status-success/10 border border-status-success/30 rounded-xl p-4">
          <p className="text-[10px] font-bold text-status-success uppercase tracking-wider">Recovered</p>
          <p className="text-xl font-extrabold mt-1 text-status-success">PKR {totals.paid.toLocaleString()}</p>
        </div>
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="text-[10px] font-bold text-destructive uppercase tracking-wider">Outstanding</p>
          <p className="text-xl font-extrabold mt-1 text-destructive">PKR {totals.balance.toLocaleString()}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'unpaid', 'partial', 'paid'] as FilterT[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-bold uppercase transition-smooth ${
              filter === f ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >{f}</button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Name, phone, order #"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-7 h-9 text-xs"
          />
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground bg-card border rounded-xl">
            <Receipt className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">No credit orders found</p>
            <p className="text-xs mt-1">Add new credit from the "Credit" button in the POS.</p>
          </div>
        )}
        {filtered.map(({ order, sum }) => {
          const name = order.creditCustomerName || order.customer?.name || 'Walk-in';
          const phone = order.creditCustomerPhone || order.customer?.phone || '';
          const addr = order.creditCustomerAddress || order.customer?.address || '';
          const date = new Date(order.createdAt).toLocaleString();
          return (
            <div key={order.id} className="bg-card border rounded-xl p-3 hover:shadow-md transition-smooth">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold">#{order.orderNumber}</span>
                    <span className="text-sm font-bold">{name}</span>
                    <Badge variant="outline" className={`text-[10px] font-bold uppercase ${statusColor(sum.status)}`}>
                      {sum.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                    {phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {phone}</span>}
                    {addr && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {addr}</span>}
                    <span>📅 {date}</span>
                    <span>🍽 {order.items.length} items</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground font-bold uppercase">Total</div>
                  <div className="text-sm font-extrabold">PKR {sum.total.toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-status-success font-bold uppercase">Paid</div>
                  <div className="text-sm font-extrabold text-status-success">PKR {sum.paid.toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-destructive font-bold uppercase">Balance</div>
                  <div className="text-base font-extrabold text-destructive">PKR {sum.balance.toLocaleString()}</div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    className="h-8 text-[11px] bg-status-success text-status-success-foreground hover:bg-status-success/90"
                    onClick={() => openReceive(order)}
                    disabled={sum.balance <= 0}
                  >
                    <Wallet className="h-3.5 w-3.5 mr-1" /> Receive
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => setHistoryOrder(order)}>
                    <History className="h-3.5 w-3.5 mr-1" /> History
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => setPrintOrder(order)}>
                    <Printer className="h-3.5 w-3.5 mr-1" /> Print
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Receive payment dialog */}
      <Dialog open={!!payOrder} onOpenChange={(o) => !o && setPayOrder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Receive Payment</DialogTitle></DialogHeader>
          {payOrder && (() => {
            const s = getCreditOrderSummary(payOrder.id);
            return (
              <div className="space-y-3">
                <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span>Order #</span><span className="font-bold">{payOrder.orderNumber}</span></div>
                  <div className="flex justify-between"><span>Customer</span><span className="font-bold">{payOrder.creditCustomerName || payOrder.customer?.name}</span></div>
                  <div className="flex justify-between"><span>Total</span><span className="font-bold">PKR {s.total.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Paid</span><span className="font-bold text-status-success">PKR {s.paid.toLocaleString()}</span></div>
                  <div className="flex justify-between border-t pt-1 mt-1"><span className="font-bold">Balance</span><span className="font-extrabold text-destructive">PKR {s.balance.toLocaleString()}</span></div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Amount Received (PKR)</label>
                  <Input
                    type="number"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    autoFocus
                  />
                  <div className="flex gap-1.5 mt-1.5">
                    {[s.balance, s.balance / 2, 1000, 500].filter((n, i, a) => n > 0 && a.indexOf(n) === i).map(n => (
                      <button key={n} onClick={() => setPayAmount(String(Math.round(n)))}
                        className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-accent font-bold">
                        {Math.round(n).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Method</label>
                  <Select value={payMethod} onValueChange={v => setPayMethod(v as PaymentMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Note (optional)</label>
                  <Input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="e.g. partial cash" />
                </div>
                <Button className="w-full" onClick={confirmReceive}>
                  Confirm Receive
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={!!historyOrder} onOpenChange={(o) => !o && setHistoryOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Payment History — #{historyOrder?.orderNumber}</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {historyOrder && payments.filter(p => p.orderId === historyOrder.id).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No payments yet</p>
            )}
            {historyOrder && payments.filter(p => p.orderId === historyOrder.id)
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .map(p => (
              <div key={p.id} className="border rounded-lg p-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-extrabold text-status-success">PKR {p.amount.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(p.date).toLocaleString()} • {p.method}
                    {p.receivedBy && ` • by ${p.receivedBy}`}
                  </div>
                  {p.note && <div className="text-[10px] italic mt-0.5">📝 {p.note}</div>}
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-[10px] text-destructive" onClick={() => deletePayment(p.id)}>
                  Delete
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Print credit parchi (uses existing receipt preview) */}
      <Dialog open={!!printOrder} onOpenChange={(o) => !o && setPrintOrder(null)}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader className="p-4 pb-0"><DialogTitle>Credit Parchi</DialogTitle></DialogHeader>
          {printOrder && (
            <div className="p-4">
              <ReceiptPreview order={printOrder} settings={settings} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
