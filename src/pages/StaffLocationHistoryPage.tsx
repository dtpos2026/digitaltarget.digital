// Admin → Staff → Location History
// Shows every consent-shared GPS point for Order Takers / Riders:
// current position (marker) and the visited route (polyline).
import { useEffect, useMemo, useState } from 'react';
import LeafletMap, { type MapMarker, type MapPolyline } from '@/components/LeafletMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { MapPin, RefreshCw, Route } from 'lucide-react';
import { fetchLocationHistory, type StaffPoint } from '@/lib/staffLocation';

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

export default function StaffLocationHistoryPage() {
  const [day, setDay] = useState(isoDay(new Date()));
  const [points, setPoints] = useState<StaffPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | 'all'>('all');

  const load = async () => {
    setLoading(true);
    try {
      const from = new Date(`${day}T00:00:00`).toISOString();
      const to = new Date(`${day}T23:59:59.999`).toISOString();
      setPoints(await fetchLocationHistory({ from, to, limit: 3000 }));
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [day]);

  const staff = useMemo(() => {
    const map = new Map<string, { key: string; name: string; role?: string; count: number; last: StaffPoint }>();
    for (const p of points) {
      const prev = map.get(p.staffKey);
      if (!prev) map.set(p.staffKey, { key: p.staffKey, name: p.userName || p.staffKey, role: p.userRole, count: 1, last: p });
      else { prev.count += 1; if (p.recordedAt > prev.last.recordedAt) prev.last = p; }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [points]);

  const shown = useMemo(
    () => (selected === 'all' ? points : points.filter(p => p.staffKey === selected)),
    [points, selected],
  );

  const markers: MapMarker[] = useMemo(() => staff
    .filter(s => selected === 'all' || s.key === selected)
    .map(s => ({
      id: s.key,
      lat: s.last.lat,
      lng: s.last.lng,
      title: s.name,
      color: s.last.userRole === 'rider' ? 'green' : 'blue',
      popupHtml: `<b>${s.name}</b><br/>${s.role || 'staff'}<br/>Last seen: ${new Date(s.last.recordedAt).toLocaleTimeString()}<br/>Points: ${s.count}`,
    })), [staff, selected]);

  const polylines: MapPolyline[] = useMemo(() => {
    const byStaff = new Map<string, StaffPoint[]>();
    for (const p of shown) {
      const arr = byStaff.get(p.staffKey) || [];
      arr.push(p);
      byStaff.set(p.staffKey, arr);
    }
    return [...byStaff.entries()].map(([key, arr], i) => ({
      id: `route-${key}`,
      points: arr
        .slice()
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
        .map(p => [p.lat, p.lng] as [number, number]),
      color: ['#3C096C', '#0d9488', '#b45309', '#be123c', '#1d4ed8'][i % 5],
      weight: 4,
      opacity: 0.75,
    })).filter(l => l.points.length > 1);
  }, [shown]);

  const center: [number, number] | undefined = markers[0] ? [markers[0].lat, markers[0].lng] : undefined;

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-xl font-extrabold flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" /> Staff — Location History
          </h1>
          <p className="text-xs text-muted-foreground">
            Consent-based GPS trail for Order Takers and Riders. Only staff who turned sharing ON appear here.
          </p>
        </div>
        <Input type="date" value={day} onChange={e => setDay(e.target.value)} className="h-9 w-[160px]" />
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setSelected('all')}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${selected === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
        >
          All staff ({staff.length})
        </button>
        {staff.map(s => (
          <button
            key={s.key}
            onClick={() => setSelected(s.key)}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${selected === s.key ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
          >
            {s.name} · {s.count}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {shown.length > 0 ? (
          <LeafletMap markers={markers} polylines={polylines} height={420} center={center} zoom={14} />
        ) : (
          <div className="h-[220px] flex flex-col items-center justify-center text-sm text-muted-foreground gap-1">
            <Route className="h-6 w-6 opacity-50" />
            No location points for this day.
          </div>
        )}
      </Card>

      <Card className="p-0 overflow-auto max-h-[320px]">
        <table className="w-full text-xs">
          <thead className="bg-muted sticky top-0">
            <tr className="text-left">
              <th className="p-2">Time</th>
              <th className="p-2">Staff</th>
              <th className="p-2">Role</th>
              <th className="p-2">Device</th>
              <th className="p-2">Coordinates</th>
              <th className="p-2">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 300).map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{new Date(p.recordedAt).toLocaleString()}</td>
                <td className="p-2 font-semibold">{p.userName || p.staffKey}</td>
                <td className="p-2">{p.userRole || '—'}</td>
                <td className="p-2">{p.deviceName || '—'}</td>
                <td className="p-2 font-mono">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</td>
                <td className="p-2">{p.accuracyM ? `${Math.round(p.accuracyM)} m` : '—'}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Nothing recorded.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
