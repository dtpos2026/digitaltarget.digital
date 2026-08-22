import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bike, MapPin, RefreshCw, Truck, Navigation } from 'lucide-react';
import LeafletMap, { type MapMarker, type MapPolyline } from '@/components/LeafletMap';
import { getOrders, getRiders, getBranches, getSettings } from '@/lib/store';
import { Order } from '@/lib/types';
import { DELIVERY_STAGE_LABEL } from '@/lib/delivery';
import { ENABLE_REDUNDANT_ORDER_POLL } from '@/lib/featureFlags';

const STAGE_COLOR: Record<string, string> = {
  pending: '#94a3b8',
  accepted: '#0ea5e9',
  cooking: '#f59e0b',
  ready: '#eab308',
  rider_assigned: '#a855f7',
  rider_picked: '#6366f1',
  onway: '#16a34a',
  rider_reached: '#059669',
};

function isActiveDelivery(o: Order) {
  return o.orderType === 'delivery' && o.deliveryStatus && !['delivered', 'cancelled'].includes(o.deliveryStatus);
}

export default function LiveRidersMapPage() {
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const riders = useMemo(() => getRiders(), []);
  const branches = useMemo(() => getBranches(), []);
  const [tick, setTick] = useState(0);

  const settings = useMemo(() => getSettings(), []);
  const restLat = settings.restaurantLat;
  const restLng = settings.restaurantLng;

  useEffect(() => {
    // Store's live listener updates orders; legacy 8s poll kept behind flag (default off).
    const t: any = ENABLE_REDUNDANT_ORDER_POLL
      ? setInterval(() => { setOrders(getOrders()); setTick(x => x + 1); }, 8000)
      : null;
    return () => { if (t) clearInterval(t); };
  }, []);

  const active = useMemo(() => orders.filter(isActiveDelivery), [orders]);

  // Latest position per rider from their active orders
  const riderPositions = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number; t: number; orderId: string }>();
    for (const o of active) {
      const lat = o.delivery?.riderLat;
      const lng = o.delivery?.riderLng;
      if (lat == null || lng == null || !o.riderId) continue;
      const pingT = (o as any).riderPingedAt ? new Date((o as any).riderPingedAt).getTime() : 0;
      const cur = map.get(o.riderId);
      if (!cur || pingT > cur.t) map.set(o.riderId, { lat, lng, t: pingT, orderId: o.id });
    }
    return map;
  }, [active]);

  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    // Branches
    branches.forEach(b => {
      if (b.lat == null || b.lng == null) return;
      out.push({
        id: 'b_' + b.id, lat: b.lat, lng: b.lng, color: 'blue', title: b.name,
        popupHtml: `<div style="font-family:system-ui;font-size:12px"><b>🏢 ${b.name}</b><br/>${b.city || ''}</div>`,
      });
    });
    // Customer pins
    active.forEach(o => {
      if (o.delivery?.customerLat != null && o.delivery?.customerLng != null) {
        out.push({
          id: 'c_' + o.id, lat: o.delivery.customerLat, lng: o.delivery.customerLng, color: 'orange',
          title: `#${o.orderNumber} ${o.customer?.name || ''}`,
          popupHtml: `<div style="font-family:system-ui;font-size:12px;min-width:200px">
            <b>📍 #${o.orderNumber} — ${escape(o.customer?.name || '')}</b><br/>
            <span style="color:#64748b">${escape(o.customer?.address || '')}</span><br/>
            <b>${money(o.grandTotal)}</b> · ${DELIVERY_STAGE_LABEL[o.deliveryStatus || 'pending']}
            ${o.riderName ? `<br/>🛵 ${escape(o.riderName)}` : ''}
          </div>`,
        });
      }
    });
    // Riders — show as bike icon so it's obvious where the rider is
    riderPositions.forEach((pos, riderId) => {
      const r = riders.find(x => x.id === riderId);
      const o = orders.find(x => x.id === pos.orderId);
      const bikeHtml = `
        <div style="position:relative;transform:translate(-50%,-100%);">
          <div style="background:#16a34a;color:#fff;border:3px solid #fff;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.4);">🏍️</div>
          <div style="position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #16a34a;"></div>
        </div>`;
      out.push({
        id: 'r_' + riderId, lat: pos.lat, lng: pos.lng,
        title: r?.name || 'Rider',
        iconHtml: bikeHtml,
        iconSize: [38, 46],
        iconAnchor: [19, 46],
        popupHtml: `<div style="font-family:system-ui;font-size:12px;min-width:200px">
          <b>🏍️ ${escape(r?.name || 'Rider')}</b><br/>
          ${r?.phone ? `📞 ${escape(r.phone)}<br/>` : ''}
          ${o ? `Order #${o.orderNumber} · ${DELIVERY_STAGE_LABEL[o.deliveryStatus || 'pending']}<br/>` : ''}
          ${o?.delivery?.etaMinutes ? `ETA: ${o.delivery.etaMinutes} min · ${o.delivery.distanceKm?.toFixed(1)} km<br/>` : ''}
          <span style="color:#64748b;font-size:10px">${pos.t ? new Date(pos.t).toLocaleTimeString() : ''}</span>
        </div>`,
      });
    });
    return out;
  }, [active, riderPositions, branches, riders, orders]);

  // Cache road-routed polylines keyed by waypoint signature (OSRM, free public router).
  const [roadRoutes, setRoadRoutes] = useState<Map<string, Array<[number, number]>>>(new Map());
  const fetchingRef = useRef<Set<string>>(new Set());

  // Route lines per active order:
  //  • GREEN  = full planned route from Restaurant → Customer
  //  • RED    = live remaining route from Rider → Customer (shrinks as rider gets closer)
  const polylines: MapPolyline[] = useMemo(() => {
    const lines: MapPolyline[] = [];
    active.forEach(o => {
      const cLat = o.delivery?.customerLat;
      const cLng = o.delivery?.customerLng;
      if (cLat == null || cLng == null) return;
      const stage = o.deliveryStatus || 'pending';

      // GREEN line: restaurant → customer
      if (restLat != null && restLng != null) {
        const wp: Array<[number, number]> = [[restLat, restLng], [cLat, cLng]];
        const sig = wp.map(([la, ln]) => `${la.toFixed(4)},${ln.toFixed(4)}`).join('|');
        const roaded = roadRoutes.get(sig);
        lines.push({
          id: 'rt_g_' + o.id,
          points: roaded || wp,
          color: '#16a34a',
          weight: 4,
          opacity: 0.85,
          dashed: !roaded,
          popupHtml: `<div style="font-family:system-ui;font-size:12px"><b>#${o.orderNumber}</b> · ${DELIVERY_STAGE_LABEL[stage]}<br/>Restaurant → Customer</div>`,
        });
      }

      // RED line: rider → customer (live)
      const rp = o.riderId ? riderPositions.get(o.riderId) : undefined;
      if (rp && rp.orderId === o.id) {
        const wp: Array<[number, number]> = [[rp.lat, rp.lng], [cLat, cLng]];
        const sig = wp.map(([la, ln]) => `${la.toFixed(4)},${ln.toFixed(4)}`).join('|');
        const roaded = roadRoutes.get(sig);
        lines.push({
          id: 'rt_r_' + o.id,
          points: roaded || wp,
          color: '#dc2626',
          weight: 5,
          opacity: 0.9,
          dashed: !roaded,
          popupHtml: `<div style="font-family:system-ui;font-size:12px"><b>🏍️ ${escape(o.riderName || 'Rider')}</b> → Customer<br/>${o.delivery?.distanceKm ? o.delivery.distanceKm.toFixed(1) + ' km · ' : ''}${o.delivery?.etaMinutes ? '~' + o.delivery.etaMinutes + ' min' : ''}</div>`,
        });
      }
    });
    return lines;
  }, [active, riderPositions, restLat, restLng, roadRoutes]);

  // Background: fetch road-snapped routes from OSRM for any new waypoint signatures.
  useEffect(() => {
    const needed: Array<{ sig: string; waypoints: Array<[number, number]> }> = [];
    active.forEach(o => {
      const cLat = o.delivery?.customerLat;
      const cLng = o.delivery?.customerLng;
      if (cLat == null || cLng == null) return;
      const pairs: Array<Array<[number, number]>> = [];
      // Restaurant → Customer (green)
      if (restLat != null && restLng != null) pairs.push([[restLat, restLng], [cLat, cLng]]);
      // Rider → Customer (red)
      const rp = o.riderId ? riderPositions.get(o.riderId) : undefined;
      if (rp && rp.orderId === o.id) pairs.push([[rp.lat, rp.lng], [cLat, cLng]]);
      pairs.forEach(waypoints => {
        const sig = waypoints.map(([la, ln]) => `${la.toFixed(4)},${ln.toFixed(4)}`).join('|');
        if (roadRoutes.has(sig) || fetchingRef.current.has(sig)) return;
        needed.push({ sig, waypoints });
      });
    });
    if (needed.length === 0) return;

    needed.forEach(async ({ sig, waypoints }) => {
      fetchingRef.current.add(sig);
      try {
        const coords = waypoints.map(([la, ln]) => `${ln},${la}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('OSRM ' + res.status);
        const data = await res.json();
        const geom = data?.routes?.[0]?.geometry?.coordinates as Array<[number, number]> | undefined;
        if (geom && geom.length > 1) {
          // GeoJSON is [lng, lat] — convert to [lat, lng]
          const pts: Array<[number, number]> = geom.map(([ln, la]) => [la, ln]);
          setRoadRoutes(prev => { const m = new Map(prev); m.set(sig, pts); return m; });
        }
      } catch {
        // ignore; keep straight-line fallback
      } finally {
        fetchingRef.current.delete(sig);
      }
    });
  }, [active, riderPositions, restLat, restLng, roadRoutes]);


  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2"><Bike className="h-5 w-5 text-primary" /> Live Rider Tracking</h2>
        <Button size="sm" variant="outline" onClick={() => { setOrders(getOrders()); setTick(x => x + 1); }}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active Deliveries" value={active.length} color="text-blue-600" />
        <Stat label="Riders On Map" value={riderPositions.size} color="text-green-600" />
        <Stat label="Total Riders" value={riders.length} color="text-primary" />
        <Stat label="Pending Pickup" value={active.filter(o => o.deliveryStatus === 'ready').length} color="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-2">
          <LeafletMap markers={markers} polylines={polylines} height={540} />
          <div className="flex items-center gap-3 px-2 pt-2 text-[10px] text-muted-foreground flex-wrap">
            <Legend color="bg-blue-600" label="Branch" />
            <Legend color="bg-orange-500" label="Customer" />
            <span className="inline-flex items-center gap-1">🏍️ Rider (live)</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-green-600" /> Restaurant → Customer</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-red-600" /> Rider → Customer</span>
          </div>
        </Card>

        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Truck className="h-3 w-3" /> Active Orders ({active.length})
          </h3>
          {active.length === 0 && <p className="text-xs text-muted-foreground italic">No active deliveries.</p>}
          {active.map(o => {
            const lat = o.delivery?.customerLat, lng = o.delivery?.customerLng;
            return (
              <Card key={o.id} className="p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">#{o.orderNumber} · {money(o.grandTotal)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{o.customer?.name}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Bike className="h-3 w-3" /> {o.riderName || '—'}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[9px] shrink-0">{DELIVERY_STAGE_LABEL[o.deliveryStatus || 'pending']}</Badge>
                </div>
                {o.delivery?.distanceKm != null && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {o.delivery.distanceKm.toFixed(1)} km · ~{o.delivery.etaMinutes} min
                  </div>
                )}
                {lat != null && lng != null && (
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline" className="w-full mt-1 h-7 text-[10px]"><Navigation className="h-3 w-3 mr-1" /> Open in Maps</Button>
                  </a>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-extrabold ${color || ''}`}>{value}</div>
    </Card>
  );
}
function Legend({ color, label }: any) {
  return <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${color}`} /> {label}</span>;
}
function escape(s: string) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!)); }
