import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon paths (Vite/CDN issue)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  popupHtml?: string;
  color?: 'blue' | 'green' | 'red' | 'orange' | 'gold' | 'gray';
  /** Optional custom HTML icon (overrides color dot). */
  iconHtml?: string;
  iconSize?: [number, number];
  iconAnchor?: [number, number];
  /** Allow the user to drag the marker. */
  draggable?: boolean;
}

export interface MapPolyline {
  id: string;
  points: Array<[number, number]>;
  color?: string;
  weight?: number;
  dashed?: boolean;
  opacity?: number;
  popupHtml?: string;
}

export interface MapCircle {
  id: string;
  lat: number;
  lng: number;
  /** Radius in meters. */
  radiusM: number;
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
  weight?: number;
  popupHtml?: string;
}

interface Props {
  markers: MapMarker[];
  polylines?: MapPolyline[];
  circles?: MapCircle[];
  height?: number | string;
  center?: [number, number];
  zoom?: number;
  className?: string;
  onMarkerClick?: (id: string) => void;
  /** Called when a draggable marker finishes a drag. */
  onMarkerDragEnd?: (id: string, lat: number, lng: number) => void;
  /** Called when the user clicks/taps on the map. */
  onMapClick?: (lat: number, lng: number) => void;
}

const COLORS: Record<string, string> = {
  blue: '#2563eb', green: '#16a34a', red: '#dc2626',
  orange: '#ea580c', gold: '#d4af37', gray: '#6b7280',
};

function coloredIcon(color: string) {
  const c = COLORS[color] || COLORS.blue;
  const html = `<div style="background:${c};width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25), 0 2px 6px rgba(0,0,0,.4);"></div>`;
  return L.divIcon({ html, className: 'dt-marker', iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] });
}

export default function LeafletMap({ markers, polylines = [], circles = [], height = 480, center, zoom = 6, className, onMarkerClick, onMarkerDragEnd, onMapClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const lineLayerRef = useRef<L.LayerGroup | null>(null);
  const circleLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: true })
      .setView(center || [31.2681, 72.3142], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19,
    }).addTo(map);
    circleLayerRef.current = L.layerGroup().addTo(map);
    lineLayerRef.current = L.layerGroup().addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on('click', (e: L.LeafletMouseEvent) => {
      const cb = (mapRef.current as any)?._dtOnMapClick as ((lat: number, lng: number) => void) | undefined;
      if (cb) cb(e.latlng.lat, e.latlng.lng);
    });
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers + polylines + circles
  useEffect(() => {
    if (!mapRef.current || !layerRef.current || !lineLayerRef.current || !circleLayerRef.current) return;
    layerRef.current.clearLayers();
    lineLayerRef.current.clearLayers();
    circleLayerRef.current.clearLayers();
    const bounds: L.LatLngTuple[] = [];

    circles.forEach(c => {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || !c.radiusM) return;
      const circle = L.circle([c.lat, c.lng], {
        radius: c.radiusM,
        color: c.color || '#2563eb',
        weight: c.weight ?? 2,
        fillColor: c.fillColor || c.color || '#2563eb',
        fillOpacity: c.fillOpacity ?? 0.12,
      }).addTo(circleLayerRef.current!);
      if (c.popupHtml) circle.bindPopup(c.popupHtml);
      const b = circle.getBounds();
      bounds.push([b.getNorth(), b.getEast()]);
      bounds.push([b.getSouth(), b.getWest()]);
    });

    polylines.forEach(pl => {
      if (!pl.points || pl.points.length < 2) return;
      const line = L.polyline(pl.points, {
        color: pl.color || '#2563eb',
        weight: pl.weight ?? 4,
        opacity: pl.opacity ?? 0.85,
        dashArray: pl.dashed ? '8 8' : undefined,
      }).addTo(lineLayerRef.current!);
      if (pl.popupHtml) line.bindPopup(pl.popupHtml);
      pl.points.forEach(p => bounds.push(p));
    });

    markers.forEach(m => {
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number') return;
      const icon = m.iconHtml
        ? L.divIcon({
            html: m.iconHtml,
            className: 'dt-marker-custom',
            iconSize: m.iconSize || [64, 78],
            iconAnchor: m.iconAnchor || [32, 78],
            popupAnchor: [0, -70],
          })
        : coloredIcon(m.color || 'blue');
      const marker = L.marker([m.lat, m.lng], { icon, title: m.title, draggable: !!m.draggable })
        .addTo(layerRef.current!);
      if (m.popupHtml) marker.bindPopup(m.popupHtml, { maxWidth: 320 });
      if (onMarkerClick) marker.on('click', () => onMarkerClick(m.id));
      if (m.draggable && onMarkerDragEnd) {
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          onMarkerDragEnd(m.id, ll.lat, ll.lng);
        });
      }
      bounds.push([m.lat, m.lng]);
    });
    // Stash latest map-click handler so the once-bound listener can call current closure.
    (mapRef.current as any)._dtOnMapClick = onMapClick;
    if (bounds.length === 1) {
      mapRef.current.setView(bounds[0], Math.max(zoom, 13));
    } else if (bounds.length > 1) {
      mapRef.current.fitBounds(bounds as any, { padding: [40, 40], maxZoom: 14 });
    }
  }, [markers, polylines, circles, onMarkerClick, onMarkerDragEnd, onMapClick, zoom]);

  return <div ref={containerRef} className={className} style={{ height, width: '100%', borderRadius: 8, overflow: 'hidden' }} />;
}
