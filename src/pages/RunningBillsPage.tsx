import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { money } from '@/lib/currency';
import { getOrders, saveOrder, getTables, saveTable, getSettings, refreshOrdersFromCloud, onDataChange, genId } from '@/lib/store';
import { Order, PaymentEntry } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { CreditCard, Eye, Clock, RotateCcw, Ban, Pause, Play, ChefHat, History, Printer, Download, Plus, MoreHorizontal, Search, Calendar, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import StatusBadge, { type Tone } from '@/components/ui-kit/StatusBadge';
import { logReprint } from '@/lib/reprintAudit';
import { STATUS_FILTERS, RANGES, filterOrders, isOpenBill, statusPill, tableOf, customerOf, timeLabel, ordersCsv, type OrdersFilter, type PillTone } from '@/lib/ordersView';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReceiptPreview from '@/components/ReceiptPreview';
import OrderDetailDialog from '@/components/OrderDetailDialog';
import { enqueueKot, enqueueReceipt, enqueueKotUpdate, enqueueKotCancel, computeKotDiff, printOnHold, holdMessage } from '@/lib/printQueue';
import { toast } from 'sonner';
import { releasedTable } from '@/lib/tableRelease';
const PaymentDialog = lazy(() => import('@/components/PaymentDialog'));
import { useNavigate } from '@/lib/hash-router';
import ReceivePaymentButton from '@/components/ReceivePaymentButton';
import { balanceDue } from '@/lib/sales';
import { scopeOrders, getCurrentScope } from '@/lib/cashierScope';
import { startVisiblePoll } from '@/lib/visiblePoll';
import { PageTitle, FilterBar, EmptyState } from '@/components/layout/PageFrame';
import MasterDetail, { useWideScreen } from '@/components/layout/MasterDetail';

export default function RunningBillsPage() {
  const scope = getCurrentScope();
  // v1.131.0 — the design's Orders screen lists the day's bills of every status (it used to list only the open ones); an open bill
  // still has all of its actions in the panel.
  const loadAll = () => scopeOrders(getOrders());
  const [orders, setOrders] = useState(loadAll);
  const [payOrderTarget, setPayOrderTarget] = useState<Order | null>(null);
  const settings = getSettings();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelClosed, setPanelClosed] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [historyOrder, setHistoryOrder] = useState<Order | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [filter, setFilter] = useState<OrdersFilter>({ range: 'today', type: 'all', status: 'all', q: '' });
  const wide = useWideScreen();
  const navigate = useNavigate();
  const isOrderTaker = scope.role === 'order_taker';



  const refresh = () => setOrders(loadAll());

  // Live cross-device sync: cloud pull every 10s + onDataChange listener.
  useEffect(() => {
    let cancel = false;
    const pull = async () => {
      try { await refreshOrdersFromCloud(); } catch {}
      if (!cancel) refresh();
    };
    pull();
    const stopPoll = startVisiblePoll(pull, 10000);
    const unsub = onDataChange((col) => { if (!cancel && col === 'orders') refresh(); });
    return () => { cancel = true; stopPoll(); unsub(); };
  }, []);

  // ===== v1.57.0 — "Retrieve se KOT print karun to aata nahi" =====
  //
  // enqueueKot() RETURNS NULL when it declines the job — an order still
  // awaiting approval, KOT printing switched off, a duplicate already in the
  // queue. Every one of those was thrown away here, and the toast said "sent
  // to the kitchen" regardless. The operator was told the ticket had gone
  // while nothing had been queued at all.
  //
  // A job that IS queued can still never print if no KOT printer is resolved:
  // enqueuePrint() records "No KOT printer resolved — check Printer Settings"
  // in the print log and nowhere the operator can see. That is the same
  // silence one step later, so it is reported too.
  const reprintKot = (order: Order) => {
    try {
      if (order.kotPrinted) {
        const diff = computeKotDiff(order);
        if (diff.hasDiff) {
          const job = enqueueKotUpdate(order);
          if (!job) {
            toast.error('Kitchen update could not be queued — open Printing Center to see why.');
            return;
          }
          if (!job.printerId) {
            toast.warning('Kitchen update queued, but no KOT printer is set — Settings → Printers.');
            return;
          }
          toast.success(`KOT update sent — ${diff.diffItemIds.length} new/extra items to the kitchen`);
          return;
        }
      }
    } catch (e) {
      // Never silent: a failure to work out the diff must not masquerade as
      // "nothing changed", because the next line then sends a full reprint.
      console.error('[kot] could not compute the kitchen diff', e);
    }

    const job = enqueueKot(order, { force: true });
    if (!job) {
      const why = order.status === 'pending_approval'
        ? 'This order is still awaiting approval, so it cannot go to the kitchen yet.'
        : order.status === 'rejected'
          ? 'This order was rejected, so it cannot go to the kitchen.'
          : 'KOT was not queued — it may be switched off in Settings, or one is already queued.';
      toast.error(why, { duration: 7000 });
      return;
    }
    if (!job.printerId) {
      toast.warning(
        `KOT #${order.orderNumber} is queued, but no KOT printer is configured — `
        + 'set one in Settings → Printers, then retry from Printing Center.',
        { duration: 9000 },
      );
      return;
    }
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
    if (status === 'hold' && order.status !== 'hold') toast.success(holdMessage(order.orderNumber, printOnHold(updated)));
    else toast.success(`Order #${order.orderNumber} marked as ${status}`);
  };


  const retrieveInPOS = (order: Order) => {
    navigate('/?retrieve=' + order.id);
  };

  const reprint = (o: Order) => {
    try {
      enqueueReceipt(o, { force: true });
      logReprint({ orderId: o.id, billNumber: o.orderNumber, orderStatus: o.status, type: 'receipt' });
      toast.success(`Bill #${o.orderNumber} — customer receipt sent to the printer`);
    } catch {
      toast.error('Print failed');
    }
  };

  const visible = useMemo(() => filterOrders(orders, filter), [orders, filter]);
  const shown = visible.slice(0, 300);
  const viewOrder = shown.find(o => o.id === selectedId) || null;
  // On a wide window the panel is never empty (the design opens with a bill selected); closing it keeps it closed until the filter changes.
  useEffect(() => { setPanelClosed(false); }, [filter.status, filter.range, filter.type]);
  useEffect(() => { if (wide && !panelClosed && shown.length > 0 && !shown.some(o => o.id === selectedId)) setSelectedId(shown[0].id); }, [wide, panelClosed, shown, selectedId]);

  const exportCsv = () => {
    const blob = new Blob(['\ufeff' + ordersCsv(visible)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const TONE: Record<PillTone, Tone> = { info: 'info', accent: 'accent', warn: 'warning', ok: 'success', bad: 'danger', neutral: 'neutral' };
  const pill = (o: Order) => { const p = statusPill(o); return <StatusBadge tone={TONE[p.tone]} dot={false} className="px-2 py-[3px] text-[11.5px] font-bold">{p.label}</StatusBadge>; };
  const rangeLabel = RANGES.find(r => r.key === filter.range)?.label || 'Today';
  const typeOptions = ['dining', 'takeaway', 'delivery', ...(settings.foodpandaEnabled ? ['foodpanda'] : [])];
  const chip = 'inline-flex h-8 items-center whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold transition-colors';
  const selectCls = 'h-9 appearance-none rounded-xl border bg-card pl-8 pr-3 text-[13px] font-semibold';

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
      {/* v1.131.0 — SW-06 Orders: the title and its one muted line, Export + New bill at the right */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <PageTitle icon={Clock} subtitle={`${rangeLabel} · ${visible.length} ${visible.length === 1 ? 'bill' : 'bills'}${scope.restrict ? ` · ${scope.name || 'your'} bills only` : ''}`}>Orders</PageTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 rounded-xl px-4" onClick={exportCsv} disabled={visible.length === 0}><Download className="mr-2 h-4 w-4" /> Export</Button>
          <Button className="h-11 rounded-xl px-4" onClick={() => navigate('/')}><Plus className="mr-2 h-4 w-4" /> New bill</Button>
        </div>
      </div>

      <FilterBar label="Filter bills">
        <div className="relative min-w-[240px] max-w-sm flex-1" data-filter-grow>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} placeholder="Bill number, customer, table…" aria-label="Search bills" className="h-10 rounded-xl pl-9" />
        </div>
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(f => (
            <button key={f.key} type="button" data-status-filter={f.key} aria-pressed={filter.status === f.key} onClick={() => setFilter(x => ({ ...x, status: f.key }))}
              className={cn(chip, filter.status === f.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50')}>{f.label}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="relative"><Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <select aria-label="Period" value={filter.range} onChange={e => setFilter(f => ({ ...f, range: e.target.value as OrdersFilter['range'] }))} className={selectCls}>
              {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select></label>
          <label className="relative"><Filter className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <select aria-label="Order type" value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))} className={selectCls}>
              <option value="all">All types</option>
              {typeOptions.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select></label>
        </div>
      </FilterBar>

      {/* the bill opens in a panel beside the table on a wide window, and in a dialog below it */}
      <div className="mt-4">
      <MasterDetail
        title={viewOrder ? `Bill #${viewOrder.orderNumber}` : 'Bill'} badge={viewOrder ? pill(viewOrder) : undefined} open={!!viewOrder} onClose={() => { setSelectedId(null); setPanelClosed(true); }}
        emptyText="Select a bill to see its items and total." dialogClassName="sm:max-w-md max-h-[90vh] overflow-y-auto"
        detail={viewOrder ? (() => {
          const o = viewOrder;
          const open = isOpenBill(o);
          const isRunning = o.status === 'running';
          const act = (fn: () => void) => () => { setMoreOpen(false); fn(); };
          const row = 'flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-semibold transition-colors hover:bg-accent';
          return (
            <div className="space-y-4" data-bill-panel={o.id}>
              <div>
                <p className="text-[12.5px] text-muted-foreground">{[o.orderType[0].toUpperCase() + o.orderType.slice(1), tableOf(o), customerOf(o), timeLabel(o)].filter(Boolean).join(' · ')}</p>
                {o.orderType === 'delivery' && <p className="text-[12.5px] text-muted-foreground">{o.riderName ? `Rider: ${o.riderName}${o.riderPhone ? ` · ${o.riderPhone}` : ''}` : 'Rider: not assigned'}</p>}
                {o.orderType === 'dining' && o.waiterName && <p className="text-[12.5px] text-muted-foreground">Waiter: {o.waiterName}</p>}
              </div>
              <ul className="divide-y border-y" data-bill-lines>
                {o.items.map(i => (
                  <li key={i.id} className="py-2.5 text-[14px]">
                    <div className="flex items-start justify-between gap-3"><span>{i.quantity} × {i.name}</span><span className="shrink-0 tabular-nums">{money(i.lineTotal)}</span></div>
                    {i.note && <p className="text-[12px] italic text-muted-foreground">{i.note}</p>}
                  </li>
                ))}
              </ul>
              <div className="flex items-baseline justify-between"><span className="text-[18px] font-extrabold">Total</span><span className="text-[20px] font-extrabold tabular-nums">{money(o.grandTotal)}</span></div>
              {(o.status === 'partial' || Number(o.amountPaid || 0) > 0) && o.status !== 'paid' && (
                <p className="text-[12.5px] font-bold text-[hsl(var(--dt-warn))]">Paid {money(Number(o.amountPaid || 0))} · Due {money(balanceDue(o))}</p>
              )}
              <div className="flex flex-wrap items-center gap-2" data-bill-actions>
                <Button variant="outline" className="h-11 rounded-xl px-4" onClick={() => reprint(o)}><Printer className="mr-2 h-4 w-4" /> Reprint</Button>
                {open && !isOrderTaker && <Button className="h-11 rounded-xl px-5" onClick={() => payOrder(o)}><CreditCard className="mr-2 h-4 w-4" /> Pay</Button>}
                {open && !isOrderTaker && balanceDue(o) > 0 && (o.status === 'partial' || Number(o.amountPaid || 0) > 0) && <ReceivePaymentButton order={o} onUpdated={refresh} />}
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger asChild><Button variant="outline" size="icon" className="h-11 w-11 rounded-xl" aria-label="More actions" data-bill-more><MoreHorizontal className="h-5 w-5" /></Button></PopoverTrigger>
                  <PopoverContent align="end" className="w-60 p-1.5" data-bill-more-menu>
                    <div className="space-y-0.5">
                      <button type="button" className={row} data-bill-more-item="receipt" onClick={act(() => setReceiptOrder(o))}><Eye className="h-4 w-4 text-muted-foreground" /> View receipt</button>
                      <button type="button" className={row} data-bill-more-item="history" onClick={act(() => setHistoryOrder(o))}><History className="h-4 w-4 text-muted-foreground" /> History</button>
                      {open && <>
                        <div className="my-1 h-px bg-border" />
                        <button type="button" className={row} data-bill-more-item="edit" onClick={act(() => retrieveInPOS(o))}><RotateCcw className="h-4 w-4 text-muted-foreground" /> Edit in POS</button>
                        <button type="button" className={row} data-bill-more-item="kot" onClick={act(() => reprintKot(o))}><ChefHat className="h-4 w-4 text-muted-foreground" /> {o.kotPrinted ? 'Reprint KOT' : 'Send to Kitchen'}</button>
                        {isRunning
                          ? <button type="button" className={row} data-bill-more-item="hold" onClick={act(() => markStatus(o, 'hold'))}><Pause className="h-4 w-4 text-muted-foreground" /> Hold</button>
                          : <button type="button" className={row} data-bill-more-item="resume" onClick={act(() => markStatus(o, 'running'))}><Play className="h-4 w-4 text-muted-foreground" /> Resume</button>}
                        <button type="button" className={cn(row, 'text-destructive')} data-bill-more-item="cancel" onClick={act(() => markStatus(o, 'cancelled'))}><Ban className="h-4 w-4" /> Cancel bill</button>
                      </>}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          );
        })() : null}
        list={
          <div className="overflow-hidden rounded-2xl border bg-card shadow-card" data-orders-table>
            {shown.length === 0 ? (
              <EmptyState title="No bills here" hint={orders.length === 0 ? 'Bills you take will appear here.' : 'Nothing matches this period, type and status.'} />
            ) : (
              <div className="overflow-x-auto">
                <table data-roomy className="w-full text-[14px]">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      <th className="px-4 py-3">Bill</th>
                      <th className="hidden px-3 py-3 md:table-cell">Type</th>
                      <th className="hidden px-3 py-3 md:table-cell">Table</th>
                      <th className="px-3 py-3">Customer</th>
                      <th className="px-3 py-3 text-right">Total</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="hidden px-4 py-3 sm:table-cell">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(o => {
                      const sel = viewOrder?.id === o.id;
                      return (
                        <tr key={o.id} data-bill-row={o.id} data-bill-card={o.id} aria-selected={sel} tabIndex={0}
                          onClick={() => { setSelectedId(o.id); setPanelClosed(false); }}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(o.id); setPanelClosed(false); } }}
                          className={cn('cursor-pointer border-b outline-none transition-colors last:border-0 hover:bg-accent/50 focus-visible:bg-accent/60', sel && 'bg-[hsl(var(--dt-accent-tint))]')}>
                          <td className="px-4 py-3 font-extrabold">#{o.orderNumber}</td>
                          <td className="hidden px-3 py-3 capitalize md:table-cell">{o.orderType}</td>
                          <td className="hidden px-3 py-3 md:table-cell">{tableOf(o) || '—'}</td>
                          <td className="max-w-[14rem] truncate px-3 py-3">{customerOf(o)}</td>
                          <td className="px-3 py-3 text-right font-extrabold tabular-nums">{money(o.grandTotal)}</td>
                          <td className="px-3 py-3">{pill(o)}</td>
                          <td className="hidden px-4 py-3 tabular-nums sm:table-cell">{timeLabel(o)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visible.length > shown.length && <p className="border-t px-4 py-2 text-[12px] text-muted-foreground">Showing the newest {shown.length} of {visible.length} — narrow the period or search to see the rest.</p>}
              </div>
            )}
          </div>
        }
      />
      </div>

      {/* the full receipt, one tap from the ⋯ menu (it used to be the whole panel) */}
      <Dialog open={!!receiptOrder} onOpenChange={o => { if (!o) setReceiptOrder(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>{receiptOrder ? `Bill #${receiptOrder.orderNumber}` : 'Bill'}</DialogTitle></DialogHeader>
          {receiptOrder && <ReceiptPreview order={receiptOrder} settings={settings} />}
        </DialogContent>
      </Dialog>

      <OrderDetailDialog order={historyOrder} onClose={() => setHistoryOrder(null)} />
    </div>
  );
}

