import { useState } from 'react';
import { money } from '@/lib/currency';
import { getOrders, saveOrder, getSettings } from '@/lib/store';
import { Order } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Printer, Eye, CreditCard, Ban, XCircle, RotateCcw, ChefHat, Globe } from 'lucide-react';
import ReceiptPreview from '@/components/ReceiptPreview';
import KitchenReceipt from '@/components/KitchenReceipt';
import ReasonDialog from '@/components/ReasonDialog';
import { enqueueKot, enqueueReceipt } from '@/lib/printQueue';
import { toast } from 'sonner';
import { useNavigate } from '@/lib/hash-router';
import ReceivePaymentButton from '@/components/ReceivePaymentButton';
import { balanceDue } from '@/lib/sales';

type ReasonAction = { type: 'void' | 'cancelled'; order: Order } | null;

export default function RetrayPage() {
  const settings = getSettings();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'dining' | 'delivery' | 'takeaway'>('all');
  const [orders, setOrders] = useState(() =>
    getOrders().filter(o => o.status === 'running' || o.status === 'hold' || o.status === 'credit_pending' || o.status === 'partial' || o.status === 'pending_approval')
  );
  const [view, setView] = useState<Order | null>(null);
  const [kitchenView, setKitchenView] = useState<Order | null>(null);
  const [reasonFor, setReasonFor] = useState<ReasonAction>(null);

  const refresh = () =>
    setOrders(getOrders().filter(o => o.status === 'running' || o.status === 'hold' || o.status === 'credit_pending' || o.status === 'partial' || o.status === 'pending_approval'));

  const filtered = orders
    .filter(o => tab === 'all' || o.orderType === tab)
    .filter(o => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        o.orderNumber.toString().includes(q) ||
        (o.customer?.name || '').toLowerCase().includes(q) ||
        (o.customer?.phone || '').toLowerCase().includes(q) ||
        (o.tableName || '').toLowerCase().includes(q) ||
        (o.riderName || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const payNow = (o: Order) => {
    const now = new Date().toISOString();
    const paid = {
      ...o,
      status: 'paid' as const,
      paymentMethod: o.paymentMethod || 'cash',
      paidAt: now,
      // Integrated flow: paid bill must auto-clear from KDS
      kitchenStatus: 'served' as const,
      kitchenStatusAt: now,
    };
    saveOrder(paid);
    try { enqueueReceipt(paid, { force: true }); } catch {}
    toast.success(`Bill #${o.orderNumber} paid — receipt printing`);
    refresh();
  };

  const submitReason = (reason: string) => {
    if (!reasonFor) return;
    const { order, type } = reasonFor;
    const stamp = new Date().toISOString();
    const by = localStorage.getItem('pos-user-name') || 'admin';
    if (type === 'void') {
      saveOrder({ ...order, status: 'void', voidReason: reason, voidedAt: stamp, voidBy: by });
      toast.success(`Bill #${order.orderNumber} voided`);
    } else {
      saveOrder({ ...order, status: 'cancelled', cancelReason: reason, cancelledAt: stamp, cancelledBy: by });
      toast.success(`Bill #${order.orderNumber} cancelled`);
    }
    setReasonFor(null);
    refresh();
  };

  const statusColor = (s: string) =>
    s === 'running' ? 'bg-status-success/15 text-status-success border-status-success/30'
    : s === 'hold' ? 'bg-status-warning/15 text-status-warning border-status-warning/30'
    : 'bg-amber-500/15 text-amber-700 border-amber-500/30';

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-primary" /> Retray — Reprint / Pay / Cancel
        </h2>
        <Input
          placeholder="Search bill #, customer, table, rider…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="all">All ({orders.length})</TabsTrigger>
          <TabsTrigger value="dining">Dining</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="takeaway">Takeaway</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-3">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bills to retray</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(o => {
                const isUnpaid = (o.amountPaid || 0) <= 0 && o.status !== 'paid';
                return (
                <Card key={o.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">#{o.orderNumber}</span>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      {o.source === 'website' && (
                        <Badge className="text-[10px] bg-blue-500/15 text-blue-700 border-blue-500/30 border">
                          <Globe className="h-3 w-3 mr-1" /> Web Order
                        </Badge>
                      )}
                      {o.source === 'website' && !o.kotPrinted && (
                        <Badge className="text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/30 border">
                          KOT pending
                        </Badge>
                      )}
                      {isUnpaid && (
                        <Badge className="text-[10px] bg-destructive text-destructive-foreground border-destructive font-bold tracking-wide">UNPAID</Badge>
                      )}
                      <Badge className={`text-[10px] ${statusColor(o.status)}`}>{o.status}</Badge>
                      <Badge variant="secondary" className="capitalize text-xs">{o.orderType}</Badge>
                    </div>
                  </div>
                  {o.tableName && <p className="text-xs text-muted-foreground">Table: {o.tableName}</p>}
                  {o.customer?.name && <p className="text-xs text-muted-foreground">Customer: {o.customer.name}{o.customer.phone ? ` · ${o.customer.phone}` : ''}</p>}
                  {o.orderType === 'dining' && o.waiterName && <p className="text-xs text-muted-foreground">🧑‍🍳 Waiter: <span className="font-medium text-foreground">{o.waiterName}</span></p>}
                  {o.orderType === 'delivery' && o.riderName && <p className="text-xs text-muted-foreground">🛵 Rider: <span className="font-medium text-foreground">{o.riderName}</span></p>}
                  {o.orderType === 'delivery' && !o.riderName && <p className="text-xs text-amber-700">🛵 Rider: <span className="italic">Not assigned</span></p>}
                  <p className="text-xs text-muted-foreground">{o.items.length} items</p>
                  <p className="text-sm font-bold text-primary">PKR {o.grandTotal.toLocaleString()}</p>
                  {(o.status === 'partial' || (o.amountPaid && o.amountPaid > 0)) && (
                    <p className="text-[11px] font-bold text-amber-700">
                      Paid {money(Number(o.amountPaid || 0))} · Due {money(balanceDue(o))}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">{new Date(o.createdAt).toLocaleString('en-PK')}</p>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setView(o)}>
                      <Eye className="h-3 w-3 mr-1" /> View
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
                      enqueueReceipt(o, { force: true });
                      toast.success(`Receipt #${o.orderNumber} sent to the printer`);
                    }}>
                      <Printer className="h-3 w-3 mr-1" /> Reprint
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-8 text-xs ${!o.kotPrinted ? 'border-status-warning text-status-warning hover:bg-status-warning/10' : ''}`}
                      onClick={() => {
                        const job = enqueueKot(o, { force: true });
                        if (job) toast.success(`KOT #${o.orderNumber} sent to the kitchen`);
                        else toast.error('KOT not queued — check Printer Diagnostics → Print Log for the reason');
                        setTimeout(refresh, 500);
                      }}

                    >
                      <ChefHat className="h-3 w-3 mr-1" /> {o.kotPrinted ? 'Reprint KOT' : 'Send to Kitchen'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs border-status-info text-status-info hover:bg-status-info/10"
                      onClick={() => navigate('/?retrieve=' + o.id)}>
                      <RotateCcw className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    {balanceDue(o) > 0 && (o.status === 'partial' || (o.amountPaid || 0) > 0) && (
                      <ReceivePaymentButton order={o} onUpdated={refresh} />
                    )}
                    <Button size="sm" className="h-8 text-xs bg-status-success text-status-success-foreground hover:bg-status-success/90"
                      onClick={() => payNow(o)}>
                      <CreditCard className="h-3 w-3 mr-1" /> Pay
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs border-destructive text-destructive hover:bg-destructive/10"
                      onClick={() => setReasonFor({ type: 'cancelled', order: o })}>
                      <XCircle className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs border-destructive text-destructive hover:bg-destructive/10"
                      onClick={() => setReasonFor({ type: 'void', order: o })}>
                      <Ban className="h-3 w-3 mr-1" /> Void
                    </Button>
                  </div>
                </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!view} onOpenChange={() => setView(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Order #{view?.orderNumber}</DialogTitle></DialogHeader>
          {view && <ReceiptPreview order={view} settings={settings} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!kitchenView} onOpenChange={() => setKitchenView(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Kitchen Slip — #{kitchenView?.orderNumber}</DialogTitle></DialogHeader>
          {kitchenView && <KitchenReceipt order={kitchenView} settings={settings} autoPrint />}
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={!!reasonFor}
        onOpenChange={(v) => { if (!v) setReasonFor(null); }}
        title={reasonFor?.type === 'void' ? 'Void Bill — Reason Required' : 'Cancel Bill — Reason Required'}
        onConfirm={submitReason}
      />
    </div>
  );
}
