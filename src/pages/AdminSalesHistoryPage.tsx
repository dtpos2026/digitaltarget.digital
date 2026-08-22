import { useMemo, useState } from 'react';
import { getOrders, getCurrentUser, getSettings } from '@/lib/store';
import { getAllHistoricalOrders, clearArchivedOrders, getArchivedOrders } from '@/lib/orderArchive';
import { Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { FileDown, Printer, Trash2, ShieldAlert } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import DateTimeRangeFilter, { DateTimeRange } from '@/components/DateTimeRangeFilter';
import { getCurrentBusinessDay } from '@/lib/businessDay';

function fmtMoney(n: number) {
  return 'Rs. ' + (n || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}


export default function AdminSalesHistoryPage() {
  const user = getCurrentUser();
  const settings = getSettings();
  const isAdmin = user?.role === 'admin';

  const [range, setRange] = useState<DateTimeRange>(() => {
    const bd = getCurrentBusinessDay();
    return { startMs: bd.startMs, endMs: bd.endMs, preset: 'today' };
  });
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');

  const allOrders = useMemo<Order[]>(() => getAllHistoricalOrders(getOrders()), [range.startMs, range.endMs]);

  const filtered = useMemo(() => {
    return allOrders
      .filter(o => {
        const t = new Date(o.createdAt).getTime();
        return t >= range.startMs && t < range.endMs;
      })
      .filter(o => typeFilter === 'all' ? true : o.orderType === typeFilter)
      .filter(o => cashierFilter === 'all' ? true : (o.cashierName || 'Unknown') === cashierFilter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allOrders, range.startMs, range.endMs, typeFilter, cashierFilter]);

  // Unique cashier list (across the date range, before cashier filter is applied)
  const cashierList = useMemo(() => {
    const set = new Set<string>();
    for (const o of allOrders) {
      const t = new Date(o.createdAt).getTime();
      if (t < range.startMs || t >= range.endMs) continue;
      set.add(o.cashierName || 'Unknown');
    }
    return Array.from(set).sort();
  }, [allOrders, range.startMs, range.endMs]);

  const stats = useMemo(() => {
    const paid = filtered.filter(o => o.status === "paid");
    const revenue = paid.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const discounts = filtered.reduce((s, o) => s + (o.discount || 0), 0);
    const tax = filtered.reduce((s, o) => s + (o.tax || 0), 0);
    const byType: Record<string, { count: number; total: number }> = {};
    for (const o of paid) {
      const k = o.orderType || 'other';
      if (!byType[k]) byType[k] = { count: 0, total: 0 };
      byType[k].count++;
      byType[k].total += o.grandTotal || 0;
    }
    const byDay: Record<string, { count: number; total: number }> = {};
    for (const o of paid) {
      const k = new Date(o.createdAt).toISOString().slice(0,10);
      if (!byDay[k]) byDay[k] = { count: 0, total: 0 };
      byDay[k].count++;
      byDay[k].total += o.grandTotal || 0;
    }
    // ITEM-WISE aggregation
    const byItem: Record<string, { name: string; qty: number; orders: number; total: number }> = {};
    for (const o of paid) {
      for (const it of (o.items || [])) {
        const key = it.menuItemId || it.name;
        if (!byItem[key]) byItem[key] = { name: it.name, qty: 0, orders: 0, total: 0 };
        byItem[key].qty += it.quantity || 0;
        byItem[key].total += it.lineTotal || 0;
        byItem[key].orders += 1;
      }
    }
    const itemRows = Object.values(byItem).sort((a, b) => b.qty - a.qty);
    // CASHIER-WISE aggregation (paid orders only)
    const byCashier: Record<string, { count: number; total: number; discounts: number }> = {};
    for (const o of paid) {
      const k = o.cashierName || 'Unknown';
      if (!byCashier[k]) byCashier[k] = { count: 0, total: 0, discounts: 0 };
      byCashier[k].count++;
      byCashier[k].total += o.grandTotal || 0;
      byCashier[k].discounts += o.discount || 0;
    }
    const cashierRows = Object.entries(byCashier)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total);
    return { paidCount: paid.length, totalCount: filtered.length, revenue, discounts, tax, byType, byDay, itemRows, cashierRows };
  }, [filtered]);

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card className="p-8 text-center">
          <ShieldAlert className="h-10 w-10 mx-auto text-destructive mb-3" />
          <h2 className="text-xl font-semibold mb-1">Admin Only</h2>
          <p className="text-muted-foreground">یہ صفحہ صرف Admin کیلئے ہے۔ Cashier اس کو نہیں دیکھ سکتا۔</p>
        </Card>
      </div>
    );
  }

  const printPdf = () => {
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
      const W = doc.internal.pageSize.getWidth();
      const restaurant = settings.name || 'Restaurant';
      const from = new Date(range.startMs);
      const to = new Date(range.endMs);
      const periodLabel = `${from.toLocaleString()}  →  ${to.toLocaleString()}`;

      // Header
      doc.setFontSize(16); doc.setFont('helvetica', 'bold');
      doc.text(restaurant, W / 2, 14, { align: 'center' });
      doc.setFontSize(11); doc.setFont('helvetica', 'normal');
      doc.text('Sales History Report', W / 2, 20, { align: 'center' });
      doc.setFontSize(9);
      doc.text(`Period: ${periodLabel}`, W / 2, 25, { align: 'center' });
      doc.text(`Generated: ${new Date().toLocaleString()}`, W / 2, 30, { align: 'center' });

      // Summary block
      doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      doc.text('Summary', 14, 40);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const summaryLines = [
        `Total Orders: ${stats.totalCount}`,
        `Paid Orders: ${stats.paidCount}`,
        `Revenue: ${fmtMoney(stats.revenue)}`,
        `Discounts: ${fmtMoney(stats.discounts)}`,
        `Tax: ${fmtMoney(stats.tax)}`,
      ];
      summaryLines.forEach((l, i) => doc.text(l, 14 + (i * 55), 46));

      // Orders table
      autoTable(doc, {
        startY: 54,
        head: [['Date', 'Time', 'Order#', 'Type', 'Table', 'Waiter', 'Status', 'Items', 'Subtotal', 'Disc', 'Tax', 'Total']],
        body: filtered.map(o => {
          const d = new Date(o.createdAt);
          return [
            d.toLocaleDateString(),
            d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            String(o.orderNumber ?? ''),
            o.orderType || '',
            o.tableName || '-',
            o.waiterName || '-',
            o.status || '',
            String(o.items?.length || 0),
            fmtMoney(o.subtotal || 0),
            fmtMoney(o.discount || 0),
            fmtMoney(o.tax || 0),
            fmtMoney(o.grandTotal || 0),
          ];
        }),
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 8 },
        margin: { left: 8, right: 8 },
      });

      // Footer total
      const finalY = (doc as any).lastAutoTable?.finalY || 60;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(`Grand Total: ${fmtMoney(stats.revenue)}`, W - 14, finalY + 8, { align: 'right' });

      const fname = `sales-history-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(fname);
      toast.success('PDF downloaded');
    } catch (e: any) {
      console.error('[sales-pdf] failed', e);
      toast.error('Problem creating the PDF: ' + (e?.message || 'unknown'));
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Date', 'Time', 'Order #', 'Invoice #', 'Type', 'Table', 'Waiter', 'Status', 'Items', 'Subtotal', 'Discount', 'Tax', 'Grand Total'],
      ...filtered.map(o => {
        const d = new Date(o.createdAt);
        return [
          d.toLocaleDateString(),
          d.toLocaleTimeString(),
          String(o.orderNumber ?? ''),
          (o.id?.slice(-6)) || '',
          o.orderType || '',
          o.tableName || '',
          o.waiterName || '',
          o.status || '',
          String(o.items?.length || 0),
          String(o.subtotal || 0),
          String(o.discount || 0),
          String(o.tax || 0),
          String(o.grandTotal || 0),
        ];
      }),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-history-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  };

  const clearArchive = () => {
    if (!confirm('Are you sure? This will permanently delete the archived sales history. This cannot be undone.')) return;
    clearArchivedOrders();
    toast.success('Archive cleared');
    setRange({ ...range });
  };

  const archivedCount = getArchivedOrders().length;
  const dayKeys = Object.keys(stats.byDay).sort();

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 no-print">
        <div>
          <h1 className="text-2xl font-bold">📊 Admin Sales History</h1>
          <p className="text-sm text-muted-foreground">Day Close کے بعد بھی محفوظ — صرف Admin دیکھ سکتا ہے</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}><FileDown className="h-4 w-4 mr-2" />CSV</Button>
          <Button onClick={printPdf}><Printer className="h-4 w-4 mr-2" />Print / Save as PDF</Button>
          <Button variant="destructive" onClick={clearArchive}><Trash2 className="h-4 w-4 mr-2" />Clear Archive</Button>
        </div>
      </div>

      <Card className="p-4 mb-4 no-print">
        <DateTimeRangeFilter value={range} onChange={setRange} className="mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Order Type</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="dine-in">Dine-In</SelectItem>
                <SelectItem value="takeaway">Takeaway</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Cashier</label>
            <Select value={cashierFilter} onValueChange={setCashierFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cashiers</SelectItem>
                {cashierList.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">Archive: {archivedCount} historical orders saved on this device.</p>
      </Card>

      {/* Print header */}
      <div className="hidden print:block mb-4 text-center">
        <h1 className="text-2xl font-bold">{settings.name || ''}</h1>
        <p className="text-sm">Sales Report — {new Date(range.startMs).toLocaleString()} to {new Date(range.endMs).toLocaleString()}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Revenue (Paid)</div><div className="text-2xl font-bold">{fmtMoney(stats.revenue)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Paid Orders</div><div className="text-2xl font-bold">{stats.paidCount}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Discounts</div><div className="text-2xl font-bold">{fmtMoney(stats.discounts)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Tax</div><div className="text-2xl font-bold">{fmtMoney(stats.tax)}</div></Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-2">By Order Type</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Type</th><th className="text-right">Orders</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {Object.entries(stats.byType).map(([k, v]) => (
                <tr key={k} className="border-t"><td className="py-1 capitalize">{k}</td><td className="text-right">{v.count}</td><td className="text-right">{fmtMoney(v.total)}</td></tr>
              ))}
              {Object.keys(stats.byType).length === 0 && <tr><td colSpan={3} className="text-center text-muted-foreground py-3">No data</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">Day-wise Sales</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th>Date</th><th className="text-right">Orders</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {dayKeys.map(k => (
                <tr key={k} className="border-t"><td className="py-1">{k}</td><td className="text-right">{stats.byDay[k].count}</td><td className="text-right">{fmtMoney(stats.byDay[k].total)}</td></tr>
              ))}
              {dayKeys.length === 0 && <tr><td colSpan={3} className="text-center text-muted-foreground py-3">No data</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Cashier-wise breakdown */}
      <Card className="p-4 mb-4">
        <h3 className="font-semibold mb-2">👤 Cashier-wise Sales ({stats.cashierRows.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2">Cashier</th>
                <th className="text-right">Paid Orders</th>
                <th className="text-right">Discounts</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Avg / Order</th>
              </tr>
            </thead>
            <tbody>
              {stats.cashierRows.map(r => (
                <tr key={r.name} className="border-b hover:bg-accent/30">
                  <td className="py-1.5 font-medium">{r.name}</td>
                  <td className="text-right">{r.count}</td>
                  <td className="text-right">{fmtMoney(r.discounts)}</td>
                  <td className="text-right font-semibold">{fmtMoney(r.total)}</td>
                  <td className="text-right text-muted-foreground">{fmtMoney(Math.round(r.total / Math.max(1, r.count)))}</td>
                </tr>
              ))}
              {stats.cashierRows.length === 0 && (
                <tr><td colSpan={5} className="text-center text-muted-foreground py-3">No paid orders in this range</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>


      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">🍽 Item-wise Sales ({stats.itemRows.length} items)</h3>
          <Button size="sm" variant="outline" onClick={() => {
            const rows = [['Item', 'Qty Sold', 'Orders', 'Total Revenue'],
              ...stats.itemRows.map(r => [r.name, String(r.qty), String(r.orders), String(r.total)])];
            const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `item-wise-${new Date().toISOString().slice(0,10)}.csv`; a.click();
            URL.revokeObjectURL(url); toast.success('Item-wise CSV downloaded');
          }}><FileDown className="h-3.5 w-3.5 mr-1" />Item CSV</Button>
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2">#</th><th>Item</th><th className="text-right">Qty Sold</th><th className="text-right">Orders</th><th className="text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {stats.itemRows.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="py-1 text-muted-foreground">{i + 1}</td>
                  <td className="font-medium">{r.name}</td>
                  <td className="text-right font-mono">{r.qty}</td>
                  <td className="text-right">{r.orders}</td>
                  <td className="text-right font-semibold">{fmtMoney(r.total)}</td>
                </tr>
              ))}
              {stats.itemRows.length === 0 && <tr><td colSpan={5} className="text-center text-muted-foreground py-6">No items sold in this range</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Orders ({filtered.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2">Date</th><th>Order #</th><th>Type</th><th>Table</th><th>Waiter</th><th>Status</th><th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => {
                const d = new Date(o.createdAt);
                return (
                  <tr key={o.id} className="border-b">
                    <td className="py-1">{d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{o.orderNumber ?? '—'}</td>
                    <td className="capitalize">{o.orderType || ''}</td>
                    <td>{o.tableName || ''}</td>
                    <td>{o.waiterName || ''}</td>
                    <td className="capitalize">{o.status || ''}</td>
                    <td className="text-right font-medium">{fmtMoney(o.grandTotal || 0)}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground py-6">No orders in this range</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
