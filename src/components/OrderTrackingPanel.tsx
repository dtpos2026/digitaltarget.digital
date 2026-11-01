// ============================================================================
// ORDER TRACKING PANEL — the progress, the rider and the map for one order.
//
// The customer's tracking page (web), the signed-in customer's tracker and the software's Delivery Board
// (web and Windows) all draw this component, so what a customer sees is what the restaurant sees. The status is
// worked out in `trackingView()`; this file only draws it.
// ============================================================================
import { lazy, Suspense } from 'react';
import { CheckCircle2, ChefHat, Package, Bike, Clock, PhoneCall } from 'lucide-react';
import { trackingView, type LatLng, type TrackStepIcon } from '@/lib/trackingSteps';
import type { Order } from '@/lib/types';

const DeliveryRouteMap = lazy(() => import('@/components/DeliveryRouteMap'));

const ICONS: Record<TrackStepIcon, typeof Clock> = { check: CheckCircle2, chef: ChefHat, package: Package, bike: Bike };

interface Props {
  order: Order;
  /** The restaurant's position, when it has been set. */
  branch?: LatLng | null;
  /** Height of the map in px. */
  mapHeight?: number;
}

export default function OrderTrackingPanel({ order, branch = null, mapHeight = 240 }: Props) {
  const v = trackingView(order);

  return (
    <div className="space-y-4" data-order-tracking={order.id}>
      {/* Progress */}
      {!v.isCancelled && (
        <div className="bg-card border rounded-2xl shadow-card p-4" data-tracking-progress>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-3">Progress</h3>
          <div className="space-y-3">
            {v.steps.map((s, i) => {
              const Icon = ICONS[s.icon];
              const isCurrent = !s.done && i === v.activeIndex;
              return (
                <div key={s.key} data-step={s.key} data-state={s.done ? 'done' : isCurrent ? 'current' : 'todo'} className="flex items-start gap-3">
                  <div className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${
                    s.done ? 'bg-status-success text-white'
                    : isCurrent ? 'bg-gold text-foreground animate-pulse'
                    : 'bg-muted text-muted-foreground'
                  }`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 pt-1.5">
                    <p className={`text-sm font-bold ${s.done || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</p>
                    {s.done && s.at && (
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

      {/* Rider, map and arrival time */}
      {v.rider && (
        <div className="bg-card border rounded-2xl shadow-card p-4 space-y-2" data-tracking-rider>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Your Rider</h3>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-lg">
              <Bike className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold truncate">{v.rider.name}</p>
              {v.rider.phone && <p className="text-[11px] text-muted-foreground">{v.rider.phone}</p>}
            </div>
            {v.rider.phone && (
              <a href={`tel:${v.rider.phone}`} className="inline-flex items-center gap-1 bg-status-success text-white px-3 py-2 rounded-lg text-xs font-bold">
                <PhoneCall className="h-3.5 w-3.5" /> Call
              </a>
            )}
          </div>
          {v.showMap && (
            <div className="mt-2" data-tracking-map>
              <Suspense fallback={<div className="bg-muted rounded animate-pulse" style={{ height: mapHeight }} />}>
                <DeliveryRouteMap branch={branch} rider={v.riderPos} customer={v.customerPos} height={mapHeight} />
              </Suspense>
              {v.riderPos && !v.finished && (
                <p className="text-[10px] text-muted-foreground mt-1 text-center">Rider position is approximate and updates every few seconds.</p>
              )}
              {!v.riderPos && !v.finished && (
                <p className="text-[10px] text-muted-foreground mt-1 text-center">Waiting for the rider's location…</p>
              )}
            </div>
          )}
          {v.etaMinutes != null && !v.finished && (
            <p className="text-center text-xs" data-tracking-eta>
              <span className="text-muted-foreground">ETA:</span> <span className="font-extrabold">{v.etaMinutes} min</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
