/**
 * Live order tracking inside the customer account — v1.28.0
 *
 * The public #/track page needs an order number and a phone number. A signed-in
 * customer already proved who they are, so this reads the same live state
 * through their session token instead: `public_customer_order_track` returns
 * only orders that belong to the caller.
 *
 * Polls while it is open and the order is still moving, and stops as soon as
 * the order is delivered or cancelled — there is nothing left to watch.
 */
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { money } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, Clock, ChefHat, Package, Bike, CheckCircle2, PhoneCall, XCircle, RefreshCw,
} from 'lucide-react';
import { customerOrderTrack, type CustomerOrderTrack } from '@/lib/customerAccount';

const DeliveryRouteMap = lazy(() => import('@/components/DeliveryRouteMap'));

const POLL_MS = 10_000;

type Step = { key: string; label: string; icon: typeof Clock };

const DELIVERY_STEPS: Step[] = [
  { key: 'placed',    label: 'Order placed',   icon: Clock },
  { key: 'cooking',   label: 'In the kitchen', icon: ChefHat },
  { key: 'ready',     label: 'Ready',          icon: Package },
  { key: 'onway',     label: 'On the way',     icon: Bike },
  { key: 'delivered', label: 'Delivered',      icon: CheckCircle2 },
];

const PICKUP_STEPS: Step[] = [
  { key: 'placed',    label: 'Order placed',      icon: Clock },
  { key: 'cooking',   label: 'In the kitchen',    icon: ChefHat },
  { key: 'ready',     label: 'Ready for pickup',  icon: Package },
  { key: 'delivered', label: 'Collected',         icon: CheckCircle2 },
];

/**
 * How far along the timeline the order is. Delivery state wins when it is set,
 * because the rider has already taken over from the kitchen by then.
 */
function reachedIndex(t: CustomerOrderTrack, steps: Step[]): number {
  const at = (key: string) => steps.findIndex(s => s.key === key);
  if (t.cancelledAt) return -1;
  const d = (t.deliveryStatus || '').toLowerCase();
  if (t.deliveredAt || d === 'delivered') return at('delivered');
  if (d === 'onway' || d === 'rider_picked' || d === 'rider_reached' || d === 'rider_assigned') {
    return Math.max(at('onway'), at('ready'));
  }
  const k = (t.kitchenStatus || '').toLowerCase();
  if (d === 'ready' || k === 'ready') return at('ready');
  if (d === 'cooking' || k === 'preparing' || k === 'cooking') return at('cooking');
  return at('placed');
}

export interface CustomerOrderTrackerProps {
  orderId: string | null;
  tenantId: string | null;
  onClose: () => void;
}

export default function CustomerOrderTracker({ orderId, tenantId, onClose }: CustomerOrderTrackerProps) {
  const [track, setTrack] = useState<CustomerOrderTrack | null>(null);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    // `finally` rather than a clear on the happy path: this function has an
    // early return, and a spinner that never stops is worse than an error.
    try {
      const t = await customerOrderTrack(orderId, tenantId);
      if (!t) { setMissing(true); return; }
      setMissing(false);
      setTrack(t);
    } finally {
      setLoading(false);
    }
  }, [orderId, tenantId]);

  useEffect(() => {
    if (!orderId) { setTrack(null); setMissing(false); return; }
    setTrack(null);
    void refresh();
  }, [orderId, refresh]);

  // Poll only while there is still something to see.
  const finished = !!track && (!!track.deliveredAt || !!track.cancelledAt);
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (!orderId || finished) return;
    timer.current = setInterval(() => { void refresh(); }, POLL_MS);
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [orderId, finished, refresh]);

  if (!orderId) return null;

  const isDelivery = (track?.orderType || '').toLowerCase() === 'delivery';
  const steps = isDelivery ? DELIVERY_STEPS : PICKUP_STEPS;
  const at = track ? reachedIndex(track, steps) : 0;
  const cancelled = !!track?.cancelledAt;

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-background w-full max-w-md h-full overflow-y-auto pos-scrollbar shadow-elegant"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold truncate">
                {track ? `Order #${track.orderNumber}` : 'Tracking…'}
              </h2>
              {track && (
                <p className="text-[10px] text-muted-foreground truncate">
                  {new Date(track.createdAt).toLocaleString()} · {money(track.grandTotal)}
                </p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Refresh" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="p-3 space-y-3">
          {missing && !track && (
            <p className="text-center text-xs text-muted-foreground py-12">
              We could not load this order. Pull down to try again, or sign in once more.
            </p>
          )}

          {!track && !missing && (
            <div className="py-12 text-center">
              <div className="animate-spin h-7 w-7 border-4 border-primary border-t-transparent rounded-full mx-auto" />
            </div>
          )}

          {track && cancelled && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="text-xs font-extrabold text-destructive">This order was cancelled</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(track.cancelledAt as string).toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {track && !cancelled && (
            <ol className="space-y-0">
              {steps.map((s, i) => {
                const done = i <= at;
                const current = i === at;
                const Icon = s.icon;
                return (
                  <li key={s.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                          done ? 'bg-primary text-primary-foreground border-primary'
                               : 'bg-card text-muted-foreground border-border'
                        } ${current ? 'ring-4 ring-primary/20' : ''}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      {i < steps.length - 1 && (
                        <div className={`w-0.5 flex-1 min-h-[22px] ${i < at ? 'bg-primary' : 'bg-border'}`} />
                      )}
                    </div>
                    <div className="pb-4 pt-1.5">
                      <p className={`text-xs font-bold ${done ? '' : 'text-muted-foreground'}`}>{s.label}</p>
                      {current && !finished && (
                        <p className="text-[10px] text-primary font-semibold">Happening now</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {track?.etaMinutes != null && !finished && (
            <p className="text-center text-xs">
              <span className="text-muted-foreground">Estimated arrival:</span>{' '}
              <span className="font-extrabold">{track.etaMinutes} min</span>
            </p>
          )}

          {track?.riderName && (
            <div className="bg-card border rounded-xl p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">Your rider</p>
                <p className="text-sm font-extrabold truncate">{track.riderName}</p>
                {track.riderPhone && <p className="text-[11px] text-muted-foreground">{track.riderPhone}</p>}
              </div>
              {track.riderPhone && (
                <a
                  href={`tel:${track.riderPhone}`}
                  className="inline-flex items-center gap-1 bg-status-success text-white px-3 py-2 rounded-lg text-xs font-bold shrink-0"
                >
                  <PhoneCall className="h-3.5 w-3.5" /> Call
                </a>
              )}
            </div>
          )}

          {track && (track.rider || track.customer) && (
            <div>
              <Suspense fallback={<div className="h-[240px] bg-muted rounded-xl animate-pulse" />}>
                <DeliveryRouteMap
                  branch={track.branch}
                  rider={track.rider}
                  customer={track.customer}
                  height={240}
                />
              </Suspense>
              {track.rider && (
                <p className="text-[10px] text-muted-foreground mt-1 text-center">
                  Rider position is approximate and updates every few seconds.
                </p>
              )}
            </div>
          )}

          {track && track.items.length > 0 && (
            <div className="bg-card border rounded-xl p-3">
              <h3 className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground mb-2">
                Items ({track.items.length})
              </h3>
              <div className="space-y-1">
                {track.items.map((it, i) => (
                  <div key={i} className="flex justify-between text-[11px]">
                    <span>{it.name} <span className="text-muted-foreground">× {it.quantity ?? 1}</span></span>
                    <span className="font-semibold">{money(Number(it.lineTotal ?? 0))}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs font-extrabold pt-2 mt-2 border-t">
                <span>Total</span><span>{money(track.grandTotal)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
