import { useEffect, useMemo, useRef, useState } from 'react';
import { money, currencySymbol } from '@/lib/currency';
import { useNavigate } from '@/lib/hash-router';
import { getOrders, getSettings, saveSettings, refreshOrdersFromCloud, onDataChange } from '@/lib/store';
import { getTenantId, getTenantName } from '@/lib/tenant';
import { Order, RestaurantSettings } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { uploadTenantImage } from '@/lib/storage';
import { Globe, Copy, ExternalLink, ShoppingBag, MapPin, Bike, Users, Power, Truck, Package, Settings as SettingsIcon, RefreshCw, Phone, Search, Palette, Image as ImageIcon, Upload } from 'lucide-react';

/**
 * Customer Portal / Online Website module — single dashboard from where
 * the owner controls the public website, sees live online orders, and
 * manages online customer accounts. Per-tenant (each restaurant separate).
 */
export default function OnlinePortalPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<RestaurantSettings>(() => getSettings());
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  const [qrLink, setQrLink] = useState<{ url: string; label: string } | null>(null);

  // v1.42.0 — this restaurant's readable slug, for the links below. The POS is
  // signed in, so it can read its own tenants row; a failure just leaves the
  // uuid form, which has always worked.
  const [slug, setSlug] = useState<string>('');
  useEffect(() => {
    let off = false;
    void (async () => {
      try {
        const t = getTenantId();
        const { sb, isSupabaseConfigured } = await import('@/lib/supabase');
        if (!t || !isSupabaseConfigured()) return;
        const { data } = await sb().from('tenants').select('slug').eq('id', t).maybeSingle();
        const v = (data as { slug?: string } | null)?.slug;
        if (!off && v) setSlug(v);
      } catch { /* the uuid link stays */ }
    })();
    return () => { off = true; };
  }, []);

  useEffect(() => {
    // Initial pull, then rely on realtime onSnapshot listeners (no polling)
    refreshOrdersFromCloud().then(() => { setOrders(getOrders()); setTick(x => x + 1); }).catch(() => {});
    const off = onDataChange((col) => {
      if (col === 'orders' || col === '*') { setOrders(getOrders()); setTick(x => x + 1); }
      if (col === 'settings') setSettings(getSettings());
    });
    return () => { off(); };
  }, []);

  const tid = getTenantId() || '';
  // In Electron EXE window.location.origin is `file://` — fall back to the
  // public Firebase hosting URL so QR / share links always open online.
  // v1.24.0 — the public portal lives on the product's own domain now.
  const PUBLIC_WEB_BASE =
    ((import.meta as any).env?.VITE_PUBLIC_SITE_URL as string | undefined)
    || (typeof window !== 'undefined' && !window.location.origin.startsWith('file:')
        ? window.location.origin
        : 'https://digitaltarget.digital');
  const rawOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const origin = (!rawOrigin || rawOrigin.startsWith('file:')) ? PUBLIC_WEB_BASE : rawOrigin;
  // v1.42.0 — hand out the readable link when the restaurant has a slug.
  // digitaltarget.digital/#/order/butt instead of a uuid nobody can repeat
  // over the phone. The uuid form keeps working, so links already printed on
  // a table QR are not invalidated.
  const tidSeg = slug ? `/${slug}` : (tid ? `/${tid}` : '');
  const links = [
    { key: 'order',    label: 'Customer Website',    emoji: '🛒', icon: ShoppingBag, url: `${origin}/#/order${tidSeg}`,                       color: 'bg-blue-500/10 text-blue-700 border-blue-500/30',     sourceKey: 'website' },
    { key: 'takeaway', label: 'Takeaway QR Portal',  emoji: '🛍️', icon: Package,    url: `${origin}/#/order${tidSeg}?mode=takeaway`,         color: 'bg-orange-500/10 text-orange-700 border-orange-500/30', sourceKey: 'takeaway_qr' },
    { key: 'delivery', label: 'Delivery QR Portal',  emoji: '🛵', icon: Truck,       url: `${origin}/#/order${tidSeg}?mode=delivery`,         color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30', sourceKey: 'website' },
    { key: 'table',    label: 'Table QR (Dine-In)',  emoji: '🍽️', icon: Users,      url: `${origin}/#/order${tidSeg}?table=Table%201`,       color: 'bg-violet-500/10 text-violet-700 border-violet-500/30', sourceKey: 'qr' },
    { key: 'track',    label: 'Order Tracking',      emoji: '📍', icon: MapPin,      url: `${origin}/#/track${tidSeg}`,                       color: 'bg-amber-500/10 text-amber-700 border-amber-500/30',  sourceKey: null },
    { key: 'rider',    label: 'Rider Portal',        emoji: '🏍️', icon: Bike,       url: `${origin}/#/rider-portal${tidSeg}`,                color: 'bg-green-500/10 text-green-700 border-green-500/30',  sourceKey: 'rider' },
    { key: 'taker',    label: 'Order Taker Portal',  emoji: '📞', icon: Phone,       url: `${origin}/#/order-taker${tidSeg}`,                 color: 'bg-slate-500/10 text-slate-700 border-slate-500/30',  sourceKey: 'order_taker' },
  ];

  const webOrders = useMemo(() => orders.filter(o => (o as any).source === 'website'), [orders, tick]);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayOrders = useMemo(() => webOrders.filter(o => new Date(o.createdAt).getTime() >= todayStart.getTime()), [webOrders]);
  const activeOrders = useMemo(() => webOrders.filter(o => !['delivered', 'cancelled', 'paid', 'void'].includes((o.deliveryStatus || o.status) as string)), [webOrders]);
  const todayRevenue = todayOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);

  // Per-portal analytics (source-based)
  const portalStats = useMemo(() => {
    const stats: Record<string, { total: number; today: number }> = {};
    const todayMs = todayStart.getTime();
    for (const l of links) {
      let filtered = orders;
      if (l.key === 'takeaway') {
        filtered = orders.filter(o => (o as any).pickupRequested || (o as any).source === 'takeaway_qr' || ((o as any).source === 'website' && o.orderType === 'takeaway'));
      } else if (l.key === 'delivery') {
        filtered = orders.filter(o => (o as any).source === 'website' && o.orderType === 'delivery');
      } else if (l.key === 'table') {
        filtered = orders.filter(o => (o as any).source === 'qr' || ((o as any).tableLabel && (o as any).source !== 'pos'));
      } else if (l.key === 'order') {
        filtered = orders.filter(o => (o as any).source === 'website');
      } else if (l.key === 'rider') {
        filtered = orders.filter(o => (o as any).source === 'rider');
      } else if (l.key === 'taker') {
        filtered = orders.filter(o => (o as any).source === 'order_taker');
      } else {
        filtered = [];
      }
      stats[l.key] = {
        total: filtered.length,
        today: filtered.filter(o => new Date(o.createdAt).getTime() >= todayMs).length,
      };
    }
    return stats;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, tick]);

  // Online customer accounts derived from website orders
  const customers = useMemo(() => {
    const map = new Map<string, { name: string; phone: string; orders: number; total: number; lastAt: string }>();
    for (const o of webOrders) {
      const phone = (o.customer?.phone || '').replace(/\D/g, '');
      if (!phone) continue;
      const ex = map.get(phone);
      if (ex) {
        ex.orders += 1;
        ex.total += o.grandTotal || 0;
        if (new Date(o.createdAt) > new Date(ex.lastAt)) ex.lastAt = o.createdAt;
      } else {
        map.set(phone, { name: o.customer?.name || '—', phone, orders: 1, total: o.grandTotal || 0, lastAt: o.createdAt });
      }
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
  }, [webOrders]);

  const filteredCustomers = customers.filter(c =>
    !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search.replace(/\D/g, ''))
  );

  const persist = (patch: Partial<RestaurantSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const copy = (url: string, label: string) => {
    navigator.clipboard.writeText(url); toast.success(`${label} link copied!`);
  };

  const masterOn = settings.onlineOrderEnabled !== false;

  return (
    <div className="p-3 lg:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 text-white flex items-center justify-center shadow-md">
          <Globe className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight">Customer Portal / Online Website</h1>
          <p className="text-[11px] text-muted-foreground">
            <b>{getTenantName() || 'Restaurant'}</b> ka online ordering control center — links, live orders, customers, settings sab yahin se.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
          <SettingsIcon className="h-3.5 w-3.5 mr-1" /> Advanced Settings
        </Button>
      </div>

      {/* Master switches */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Power className={`h-4 w-4 ${masterOn ? 'text-green-600' : 'text-muted-foreground'}`} />
          <h3 className="text-sm font-bold">Master Switches</h3>
          <Badge variant={masterOn ? 'default' : 'secondary'} className={`ml-auto ${masterOn ? 'bg-green-600' : ''}`}>
            {masterOn ? 'LIVE' : 'OFFLINE'}
          </Badge>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <ToggleTile label="Website ON" sub="Master switch" icon={Globe}
            on={masterOn} onChange={v => persist({ onlineOrderEnabled: v })} />
          <ToggleTile label="Delivery" sub="Home delivery" icon={Truck}
            on={settings.onlineDeliveryEnabled !== false} onChange={v => persist({ onlineDeliveryEnabled: v })} disabled={!masterOn} />
          <ToggleTile label="Pickup" sub="Self pickup" icon={Package}
            on={settings.onlinePickupEnabled !== false} onChange={v => persist({ onlinePickupEnabled: v })} disabled={!masterOn} />
          <ToggleTile label="Guest Checkout" sub="No signup needed" icon={Users}
            on={settings.allowGuestCheckout !== false} onChange={v => persist({ allowGuestCheckout: v })} disabled={!masterOn} />
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active Online Orders" value={activeOrders.length} icon={ShoppingBag} accent="text-blue-600" bg="bg-blue-500/10" />
        <StatCard label="Today's Orders" value={todayOrders.length} icon={Truck} accent="text-amber-600" bg="bg-amber-500/10" />
        <StatCard label="Today's Revenue" value={`${money(todayRevenue)}`} icon={Globe} accent="text-green-600" bg="bg-green-500/10" small />
        <StatCard label="Total Customers" value={customers.length} icon={Users} accent="text-purple-600" bg="bg-purple-500/10" />
      </div>

      {/* Customer Portals / Websites — full hub */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ExternalLink className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Customer Portals / Websites</h3>
          {!tid && <Badge variant="destructive" className="ml-auto text-[9px]">No Tenant</Badge>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Saare customer-facing portals ek jagah — <b>{getTenantName() || 'is restaurant'}</b> ke liye. Open / Copy / QR neeche instead.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {links.map(l => {
            const s = portalStats[l.key] || { total: 0, today: 0 };
            const qrSupported = l.key === 'takeaway' || l.key === 'delivery' || l.key === 'table' || l.key === 'order' || l.key === 'track';
            return (
              <div key={l.key} className={`rounded-lg border p-3 space-y-2 ${l.color}`}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{l.emoji}</span>
                  <l.icon className="h-4 w-4" />
                  <span className="text-xs font-bold flex-1">{l.label}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <div className="bg-background/60 rounded px-2 py-1 font-semibold">Today: <b>{s.today}</b></div>
                  <div className="bg-background/60 rounded px-2 py-1 font-semibold">Total: <b>{s.total}</b></div>
                </div>
                <code className="block text-[10px] font-mono bg-background/60 p-1.5 rounded break-all">{l.url}</code>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="flex-1 h-7 text-[11px] bg-background"
                    onClick={() => copy(l.url, l.label)}>
                    <Copy className="h-3 w-3 mr-1" /> Copy
                  </Button>
                  <a href={l.url.replace(origin, '')} target="_blank" rel="noreferrer" className="flex-1">
                    <Button size="sm" variant="outline" className="w-full h-7 text-[11px] bg-background">
                      <ExternalLink className="h-3 w-3 mr-1" /> Open
                    </Button>
                  </a>
                  {qrSupported && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] bg-background"
                      title="Print/Download QR" onClick={() => { setQrLink({ url: l.url, label: l.label }); }}>
                      🔳
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => navigate('/menu')}>
            ✏️ Edit Menu / Items
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => navigate('/tables')}>
            🍽️ Table QR Manager
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => navigate('/whatsapp')}>
            💬 WhatsApp Templates
          </Button>
        </div>
      </Card>

      {qrLink && <QrModal url={qrLink.url} label={qrLink.label} onClose={() => setQrLink(null)} />}

      {/* Website Branding & Design */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Website Branding & Design</h3>
          <Badge variant="outline" className="ml-auto text-[9px]">Customer-facing</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Yeh fields aap ki <b>online ordering website</b>, <b>tracking page</b> aur <b>rider portal</b> par dikhte hain.
        </p>
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Restaurant Name</label>
              <Input value={settings.name || ''} onChange={e => persist({ name: e.target.value })} placeholder="e.g. DT Burger House" className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Tagline</label>
              <Input value={settings.onlineTagline || ''} onChange={e => persist({ onlineTagline: e.target.value })} placeholder="e.g. Fresh, Fast & Tasty" className="h-9 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">About / Welcome</label>
              <Textarea value={settings.onlineAbout || ''} onChange={e => persist({ onlineAbout: e.target.value })} placeholder="A short message for the customer…" className="text-sm min-h-[70px]" />
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[11px] font-bold text-muted-foreground">Brand Color</label>
                <div className="flex gap-1.5">
                  <input type="color" value={settings.onlineBrandColor || '#7c3aed'} onChange={e => persist({ onlineBrandColor: e.target.value })} className="h-9 w-12 rounded border cursor-pointer" />
                  <Input value={settings.onlineBrandColor || ''} onChange={e => persist({ onlineBrandColor: e.target.value })} placeholder="#7c3aed" className="h-9 text-xs font-mono" />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Web Portal Logo
                <span className="text-[9px] text-muted-foreground/70 font-normal">(alag se — receipt logo se independent)</span>
              </label>
              <div className="flex items-center gap-2">
                {(settings.webPortalLogo || settings.logo)
                  ? <img src={settings.webPortalLogo || settings.logo} alt="" className="h-14 w-14 rounded object-cover border" />
                  : <div className="h-14 w-14 rounded border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">No logo</div>}
                <label className="flex-1 cursor-pointer">
                  <input type="file" accept="image/*" className="hidden" onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return;
                    if (f.size > 2_000_000) { toast.error('Logo max 2 MB'); return; }
                    try { persist({ webPortalLogo: await uploadTenantImage(f, 'web-portal-logo') }); }
                    catch (err: any) { toast.error(err?.message || 'Upload failed'); }
                  }} />
                  <div className="h-9 border rounded flex items-center justify-center text-[11px] gap-1 hover:bg-muted">
                    <Upload className="h-3 w-3" /> Upload Web Portal Logo
                  </div>
                </label>
                {settings.webPortalLogo && <Button variant="ghost" size="sm" className="h-9 text-[11px]" onClick={() => persist({ webPortalLogo: '' })}>Remove</Button>}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">This logo appears only on the online ordering portal and the track-order page. The receipt logo stays separate.</p>
            </div>

            <div>
              <label className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Hero Banner (wide image)
              </label>
              <div className="space-y-1.5">
                {settings.onlineBanner
                  ? <img src={settings.onlineBanner} alt="" className="w-full h-24 rounded object-cover border" />
                  : <div className="w-full h-24 rounded border bg-gradient-to-br from-primary/10 to-purple-500/10 flex items-center justify-center text-[11px] text-muted-foreground">No banner uploaded</div>}
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={async e => {
                      const f = e.target.files?.[0]; if (!f) return;
                      if (f.size > 2_000_000) { toast.error('Banner max 2 MB'); return; }
                      try { persist({ onlineBanner: await uploadTenantImage(f, 'online-banner') }); }
                      catch (err: any) { toast.error(err?.message || 'Upload failed'); }
                    }} />
                    <div className="h-8 border rounded flex items-center justify-center text-[11px] gap-1 hover:bg-muted">
                      <Upload className="h-3 w-3" /> Upload Banner
                    </div>
                  </label>
                  {settings.onlineBanner && <Button variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => persist({ onlineBanner: '' })}>Remove</Button>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-muted-foreground">Phone</label>
                <Input value={settings.phone1 || ''} onChange={e => persist({ phone1: e.target.value })} placeholder="0300-1234567" className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-muted-foreground">Address</label>
                <Input value={settings.address || ''} onChange={e => persist({ address: e.target.value })} placeholder="Shop / area" className="h-9 text-sm" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground">Delivery Charge ({currencySymbol()})</label>
            <Input type="number" value={settings.deliveryCharge ?? ''} onChange={e => persist({ deliveryCharge: Number(e.target.value || 0) })} placeholder="100" className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground">Free Above ({currencySymbol()})</label>
            <Input type="number" value={settings.freeDeliveryThreshold ?? ''} onChange={e => persist({ freeDeliveryThreshold: Number(e.target.value || 0) })} placeholder="1500" className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground">Min Order ({currencySymbol()})</label>
            <Input type="number" value={settings.minOnlineOrder ?? ''} onChange={e => persist({ minOnlineOrder: Number(e.target.value || 0) })} placeholder="500" className="h-9 text-sm" />
          </div>
        </div>
      </Card>

      {/* Active website orders */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Live Website Orders ({activeOrders.length})</h3>
          <Button size="sm" variant="ghost" className="ml-auto h-7 text-[11px]" onClick={() => setOrders(getOrders())}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigate('/delivery')}>
            Open Delivery Board →
          </Button>
        </div>
        {activeOrders.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No active website orders.</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {activeOrders.slice(0, 30).map(o => (
              <div key={o.id} className="flex items-center gap-2 p-2 rounded-md border hover:bg-muted/40">
                <Badge variant="secondary" className="text-[10px] font-mono">#{o.orderNumber}</Badge>
                <div className="flex-1 min-w-0 text-[12px]">
                  <div className="font-semibold truncate">{o.customer?.name || '—'}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{o.customer?.phone || ''} · {o.items.length} items</div>
                </div>
                <Badge className="text-[10px]" variant="outline">{o.deliveryStatus || o.status}</Badge>
                <div className="font-bold text-primary text-sm">{money(o.grandTotal)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Online customer accounts */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold">Online Customers ({customers.length})</h3>
          <div className="ml-auto relative">
            <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / phone…" className="h-7 pl-7 text-[11px] w-48" />
          </div>
        </div>
        {filteredCustomers.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No online customers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left border-b text-muted-foreground text-[10px] uppercase">
                  <th className="py-1.5 px-2">Name</th>
                  <th className="py-1.5 px-2">Phone</th>
                  <th className="py-1.5 px-2 text-right">Orders</th>
                  <th className="py-1.5 px-2 text-right">Total Spent</th>
                  <th className="py-1.5 px-2">Last Order</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.slice(0, 100).map(c => (
                  <tr key={c.phone} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-1.5 px-2 font-semibold">{c.name}</td>
                    <td className="py-1.5 px-2">
                      <a href={`tel:${c.phone}`} className="text-primary inline-flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</a>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{c.orders}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-primary font-bold">{money(c.total)}</td>
                    <td className="py-1.5 px-2 text-[10px] text-muted-foreground">{new Date(c.lastAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ToggleTile({ label, sub, icon: Icon, on, onChange, disabled }: { label: string; sub: string; icon: any; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition ${on ? 'bg-primary/5 border-primary/40' : 'bg-muted/30'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      <Icon className={`h-4 w-4 ${on ? 'text-primary' : 'text-muted-foreground'}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold truncate">{label}</div>
        <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
      </div>
      <input type="checkbox" className="w-4 h-4" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

function StatCard({ label, value, icon: Icon, accent, bg, small }: { label: string; value: any; icon: any; accent: string; bg: string; small?: boolean }) {
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className={`h-9 w-9 rounded-lg ${bg} ${accent} flex items-center justify-center shrink-0`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
        <div className={`font-extrabold ${accent} ${small ? 'text-base' : 'text-xl'}`}>{value}</div>
      </div>
    </Card>
  );
}

function QrModal({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    let alive = true;
    import('qrcode').then(QR => {
      if (!alive) return;
      if (canvasRef.current) QR.toCanvas(canvasRef.current, url, { width: 260, margin: 1 }).catch(() => {});
      QR.toDataURL(url, { width: 600, margin: 2 }).then((d: string) => alive && setDataUrl(d)).catch(() => {});
    });
    return () => { alive = false; };
  }, [url]);
  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl; a.download = `QR-${label.replace(/\s+/g, '_')}.png`; a.click();
  };
  const print = () => {
    if (!dataUrl) return;
    const w = window.open('', '_blank', 'width=420,height=600');
    if (!w) return;
    w.document.write(`<html><head><title>QR · ${label}</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px;margin:0}
      h1{font-size:22px;margin:0 0 8px}img{width:320px;height:320px}p{font-size:11px;color:#555;word-break:break-all}
      .frame{border:2px dashed #333;display:inline-block;padding:18px;border-radius:12px}</style></head>
      <body><div class="frame"><h1>${label}</h1><img src="${dataUrl}" /><p>${url}</p></div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
    w.document.close();
  };
  return (
    <div className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-2xl shadow-elegant w-full max-w-sm p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-extrabold text-center">{label}</h3>
        <div className="flex justify-center"><div className="p-3 bg-white border-2 rounded-lg"><canvas ref={canvasRef} /></div></div>
        <p className="text-[10px] text-muted-foreground break-all text-center">{url}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={download}>Download PNG</Button>
          <Button size="sm" className="flex-1" onClick={print}>Print</Button>
        </div>
        <Button size="sm" variant="ghost" className="w-full" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
