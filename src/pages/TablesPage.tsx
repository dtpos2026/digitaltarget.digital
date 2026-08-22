import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { money } from '@/lib/currency';
import { releasedTable } from '@/lib/tableRelease';
import { useRestrictedAction } from '@/components/RestrictedActionGate';
import { sortTablesForGrid } from '@/lib/tableOrder';
import {
  getTables, getOrders, saveTable, saveOrder, getFloors, refreshOrdersFromCloud, onDataChange, genId, getNextOrderNumber, getNextOrderNumberAsync } from '@/lib/store';
import { DiningTable, Order, TableStatus, CartItem, TableSession, PaymentEntry } from '@/lib/types';
import { Users, Utensils, Clock, ArrowRightLeft, Combine, Split, Grid3x3, Map as MapIcon, History, QrCode, Plus, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { enqueueReceipt } from '@/lib/printQueue';
const PaymentDialog = lazy(() => import('@/components/PaymentDialog'));
import { useNavigate } from '@/lib/hash-router';
import TableShapePreview from '@/components/TableShapePreview';
import TableQR, { PublicOrderQR } from '@/components/TableQR';
import { ENABLE_REDUNDANT_ORDER_POLL } from '@/lib/featureFlags';

const statusConfig: Record<TableStatus, { label: string; emoji: string; border: string; bg: string; icon: string; badge: string; badgeText: string }> = {
  free: {
    label: 'Available', emoji: '🟢',
    border: 'border-status-free/30 hover:border-status-free',
    bg: 'bg-status-free/5',
    icon: 'text-status-free',
    badge: 'bg-status-free text-status-free-foreground',
    badgeText: 'Available',
  },
  running: {
    label: 'Running', emoji: '🟡',
    border: 'border-status-running/30 hover:border-status-running',
    bg: 'bg-status-running/5',
    icon: 'text-status-running',
    badge: 'bg-status-running text-status-running-foreground',
    badgeText: 'Running',
  },
  'pending-payment': {
    label: 'Pending Payment', emoji: '🔴',
    border: 'border-status-pending-payment/30 hover:border-status-pending-payment',
    bg: 'bg-status-pending-payment/5',
    icon: 'text-status-pending-payment',
    badge: 'bg-status-pending-payment text-status-pending-payment-foreground',
    badgeText: 'Pending Pay',
  },
  closed: {
    label: 'Closed', emoji: '⚫',
    border: 'border-status-closed/30 hover:border-status-closed',
    bg: 'bg-status-closed/5',
    icon: 'text-status-closed',
    badge: 'bg-status-closed text-status-closed-foreground',
    badgeText: 'Closed',
  },
};

type BillAction = 'transfer' | 'merge' | 'split' | null;
type ViewMode = 'grid' | 'layout';

function fmtDuration(mins: number) {
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function TablesPage() {
  const [tables, setTables] = useState(() => getTables());
  const [orders, setOrders] = useState(() => getOrders());
  const floors = useMemo(() => getFloors(), []);
  const [activeFloor, setActiveFloor] = useState<string>('all');
  const [selectedTable, setSelectedTable] = useState<DiningTable | null>(null);
  const [payTable, setPayTable] = useState<DiningTable | null>(null);
  // Payment / free-table / bill-close are restricted for Order Takers.
  const { guard: guardAction, dialog: managerGateDialog } = useRestrictedAction();
  const [billAction, setBillAction] = useState<BillAction>(null);
  const [splitPicks, setSplitPicks] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [historyTable, setHistoryTable] = useState<DiningTable | null>(null);
  const [qrTable, setQrTable] = useState<DiningTable | null>(null);
  const [bulkQrOpen, setBulkQrOpen] = useState(false);
  const [publicQrOpen, setPublicQrOpen] = useState<null | 'takeaway' | 'delivery'>(null);
  const [seatPickerGuests, setSeatPickerGuests] = useState<number>(0);
  const [, forceTick] = useState(0);
  const navigate = useNavigate();

  // Live ticking clock so elapsed times update every 30s
  useEffect(() => {
    const id = setInterval(() => forceTick(x => x + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Live cross-device sync: pull from cloud + listen for changes so KDS
  // ready/serve updates and other devices' actions reflect here automatically.
  useEffect(() => {
    let cancel = false;
    const pull = async () => {
      try { await refreshOrdersFromCloud(); } catch {}
      if (!cancel) { setOrders(getOrders()); setTables(getTables()); }
    };
    pull();
    // Live onDataChange listener below is the primary sync path.
    // Legacy 10s poll kept behind a flag (default off) to avoid duplicate reads.
    const t: any = ENABLE_REDUNDANT_ORDER_POLL ? setInterval(pull, 10000) : null;
    const unsub = onDataChange((col) => {
      if (cancel) return;
      if (col === 'orders') setOrders(getOrders());
      if (col === 'tables') setTables(getTables());
    });
    return () => { cancel = true; if (t) clearInterval(t); unsub(); };
  }, []);

  // Auto-set seatedAt when a table becomes running but has no seatedAt (back-fill from order.createdAt)
  useEffect(() => {
    let changed = false;
    const updated = tables.map(t => {
      // ===== v1.15.1 — clear the phantom dine timer =====
      // Builds before this one freed tables without clearing `seatedAt`, so
      // free tables kept counting ("AVAILABLE · Sitting 94h 31m"). The write
      // paths are fixed, but rows already saved that way have to be repaired
      // here or the ghost timers would run until someone re-seated the table.
      if (t.seatedAt && (t.status === 'free' || t.status === 'closed')) {
        const live = orders.find(o => o.tableId === t.id
          && ['running', 'hold', 'partial', 'credit_pending'].includes(o.status));
        if (!live) {
          const next = releasedTable(t, undefined, t.status);
          saveTable(next);
          changed = true;
          return next;
        }
      }
      if (t.status === 'running' && !t.seatedAt) {
        const o = t.currentOrderId ? orders.find(x => x.id === t.currentOrderId) : undefined;
        const seatedAt = o?.createdAt || new Date().toISOString();
        const next = { ...t, seatedAt };
        saveTable(next);
        changed = true;
        return next;
      }
      return t;
    });
    if (changed) setTables(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.length, tables.length]);

  // Auto-reserve table when a QR / website dine-in order arrives but the table is still free.
  // Customer device cannot write to /tables (firestore rules), so the POS does it here.
  useEffect(() => {
    if (!orders.length || !tables.length) return;
    const activeDineIn = orders.filter(o =>
      o.orderType === 'dining'
      && (o.status === 'running' || o.status === 'hold')
      && (o.source === 'qr' || o.source === 'website')
      && (o.tableId || o.tableName || o.tableLabel)
    );
    if (!activeDineIn.length) return;
    let changed = false;
    for (const o of activeDineIn) {
      const labelKey = (o.tableName || o.tableLabel || '').split('·')[0].trim().toLowerCase();
      const t = tables.find(x => x.id === o.tableId)
        || tables.find(x => (x.name || '').trim().toLowerCase() === labelKey);
      if (!t) continue;
      if (t.status === 'free' || !t.currentOrderId) {
        saveTable({
          ...t,
          status: 'running',
          currentOrderId: o.id,
          seatedAt: t.seatedAt || o.createdAt || new Date().toISOString(),
          seatedGuests: t.seatedGuests || t.seats || 1,
        });
        changed = true;
      }
    }
    if (changed) setTables(getTables());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, tables]);

  const refresh = () => {
    setTables(getTables());
    setOrders(getOrders());
  };

  // ===== v1.3.3 FIX — "No active order" on Transfer / Merge / Split =====
  // Pehle ye SIRF t.currentOrderId par depend karta tha. Wo pointer aksar
  // stale ho jata hai (order doosre device se bana, sync ke baad, ya order
  // edit hone par) — table screen par "Running" dikhta tha lekin Transfer/
  // Merge/Split "No active order" keh dete thay. Ab agar pointer kaam na
  // kare to table ka asal live order dhoond liya jata hai, aur pointer khud
  // theek ho jata hai (self-heal).
  const LIVE_STATUSES = ['running', 'hold', 'partial', 'credit_pending'];
  const getTableOrder = (t: DiningTable): Order | undefined => {
    const byPointer = t.currentOrderId
      ? orders.find(o => o.id === t.currentOrderId && LIVE_STATUSES.includes(o.status))
      : undefined;
    if (byPointer) {
      // ===== v1.9.1 =====
      // The pointer is right but the table's own status can still have
      // drifted (a bill put on HOLD and later recalled, a sync from another
      // device, or older table rows saved before `status` existed). The
      // Transfer / Merge / Split buttons used to be gated on that status,
      // so a table with a perfectly good live bill showed no bill actions.
      // Repair the status here so every screen agrees.
      if (t.status !== 'running' && t.status !== 'pending-payment') {
        try { saveTable({ ...t, status: 'running', currentOrderId: byPointer.id }); } catch { /* non-fatal */ }
      }
      return byPointer;
    }
    // Fallback: newest live order actually attached to this table.
    const byTable = orders
      .filter(o => o.tableId === t.id && LIVE_STATUSES.includes(o.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (byTable && t.currentOrderId !== byTable.id) {
      // Repair the pointer so every other screen agrees from now on.
      try { saveTable({ ...t, status: 'running', currentOrderId: byTable.id }); } catch { /* non-fatal */ }
    }
    return byTable;
  };

  const filteredTables = useMemo(() => {
    // v1.15.1 — the Grid used to render raw store order (Table 4, 1, 2, 3, 5…).
    // It now follows the floor map arrangement, or natural table numbers.
    const base = activeFloor === 'all'
      ? tables
      : activeFloor === 'none'
        ? tables.filter(t => !t.floorId)
        : tables.filter(t => t.floorId === activeFloor);
    return sortTablesForGrid(base);
  }, [tables, activeFloor]);

  // Close a session and append to history
  const closeSession = (t: DiningTable, order: Order | undefined): TableSession | null => {
    if (!t.seatedAt) return null;
    const seated = new Date(t.seatedAt).getTime();
    const freed = Date.now();
    const durationMinutes = Math.max(1, Math.round((freed - seated) / 60000));
    return {
      seatedAt: t.seatedAt,
      freedAt: new Date(freed).toISOString(),
      durationMinutes,
      orderId: order?.id,
      orderNumber: order?.orderNumber,
      guests: t.seats,
      total: order?.grandTotal,
    };
  };

  // ===== v1.3.3 FIX — payment screen ab zaroor khulti hai =====
  // Pehle "Payment Received / Mark as Paid" seedha order ko 'paid' kar deta
  // tha — na payment method poochta tha, na amount, na receipt. Cash aur card
  // ka farq report me kabhi nazar nahi aata tha. Ab pehle payment screen
  // khulti hai; sirf usi ke confirm par table free hota hai.
  const settleTable = (t: DiningTable, r: any) => {
    const order = getTableOrder(t);
    const stamp = new Date().toISOString();
    const by = localStorage.getItem('pos-user-name') || 'cashier';
    let saved: Order | undefined;
    if (order) {
      const total = Number(order.grandTotal || 0);
      const newPayments: PaymentEntry[] = (r?.payments || []).map((p: any) => ({ ...p, id: genId(), at: stamp, by }));
      const merged: PaymentEntry[] = [...(order.payments || []), ...newPayments];
      const newPaid = merged.reduce((sum, p) => sum + (p.amount || 0), 0);
      const fully = newPaid >= total - 0.5;
      saved = {
        ...order,
        payments: merged,
        amountPaid: Math.min(newPaid, total),
        status: fully ? 'paid' : 'partial',
        paymentMethod: r?.method || order.paymentMethod,
        paymentAccountId: r?.accountId || order.paymentAccountId,
        paymentAccountName: r?.accountName || order.paymentAccountName,
        paidAt: fully ? stamp : order.paidAt,
      } as Order;
      saveOrder(saved);
      try { enqueueReceipt(saved, { force: true }); } catch {}
      if (!fully) {
        // Partial payment — table stays occupied so the balance isn't lost.
        saveTable({ ...t, status: 'pending-payment' });
        refresh();
        toast.warning(`${money(Math.max(0, total - newPaid))} still due — table is on pending payment`);
        return;
      }
    }
    const session = closeSession(t, saved || order);
    const sessions = session ? [...(t.sessions || []), session] : (t.sessions || []);
    saveTable({ ...t, status: 'free', currentOrderId: undefined, seatedAt: undefined, sessions });
    refresh();
    toast.success(`${t.name} is now free${session ? ` · ${fmtDuration(session.durationMinutes)} dine time` : ''}`);
  };

  /** Opens the payment screen. Table with no order frees immediately. */
  const requestPayment = (t: DiningTable) => {
    const ord = getTableOrder(t);
    guardAction('payment', { orderId: ord?.id, orderNumber: ord?.orderNumber, tableLabel: t.name, amount: ord?.grandTotal },
      () => doRequestPayment(t));
  };
  const doRequestPayment = (t: DiningTable) => {
    const order = getTableOrder(t);
    if (!order || Number(order.grandTotal || 0) <= 0) {
      // Nothing to collect — free it directly (old behaviour is correct here).
      const session = closeSession(t, order);
      const sessions = session ? [...(t.sessions || []), session] : (t.sessions || []);
      saveTable({ ...t, status: 'free', currentOrderId: undefined, seatedAt: undefined, sessions });
      refresh();
      toast.success(`${t.name} is now free`);
      setSelectedTable(null);
      return;
    }
    setPayTable(t);
  };
  const markPendingPayment = (t: DiningTable) => {
    saveTable({ ...t, status: 'pending-payment' });
    refresh();
    toast.info(`${t.name} marked as Pending Payment`);
  };
  const markClosed = (t: DiningTable) => {
    const ord = getTableOrder(t);
    guardAction('bill-close', { orderId: ord?.id, orderNumber: ord?.orderNumber, tableLabel: t.name, amount: ord?.grandTotal },
      () => doMarkClosed(t));
  };
  const doMarkClosed = (t: DiningTable) => {
    const order = getTableOrder(t);
    if (order) saveOrder({ ...order, status: 'paid', paidAt: new Date().toISOString() });
    const session = closeSession(t, order);
    const sessions = session ? [...(t.sessions || []), session] : (t.sessions || []);
    saveTable({ ...t, status: 'closed', currentOrderId: undefined, seatedAt: undefined, sessions });
    refresh();
    toast.success(`${t.name} closed`);
  };
  const reopenTable = (t: DiningTable) => {
    saveTable({ ...t, status: 'free', currentOrderId: undefined, seatedAt: undefined });
    refresh();
    toast.success(`${t.name} reopened`);
  };

  /**
   * v1.15.1 — release a table that was seated but never billed.
   * There is no order to settle, so nothing is charged; the dine session is
   * still recorded so the table's history stays honest about the time it
   * was held.
   */
  const cancelEmptyTable = (t: DiningTable) => {
    guardAction('free-table', { tableLabel: t.name }, () => {
      saveTable(releasedTable(t, undefined, 'free'));
      refresh();
      toast.success(`${t.name} freed — there was no bill`);
    });
  };

  const handleTableClick = (t: DiningTable) => {
    // ===== v1.12.4 — THE ROOT CAUSE of "Transfer/Merge/Split never appear" =====
    //
    // Tapping a table with a live bill used to jump STRAIGHT to the POS to
    // edit that bill. The table panel — the only place the Transfer / Merge /
    // Split buttons live — therefore never opened for exactly the tables
    // those actions apply to. Meanwhile a table with NO live bill did open
    // the panel, but then the buttons are (correctly) hidden because there
    // is no bill to act on.
    //
    // Net effect: the three bill actions were unreachable in normal use. All
    // the earlier fixes (button gating v1.9.1, handlers v1.12.1, dialog lists
    // v1.12.2) were repairs to code the cashier could never actually reach.
    //
    // Now every tap opens the panel, which shows the bill summary plus an
    // explicit "Edit / Add Items" button for the old jump-to-POS behaviour.
    // One extra tap to edit; the bill actions become reachable at all.
    if (!getTableOrder(t)) setSeatPickerGuests(Math.min(t.seats, 2) || 1);
    setSelectedTable(t);
  };

  const seatAndStart = (t: DiningTable, guests: number) => {
    const g = Math.max(1, Math.min(t.seats, guests || 1));
    saveTable({ ...t, status: 'running', seatedAt: new Date().toISOString(), seatedGuests: g });
    refresh();
    toast.success(`${t.name} seated · ${g} guest${g > 1 ? 's' : ''}`);
    setSelectedTable(null);
    navigate(`/?table=${encodeURIComponent(t.id)}&guests=${g}`);
  };

  const floorNameOf = (t: DiningTable): string | undefined => {
    if (!t.floorId) return undefined;
    return floors.find(f => f.id === t.floorId)?.name;
  };

  const getSeatedTime = (t: DiningTable): string | null => {
    if (!t.seatedAt) return null;
    const mins = Math.floor((Date.now() - new Date(t.seatedAt).getTime()) / 60000);
    return fmtDuration(mins);
  };

  // ============================================================
  // Bill actions: Transfer / Merge / Split (unchanged)
  // ============================================================
  const recomputeTotals = (o: Order): Order => {
    const subtotal = o.items.reduce((s, i) => s + i.lineTotal, 0);
    const serviceCharge = Math.round(((o.serviceChargePercent || 0) / 100) * subtotal);
    const grandTotal = Math.max(0, subtotal - (o.discount || 0) + (o.tax || 0) + serviceCharge);
    return { ...o, subtotal, serviceCharge, grandTotal };
  };

  const transferBill = (fromTable: DiningTable, toTable: DiningTable) => {
    const order = getTableOrder(fromTable);
    if (!order) return toast.error(`No live order on ${fromTable.name} — create an order first`);
    // v1.12.1 — check for a LIVE ORDER, not table.status. The status field
    // drifts (hold/recall, cross-device sync, legacy rows), so trusting it
    // could either block a genuinely free table or overwrite a live bill.
    if (getTableOrder(toTable)) {
      return toast.error(`${toTable.name} already has a running bill — settle or merge it first`);
    }
    saveOrder({ ...order, tableId: toTable.id, tableName: toTable.name });
    saveTable({ ...fromTable, status: 'free', currentOrderId: undefined, seatedAt: undefined });
    saveTable({ ...toTable, status: 'running', currentOrderId: order.id, seatedAt: fromTable.seatedAt || new Date().toISOString() });
    refresh();
    toast.success(`Bill transferred ${fromTable.name} → ${toTable.name}`);
    setBillAction(null);
    setSelectedTable(null);
  };

  const mergeBill = (sourceTable: DiningTable, intoTable: DiningTable) => {
    const src = getTableOrder(sourceTable);
    const dst = getTableOrder(intoTable);
    if (!src) return toast.error(`${sourceTable.name} has no live order`);
    if (!dst) return toast.error(`${intoTable.name} has no live order — both tables need a bill to merge`);
    if (src.id === dst.id) return toast.error('Same order');
    const mergedItems: CartItem[] = [...dst.items, ...src.items.map(i => ({ ...i, id: i.id + '-m' + Date.now() }))];
    const merged = recomputeTotals({ ...dst, items: mergedItems, notes: [dst.notes, src.notes].filter(Boolean).join(' | ') });
    saveOrder(merged);
    // v1.12.1 — the source bill is voided so it stops counting as a sale,
    // but it is NOT a refund: no cash left the drawer. Without this stamp
    // the merged bill showed up as "Refunded" in the sales report and was
    // subtracted from the cash drawer, so a merge silently corrupted both.
    saveOrder({
      ...src,
      status: 'void',
      voidReason: `Merged into ${intoTable.name}`,
      mergedIntoOrderId: dst.id,
    });
    saveTable({ ...sourceTable, status: 'free', currentOrderId: undefined, seatedAt: undefined });
    refresh();
    toast.success(`Bill merged into ${intoTable.name}`);
    setBillAction(null);
    setSelectedTable(null);
  };

  const splitBill = async (fromTable: DiningTable, toTable: DiningTable) => {
    const order = getTableOrder(fromTable);
    if (!order) return toast.error(`No live order on ${fromTable.name}`);
    if (getTableOrder(toTable)) {
      return toast.error(`${toTable.name} already has a running bill`);
    }
    const moveIds = Object.entries(splitPicks).filter(([, v]) => v).map(([k]) => k);
    if (moveIds.length === 0) return toast.error('Pick at least one item to split');
    if (moveIds.length === order.items.length) return toast.error('Cannot move every item — that is a Transfer, not Split');

    const movedItems = order.items.filter(i => moveIds.includes(i.id));
    const remainingItems = order.items.filter(i => !moveIds.includes(i.id));

    // v1.12.1 — TWO real bugs fixed here:
    //  1. The split bill reused the SOURCE order number. Two live bills
    //     then shared one number, which breaks bill lookup/reprint, day-close
    //     counting, and PRA EIMS (where USIN must be unique per invoice).
    //  2. `...order` cloned `payments` and `amountPaid` onto the new bill,
    //     so money already taken was counted TWICE — once on each half.
    //     A split bill starts unpaid; the customer has not paid it yet.
    const newOrder: Order = recomputeTotals({
      ...order,
      id: genId(),
      // v1.17.1 — was getNextOrderNumber(), which increments a LOCAL counter.
      // On a multi-device floor (POS + tablets) every device holds its own
      // counter, so two splits on two devices produced the same number, and a
      // counter arriving from the cloud made the next number jump. The POS and
      // the online portal already used the transactional path; the split bill
      // and the token sale were the two that did not.
      orderNumber: await getNextOrderNumberAsync(),
      items: movedItems,
      tableId: toTable.id,
      tableName: toTable.name,
      createdAt: new Date().toISOString(),
      status: 'running',
      payments: [],
      amountPaid: 0,
      paidAt: undefined,
      paymentMethod: undefined,
      paymentAccountId: undefined,
      paymentAccountName: undefined,
      cashReceived: undefined,
      changeReturned: undefined,
      // Fiscal/print stamps belong to the original bill, never to the copy.
      praStatus: undefined,
      praInvoiceNumber: undefined,
      praSubmittedAt: undefined,
      kotPrinted: false,
      splitFromOrderId: order.id,
      notes: (order.notes ? order.notes + ' | ' : '') + `Split from ${fromTable.name}`,
    } as Order);
    const updatedSource = recomputeTotals({ ...order, items: remainingItems });

    saveOrder(updatedSource);
    saveOrder(newOrder);
    saveTable({ ...toTable, status: 'running', currentOrderId: newOrder.id, seatedAt: new Date().toISOString() });
    refresh();
    toast.success(`Split: ${movedItems.length} item(s) moved to ${toTable.name}`);
    setSplitPicks({});
    setBillAction(null);
    setSelectedTable(null);
  };

  // ---- Layout drag handling ----
  const layoutRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, t: DiningTable) => {
    if (viewMode !== 'layout') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    draggingRef.current = { id: t.id, offX: e.clientX - rect.left, offY: e.clientY - rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d || !layoutRef.current) return;
    const box = layoutRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(box.width - 130, e.clientX - box.left - d.offX));
    const y = Math.max(0, Math.min(box.height - 130, e.clientY - box.top - d.offY));
    setTables(prev => prev.map(t => t.id === d.id ? { ...t, x, y } : t));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    const t = tables.find(x => x.id === d.id);
    if (t) saveTable(t);
    draggingRef.current = null;
  };

  // ---- Legend / stats ----
  const legend = Object.entries(statusConfig).map(([, cfg]) => (
    <span key={cfg.label} className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>{cfg.emoji}</span>{cfg.label}
    </span>
  ));

  // v1.12.2 — counters derived from live bills so the header never
  // disagrees with what the tables actually show.
  const runningCount = filteredTables.filter(t => !!getTableOrder(t)).length;
  const freeCount = filteredTables.length - runningCount;
  const pendingCount = filteredTables.filter(t => t.status === 'pending-payment').length;

  // ===== v1.12.2 — THE dialog-list bug =====
  // These two lists feed the Transfer / Split target picker and the Merge
  // destination picker. They filtered on `t.status`, the same derived
  // field that drifts after hold → recall, cross-device sync, or on older
  // rows saved before `status` existed. Result: the button appeared (fixed
  // in v1.9.1) and the handler worked (fixed in v1.12.1), but the dialog
  // opened EMPTY — "No other running tables" / no free tables to pick.
  // From the counter that looks exactly like the feature disappearing.
  //
  // Occupancy is now decided by whether a LIVE BILL exists on the table,
  // which is the actual truth. getTableOrder() also self-heals the stale
  // status as a side effect, so the rest of the UI catches up too.
  const freeTables = tables.filter(t => t.id !== selectedTable?.id && !getTableOrder(t));
  const runningTables = tables.filter(t => t.id !== selectedTable?.id && !!getTableOrder(t));

  // Auto-layout fallback positions in layout mode
  const layoutTables = useMemo(() => {
    return filteredTables.map((t, idx) => {
      if (typeof t.x === 'number' && typeof t.y === 'number') return t;
      const col = idx % 5, row = Math.floor(idx / 5);
      return { ...t, x: 20 + col * 150, y: 20 + row * 160 };
    });
  }, [filteredTables]);

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="bg-card rounded-2xl border shadow-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Utensils className="h-5 w-5 text-gold" /> Dining Tables
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">Real-time table occupancy, dine time & floor map</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 p-1 rounded-lg bg-muted">
              <button onClick={() => setViewMode('grid')} className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 ${viewMode === 'grid' ? 'bg-background shadow' : 'text-muted-foreground'}`}>
                <Grid3x3 className="h-3.5 w-3.5" /> Grid
              </button>
              <button onClick={() => setViewMode('layout')} className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1 ${viewMode === 'layout' ? 'bg-background shadow' : 'text-muted-foreground'}`}>
                <MapIcon className="h-3.5 w-3.5" /> Floor Map
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setBulkQrOpen(true)} className="gap-1">
              <QrCode className="h-3.5 w-3.5" /> All Table QRs
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPublicQrOpen('takeaway')} className="gap-1">
              <QrCode className="h-3.5 w-3.5" /> Takeaway QR
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPublicQrOpen('delivery')} className="gap-1">
              <QrCode className="h-3.5 w-3.5" /> Delivery QR
            </Button>
            <div className="px-3 py-1.5 rounded-lg bg-status-free/10 text-status-free text-xs font-bold">{freeCount} Available</div>
            <div className="px-3 py-1.5 rounded-lg bg-status-running/10 text-status-running text-xs font-bold">{runningCount} Running</div>
            {pendingCount > 0 && <div className="px-3 py-1.5 rounded-lg bg-status-pending-payment/10 text-status-pending-payment text-xs font-bold animate-pulse">{pendingCount} Pending</div>}
          </div>
        </div>

        {floors.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pb-3 border-b mb-3 overflow-x-auto">
            <button
              onClick={() => setActiveFloor('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-smooth ${activeFloor === 'all' ? 'bg-gradient-gold text-primary shadow-gold' : 'bg-muted hover:bg-muted/70 text-muted-foreground'}`}
            >All Floors</button>
            {floors.map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFloor(f.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-smooth ${activeFloor === f.id ? 'bg-gradient-gold text-primary shadow-gold' : 'bg-muted hover:bg-muted/70 text-muted-foreground'}`}
              >{f.name}</button>
            ))}
            {tables.some(t => !t.floorId) && (
              <button
                onClick={() => setActiveFloor('none')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-smooth ${activeFloor === 'none' ? 'bg-gradient-gold text-primary shadow-gold' : 'bg-muted hover:bg-muted/70 text-muted-foreground'}`}
              >Unassigned</button>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap">{legend}
          {viewMode === 'layout' && <span className="text-[10px] text-muted-foreground italic">💡 Drag tables to arrange your floor map — positions save automatically.</span>}
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filteredTables.map(t => {
            const order = getTableOrder(t);
            const cfg = statusConfig[t.status] || statusConfig.free;
            const seated = getSeatedTime(t);
            const lastSession = (t.sessions || [])[t.sessions ? t.sessions.length - 1 : -1];
            return (
              <button
                key={t.id}
                onClick={() => handleTableClick(t)}
                className={`group relative rounded-xl p-3 text-center border-2 transition-smooth hover:shadow-elegant hover:-translate-y-0.5 ${cfg.border} ${cfg.bg}`}
              >
                {t.status === 'running' && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-status-running animate-pulse" />}
                {t.status === 'pending-payment' && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-status-pending-payment animate-pulse" />}
                <button
                  type="button"
                  className="absolute top-1.5 left-1.5 p-1 rounded hover:bg-background/60"
                  onClick={(e) => { e.stopPropagation(); setHistoryTable(t); }}
                  title="View dine history"
                >
                  <History className="h-3 w-3 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-background/60"
                  onClick={(e) => { e.stopPropagation(); setQrTable(t); }}
                  title="Show QR code for this table"
                >
                  <QrCode className="h-3.5 w-3.5 text-status-info" />
                </button>
                <div className="flex justify-center mb-1">
                  <TableShapePreview shape={t.shape} seats={t.seats} status={t.status} size={100} />
                </div>
                <p className="font-bold text-sm tracking-tight">{t.name}</p>
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">
                    {t.status === 'running' && t.seatedGuests ? `${t.seatedGuests}/${t.seats} persons` : `${t.seats} chairs`} · {t.shape || 'square'}
                  </span>
                </div>
                {/* Chair dots: filled = occupied, empty = free */}
                <div className="flex items-center justify-center gap-0.5 mt-1 flex-wrap">
                  {Array.from({ length: t.seats }).map((_, i) => {
                    const filled = t.status === 'running' && i < (t.seatedGuests || t.seats);
                    return (
                      <span
                        key={i}
                        className={`inline-block h-1.5 w-1.5 rounded-full ${filled ? 'bg-status-running' : 'bg-muted-foreground/25'}`}
                      />
                    );
                  })}
                </div>
                <Badge className={`mt-1.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.badge}`}>
                  {cfg.badgeText}
                </Badge>
                {order && (
                  <p className="text-[10px] mt-1.5 font-semibold text-foreground">
                    #{order.orderNumber} · <span className="text-gold">PKR {order.grandTotal.toLocaleString()}</span>
                  </p>
                )}
                {seated && (
                  <div className="flex items-center justify-center gap-1 mt-1 text-[10px] text-status-running font-mono font-bold">
                    <Clock className="h-3 w-3" /> Sitting {seated}
                  </div>
                )}
                {!seated && lastSession && t.status === 'free' && (
                  <div className="text-[9px] mt-1 text-muted-foreground">
                    Last: {fmtDuration(lastSession.durationMinutes)} · freed {new Date(lastSession.freedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                  </div>
                )}
              </button>
            );
          })}
          {filteredTables.length === 0 && (
            <div className="col-span-full text-center text-sm text-muted-foreground py-8">
              No tables on this floor. Add tables from Settings → Tables.
            </div>
          )}
        </div>
      ) : (
        <div
          ref={layoutRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="relative bg-gradient-to-br from-muted/30 to-muted/10 border-2 border-dashed rounded-2xl overflow-hidden"
          style={{ minHeight: 600, backgroundImage: 'radial-gradient(circle, hsl(var(--muted-foreground)/0.15) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        >
          {layoutTables.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No tables on this floor.</div>
          )}
          {layoutTables.map(t => {
            const cfg = statusConfig[t.status] || statusConfig.free;
            const seated = getSeatedTime(t);
            return (
              <div
                key={t.id}
                onPointerDown={(e) => onPointerDown(e, t)}
                onDoubleClick={() => handleTableClick(t)}
                className={`absolute select-none cursor-move rounded-xl p-2 border-2 ${cfg.border} ${cfg.bg} shadow-md`}
                style={{ left: t.x, top: t.y, width: 130 }}
                title="Drag to move · Double-click to open"
              >
                <div className="flex justify-center"><TableShapePreview shape={t.shape} seats={t.seats} status={t.status} size={100} /></div>
                <div className="text-center font-bold text-xs mt-1">{t.name}</div>
                {seated && (
                  <div className="text-center text-[10px] font-mono text-status-running font-bold flex items-center justify-center gap-1">
                    <Clock className="h-3 w-3" />{seated}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Dine session history dialog */}
      <Dialog open={!!historyTable} onOpenChange={(o) => !o && setHistoryTable(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{historyTable?.name} — Dine History</DialogTitle></DialogHeader>
          {historyTable && (
            <div className="space-y-2 max-h-96 overflow-auto">
              {historyTable.seatedAt && (
                <div className="p-2 rounded border bg-status-running/10 border-status-running/30 text-xs">
                  <div className="font-bold">🟡 Currently sitting</div>
                  <div>Seated at: {new Date(historyTable.seatedAt).toLocaleString()}</div>
                  <div>Elapsed: <span className="font-mono">{getSeatedTime(historyTable)}</span></div>
                </div>
              )}
              {[...(historyTable.sessions || [])].reverse().map((s, i) => (
                <div key={i} className="p-2 rounded border text-xs">
                  <div className="flex justify-between"><span className="font-bold">Session #{(historyTable.sessions?.length || 0) - i}</span><span className="font-mono">{fmtDuration(s.durationMinutes)}</span></div>
                  <div className="text-muted-foreground">Seated: {new Date(s.seatedAt).toLocaleString()}</div>
                  <div className="text-muted-foreground">Freed: {new Date(s.freedAt).toLocaleString()}</div>
                  {s.orderNumber !== undefined && <div>Order #{s.orderNumber} {s.total ? `· PKR ${s.total.toLocaleString()}` : ''}</div>}
                </div>
              ))}
              {(!historyTable.sessions || historyTable.sessions.length === 0) && !historyTable.seatedAt && (
                <p className="text-xs text-center text-muted-foreground py-4">No sessions yet.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Table actions dialog */}
      <Dialog open={!!selectedTable && !billAction} onOpenChange={() => setSelectedTable(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{selectedTable?.name}</DialogTitle></DialogHeader>
          {selectedTable && (() => {
            const cfg = statusConfig[selectedTable.status] || statusConfig.free;
            const order = getTableOrder(selectedTable);
            const seated = getSeatedTime(selectedTable);
            return (
              <div className="space-y-3">
                <div className="flex justify-center"><TableShapePreview shape={selectedTable.shape} seats={selectedTable.seats} status={selectedTable.status} size={140} /></div>
                <p className="text-sm">Status: <Badge className={cfg.badge}>{cfg.badgeText}</Badge></p>
                <p className="text-sm">Chairs: {selectedTable.seats} · Shape: {selectedTable.shape || 'square'}</p>
                {seated && <p className="text-sm">⏱ Sitting since: <span className="font-mono font-bold">{seated}</span></p>}
                {order && (
                  <p className="text-sm">Order: <span className="font-bold">#{order.orderNumber}</span> · {order.items.length} item(s) · <span className="text-gold font-bold">PKR {order.grandTotal.toLocaleString()}</span></p>
                )}

                {/* v1.12.4 — explicit route to the POS. This used to happen
                    implicitly on tap, which is what hid the bill actions. */}
                {order && (
                  <Button
                    onClick={() => { setSelectedTable(null); navigate('/?retrieve=' + order.id); }}
                    className="w-full"
                  >
                    ✏️ Edit / Add Items
                  </Button>
                )}

                {/* v1.9.1 — gated on a LIVE ORDER, not on selectedTable.status.
                    The table's status is derived state that drifts (hold →
                    recall, cross-device sync, legacy rows with no status);
                    the order is the truth. If a bill exists on this table it
                    can be transferred, merged or split. */}
                {order && selectedTable.status !== 'pending-payment' && (
                  <>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                      <Button size="sm" variant="outline" onClick={() => setBillAction('transfer')} title="Move bill to another free table">
                        <ArrowRightLeft className="h-3.5 w-3.5 mr-1" /> Transfer
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setBillAction('merge')} title="Combine with another running table">
                        <Combine className="h-3.5 w-3.5 mr-1" /> Merge
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setSplitPicks({}); setBillAction('split'); }} title="Split items into a new bill">
                        <Split className="h-3.5 w-3.5 mr-1" /> Split
                      </Button>
                    </div>
                    {order.status === 'hold' && (
                      <p className="text-[11px] text-amber-700 font-semibold text-center">
                        ⏸ Ye bill HOLD par hai — bill actions phir bhi chalte hain
                      </p>
                    )}
                    <Button onClick={() => { markPendingPayment(selectedTable); setSelectedTable(null); }}
                      className="w-full bg-status-pending-payment text-status-pending-payment-foreground">
                      Mark Pending Payment
                    </Button>
                    <Button onClick={() => requestPayment(selectedTable)}
                      className="w-full bg-status-success text-status-success-foreground">
                      💳 Payment &amp; Free Table
                    </Button>
                  </>
                )}
                {selectedTable.status === 'pending-payment' && (
                  <>
                    <Button onClick={() => requestPayment(selectedTable)}
                      className="w-full bg-status-success text-status-success-foreground">
                      💳 Receive Payment — Free Table
                    </Button>
                    <Button onClick={() => { markClosed(selectedTable); setSelectedTable(null); }}
                      className="w-full bg-status-closed text-status-closed-foreground">
                      Close Table
                    </Button>
                  </>
                )}
                {selectedTable.status === 'closed' && (
                  <Button onClick={() => { reopenTable(selectedTable); setSelectedTable(null); }}
                    variant="outline" className="w-full">
                    Reopen Table
                  </Button>
                )}

                {/* ===== v1.15.1 — the seated-but-empty table =====
                    Client report: "I selected 1 table and hold it without
                    items. When I click it doesn't go to the sales screen or
                    allow me to cancel or close."

                    Seating a table sets status 'running' but creates NO
                    order — the bill only exists once an item is added. If
                    the cashier backs out of the POS the table sits in a
                    state that matched none of the branches above: the
                    order-gated block (Edit / Transfer / Pay) needs a bill,
                    'pending-payment' and 'closed' need those statuses, and
                    the seat picker needs 'free'. So the panel opened with
                    no buttons at all and the table could not be used or
                    released — it just kept counting dine time.

                    Two ways out, which is exactly what was asked for. */}
                {!order && (selectedTable.status === 'running' || selectedTable.status === 'pending-payment') && (
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-[11px] text-muted-foreground text-center">
                      No items on this table yet — the bill has not started.
                    </p>
                    <Button
                      className="w-full"
                      onClick={() => {
                        const g = selectedTable.seatedGuests || Math.min(selectedTable.seats, 2) || 1;
                        setSelectedTable(null);
                        navigate(`/?table=${encodeURIComponent(selectedTable.id)}&guests=${g}`);
                      }}
                    >
                      🛒 Open order screen / add items
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => { cancelEmptyTable(selectedTable); setSelectedTable(null); }}
                    >
                      ✖ Cancel — free the table
                    </Button>
                  </div>
                )}

                {selectedTable.status === 'free' && (() => {
                  const total = selectedTable.seats;
                  const g = Math.max(1, Math.min(total, seatPickerGuests || 1));
                  return (
                    <div className="space-y-3 pt-2 border-t">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                          Kitne persons baith rahe hain?
                        </div>
                        <div className="flex flex-wrap justify-center gap-1.5 mb-3">
                          {Array.from({ length: total }).map((_, i) => {
                            const n = i + 1;
                            const active = n <= g;
                            return (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setSeatPickerGuests(n)}
                                className={`w-9 h-9 rounded-full border-2 text-xs font-bold transition-all flex items-center justify-center ${active ? 'bg-status-running text-white border-status-running shadow-md scale-105' : 'bg-muted text-muted-foreground border-border hover:border-status-running'}`}
                                title={`Chair ${n}`}
                              >
                                {n}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setSeatPickerGuests(Math.max(1, g - 1))}>
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <div className="px-4 py-1.5 rounded-lg bg-muted font-bold text-lg min-w-[60px] text-center">
                            {g} <span className="text-xs font-normal text-muted-foreground">/ {total}</span>
                          </div>
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setSeatPickerGuests(Math.min(total, g + 1))}>
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <Button
                        onClick={() => seatAndStart(selectedTable, g)}
                        className="w-full bg-status-running text-white hover:bg-status-running/90 font-bold"
                      >
                        ✓ Seat {g} Guest{g > 1 ? 's' : ''} & Start Order
                      </Button>
                      <Button variant="outline" size="sm" className="w-full" onClick={() => { setQrTable(selectedTable); setSelectedTable(null); }}>
                        <QrCode className="h-3.5 w-3.5 mr-1" /> Show Table QR
                      </Button>
                    </div>
                  );
                })()}
                <Button variant="ghost" size="sm" className="w-full" onClick={() => { setHistoryTable(selectedTable); }}>
                  <History className="h-3.5 w-3.5 mr-1" /> View Dine History
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      {/* v1.3.3 — Payment screen for table settle (payment method + amount) */}
      {payTable && (
        <Suspense fallback={null}>
          <PaymentDialog
            open={!!payTable}
            items={getTableOrder(payTable)?.items}
            onClose={() => setPayTable(null)}
            grandTotal={Math.max(
              0,
              Number(getTableOrder(payTable)?.grandTotal || 0) - Number(getTableOrder(payTable)?.amountPaid || 0),
            )}
            customerPhone={getTableOrder(payTable)?.customer?.phone}
            onConfirm={(r) => {
              const t = payTable;
              setPayTable(null);
              if (t) { settleTable(t, r); setSelectedTable(null); }
            }}
          />
        </Suspense>
      )}

      <Dialog open={billAction === 'transfer'} onOpenChange={(o) => !o && setBillAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Transfer Bill from {selectedTable?.name}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Pick a free table to move this bill to:</p>
          <div className="grid grid-cols-3 gap-2 max-h-64 overflow-auto">
            {freeTables.length === 0 && <p className="col-span-full text-xs text-muted-foreground">No free tables.</p>}
            {freeTables.map(t => (
              <button key={t.id} onClick={() => selectedTable && transferBill(selectedTable, t)}
                className="p-3 rounded-lg border-2 border-status-free/30 hover:border-status-free bg-status-free/5 text-sm font-bold">
                {t.name}<div className="text-[10px] text-muted-foreground">{t.seats} seats</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={billAction === 'merge'} onOpenChange={(o) => !o && setBillAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Merge {selectedTable?.name} into…</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Pick the destination running table. Items will move there and this table will be freed.</p>
          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-auto">
            {runningTables.length === 0 && <p className="col-span-full text-xs text-muted-foreground">No other running tables.</p>}
            {runningTables.map(t => {
              // Use the same live-order resolution as the list itself, so the
              // preview never shows blank for a table we just decided is running.
              const o = getTableOrder(t);
              return (
                <button key={t.id} onClick={() => selectedTable && mergeBill(selectedTable, t)}
                  className="p-3 rounded-lg border-2 border-status-running/30 hover:border-status-running bg-status-running/5 text-sm font-bold text-left">
                  {t.name}
                  {o && <div className="text-[10px] text-muted-foreground font-normal">#{o.orderNumber} · PKR {o.grandTotal.toLocaleString()}</div>}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Split dialog */}
      <Dialog open={billAction === 'split'} onOpenChange={(o) => { if (!o) { setBillAction(null); setSplitPicks({}); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Split Bill — {selectedTable?.name}</DialogTitle></DialogHeader>
          {selectedTable && (() => {
            const order = getTableOrder(selectedTable);
            if (!order) return <p className="text-sm text-muted-foreground">No order.</p>;
            return (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Pick the items to move into a new bill on another table.</p>
                <div className="max-h-56 overflow-auto border rounded-lg divide-y">
                  {order.items.map(i => (
                    <label key={i.id} className="flex items-center gap-2 p-2.5 hover:bg-muted/30 cursor-pointer">
                      <Checkbox
                        checked={!!splitPicks[i.id]}
                        onCheckedChange={(v) => setSplitPicks(p => ({ ...p, [i.id]: !!v }))}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{i.name}</div>
                        <div className="text-[10px] text-muted-foreground">Qty {i.quantity} · PKR {i.lineTotal.toLocaleString()}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-xs font-semibold pt-2 border-t">Pick destination free table:</p>
                <div className="grid grid-cols-3 gap-2 max-h-40 overflow-auto">
                  {freeTables.length === 0 && <p className="col-span-full text-xs text-muted-foreground">No free tables.</p>}
                  {freeTables.map(t => (
                    <button key={t.id} onClick={() => splitBill(selectedTable, t)}
                      className="p-2 rounded-lg border-2 border-status-free/30 hover:border-status-free bg-status-free/5 text-xs font-bold">
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Single Table QR */}
      <Dialog open={!!qrTable} onOpenChange={(o) => !o && setQrTable(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4" /> {qrTable?.name} — QR Menu
            </DialogTitle>
          </DialogHeader>
          {qrTable && (
            <TableQR tableName={qrTable.name} floorName={floorNameOf(qrTable)} />
          )}
          <p className="text-[11px] text-muted-foreground text-center">
            Customer QR scan karega → menu khulega → khud order de sakta hai ya waiter bula sakta hai.
          </p>
        </DialogContent>
      </Dialog>

      {/* Takeaway / Delivery public QR */}
      <Dialog open={!!publicQrOpen} onOpenChange={(o) => !o && setPublicQrOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4" /> {publicQrOpen === 'takeaway' ? 'Takeaway / Self-Pickup' : 'Home Delivery'} QR
            </DialogTitle>
          </DialogHeader>
          {publicQrOpen && <PublicOrderQR mode={publicQrOpen} />}
          <p className="text-[11px] text-muted-foreground text-center">
            Customer scan karega → menu khulega → khud order karega → track bhi kar sakta hai.
          </p>
        </DialogContent>
      </Dialog>

      {/* Bulk: all table QRs */}
      <Dialog open={bulkQrOpen} onOpenChange={setBulkQrOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="h-4 w-4" /> All Table QR Codes
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-end gap-2 mb-3">
            <Button size="sm" onClick={async () => {
              const { buildTableOrderUrl } = await import('@/components/TableQR');
              const QRCodeLib = (await import('qrcode')).default;
              const items = await Promise.all(filteredTables.map(async t => ({
                name: t.name,
                floor: floorNameOf(t) || '',
                dataUrl: await QRCodeLib.toDataURL(buildTableOrderUrl(t.name, floorNameOf(t)), { width: 440, margin: 1 }),
              })));
              const w = window.open('', '_blank', 'width=900,height=700');
              if (!w) return;
              const cards = items.map(it => `<div class="card"><h2>📱 ${it.name}</h2><h3>${it.floor}</h3><img src="${it.dataUrl}"/><p>Scan to view menu &amp; order</p></div>`).join('');
              w.document.write(`<html><head><title>All Table QRs</title><style>
                body{font-family:system-ui,sans-serif;margin:0;padding:16px}
                .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
                .card{border:2px dashed #333;border-radius:12px;padding:16px;text-align:center;page-break-inside:avoid}
                h2{margin:0 0 4px;font-size:20px}h3{margin:0 0 8px;font-size:13px;color:#555;font-weight:normal}
                img{width:220px;height:220px}p{font-size:11px;color:#666;margin:6px 0 0}
                @media print{.card{break-inside:avoid}}
              </style></head><body><div class="grid">${cards}</div>
              <script>window.onload=()=>setTimeout(()=>window.print(),300);</script>
              </body></html>`);
              w.document.close();
            }}>
              <QrCode className="h-3.5 w-3.5 mr-1" /> Print All
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {filteredTables.map(t => (
              <div key={t.id} className="border rounded-lg p-3">
                <TableQR tableName={t.name} floorName={floorNameOf(t)} size={160} />
              </div>
            ))}
            {filteredTables.length === 0 && (
              <p className="col-span-full text-center text-sm text-muted-foreground py-8">No tables found.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {managerGateDialog}
    </div>
  );
}
