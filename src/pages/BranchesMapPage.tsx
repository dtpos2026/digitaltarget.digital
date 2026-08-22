import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getBranches, getOrders, getSettings } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, MapPin, ExternalLink, Phone } from 'lucide-react';
import { Branch } from '@/lib/types';
import LeafletMap, { type MapMarker, type MapCircle } from '@/components/LeafletMap';

/**
 * Phase 7 — Branches Map
 * Uses OpenStreetMap embed (no API key required). Each branch with lat/lng
 * shows as a marker. Branches without coordinates appear in a side list.
 */
export default function BranchesMapPage() {
  const branches = useMemo(() => getBranches().filter(b => b.isActive), []);
  const orders = useMemo(() => getOrders(), []);
  const settings = useMemo(() => getSettings(), []);
  const logo = settings.logo || '';
  const restName = settings.name || 'Restaurant';
  const [active, setActive] = useState<Branch | null>(branches.find(b => b.lat && b.lng) || branches[0] || null);

  const mapped = branches.filter(b => typeof b.lat === 'number' && typeof b.lng === 'number');
  const unmapped = branches.filter(b => !b.lat || !b.lng);

  const makeBranchIcon = (b: Branch, isActive: boolean) => {
    const ring = isActive ? '#d4af37' : '#2563eb';
    const inner = logo
      ? `<img src="${logo}" alt="" style="width:42px;height:42px;border-radius:50%;object-fit:cover;background:#fff" />`
      : `<div style="width:42px;height:42px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;color:${ring};font-size:16px">${(b.name || restName).charAt(0).toUpperCase()}</div>`;
    return `
      <div style="position:relative;width:64px;height:78px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.35))">
        <div style="position:absolute;left:50%;top:0;transform:translateX(-50%);width:54px;height:54px;border-radius:50%;background:${ring};padding:4px;box-sizing:border-box;border:2px solid #fff">
          ${inner}
        </div>
        <div style="position:absolute;left:50%;top:46px;transform:translateX(-50%);width:0;height:0;border-left:10px solid transparent;border-right:10px solid transparent;border-top:18px solid ${ring};"></div>
      </div>`;
  };

  const markers: MapMarker[] = mapped.map(b => ({
    id: b.id, lat: b.lat!, lng: b.lng!, title: b.name,
    color: active?.id === b.id ? 'gold' : 'blue',
    iconHtml: makeBranchIcon(b, active?.id === b.id),
    iconSize: [64, 78], iconAnchor: [32, 78],
    popupHtml: `<b>🏪 ${b.name}</b><br/>${b.address || ''}${b.serviceRadiusKm ? `<br/>Service radius: ${b.serviceRadiusKm} km` : ''}`,
  }));
  const circles: MapCircle[] = mapped.filter(b => b.serviceRadiusKm && b.serviceRadiusKm > 0).map(b => ({
    id: 'r-' + b.id, lat: b.lat!, lng: b.lng!, radiusM: (b.serviceRadiusKm || 0) * 1000,
    color: active?.id === b.id ? '#16a34a' : '#2563eb',
    fillColor: active?.id === b.id ? '#16a34a' : '#2563eb',
    fillOpacity: 0.08,
  }));
  const center: [number, number] | undefined = active?.lat && active?.lng ? [active.lat, active.lng] : undefined;

  const statsFor = (id: string) => {
    const list = orders.filter(o => o.branchId === id && o.status === 'paid');
    return { count: list.length, revenue: list.reduce((s, o) => s + (o.grandTotal || 0), 0) };
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <MapPin className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Branches Map — Pakistan</h2>
        <Badge variant="secondary" className="ml-auto">{mapped.length} mapped / {branches.length} total</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-0 overflow-hidden h-[520px]">
          {branches.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No branches yet. Add branches in the Branches page.
            </div>
          ) : (
            <LeafletMap
              markers={markers}
              circles={circles}
              height="100%"
              center={center}
              zoom={13}
              onMarkerClick={(id) => setActive(branches.find(b => b.id === id) || null)}
            />
          )}
        </Card>

        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {branches.map(b => {
            const s = statsFor(b.id);
            const hasGeo = b.lat && b.lng;
            const isActive = active?.id === b.id;
            return (
              <Card
                key={b.id}
                className={`p-3 cursor-pointer transition-smooth ${isActive ? 'ring-2 ring-primary' : ''} ${!hasGeo ? 'opacity-70' : ''}`}
                onClick={() => hasGeo && setActive(b)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-primary" /> {b.name}
                    </div>
                    {b.city && <div className="text-[11px] text-muted-foreground">{b.city}</div>}
                    {b.address && <div className="text-[11px] text-muted-foreground truncate">{b.address}</div>}
                    {b.phone && <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {b.phone}</div>}
                  </div>
                  {hasGeo ? (
                    <Badge className="text-[9px]">Mapped</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px]">No GPS</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 mt-2 border-t text-center">
                  <div>
                    <div className="text-[9px] text-muted-foreground">Orders</div>
                    <div className="text-xs font-bold">{s.count}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-muted-foreground">Revenue</div>
                    <div className="text-xs font-bold text-primary">{money(s.revenue)}</div>
                  </div>
                </div>
                {hasGeo && (
                  <a
                    href={`https://www.google.com/maps?q=${b.lat},${b.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-[10px] text-primary inline-flex items-center gap-1 mt-1 hover:underline"
                  >
                    Open in Google Maps <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {unmapped.length > 0 && (
        <Card className="p-3 bg-amber-50 border-amber-200 text-xs">
          <strong>{unmapped.length}</strong> branch(es) have no GPS coordinates. Open Branches → Edit and set Latitude / Longitude to show them on the map.
          You can grab coordinates from Google Maps by right-clicking any location.
        </Card>
      )}
    </div>
  );
}
