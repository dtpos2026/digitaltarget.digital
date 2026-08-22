import { useState, useMemo } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Ban, Gift, XCircle, Printer, Search } from 'lucide-react';
import { getOrders, getSettings } from '@/lib/store';
import { Order } from '@/lib/types';

/**
 * Phase 3 — Void / Complimentary / Cancelled bills viewer.
 * These bills are recorded with reason + staff + datetime and are EXCLUDED from paid sales.
 */
export default function VoidBillsPage() {
  const settings = getSettings();
  const [search, setSearch] = useState('');
  const allOrders = useMemo(() => getOrders(), []);

  const filterFn = (list: Order[]) => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(o =>
      String(o.orderNumber).includes(q) ||
      (o.creditCustomerName || o.customer?.name || '').toLowerCase().includes(q) ||
      (o.creditCustomerPhone || o.customer?.phone || '').includes(q) ||
      (o.voidReason || o.complimentaryReason || o.cancelReason || '').toLowerCase().includes(q)
    );
  };

  const voids = useMemo(() => filterFn(allOrders.filter(o => o.status === 'void'))
    .sort((a, b) => new Date(b.voidedAt || b.createdAt).getTime() - new Date(a.voidedAt || a.createdAt).getTime()), [allOrders, search]);
  const comps = useMemo(() => filterFn(allOrders.filter(o => o.status === 'complimentary'))
    .sort((a, b) => new Date(b.complimentaryAt || b.createdAt).getTime() - new Date(a.complimentaryAt || a.createdAt).getTime()), [allOrders, search]);
  const cancels = useMemo(() => filterFn(allOrders.filter(o => o.status === 'cancelled'))
    .sort((a, b) => new Date(b.cancelledAt || b.createdAt).getTime() - new Date(a.cancelledAt || a.createdAt).getTime()), [allOrders, search]);

  const totalVoid = voids.reduce((s, o) => s + o.grandTotal, 0);
  const totalComp = comps.reduce((s, o) => s + o.grandTotal, 0);
  const totalCancel = cancels.reduce((s, o) => s + o.grandTotal, 0);

  const printSection = (title: string, list: Order[], reasonField: 'voidReason' | 'complimentaryReason' | 'cancelReason') => {
    const w = window.open('', '_blank'); if (!w) return;
    const rows = list.map(o => `<tr>
      <td>${o.orderNumber}</td>
      <td>${o.orderType}</td>
      <td>${(o.items || []).length} items</td>
      <td>${o.creditCustomerName || o.customer?.name || '-'}</td>
      <td>${money(o.grandTotal)}</td>
      <td>${o[reasonField] || '-'}</td>
      <td>${new Date(o.createdAt).toLocaleString('en-PK')}</td>
    </tr>`).join('');
    w.document.write(`<html><head><title>${title}</title>
      <style>body{font-family:Arial;padding:18px;font-size:12px}h2{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:5px 7px;text-align:left}th{background:#800020;color:#fff;font-size:11px}</style>
      </head><body><h2>${settings.name || 'DT POS'} — ${title}</h2>
      <table><tr><th>#</th><th>Type</th><th>Items</th><th>Customer</th><th>Amount</th><th>Reason</th><th>Date</th></tr>${rows}</table>
      </body></html>`);
    w.document.close(); w.print();
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Ban className="h-5 w-5 text-destructive" />
        <h2 className="text-lg font-bold">Void / Complimentary / Cancelled Bills</h2>
        <Badge variant="secondary" className="ml-auto">{voids.length + comps.length + cancels.length} bills</Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-[10px] font-bold uppercase text-destructive">Void</div>
          <div className="text-lg font-extrabold text-destructive">{money(totalVoid)}</div>
          <div className="text-[10px] text-muted-foreground">{voids.length} bills</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] font-bold uppercase text-status-info">Complimentary</div>
          <div className="text-lg font-extrabold text-status-info">{money(totalComp)}</div>
          <div className="text-[10px] text-muted-foreground">{comps.length} bills</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] font-bold uppercase text-muted-foreground">Cancelled</div>
          <div className="text-lg font-extrabold">{money(totalCancel)}</div>
          <div className="text-[10px] text-muted-foreground">{cancels.length} bills</div>
        </Card>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bill #, customer, reason…" className="pl-7 h-9 text-xs" />
      </div>

      <Tabs defaultValue="void">
        <TabsList>
          <TabsTrigger value="void"><Ban className="h-3.5 w-3.5 mr-1" /> Void ({voids.length})</TabsTrigger>
          <TabsTrigger value="comp"><Gift className="h-3.5 w-3.5 mr-1" /> Complimentary ({comps.length})</TabsTrigger>
          <TabsTrigger value="cancel"><XCircle className="h-3.5 w-3.5 mr-1" /> Cancelled ({cancels.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="void">
          <BillTable
            orders={voids} reasonField="voidReason" byField="voidBy" atField="voidedAt"
            onPrint={() => printSection('Void Bills', voids, 'voidReason')}
          />
        </TabsContent>
        <TabsContent value="comp">
          <BillTable
            orders={comps} reasonField="complimentaryReason" byField="complimentaryBy" atField="complimentaryAt"
            onPrint={() => printSection('Complimentary Bills', comps, 'complimentaryReason')}
          />
        </TabsContent>
        <TabsContent value="cancel">
          <BillTable
            orders={cancels} reasonField="cancelReason" byField="cancelledBy" atField="cancelledAt"
            onPrint={() => printSection('Cancelled Bills', cancels, 'cancelReason')}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BillTable({ orders, reasonField, byField, atField, onPrint }: {
  orders: Order[];
  reasonField: 'voidReason' | 'complimentaryReason' | 'cancelReason';
  byField: 'voidBy' | 'complimentaryBy' | 'cancelledBy';
  atField: 'voidedAt' | 'complimentaryAt' | 'cancelledAt';
  onPrint: () => void;
}) {
  if (orders.length === 0) return <Card className="p-8 text-center text-xs text-muted-foreground">Koi bills nahi.</Card>;
  return (
    <Card className="p-3">
      <div className="flex justify-end mb-2">
        <button onClick={onPrint} className="text-[11px] px-3 py-1.5 rounded bg-primary text-primary-foreground font-bold inline-flex items-center gap-1 hover:opacity-90">
          <Printer className="h-3 w-3" /> Print
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="text-left py-1">#</th>
              <th className="text-left">Type</th>
              <th className="text-left">Customer</th>
              <th className="text-right">Items</th>
              <th className="text-right">Amount</th>
              <th className="text-left">Reason</th>
              <th className="text-left">By</th>
              <th className="text-left">Date / Time</th>
              <th className="text-center">Reprints</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} className="border-b">
                <td className="py-1.5 font-bold">#{o.orderNumber}</td>
                <td className="capitalize">{o.orderType}</td>
                <td>{o.creditCustomerName || o.customer?.name || '-'}<div className="text-[10px] text-muted-foreground">{o.creditCustomerPhone || o.customer?.phone || ''}</div></td>
                <td className="text-right">{(o.items || []).length}</td>
                <td className="text-right font-bold">{money(o.grandTotal)}</td>
                <td className="max-w-[200px] truncate" title={(o as any)[reasonField] || ''}>{(o as any)[reasonField] || '-'}</td>
                <td>{(o as any)[byField] || '-'}</td>
                <td className="text-muted-foreground">{new Date((o as any)[atField] || o.createdAt).toLocaleString('en-PK')}</td>
                <td className="text-center">
                  {o.reprintCount ? (
                    <span title={(o.reprintLog || []).map(r => `${r.type} • ${r.by || '-'} • ${new Date(r.at).toLocaleString('en-PK')}`).join('\n')}
                      className="inline-block px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning text-[10px] font-bold">
                      {o.reprintCount}×
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
