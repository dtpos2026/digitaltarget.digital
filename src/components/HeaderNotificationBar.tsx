// Top-header notification ticker for ready/new orders + Call Waiter service calls.
// Lives inside AppLayout's top header. Persists across reload, supports mute,
// individual dismiss (X), and "Clear all".
import { useEffect, useState } from 'react';
import { money } from '@/lib/currency';
import { Bell, Package, Bike, Utensils, X, BellRing, Check, Volume2, VolumeX, Trash2 } from 'lucide-react';
import { onReady, type ReadyEvent } from '@/lib/readyNotify';
import { getOrders } from '@/lib/store';
import { fetchServiceCalls, ackServiceCall, type ServiceCall } from '@/lib/serviceCalls';
import OrderDetailDialog from '@/components/OrderDetailDialog';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';

const MAX = 20;
const AUTO_CLEAR_MS = 30 * 60 * 1000; // keep 30 min
const STORE_KEY = 'pos-bell-items-v1';
const NEW_MUTE_KEY = 'pos-mute-online-orders';
const SVC_MUTE_KEY = 'pos-mute-service-calls';

type BellItem = ReadyEvent & {
  kind: 'ready' | 'new';
  source?: string; // website / qr / order_taker / pos
};

function iconFor(t: ReadyEvent['orderType']) {
  if (t === 'delivery') return Bike;
  if (t === 'takeaway') return Package;
  return Utensils;
}

function loadStored(): BellItem[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as BellItem[];
    const now = Date.now();
    return arr.filter(x => now - new Date(x.at).getTime() < AUTO_CLEAR_MS).slice(0, MAX);
  } catch { return []; }
}
function saveStored(items: BellItem[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, MAX))); } catch {}
}

export default function HeaderNotificationBar() {
  const [items, setItems] = useState<BellItem[]>(() => loadStored());
  const [services, setServices] = useState<ServiceCall[]>([]);
  const [open, setOpen] = useState(false);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [newMuted, setNewMuted] = useState<boolean>(() => localStorage.getItem(NEW_MUTE_KEY) === '1');
  const [svcMuted, setSvcMuted] = useState<boolean>(() => localStorage.getItem(SVC_MUTE_KEY) === '1');

  // Persist items
  useEffect(() => { saveStored(items); }, [items]);

  const openPreview = (orderId: string) => {
    const o = getOrders().find((x) => x.id === orderId);
    if (o) {
      setPreviewOrder(o);
      setOpen(false);
    }
  };

  useEffect(() => {
    const offReady = onReady((ev) => {
      setItems((q) => [{ ...ev, kind: 'ready' as const }, ...q.filter((x) => x.orderId !== ev.orderId)].slice(0, MAX));
    });
    const onNew = (e: Event) => {
      const ev = (e as CustomEvent<ReadyEvent & { source?: string }>).detail;
      if (!ev) return;
      setItems((q) => [{ ...ev, kind: 'new' as const, source: (ev as any).source }, ...q.filter((x) => x.orderId !== ev.orderId)].slice(0, MAX));
    };
    const onSvc = (e: Event) => {
      const sc = (e as CustomEvent<ServiceCall>).detail;
      if (!sc) return;
      setServices((q) => [sc, ...q.filter((x) => x.id !== sc.id)].slice(0, MAX));
    };
    window.addEventListener('dt-new-order', onNew);
    window.addEventListener('dt-service-call-event', onSvc);
    return () => {
      offReady();
      window.removeEventListener('dt-new-order', onNew);
      window.removeEventListener('dt-service-call-event', onSvc);
    };
  }, []);

  // Initial fetch of pending service calls on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await fetchServiceCalls();
      if (cancelled) return;
      const openCalls = all.filter(c => !c.acked).slice(0, MAX);
      setServices(openCalls);
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto clear stale items
  useEffect(() => {
    if (items.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setItems((q) => q.filter((x) => now - new Date(x.at).getTime() < AUTO_CLEAR_MS));
    }, 60000);
    return () => clearInterval(t);
  }, [items.length]);

  const attendService = async (id: string) => {
    setServices((q) => q.filter(x => x.id !== id));
    try { await ackServiceCall(id); } catch {}
  };
  const dismissItem = (orderId: string) => setItems((q) => q.filter(x => x.orderId !== orderId));
  const clearAll = () => { setItems([]); /* service calls require ack, leave them */ };

  const toggleNewMute = () => {
    const next = !newMuted;
    setNewMuted(next);
    localStorage.setItem(NEW_MUTE_KEY, next ? '1' : '0');
  };
  const toggleSvcMute = () => {
    const next = !svcMuted;
    setSvcMuted(next);
    localStorage.setItem(SVC_MUTE_KEY, next ? '1' : '0');
  };

  const count = items.length + services.length;
  const anyMuted = newMuted || svcMuted;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'relative h-7 w-7 rounded-full flex items-center justify-center transition-colors border shadow-sm',
          count > 0
            ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600 animate-pulse'
            : 'bg-amber-500/15 text-amber-600 border-amber-500/40 hover:bg-amber-500/25'
        )}
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center border border-background">
            {count}
          </span>
        )}
        {anyMuted && (
          <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-muted text-foreground text-[9px] flex items-center justify-center border border-background">
            <VolumeX className="h-2.5 w-2.5" />
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div className="fixed right-4 top-16 w-[360px] max-w-[calc(100vw-1rem)] z-[9999] bg-card border border-border rounded-lg shadow-elegant overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-amber-500 text-white">
              <div className="flex items-center gap-1.5 text-[11px] font-bold">
                <Bell className="h-3.5 w-3.5" /> Notifications ({count})
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleSvcMute}
                  className="text-[10px] px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 flex items-center gap-1"
                  title={svcMuted ? 'Unmute Call-Waiter beep' : 'Mute Call-Waiter beep'}
                >
                  {svcMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />} Call
                </button>
                <button
                  onClick={toggleNewMute}
                  className="text-[10px] px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 flex items-center gap-1"
                  title={newMuted ? 'Unmute new-order beep' : 'Mute new-order beep'}
                >
                  {newMuted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />} Orders
                </button>
                {items.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-[10px] px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 flex items-center gap-1"
                    title="Clear all order notifications"
                  >
                    <Trash2 className="h-3 w-3" /> Clear
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="hover:bg-white/20 rounded p-0.5">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
              {count === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No pending notifications
                </div>
              )}

              {/* Service calls first (higher priority) */}
              {services.map((c) => (
                <div key={c.id} className="px-3 py-2 bg-amber-50 dark:bg-amber-950/30 flex items-start gap-2">
                  <div className="h-7 w-7 rounded-md flex items-center justify-center shrink-0 bg-amber-500 text-white">
                    <BellRing className="h-4 w-4 animate-pulse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-bold text-amber-900 dark:text-amber-200">
                        🔔 Customer waiting for waiter
                      </div>
                      <button
                        onClick={() => attendService(c.id)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Dismiss"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-[11px] text-amber-800 dark:text-amber-300 truncate">
                      {c.tableLabel}{c.floorName ? ` · ${c.floorName}` : ''}
                    </div>
                    {c.message && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 italic">"{c.message}"</div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(c.at).toLocaleTimeString()}
                    </div>
                    <button
                      onClick={() => attendService(c.id)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700"
                    >
                      <Check className="h-3 w-3" /> Mark Attended
                    </button>
                  </div>
                </div>
              ))}

              {items.map((ev) => {
                const Icon = iconFor(ev.orderType);
                const isNew = ev.kind === 'new';
                const beepLabel = isNew
                  ? (ev.source === 'website' ? '🌐 Website Order' : ev.source === 'qr' ? '📱 QR Table Order' : ev.source === 'order_taker' ? '📝 Order Taker' : '🆕 New Order')
                  : '✅ Order Ready';
                return (
                  <div
                    key={ev.orderId}
                    onClick={() => openPreview(ev.orderId)}
                    className="px-3 py-2 hover:bg-muted/40 flex items-start gap-2 cursor-pointer"
                  >
                    <div
                      className={cn(
                        'h-7 w-7 rounded-md flex items-center justify-center shrink-0',
                        ev.orderType === 'delivery'
                          ? 'bg-blue-500/15 text-blue-600'
                          : ev.orderType === 'takeaway'
                            ? 'bg-amber-500/15 text-amber-600'
                            : 'bg-green-500/15 text-green-600'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-bold">
                          {beepLabel} · #{ev.orderNumber}{' '}
                          <span className="text-[10px] font-normal text-muted-foreground uppercase">
                            {ev.orderType}
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissItem(ev.orderId); }}
                          className="text-muted-foreground hover:text-foreground"
                          title="Dismiss"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {ev.table ? `Table ${ev.table}` : ev.customerName || 'Walk-in'}
                        {ev.customerPhone ? ' · ' + ev.customerPhone : ''}
                      </div>
                      <div className="text-[10px] text-amber-700 mt-0.5">
                        {money(ev.total)} · {new Date(ev.at).toLocaleTimeString()}
                      </div>
                      <div className="text-[10px] text-primary mt-0.5 font-semibold">
                        Click to preview →
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      <OrderDetailDialog order={previewOrder} onClose={() => setPreviewOrder(null)} />
    </div>
  );
}
