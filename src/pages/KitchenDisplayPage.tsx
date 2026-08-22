import { useState, useEffect, useMemo, useRef } from 'react';
import { getOrders, getSettings, getKitchens, getMenuItems, setOrderKitchenStatus, onDataChange } from '@/lib/store';
import { Order, RestaurantSettings, CartItem } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, CheckCircle, ChefHat, AlertTriangle, ChefHat as PrepIcon, Bell, Check, Maximize2, Minimize2, Volume2, VolumeX, ThumbsUp, Truck, Tv } from 'lucide-react';
import { ENABLE_REDUNDANT_ORDER_POLL } from '@/lib/featureFlags';

function getTimerInfo(createdAt: string, settings: RestaurantSettings) {
  const preparingThreshold = Math.max(1, settings.kitchenPreparingMinutes || 5);
  const warningThreshold = Math.max(preparingThreshold + 1, settings.kitchenWarningMinutes || 10);
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  let label: string;
  let color: string;
  let progressColor: string;

  if (mins < preparingThreshold) {
    label = `${mins}m — Preparing`;
    color = 'text-status-success';
    progressColor = 'bg-status-success';
  } else if (mins < warningThreshold) {
    label = `${mins}m — In Progress`;
    color = 'text-status-warning';
    progressColor = 'bg-status-warning';
  } else {
    label = `${mins}m — DELAYED ⚠️`;
    color = 'text-status-danger';
    progressColor = 'bg-status-danger';
  }

  const progress = Math.min((mins / Math.max(warningThreshold + 5, 15)) * 100, 100);
  return { mins, label, color, progress, progressColor };
}

const KITCHEN_KEY = 'pos-kds-active-kitchen';
const SOUND_KEY = 'pos-kds-sound';

// Web Audio beep — no asset required (works on Smart TV / Android TV / browsers)
function playBeep(urgent = false) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = urgent ? 'square' : 'sine';
    o.frequency.value = urgent ? 880 : 660;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (urgent ? 0.8 : 0.35));
    o.start();
    o.stop(ctx.currentTime + (urgent ? 0.85 : 0.4));
    if (urgent) {
      setTimeout(() => playBeep(false), 300);
      setTimeout(() => playBeep(false), 600);
    }
  } catch {}
}

export default function KitchenDisplayPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [, setTick] = useState(0);
  const [settings, setSettings] = useState<RestaurantSettings>(() => getSettings());
  const kitchens = useMemo(() => getKitchens(), []);
  const menuItems = useMemo(() => getMenuItems(), []);
  const itemKitchen = useMemo(() => {
    const m = new Map<string, string | undefined>();
    menuItems.forEach(mi => m.set(mi.id, mi.kitchenId));
    return m;
  }, [menuItems]);

  const [activeKitchen, setActiveKitchen] = useState<string>(() => localStorage.getItem(KITCHEN_KEY) || 'all');
  const [soundOn, setSoundOn] = useState<boolean>(() => localStorage.getItem(SOUND_KEY) !== '0');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const knownOrderIds = useRef<Set<string>>(new Set());
  const isFirstLoad = useRef(true);

  useEffect(() => { localStorage.setItem(KITCHEN_KEY, activeKitchen); }, [activeKitchen]);
  useEffect(() => { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); }, [soundOn]);

  // Fullscreen API
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const refresh = () => {
      setSettings(getSettings());
      const all = getOrders().filter(o => {
        if (o.status === 'void' || o.status === 'cancelled') return false;
        // Rider dispatched / delivered → food is out of kitchen, drop from KDS
        const ds = (o as any).deliveryStatus;
        if (ds === 'rider_picked' || ds === 'onway' || ds === 'rider_reached' || ds === 'delivered') return false;
        // Kitchen marked served/delivered → drop
        if (o.kitchenStatus === 'served' || o.kitchenStatus === 'delivered') return false;
        // Paid bills are out, regardless of kitchen step
        if (o.status === 'paid') return false;
        if (o.status === 'running' || o.status === 'hold' || o.status === 'partial') return true;
        return false;
      });
      const sorted = all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // Audio alert on NEW order arrival (skip first load)
      if (soundOn && !isFirstLoad.current) {
        const newOnes = sorted.filter(o => !knownOrderIds.current.has(o.id));
        if (newOnes.length > 0) {
          const urgent = newOnes.some(o => {
            const mins = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000);
            return mins >= (getSettings().kitchenWarningMinutes || 10);
          });
          playBeep(urgent);
        }
      }
      knownOrderIds.current = new Set(sorted.map(o => o.id));
      isFirstLoad.current = false;

      setOrders(sorted);
    };
    refresh();
    const unsub = onDataChange((col) => {
      if (col === 'orders' || col === 'settings') refresh();
    });
    // onDataChange above is the primary sync path.
    // Legacy 15s poll kept behind a flag (default off) to prevent duplicate work.
    const interval: any = ENABLE_REDUNDANT_ORDER_POLL ? setInterval(refresh, 15000) : null;
    return () => { unsub(); if (interval) clearInterval(interval); };
  }, [soundOn]);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const filterItemsForKitchen = (items: CartItem[]): CartItem[] => {
    if (activeKitchen === 'all') return items;
    if (activeKitchen === '__none__') return items.filter(i => !itemKitchen.get(i.menuItemId));
    return items.filter(i => itemKitchen.get(i.menuItemId) === activeKitchen);
  };

  const visibleOrders = orders
    .map(o => ({ order: o, items: filterItemsForKitchen(o.items || []) }))
    .filter(x => x.items.length > 0);

  // ===== Analytics =====
  const stats = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const allToday = getOrders().filter(o => new Date(o.createdAt) >= todayStart);
    const completed = allToday.filter(o => o.kitchenStatus === 'served' || o.kitchenStatus === 'delivered');
    let avgPrepMins = 0;
    if (completed.length > 0) {
      const total = completed.reduce((s, o) => {
        const end = o.kitchenStatusAt ? new Date(o.kitchenStatusAt).getTime() : Date.now();
        return s + Math.max(0, (end - new Date(o.createdAt).getTime()) / 60000);
      }, 0);
      avgPrepMins = Math.round(total / completed.length);
    }
    const delayedCount = visibleOrders.filter(({ order }) => {
      const t = getTimerInfo(order.createdAt, settings);
      return t.mins >= (settings.kitchenWarningMinutes || 10);
    }).length;
    const pending = visibleOrders.filter(x => !x.order.kitchenStatus || x.order.kitchenStatus === 'pending' || x.order.kitchenStatus === 'accepted').length;
    return { avgPrepMins, completedToday: completed.length, pending, delayed: delayedCount };
  }, [orders, visibleOrders, settings]);

  const statusLabel = (s?: string) => {
    if (!s || s === 'pending') return 'NEW';
    if (s === 'served') return 'DELIVERED';
    return s.toUpperCase();
  };

  return (
    <div className="p-4 lg:p-6">
      {/* Branding header */}
      <div className="flex items-center gap-3 mb-3 pb-3 border-b">
        {settings.logo && (
          <img src={settings.logo} alt={settings.name} className="h-9 w-9 object-contain rounded" />
        )}
        <div className="min-w-0">
          <div className="text-base font-extrabold truncate">{settings.name || 'Kitchen Display'}</div>
          <div className="text-[10px] text-muted-foreground">DT POS — Powered by Digital Target</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => setSoundOn(s => !s)} title="Toggle sound alerts">
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={toggleFullscreen} title="Fullscreen (TV mode)">
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => window.open('#/kds-tv?kitchen=' + encodeURIComponent(activeKitchen), '_blank')} title="Open TV display in new window">
            <Tv className="h-4 w-4 mr-1" /> TV Mode
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <ChefHat className="h-6 w-6 text-primary" />
        <h2 className="text-lg font-bold">Kitchen Display</h2>
        <Badge variant="secondary" className="ml-auto">{visibleOrders.length} active</Badge>
        {stats.delayed > 0 && (
          <Badge className="bg-status-danger text-status-danger-foreground animate-pulse">
            <AlertTriangle className="h-3 w-3 mr-1" /> {stats.delayed} delayed
          </Badge>
        )}
      </div>

      {/* Analytics strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-bold">Pending</div>
          <div className="text-2xl font-extrabold">{stats.pending}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-bold">Completed Today</div>
          <div className="text-2xl font-extrabold text-status-success">{stats.completedToday}</div>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground font-bold">Avg Prep</div>
          <div className="text-2xl font-extrabold">{stats.avgPrepMins}<span className="text-sm font-bold text-muted-foreground"> min</span></div>
        </div>
        <div className={`rounded-lg border p-3 ${stats.delayed > 0 ? 'bg-status-danger/10 border-status-danger/40' : 'bg-card'}`}>
          <div className="text-[10px] uppercase text-muted-foreground font-bold">Delayed</div>
          <div className={`text-2xl font-extrabold ${stats.delayed > 0 ? 'text-status-danger' : ''}`}>{stats.delayed}</div>
        </div>
      </div>

      {/* Kitchen tabs */}
      {kitchens.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveKitchen('all')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-smooth ${activeKitchen === 'all' ? 'bg-gradient-gold text-primary shadow-gold' : 'bg-muted hover:bg-muted/70 text-muted-foreground'}`}
          >All Kitchens</button>
          {kitchens.map(k => {
            const count = orders.reduce((s, o) => s + o.items.filter(i => itemKitchen.get(i.menuItemId) === k.id).length, 0);
            return (
              <button
                key={k.id}
                onClick={() => setActiveKitchen(k.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-smooth flex items-center gap-1.5 ${activeKitchen === k.id ? 'bg-gradient-gold text-primary shadow-gold' : 'bg-muted hover:bg-muted/70 text-muted-foreground'}`}
              >
                {k.name}
                {count > 0 && <span className="bg-background/40 text-[10px] px-1.5 py-0.5 rounded-full">{count}</span>}
              </button>
            );
          })}
          <button
            onClick={() => setActiveKitchen('__none__')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-smooth ${activeKitchen === '__none__' ? 'bg-gradient-gold text-primary shadow-gold' : 'bg-muted hover:bg-muted/70 text-muted-foreground'}`}
          >Unassigned</button>
        </div>
      )}

      {/* Timer legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-status-success inline-block" /> &lt;{settings.kitchenPreparingMinutes || 5}m Preparing</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-status-warning inline-block" /> {settings.kitchenPreparingMinutes || 5}-{settings.kitchenWarningMinutes || 10}m In Progress</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-status-danger inline-block" /> &gt;{settings.kitchenWarningMinutes || 10}m Delayed</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {visibleOrders.map(({ order, items }) => {
          const isHold = order.status === 'hold';
          const timer = getTimerInfo(order.createdAt, settings);
          const isDelayed = timer.mins >= (settings.kitchenWarningMinutes || 10);
          const ks = order.kitchenStatus || 'pending';
          const customerName = (order as any).customerName || order.customer?.name || (order as any).creditCustomerName;
          return (
            <div
              key={order.id}
              className={`rounded-xl border-2 p-3 transition-all ${
                isDelayed
                  ? 'border-status-danger bg-status-danger/10 ring-2 ring-status-danger/40 animate-pulse'
                  : isHold
                    ? 'border-status-warning bg-status-warning/5'
                    : 'border-status-success bg-status-success/5'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-extrabold">#{order.orderNumber}</span>
                <Badge className={`text-[10px] ${isHold ? 'bg-status-warning/20 text-status-warning' : 'bg-status-success/20 text-status-success'}`}>
                  {order.status}
                </Badge>
              </div>

              <div className="mb-2">
                <div className={`flex items-center gap-1.5 text-[11px] font-bold mb-1 ${timer.color}`}>
                  {isDelayed ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  {timer.label}
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${timer.progressColor}`} style={{ width: `${timer.progress}%` }} />
                </div>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2 flex-wrap">
                <span className="capitalize">{order.orderType}</span>
                {order.tableName && <span>• {order.tableName}</span>}
                {customerName && <span>• 👤 {customerName}</span>}
                {order.waiterName && <span>• 🧑‍🍳 {order.waiterName}</span>}
              </div>
              <div className="space-y-1">
                {items.map(item => {
                  const kId = itemKitchen.get(item.menuItemId);
                  const k = kId ? kitchens.find(x => x.id === kId) : null;
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-xs bg-card rounded-lg px-2 py-1.5 border">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold truncate">{item.name}</div>
                        {k && activeKitchen === 'all' && (
                          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k.name}</div>
                        )}
                        {item.note && <div className="text-[10px] italic text-muted-foreground truncate">📝 {item.note}</div>}
                      </div>
                      <Badge variant="outline" className="text-[10px] font-bold shrink-0">x{item.quantity}</Badge>
                    </div>
                  );
                })}
              </div>
              {order.notes && (
                <p className="text-[10px] text-muted-foreground mt-2 italic">📝 {order.notes}</p>
              )}

              {/* Kitchen workflow: Accept → Start → Ready → Delivered */}
              <div className="mt-2 pt-2 border-t flex flex-wrap items-center gap-1">
                <Badge variant="outline" className="text-[9px] uppercase">{statusLabel(ks)}</Badge>
                {(ks === 'pending') && (
                  <Button size="sm" className="h-6 px-2 text-[10px] ml-auto bg-primary/90" onClick={() => { setOrderKitchenStatus(order.id, 'accepted'); setTick(n=>n+1); }}>
                    <ThumbsUp className="h-3 w-3 mr-1" /> Accept
                  </Button>
                )}
                {(ks === 'accepted') && (
                  <Button size="sm" className="h-6 px-2 text-[10px] ml-auto" onClick={() => { setOrderKitchenStatus(order.id, 'preparing'); setTick(n=>n+1); }}>
                    <PrepIcon className="h-3 w-3 mr-1" /> Start
                  </Button>
                )}
                {ks === 'preparing' && (
                  <Button size="sm" className="h-6 px-2 text-[10px] ml-auto bg-status-warning text-white hover:bg-status-warning/90" onClick={() => { setOrderKitchenStatus(order.id, 'ready'); setTick(n=>n+1); }}>
                    <Bell className="h-3 w-3 mr-1" /> Ready
                  </Button>
                )}
                {ks === 'ready' && (
                  <Button size="sm" className="h-6 px-2 text-[10px] ml-auto bg-status-success text-white hover:bg-status-success/90" onClick={() => { setOrderKitchenStatus(order.id, 'delivered'); setTick(n=>n+1); }}>
                    <Truck className="h-3 w-3 mr-1" /> Delivered
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {visibleOrders.length === 0 && (
          <div className="col-span-full text-center py-16">
            <CheckCircle className="h-12 w-12 mx-auto text-status-success mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">All orders completed!</p>
            {activeKitchen !== 'all' && (
              <p className="text-xs text-muted-foreground mt-1">(filtered to selected kitchen)</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
