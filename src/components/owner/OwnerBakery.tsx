// OWNER APP — the bakery side (v1.121.0): a block on the overview (today's cake orders, what is going off, what was baked) and two
// read-only lists behind it. The same data and the same rules as the desktop screens (Cake Orders, Expiry, Production); the owner
// sees them on the phone, takes action at the till. A restaurant that never used them sees nothing new.
import { useMemo } from 'react';
import { Cake, CalendarClock, ChevronRight, Phone, Wheat } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { getCakeOrders, getInventory, getProductionBatches, getStockLots } from '@/lib/store';
import { getBaseUnit } from '@/lib/units';
import { bakerySummary, cakeRows, expiryRows } from '@/lib/ownerBakery';
import { localDay } from '@/lib/productionPlan';
import { cn } from '@/lib/utils';
import { Badge, Card, Empty, Label, ScreenHeader } from './ownerUi';
import { OWNER_BASE, rs, useLiveTick } from './ownerHooks';

export interface BakeryCaps { cakes: boolean; expiry: boolean; production: boolean }

const useBakery = () => {
  const tick = useLiveTick(['cakeOrders', 'stockLots', 'productionBatches', 'inventory']);
  return useMemo(() => {
    const inv = new Map(getInventory().map(i => [i.id, i]));
    return { inv, cakes: getCakeOrders(), lots: getStockLots(), batches: getProductionBatches(), today: localDay(new Date()) };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
};

/** The overview block. Shows only what this account may open, and only if the restaurant uses the bakery modules. */
export function BakeryToday({ caps }: { caps: BakeryCaps }) {
  const navigate = useNavigate();
  const d = useBakery();
  const s = useMemo(() => bakerySummary({ cakes: d.cakes, lots: d.lots, batches: d.batches, onHand: id => Number(d.inv.get(id)?.quantity) || 0, today: d.today }), [d]);
  if (!s.used || !(caps.cakes || caps.expiry || caps.production)) return null;
  const tiles = [
    caps.cakes && s.cakes.open + s.cakes.overdue > 0 && (
      <button key="c" type="button" onClick={() => navigate(`${OWNER_BASE}/cakes`)} className="text-left" data-testid="own-bakery-cakes">
        <Card className="flex items-center gap-3 p-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--own-accent-bg))] text-primary"><Cake className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><div className="text-[15px] font-bold">Cake orders</div>
            <div className="truncate text-[13px] text-muted-foreground" data-testid="own-bakery-cakes-text">{s.cakes.open} open · {s.cakes.dueToday} due today{s.cakes.overdue > 0 ? ` · ${s.cakes.overdue} overdue` : ''} · {rs(s.cakes.balance)} to collect</div></div>
          {s.cakes.overdue > 0 ? <Badge tone="danger">{s.cakes.overdue} overdue</Badge> : s.cakes.dueToday > 0 ? <Badge tone="warning">{s.cakes.dueToday} today</Badge> : null}<ChevronRight className="h-4 w-4 text-muted-foreground" /></Card>
      </button>),
    caps.expiry && s.expiry.expired.lots + s.expiry.soon.lots > 0 && (
      <button key="e" type="button" onClick={() => navigate(`${OWNER_BASE}/expiry`)} className="text-left" data-testid="own-bakery-expiry">
        <Card className="flex items-center gap-3 p-3.5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--own-warn-bg))] text-[hsl(var(--own-warn))]"><CalendarClock className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><div className="text-[15px] font-bold">Going off</div>
            <div className="truncate text-[13px] text-muted-foreground" data-testid="own-bakery-expiry-text">{s.expiry.expired.lots > 0 ? `${s.expiry.expired.lots} expired (${rs(s.expiry.expired.value)})` : 'Nothing expired'}{s.expiry.soon.lots > 0 ? ` · ${s.expiry.soon.lots} within 3 days (${rs(s.expiry.soon.value)})` : ''}</div></div>
          {s.expiry.expired.lots > 0 && <Badge tone="danger">{s.expiry.expired.lots} expired</Badge>}<ChevronRight className="h-4 w-4 text-muted-foreground" /></Card>
      </button>),
    caps.production && s.batches.count > 0 && (
      <Card key="p" className="flex items-center gap-3 p-3.5" data-testid="own-bakery-batches"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Wheat className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><div className="text-[15px] font-bold">Baked today</div><div className="text-[13px] text-muted-foreground">{s.batches.count} batch{s.batches.count === 1 ? '' : 'es'} · ingredients {rs(s.batches.cost)}</div></div></Card>),
  ].filter(Boolean);
  if (tiles.length === 0) return null;
  return <div className="space-y-2" data-testid="own-bakery"><Label>Bakery</Label>{tiles}</div>;
}

export function OwnerCakes() {
  const d = useBakery();
  const rows = useMemo(() => cakeRows(d.cakes, d.today), [d]);
  const STATUS = { new: 'New', baking: 'Baking', ready: 'Ready', delivered: 'Handed over', cancelled: 'Cancelled' } as const;
  return (
    <div className="space-y-3" data-testid="owner-cakes">
      <ScreenHeader title="Cake orders" back={OWNER_BASE} sub="Open orders, the soonest needed first" />
      {rows.length === 0 ? <Empty>No open cake orders.</Empty> : (
        <div className="space-y-2.5" data-testid="own-cakes-list">
          {rows.map(r => (
            <Card key={r.id} className="space-y-1.5 p-3.5" data-testid={`own-cake-${r.id}`}>
              <div className="flex items-center justify-between gap-2"><div className="min-w-0 truncate text-[15px] font-bold">{r.number} · {r.customer}</div>
                <Badge tone={r.status === 'ready' ? 'success' : r.status === 'baking' ? 'warning' : 'neutral'}>{STATUS[r.status]}</Badge></div>
              <div className="truncate text-[13.5px] text-muted-foreground">{r.what}</div>
              <div className="flex items-center justify-between gap-2 text-[13.5px]">
                <span className="whitespace-nowrap">{r.due}{r.tag && <Badge tone={r.tag === 'overdue' ? 'danger' : r.tag === 'today' ? 'warning' : 'accent'} className="ml-1.5">{r.tag === 'overdue' ? 'Overdue' : r.tag === 'today' ? 'Today' : 'Tomorrow'}</Badge>}</span>
                <span className={cn('whitespace-nowrap font-bold tabular-nums', r.balance > 0 && 'text-[hsl(var(--own-warn))]')}>{rs(r.balance)} <span className="font-normal text-muted-foreground">of {rs(r.total)}</span></span>
              </div>
              {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary"><Phone className="h-3.5 w-3.5" /> {r.phone}</a>}
            </Card>
          ))}
        </div>
      )}
      <p className="px-1 pb-2 text-[12px] text-muted-foreground">Taking a payment, moving an order along or cancelling it is done at the till (Cake Orders).</p>
    </div>
  );
}

export function OwnerExpiry() {
  const d = useBakery();
  const rows = useMemo(() => expiryRows(d.lots, id => Number(d.inv.get(id)?.quantity) || 0, id => { const i = d.inv.get(id); return i ? getBaseUnit(i) : ''; }, d.today, 7), [d]);
  return (
    <div className="space-y-3" data-testid="owner-expiry">
      <ScreenHeader title="Going off" back={OWNER_BASE} sub="Expired, and what goes off within a week" />
      {rows.length === 0 ? <Empty>Nothing has expired or is about to.</Empty> : (
        <div className="space-y-2.5" data-testid="own-expiry-list">
          {rows.map(r => (
            <Card key={r.id} className="flex items-center gap-3 p-3.5" data-testid={`own-lot-${r.id}`}>
              <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-bold">{r.item}</div><div className="text-[13.5px] text-muted-foreground">{r.expires} · {Math.round(r.remaining * 1000) / 1000} {r.unit} · {rs(r.value)}</div></div>
              <Badge tone={r.status === 'expired' ? 'danger' : 'warning'}>{r.status === 'expired' ? `Expired ${-r.days} d ago` : r.days === 0 ? 'Last day' : `${r.days} d left`}</Badge>
            </Card>
          ))}
        </div>
      )}
      <p className="px-1 pb-2 text-[12px] text-muted-foreground">Writing off what has expired is done at the till (Expiry).</p>
    </div>
  );
}
