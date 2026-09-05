import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getCustomers, saveCustomer, deleteCustomer, getOrders, getRiders } from '@/lib/store';
import { CustomerProfile, Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Phone, MapPin, Search, Trash2, Edit3, Trophy, Truck, Users, Clock, MessageCircle, Eye, Download, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { normalizePhone, openWhatsApp } from '@/lib/whatsapp';
import CustomerIntelligenceCard from '@/components/CustomerIntelligenceCard';
import { gradeColor, birthdaysWithin, daysUntilBirthday, ageOnNextBirthday } from '@/lib/customers';
import { primaryAddress } from '@/lib/customerAddress';

function diffMinutes(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerProfile[]>(getCustomers());
  const [search, setSearch] = useState('');
  const [birthdaysOnly, setBirthdaysOnly] = useState(false);
  const [editing, setEditing] = useState<CustomerProfile | null>(null);
  const [viewing, setViewing] = useState<CustomerProfile | null>(null);
  const orders = useMemo(() => getOrders(), []);
  const riders = getRiders();

  const refresh = () => setCustomers(getCustomers());

  // Who to send a birthday offer to. The customer app collects the date; this
  // is the point of collecting it.
  const birthdaySoon = useMemo(() => birthdaysWithin(customers as any[], 7), [customers]);
  const birthdayIds = useMemo(
    () => new Set(birthdaySoon.map(b => (b.customer as any).id)),
    [birthdaySoon],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return customers
      .slice()
      .sort((a, b) => (b.lastOrderAt || '').localeCompare(a.lastOrderAt || ''))
      .filter(c => !s || c.name.toLowerCase().includes(s) || c.phone.includes(s)
        || (c.customerCode ?? '').toLowerCase().includes(s))
      .filter(c => !birthdaysOnly || birthdayIds.has(c.id));
  }, [customers, search, birthdaysOnly, birthdayIds]);

  const top = useMemo(() => customers.slice().sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 20), [customers]);

  // Rider performance: count delivered orders & avg dispatch→delivered time
  const riderStats = useMemo(() => {
    const map = new Map<string, { name: string; delivered: number; totalRevenue: number; avgMins: number; pending: number }>();
    riders.forEach(r => map.set(r.id, { name: r.name, delivered: 0, totalRevenue: 0, avgMins: 0, pending: 0 }));
    const totalsForAvg = new Map<string, { sum: number; n: number }>();
    orders.filter(o => o.orderType === 'delivery' && o.riderId).forEach(o => {
      const e = map.get(o.riderId!) || { name: o.riderName || 'Rider', delivered: 0, totalRevenue: 0, avgMins: 0, pending: 0 };
      if (o.deliveryStatus === 'delivered') {
        e.delivered += 1;
        e.totalRevenue += o.grandTotal || 0;
        const mins = diffMinutes(o.dispatchedAt, o.deliveredAt);
        if (mins !== null) {
          const t = totalsForAvg.get(o.riderId!) || { sum: 0, n: 0 };
          t.sum += mins; t.n += 1;
          totalsForAvg.set(o.riderId!, t);
        }
      } else if (o.deliveryStatus && o.deliveryStatus !== 'cancelled') {
        e.pending += 1;
      }
      map.set(o.riderId!, e);
    });
    for (const [id, t] of totalsForAvg.entries()) {
      const e = map.get(id); if (e) e.avgMins = Math.round(t.sum / t.n);
    }
    return Array.from(map.values()).sort((a, b) => b.delivered - a.delivered);
  }, [orders, riders]);

  const handleDelete = (id: string) => {
    if (!confirm('Delete this customer profile? Order history will remain.')) return;
    deleteCustomer(id); refresh();
  };

  const handleSave = (c: CustomerProfile) => {
    saveCustomer(c); refresh(); setEditing(null); toast.success('Customer saved');
  };

  const sendWhatsApp = (c: CustomerProfile) => {
    const p = normalizePhone(c.phone);
    if (!p) { toast.error('Invalid phone'); return; }
    openWhatsApp(p, `Dear ${c.name},\n\n`);
  };

  /**
   * ===== v1.51.0 — the spreadsheet library loaded with the PAGE, not the button
   *
   * `import * as XLSX from 'xlsx'` at the top of this file put 412 KB of
   * spreadsheet code into this page's chunk, so opening Customers — just to
   * LOOK at the list — downloaded and parsed all of it, on every visit, on a
   * till and on a phone. It is needed only when someone clicks Export.
   *
   * Loaded at the click instead. Nothing else changes: same output, same file.
   */
  const exportExcel = async (mode: 'full' | 'phones') => {
    const XLSX = await import('xlsx');
    const list = filtered.length ? filtered : customers;
    if (!list.length) { toast.error('No customers to export'); return; }
    // Build phone -> source map (latest order)
    const sourceByPhone = new Map<string, string>();
    for (const o of orders) {
      const ph = (o.customer?.phone || '').replace(/\D/g, '');
      if (ph && !sourceByPhone.has(ph)) sourceByPhone.set(ph, o.source || 'pos');
    }
    const rows = list.map(c => {
      const ph = (c.phone || '').replace(/\D/g, '');
      const src = sourceByPhone.get(ph) || 'pos';
      if (mode === 'phones') {
        return { Name: c.name, Phone: c.phone };
      }
      return {
        Name: c.name,
        Phone: c.phone,
        Address: primaryAddress(c),
        City: c.city || '',
        Area: c.area || '',
        Latitude: c.lat ?? '',
        Longitude: c.lng ?? '',
        TotalOrders: c.totalOrders,
        TotalSpent: c.totalSpent,
        AvgOrderValue: c.avgOrderValue || '',
        LastOrderDate: c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '',
        FirstOrderDate: c.firstOrderAt ? new Date(c.firstOrderAt).toLocaleDateString() : '',
        Grade: c.grade || '',
        Source: src.toUpperCase(),
        LoyaltyPoints: c.loyaltyPoints || 0,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mode === 'phones' ? 'Phones' : 'Customers');
    const fname = `customers-${mode}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success(`Exported ${rows.length} customers`);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2"><Users className="h-5 w-5" /> Customer Database</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <Badge variant="secondary">Total: {customers.length}</Badge>
          <Badge variant="secondary">Lifetime: {money(customers.reduce((s, c) => s + c.totalSpent, 0))}</Badge>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => exportExcel('full')}>
            <FileSpreadsheet className="h-3 w-3 mr-1" /> Export Excel
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => exportExcel('phones')}>
            <Download className="h-3 w-3 mr-1" /> Phones Only
          </Button>
        </div>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all"><Users className="h-3.5 w-3.5 mr-1" /> All Customers</TabsTrigger>
          <TabsTrigger value="top"><Trophy className="h-3.5 w-3.5 mr-1" /> Top Customers</TabsTrigger>
          <TabsTrigger value="riders"><Truck className="h-3.5 w-3.5 mr-1" /> Rider Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-3">
          <div className="relative max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input placeholder="Search by name or phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>

          {birthdaySoon.length > 0 && (
            <button
              type="button"
              onClick={() => setBirthdaysOnly(v => !v)}
              className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                birthdaysOnly ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
              }`}
            >
              <span className="text-sm font-semibold">
                🎂 {birthdaySoon.length} birthday{birthdaySoon.length === 1 ? '' : 's'} in the next 7 days
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {birthdaySoon.filter(b => b.daysUntil === 0).length} today ·{' '}
                {birthdaysOnly ? 'showing only these — tap to show everyone' : 'tap to see who'}
              </span>
            </button>
          )}
          {filtered.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No customers yet. Customers are auto-saved when delivery orders are paid.
            </Card>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(c => (
              <Card key={c.id} className="p-3 space-y-2">
                <div className="flex justify-between items-start">
                  {/* v1.32.0 — the photo the customer set in their own app, and
                    * the short code they can quote on the phone. Both read-only
                    * here: the code is generated by Postgres and the photo
                    * belongs to the customer. */}
                  <div className="flex items-start gap-2 min-w-0">
                    {c.photoUrl && (
                      <img
                        src={c.photoUrl}
                        alt=""
                        className="h-9 w-9 rounded-full object-cover border shrink-0"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</div>
                      {c.customerCode && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{c.customerCode}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                   <div className="text-sm font-bold text-primary">{money(c.totalSpent)}</div>
                   <div className="text-[10px] text-muted-foreground">{c.totalOrders} orders</div>
                   <div className="flex items-center gap-1 justify-end mt-1 flex-wrap">
                     {c.grade && (
                       <Badge className={`${gradeColor(c.grade)} text-[9px] uppercase`}>{c.grade}</Badge>
                     )}
                     {(() => {
                       const d = daysUntilBirthday((c as any).dateOfBirth);
                       if (d == null || d > 7) return null;
                       const age = ageOnNextBirthday((c as any).dateOfBirth);
                       return (
                         <Badge className="bg-primary/15 text-primary border border-primary/40 text-[9px]">
                           🎂 {d === 0 ? 'Today' : `${d}d`}{age ? ` · ${age}` : ''}
                         </Badge>
                       );
                     })()}
                     {(c.loyaltyPoints || 0) > 0 && (
                       <Badge className="bg-gold/15 text-gold border border-gold/40 text-[9px]">
                         🏆 {c.loyaltyPoints} pts
                       </Badge>
                     )}
                   </div>
                  </div>
                </div>
                {primaryAddress(c) && (
                  <div className="text-[11px] text-muted-foreground flex items-start gap-1">
                    <MapPin className="h-3 w-3 mt-0.5 shrink-0" /> <span>{primaryAddress(c)}</span>
                  </div>
                )}
                {c.lastOrderAt && (
                  <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Last: {new Date(c.lastOrderAt).toLocaleDateString()}
                  </div>
                )}
                {c.tags && c.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {c.tags.map(t => <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>)}
                  </div>
                )}
                <div className="flex gap-1 pt-1 border-t">
                  <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={() => setViewing(c)}>
                    <Eye className="h-3 w-3 mr-1" /> View
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditing(c)}>
                    <Edit3 className="h-3 w-3" />
                  </Button>
                  <Button size="sm" className="h-7 px-2 bg-[#25D366] hover:bg-[#1ebe57] text-white" onClick={() => sendWhatsApp(c)}>
                    <MessageCircle className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleDelete(c.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="top">
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2 text-muted-foreground">Top 20 customers by lifetime spend</div>
            <div className="space-y-1">
              {top.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/40">
                  <div className="h-7 w-7 rounded-full bg-gradient-gold text-primary text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground">{c.phone} • {c.totalOrders} orders</div>
                  </div>
                  <div className="text-sm font-bold text-primary">{money(c.totalSpent)}</div>
                </div>
              ))}
              {top.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No data yet.</div>}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="riders">
          <Card className="p-3">
            <div className="text-xs font-semibold mb-2 text-muted-foreground">Rider performance summary (all-time)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Rider</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Avg. Time</th>
                  </tr>
                </thead>
                <tbody>
                  {riderStats.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.name}</td>
                      <td className="text-right">{r.delivered}</td>
                      <td className="text-right">{r.pending}</td>
                      <td className="text-right">{money(r.totalRevenue)}</td>
                      <td className="text-right">{r.avgMins ? `${r.avgMins} min` : '—'}</td>
                    </tr>
                  ))}
                  {riderStats.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No riders configured.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-muted-foreground mt-2">
              Avg. Time = time between Dispatched → Delivered.
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Customer</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Name" />
              <Input value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} placeholder="Phone" />
              <Textarea
                value={editing.addresses.join('\n')}
                onChange={e => setEditing({ ...editing, addresses: e.target.value.split('\n').filter(Boolean) })}
                placeholder="Addresses (one per line)" rows={3}
              />
              <Input
                value={(editing.tags || []).join(', ')}
                onChange={e => setEditing({ ...editing, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                placeholder="Tags (comma separated, e.g. VIP, Regular)"
              />
              <Textarea
                value={editing.notes || ''}
                onChange={e => setEditing({ ...editing, notes: e.target.value })}
                placeholder="Notes" rows={2}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={() => handleSave(editing)}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {viewing && (
        <Dialog open onOpenChange={() => setViewing(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Customer Intelligence</DialogTitle></DialogHeader>
            <CustomerIntelligenceCard customer={viewing} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
