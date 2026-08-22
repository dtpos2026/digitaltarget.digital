import { useState, useEffect, lazy, Suspense } from 'react';
import { money } from '@/lib/currency';
import { getOrders, saveOrder, getTables, saveTable, getSettings, refreshOrdersFromCloud, onDataChange, genId } from '@/lib/store';
import { Order, PaymentEntry } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, Eye, Clock, RotateCcw, Ban, Gift, Pause, ChefHat, History } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReceiptPreview from '@/components/ReceiptPreview';
import OrderDetailDialog from '@/components/OrderDetailDialog';
import { enqueueKot, enqueueReceipt, enqueueKotUpdate, enqueueKotCancel, computeKotDiff } from '@/lib/printQueue';
import { toast } from 'sonner';
import { releasedTable } from '@/lib/tableRelease';
const PaymentDialog = lazy(() => import('@/components/PaymentDialog'));
import { useNavigate } from '@/lib/hash-router';
import ReceivePaymentButton from '@/components/ReceivePaymentButton';
import { balanceDue } from '@/lib/sales';
import { scopeOrders, getCurrentScope } from '@/lib/cashierScope';

export default function RunningBillsPage() {
  const scope = getCurrentScope();
  const loadOpen = () => scopeOrders(getOrders()).filter(o => o.status === 'running' || o.status === 'hold' || o.status === 'partial' || o.status === 'pending_approval' || o.status === 'credit_pending');
  const [orders, setOrders] = useState(loadOpen);
  const [payOrderTarget, setPayOrderTarget] = useState<Order | null>(null);
  const settings = getSettings();
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [historyOrder, setHistoryOrder] = useState<Order | null>(null);
  const navigate = useNavigate();
  const isOrderTaker = scope.role === 'order_taker';



  const refresh = () => setOrders(loadOpen());

  // Live cross-device sync: cloud pull every 10s + onDataChange listener.
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

  const reprintKot = (order: Order) => {
    // If prior KOT was printed AND there are item changes, send an UPDATE slip
    // (annotated NEW / EXTRA / CANCELLED / ALREADY SENT). Otherwise plain reprint.
    try {
      if (order.kotPrinted) {
        const diff = computeKotDiff(order);
        if (diff.hasDiff) {
          enqueueKotUpdate(order);
          toast.success(`KOT update sent — ${diff.diffItemIds.length} new/extra items to the kitchen`);
          return;
        }
      }
    } catch {}
    enqueueKot(order, { force: true });
    toast.success(`KOT #${order.orderNumber} sent to the kitchen`);
  };

  // ===== v1.3.3 FIX — Pay ab payment screen kholta hai =====
  // Pehle Pay seedha bill ko 'paid' kar deta tha: na payment method poochta
  // tha, na cash received/change. Cashier ko majbooran pehle "Edit" dabana
  // parta tha taake POS se payment screen mile. Ab Pay hi payment screen
  // kholta hai aur uske confirm par bill settle hota hai.
  const payOrder = (order: Order) => {
    if (isOrderTaker) { toast.error('An Order Taker cannot settle a bill — ask a Cashier or Manager'); return; }
    setPayOrderTarget(order);
  };

  const settleOrder = (order: Order, r: any) => {
    const now = new Date().toISOString();
    const total = Number(order.grandTotal || 0);
    const by = localStorage.getItem('pos-user-name') || 'cashier';
    const newPayments: PaymentEntry[] = (r?.payments || []).map((p: any) => ({ ...p, id: genId(), at: now, by }));
    const merged: PaymentEntry[] = [...(order.payments || []), ...newPayments];
    const newPaid = merged.reduce((sum, p) => sum + (p.amount || 0), 0);
    const fully = newPaid >= total - 0.5;

    const updated = {
      ...order,
      payments: merged,
      amountPaid: Math.min(newPaid, total),
      status: fully ? ('paid' as const) : ('partial' as const),
      paymentMethod: r?.method || order.paymentMethod,
      paymentAccountId: r?.accountId || order.paymentAccountId,
      paymentAccountName: r?.accountName || order.paymentAccountName,
      paidAt: fully ? now : order.paidAt,
      // Integrated flow: fully paid bill must auto-clear from KDS
      ...(fully ? { kitchenStatus: 'served' as const, kitchenStatusAt: now } : {}),
    } as Order;

    if (!fully) {
      saveOrder(updated);
      try { enqueueReceipt(updated, { force: true }); } catch {}
      refresh();
      toast.warning(`${money(Math.max(0, total - newPaid))} still due — bill is partial`);
      return;
    }

    saveOrder(updated);
    if (order.tableId) {
      const tables = getTables();
      const t = tables.find(t => t.id === order.tableId);
      if (t) saveTable(releasedTable(t, updated));   // v1.15.1 — clears the dine timer too
    }
    try { enqueueReceipt(updated, { force: true }); } catch {}
    refresh();
    toast.success(`Order #${order.orderNumber} paid — receipt printing`);
  };

  const markStatus = (order: Order, status: 'running' | 'hold' | 'void' | 'cancelled') => {
    const updated = { ...order, status };
    saveOrder(updated);
    if ((status === 'void' || status === 'cancelled') && order.tableId) {
      const tables = getTables();
      const t = tables.find(t => t.id === order.tableId);
      if (t) saveTable(releasedTable(t, updated));   // v1.15.1 — clears the dine timer too
    }
    if ((status === 'void' || status === 'cancelled')
        && settings.kotEnabled !== false
        && (settings.printKotOnCancel !== false)
        && order.kotPrinted) {
      try {
        enqueueKotCancel(updated);
        toast.success(`CANCEL KOT sent to the kitchen — cooking will stop`);
      } catch {}
    }
    refresh();
    toast.success(`Order #${order.orderNumber} marked as ${status}`);
  };


  const retrieveInPOS = (order: Order) => {
    navigate('/?retrieve=' + order.id);
  };

  const statusColor = (status: string) => {
    if (status === 'running') return 'bg-status-success/15 text-status-success border-status-success/30';
    if (status === 'hold') return 'bg-status-warning/15 text-status-warning border-status-warning/30';
    if (status === 'partial') return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
    if (status === 'pending_approval') return 'bg-violet-500/15 text-violet-700 border-violet-500/30';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="p-4 lg:p-6">
      {/* v1.3.3 — Payment screen for running/hold bills */}
      {payOrderTarget && (
        <Suspense fallback={null}>
          <PaymentDialog
            open={!!payOrderTarget}
            items={payOrderTarget.items}
            onClose={() => setPayOrderTarget(null)}
            grandTotal={Math.max(0, Number(payOrderTarget.grandTotal || 0) - Number(payOrderTarget.amountPaid || 0))}
            customerPhone={payOrderTarget.customer?.phone}
            onConfirm={(r) => {
              const o = payOrderTarget;
              setPayOrderTarget(null);
              if (o) settleOrder(o, r);
            }}
          />
        </Suspense>
      )}
      <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
        <Clock className="h-5 w-5 text-status-warning" /> Running / Hold Bills
        {scope.restrict && (
          <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
            👤 {scope.name} — Sirf apne bills
          </span>
        )}
        {!scope.restrict && (
          <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
            🛡️ Admin — All cashiers
          </span>
        )}
      </h2>
      {orders.length === 0 ? (
        <p className="text-muted-foreground text-sm">No running or hold bills</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map(order => {
            const tables = getTables();
            const table = order.tableId ? tables.find(t => t.id === order.tableId) : null;
            const isRunning = order.status === 'running';
            const isUnpaid = (order.amountPaid || 0) <= 0 && order.status !== 'paid';
            return (
              <div key={order.id} className={`rounded-xl border p-4 space-y-2 ${isRunning ? 'bg-status-success/5 border-status-success/20' : 'bg-status-warning/5 border-status-warning/20'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">#{order.orderNumber}</span>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    {isUnpaid && (
                      <Badge className="text-[10px] bg-destructive text-destructive-foreground border-destructive font-bold tracking-wide">UNPAID</Badge>
                    )}
                    <Badge className={`text-[10px] ${statusColor(order.status)}`}>{order.status}</Badge>
                    <Badge variant="secondary" className="capitalize text-xs">{order.orderType}</Badge>
                  </div>
                </div>
                {table && <p className="text-xs text-muted-foreground">{table.name}</p>}
                {order.orderType === 'dining' && order.waiterName && (
                  <p className="text-xs text-muted-foreground">🧑‍🍳 Waiter: <span className="font-medium text-foreground">{order.waiterName}</span></p>
                )}
                {order.orderType === 'delivery' && order.riderName && (
                  <p className="text-xs text-muted-foreground">🛵 Rider: <span className="font-medium text-foreground">{order.riderName}</span>{order.riderPhone ? ` · ${order.riderPhone}` : ''}</p>
                )}
                {order.orderType === 'delivery' && !order.riderName && (
                  <p className="text-xs text-amber-700">🛵 Rider: <span className="italic">Not assigned</span></p>
                )}
                <p className="text-xs text-muted-foreground">{order.items.length} items</p>
                <p className="text-sm font-bold text-primary">PKR {order.grandTotal.toLocaleString()}</p>
                {(order as any).cashierName && (
                  <p className="text-[10px] text-muted-foreground">👤 {(order as any).cashierName}</p>
                )}
                {(order.status === 'partial' || (order.amountPaid && order.amountPaid > 0)) && (
                  <p className="text-[11px] font-bold text-amber-700">
                    Paid {money(Number(order.amountPaid || 0))} · Due {money(balanceDue(order))}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">{new Date(order.createdAt).toLocaleString('en-PK')}</p>
                <div className="flex gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setViewOrder(order)} className="text-xs h-8">
                    <Eye className="h-3 w-3 mr-1" /> View
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setHistoryOrder(order)} className="text-xs h-8">
                    <History className="h-3 w-3 mr-1" /> History
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => reprintKot(order)}
                    className="text-xs h-8 border-status-warning text-status-warning hover:bg-status-warning/10">
                    <ChefHat className="h-3 w-3 mr-1" /> {order.kotPrinted ? 'Reprint KOT' : 'Send to Kitchen'}
                  </Button>

                  <Button size="sm" variant="outline" onClick={() => retrieveInPOS(order)}
                    className="text-xs h-8 border-status-info text-status-info hover:bg-status-info/10">
                    <RotateCcw className="h-3 w-3 mr-1" /> Edit
                  </Button>
                  {!isOrderTaker && balanceDue(order) > 0 && (order.status === 'partial' || (order.amountPaid || 0) > 0) && (
                    <ReceivePaymentButton order={order} onUpdated={refresh} />
                  )}
                  {!isOrderTaker && (
                    <Button size="sm" onClick={() => payOrder(order)}
                      className="text-xs h-8 bg-status-success text-status-success-foreground hover:bg-status-success/90">
                      <CreditCard className="h-3 w-3 mr-1" /> Pay
                    </Button>
                  )}

                  {isRunning ? (
                    <Button size="sm" variant="outline" onClick={() => markStatus(order, 'hold')}
                      className="text-xs h-8 border-status-warning text-status-warning hover:bg-status-warning/10">
                      <Pause className="h-3 w-3 mr-1" /> Hold
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => markStatus(order, 'running')}
                      className="text-xs h-8 border-status-success text-status-success hover:bg-status-success/10">
                      Resume
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => markStatus(order, 'cancelled')}
                    className="text-xs h-8 border-destructive text-destructive hover:bg-destructive/10">
                    <Ban className="h-3 w-3 mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Order #{viewOrder?.orderNumber}</DialogTitle></DialogHeader>
          {viewOrder && <ReceiptPreview order={viewOrder} settings={settings} />}
        </DialogContent>
      </Dialog>

      <OrderDetailDialog order={historyOrder} onClose={() => setHistoryOrder(null)} />
    </div>
  );
}

