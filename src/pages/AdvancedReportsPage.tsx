import { useEffect, useMemo, useState } from 'react';
import { getOrders, getCategories, getMenuItems, onDataChange, refreshOrdersFromCloud } from '@/lib/store';
import { getAllHistoricalOrders } from '@/lib/orderArchive';
import { Order } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BarChart3, Download, Filter as FilterIcon } from 'lucide-react';
import DateTimeRangeFilter, { DateTimeRange } from '@/components/DateTimeRangeFilter';
import { getCurrentBusinessDay, getBusinessDayRange } from '@/lib/businessDay';

type GroupKey = 'item' | 'variant' | 'category' | 'subcategory';
type SourceFilter = 'all' | 'pos' | 'website' | 'foodpanda' | 'delivery' | 'takeaway' | 'dining';

export default function AdvancedReportsPage() {
  const [orders, setOrders] = useState<Order[]>(() => getAllHistoricalOrders(getOrders()));
  const [group, setGroup] = useState<GroupKey>('variant');
  const [src, setSrc] = useState<SourceFilter>('all');
  const [range, setRange] = useState<DateTimeRange>(() => {
    const w = getBusinessDayRange(30);
    const today = getCurrentBusinessDay();
    return { startMs: w.startMs, endMs: today.endMs, preset: 'month' };
  });

  useEffect(() => {
    refreshOrdersFromCloud().then(() => setOrders(getAllHistoricalOrders(getOrders()))).catch(() => {});
    const off = onDataChange((col) => { if (col === 'orders' || col === '*') setOrders(getAllHistoricalOrders(getOrders())); });
    return () => off();
  }, []);

  const categories = getCategories();
  const menuItems = getMenuItems();
  const itemById = new Map(menuItems.map(m => [m.id, m]));
  const catById = new Map(categories.map(c => [c.id, c]));

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      const t = new Date(o.createdAt).getTime();
      if (t < range.startMs || t >= range.endMs) return false;
      if (['void', 'cancelled', 'rejected'].includes(o.status)) return false;
      if (src === 'all') return true;
      if (src === 'foodpanda') return o.orderType === 'foodpanda';
      if (src === 'dining' || src === 'takeaway' || src === 'delivery') return o.orderType === src;
      if (src === 'website') return (o as any).source === 'website';
      if (src === 'pos') return !(o as any).source || (o as any).source === 'pos';
      return true;
    });
  }, [orders, range.startMs, range.endMs, src]);

  const rows = useMemo(() => {
    const map = new Map<string, { product: string; variant: string; category: string; subcategory: string; qty: number; gross: number; discount: number; net: number }>();
    for (const o of filteredOrders) {
      const orderDiscountRatio = o.subtotal > 0 ? (o.discount || 0) / o.subtotal : 0;
      for (const it of (o.items || [])) {
        const m = itemById.get(it.menuItemId);
        const cat = m ? catById.get(m.categoryId) : undefined;
        const sub = m?.subCategory || m?.flavorGroup || '—';
        const variant = it.variantName || '—';
        let key: string;
        let product: string;
        let variantOut = variant;
        let category = cat?.name || '—';
        let subcategory = sub || '—';
        switch (group) {
          case 'item': key = it.menuItemId; product = m?.name || it.name; variantOut = '—'; break;
          case 'variant': key = `${it.menuItemId}|${variant}`; product = m?.name || it.name; break;
          case 'category': key = m?.categoryId || '—'; product = '—'; variantOut = '—'; break;
          case 'subcategory': key = `${m?.categoryId || '—'}|${subcategory}`; product = '—'; variantOut = '—'; break;
        }
        const gross = it.lineTotal || (it.price * it.quantity);
        const disc = gross * orderDiscountRatio;
        const ex = map.get(key);
        if (ex) {
          ex.qty += it.quantity; ex.gross += gross; ex.discount += disc; ex.net += (gross - disc);
        } else {
          map.set(key, { product, variant: variantOut, category, subcategory, qty: it.quantity, gross, discount: disc, net: gross - disc });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  }, [filteredOrders, group, itemById, catById]);

  const totals = rows.reduce((acc, r) => ({ qty: acc.qty + r.qty, gross: acc.gross + r.gross, discount: acc.discount + r.discount, net: acc.net + r.net }), { qty: 0, gross: 0, discount: 0, net: 0 });

  const exportCsv = () => {
    const header = ['Product', 'Variant', 'Category', 'Subcategory', 'Qty', 'Gross', 'Discount', 'Net'];
    const lines = [header.join(',')];
    rows.forEach(r => lines.push([r.product, r.variant, r.category, r.subcategory, r.qty, r.gross.toFixed(2), r.discount.toFixed(2), r.net.toFixed(2)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `advanced-report-${group}-${new Date(range.startMs).toISOString().slice(0,10)}-to-${new Date(range.endMs).toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight">Advanced Item / Variant Reports</h1>
          <p className="text-[11px] text-muted-foreground">Pizza → Small / Medium / Large alag alag dikhega. POS + Web + Foodpanda sab cover.</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
        </Button>
      </div>

      <Card className="p-3 space-y-3">
        <DateTimeRangeFilter value={range} onChange={setRange} />
        <div>
          <label className="text-[10px] font-bold text-muted-foreground flex items-center gap-1"><FilterIcon className="h-3 w-3" /> Source / Order Type</label>
          <div className="flex flex-wrap gap-1">
            {(['all','pos','website','foodpanda','delivery','takeaway','dining'] as SourceFilter[]).map(s => (
              <Button key={s} size="sm" variant={src === s ? 'default' : 'outline'} className="h-7 text-[10px] capitalize" onClick={() => setSrc(s)}>{s}</Button>
            ))}
          </div>
        </div>
        <Tabs value={group} onValueChange={(v) => setGroup(v as GroupKey)}>
          <TabsList>
            <TabsTrigger value="item">Item-wise</TabsTrigger>
            <TabsTrigger value="variant">Variant-wise</TabsTrigger>
            <TabsTrigger value="category">Category-wise</TabsTrigger>
            <TabsTrigger value="subcategory">Subcategory-wise</TabsTrigger>
          </TabsList>
          <TabsContent value={group} className="mt-3">
            <div className="overflow-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left sticky top-0">
                  <tr>
                    <th className="p-2">Product</th>
                    <th className="p-2">Variant / Size</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Subcategory</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Gross</th>
                    <th className="p-2 text-right">Discount</th>
                    <th className="p-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No data for selected range / filter.</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={i} className="border-t hover:bg-muted/20">
                      <td className="p-2 font-medium">{r.product}</td>
                      <td className="p-2">{r.variant}</td>
                      <td className="p-2 text-muted-foreground">{r.category}</td>
                      <td className="p-2 text-muted-foreground">{r.subcategory}</td>
                      <td className="p-2 text-right font-bold">{r.qty}</td>
                      <td className="p-2 text-right">{r.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="p-2 text-right text-destructive">{r.discount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="p-2 text-right font-bold text-primary">{r.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="bg-muted/30 font-bold sticky bottom-0">
                    <tr>
                      <td colSpan={4} className="p-2 text-right">TOTAL</td>
                      <td className="p-2 text-right">{totals.qty}</td>
                      <td className="p-2 text-right">{totals.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="p-2 text-right text-destructive">{totals.discount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="p-2 text-right text-primary">{totals.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
