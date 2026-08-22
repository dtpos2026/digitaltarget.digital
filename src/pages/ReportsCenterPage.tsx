import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getOrders, getSettings, getBranches, getCurrentBranchId, getPaymentAccounts } from '@/lib/store';
import { getAllHistoricalOrders } from '@/lib/orderArchive';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { BarChart3, CreditCard, Percent, ChefHat, Printer, Building2, FileDown, Landmark } from 'lucide-react';
import { Order } from '@/lib/types';
import { isPaidSale, isCreditOrder } from '@/lib/sales';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawPdfHeader, drawPdfFooter, getThemePrimaryRgb } from '@/lib/pdfBrand';

/**
 * Phase 8 — Reports split
 * Tabs: Paid Sales (credit excluded) · Credit/Udhaar · Discount · Category Discount/Excluded · Credit Recovery · Kitchen Status
 */
export default function ReportsCenterPage() {
  const settings = getSettings();
  const allBranches = getBranches().filter(b => b.isActive);
  const activeBranchId = getCurrentBranchId();
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // v1.15.1 — include archived (post Day Close) history.
  const orders = useMemo(() => getAllHistoricalOrders(getOrders()), []);

  const filterDB = (list: Order[]) => list.filter(o => {
    // Branch filter: include orders that match, OR legacy orders without any branchId
    if (branchFilter !== 'all' && o.branchId && o.branchId !== branchFilter) return false;
    if (from && new Date(o.createdAt) < new Date(from)) return false;
    if (to && new Date(o.createdAt) > new Date(to + 'T23:59:59')) return false;
    return true;
  });

  const paid = useMemo(() => filterDB(orders.filter(isPaidSale)), [orders, from, to, branchFilter]);
  const credits = useMemo(() => filterDB(orders.filter(isCreditOrder)), [orders, from, to, branchFilter]);
  const voids = useMemo(() => filterDB(orders.filter(o => o.status === 'void')), [orders, from, to, branchFilter]);
  const comps = useMemo(() => filterDB(orders.filter(o => o.status === 'complimentary')), [orders, from, to, branchFilter]);
  const cancels = useMemo(() => filterDB(orders.filter(o => o.status === 'cancelled')), [orders, from, to, branchFilter]);
  const discounted = useMemo(() => filterDB(orders.filter(o => (o.discount || 0) > 0 && isPaidSale(o))), [orders, from, to, branchFilter]);

  const totalPaid = paid.reduce((s, o) => s + o.grandTotal, 0);
  const totalCredit = credits.reduce((s, o) => s + o.grandTotal, 0);
  const totalDiscount = discounted.reduce((s, o) => s + (o.discount || 0), 0);
  const totalVoid = voids.reduce((s, o) => s + o.grandTotal, 0);
  const totalComp = comps.reduce((s, o) => s + o.grandTotal, 0);
  const totalCancel = cancels.reduce((s, o) => s + o.grandTotal, 0);

  // Item-wise & category-wise aggregates from paid sales
  const itemAgg = useMemo(() => {
    const map: Record<string, { name: string; qty: number; total: number }> = {};
    paid.forEach(o => (o.items || []).forEach(it => {
      const k = it.menuItemId || it.name;
      map[k] = map[k] || { name: it.name, qty: 0, total: 0 };
      map[k].qty += it.quantity || 0;
      map[k].total += it.lineTotal || 0;
    }));
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [paid]);

  const paymentMethodAgg = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    paid.forEach(o => {
      const k = o.paymentMethod || 'cash';
      map[k] = map[k] || { count: 0, total: 0 };
      map[k].count += 1;
      map[k].total += o.grandTotal;
    });
    return map;
  }, [paid]);

  const orderTypeAgg = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = { dining: { count: 0, total: 0 }, takeaway: { count: 0, total: 0 }, delivery: { count: 0, total: 0 } };
    paid.forEach(o => { const k = o.orderType; map[k] = map[k] || { count: 0, total: 0 }; map[k].count++; map[k].total += o.grandTotal; });
    return map;
  }, [paid]);

  // ===== Full PDF export =====
  const exportFullPDF = () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const [tr, tg, tb] = getThemePrimaryRgb();
    const periodStr = `Period: ${from || 'All time'} → ${to || 'Today'}` +
      (branchFilter !== 'all' ? `   ·   Branch: ${allBranches.find(b => b.id === branchFilter)?.name || ''}` : '');

    const startY = drawPdfHeader(pdf, { title: 'Complete Sales & Operations Report', subtitle: periodStr });

    // Summary boxes
    autoTable(pdf, {
      startY,
      head: [['Metric', 'Count', 'Amount (PKR)']],
      body: [
        ['Paid Sales (counted as revenue)', String(paid.length), totalPaid.toLocaleString()],
        ['Credit / Udhaar (pending)', String(credits.length), totalCredit.toLocaleString()],
        ['Void Bills', String(voids.length), totalVoid.toLocaleString()],
        ['Complimentary Bills', String(comps.length), totalComp.toLocaleString()],
        ['Cancelled Bills', String(cancels.length), totalCancel.toLocaleString()],
        ['Total Discount Given', String(discounted.length), totalDiscount.toLocaleString()],
      ],
      headStyles: { fillColor: [tr, tg, tb], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9 },
    });

    const section = (title: string, head: string[][], body: string[][]) => {
      pdf.addPage();
      const y0 = drawPdfHeader(pdf, { title });
      autoTable(pdf, { startY: y0, head, body, headStyles: { fillColor: [tr, tg, tb], textColor: 255 }, styles: { fontSize: 8 } });
    };

    const orderRow = (o: Order) => [
      String(o.orderNumber),
      o.orderType,
      o.creditCustomerName || o.customer?.name || '-',
      String((o.items || []).length),
      o.grandTotal.toLocaleString(),
      new Date(o.createdAt).toLocaleString('en-PK'),
    ];

    section('Paid Sales', [['#', 'Type', 'Customer', 'Items', 'Amount', 'Date']], paid.map(orderRow));
    section('Credit / Udhaar (Pending)', [['#', 'Type', 'Customer', 'Items', 'Amount', 'Date']], credits.map(orderRow));
    section('Void Bills', [['#', 'Type', 'Customer', 'Amount', 'Reason', 'Date']],
      voids.map(o => [String(o.orderNumber), o.orderType, o.creditCustomerName || o.customer?.name || '-', o.grandTotal.toLocaleString(), o.voidReason || '-', new Date(o.voidedAt || o.createdAt).toLocaleString('en-PK')]));
    section('Complimentary Bills', [['#', 'Type', 'Customer', 'Amount', 'Reason', 'Date']],
      comps.map(o => [String(o.orderNumber), o.orderType, o.creditCustomerName || o.customer?.name || '-', o.grandTotal.toLocaleString(), o.complimentaryReason || '-', new Date(o.complimentaryAt || o.createdAt).toLocaleString('en-PK')]));
    section('Cancelled Bills', [['#', 'Type', 'Customer', 'Amount', 'Reason', 'Date']],
      cancels.map(o => [String(o.orderNumber), o.orderType, o.creditCustomerName || o.customer?.name || '-', o.grandTotal.toLocaleString(), o.cancelReason || '-', new Date(o.cancelledAt || o.createdAt).toLocaleString('en-PK')]));

    section('Order Type Summary (Paid Only)', [['Type', 'Count', 'Amount']],
      Object.entries(orderTypeAgg).map(([k, v]) => [k, String(v.count), v.total.toLocaleString()]));
    section('Payment Method (Paid Only)', [['Method', 'Count', 'Amount']],
      Object.entries(paymentMethodAgg).map(([k, v]) => [k, String(v.count), v.total.toLocaleString()]));
    section('Item-wise Sales (Top 100)', [['Item', 'Qty Sold', 'Total']],
      itemAgg.slice(0, 100).map(i => [i.name, String(i.qty), i.total.toLocaleString()]));
    section('Discount Report', [['#', 'Title', 'Discount', 'Bill', 'Date']],
      discounted.map(o => [String(o.orderNumber), o.discountTitle || (o.discountPercent ? `${o.discountPercent}%` : 'Manual'), (o.discount || 0).toLocaleString(), o.grandTotal.toLocaleString(), new Date(o.createdAt).toLocaleString('en-PK')]));

    drawPdfFooter(pdf, `${settings.name || 'DT POS'}  ·  Powered by Digital Target`);

    pdf.save(`DT-POS-Report-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Category discount: which categories had discounts applied — heuristic: items not in excluded list
  const excludedCats = settings.discountExcludedCategoryIds || [];
  const excludedItems = settings.discountExcludedItemIds || [];

  const printSection = (title: string, html: string) => {
    const w = window.open('', '_blank'); if (!w) return;
    w.document.write(`<html><head><title>${title}</title>
      <style>body{font-family:Arial;padding:18px;font-size:12px}h2{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:5px 7px;text-align:left}th{background:#800020;color:#fff;font-size:11px}</style>
      </head><body><h2>${settings.name || 'DT POS'} — ${title}</h2>
      <p style="font-size:11px;color:#555">Period: ${from || 'All'} → ${to || 'All'}${branchFilter !== 'all' ? ' · Branch: ' + (allBranches.find(b => b.id === branchFilter)?.name || '') : ''}</p>
      ${html}</body></html>`);
    w.document.close(); w.print();
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Reports Center</h2>
        {allBranches.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1 border bg-primary/10 border-primary/40">
            <Building2 className="h-3.5 w-3.5 text-primary" />
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="h-6 text-[11px] bg-transparent border-0 outline-none font-semibold cursor-pointer">
              <option value="all">All Branches</option>
              {allBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 text-xs w-36" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 text-xs w-36" />
          <Button size="sm" onClick={exportFullPDF} className="h-8 text-xs">
            <FileDown className="h-3.5 w-3.5 mr-1" /> Export Full PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Paid Sales</div><div className="text-lg font-bold text-primary">{money(totalPaid)}</div><div className="text-[10px] text-muted-foreground">{paid.length} orders</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Credit / Udhaar</div><div className="text-lg font-bold text-status-warning">{money(totalCredit)}</div><div className="text-[10px] text-muted-foreground">{credits.length} orders</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Discount Given</div><div className="text-lg font-bold text-status-info">{money(totalDiscount)}</div><div className="text-[10px] text-muted-foreground">{discounted.length} bills</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Void</div><div className="text-lg font-bold text-destructive">{money(totalVoid)}</div><div className="text-[10px] text-muted-foreground">{voids.length} bills</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Complimentary</div><div className="text-lg font-bold">{money(totalComp)}</div><div className="text-[10px] text-muted-foreground">{comps.length} bills</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Cancelled</div><div className="text-lg font-bold">{money(totalCancel)}</div><div className="text-[10px] text-muted-foreground">{cancels.length} bills</div></Card>
      </div>


      <Tabs defaultValue="paid" className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="paid"><BarChart3 className="h-3.5 w-3.5 mr-1" /> Paid Sales</TabsTrigger>
          <TabsTrigger value="accounts"><Landmark className="h-3.5 w-3.5 mr-1" /> Payments by Account</TabsTrigger>
          <TabsTrigger value="credit"><CreditCard className="h-3.5 w-3.5 mr-1" /> Credit / Udhaar</TabsTrigger>
          <TabsTrigger value="discount"><Percent className="h-3.5 w-3.5 mr-1" /> Discount</TabsTrigger>
          <TabsTrigger value="catdisc">Category Discount</TabsTrigger>
          <TabsTrigger value="recovery">Credit Recovery</TabsTrigger>
          <TabsTrigger value="kitchen"><ChefHat className="h-3.5 w-3.5 mr-1" /> Kitchen Status</TabsTrigger>
          <TabsTrigger value="kitchenkot"><ChefHat className="h-3.5 w-3.5 mr-1" /> Kitchen KOT Reports</TabsTrigger>
          <TabsTrigger value="mgmtcontrol">Management Control</TabsTrigger>
        </TabsList>


        <TabsContent value="paid">
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Paid Sales (Credit Excluded)</h3>
              <Button size="sm" variant="outline" onClick={() => printSection('Paid Sales', renderOrdersTable(paid))}><Printer className="h-3 w-3 mr-1" /> Print</Button>
            </div>
            <OrderTable orders={paid} />
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <PaymentByAccountTab paid={paid} />
        </TabsContent>

        <TabsContent value="credit">
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Credit / Udhaar Orders</h3>
              <Button size="sm" variant="outline" onClick={() => printSection('Credit Report', renderOrdersTable(credits, true))}><Printer className="h-3 w-3 mr-1" /> Print</Button>
            </div>
            <OrderTable orders={credits} showCustomer />
          </Card>
        </TabsContent>

        <TabsContent value="discount">
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Discount Report</h3>
              <Button size="sm" variant="outline" onClick={() => printSection('Discount Report', renderDiscountTable(discounted))}><Printer className="h-3 w-3 mr-1" /> Print</Button>
            </div>
            <DiscountTable orders={discounted} />
          </Card>
        </TabsContent>

        <TabsContent value="catdisc">
          <Card className="p-3">
            <h3 className="text-sm font-semibold mb-2">Category-wise Discount / Excluded</h3>
            <div className="text-xs space-y-2">
              <div>
                <div className="font-semibold mb-1">Excluded Categories</div>
                {excludedCats.length === 0 ? <Badge variant="outline">None</Badge> : excludedCats.map(id => <Badge key={id} className="mr-1">{id}</Badge>)}
              </div>
              <div>
                <div className="font-semibold mb-1">Excluded Items</div>
                {excludedItems.length === 0 ? <Badge variant="outline">None</Badge> : excludedItems.map(id => <Badge key={id} variant="secondary" className="mr-1">{id}</Badge>)}
              </div>
              <div className="pt-2 border-t text-muted-foreground">
                Configure exclusions in <strong>Settings → Discount Management</strong>. Items/categories listed here are never discounted on receipts.
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="recovery">
          <Card className="p-3">
            <h3 className="text-sm font-semibold mb-2">Credit Recovery</h3>
            <p className="text-xs text-muted-foreground mb-2">
              Recoveries are tracked in <strong>Operations → Credits / Udhaar</strong>. Below is a quick outstanding summary.
            </p>
            <table className="w-full text-xs">
              <thead className="border-b text-muted-foreground"><tr><th className="text-left py-1">Customer</th><th className="text-left">Phone</th><th className="text-right">Outstanding</th></tr></thead>
              <tbody>
                {Object.entries(credits.reduce((acc, o) => {
                  const k = o.creditCustomerPhone || o.customer?.phone || '—';
                  const name = o.creditCustomerName || o.customer?.name || 'Walk-in';
                  acc[k] = acc[k] || { name, phone: k, total: 0 };
                  acc[k].total += o.grandTotal;
                  return acc;
                }, {} as Record<string, { name: string; phone: string; total: number }>)).map(([k, v]) => (
                  <tr key={k} className="border-b"><td className="py-1">{v.name}</td><td>{v.phone}</td><td className="text-right font-bold text-status-warning">{money(v.total)}</td></tr>
                ))}
                {credits.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No outstanding credits.</td></tr>}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="kitchen">
          <Card className="p-3">
            <h3 className="text-sm font-semibold mb-2">Kitchen Order Status</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
              {(['pending', 'preparing', 'ready', 'served'] as const).map(st => {
                const count = filterDB(orders).filter(o => (o.kitchenStatus || 'pending') === st).length;
                return (
                  <Card key={st} className="p-3 text-center">
                    <div className="text-[10px] uppercase text-muted-foreground">{st}</div>
                    <div className="text-xl font-bold">{count}</div>
                  </Card>
                );
              })}
            </div>
            <OrderTable orders={filterDB(orders).filter(o => o.kitchenStatus)} showKitchenStatus />
          </Card>
        </TabsContent>

        <TabsContent value="kitchenkot">
          <KitchenKotReport orders={filterDB(orders)} />
        </TabsContent>

        <TabsContent value="mgmtcontrol">
          <ManagementControlReport orders={filterDB(orders)} />
        </TabsContent>
      </Tabs>
    </div>

  );
}

function OrderTable({ orders, showCustomer = false, showKitchenStatus = false }: { orders: Order[]; showCustomer?: boolean; showKitchenStatus?: boolean }) {
  if (orders.length === 0) return <div className="text-xs text-muted-foreground text-center py-6">No data.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="text-left py-1">#</th>
            <th className="text-left">Type</th>
            {showCustomer && <th className="text-left">Customer</th>}
            {showKitchenStatus && <th className="text-left">Kitchen</th>}
            <th className="text-right">Amount</th>
            <th className="text-left">Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 200).map(o => (
            <tr key={o.id} className="border-b">
              <td className="py-1 font-bold">#{o.orderNumber}</td>
              <td className="capitalize">{o.orderType}</td>
              {showCustomer && <td>{o.creditCustomerName || o.customer?.name || '—'}<div className="text-[10px] text-muted-foreground">{o.creditCustomerPhone || o.customer?.phone || ''}</div></td>}
              {showKitchenStatus && <td><Badge variant="outline" className="text-[9px] uppercase">{o.kitchenStatus || 'pending'}</Badge></td>}
              <td className="text-right font-bold text-primary">{money(o.grandTotal)}</td>
              <td className="text-muted-foreground">{new Date(o.createdAt).toLocaleString('en-PK')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiscountTable({ orders }: { orders: Order[] }) {
  if (orders.length === 0) return <div className="text-xs text-muted-foreground text-center py-6">No discounted orders.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b text-muted-foreground"><tr><th className="text-left py-1">#</th><th className="text-left">Title</th><th className="text-right">Discount</th><th className="text-right">Bill</th><th className="text-left">Date</th></tr></thead>
        <tbody>
          {orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 200).map(o => (
            <tr key={o.id} className="border-b">
              <td className="py-1 font-bold">#{o.orderNumber}</td>
              <td>{o.discountTitle || (o.discountPercent ? `${o.discountPercent}%` : 'Manual')}</td>
              <td className="text-right font-bold text-status-info">- {money((o.discount || 0))}</td>
              <td className="text-right">{money(o.grandTotal)}</td>
              <td className="text-muted-foreground">{new Date(o.createdAt).toLocaleString('en-PK')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderOrdersTable(list: Order[], credit = false): string {
  return `<table><tr><th>#</th><th>Type</th>${credit ? '<th>Customer</th><th>Phone</th>' : ''}<th>Amount</th><th>Date</th></tr>` +
    list.map(o => `<tr><td>${o.orderNumber}</td><td>${o.orderType}</td>${credit ? `<td>${o.creditCustomerName || o.customer?.name || '—'}</td><td>${o.creditCustomerPhone || o.customer?.phone || '—'}</td>` : ''}<td>${money(o.grandTotal)}</td><td>${new Date(o.createdAt).toLocaleString('en-PK')}</td></tr>`).join('') +
    `</table>`;
}

function renderDiscountTable(list: Order[]): string {
  return `<table><tr><th>#</th><th>Title</th><th>Discount</th><th>Bill</th><th>Date</th></tr>` +
    list.map(o => `<tr><td>${o.orderNumber}</td><td>${o.discountTitle || (o.discountPercent ? o.discountPercent + '%' : 'Manual')}</td><td>- ${money((o.discount || 0))}</td><td>${money(o.grandTotal)}</td><td>${new Date(o.createdAt).toLocaleString('en-PK')}</td></tr>`).join('') +
    `</table>`;
}

function PaymentByAccountTab({ paid }: { paid: Order[] }) {
  const accounts = getPaymentAccounts();
  const cashTotal = paid.filter(o => (o.paymentMethod || 'cash') === 'cash' && !o.paymentAccountId).reduce((s, o) => s + o.grandTotal, 0);
  const cashCount = paid.filter(o => (o.paymentMethod || 'cash') === 'cash' && !o.paymentAccountId).length;
  const unassignedOnline = paid.filter(o => o.paymentMethod === 'online' && !o.paymentAccountId);
  const acctRows = accounts.map(a => {
    const list = paid.filter(o => o.paymentAccountId === a.id);
    return { acct: a, total: list.reduce((s, o) => s + o.grandTotal, 0), count: list.length };
  });
  const grand = paid.reduce((s, o) => s + o.grandTotal, 0);

  return (
    <Card className="p-3 space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">💵 Cash</div>
          <div className="text-lg font-bold text-status-success">{money(cashTotal)}</div>
          <div className="text-[10px] text-muted-foreground">{cashCount} bills</div>
        </Card>
        {acctRows.map(r => (
          <Card key={r.acct.id} className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">🏦 {r.acct.type}</div>
            <div className="text-sm font-bold truncate">{r.acct.name}</div>
            <div className="text-lg font-bold text-primary">{money(r.total)}</div>
            <div className="text-[10px] text-muted-foreground">{r.count} bills</div>
          </Card>
        ))}
        <Card className="p-3 border-primary/40">
          <div className="text-[10px] text-muted-foreground">GRAND TOTAL</div>
          <div className="text-lg font-extrabold text-primary">{money(grand)}</div>
          <div className="text-[10px] text-muted-foreground">{paid.length} bills</div>
        </Card>
      </div>

      {unassignedOnline.length > 0 && (
        <div className="text-[11px] p-2 rounded bg-status-warning/10 border border-status-warning/30 text-status-warning">
          ⚠ {unassignedOnline.length} online bills bina account ke hain ({money(unassignedOnline.reduce((s, o) => s + o.grandTotal, 0))})
        </div>
      )}

      <div>
        <h4 className="text-xs font-bold mb-1">Account-wise Bills</h4>
        <table className="w-full text-xs">
          <thead className="border-b text-muted-foreground"><tr>
            <th className="text-left py-1">#</th><th className="text-left">Method</th><th className="text-left">Account</th><th className="text-right">Amount</th><th className="text-left">Date</th>
          </tr></thead>
          <tbody>
            {paid.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 300).map(o => (
              <tr key={o.id} className="border-b">
                <td className="py-1 font-bold">#{o.orderNumber}</td>
                <td className="uppercase">{o.paymentMethod || 'cash'}</td>
                <td>{o.paymentAccountName || (o.paymentMethod === 'cash' || !o.paymentMethod ? 'Cash Drawer' : '—')}</td>
                <td className="text-right font-bold text-primary">{money(o.grandTotal)}</td>
                <td className="text-muted-foreground">{new Date(o.createdAt).toLocaleString('en-PK')}</td>
              </tr>
            ))}
            {paid.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No paid bills.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ============ Kitchen KOT Reports ============
function KitchenKotReport({ orders }: { orders: Order[] }) {
  const rows = orders
    .filter(o => (o.kotRevisions && o.kotRevisions.length) || o.kotPrinted)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map(o => {
      const revs = o.kotRevisions || [];
      const added = revs.flatMap(r => r.lines.filter(l => l.deltaQty > 0)).reduce((s, l) => s + l.deltaQty, 0);
      const cancelled = revs.flatMap(r => r.lines.filter(l => l.deltaQty < 0)).reduce((s, l) => s + Math.abs(l.deltaQty), 0);
      const startedAt = o.cookingStartedAt ? new Date(o.cookingStartedAt).getTime() : null;
      const readyAt = o.readyAt ? new Date(o.readyAt).getTime() : null;
      const deliveredAt = o.deliveredAt ? new Date(o.deliveredAt).getTime() : (o.paidAt ? new Date(o.paidAt).getTime() : null);
      const procMin = startedAt && readyAt ? Math.round((readyAt - startedAt) / 60000) : null;
      const serveMin = readyAt && deliveredAt ? Math.round((deliveredAt - readyAt) / 60000) : null;
      return { o, revs: revs.length || (o.kotPrinted ? 1 : 0), added, cancelled, procMin, serveMin, deliveredAt };
    });
  return (
    <Card className="p-3">
      <h3 className="text-sm font-semibold mb-2">Kitchen KOT Reports</h3>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">No KOT data.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b text-muted-foreground">
              <tr><th className="text-left py-1">Order #</th><th className="text-left">Type</th><th className="text-left">Table</th><th className="text-left">Cashier</th><th className="text-right">KOTs</th><th className="text-right">Added</th><th className="text-right">Cancelled</th><th className="text-right">Proc (min)</th><th className="text-right">Serve (min)</th><th className="text-left">Completed</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.o.id} className="border-b">
                  <td className="py-1 font-bold">#{r.o.orderNumber}</td>
                  <td className="capitalize">{r.o.orderType}</td>
                  <td>{r.o.tableName || '—'}</td>
                  <td>{r.o.cashierName || '—'}</td>
                  <td className="text-right">{r.revs}</td>
                  <td className="text-right text-status-success">+{r.added}</td>
                  <td className="text-right text-destructive">-{r.cancelled}</td>
                  <td className="text-right">{r.procMin ?? '—'}</td>
                  <td className="text-right">{r.serveMin ?? '—'}</td>
                  <td className="text-muted-foreground">{r.deliveredAt ? new Date(r.deliveredAt).toLocaleString('en-PK') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ============ Management Control (Fraud / Misuse) ============
function ManagementControlReport({ orders }: { orders: Order[] }) {
  const rows: Array<{ o: Order; itemName: string; oldQty?: number | string; newQty?: number | string; action: string; reason?: string; user?: string; at: string }> = [];
  orders.forEach(o => {
    (o.editLogs || []).forEach(l => {
      if (l.action === 'QTY_DOWN' || l.action === 'CANCEL' || l.action === 'VOID' || l.action === 'COMPLIMENTARY' || l.action === 'CANCEL_ORDER') {
        rows.push({ o, itemName: l.itemName || '—', oldQty: l.oldValue, newQty: l.newValue, action: l.action, reason: l.reason, user: l.userName, at: l.at });
      }
    });
  });
  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <Card className="p-3">
      <h3 className="text-sm font-semibold mb-2">Management Control — Cancellations, Reductions, Voids</h3>
      <p className="text-[11px] text-muted-foreground mb-2">Fraud detection: all reduced / cancelled / voided items with the user who made the change.</p>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">No critical changes.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b text-muted-foreground">
              <tr><th className="text-left py-1">Time</th><th className="text-left">Order #</th><th className="text-left">Action</th><th className="text-left">Item</th><th className="text-right">Old</th><th className="text-right">New</th><th className="text-left">Reason</th><th className="text-left">User</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1 text-muted-foreground">{new Date(r.at).toLocaleString('en-PK')}</td>
                  <td className="font-bold">#{r.o.orderNumber}</td>
                  <td className="text-destructive">{r.action}</td>
                  <td>{r.itemName}</td>
                  <td className="text-right">{r.oldQty ?? '—'}</td>
                  <td className="text-right">{r.newQty ?? '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td>{r.user || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
