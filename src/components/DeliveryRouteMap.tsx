import { useEffect, useRef, useState } from 'react';
import LeafletMap, { type MapMarker, type MapPolyline } from './LeafletMap';

interface Props {
  branch?: { lat: number; lng: number } | null;
  rider?: { lat: number; lng: number } | null;
  customer?: { lat: number; lng: number } | null;
  height?: number;
  className?: string;
}

/**
 * Shows branch + rider (bike icon) + customer with road-snapped routes (OSRM):
 *  • GREEN line = Restaurant → Customer (full planned route)
 *  • RED  line  = Rider → Customer (live remaining route, shrinks as rider approaches)
 * Used by Rider App (live tracking screen) and Customer TrackOrder page.
 */
export default function DeliveryRouteMap({ branch, rider, customer, height = 280, className }: Props) {
  const [roadRoutes, setRoadRoutes] = useState<Map<string, Array<[number, number]>>>(new Map());
  const fetchingRef = useRef<Set<string>>(new Set());

  // Markers
  const markers: MapMarker[] = [];
  if (branch) markers.push({ id: 'br', lat: branch.lat, lng: branch.lng, title: 'Restaurant', color: 'blue', popupHtml: '<b>🏪 Restaurant</b>' });
  if (customer) markers.push({ id: 'cu', lat: customer.lat, lng: customer.lng, title: 'Customer', color: 'orange', popupHtml: '<b>📍 Delivery Address</b>' });
  if (rider) {
    const bikeHtml = `
      <div style="position:relative;transform:translate(-50%,-100%);">
        <div style="background:#16a34a;color:#fff;border:3px solid #fff;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.4);">🏍️</div>
        <div style="position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #16a34a;"></div>
      </div>`;
    markers.push({
      id: 'rd', lat: rider.lat, lng: rider.lng, title: 'Rider',
      iconHtml: bikeHtml,
      iconSize: [38, 46],
      iconAnchor: [19, 46],
      popupHtml: '<b>🏍️ Rider (live)</b>',
    });
  }

  // Build the two pairs we want to road-snap
  const pairs: Array<{ key: 'green' | 'red'; waypoints: Array<[number, number]> }> = [];
  if (branch && customer) pairs.push({ key: 'green', waypoints: [[branch.lat, branch.lng], [customer.lat, customer.lng]] });
  if (rider && customer) pairs.push({ key: 'red', waypoints: [[rider.lat, rider.lng], [customer.lat, customer.lng]] });

  // Background: fetch road-snapped routes from OSRM for any new signatures
  useEffect(() => {
    pairs.forEach(({ waypoints }) => {
      const sig = waypoints.map(([la, ln]) => `${la.toFixed(4)},${ln.toFixed(4)}`).join('|');
      if (roadRoutes.has(sig) || fetchingRef.current.has(sig)) return;
      fetchingRef.current.add(sig);
      const coords = waypoints.map(([la, ln]) => `${ln},${la}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
      fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          const geom = d?.routes?.[0]?.geometry?.coordinates as Array<[number, number]> | undefined;
          if (geom && geom.length > 1) {
            const pts: Array<[number, number]> = geom.map(([ln, la]) => [la, ln]);
            setRoadRoutes(prev => { const m = new Map(prev); m.set(sig, pts); return m; });
          }
        })
        .catch(() => {})
        .finally(() => { fetchingRef.current.delete(sig); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairs.map(p => p.waypoints.map(w => w.join(',')).join('|')).join('||')]);

  // Polylines
  const polylines: MapPolyline[] = pairs.map(({ key, waypoints }) => {
    const sig = waypoints.map(([la, ln]) => `${la.toFixed(4)},${ln.toFixed(4)}`).join('|');
    const roaded = roadRoutes.get(sig);
    return {
      id: 'rt_' + key,
      points: roaded || waypoints,
      color: key === 'green' ? '#16a34a' : '#dc2626',
      weight: key === 'red' ? 5 : 4,
      opacity: key === 'red' ? 0.9 : 0.85,
      dashed: !roaded,
    };
  });

  const center: [number, number] | undefined = rider
    ? [rider.lat, rider.lng]
    : customer
      ? [customer.lat, customer.lng]
      : branch
        ? [branch.lat, branch.lng]
        : undefined;

  if (markers.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-muted/40 rounded-lg text-xs text-muted-foreground ${className || ''}`} style={{ height }}>
        Location not available yet
      </div>
    );
  }

  return (
    <div className={`rounded-lg overflow-hidden border ${className || ''}`}>
      <LeafletMap markers={markers} polylines={polylines} height={height} center={center} zoom={14} />
    </div>
  );
}
