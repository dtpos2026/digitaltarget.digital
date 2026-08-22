// DT POS — Advanced Credit Customer & Pending Bills Management
// Aggregates all credit (udhaar) orders per customer, with profile, dashboard,
// ledger, reports, and one-click Print/PDF/Excel/WhatsApp sharing.
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Users, Phone, MapPin, Wallet, Printer, FileText, FileSpreadsheet, Search,
  TrendingUp, AlertTriangle, MessageCircle, History, Receipt, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getCreditOrders, getCreditPayments, getCreditOrderSummary,
  recordCreditPayment, getSettings, getUsers, onDataChange, refreshOrdersFromCloud,
} from '@/lib/store';
import { Order, PaymentMethod, CreditPayment } from '@/lib/types';
import ReceiptPreview from '@/components/ReceiptPreview';
import { openWhatsApp, normalizePhone } from '@/lib/whatsapp';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { ENABLE_REDUNDANT_ORDER_POLL } from '@/lib/featureFlags';

// ------------ Types ------------
interface CreditCustomer {
  id: string;             // phone digits (or name fallback)
  name: string;
  phone: string;
  address: string;
  orders: Order[];
  payments: CreditPayment[];
  totalOrders: number;
  paidOrders: number;
  pendingOrders: number;
  totalCredit: number;
  totalReceived: number;
  balance: number;
  lastOrderAt?: string;
  lastPaymentAt?: string;
}

type SortKey = 'balance' | 'recent' | 'name' | 'orders';
type FilterKey = 'all' | 'outstanding' | 'overdue' | 'paid';

// ------------ Aggregation ------------
function aggregate(orders: Order[], payments: CreditPayment[]): CreditCustomer[] {
  const groups = new Map<string, CreditCustomer>();
  for (const o of orders) {
    const phoneRaw = o.creditCustomerPhone || o.customer?.phone || '';
    const phoneDigits = (phoneRaw || '').replace(/\D/g, '');
    const name = o.creditCustomerName || o.customer?.name || 'Walk-in';
    const key = phoneDigits || `name:${name.toLowerCase()}`;
    let c = groups.get(key);
    if (!c) {
      c = {
        id: key, name, phone: phoneRaw,
        address: o.creditCustomerAddress || o.customer?.address || '',
        orders: [], payments: [],
        totalOrders: 0, paidOrders: 0, pendingOrders: 0,
        totalCredit: 0, totalReceived: 0, balance: 0,
      };
      groups.set(key, c);
    }
    if (!c.address && (o.creditCustomerAddress || o.customer?.address)) {
      c.address = o.creditCustomerAddress || o.customer?.address || '';
    }
    c.orders.push(o);
    const s = getCreditOrderSummary(o.id);
    c.totalOrders += 1;
    c.totalCredit += s.total;
    c.totalReceived += s.paid;
    c.balance += s.balance;
    if (s.status === 'paid') c.paidOrders += 1; else c.pendingOrders += 1;
    if (!c.lastOrderAt || new Date(o.createdAt).getTime() > new Date(c.lastOrderAt).getTime()) {
      c.lastOrderAt = o.createdAt;
    }
  }
  // attach payments + last payment date
  for (const p of payments) {
    const order = orders.find(o => o.id === p.orderId);
    if (!order) continue;
    const phoneDigits = ((order.creditCustomerPhone || order.customer?.phone || '')).replace(/\D/g, '');
    const name = order.creditCustomerName || order.customer?.name || 'Walk-in';
    const key = phoneDigits || `name:${name.toLowerCase()}`;
    const c = groups.get(key);
    if (!c) continue;
    c.payments.push(p);
    if (!c.lastPaymentAt || new Date(p.date).getTime() > new Date(c.lastPaymentAt).getTime()) {
      c.lastPaymentAt = p.date;
    }
  }
  return Array.from(groups.values());
}

function fmtPKR(n: number) { return 'PKR ' + Math.round(n || 0).toLocaleString(); }
function fmtDate(s?: string) { return s ? new Date(s).toLocaleString('en-PK') : '—'; }
function daysAgo(s?: string): number | null {
  if (!s) return null;
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
}

// ------------ Component ------------
export default function CreditCustomersPage() {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);
  const [filter, setFilter] = useState<FilterKey>('outstanding');
  const [sort, setSort] = useState<SortKey>('balance');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CreditCustomer | null>(null);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  const settings = getSettings();

  // Auto sync + refresh on data change
  useEffect(() => {
    let cancel = false;
    const pull = async () => { try { await refreshOrdersFromCloud(); } catch {} if (!cancel) refresh(); };
    pull();
    // onDataChange listener below is primary. Legacy 15s poll gated by flag (default off).
    const t: any = ENABLE_REDUNDANT_ORDER_POLL ? setInterval(pull, 15000) : null;
    const unsub = onDataChange((col) => {
      if (!cancel && (col === 'orders' || col === 'creditPayments')) refresh();
    });
    return () => { cancel = true; if (t) clearInterval(t); unsub(); };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const orders = useMemo(() => getCreditOrders(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const payments = useMemo(() => getCreditPayments(), [tick]);
  const customers = useMemo(() => aggregate(orders, payments), [orders, payments]);

  // keep selected fresh when underlying data refreshes
  useEffect(() => {
    if (!selected) return;
    const fresh = customers.find(c => c.id === selected.id);
    if (fresh) setSelected(fresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers]);

  const totals = useMemo(() => {
    return customers.reduce((acc, c) => ({
      customers: acc.customers + 1,
      pendingCustomers: acc.pendingCustomers + (c.balance > 0 ? 1 : 0),
      totalCredit: acc.totalCredit + c.totalCredit,
      totalReceived: acc.totalReceived + c.totalReceived,
      balance: acc.balance + c.balance,
    }), { customers: 0, pendingCustomers: 0, totalCredit: 0, totalReceived: 0, balance: 0 });
  }, [customers]);

  const filtered = useMemo(() => {
    let list = customers.slice();
    if (filter === 'outstanding') list = list.filter(c => c.balance > 0);
    else if (filter === 'paid') list = list.filter(c => c.balance <= 0);
    else if (filter === 'overdue') {
      list = list.filter(c => c.balance > 0 && (daysAgo(c.lastPaymentAt || c.lastOrderAt) ?? 0) > 30);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const d = q.replace(/\D/g, '');
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (d && (c.phone || '').replace(/\D/g, '').includes(d)) ||
        c.address.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sort === 'balance') return b.balance - a.balance;
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'orders') return b.totalOrders - a.totalOrders;
      return new Date(b.lastOrderAt || 0).getTime() - new Date(a.lastOrderAt || 0).getTime();
    });
    return list;
  }, [customers, filter, sort, search]);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-lg font-bold">Credit Customers</h2>
          <p className="text-xs text-muted-foreground">Customer-wise udhaar tracking, recovery & ledger</p>
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-9" onClick={() => exportCustomersExcel(customers)}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button size="sm" variant="outline" className="h-9" onClick={() => exportCustomersPDF(customers, settings)}>
            <FileText className="h-4 w-4 mr-1" /> PDF
          </Button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Customers" value={String(totals.customers)} accent="primary" />
        <KpiCard label="With Pending" value={String(totals.pendingCustomers)} accent="warning" />
        <KpiCard label="Total Credit" value={fmtPKR(totals.totalCredit)} accent="neutral" />
        <KpiCard label="Recovered" value={fmtPKR(totals.totalReceived)} accent="success" />
        <KpiCard label="Outstanding" value={fmtPKR(totals.balance)} accent="danger" />
      </div>

      {/* Filters */}
      <Card className="p-3 flex items-center gap-2 flex-wrap">
        {(['outstanding', 'overdue', 'all', 'paid'] as FilterKey[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wide transition ${
              filter === f ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >{f}</button>
        ))}
        <div className="h-6 w-px bg-border mx-1" />
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="balance">Sort: Highest Balance</SelectItem>
            <SelectItem value="recent">Sort: Most Recent</SelectItem>
            <SelectItem value="orders">Sort: Most Orders</SelectItem>
            <SelectItem value="name">Sort: Name (A-Z)</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search name, phone, address…" value={search}
                 onChange={e => setSearch(e.target.value)} className="pl-7 h-9 text-xs" />
        </div>
      </Card>

      {/* Customer cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground col-span-full">
            <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">No credit customers match this filter.</p>
            <p className="text-xs mt-1">Add new credit from the "Credit" button in the POS.</p>
          </Card>
        )}
        {filtered.map(c => {
          const overdue = c.balance > 0 && (daysAgo(c.lastPaymentAt || c.lastOrderAt) ?? 0) > 30;
          return (
            <Card
              key={c.id}
              className={`p-4 cursor-pointer hover:shadow-lg transition relative ${
                overdue ? 'border-destructive/40 bg-destructive/5' : c.balance > 0 ? 'border-amber-300 bg-amber-50/30' : ''
              }`}
              onClick={() => setSelected(c)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold truncate">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">
                    {c.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</div>}
                    {c.address && <div className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{c.address}</span></div>}
                  </div>
                </div>
                {overdue && (
                  <Badge variant="outline" className="text-[10px] bg-destructive/15 text-destructive border-destructive/40">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Overdue
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <Stat label="Orders" value={String(c.totalOrders)} />
                <Stat label="Pending" value={String(c.pendingOrders)} tone="warning" />
                <Stat label="Paid" value={String(c.paidOrders)} tone="success" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div><div className="text-muted-foreground">Credit</div><div className="font-bold">{fmtPKR(c.totalCredit)}</div></div>
                <div><div className="text-status-success">Received</div><div className="font-bold text-status-success">{fmtPKR(c.totalReceived)}</div></div>
                <div><div className="text-destructive">Balance</div><div className="font-extrabold text-destructive">{fmtPKR(c.balance)}</div></div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t text-[10px] text-muted-foreground">
                <span>Last order: {fmtDate(c.lastOrderAt).split(',')[0]}</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </Card>
          );
        })}
      </div>

      <CustomerDetailDialog
        customer={selected}
        onClose={() => setSelected(null)}
        onPrintOrder={setPrintOrder}
        onRefresh={refresh}
      />

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

// ------------ Detail Dialog ------------
function CustomerDetailDialog({
  customer, onClose, onPrintOrder, onRefresh,
}: {
  customer: CreditCustomer | null;
  onClose: () => void;
  onPrintOrder: (o: Order) => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<'dashboard' | 'pending' | 'history' | 'ledger'>('dashboard');
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payNote, setPayNote] = useState('');
  const settings = getSettings();

  if (!customer) return null;

  const pendingOrders = customer.orders
    .map(o => ({ order: o, sum: getCreditOrderSummary(o.id) }))
    .filter(x => x.sum.balance > 0)
    .sort((a, b) => new Date(b.order.createdAt).getTime() - new Date(a.order.createdAt).getTime());

  const allOrdersSorted = customer.orders.slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const paymentsSorted = customer.payments.slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const ledger = buildLedger(customer);

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
    if (amt > s.balance + 0.01) { toast.error(`Max: ${fmtPKR(s.balance)}`); return; }
    const currentUserId = localStorage.getItem('pos-user-id') || '';
    const userName = getUsers().find(u => u.id === currentUserId)?.name || '';
    recordCreditPayment(payOrder.id, amt, payMethod, payNote || undefined, userName);
    toast.success(`Payment received: ${fmtPKR(amt)}`);
    setPayOrder(null);
    onRefresh();
  };

  const shareWhatsApp = () => {
    if (!customer.phone) { toast.error('No phone number'); return; }
    const lines: string[] = [];
    lines.push(`*${settings.name || 'Restaurant'} — Account Statement*`);
    lines.push(`Customer: ${customer.name}`);
    if (customer.address) lines.push(`Address: ${customer.address}`);
    lines.push('');
    lines.push(`Total Orders: ${customer.totalOrders}`);
    lines.push(`Total Credit: ${fmtPKR(customer.totalCredit)}`);
    lines.push(`Received: ${fmtPKR(customer.totalReceived)}`);
    lines.push(`*Outstanding Balance: ${fmtPKR(customer.balance)}*`);
    if (pendingOrders.length) {
      lines.push('');
      lines.push('*Pending Bills:*');
      pendingOrders.slice(0, 10).forEach(({ order, sum }) => {
        lines.push(`#${order.orderNumber} — ${new Date(order.createdAt).toLocaleDateString('en-PK')} — Balance: ${fmtPKR(sum.balance)}`);
      });
    }
    lines.push('');
    lines.push('Please clear the payment at your earliest convenience. Thank you!');
    openWhatsApp(customer.phone, lines.join('\n'), customer.name);
  };

  return (
    <>
      <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <Users className="h-5 w-5 text-primary" />
              {customer.name}
              {customer.balance > 0 && (
                <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/40 text-[10px]">
                  Outstanding {fmtPKR(customer.balance)}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Profile bar */}
          <Card className="p-3 bg-muted/30">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
              <Field label="Customer ID" value={customer.id} mono />
              <Field label="Mobile" value={customer.phone || '—'} />
              <Field label="Address" value={customer.address || '—'} />
              <Field label="Last Order" value={fmtDate(customer.lastOrderAt)} />
            </div>
          </Card>

          {/* Quick actions */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" className="h-8" onClick={shareWhatsApp} disabled={!customer.phone}>
              <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp Statement
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => printLedger(customer, settings)}>
              <Printer className="h-4 w-4 mr-1" /> Print Ledger
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => exportCustomerPDF(customer, settings)}>
              <FileText className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => exportCustomerExcel(customer)}>
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b">
            {(['dashboard', 'pending', 'history', 'ledger'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs font-bold uppercase border-b-2 transition ${
                  tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >{t}</button>
            ))}
          </div>

          {/* Dashboard */}
          {tab === 'dashboard' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="Total Orders" value={String(customer.totalOrders)} accent="primary" />
              <KpiCard label="Paid Orders" value={String(customer.paidOrders)} accent="success" />
              <KpiCard label="Pending Orders" value={String(customer.pendingOrders)} accent="warning" />
              <KpiCard label="Last Payment" value={customer.lastPaymentAt ? fmtDate(customer.lastPaymentAt).split(',')[0] : '—'} accent="neutral" />
              <KpiCard label="Total Credit" value={fmtPKR(customer.totalCredit)} accent="neutral" />
              <KpiCard label="Total Received" value={fmtPKR(customer.totalReceived)} accent="success" />
              <KpiCard label="Remaining Balance" value={fmtPKR(customer.balance)} accent="danger" />
              <KpiCard label="Avg Order" value={fmtPKR(customer.totalOrders ? customer.totalCredit / customer.totalOrders : 0)} accent="primary" />
            </div>
          )}

          {/* Pending bills */}
          {tab === 'pending' && (
            <div className="space-y-2">
              {pendingOrders.length === 0 && <EmptyMini icon={Receipt} text="No pending bills" />}
              {pendingOrders.map(({ order, sum }) => (
                <Card key={order.id} className="p-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-sm">#{order.orderNumber}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{order.orderType || 'sale'}</Badge>
                      <Badge variant="outline" className={`text-[10px] ${
                        sum.status === 'partial' ? 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                        : 'bg-destructive/15 text-destructive border-destructive/40'
                      }`}>{sum.status}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      📅 {fmtDate(order.createdAt)} • 🍽 {order.items.length} items
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div><span className="text-muted-foreground">Total: </span><span className="font-bold">{fmtPKR(sum.total)}</span></div>
                    <div><span className="text-status-success">Paid: </span><span className="font-bold">{fmtPKR(sum.paid)}</span></div>
                    <div><span className="text-destructive">Due: </span><span className="font-extrabold">{fmtPKR(sum.balance)}</span></div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-8 bg-status-success text-status-success-foreground hover:bg-status-success/90"
                            onClick={() => openReceive(order)}>
                      <Wallet className="h-3.5 w-3.5 mr-1" /> Receive
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => onPrintOrder(order)}>
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Order history */}
          {tab === 'history' && (
            <div className="space-y-2">
              {allOrdersSorted.length === 0 && <EmptyMini icon={History} text="No orders yet" />}
              {allOrdersSorted.map(o => {
                const s = getCreditOrderSummary(o.id);
                return (
                  <Card key={o.id} className="p-3 flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm font-extrabold">#{o.orderNumber}
                        <Badge variant="outline" className="ml-2 text-[10px] capitalize">{o.orderType || 'sale'}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{fmtDate(o.createdAt)} • {o.items.length} items</div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-bold">{fmtPKR(s.total)}</div>
                      <Badge variant="outline" className={`text-[10px] ${
                        s.status === 'paid' ? 'bg-status-success/15 text-status-success border-status-success/30'
                        : s.status === 'partial' ? 'bg-amber-500/15 text-amber-700 border-amber-500/30'
                        : 'bg-destructive/15 text-destructive border-destructive/40'
                      }`}>{s.status}</Badge>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onPrintOrder(o)}>
                      <Printer className="h-3 w-3 mr-1" /> Reprint
                    </Button>
                  </Card>
                );
              })}
              <div className="border-t pt-3 mt-3">
                <div className="text-xs font-bold mb-2">Payment History ({paymentsSorted.length})</div>
                {paymentsSorted.length === 0 && <p className="text-xs text-muted-foreground">No payments received yet.</p>}
                {paymentsSorted.map(p => {
                  const ord = customer.orders.find(o => o.id === p.orderId);
                  return (
                    <div key={p.id} className="flex items-center justify-between border rounded-lg p-2 text-xs mt-1.5">
                      <div>
                        <span className="font-extrabold text-status-success">{fmtPKR(p.amount)}</span>
                        <span className="text-muted-foreground"> via {p.method}{p.receivedBy ? ` • ${p.receivedBy}` : ''}</span>
                        {ord && <span className="text-muted-foreground"> • Bill #{ord.orderNumber}</span>}
                        {p.note && <div className="italic text-[10px] mt-0.5">📝 {p.note}</div>}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{fmtDate(p.date)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Ledger */}
          {tab === 'ledger' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Particulars</th>
                    <th className="px-2 py-1.5 text-right">Debit</th>
                    <th className="px-2 py-1.5 text-right">Credit</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1.5">{new Date(r.date).toLocaleDateString('en-PK')}</td>
                      <td className="px-2 py-1.5">{r.particulars}</td>
                      <td className="px-2 py-1.5 text-right">{r.debit ? Math.round(r.debit).toLocaleString() : ''}</td>
                      <td className="px-2 py-1.5 text-right">{r.credit ? Math.round(r.credit).toLocaleString() : ''}</td>
                      <td className="px-2 py-1.5 text-right font-bold">{Math.round(r.balance).toLocaleString()}</td>
                    </tr>
                  ))}
                  {ledger.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No transactions</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50 border-t font-extrabold">
                    <td colSpan={2} className="px-2 py-2">Closing Balance</td>
                    <td></td><td></td>
                    <td className="px-2 py-2 text-right text-destructive">{fmtPKR(customer.balance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive Payment dialog */}
      <Dialog open={!!payOrder} onOpenChange={(o) => !o && setPayOrder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Receive Payment</DialogTitle></DialogHeader>
          {payOrder && (() => {
            const s = getCreditOrderSummary(payOrder.id);
            return (
              <div className="space-y-3">
                <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span>Order #</span><span className="font-bold">{payOrder.orderNumber}</span></div>
                  <div className="flex justify-between"><span>Customer</span><span className="font-bold">{customer.name}</span></div>
                  <div className="flex justify-between"><span>Total</span><span className="font-bold">{fmtPKR(s.total)}</span></div>
                  <div className="flex justify-between"><span>Paid</span><span className="font-bold text-status-success">{fmtPKR(s.paid)}</span></div>
                  <div className="flex justify-between border-t pt-1 mt-1"><span className="font-bold">Balance</span>
                    <span className="font-extrabold text-destructive">{fmtPKR(s.balance)}</span></div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Amount Received (PKR)</label>
                  <Input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus />
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
                <Button className="w-full" onClick={confirmReceive}>Confirm Receive</Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------ Helpers / sub-components ------------
function KpiCard({ label, value, accent }: { label: string; value: string; accent: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' }) {
  const cls =
    accent === 'success' ? 'bg-status-success/10 border-status-success/30 text-status-success' :
    accent === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-700' :
    accent === 'danger' ? 'bg-destructive/10 border-destructive/30 text-destructive' :
    accent === 'primary' ? 'bg-primary/10 border-primary/30 text-primary' :
    'bg-card border';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-lg font-extrabold mt-1 text-foreground">{value}</p>
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  const t = tone === 'success' ? 'text-status-success' : tone === 'warning' ? 'text-amber-600' : '';
  return (
    <div className="bg-muted/40 rounded-md py-1.5">
      <div className={`text-base font-extrabold ${t}`}>{value}</div>
      <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider">{label}</div>
    </div>
  );
}
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">{label}</div>
      <div className={`font-semibold truncate ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</div>
    </div>
  );
}
function EmptyMini({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="text-center py-8 text-muted-foreground">
      <Icon className="h-8 w-8 mx-auto mb-2 opacity-40" />
      <p className="text-xs">{text}</p>
    </div>
  );
}

// ------------ Ledger build ------------
interface LedgerRow { date: string; particulars: string; debit: number; credit: number; balance: number; }
function buildLedger(c: CreditCustomer): LedgerRow[] {
  const events: { date: string; debit: number; credit: number; particulars: string }[] = [];
  for (const o of c.orders) {
    events.push({
      date: o.createdAt, debit: getCreditOrderSummary(o.id).total, credit: 0,
      particulars: `Credit Sale — Bill #${o.orderNumber}`,
    });
  }
  for (const p of c.payments) {
    const ord = c.orders.find(o => o.id === p.orderId);
    events.push({
      date: p.date, debit: 0, credit: p.amount,
      particulars: `Payment Received${ord ? ` — Bill #${ord.orderNumber}` : ''} (${p.method})`,
    });
  }
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let bal = 0;
  return events.map(e => { bal += e.debit - e.credit; return { ...e, balance: bal }; });
}

// ------------ Exports ------------
function exportCustomersExcel(list: CreditCustomer[]) {
  const rows = list.map(c => ({
    Name: c.name, Phone: c.phone, Address: c.address,
    'Total Orders': c.totalOrders, 'Paid Orders': c.paidOrders, 'Pending Orders': c.pendingOrders,
    'Total Credit (PKR)': Math.round(c.totalCredit),
    'Received (PKR)': Math.round(c.totalReceived),
    'Balance (PKR)': Math.round(c.balance),
    'Last Order': c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleString('en-PK') : '',
    'Last Payment': c.lastPaymentAt ? new Date(c.lastPaymentAt).toLocaleString('en-PK') : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Credit Customers');
  XLSX.writeFile(wb, `credit-customers-${new Date().toISOString().split('T')[0]}.xlsx`);
  toast.success('Excel downloaded');
}

function exportCustomerExcel(c: CreditCustomer) {
  const wb = XLSX.utils.book_new();
  const summary = [{
    Name: c.name, Phone: c.phone, Address: c.address,
    'Total Orders': c.totalOrders, 'Paid': c.paidOrders, 'Pending': c.pendingOrders,
    'Total Credit': Math.round(c.totalCredit),
    'Received': Math.round(c.totalReceived),
    'Balance': Math.round(c.balance),
  }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
  const ledger = buildLedger(c).map(r => ({
    Date: new Date(r.date).toLocaleString('en-PK'),
    Particulars: r.particulars,
    Debit: Math.round(r.debit) || '',
    Credit: Math.round(r.credit) || '',
    Balance: Math.round(r.balance),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ledger), 'Ledger');
  XLSX.writeFile(wb, `ledger-${c.name.replace(/\s+/g, '-')}.xlsx`);
  toast.success('Excel downloaded');
}

function exportCustomersPDF(list: CreditCustomer[], settings: any) {
  const pdf = new jsPDF();
  pdf.setFontSize(14);
  pdf.text(`${settings.name || 'Restaurant'} — Credit Customers Report`, 14, 16);
  pdf.setFontSize(9);
  pdf.text(`Generated: ${new Date().toLocaleString('en-PK')}`, 14, 22);
  let y = 30;
  pdf.setFontSize(8);
  pdf.text('Name', 14, y); pdf.text('Phone', 60, y); pdf.text('Credit', 110, y);
  pdf.text('Received', 140, y); pdf.text('Balance', 175, y);
  y += 2; pdf.line(14, y, 200, y); y += 4;
  for (const c of list) {
    if (y > 280) { pdf.addPage(); y = 20; }
    pdf.text(c.name.slice(0, 26), 14, y);
    pdf.text(c.phone.slice(0, 18), 60, y);
    pdf.text(Math.round(c.totalCredit).toLocaleString(), 110, y);
    pdf.text(Math.round(c.totalReceived).toLocaleString(), 140, y);
    pdf.text(Math.round(c.balance).toLocaleString(), 175, y);
    y += 5;
  }
  pdf.save(`credit-customers-${new Date().toISOString().split('T')[0]}.pdf`);
  toast.success('PDF downloaded');
}

function exportCustomerPDF(c: CreditCustomer, settings: any) {
  const pdf = new jsPDF();
  pdf.setFontSize(14);
  pdf.text(`${settings.name || 'Restaurant'} — Customer Ledger`, 14, 16);
  pdf.setFontSize(10);
  pdf.text(`Name: ${c.name}`, 14, 26);
  pdf.text(`Phone: ${c.phone || '—'}`, 14, 32);
  pdf.text(`Address: ${c.address || '—'}`, 14, 38);
  pdf.text(`Outstanding Balance: PKR ${Math.round(c.balance).toLocaleString()}`, 14, 46);
  let y = 56;
  pdf.setFontSize(8);
  pdf.text('Date', 14, y); pdf.text('Particulars', 50, y);
  pdf.text('Debit', 130, y); pdf.text('Credit', 155, y); pdf.text('Balance', 180, y);
  y += 2; pdf.line(14, y, 200, y); y += 4;
  for (const r of buildLedger(c)) {
    if (y > 280) { pdf.addPage(); y = 20; }
    pdf.text(new Date(r.date).toLocaleDateString('en-PK'), 14, y);
    pdf.text(r.particulars.slice(0, 42), 50, y);
    pdf.text(r.debit ? Math.round(r.debit).toLocaleString() : '', 130, y);
    pdf.text(r.credit ? Math.round(r.credit).toLocaleString() : '', 155, y);
    pdf.text(Math.round(r.balance).toLocaleString(), 180, y);
    y += 5;
  }
  pdf.save(`ledger-${c.name.replace(/\s+/g, '-')}.pdf`);
  toast.success('PDF downloaded');
}

function printLedger(c: CreditCustomer, settings: any) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) { toast.error('Popup blocked'); return; }
  const rows = buildLedger(c);
  w.document.write(`
    <html><head><title>Ledger - ${c.name}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:20px;color:#111}
      h1{margin:0 0 4px 0;font-size:18px}
      .meta{font-size:11px;color:#555;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
      th{background:#f3f3f3}
      td.r,th.r{text-align:right}
      tfoot td{font-weight:bold;background:#fafafa}
    </style></head><body>
    <h1>${settings.name || 'Restaurant'} — Customer Ledger</h1>
    <div class="meta">
      <b>Name:</b> ${escapeHtml(c.name)} &nbsp;
      <b>Phone:</b> ${escapeHtml(c.phone || '—')} &nbsp;
      <b>Address:</b> ${escapeHtml(c.address || '—')}<br/>
      Generated: ${new Date().toLocaleString('en-PK')}
    </div>
    <table>
      <thead><tr><th>Date</th><th>Particulars</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${new Date(r.date).toLocaleDateString('en-PK')}</td>
          <td>${escapeHtml(r.particulars)}</td>
          <td class="r">${r.debit ? Math.round(r.debit).toLocaleString() : ''}</td>
          <td class="r">${r.credit ? Math.round(r.credit).toLocaleString() : ''}</td>
          <td class="r">${Math.round(r.balance).toLocaleString()}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4">Closing Balance</td><td class="r">PKR ${Math.round(c.balance).toLocaleString()}</td></tr></tfoot>
    </table>
    <script>window.print();</script>
    </body></html>
  `);
  w.document.close();
}

function escapeHtml(s: string) {
  return (s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}
