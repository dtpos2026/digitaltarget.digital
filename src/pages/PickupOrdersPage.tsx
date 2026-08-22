import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Package, Phone, User, Clock, Search, CheckCircle2, Printer, MessageCircle,
  RefreshCw, Hash, Calendar, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { getOrders, saveOrder, getSettings, refreshOrdersFromCloud } from '@/lib/store';
import { Order } from '@/lib/types';
import { normalizePhone, openWhatsApp } from '@/lib/whatsapp';
import ReceiptPreview from '@/components/ReceiptPreview';
import ReadyNotificationBus from '@/components/ReadyNotificationBus';
import ReadyOrderPoller from '@/components/ReadyOrderPoller';

/** A pickup order is a Self-Pickup / takeaway order placed from website or POS. */
function isPickupOrder(o: Order): boolean {
  if (o.status === 'void' || o.status === 'cancelled') return false;
  if (o.pickupRequested) return true;
  // P6 fix: include in-store takeaway orders so kitchen-ready ones appear here too.
  if ((o.orderType as any) === 'takeaway') return true;
  return false;
}

function pickupReadyAt(o: Order): number | null {
  if (!o.pickupTime) return null;
  // pickupTime may be "30 min" or ISO
  const m = String(o.pickupTime).match(/(\d+)\s*min/i);
  if (m) {
    const created = new Date(o.createdAt).getTime();
    return created + parseInt(m[1], 10) * 60_000;
  }
  const t = Date.parse(o.pickupTime);
  return isNaN(t) ? null : t;
}

function fmtClock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function PickupOrdersPage() {
  const settings = getSettings();
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'awaiting' | 'collected'>('awaiting');
  const [printOrder, setPrintOrder] = useState<Order | null>(null);

  // Live refresh — pickup orders may come from website
  useEffect(() => {
    let cancel = false;
    const pull = async () => {
      await refreshOrdersFromCloud();
      if (!cancel) setOrders(getOrders());
    };
    pull();
    const t = setInterval(pull, 8000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  const pickups = useMemo(() => orders.filter(isPickupOrder), [orders]);

  const awaiting = useMemo(() => pickups
    .filter(o => o.status !== 'paid' && o.status !== 'credit_received')
    .filter(o => filterText(o, search))
    .sort((a, b) => (pickupReadyAt(a) || 0) - (pickupReadyAt(b) || 0)),
    [pickups, search]);

  const collected = useMemo(() => pickups
    .filter(o => o.status === 'paid' || o.status === 'credit_received')
    .filter(o => filterText(o, search))
    .sort((a, b) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime())
    .slice(0, 50),
    [pickups, search]);

  const totalAwaiting = awaiting.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const totalCollected = collected.reduce((s, o) => s + (o.grandTotal || 0), 0);

  const collectAndPrint = (o: Order) => {
    const now = new Date().toISOString();
    const updated: Order = {
      ...o,
      status: 'paid',
      paidAt: now,
      paymentMethod: o.paymentMethod || 'cash',
      ...( { pickupCollectedAt: now } as any ),
    };
    saveOrder(updated);
    setOrders(prev => prev.map(x => x.id === o.id ? updated : x));
    setPrintOrder(updated);
    toast.success(`#${o.orderNumber} collected — printing bill`);
  };

  const sendReadyMessage = (o: Order) => {
    const phone = normalizePhone(o.customer?.phone);
    if (!phone) { toast.error('Customer phone not available'); return; }
    const msg = (settings.pickupReadyMessage || `🍽️ {name}, your order #{number} is ready for pickup. Please collect it from the counter.`)
      .replace(/\{name\}/g, o.customer?.name || 'Customer')
      .replace(/\{number\}/g, String(o.orderNumber));
    openWhatsApp(phone, msg);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <ReadyNotificationBus />
      <ReadyOrderPoller types={['takeaway']} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" /> Pickup Orders
        </h2>
        <Button size="sm" variant="outline" onClick={async () => { await refreshOrdersFromCloud(); setOrders(getOrders()); }}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Awaiting Pickup" value={awaiting.length.toString()} color="text-amber-600" />
        <Kpi label="Awaiting Rs." value={`${money(totalAwaiting)}`} color="text-amber-600" />
        <Kpi label="Collected (recent)" value={collected.length.toString()} color="text-green-600" />
        <Kpi label="Collected Rs." value={`${money(totalCollected)}`} color="text-green-600" />
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Search by order #, name or phone" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="awaiting">Awaiting Pickup ({awaiting.length})</TabsTrigger>
          <TabsTrigger value="collected">Collected ({collected.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="awaiting" className="mt-3">
          {awaiting.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Koi pickup order pending nahi. Website ya POS se naya Self-Pickup order yahan show hoga.
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {awaiting.map(o => <PickupCard key={o.id} order={o} onCollect={collectAndPrint} onSendReady={sendReadyMessage} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="collected" className="mt-3">
          {collected.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No collected pickups yet.</Card>
          ) : (
            <div className="grid gap-2">
              {collected.map(o => (
                <Card key={o.id} className="p-3 flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">#{o.orderNumber} — {o.customer?.name || 'Walk-in'}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {o.customer?.phone || ''} · {o.paidAt ? new Date(o.paidAt).toLocaleString() : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-primary">{money(o.grandTotal)}</div>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setPrintOrder(o)}>
                      <Printer className="h-3 w-3 mr-1" /> Reprint
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Hidden print mount — auto-prints when set */}
      {printOrder && (
        <div className="fixed -left-[9999px] top-0 pointer-events-none" aria-hidden>
          <ReceiptPreview
            key={printOrder.id + '_' + (printOrder.paidAt || '')}
            order={printOrder}
            settings={settings}
            autoPrint
            showPrintButton={false}
          />
        </div>
      )}
    </div>
  );
}

function PickupCard({ order: o, onCollect, onSendReady }: {
  order: Order;
  onCollect: (o: Order) => void;
  onSendReady: (o: Order) => void;
}) {
  const ready = pickupReadyAt(o);
  const now = Date.now();
  const overdue = ready != null && now > ready;
  const minsLeft = ready != null ? Math.round((ready - now) / 60000) : null;
  const hasPhone = !!normalizePhone(o.customer?.phone);
  const srcLabel = (o.source || 'pos').toUpperCase();
  const srcColor = o.source === 'website' ? 'bg-emerald-600' : o.source === 'order_taker' ? 'bg-amber-600' : 'bg-blue-600';

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`${srcColor} text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded`}>{srcLabel}</span>
          <span className="font-bold text-sm flex items-center gap-0.5"><Hash className="h-3 w-3" />{o.orderNumber}</span>
        </div>
        <Badge variant={overdue ? 'destructive' : 'secondary'} className="text-[10px]">
          <Clock className="h-3 w-3 mr-1" />
          {ready
            ? (overdue ? `Overdue ${Math.abs(minsLeft!)}m` : `Ready in ${minsLeft}m`)
            : 'No time set'}
        </Badge>
      </div>

      <div className="text-[11px] space-y-0.5">
        <div className="flex items-center gap-1"><User className="h-3 w-3 text-muted-foreground" /> <span className="font-medium">{o.customer?.name || 'Walk-in'}</span></div>
        <div className="flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" /> {o.customer?.phone || '—'}</div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Calendar className="h-3 w-3" /> Placed {fmtClock(new Date(o.createdAt).getTime())}
          {ready && <> · Ready {fmtClock(ready)}</>}
        </div>
      </div>

      <div className="rounded border bg-muted/30 p-2 text-[11px] max-h-28 overflow-auto">
        {o.items.map((it, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="truncate">{it.quantity}× {it.name}</span>
            <span className="text-muted-foreground">{money((it.price * it.quantity))}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm font-bold">
        <span className="flex items-center gap-1 text-muted-foreground text-[11px]"><Wallet className="h-3 w-3" /> Total</span>
        <span className="text-primary">{money(o.grandTotal)}</span>
      </div>

      <div className="flex gap-1.5">
        <Button
          size="sm"
          disabled={!hasPhone}
          variant="outline"
          className="flex-1 h-8 text-[11px] bg-[#25D366]/10 hover:bg-[#25D366]/20"
          onClick={() => onSendReady(o)}
        >
          <MessageCircle className="h-3 w-3 mr-1" /> Ready msg
        </Button>
        <Button
          size="sm"
          className="flex-1 h-8 text-[11px]"
          onClick={() => onCollect(o)}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" /> Pay & Print
        </Button>
      </div>
    </Card>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-extrabold ${color || ''}`}>{value}</div>
    </Card>
  );
}

function filterText(o: Order, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    String(o.orderNumber).includes(s) ||
    (o.customer?.name || '').toLowerCase().includes(s) ||
    (o.customer?.phone || '').includes(s)
  );
}
