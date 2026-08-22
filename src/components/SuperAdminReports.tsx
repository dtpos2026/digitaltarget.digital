// Super Admin → Business Reports & Ledger (Digital Target ERP-style)
// 5 sub-tabs: Earnings | Ledger | Revenue | Collection | Aging
import { useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, DollarSign, AlertTriangle, Users, BookOpen, Calendar,
  Wallet, FileText, Download, Printer, Award, Clock, Receipt,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PLAN_OPTIONS, getPlan } from '@/lib/plans';
import { formatRs, tsToDate, daysUntil, isExpired } from '@/lib/billing';
import { waLink, fetchTenantPhone } from '@/lib/support';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface ClientLite {
  tenantId: string;
  name: string;
  email?: string;
  plan?: string;
  planExpiryAt?: any;
}
interface InvRow {
  tenantId: string;
  id: string;
  number: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  total: number;
  paidAmount: number;
  planId: string;
  months: number;
  status: string;
}
interface PayRow {
  tenantId: string;
  id: string;
  paidAt: Date | null;
  amount: number;
  method: string;
  months: number;
  invoiceNumber?: string;
}

interface Props { clients: ClientLite[]; }

type SubTab = 'earnings' | 'ledger' | 'revenue' | 'collection' | 'aging';

export default function SuperAdminReports({ clients: clientsProp }: Props) {
  const [sub, setSub] = useState<SubTab>('earnings');
  const [invoices, setInvoices] = useState<InvRow[]>([]);
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Merge orphan tenants (have invoices/payments but not in approved clients list)
  const clients = useMemo<ClientLite[]>(() => {
    const map = new Map<string, ClientLite>();
    clientsProp.forEach(c => map.set(c.tenantId, c));
    invoices.forEach(i => {
      if (!map.has(i.tenantId)) {
        map.set(i.tenantId, { tenantId: i.tenantId, name: `(Unlinked) ${i.tenantId.slice(0, 8)}…`, plan: i.planId });
      }
    });
    payments.forEach(p => {
      if (!map.has(p.tenantId)) {
        map.set(p.tenantId, { tenantId: p.tenantId, name: `(Unlinked) ${p.tenantId.slice(0, 8)}…` });
      }
    });
    return Array.from(map.values());
  }, [clientsProp, invoices, payments]);



  // v1.26 — the ledger reads the SAME Supabase tables the Clients → Billing
  // dialog writes to (admin_invoices / admin_payments). It used to read
  // Firestore collection groups, which no longer exist: every invoice and
  // payment recorded on a client showed up as Rs 0 here.
  const load = async () => {
    setLoading(true);
    try {
      const { listInvoices, listPayments } = await import('@/lib/superAdminSupabase');
      const [invRows, payRows] = await Promise.all([listInvoices(), listPayments()]);

      const inv: InvRow[] = (invRows ?? []).map((r: any) => {
        const li = r.line_items?.[0] ?? {};
        return {
          tenantId: r.tenant_id || '', id: r.id,
          number: r.number || r.id,
          issuedAt: tsToDate(r.issued_at),
          dueAt: tsToDate(r.due_at),
          paidAt: Number(r.paid_total || 0) > 0 ? tsToDate(r.issued_at) : null,
          total: Number(r.total || 0),
          paidAmount: Number(r.paid_total || 0),
          planId: li.planId || 'trial',
          months: Number(li.months || 1),
          status: r.status || 'unpaid',
        };
      });
      inv.sort((a, b) => (b.issuedAt?.getTime() || 0) - (a.issuedAt?.getTime() || 0));

      const numById = new Map(inv.map(i => [i.id, i.number]));
      const monthsById = new Map(inv.map(i => [i.id, i.months]));
      const pay: PayRow[] = (payRows ?? []).map((r: any) => ({
        tenantId: r.tenant_id || '', id: r.id,
        paidAt: tsToDate(r.received_at),
        amount: Number(r.amount || 0),
        method: r.method || 'cash',
        months: r.invoice_id ? (monthsById.get(r.invoice_id) || 0) : 0,
        invoiceNumber: r.invoice_id ? numById.get(r.invoice_id) : undefined,
      }));
      pay.sort((a, b) => (b.paidAt?.getTime() || 0) - (a.paidAt?.getTime() || 0));

      setInvoices(inv);
      setPayments(pay);
      console.log(`[reports] loaded ${inv.length} invoices, ${pay.length} payments`);
    } catch (e) { console.error('[reports] load failed', e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);


  const tabs: { id: SubTab; label: string; icon: any }[] = [
    { id: 'earnings', label: 'Earnings', icon: TrendingUp },
    { id: 'ledger', label: 'Client Ledger', icon: BookOpen },
    { id: 'revenue', label: 'Revenue (MRR/ARR)', icon: Award },
    { id: 'collection', label: 'Collection', icon: Wallet },
    { id: 'aging', label: 'Aging / Overdue', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex p-1 bg-muted/60 rounded-lg border flex-wrap">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setSub(t.id)}
              className={`px-3 py-1.5 text-xs font-bold uppercase rounded-md flex items-center gap-1.5 transition ${
                sub === t.id ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {invoices.length} invoices · {payments.length} payments
        </span>
      </div>


      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-12">Loading reports…</div>
      ) : sub === 'earnings' ? <Earnings clients={clients} invoices={invoices} payments={payments} />
        : sub === 'ledger' ? <Ledger clients={clients} invoices={invoices} payments={payments} />
        : sub === 'revenue' ? <RevenueReports clients={clients} payments={payments} />
        : sub === 'collection' ? <CollectionReport payments={payments} clients={clients} />
        : <AgingReport clients={clients} invoices={invoices} payments={payments} />}
    </div>
  );
}

// ============ EARNINGS ============
function Earnings({ clients, invoices, payments }: { clients: ClientLite[]; invoices: InvRow[]; payments: PayRow[] }) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const startYear = new Date(now.getFullYear(), 0, 1).getTime();

  const sumIn = (from: number) => payments.filter(p => (p.paidAt?.getTime() || 0) >= from).reduce((s, p) => s + p.amount, 0);
  const today = sumIn(startToday);
  const month = sumIn(startMonth);
  const year = sumIn(startYear);
  const all = payments.reduce((s, p) => s + p.amount, 0);

  // Pending dues
  const dues = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
    .reduce((s, i) => s + i.total, 0);
  const expiredLoss = clients.filter(c => isExpired(c.planExpiryAt)).length;

  // Plan-wise revenue
  const byPlan = new Map<string, number>();
  payments.forEach(p => {
    const inv = invoices.find(i => i.tenantId === p.tenantId && i.number === p.invoiceNumber);
    const plan = inv?.planId || clients.find(c => c.tenantId === p.tenantId)?.plan || 'trial';
    byPlan.set(plan, (byPlan.get(plan) || 0) + p.amount);
  });
  const planData = Array.from(byPlan.entries()).map(([planId, value]) => ({
    name: getPlan(planId).name, value,
  }));

  // Last 12 months bar
  const monthly: { month: string; revenue: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const total = payments.filter(p => {
      const t = p.paidAt?.getTime() || 0;
      return t >= d.getTime() && t < next.getTime();
    }).reduce((s, p) => s + p.amount, 0);
    monthly.push({ month: d.toLocaleString('en', { month: 'short' }), revenue: Math.round(total) });
  }

  const COLORS = ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];

  return (
    <div className="space-y-3">
      {payments.length === 0 && invoices.length === 0 && (
        <div className="border-2 border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-xl p-4 text-sm">
          <div className="font-bold text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Why is the earnings section empty?
          </div>
          <p className="text-xs text-amber-900/80 dark:text-amber-100/80 mt-1.5 leading-relaxed">
            This section <b>only shows money you record under Clients → 💰 Billing</b> (Invoice + Payment).
            Agar aap ne software sell kiya hai magar yahan Rs 0 dikha raha hai, iska matlab us sale ka Invoice/Payment Firestore me save nahi howa.
            <br/><br/>
            <b>How to fix it:</b> go to the <b>Clients</b> tab above → press that restaurant’s <b>💰 Billing</b> button → <b>"Generate Invoice"</b> → phir <b>"Record Payment"</b>.
            As soon as a payment is saved, Earnings, Ledger, Revenue and Collection all update by themselves.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi label="Today" value={formatRs(today)} icon={<Calendar className="h-4 w-4" />} tone="violet" />
        <Kpi label="This Month" value={formatRs(month)} icon={<TrendingUp className="h-4 w-4" />} tone="green" />
        <Kpi label="This Year" value={formatRs(year)} icon={<DollarSign className="h-4 w-4" />} tone="primary" />
        <Kpi label="Pending Dues" value={formatRs(dues)} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
        <Kpi label="Expired Clients" value={String(expiredLoss)} icon={<Users className="h-4 w-4" />} tone="red" />
      </div>


      <div className="grid lg:grid-cols-2 gap-3">
        <Card title="Monthly Revenue (Last 12 Months)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: any) => formatRs(v)} />
              <Bar dataKey="revenue" fill="#7c3aed" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Plan-wise Revenue">
          {planData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={planData} dataKey="value" nameKey="name" outerRadius={80} label={(e: any) => e.name}>
                  {planData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatRs(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="Lifetime Collection">
        <div className="text-3xl font-extrabold text-violet-600">{formatRs(all)}</div>
        <div className="text-xs text-muted-foreground mt-1">Total {payments.length} payments across {new Set(payments.map(p => p.tenantId)).size} restaurants</div>
      </Card>
    </div>
  );
}

// ============ CLIENT LEDGER ============
function Ledger({ clients, invoices, payments }: { clients: ClientLite[]; invoices: InvRow[]; payments: PayRow[] }) {
  const [selected, setSelected] = useState<string | null>(clients[0]?.tenantId || null);
  const [filter, setFilter] = useState<'all' | 'paid' | 'unpaid' | 'overdue'>('all');

  const client = clients.find(c => c.tenantId === selected);
  const myInv = invoices.filter(i => i.tenantId === selected);
  const myPay = payments.filter(p => p.tenantId === selected);

  // Build ledger entries (sorted by date, running balance)
  type Entry = { date: Date | null; type: 'invoice' | 'payment'; ref: string; debit: number; credit: number; balance: number; status?: string };
  const merged: Entry[] = [
    ...myInv.map(i => ({ date: i.issuedAt, type: 'invoice' as const, ref: i.number, debit: i.total, credit: 0, balance: 0, status: i.status })),
    ...myPay.map(p => ({ date: p.paidAt, type: 'payment' as const, ref: p.invoiceNumber || `${p.method.toUpperCase()} payment`, debit: 0, credit: p.amount, balance: 0 })),
  ].sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));

  let bal = 0;
  merged.forEach(e => { bal += e.debit - e.credit; e.balance = bal; });

  const filtered = merged.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'paid') return e.type === 'invoice' && e.status === 'paid';
    if (filter === 'unpaid') return e.type === 'invoice' && e.status !== 'paid';
    if (filter === 'overdue') {
      if (e.type !== 'invoice' || e.status === 'paid') return false;
      const inv = myInv.find(i => i.number === e.ref);
      return inv?.dueAt ? inv.dueAt.getTime() < Date.now() : false;
    }
    return true;
  });

  const totalBilled = myInv.reduce((s, i) => s + i.total, 0);
  const totalPaid = myPay.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, totalBilled - totalPaid);

  const printLedger = async () => {
    if (!client) return;
    try {
      const jsPDF = (await import('jspdf')).default;
      const { drawPdfHeader, drawPdfFooter } = await import('@/lib/pdfBrand');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      let y = await drawPdfHeader(pdf, {
        title: 'CLIENT LEDGER',
        subtitle: `${client.name}${client.email ? ' · ' + client.email : ''}`,
      });

      pdf.setFontSize(9);
      pdf.setTextColor(60, 60, 60);
      pdf.text(`Plan: ${getPlan(client.plan).name}    Generated: ${new Date().toLocaleString()}`, 15, y);
      y += 6;

      // Summary box
      pdf.setFillColor(245, 243, 255);
      pdf.rect(15, y, 180, 16, 'F');
      pdf.setFontSize(9);
      pdf.setTextColor(80, 80, 80);
      pdf.text('Total Billed', 22, y + 5);
      pdf.text('Total Paid', 82, y + 5);
      pdf.text('Outstanding', 142, y + 5);
      pdf.setFontSize(12);
      pdf.setTextColor(30, 30, 30);
      pdf.setFont(undefined as any, 'bold');
      pdf.text(formatRs(totalBilled), 22, y + 12);
      pdf.setTextColor(22, 163, 74);
      pdf.text(formatRs(totalPaid), 82, y + 12);
      pdf.setTextColor(outstanding > 0 ? 220 : 22, outstanding > 0 ? 38 : 163, outstanding > 0 ? 38 : 74);
      pdf.text(formatRs(outstanding), 142, y + 12);
      pdf.setFont(undefined as any, 'normal');
      pdf.setTextColor(0, 0, 0);
      y += 22;

      // Table header
      pdf.setFillColor(60, 9, 108);
      pdf.rect(15, y, 180, 7, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(8);
      pdf.setFont(undefined as any, 'bold');
      pdf.text('DATE', 17, y + 5);
      pdf.text('TYPE', 42, y + 5);
      pdf.text('REFERENCE', 62, y + 5);
      pdf.text('DEBIT', 122, y + 5, { align: 'right' });
      pdf.text('CREDIT', 152, y + 5, { align: 'right' });
      pdf.text('BALANCE', 192, y + 5, { align: 'right' });
      y += 7;
      pdf.setFont(undefined as any, 'normal');
      pdf.setTextColor(0, 0, 0);

      if (filtered.length === 0) {
        pdf.setFontSize(10);
        pdf.setTextColor(120, 120, 120);
        pdf.text('No ledger entries for selected filter.', 105, y + 10, { align: 'center' });
        y += 20;
      } else {
        filtered.forEach((e, idx) => {
          if (y > 270) { pdf.addPage(); y = 20; }
          if (idx % 2 === 0) {
            pdf.setFillColor(248, 248, 250);
            pdf.rect(15, y, 180, 6, 'F');
          }
          pdf.setFontSize(8);
          pdf.setTextColor(40, 40, 40);
          pdf.text(e.date?.toLocaleDateString() || '—', 17, y + 4);
          pdf.text(e.type.toUpperCase(), 42, y + 4);
          pdf.text(String(e.ref).slice(0, 32), 62, y + 4);
          pdf.text(e.debit ? formatRs(e.debit) : '—', 122, y + 4, { align: 'right' });
          pdf.setTextColor(22, 163, 74);
          pdf.text(e.credit ? formatRs(e.credit) : '—', 152, y + 4, { align: 'right' });
          pdf.setTextColor(e.balance > 0 ? 220 : 22, e.balance > 0 ? 38 : 163, e.balance > 0 ? 38 : 74);
          pdf.setFont(undefined as any, 'bold');
          pdf.text(formatRs(e.balance), 192, y + 4, { align: 'right' });
          pdf.setFont(undefined as any, 'normal');
          pdf.setTextColor(0, 0, 0);
          y += 6;
        });
      }

      drawPdfFooter(pdf);
      const safe = (client.name || 'client').replace(/[^a-z0-9]/gi, '_');
      pdf.save(`ledger-${safe}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e: any) {
      console.error('ledger pdf', e);
      alert(`PDF generation failed: ${e?.message || e}`);
    }
  };

  const exportCsv = () => {
    const rows = [['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Balance', 'Status']];
    filtered.forEach(e => rows.push([
      e.date?.toLocaleDateString() || '', e.type, e.ref,
      String(e.debit), String(e.credit), String(e.balance), e.status || '',
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ledger-${client?.name || selected}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-3">
      {/* Client list */}
      <div className="border rounded-xl bg-card overflow-hidden flex flex-col max-h-[600px]">
        <div className="p-2 border-b bg-muted/40 text-[10px] uppercase font-bold text-muted-foreground">
          Clients ({clients.length})
        </div>
        <div className="overflow-y-auto flex-1">
          {clients.map(c => {
            const cBilled = invoices.filter(i => i.tenantId === c.tenantId).reduce((s, i) => s + i.total, 0);
            const cPaid = payments.filter(p => p.tenantId === c.tenantId).reduce((s, p) => s + p.amount, 0);
            const cOut = Math.max(0, cBilled - cPaid);
            const active = selected === c.tenantId;
            return (
              <button key={c.tenantId} onClick={() => setSelected(c.tenantId)}
                className={`w-full text-left px-3 py-2 border-b text-xs hover:bg-muted/40 ${active ? 'bg-violet-500/10 border-l-4 border-l-violet-600' : ''}`}>
                <div className="font-bold truncate">{c.name}</div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>Billed: {formatRs(cBilled)}</span>
                  <span className={cOut > 0 ? 'text-red-600 font-bold' : 'text-green-600'}>{formatRs(cOut)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ledger */}
      <div className="border rounded-xl bg-card overflow-hidden" id="ledger-print-area">
        {!client ? <Empty /> : (
          <>
            <div className="p-3 border-b flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="font-extrabold text-base">{client.name}</div>
                <div className="text-[11px] text-muted-foreground">{client.email} · {getPlan(client.plan).name} Plan</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3 w-3 mr-1" /> CSV</Button>
                <Button size="sm" variant="outline" onClick={printLedger}><Printer className="h-3 w-3 mr-1" /> PDF</Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 p-3 bg-muted/30 text-xs">
              <Stat label="Total Billed" value={formatRs(totalBilled)} />
              <Stat label="Total Paid" value={formatRs(totalPaid)} tone="green" />
              <Stat label="Outstanding" value={formatRs(outstanding)} tone={outstanding > 0 ? 'red' : 'green'} />
            </div>
            <div className="p-2 border-b flex gap-1">
              {(['all', 'paid', 'unpaid', 'overdue'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${filter === f ? 'bg-violet-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[10px] uppercase">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Ref</th>
                    <th className="text-right p-2">Debit</th>
                    <th className="text-right p-2">Credit</th>
                    <th className="text-right p-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-muted-foreground py-6">No entries</td></tr>
                  )}
                  {filtered.map((e, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="p-2 text-[11px]">{e.date?.toLocaleDateString() || '—'}</td>
                      <td className="p-2">
                        <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                          e.type === 'invoice' ? 'bg-blue-500/15 text-blue-700' : 'bg-green-500/15 text-green-700'
                        }`}>{e.type}</span>
                      </td>
                      <td className="p-2 font-mono text-[11px]">{e.ref}</td>
                      <td className="p-2 text-right">{e.debit ? formatRs(e.debit) : '—'}</td>
                      <td className="p-2 text-right text-green-700">{e.credit ? formatRs(e.credit) : '—'}</td>
                      <td className={`p-2 text-right font-bold ${e.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatRs(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============ REVENUE REPORTS (MRR/ARR) ============
function RevenueReports({ clients, payments }: { clients: ClientLite[]; payments: PayRow[] }) {
  const activeClients = clients.filter(c => !isExpired(c.planExpiryAt));
  const expiredClients = clients.filter(c => isExpired(c.planExpiryAt));

  // MRR sirf un active clients ka count hota hai jin ki at least 1 real payment record ho.
  // Agar koi payment/invoice nahi bani to MRR/ARR = 0 (demo values nahi dikhana).
  const paidTenantIds = new Set(payments.map(p => p.tenantId));
  const billableClients = activeClients.filter(c => paidTenantIds.has(c.tenantId));
  const mrr = billableClients.reduce((s, c) => s + getPlan(c.plan).monthlyPriceRs, 0);
  const arr = mrr * 12;
  const churnRate = clients.length > 0 ? (expiredClients.length / clients.length) * 100 : 0;

  // Top paying clients
  const byClient = new Map<string, number>();
  payments.forEach(p => byClient.set(p.tenantId, (byClient.get(p.tenantId) || 0) + p.amount));
  const top = Array.from(byClient.entries())
    .map(([tid, total]) => ({ client: clients.find(c => c.tenantId === tid), total }))
    .filter(x => x.client)
    .sort((a, b) => b.total - a.total).slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="MRR" value={formatRs(mrr)} icon={<TrendingUp className="h-4 w-4" />} tone="violet" sub="Monthly recurring" />
        <Kpi label="ARR" value={formatRs(arr)} icon={<Award className="h-4 w-4" />} tone="green" sub="Annual recurring" />
        <Kpi label="Active Clients" value={String(activeClients.length)} icon={<Users className="h-4 w-4" />} tone="primary" />
        <Kpi label="Churn Rate" value={churnRate.toFixed(1) + '%'} icon={<AlertTriangle className="h-4 w-4" />} tone={churnRate > 20 ? 'red' : 'amber'} sub={`${expiredClients.length} expired`} />
      </div>

      <Card title="🏆 Top Paying Clients">
        {top.length === 0 ? <Empty /> : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b">
              <tr><th className="text-left py-1.5">#</th><th className="text-left">Client</th><th className="text-left">Plan</th><th className="text-right">Lifetime Paid</th></tr>
            </thead>
            <tbody>
              {top.map((t, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 font-bold">{i + 1}</td>
                  <td className="py-2">
                    <div className="font-bold">{t.client!.name}</div>
                    <div className="text-[10px] text-muted-foreground">{t.client!.email}</div>
                  </td>
                  <td className="py-2"><span className="text-[9px] uppercase font-bold bg-violet-500/15 text-violet-700 px-1.5 py-0.5 rounded">{getPlan(t.client!.plan).name}</span></td>
                  <td className="py-2 text-right font-extrabold text-violet-600">{formatRs(t.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ============ COLLECTION REPORT ============
function CollectionReport({ payments, clients }: { payments: PayRow[]; clients: ClientLite[] }) {
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const fromMs = new Date(from + 'T00:00:00').getTime();
  const toMs = new Date(to + 'T23:59:59').getTime();
  const range = payments.filter(p => {
    const t = p.paidAt?.getTime() || 0;
    return t >= fromMs && t <= toMs;
  });

  const total = range.reduce((s, p) => s + p.amount, 0);
  const byMethod = new Map<string, { count: number; sum: number }>();
  range.forEach(p => {
    const cur = byMethod.get(p.method) || { count: 0, sum: 0 };
    cur.count++; cur.sum += p.amount;
    byMethod.set(p.method, cur);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center bg-muted/40 border rounded-lg p-3">
        <span className="text-[10px] uppercase font-bold text-muted-foreground">Date Range:</span>
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-40 text-xs" />
        <span className="text-xs">to</span>
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-40 text-xs" />
        <span className="ml-auto text-xs">Total: <strong className="text-violet-600 text-base">{formatRs(total)}</strong> · {range.length} payments</span>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <Card title="Collection by Payment Method">
          {byMethod.size === 0 ? <Empty /> : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b"><tr><th className="text-left py-1">Method</th><th className="text-right">Count</th><th className="text-right">Amount</th><th className="text-right">%</th></tr></thead>
              <tbody>
                {Array.from(byMethod.entries()).sort((a, b) => b[1].sum - a[1].sum).map(([m, v]) => (
                  <tr key={m} className="border-b">
                    <td className="py-1.5 uppercase font-bold">{m}</td>
                    <td className="text-right">{v.count}</td>
                    <td className="text-right font-bold">{formatRs(v.sum)}</td>
                    <td className="text-right text-muted-foreground">{((v.sum / total) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="All Receipts">
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground border-b sticky top-0 bg-card"><tr><th className="text-left py-1">Date</th><th className="text-left">Client</th><th className="text-left">Method</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {range.length === 0 && <tr><td colSpan={4} className="text-center text-muted-foreground py-4">No payments in range</td></tr>}
                {range.map(p => {
                  const c = clients.find(x => x.tenantId === p.tenantId);
                  return (
                    <tr key={p.id} className="border-b">
                      <td className="py-1.5 text-[11px]">{p.paidAt?.toLocaleDateString()}</td>
                      <td className="py-1.5 truncate max-w-[120px]">{c?.name || p.tenantId.slice(0, 8)}</td>
                      <td className="py-1.5 text-[10px] uppercase">{p.method}</td>
                      <td className="py-1.5 text-right font-bold">{formatRs(p.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============ AGING REPORT ============
function AgingReport({ clients, invoices, payments }: { clients: ClientLite[]; invoices: InvRow[]; payments: PayRow[] }) {
  // For each client compute outstanding & oldest unpaid invoice age
  const rows = clients.map(c => {
    const cInv = invoices.filter(i => i.tenantId === c.tenantId);
    const cPay = payments.filter(p => p.tenantId === c.tenantId);
    const billed = cInv.reduce((s, i) => s + i.total, 0);
    const paid = cPay.reduce((s, p) => s + p.amount, 0);
    const out = Math.max(0, billed - paid);
    const oldestUnpaid = cInv.filter(i => i.status !== 'paid' && i.status !== 'cancelled')
      .sort((a, b) => (a.issuedAt?.getTime() || 0) - (b.issuedAt?.getTime() || 0))[0];
    const ageDays = oldestUnpaid?.issuedAt ? Math.floor((Date.now() - oldestUnpaid.issuedAt.getTime()) / 86400000) : 0;
    return { client: c, outstanding: out, ageDays, oldestUnpaid };
  }).filter(r => r.outstanding > 0).sort((a, b) => b.ageDays - a.ageDays);

  const bucket = (d: number) => d <= 30 ? '0-30' : d <= 60 ? '31-60' : '60+';
  const buckets = { '0-30': 0, '31-60': 0, '60+': 0 };
  rows.forEach(r => { buckets[bucket(r.ageDays) as keyof typeof buckets] += r.outstanding; });

  const sendReminder = async (tid: string, name: string, amount: number, days: number) => {
    const phone = await fetchTenantPhone(tid);
    if (!phone) { alert('No phone number in Settings for this client.'); return; }
    const msg = `Dear ${name},\n\n⚠️ Your payment is ${days} days overdue.\n\nOutstanding: ${formatRs(amount)}\n\nPlease settle it soon.\n\nDigital Target — DT POS`;
    window.open(waLink(phone, msg), '_blank');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="0-30 Days" value={formatRs(buckets['0-30'])} icon={<Clock className="h-4 w-4" />} tone="green" />
        <Kpi label="31-60 Days" value={formatRs(buckets['31-60'])} icon={<Clock className="h-4 w-4" />} tone="amber" />
        <Kpi label="60+ Days" value={formatRs(buckets['60+'])} icon={<AlertTriangle className="h-4 w-4" />} tone="red" />
      </div>

      <Card title={`Overdue Clients (${rows.length}) — Auto Reminder List`}>
        {rows.length === 0 ? <div className="text-center text-green-600 font-bold py-6">✓ No overdue payments!</div> : (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b"><tr><th className="text-left py-1.5">Client</th><th className="text-left">Bucket</th><th className="text-right">Age</th><th className="text-right">Outstanding</th><th className="text-right">Action</th></tr></thead>
            <tbody>
              {rows.map(r => {
                const b = bucket(r.ageDays);
                const tone = b === '60+' ? 'text-red-600' : b === '31-60' ? 'text-amber-600' : 'text-green-600';
                return (
                  <tr key={r.client.tenantId} className="border-b">
                    <td className="py-2">
                      <div className="font-bold">{r.client.name}</div>
                      <div className="text-[10px] text-muted-foreground">{r.client.email}</div>
                    </td>
                    <td className={`py-2 font-bold ${tone}`}>{b} days</td>
                    <td className="py-2 text-right">{r.ageDays}d</td>
                    <td className="py-2 text-right font-extrabold text-red-600">{formatRs(r.outstanding)}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7 text-[10px]"
                        onClick={() => sendReminder(r.client.tenantId, r.client.name, r.outstanding, r.ageDays)}>
                        WhatsApp
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ============ Shared ============
function Kpi({ label, value, icon, tone, sub }: { label: string; value: string; icon: React.ReactNode; tone: 'violet'|'green'|'red'|'amber'|'primary'; sub?: string }) {
  const tones: any = {
    violet: 'border-violet-500/30 bg-violet-500/5 text-violet-700',
    green: 'border-green-500/30 bg-green-500/5 text-green-700',
    red: 'border-red-500/30 bg-red-500/5 text-red-700',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-700',
    primary: 'border-primary/30 bg-primary/5 text-primary',
  };
  return (
    <div className={`border rounded-xl p-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase font-bold tracking-wider opacity-80">{label}</div>
        {icon}
      </div>
      <div className="text-lg font-extrabold leading-tight">{value}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-xl bg-card p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green'|'red' }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-base font-extrabold ${tone === 'green' ? 'text-green-600' : tone === 'red' ? 'text-red-600' : ''}`}>{value}</div>
    </div>
  );
}
function Empty() { return <div className="text-center text-muted-foreground italic text-xs py-6">No data</div>; }
