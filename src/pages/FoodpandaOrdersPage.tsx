import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getOrders, getSettings, saveOrder, saveSettings, onDataChange, refreshOrdersFromCloud } from '@/lib/store';
import { Order, FoodpandaStatus, RestaurantSettings } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bike, Power, Search, ArrowRight, X } from 'lucide-react';
import { toast } from 'sonner';

const PIPELINE: FoodpandaStatus[] = ['new', 'preparing', 'ready', 'picked', 'cancelled'];
const NEXT: Record<FoodpandaStatus, FoodpandaStatus | null> = {
  new: 'preparing', preparing: 'ready', ready: 'picked', picked: null, cancelled: null,
};

export default function FoodpandaOrdersPage() {
  const [settings, setSettings] = useState<RestaurantSettings>(() => getSettings());
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [tab, setTab] = useState<'all' | FoodpandaStatus>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    refreshOrdersFromCloud().then(() => setOrders(getOrders())).catch(() => {});
    const off = onDataChange((col) => {
      if (col === 'orders' || col === '*') setOrders(getOrders());
      if (col === 'settings') setSettings(getSettings());
    });
    return () => off();
  }, []);

  const fpOrders = useMemo(
    () => orders.filter(o => o.orderType === 'foodpanda')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [orders],
  );

  const filtered = useMemo(() => {
    let arr = fpOrders;
    if (tab !== 'all') arr = arr.filter(o => (o.foodpandaStatus || 'new') === tab);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter(o =>
      o.orderNumber.toString().includes(q) ||
      (o.foodpandaRef || '').toLowerCase().includes(q) ||
      (o.customer?.name || '').toLowerCase().includes(q),
    );
    return arr;
  }, [fpOrders, tab, search]);

  const counts: Record<string, number> = { all: fpOrders.length };
  PIPELINE.forEach(s => { counts[s] = fpOrders.filter(o => (o.foodpandaStatus || 'new') === s).length; });

  const setStatus = (o: Order, s: FoodpandaStatus) => {
    const updated: Order = {
      ...o,
      foodpandaStatus: s,
      foodpandaStatusAt: new Date().toISOString(),
      ...(s === 'picked' ? { foodpandaPickedAt: new Date().toISOString() } : {}),
      ...(s === 'cancelled' ? { foodpandaCancelledAt: new Date().toISOString(), status: 'cancelled' as const } : {}),
      ...(s === 'picked' ? { status: 'paid' as const, paidAt: o.paidAt || new Date().toISOString() } : {}),
    };
    saveOrder(updated);
    toast.success(`Order #${o.orderNumber} → ${s.toUpperCase()}`);
  };

  const enabled = settings.foodpandaEnabled === true;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-pink-500 to-orange-500 text-white flex items-center justify-center shadow-md">
          <Bike className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight">Foodpanda Orders</h1>
          <p className="text-[11px] text-muted-foreground">A separate dashboard for Foodpanda orders — manage the status pipeline here.</p>
        </div>
        <Button
          variant={enabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => { const next = !enabled; saveSettings({ ...settings, foodpandaEnabled: next }); setSettings({ ...settings, foodpandaEnabled: next }); toast.success(`Foodpanda mode ${next ? 'enabled' : 'disabled'}`); }}
          className={enabled ? 'bg-pink-600 hover:bg-pink-700' : ''}
        >
          <Power className="h-3.5 w-3.5 mr-1" /> {enabled ? 'ENABLED' : 'DISABLED'}
        </Button>
      </div>

      {!enabled && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <p className="text-sm">
            <b>Foodpanda mode OFF hai.</b> POS me sirf <b>Dine-In / Takeaway / Delivery</b> dikhega.
            Enable karne ke liye upar wala button dabayein — phir POS me 4th order type "Foodpanda" aa jaye gi.
          </p>
        </Card>
      )}

      <Card className="p-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search bill #, customer, Foodpanda ref…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9 text-sm" />
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            {PIPELINE.map(s => (
              <TabsTrigger key={s} value={s} className="capitalize">{s} ({counts[s] || 0})</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Card>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No Foodpanda orders.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(o => {
            const s = (o.foodpandaStatus || 'new') as FoodpandaStatus;
            const next = NEXT[s];
            return (
              <Card key={o.id} className="p-3 space-y-1.5 border-pink-500/30 bg-pink-500/5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">#{o.orderNumber}</span>
                  <Badge className="bg-pink-600 text-white capitalize text-[10px]">{s}</Badge>
                </div>
                {o.foodpandaRef && <p className="text-[11px] font-mono text-pink-700">FP Ref: {o.foodpandaRef}</p>}
                {o.customer?.name && <p className="text-[11px] text-muted-foreground truncate">{o.customer.name}</p>}
                <p className="text-xs">{o.items.length} items · <b className="text-primary">{money(o.grandTotal)}</b></p>
                <p className="text-[10px] text-muted-foreground">{new Date(o.createdAt).toLocaleString('en-PK')}</p>
                <div className="flex gap-1.5 pt-1">
                  {next && (
                    <Button size="sm" className="flex-1 h-7 text-[11px] bg-pink-600 hover:bg-pink-700" onClick={() => setStatus(o, next)}>
                      <ArrowRight className="h-3 w-3 mr-1" /> Mark {next}
                    </Button>
                  )}
                  {s !== 'cancelled' && s !== 'picked' && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] border-destructive text-destructive hover:bg-destructive/10" onClick={() => setStatus(o, 'cancelled')}>
                      <X className="h-3 w-3 mr-1" /> Cancel
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
