// DT Rider — one delivery, start to finish (v1.88.0).
// RID-07 Order details · RID-09 Go to the restaurant · RID-10 Pickup checklist · RID-11 On the way ·
// RID-12 Call the customer · RID-13 Money at the door · RID-15 Delivered · RID-19 Help.
import { useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Info, MapPin, MessageCircle, MoreHorizontal, Navigation, PackageCheck, Phone,
  Store, Truck, LifeBuoy,
} from 'lucide-react';
import { money } from '@/lib/currency';
import type { DeliveryStatus, Order } from '@/lib/types';
import DeliveryRouteMap from '@/components/DeliveryRouteMap';
import {
  RIDER_PROBLEMS, RIDER_STAGE_LABEL, RIDER_STEPS, bagChecklist, collectFor, directionsUrl, initials, nextAction, phaseTitle,
  riderPhase, stageTone,
} from '@/lib/riderApp';
import { AppBar, Banner, CheckRow, RBadge, RButton, RCard, RLabel, Sheet, StickyAction, Stepper } from './riderUi';

type Point = { lat: number; lng: number };


function customerPoint(o: Order): Point | null {
  const lat = o.delivery?.customerLat, lng = o.delivery?.customerLng;
  return lat != null && lng != null ? { lat, lng } : null;
}

const STEP_ICONS = [PackageCheck, Truck, MapPin, CheckCircle2];

/** Before pickup the rider wants one thing from the kitchen: is the food ready? */
function kitchenLine(o: Order): { text: string; ready: boolean } {
  if (o.deliveryStatus === 'ready' || o.kitchenStatus === 'ready') return { text: 'Food is ready — collect it', ready: true };
  if (o.kitchenStatus === 'preparing' || o.deliveryStatus === 'cooking') return { text: 'The kitchen is preparing it', ready: false };
  if (o.kitchenStatus === 'accepted' || o.deliveryStatus === 'accepted') return { text: 'The kitchen has accepted it', ready: false };
  return { text: 'Waiting for the kitchen', ready: false };
}

/**
 * RID-07 / RID-09 / RID-11 — the order the rider is working on. What the screen leads with follows the step:
 * before pickup the restaurant, after it the customer. The next step is always the big button at the bottom.
 */
export function OrderScreen({
  order, riderPos, restaurant, restaurantName, restaurantPhone, gpsOff, online, onBack, onNext, onCall, onHelp, onStages,
}: {
  order: Order; riderPos: Point | null; restaurant: Point | null; restaurantName: string; restaurantPhone: string | null; gpsOff: boolean; online: boolean;
  onBack: () => void; onNext: () => Promise<void> | void; onCall: () => void; onHelp: () => void; onStages: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const phase = riderPhase(order);
  const next = nextAction(order);
  const cust = customerPoint(order);
  const toRestaurant = phase === 'pickup';
  const navUrl = toRestaurant ? directionsUrl(restaurant) : directionsUrl(cust, order.customer?.address);
  const c = collectFor(order);
  const items = bagChecklist(order);
  const kitchen = kitchenLine(order);
  return (
    <div className="flex flex-1 flex-col gap-3" data-rider-screen="order">
      <AppBar title={phaseTitle(order)} onBack={onBack}
        right={<button type="button" aria-label="More options" onClick={onStages} className="grid h-10 w-10 place-items-center rounded-xl border bg-card"><MoreHorizontal className="h-5 w-5" /></button>} />
      {order.deliveryStatus === 'cancelled' && <Banner tone="bad" icon={AlertTriangle}>The restaurant cancelled this order. Do not deliver it.</Banner>}

      {!online && <Banner tone="bad" icon={AlertTriangle}>You are offline. The details below are the last ones loaded; a status change needs a connection.</Banner>}
      {gpsOff && <Banner tone="warn" icon={MapPin}>Turn on location to see the route. The buttons still work.</Banner>}

      {phase !== 'pickup' && <Stepper stage={order.deliveryStatus} icons={STEP_ICONS} />}

      {(toRestaurant ? (restaurant || riderPos) : cust) ? (
        <div className="overflow-hidden rounded-2xl border">
          <DeliveryRouteMap branch={restaurant} rider={riderPos} customer={toRestaurant ? null : cust} height={toRestaurant ? 240 : 200} />
        </div>
      ) : null}

      {toRestaurant ? (
        <>
          <RCard className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--rd-tint))] text-primary"><Store className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold leading-snug">{restaurantName || 'The restaurant'}</div>
              <div className={kitchen.ready ? 'text-[13px] font-semibold text-[hsl(var(--rd-ok))]' : 'text-[13px] text-muted-foreground'}>{kitchen.text}</div>
            </div>
            {restaurantPhone && (
              <a href={`tel:+${restaurantPhone}`} aria-label="Call the restaurant" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-card"><Phone className="h-5 w-5" /></a>
            )}
          </RCard>
          {navUrl && (
            <a href={navUrl} target="_blank" rel="noreferrer" className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border bg-card text-[16px] font-bold">
              <Navigation className="h-5 w-5" />Navigate to restaurant
            </a>
          )}
        </>
      ) : null}

      <RCard className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[16px] font-bold">{order.customer?.name || 'Customer'}</span>
          {order.delivery?.distanceKm != null
            ? <span className="text-[13px] text-muted-foreground">{order.delivery.distanceKm.toFixed(1)} km{order.delivery.etaMinutes ? ` · ~${order.delivery.etaMinutes} min` : ''}</span>
            : toRestaurant ? <span className="text-[13px] text-muted-foreground">Deliver to</span> : null}
        </div>
        {order.customer?.address && (
          <div className="flex items-start gap-2 text-[14px] text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span>{order.customer.address}</span></div>
        )}
        <div className="flex gap-2 pt-1">
          <RButton size="sm" icon={Phone} onClick={onCall}>Call</RButton>
          {!toRestaurant && (navUrl
            ? <a href={navUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-[10px] border bg-card px-3 text-[14px] font-bold"><Navigation className="h-4 w-4" />Navigate</a>
            : <RButton size="sm" icon={Navigation} disabled title="No location on this order">Navigate</RButton>)}
          <RButton size="sm" variant="ghost" icon={LifeBuoy} onClick={onHelp} className="ml-auto px-2">Help</RButton>
        </div>
      </RCard>

      {items.length > 0 && (
        <RCard>
          <div className="mb-1 text-[15px] font-bold">Items</div>
          {items.map(it => (
            <div key={it.key} className="flex justify-between gap-3 py-1 text-[14px]">
              <span className="min-w-0">{it.text}{it.note && <span className="block text-[12.5px] text-muted-foreground">{it.note}</span>}</span>
              <span className="shrink-0 text-muted-foreground">{money(it.lineTotal)}</span>
            </div>
          ))}
        </RCard>
      )}

      <RCard className="flex items-center justify-between gap-3 border-transparent bg-[hsl(var(--rd-tint))]" data-rider-collect>
        <div>
          <div className="text-[13px] text-muted-foreground">{c.amount > 0 ? 'Collect from customer' : 'Nothing to collect'}</div>
          <div className="text-[22px] font-extrabold">{money(c.amount > 0 ? c.amount : order.grandTotal)}</div>
        </div>
        <RBadge tone={c.amount > 0 ? 'warn' : 'ok'}>{c.label}</RBadge>
      </RCard>

      {order.notes?.trim() && <Banner tone="info" icon={Info}>{order.notes.trim()}</Banner>}

      {next && (
        <StickyAction>
          <RButton variant="primary" size="lg" className="w-full" busy={busy} icon={STEP_ICONS[RIDER_STEPS.findIndex(s => s.stage === next.stage)]}
            onClick={async () => { setBusy(true); try { await onNext(); } finally { setBusy(false); } }}>
            {next.label}
          </RButton>
        </StickyAction>
      )}
    </div>
  );
}

/** RID-10 — check the bag against the order before leaving the kitchen. The ticks are not stored. */
export function PickupScreen({ order, onBack, onConfirm }: { order: Order; onBack: () => void; onConfirm: () => Promise<void> }) {
  const items = bagChecklist(order);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const all = items.length > 0 && items.every(i => ticked.has(i.key));
  return (
    <div className="flex flex-1 flex-col gap-3" data-rider-screen="pickup">
      <AppBar title="Confirm pickup" onBack={onBack} />
      <div className="text-[22px] font-extrabold">Order #{order.orderNumber}</div>
      <RCard className="divide-y py-1">
        {items.length === 0 && <p className="py-3 text-[14px] text-muted-foreground">This order has no item list on this phone. Check the bag against the receipt.</p>}
        {items.map(it => (
          <CheckRow key={it.key} checked={ticked.has(it.key)} sub={it.note}
            onChange={v => setTicked(prev => { const n = new Set(prev); if (v) n.add(it.key); else n.delete(it.key); return n; })}>
            {it.text}
          </CheckRow>
        ))}
      </RCard>
      {items.length > 1 && (
        <RButton variant="ghost" size="sm" className="self-start px-1" onClick={() => setTicked(all ? new Set() : new Set(items.map(i => i.key)))}>
          {all ? 'Untick all' : 'Everything is in the bag'}
        </RButton>
      )}
      <Banner tone="info" icon={Info}>Check the bag is sealed and the receipt is attached.</Banner>
      <StickyAction>
        <RButton variant="primary" size="lg" className="w-full" icon={PackageCheck} busy={busy} disabled={items.length > 0 && !all}
          onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
          Confirm pickup
        </RButton>
        {items.length > 0 && !all && <p className="mt-2 text-center text-[13px] text-muted-foreground">Tick every item to confirm.</p>}
      </StickyAction>
    </div>
  );
}

/** RID-13 — the money at the door, then Delivered. */
export function DeliverScreen({ order, onBack, onConfirm }: { order: Order; onBack: () => void; onConfirm: () => Promise<void> }) {
  const c = collectFor(order);
  const [collected, setCollected] = useState(!c.mustConfirm);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-1 flex-col gap-4" data-rider-screen="deliver">
      <AppBar title={`Delivery · #${order.orderNumber}`} onBack={onBack} />
      <RCard className="flex flex-col items-center gap-2 border-transparent bg-[hsl(var(--rd-tint))] py-6 text-center">
        <span className="text-[13px] text-muted-foreground">{c.amount > 0 ? 'Collect from customer' : 'Nothing to collect'}</span>
        <div className="text-[40px] font-extrabold leading-none text-primary" data-rider-collect-amount>{money(c.amount)}</div>
        <RBadge tone={c.amount > 0 ? 'warn' : 'ok'}>{c.label}</RBadge>
        {c.amount > 0 && c.amount !== order.grandTotal && <span className="text-[13px] text-muted-foreground">Bill {money(order.grandTotal)}</span>}
      </RCard>
      {c.mustConfirm && (
        <RCard className="py-1"><CheckRow checked={collected} onChange={setCollected}>I collected the full amount</CheckRow></RCard>
      )}
      <Banner tone="info" icon={Info}>Hand the order over and say the order number out loud.</Banner>
      <StickyAction>
        <RButton variant="primary" size="lg" className="w-full" icon={CheckCircle2} busy={busy} disabled={!collected}
          onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
          Delivered
        </RButton>
      </StickyAction>
    </div>
  );
}

/** RID-15 — a clear "done" and the day so far. */
export function DoneScreen({ orderNumber, riderName, today, todayValue, onBack }: { orderNumber: number | string; riderName: string; today: number; todayValue: number; onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-4 pt-16 text-center" data-rider-screen="done">
      <div className="grid h-24 w-24 place-items-center rounded-full bg-[hsl(var(--rd-ok-bg))] text-[hsl(var(--rd-ok))]"><CheckCircle2 className="h-12 w-12" /></div>
      <h1 className="text-[28px] font-extrabold">Delivered</h1>
      <p className="text-[15px] text-muted-foreground">Order #{orderNumber} is complete. Nice work, {riderName.split(' ')[0] || 'rider'}.</p>
      <RCard className="flex gap-8 px-6 shadow-none">
        <div><div className="text-[13px] text-muted-foreground">Today</div><b className="text-[22px]">{today} {today === 1 ? 'order' : 'orders'}</b></div>
        <div><div className="text-[13px] text-muted-foreground">Bills delivered</div><b className="text-[22px]">{money(todayValue)}</b></div>
      </RCard>
      <StickyAction>
        <RButton variant="primary" size="lg" className="w-full" onClick={onBack}>Back to orders</RButton>
      </StickyAction>
    </div>
  );
}

/** RID-12 — call or message the customer of an order assigned to this rider. */
export function CallSheet({ order, phone, onClose, onTracking }: { order: Order | null; phone: string | null; onClose: () => void; onTracking: (o: Order) => void }) {
  if (!order) return null;
  return (
    <Sheet open onClose={onClose} label={`Call ${order.customer?.name || 'the customer'}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[hsl(var(--rd-tint))] text-[20px] font-extrabold text-primary">{initials(order.customer?.name)}</span>
        <div className="min-w-0">
          <div className="truncate text-[19px] font-extrabold">{order.customer?.name || 'Customer'}</div>
          <div className="text-[14px] text-muted-foreground">{order.customer?.phone || 'No phone number'}</div>
        </div>
      </div>
      {phone
        ? <a href={`tel:${order.customer?.phone || phone}`} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-primary text-[16px] font-bold text-primary-foreground"><Phone className="h-5 w-5" />Call</a>
        : <RButton variant="primary" size="lg" className="w-full" icon={Phone} disabled>No phone number</RButton>}
      <RButton className="w-full" icon={MessageCircle} disabled={!phone} onClick={() => { onTracking(order); onClose(); }}>Send tracking link on WhatsApp</RButton>
      <RButton className="w-full" onClick={onClose}>Cancel</RButton>
    </Sheet>
  );
}

/** Correct a mis-tap: move the order to any rider step. Delivered still goes through the money screen. */
export function StageSheet({ order, onClose, onPick }: { order: Order | null; onClose: () => void; onPick: (o: Order, s: DeliveryStatus) => void }) {
  if (!order) return null;
  return (
    <Sheet open onClose={onClose} label="Change status">
      <h2 className="text-[19px] font-extrabold">Change status · #{order.orderNumber}</h2>
      <p className="text-[14px] text-muted-foreground">Now: {RIDER_STAGE_LABEL[order.deliveryStatus || 'pending']}. Use this only to correct a wrong tap.</p>
      <div className="space-y-2">
        {RIDER_STEPS.filter(s => s.stage !== order.deliveryStatus).map(s => (
          <RButton key={s.stage} className="w-full justify-between" onClick={() => onPick(order, s.stage)}>
            {s.label}<ChevronRight className="h-4 w-4 text-muted-foreground" />
          </RButton>
        ))}
      </div>
      <RButton className="w-full" variant="ghost" onClick={onClose}>Cancel</RButton>
    </Sheet>
  );
}

/**
 * RID-19 — when something goes wrong, reach the restaurant with the order attached. There is no problem log in the
 * system: a problem opens WhatsApp with the message written, and Call dials the restaurant.
 */
export function HelpScreen({ order, restaurantPhone, onBack, onProblem }: {
  order: Order | null; restaurantPhone: string | null; onBack: () => void; onProblem: (problem: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3" data-rider-screen="help">
      <AppBar title="Help" onBack={onBack} />
      <h2 className="text-[18px] font-bold">{order ? `What happened with #${order.orderNumber}?` : 'How can the restaurant help?'}</h2>
      <div className="space-y-2">
        {(order ? RIDER_PROBLEMS : (['I cannot see my orders', 'I cannot sign in on another phone', 'Something else'] as const)).map(p => (
          <button key={p} type="button" onClick={() => onProblem(p)} className="block w-full text-left">
            <RCard className="flex items-center gap-3 py-3.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-primary" />
              <span className="flex-1 text-[15px] font-semibold">{p}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </RCard>
          </button>
        ))}
      </div>
      <RLabel>Reach the restaurant</RLabel>
      <div className="grid grid-cols-2 gap-3">
        {restaurantPhone
          ? <a href={`tel:+${restaurantPhone}`} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground"><Phone className="h-4 w-4" />Call restaurant</a>
          : <RButton variant="primary" icon={Phone} disabled>Call restaurant</RButton>}
        <RButton icon={MessageCircle} onClick={() => onProblem(order ? 'I need help with this order' : 'I need help')}>WhatsApp</RButton>
      </div>
      {!restaurantPhone && (
        <p className="text-[13px] text-muted-foreground">The restaurant's number is not on this phone. WhatsApp opens with the message written so you can pick the restaurant's chat.</p>
      )}
    </div>
  );
}
