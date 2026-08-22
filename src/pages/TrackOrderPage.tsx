import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { money } from '@/lib/currency';
import { initStore, getOrders, getSettings, refreshOrdersFromCloud, getOrderFromCloudById, getOrderFromCloudByLookup } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Order } from '@/lib/types';
import { Search, CheckCircle2, Clock, ChefHat, Package, Bike, MapPin, PhoneCall, ArrowLeft, BellRing, BellOff } from 'lucide-react';
import WhatsAppFloat from '@/components/WhatsAppFloat';
const DeliveryRouteMap = lazy(() => import('@/components/DeliveryRouteMap'));

// Browser-safe beep with user-gesture unlocked AudioContext
let _trackCtx: AudioContext | null = null;
function ensureTrackAudio() {
  try {
    if (!_trackCtx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      _trackCtx = new Ctx();
    }
    if (_trackCtx!.state === 'suspended') _trackCtx!.resume().catch(() => {});
    return _trackCtx;
  } catch { return null; }
}
function trackBeep() {
  const ctx = ensureTrackAudio();
  if (!ctx) return;
  const beep = (freq: number, when: number, dur = 0.3) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, ctx.currentTime + when);
    g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + when + 0.02);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + when + dur);
    o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.05);
  };
  beep(880, 0); beep(1320, 0.35); beep(880, 0.7); beep(1320, 1.05);
  try { (navigator as any).vibrate?.([300, 150, 300, 150, 300]); } catch {}
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('🎉 Order Ready for Pickup!', { body: 'Your order is ready — please come to the counter', tag: 'dt-ready' });
    }
  } catch {}
}

/**
 * Public Live Order Tracking page
 * Route: #/track  — customer enters order # + phone (last 4) and sees live status.
 * Auto-refreshes every 10s. Shows status timeline + rider GPS if available.
 */
export default function TrackOrderPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => { initStore().then(() => setReady(true)).catch(() => setReady(true)); }, []);

  const settings = useMemo(() => ready ? getSettings() : ({} as any), [ready]);

  // Prefill from hash query: #/track?o=123&p=03001234567&t=Table%205
  const initial = useMemo(() => {
    if (typeof window === 'undefined') return { id: '', o: '', p: '', t: '' };
    const h = window.location.hash;
    const q = h.includes('?') ? h.split('?')[1] : '';
    const sp = new URLSearchParams(q);
    return { id: sp.get('id') || '', o: sp.get('o') || '', p: sp.get('p') || '', t: sp.get('t') || '' };
  }, []);

  const [orderNo, setOrderNo] = useState(initial.o);
  const [phoneLast, setPhoneLast] = useState(initial.p);
  const [tableLabel, setTableLabel] = useState(initial.t);
  const [order, setOrder] = useState<Order | null>(null);
  const [tick, setTick] = useState(0);

  const [searching, setSearching] = useState(false);
  // Search — order# alone OK (takeaway token), or with phone/table for extra verification
  // FIX (#3): Always pull from Firebase first; do NOT depend on local cache.
  const findOrder = async () => {
    if (!orderNo.trim() && !initial.id) { toast.error('Order # likhein'); return; }
    const num = parseInt(orderNo.trim(), 10);
    const last4 = phoneLast.replace(/\D/g, '').slice(-4);
    const tNorm = tableLabel.trim().toLowerCase();
    setSearching(true);
    const byId = initial.id ? await getOrderFromCloudById(initial.id) : null;
    const match = (o: Order) => {
      if (Number.isFinite(num) && o.orderNumber !== num) return false;
      if (!last4 && !tNorm) return true;
      const phoneMatch = last4 && (o.customer?.phone || '').replace(/\D/g, '').slice(-4) === last4;
      const tableMatch = tNorm && ((o as any).tableLabel || '').toLowerCase().includes(tNorm);
      return phoneMatch || tableMatch;
    };
    let found = byId && match(byId) ? byId : null;
    if (!found && Number.isFinite(num)) found = await getOrderFromCloudByLookup(num, last4, tNorm);
    if (!found) { try { await refreshOrdersFromCloud(); } catch {} }
    if (!found) found = getOrders().find(match) ?? null;
    // Retry once after a small delay in case the snapshot was still in flight
    if (!found) {
      await new Promise(r => setTimeout(r, 800));
      if (initial.id) found = await getOrderFromCloudById(initial.id);
      if (!found && Number.isFinite(num)) found = await getOrderFromCloudByLookup(num, last4, tNorm);
      if (!found) { try { await refreshOrdersFromCloud(); } catch {} }
      if (!found) found = getOrders().find(match) ?? null;
    }
    setSearching(false);
    if (!found) { toast.error('Order not found. Check the order # / last 4 digits of the mobile.'); return; }
    setOrder(found);
  };

  // Auto-refresh every 10s if order is loaded and not completed
  useEffect(() => {
    if (!order) return;
    if (order.deliveryStatus === 'delivered' || order.deliveryStatus === 'cancelled') return;
    // P8 fix: also stop polling for non-delivery orders once they reach a terminal state
    if (!order.deliveryStatus && (order.status === 'paid' || order.status === 'credit_received' || order.status === 'void' || order.status === 'cancelled')) return;
    const t = setInterval(async () => {
      // P3 fix: public route can GET a single order but cannot LIST all orders.
      let fresh: Order | null = null;
      try { fresh = await getOrderFromCloudById(order.id); } catch {}
      if (!fresh) fresh = getOrders().find(o => o.id === order.id) || null;
      if (fresh) setOrder(fresh);
      setTick(x => x + 1);
    }, 10000);
    return () => clearInterval(t);
  }, [order]);

  // Auto-search if URL had order# (allow phone/table as extra)
  useEffect(() => {
    if (ready && initial.o && !order) findOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Alerts: ring on transition into "ready"
  const [alertsOn, setAlertsOn] = useState<boolean>(false);
  const prevReadyRef = useRef<boolean>(false);
  useEffect(() => {
    if (!order) return;
    const ks = order.kitchenStatus || 'pending';
    const ds = order.deliveryStatus || 'pending';
    const isReady = ks === 'ready' || ['ready', 'onway', 'rider_picked', 'rider_reached', 'delivered'].includes(ds) || (order as any).pickupCollectedAt;
    if (alertsOn && isReady && !prevReadyRef.current) {
      trackBeep();
      toast.success('🎉 Your order is ready for pickup!');
    }
    prevReadyRef.current = isReady;
  }, [order, alertsOn]);
  const enableAlerts = () => {
    ensureTrackAudio();
    try { if ('Notification' in window && Notification.permission !== 'granted') Notification.requestPermission().catch(() => {}); } catch {}
    setAlertsOn(true);
    toast.success('🔔 Alerts enabled');
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background">
      <WhatsAppFloat />
      {/* Header */}
      <header className="bg-gradient-hero text-primary-foreground shadow-elegant">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {(settings.webPortalLogo || settings.logo) && <img src={settings.webPortalLogo || settings.logo} alt="" className="h-10 w-10 rounded object-cover bg-white/10 p-0.5" />}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-extrabold truncate">{settings.name || 'Restaurant'}</h1>
            <p className="text-[11px] opacity-80">Live Order Tracking</p>
          </div>
          <a href="#/order" className="text-[11px] underline opacity-90">Order again</a>
        </div>
      </header>
      {order && (
        <div className="max-w-2xl mx-auto px-4 pt-3">
          {!alertsOn ? (
            <button onClick={enableAlerts} className="w-full py-2 rounded-lg bg-amber-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow">
              <BellRing className="h-4 w-4" /> Enable order alerts (beep/notification when ready)
            </button>
          ) : (
            <div className="w-full py-2 rounded-lg bg-emerald-500/15 text-emerald-700 text-xs font-bold flex items-center justify-center gap-2 border border-emerald-500/40">
              <BellRing className="h-4 w-4" /> Alerts on — aap ko order ready hote hi beep aayegi
            </div>
          )}
        </div>
      )}

      <main className="max-w-2xl mx-auto p-4">
        {!order ? (
          <div className="bg-card border rounded-2xl shadow-card p-5 space-y-3">
            <h2 className="text-sm font-extrabold flex items-center gap-2"><Search className="h-4 w-4" /> Track your order</h2>
            <p className="text-[11px] text-muted-foreground">Track by order # alone. Mobile (last 4) or table number are optional, for extra verification.</p>
            <Input placeholder="Order # (e.g. 1024)" value={orderNo} onChange={e => setOrderNo(e.target.value)} className="h-10" />
            <Input placeholder="Mobile ke last 4 digits (optional)" value={phoneLast} onChange={e => setPhoneLast(e.target.value)} maxLength={6} className="h-10" />
            <Input placeholder="Ya Table no (e.g. Table 5)" value={tableLabel} onChange={e => setTableLabel(e.target.value)} className="h-10" />
            <Button onClick={findOrder} disabled={searching} className="w-full h-11 font-bold">
              <Search className="h-4 w-4 mr-1" /> {searching ? 'Searching…' : 'Track Order'}
            </Button>
          </div>
        ) : (
          <OrderStatus order={order} settings={settings} onBack={() => setOrder(null)} tick={tick} />
        )}
      </main>
    </div>
  );
}

function OrderStatus({ order, settings, onBack, tick }: { order: Order; settings: any; onBack: () => void; tick: number }) {
  const status = order.deliveryStatus || 'pending';
  const kStatus = order.kitchenStatus || 'pending';
  // A tracked order comes from an RPC, so it never passed through the row
  // mapper that defaults these arrays. Rendering `order.items.length` on the
  // raw payload is what produced "Cannot read properties of undefined".
  const items = Array.isArray(order.items) ? order.items : [];
  const isDineIn = !!(order as any).tableLabel || (order as any).orderType === 'dine-in' || (order as any).type === 'dine-in';

  // Build timeline steps — dine-in skips delivery and ends at "Served"
  const steps = isDineIn ? [
    { key: 'placed', label: 'Order Placed', icon: CheckCircle2, done: true, at: order.createdAt },
    { key: 'cooking', label: 'Kitchen Cooking', icon: ChefHat, done: kStatus === 'preparing' || kStatus === 'ready' || kStatus === 'served', at: order.kitchenStatusAt },
    { key: 'ready', label: 'Ready to Serve', icon: Package, done: kStatus === 'ready' || kStatus === 'served', at: undefined },
    { key: 'served', label: 'Served', icon: CheckCircle2, done: kStatus === 'served', at: (order as any).servedAt },
  ] : [
    { key: 'placed', label: 'Order Placed', icon: CheckCircle2, done: true, at: order.createdAt },
    { key: 'cooking', label: 'Kitchen Cooking', icon: ChefHat, done: kStatus === 'preparing' || kStatus === 'ready' || kStatus === 'served' || ['ready', 'onway', 'rider_picked', 'rider_reached', 'delivered'].includes(status), at: order.kitchenStatusAt },
    { key: 'ready', label: 'Ready for Pickup', icon: Package, done: kStatus === 'ready' || kStatus === 'served' || ['ready', 'onway', 'rider_picked', 'rider_reached', 'delivered'].includes(status), at: undefined },
    { key: 'onway', label: 'On the Way', icon: Bike, done: ['onway', 'rider_picked', 'rider_reached', 'delivered'].includes(status), at: order.delivery?.onTheWayAt || order.dispatchedAt },
    { key: 'delivered', label: 'Delivered', icon: CheckCircle2, done: status === 'delivered', at: order.deliveredAt },
  ];

  const isCancelled = status === 'cancelled';
  const activeIndex = isCancelled ? -1 : steps.findIndex(s => !s.done);
  const completedLabel = isDineIn ? 'Served' : 'Delivered';
  const currentLabel = isCancelled ? 'Cancelled' : activeIndex === -1 ? completedLabel : steps[activeIndex - 1]?.label || 'Order Placed';

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="text-[11px] text-muted-foreground">Auto-refresh every 10s · #{tick}</div>
      </div>

      {/* Hero status card */}
      <div className={`rounded-2xl p-5 shadow-elegant border-2 ${isCancelled ? 'bg-destructive/10 border-destructive/30' : 'bg-gradient-to-br from-primary/10 via-accent/20 to-secondary/10 border-primary/20'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold">Order #</p>
            <p className="text-3xl font-extrabold text-primary">#{order.orderNumber}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold">Total</p>
            <p className="text-2xl font-extrabold">{money(order.grandTotal)}</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-primary/20">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-bold mb-1">Status</p>
          <p className={`text-xl font-extrabold ${isCancelled ? 'text-destructive' : 'text-foreground'}`}>{currentLabel}</p>
        </div>
      </div>

      {/* Timeline */}
      {!isCancelled && (
        <div className="bg-card border rounded-2xl shadow-card p-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-3">Progress</h3>
          <div className="space-y-3">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isCurrent = !s.done && i === activeIndex;
              const isDone = s.done;
              return (
                <div key={s.key} className="flex items-start gap-3">
                  <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${
                    isDone ? 'bg-status-success text-white'
                    : isCurrent ? 'bg-gold text-foreground animate-pulse'
                    : 'bg-muted text-muted-foreground'
                  }`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 pt-1.5">
                    <p className={`text-sm font-bold ${isDone || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</p>
                    {isDone && s.at && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" /> {new Date(s.at).toLocaleTimeString()}
                      </p>
                    )}
                    {isCurrent && <p className="text-[10px] text-gold font-bold mt-0.5">In progress…</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rider info */}
      {order.riderName && (
        <div className="bg-card border rounded-2xl shadow-card p-4 space-y-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Your Rider</h3>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-lg">
              <Bike className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-extrabold">{order.riderName}</p>
              {order.riderPhone && <p className="text-[11px] text-muted-foreground">{order.riderPhone}</p>}
            </div>
            {order.riderPhone && (
              <a href={`tel:${order.riderPhone}`} className="inline-flex items-center gap-1 bg-status-success text-white px-3 py-2 rounded-lg text-xs font-bold">
                <PhoneCall className="h-3.5 w-3.5" /> Call
              </a>
            )}
          </div>
          {(() => {
            const s = getSettings();
            const branch = (s?.restaurantLat != null && s?.restaurantLng != null) ? { lat: s.restaurantLat, lng: s.restaurantLng } : null;
            const rider = (order.delivery?.riderLat != null && order.delivery?.riderLng != null) ? { lat: order.delivery.riderLat, lng: order.delivery.riderLng } : null;
            const customer = (order.delivery?.customerLat != null && order.delivery?.customerLng != null) ? { lat: order.delivery.customerLat, lng: order.delivery.customerLng } : null;
            if (!rider && !customer) return null;
            return <div className="mt-2"><Suspense fallback={<div className="h-[240px] bg-muted rounded animate-pulse" />}><DeliveryRouteMap branch={branch} rider={rider} customer={customer} height={240} /></Suspense></div>;
          })()}
          {order.delivery?.etaMinutes != null && (
            <p className="text-center text-xs"><span className="text-muted-foreground">ETA:</span> <span className="font-extrabold">{order.delivery.etaMinutes} min</span></p>
          )}
        </div>
      )}

      {/* Items summary */}
      <div className="bg-card border rounded-2xl shadow-card p-4">
        {/* The tracked order arrives from an RPC, not a table read, so it is
            normalised by normalizeTrackedOrder(). Reading it through a local
            const as well keeps this render safe even if that ever changes —
            `order.items.length` on an undefined array is the exact crash this
            page shipped with. */}
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-2">Items ({items.length})</h3>
        <div className="space-y-1.5">
          {items.map(i => (
            <div key={i.id} className="flex justify-between text-xs">
              <span>{i.name} <span className="text-muted-foreground">× {i.quantity}</span></span>
              <span className="font-semibold">{money(i.lineTotal)}</span>
            </div>
          ))}
        </div>
        <div className="border-t mt-2 pt-2 space-y-1 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(order.subtotal)}</span></div>
          {order.discount > 0 && <div className="flex justify-between text-status-success"><span>Discount</span><span>-{money(order.discount)}</span></div>}
          <div className="flex justify-between text-sm font-extrabold pt-1 border-t"><span>Total</span><span className="text-primary">{money(order.grandTotal)}</span></div>
        </div>
      </div>

      {/* Restaurant contact */}
      {settings.phone1 && (
        <div className="text-center pb-6">
          <p className="text-[11px] text-muted-foreground">Need help?</p>
          <a href={`tel:${settings.phone1}`} className="text-sm font-extrabold text-primary inline-flex items-center gap-1 mt-1">
            <PhoneCall className="h-3.5 w-3.5" /> {settings.phone1}
          </a>
        </div>
      )}
    </div>
  );
}
