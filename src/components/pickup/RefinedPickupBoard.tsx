// v1.139.0 — the Pickup board in the design's shape (SW-09): "Counter view", three lanes — Preparing · Ready to hand over · Collected today —
// of white cards with the order number large, the customer, "4 items", an age pill and ONE button (Mark ready · Handed over).
// What the old page had beyond that — the search, Refresh, the "Ready" WhatsApp message, calling the customer, Reprint — is one click away.
// The page owns the orders and the saving; this is the picture and the clicks.
import { useState } from 'react';
import { MoreHorizontal, Package, Phone, MessageCircle, Printer, RefreshCw, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { money } from '@/lib/currency';
import type { Order } from '@/lib/types';
import { itemsLabel, PICKUP_LANES, pickupName, pickupPill, type PickupGroups, type PickupLane } from '@/lib/pickupBoard';

export interface RefinedPickupBoardProps {
  groups: PickupGroups;
  search: string;
  onSearch: (q: string) => void;
  onRefresh: () => void;
  onMarkReady: (o: Order) => void;
  onHandedOver: (o: Order) => void;
  onReadyMessage: (o: Order) => void;
  onReprint: (o: Order) => void;
  now?: number;
}

function CardMenu({ o, lane, p }: { o: Order; lane: PickupLane; p: RefinedPickupBoardProps }) {
  const [open, setOpen] = useState(false);
  const phone = o.customer?.phone;
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-pk-more aria-label={`More for order ${o.orderNumber}`} className="pk-more"><MoreHorizontal className="h-4 w-4" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5" data-pk-menu>
        <p className="pk-menu-meta">{[phone, o.pickupTime ? `Pickup ${o.pickupTime}` : '', money(o.grandTotal)].filter(Boolean).join(' · ')}</p>
        {phone && <a className="pk-menu-item" href={`tel:${phone}`} onClick={close}><Phone className="h-4 w-4" />Call customer</a>}
        {lane !== 'collected' && (
          <button type="button" className="pk-menu-item" disabled={!phone} data-pk-ready-msg onClick={() => { close(); p.onReadyMessage(o); }}><MessageCircle className="h-4 w-4" />Send “ready” message on WhatsApp</button>
        )}
        {lane === 'collected' && <button type="button" className="pk-menu-item" data-pk-reprint onClick={() => { close(); p.onReprint(o); }}><Printer className="h-4 w-4" />Reprint bill</button>}
      </PopoverContent>
    </Popover>
  );
}

function Card({ o, lane, p, now }: { o: Order; lane: PickupLane; p: RefinedPickupBoardProps; now: number }) {
  const pill = pickupPill(o, now);
  return (
    <article data-pk-card data-lane={lane} className="pk-card">
      <div className="pk-card-top"><b className="pk-num">#{o.orderNumber}</b><span className="pk-pill" data-tone={pill.tone}>{pill.label}</span></div>
      <div className="pk-name">{pickupName(o)}</div>
      {lane === 'collected'
        ? <div className="pk-sub pk-sub-row"><span>paid</span><CardMenu o={o} lane={lane} p={p} /></div>
        : <div className="pk-sub">{itemsLabel(o)} · {money(o.grandTotal)}</div>}
      {lane !== 'collected' && (
        <div className="pk-foot">
          {lane === 'preparing'
            ? <button type="button" data-pk-action="ready" className="pk-btn pk-btn-soft" onClick={() => p.onMarkReady(o)}>Mark ready</button>
            : <button type="button" data-pk-action="handed" className="pk-btn pk-btn-primary" onClick={() => p.onHandedOver(o)}><Package aria-hidden className="h-4 w-4" />Handed over</button>}
          <CardMenu o={o} lane={lane} p={p} />
        </div>
      )}
    </article>
  );
}

export default function RefinedPickupBoard(p: RefinedPickupBoardProps) {
  const now = p.now ?? Date.now();
  const [earlier, setEarlier] = useState(false);
  const rows = (lane: PickupLane): Order[] => lane === 'collected' ? (earlier ? [...p.groups.collected, ...p.groups.earlier] : p.groups.collected) : p.groups[lane];
  return (
    <div data-pk-board className="pk-root">
      <div className="pk-head">
        <div className="pk-titles"><h1 data-pk-title>Pickup orders</h1><p>Counter view</p></div>
        <div className="pk-head-actions">
          <label className="pk-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label="Search pickup orders" placeholder="Order #, name or phone" value={p.search} onChange={e => p.onSearch(e.target.value)} /></label>
          <button type="button" className="pk-icon" aria-label="Refresh" data-pk-refresh onClick={p.onRefresh}><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="pk-lanes">
        {PICKUP_LANES.map(l => {
          const list = rows(l.key);
          return (
            <section key={l.key} className="pk-lane" data-pk-lane={l.key} aria-label={l.label}>
              <div className="pk-lane-head"><b>{l.label}</b><span className="pk-count" data-lane={l.key}>{l.key === 'collected' ? p.groups.collected.length : list.length}</span></div>
              {list.map(o => <Card key={o.id} o={o} lane={l.key} p={p} now={now} />)}
              {list.length === 0 && <div className="pk-empty">{l.key === 'preparing' ? 'Nothing being prepared' : l.key === 'ready' ? 'Nothing waiting at the counter' : 'Nothing collected yet today'}</div>}
              {l.key === 'collected' && p.groups.earlier.length > 0 && (
                <button type="button" data-pk-earlier className="pk-link" onClick={() => setEarlier(e => !e)}>{earlier ? 'Hide earlier' : `Show earlier (${p.groups.earlier.length})`}</button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
