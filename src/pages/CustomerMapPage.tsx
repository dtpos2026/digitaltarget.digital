import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { useNavigate } from '@/lib/hash-router';
import { getCustomers, getOrders, getBranches, getSettings } from '@/lib/store';
import { CustomerProfile, Order } from '@/lib/types';
import { computeGrade, gradeColor } from '@/lib/customers';
import { computeDistance } from '@/lib/delivery';
import LeafletMap, { MapMarker } from '@/components/LeafletMap';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MapPin, Users, TrendingUp, Award, Filter, Search, Phone, Plus } from 'lucide-react';

type Range = 'today' | 'week' | 'month' | 'year' | 'all';

function rangeStart(r: Range): number {
  const now = Date.now();
  switch (r) {
    case 'today': { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
    case 'week':  return now - 7 * 86400000;
    case 'month': return now - 30 * 86400000;
    case 'year':  return now - 365 * 86400000;
    default:      return 0;
  }
}

export default function CustomerMapPage() {
  const navigate = useNavigate();
  const allCustomers = getCustomers();
  const allOrders = getOrders();
  const branches = getBranches();
  const settings = getSettings();
  // Prefer the active/first branch's GPS as the "restaurant" pin.
  // Fall back to legacy settings.restaurantLat/Lng only if no branch has GPS.
  const _primaryBranch = (branches || []).find(b => b.lat != null && b.lng != null && (b as any).isActive !== false);
  const restLat = _primaryBranch?.lat ?? settings.restaurantLat;
  const restLng = _primaryBranch?.lng ?? settings.restaurantLng;
  const restName = _primaryBranch?.name || settings.name || 'Restaurant';
  const restAddress = _primaryBranch?.address || settings.address || '';

  const [range, setRange] = useState<Range>('month');
  const [branchId, setBranchId] = useState<string>('all');
  const [city, setCity] = useState<string>('all');
  const [area, setArea] = useState<string>('all');
  const [search, setSearch] = useState('');

  const sinceMs = rangeStart(range);

  // Orders filtered by range + branch.
  // Include ALL non-void orders (paid, credit_received, pending) so online/website
  // delivery orders (which start as 'pending') also appear on the map.
  const orders = useMemo(() => allOrders.filter(o => {
    if (o.status === 'void' || o.status === 'cancelled') return false;
    const t = new Date(o.paidAt || o.createdAt).getTime();
    if (t < sinceMs) return false;
    if (branchId !== 'all' && o.branchId !== branchId) return false;
    return true;
  }), [allOrders, sinceMs, branchId]);


  // Phone → activity index within filtered range (also captures name/city from order for Unknown fallback)
  const activity = useMemo(() => {
    const map = new Map<string, { count: number; spend: number; last?: string; name?: string; city?: string; address?: string }>();
    for (const o of orders) {
      const phone = (o.customer?.phone || o.creditCustomerPhone || '').replace(/\D/g, '');
      if (!phone) continue;
      const e = map.get(phone) || { count: 0, spend: 0 };
      e.count += 1;
      e.spend += o.grandTotal || 0;
      e.last = o.paidAt || o.createdAt;
      e.name = e.name || o.customer?.name || o.creditCustomerName || undefined;
      e.city = e.city || o.customer?.city || undefined;
      e.address = e.address || o.customer?.fullAddress || o.customer?.address || o.creditCustomerAddress || undefined;
      map.set(phone, e);
    }
    return map;
  }, [orders]);

  const cities = useMemo(() => Array.from(new Set(allCustomers.map(c => c.city).filter(Boolean))).sort() as string[], [allCustomers]);
  const areas  = useMemo(() => Array.from(new Set(allCustomers.map(c => c.area).filter(Boolean))).sort() as string[], [allCustomers]);

  // Customers visible after filters
  const customers = useMemo(() => {
    const s = search.trim().toLowerCase();
    return allCustomers.filter(c => {
      if (city !== 'all' && c.city !== city) return false;
      if (area !== 'all' && c.area !== area) return false;
      if (s && !(c.name?.toLowerCase().includes(s) || (c.phone || '').includes(s))) return false;
      return true;
    });
  }, [allCustomers, city, area, search]);

  // Find latest order per phone (for source / IP popup)
  const lastOrderByPhone = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of allOrders) {
      const ph = (o.customer?.phone || '').replace(/\D/g, '');
      if (!ph) continue;
      const prev = m.get(ph);
      if (!prev || new Date(o.createdAt).getTime() > new Date(prev.createdAt).getTime()) m.set(ph, o);
    }
    return m;
  }, [allOrders]);

  // Markers (only customers with GPS) + restaurant pin
  const markers: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = customers
      .filter(c => c.lat != null && c.lng != null)
      .map(c => {
        const key = (c.phone || c.id).replace(/\D/g, '');
        const act = activity.get(key);
        const grade = c.grade || computeGrade(c.totalSpent || 0);
        const color = grade === 'platinum' ? 'gold' : grade === 'gold' ? 'orange' : grade === 'silver' ? 'gray' : 'blue';
        const dist = (restLat != null && restLng != null)
          ? computeDistance({ lat: restLat, lng: restLng }, { lat: c.lat!, lng: c.lng! }).toFixed(2) + ' km'
          : null;
        const lo = lastOrderByPhone.get(key);
        const src = lo?.source || 'pos';
        const ip = lo?.delivery?.customerIp || '';
        const popup = `
          <div style="font-family:system-ui;min-width:220px">
            <div style="font-weight:700;font-size:14px">${escapeHtml(c.name)}</div>
            <div style="font-size:11px;color:#64748b;margin-bottom:4px">${escapeHtml(c.phone)}</div>
            <div style="font-size:11px;margin:2px 0">${escapeHtml(c.fullAddress || c.addresses?.[0] || '')}</div>
            ${dist ? `<div style="font-size:11px;color:#0f766e;margin:2px 0"><b>📏 ${dist}</b> from restaurant</div>` : ''}
            <div style="font-size:10px;color:#475569;margin:2px 0">Source: <b>${src.toUpperCase()}</b>${ip ? ` · IP: ${ip}` : ''}</div>
            <div style="font-size:11px;margin-top:4px"><b>${c.totalOrders}</b> orders · <b>${money((c.totalSpent || 0))}</b></div>
            ${act ? `<div style="font-size:10px;color:#475569">In range: ${act.count} orders · ${money(act.spend)}</div>` : ''}
            ${c.lastOrderAt ? `<div style="font-size:10px;color:#475569">Last: ${new Date(c.lastOrderAt).toLocaleDateString()}</div>` : ''}
            <a href="#/?customer=${encodeURIComponent(c.phone)}" style="display:inline-block;margin-top:6px;padding:4px 10px;background:#0f172a;color:#fff;border-radius:6px;font-size:11px;text-decoration:none">+ Create Order</a>
          </div>`;
        return { id: c.id, lat: c.lat!, lng: c.lng!, title: c.name, popupHtml: popup, color: color as any };
      });
    // Also add pins from orders that have GPS but no matching customer profile
    const seen = new Set(customers.filter(c => c.lat != null && c.lng != null).map(c => (c.phone || c.id).replace(/\D/g, '')));
    for (const o of allOrders) {
      const lat = o.customer?.lat;
      const lng = o.customer?.lng;
      if (lat == null || lng == null) continue;
      const ph = (o.customer?.phone || '').replace(/\D/g, '');
      const key = ph || `o_${o.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = o.customer?.name || 'Walk-in';
      const dist = (restLat != null && restLng != null)
        ? computeDistance({ lat: restLat, lng: restLng }, { lat, lng }).toFixed(2) + ' km'
        : null;
      const src = (o.source || 'pos').toUpperCase();
      const popup = `
        <div style="font-family:system-ui;min-width:220px">
          <div style="font-weight:700;font-size:14px">${escapeHtml(name)}</div>
          <div style="font-size:11px;color:#64748b;margin-bottom:4px">${escapeHtml(o.customer?.phone || '')}</div>
          <div style="font-size:11px;margin:2px 0">${escapeHtml(o.customer?.fullAddress || o.customer?.address || '')}</div>
          ${dist ? `<div style="font-size:11px;color:#0f766e;margin:2px 0"><b>📏 ${dist}</b> from restaurant</div>` : ''}
          <div style="font-size:10px;color:#475569;margin:2px 0">Source: <b>${src}</b></div>
          <div style="font-size:10px;color:#475569">Order #${o.orderNumber} · ${money((o.grandTotal || 0))}</div>
        </div>`;
      out.push({ id: key, lat, lng, title: name, popupHtml: popup, color: 'blue' as any });
    }
    // Add ALL branches with GPS as live green pins (gray if inactive)
    for (const b of (branches || [])) {
      if (b.lat == null || b.lng == null) continue;
      const isActive = (b as any).isActive !== false;
      const isPrimary = _primaryBranch && b.id === _primaryBranch.id;
      const color = isPrimary ? 'red' : (isActive ? 'green' : 'gray');
      const label = isPrimary ? '🏪 Main Branch' : (isActive ? '🟢 Live Branch' : '⚪ Inactive Branch');
      out.unshift({
        id: `__branch_${b.id}`,
        lat: b.lat as number,
        lng: b.lng as number,
        title: b.name,
        popupHtml: `<div style="font-family:system-ui;min-width:180px">
          <div style="font-weight:800;font-size:13px;color:${isPrimary ? '#dc2626' : (isActive ? '#16a34a' : '#64748b')}">${label}</div>
          <div style="font-weight:700;font-size:13px;margin-top:2px">${escapeHtml(b.name)}</div>
          <div style="font-size:10px;color:#64748b">${escapeHtml((b as any).address || '')}</div>
          <div style="font-size:10px;color:#64748b;margin-top:3px">Status: <b style="color:${isActive ? '#16a34a' : '#64748b'}">${isActive ? 'ACTIVE' : 'INACTIVE'}</b></div>
        </div>`,
        color: color as any,
      });
    }
    // Legacy fallback: settings-level restaurant pin only if NO branches with GPS exist
    const anyBranchGps = (branches || []).some(b => b.lat != null && b.lng != null);
    if (!anyBranchGps && restLat != null && restLng != null) {
      out.unshift({
        id: '__restaurant__',
        lat: restLat,
        lng: restLng,
        title: restName,
        popupHtml: `<div style="font-family:system-ui;min-width:160px"><div style="font-weight:800;font-size:13px;color:#dc2626">🏪 ${escapeHtml(restName)}</div><div style="font-size:10px;color:#64748b">${escapeHtml(restAddress)}</div></div>`,
        color: 'red' as any,
      });
    }
    return out;
  }, [customers, activity, restLat, restLng, lastOrderByPhone, restName, restAddress, allOrders, branches, _primaryBranch]);


  const _branchGps = (getBranches() || []).find(b => b.lat != null && b.lng != null);
  const center: [number, number] = (restLat != null && restLng != null)
    ? [restLat, restLng]
    : _branchGps
      ? [_branchGps.lat as number, _branchGps.lng as number]
      : markers.length
        ? [markers.reduce((s, m) => s + m.lat, 0) / markers.length, markers.reduce((s, m) => s + m.lng, 0) / markers.length]
        : [31.2681, 72.3142]; // Jhang fallback

  // Analytics aggregations
  const topAreas = useMemo(() => agg(customers, 'area', activity), [customers, activity]);
  const topCities = useMemo(() => agg(customers, 'city', activity), [customers, activity]);

  // Top customers: built from ACTIVITY (orders) so real name/phone/city show even
  // when a CustomerProfile record is missing. Profile data merged when available.
  const topCustomers = useMemo(() => {
    const profileByPhone = new Map<string, CustomerProfile>();
    for (const c of allCustomers) {
      const k = (c.phone || c.id).replace(/\D/g, '');
      if (k) profileByPhone.set(k, c);
    }
    const rows: Array<{ id: string; name: string; phone: string; city?: string; count: number; spend: number; profile?: CustomerProfile }> = [];
    for (const [phone, a] of activity.entries()) {
      const p = profileByPhone.get(phone);
      const name = (p?.name || a.name || '').trim();
      // Skip truly anonymous entries (no name AND no phone)
      if (!name && !phone) continue;
      rows.push({
        id: p?.id || phone,
        name: name || 'Walk-in',
        phone: p?.phone || phone,
        city: p?.city || a.city,
        count: a.count,
        spend: a.spend,
        profile: p,
      });
    }
    return rows.sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [activity, allCustomers]);

  // KPIs
  const newCustomerCount = customers.filter(c => c.firstOrderAt && new Date(c.firstOrderAt).getTime() >= sinceMs).length;
  const returningCount = customers.filter(c => (c.totalOrders || 0) > 1).length;
  const totalSpendRange = Array.from(activity.values()).reduce((s, a) => s + a.spend, 0);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> Customer Map Analytics</h1>
        <Badge variant="secondary" className="text-xs">{markers.length} pins · {customers.length} customers</Badge>
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Filter className="h-3.5 w-3.5" /> Filters</div>
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Branch" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="City" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Cities</SelectItem>
              {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Area" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Areas</SelectItem>
              {areas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder="Search name or phone" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* KPI tiles */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Customers (visible)" value={customers.length.toString()} icon={<Users className="h-4 w-4" />} />
        <KpiTile label="New (in range)" value={newCustomerCount.toString()} icon={<TrendingUp className="h-4 w-4" />} />
        <KpiTile label="Returning" value={returningCount.toString()} icon={<Award className="h-4 w-4" />} />
        <KpiTile label="Spend (range)" value={`${money(totalSpendRange)}`} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      {/* Map + Analytics */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="p-2">
          <LeafletMap markers={markers} height={520} center={center} zoom={markers.length ? 10 : 5} />
          {markers.length === 0 && (
            <p className="text-xs text-center text-muted-foreground py-3">
              No customers with GPS in this filter. Capture customer location during delivery orders.
            </p>
          )}
        </Card>

        <Card className="p-3">
          <Tabs defaultValue="areas">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="areas">Areas</TabsTrigger>
              <TabsTrigger value="cities">Cities</TabsTrigger>
              <TabsTrigger value="top">Top Customers</TabsTrigger>
            </TabsList>
            <TabsContent value="areas" className="space-y-1.5 mt-3 max-h-[460px] overflow-auto">
              {topAreas.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No area data.</p>}
              {topAreas.map((row, i) => (
                <AnalyticsRow key={row.key} rank={i + 1} title={row.key} subtitle={`${row.customers} customers`} value={`${money(row.spend)}`} />
              ))}
            </TabsContent>
            <TabsContent value="cities" className="space-y-1.5 mt-3 max-h-[460px] overflow-auto">
              {topCities.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No city data.</p>}
              {topCities.map((row, i) => (
                <AnalyticsRow key={row.key} rank={i + 1} title={row.key} subtitle={`${row.customers} customers`} value={`${money(row.spend)}`} />
              ))}
            </TabsContent>
            <TabsContent value="top" className="space-y-1.5 mt-3 max-h-[460px] overflow-auto">
              {topCustomers.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No customer activity.</p>}
              {topCustomers.map((row, i) => {
                const g = row.profile?.grade || computeGrade(row.profile?.totalSpent || row.spend || 0);
                return (
                  <div key={row.id} className="flex items-center gap-2 p-2 rounded hover:bg-accent/40">
                    <div className="h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-1.5">
                        {row.name}
                        <Badge className={`text-[9px] uppercase ${gradeColor(g)}`}>{g}</Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Phone className="h-3 w-3" />{row.phone}{row.city ? ` · ${row.city}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-primary">{money(row.spend)}</div>
                      <div className="text-[10px] text-muted-foreground">{row.count} orders</div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => navigate(`/?customer=${encodeURIComponent(row.phone)}`)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function KpiTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </Card>
  );
}

function AnalyticsRow({ rank, title, subtitle, value }: { rank: number; title: string; subtitle: string; value: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded hover:bg-accent/40">
      <div className="h-7 w-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{rank}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-[10px] text-muted-foreground">{subtitle}</div>
      </div>
      <div className="text-xs font-bold text-primary">{value}</div>
    </div>
  );
}

function agg(customers: CustomerProfile[], key: 'area' | 'city', activity: Map<string, { count: number; spend: number; last?: string }>) {
  const map = new Map<string, { spend: number; customers: number }>();
  for (const c of customers) {
    const k = c[key] || 'Unknown';
    const e = map.get(k) || { spend: 0, customers: 0 };
    const actKey = (c.phone || c.id).replace(/\D/g, '');
    const act = activity.get(actKey);
    e.spend += act?.spend || c.totalSpent || 0;
    e.customers += 1;
    map.set(k, e);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 15);
}

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
