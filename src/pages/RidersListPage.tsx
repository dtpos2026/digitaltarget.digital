// Riders management page — list of all riders with live online/offline status,
// active order count, lifetime stats, loyalty points. Click any rider to
// see detail panel with their orders.
import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Bike, Phone, MapPin, RefreshCw, Search, Trophy, CheckCircle2, Circle,
  TrendingUp, Truck, Clock, X,
} from 'lucide-react';
import { getRiders, getOrders, getSettings } from '@/lib/store';
import { Rider, Order } from '@/lib/types';
import { DELIVERY_STAGE_LABEL } from '@/lib/delivery';
import { isOnline as isRiderOnline, tsToMs } from '@/lib/geo';
import { toast } from 'sonner';

const ONLINE_MS = 3 * 60 * 1000;   // <3 min ping = online (rider heartbeat is 60s)
const OFFLINE_ALERT_MS = 5 * 60 * 1000;

export default function RidersListPage() {
  const [riders, setRiders] = useState<Rider[]>(() => getRiders());
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [search, setSearch] = useState('');
  const [activeRiderId, setActiveRiderId] = useState<string | null>(null);
  const settings = useMemo(() => getSettings(), []);

  // Refresh every 15s
  useEffect(() => {
    const t = setInterval(() => {
      setRiders(getRiders());
      setOrders(getOrders());
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  // Toast when an active rider goes offline (>5 min ping)
  useEffect(() => {
    const seenOffline = new Set<string>();
    const tick = () => {
      const now = Date.now();
      for (const r of riders) {
        if (!r.isActive) continue;
        const last = tsToMs(r.lastSeenAt);
        if (!last) continue;
        const offline = now - last > OFFLINE_ALERT_MS;
        if (offline && !seenOffline.has(r.id)) {
          seenOffline.add(r.id);
          toast.warning(`🛵 Rider ${r.name} offline (last ping ${Math.round((now-last)/60000)}m ago)`, { duration: 8000 });
        }
        if (!offline) seenOffline.delete(r.id);
      }
    };
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [riders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return riders
      .filter(r => !q || r.name.toLowerCase().includes(q) || (r.phone || '').includes(q))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive));
  }, [riders, search]);

  const activeRider = filtered.find(r => r.id === activeRiderId) || null;

  const onlineCount = riders.filter(r => isRiderOnline(tsToMs(r.lastSeenAt), ONLINE_MS)).length;

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Bike className="h-5 w-5 text-primary" /> Riders
        </h1>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            <Circle className="h-2 w-2 mr-1 fill-green-500 text-green-500" /> {onlineCount} online
          </Badge>
          <Button size="sm" variant="outline" onClick={() => { setRiders(getRiders()); setOrders(getOrders()); }}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Search rider name or phone"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </Card>

      <div className="grid lg:grid-cols-[1fr_400px] gap-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground col-span-full">
              Koi rider configured nahi — Settings → Riders se add karein.
            </Card>
          )}
          {filtered.map(r => (
            <RiderTile
              key={r.id}
              rider={r}
              orders={orders}
              active={r.id === activeRiderId}
              onClick={() => setActiveRiderId(r.id === activeRiderId ? null : r.id)}
            />
          ))}
        </div>

        {activeRider && (
          <RiderDetail
            rider={activeRider}
            orders={orders}
            settings={settings}
            onClose={() => setActiveRiderId(null)}
          />
        )}
      </div>
    </div>
  );
}

function RiderTile({ rider: r, orders, active, onClick }: {
  rider: Rider; orders: Order[]; active: boolean; onClick: () => void;
}) {
  const last = tsToMs(r.lastSeenAt);
  const online = isRiderOnline(last, ONLINE_MS);
  const activeOrders = orders.filter(o =>
    o.riderId === r.id &&
    o.deliveryStatus &&
    !['delivered', 'cancelled'].includes(o.deliveryStatus)
  ).length;
  const todayDelivered = (() => {
    const t0 = new Date(); t0.setHours(0,0,0,0);
    return orders.filter(o =>
      o.riderId === r.id && o.deliveredAt && new Date(o.deliveredAt).getTime() >= t0.getTime()
    ).length;
  })();

  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border-2 p-3 transition-all bg-card hover:shadow-md ${
        active ? 'border-primary ring-2 ring-primary/30' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Bike className="h-5 w-5" />
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${
            online ? 'bg-green-500 animate-pulse' : r.isActive ? 'bg-amber-400' : 'bg-gray-400'
          }`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{r.name}</div>
          <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
            <Phone className="h-2.5 w-2.5" /> {r.phone || '—'}
          </div>
        </div>
        <Badge variant={online ? 'default' : 'secondary'} className={`text-[9px] ${online ? 'bg-green-600' : ''}`}>
          {online ? 'ONLINE' : r.isActive ? 'OFFLINE' : 'OFF'}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-1 mt-3 text-center">
        <Stat label="Active" value={activeOrders} color="text-blue-600" />
        <Stat label="Today" value={todayDelivered} color="text-green-600" />
        <Stat label="Points" value={r.loyaltyPoints || 0} color="text-amber-600" />
      </div>
      <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
        <Clock className="h-2.5 w-2.5" />
        {last ? `Last seen ${timeAgo(Date.now() - last)}` : 'Never connected'}
      </div>
    </button>
  );
}

function RiderDetail({ rider: r, orders, settings, onClose }: {
  rider: Rider; orders: Order[]; settings: any; onClose: () => void;
}) {
  const mine = orders.filter(o => o.riderId === r.id);
  const active = mine.filter(o => o.deliveryStatus && !['delivered','cancelled'].includes(o.deliveryStatus));
  const delivered = mine.filter(o => o.deliveredAt);
  const totalEarnings = delivered.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const today = (() => {
    const t0 = new Date(); t0.setHours(0,0,0,0);
    return delivered.filter(o => new Date(o.deliveredAt!).getTime() >= t0.getTime());
  })();
  const last = tsToMs(r.lastSeenAt);
  const online = isRiderOnline(last, ONLINE_MS);

  return (
    <Card className="p-4 space-y-4 sticky top-4 max-h-[80vh] overflow-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Bike className="h-6 w-6" />
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${
              online ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
            }`} />
          </div>
          <div className="min-w-0">
            <div className="font-bold truncate">{r.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">{r.phone || '—'}</div>
            {r.bikeNumber && <div className="text-[10px] text-muted-foreground">🏍️ {r.bikeNumber}</div>}
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Kpi icon={<Truck className="h-3.5 w-3.5" />} label="Lifetime" value={r.totalDeliveries || delivered.length} />
        <Kpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Today" value={today.length} />
        <Kpi icon={<Trophy className="h-3.5 w-3.5" />} label="Loyalty Points" value={r.loyaltyPoints || 0} accent="text-amber-600" />
        <Kpi icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Total Sales" value={`${money(totalEarnings)}`} accent="text-primary" small />
      </div>

      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Active Orders ({active.length})</h4>
        {active.length === 0 && <p className="text-xs text-muted-foreground italic px-2 py-3">No active orders.</p>}
        <div className="space-y-1.5">
          {active.map(o => (
            <div key={o.id} className="rounded border p-2 text-[11px] flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">#{o.orderNumber} · {o.customer?.name || '—'}</div>
                <div className="text-muted-foreground flex items-center gap-1 truncate">
                  <MapPin className="h-2.5 w-2.5" /> {o.customer?.address || '—'}
                </div>
              </div>
              <Badge variant="outline" className="text-[9px]">{DELIVERY_STAGE_LABEL[o.deliveryStatus || 'pending']}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
          Delivered History ({delivered.length})
        </h4>
        {delivered.length === 0 && <p className="text-xs text-muted-foreground italic px-2 py-3">No deliveries completed yet.</p>}
        <div className="space-y-1 max-h-64 overflow-auto">
          {delivered.slice().sort((a, b) =>
            new Date(b.deliveredAt!).getTime() - new Date(a.deliveredAt!).getTime()
          ).slice(0, 50).map(o => (
            <div key={o.id} className="rounded border p-2 text-[11px] flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">#{o.orderNumber} · {o.customer?.name || '—'}</div>
                <div className="text-muted-foreground">{new Date(o.deliveredAt!).toLocaleString()}</div>
              </div>
              <span className="font-bold text-primary">{money(o.grandTotal)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div>
      <div className={`text-base font-extrabold ${color || ''}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
function Kpi({ icon, label, value, accent, small }: { icon: any; label: string; value: any; accent?: string; small?: boolean }) {
  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`font-extrabold ${accent || ''} ${small ? 'text-sm' : 'text-lg'}`}>{value}</div>
    </div>
  );
}
function timeAgo(ms: number): string {
  const s = Math.floor(ms/1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
