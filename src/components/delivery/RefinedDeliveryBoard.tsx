// v1.138.0 — the Delivery board in the design's shape (SW-08): the rider strip, then five lanes — Pending · Cooking · Ready · Rider assigned ·
// On the way — of white cards (order and total, who, where and how far, ONE button). Delivered and Cancelled are history, behind a toggle.
// Everything the old board did is still here: drag a card to another lane, WhatsApp the status, send the tracking link, open the live
// tracking, call the customer, move a card by hand, cancel — those live in each card's ⋯ menu.
// The page owns the orders and the saving; this is the picture and the clicks.
import { useState } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { Bike, MapPin, MessageCircle, MoreHorizontal, Navigation, Phone, Map as MapIcon, XCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { money } from '@/lib/currency';
import { isOnline as heartbeatOnline, tsToMs } from '@/lib/geo';
import type { DeliveryStatus, Order, Rider } from '@/lib/types';
import {
  ACTIVE_COLUMNS, advanceFor, boardSubtitle, deliveryColumn, DELIVERY_COLUMNS, isActiveDelivery, placeLabel, riderStrip, shortName,
  type DeliveryColumn,
} from '@/lib/deliveryBoard';

const ONLINE_MS = 3 * 60 * 1000;   // a rider's app pings every minute; three missed is offline (the Riders page says the same)
const SOURCE: Record<string, string> = { website: 'Website', order_taker: 'Order Taker', pos: 'POS' };

export interface RefinedDeliveryBoardProps {
  orders: Order[];
  riders: Rider[];
  onAdvance: (order: Order, to: DeliveryStatus) => void;
  onAssign: (order: Order, riderId: string) => void;
  /** A card dropped on, or moved by hand to, a lane. */
  onMove: (order: Order, to: DeliveryColumn) => void;
  onCancel: (order: Order) => void;
  onWhatsApp: (order: Order) => void;
  onTracking: (order: Order) => void;
  onLive: (order: Order) => void;
  onOpenMap: () => void;
  onOpenRiders: () => void;
}

function CardMenu({ order, p }: { order: Order; p: RefinedDeliveryBoardProps }) {
  const [open, setOpen] = useState(false);
  const phone = order.customer?.phone;
  const col = deliveryColumn(order.deliveryStatus);
  const done = () => setOpen(false);
  const meta = [SOURCE[order.source || 'pos'] || String(order.source || '').toUpperCase(), `${order.items.length} ${order.items.length === 1 ? 'item' : 'items'}`, phone].filter(Boolean).join(' · ');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-dl-more aria-label={`More for order ${order.orderNumber}`} className="dl-more" onClick={e => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5" data-dl-menu>
        <p className="dl-menu-meta">{meta}</p>
        {order.customer?.address && <p className="dl-menu-meta dl-menu-addr">{order.customer.address}</p>}
        {phone && <a className="dl-menu-item" href={`tel:${phone}`} onClick={done}><Phone className="h-4 w-4" />Call customer</a>}
        <button type="button" className="dl-menu-item" disabled={!phone} onClick={() => { done(); p.onWhatsApp(order); }}><MessageCircle className="h-4 w-4" />Send status on WhatsApp</button>
        <button type="button" className="dl-menu-item" disabled={!phone} onClick={() => { done(); p.onTracking(order); }}><Navigation className="h-4 w-4" />Send tracking link</button>
        <button type="button" className="dl-menu-item" data-track-order={order.id} onClick={() => { done(); p.onLive(order); }}><MapIcon className="h-4 w-4" />Live tracking</button>
        <p className="dl-menu-head">Move to</p>
        {DELIVERY_COLUMNS.filter(c => c.key !== 'cancelled' && c.key !== col).map(c => (
          <button key={c.key} type="button" className="dl-menu-item" data-dl-move={c.key} onClick={() => { done(); p.onMove(order, c.key); }}>{c.label}</button>
        ))}
        {col !== 'cancelled' && col !== 'delivered' && (
          <button type="button" className="dl-menu-item dl-menu-danger" data-dl-cancel onClick={() => { done(); p.onCancel(order); }}><XCircle className="h-4 w-4" />Cancel order</button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function AssignRider({ order, riders, onAssign }: { order: Order; riders: Rider[]; onAssign: (o: Order, riderId: string) => void }) {
  const [open, setOpen] = useState(false);
  const chips = riderStrip(riders, [], id => { const r = riders.find(x => x.id === id); return heartbeatOnline(tsToMs(r?.lastSeenAt), ONLINE_MS); });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-dl-action="assign" className="dl-btn dl-btn-primary" onClick={e => e.stopPropagation()}>Assign rider</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5" data-dl-riders>
        {chips.length === 0 && <p className="dl-menu-meta">No riders yet — add one in the Rider list.</p>}
        {chips.map(c => (
          <button key={c.id} type="button" className="dl-menu-item" data-dl-rider={c.id} onClick={() => { setOpen(false); onAssign(order, c.id); }}>
            <span className="dl-dot" data-on={c.online ? '' : undefined} />{c.name}<span className="dl-menu-sub">{c.online ? 'online' : 'offline'}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Card({ order, col, p }: { order: Order; col: DeliveryColumn; p: RefinedDeliveryBoardProps }) {
  const adv = advanceFor(col);
  const place = placeLabel(order);
  return (
    <div data-dl-card data-column={col} className="dl-card">
      <div className="dl-card-top"><b>#{order.orderNumber}</b><b className="dl-amount">{money(order.grandTotal)}</b></div>
      <div className="dl-who">{shortName(order.customer?.name)}</div>
      {place && <div className="dl-where"><MapPin aria-hidden className="h-3.5 w-3.5" />{place}</div>}
      <div className="dl-card-foot">
        {adv?.kind === 'status' && <button type="button" data-dl-action="advance" className="dl-btn dl-btn-soft" onClick={e => { e.stopPropagation(); p.onAdvance(order, adv.to); }}>{adv.label}</button>}
        {adv?.kind === 'assign' && <AssignRider order={order} riders={p.riders} onAssign={p.onAssign} />}
        {!adv && order.riderName && <span data-dl-rider-chip className="dl-chip"><Bike aria-hidden className="h-3.5 w-3.5" />{order.riderName}</span>}
        <span className="dl-grow" />
        <CardMenu order={order} p={p} />
      </div>
    </div>
  );
}

export default function RefinedDeliveryBoard(p: RefinedDeliveryBoardProps) {
  const [history, setHistory] = useState(false);
  const online = (id: string) => heartbeatOnline(tsToMs(p.riders.find(r => r.id === id)?.lastSeenAt), ONLINE_MS);
  const strip = riderStrip(p.riders, p.orders, online);
  const active = p.orders.filter(isActiveDelivery).length;
  const finished = p.orders.length - active;
  const lanes = DELIVERY_COLUMNS.filter(c => ACTIVE_COLUMNS.includes(c.key) || history);

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return;
    const order = p.orders.find(o => o.id === r.draggableId);
    const to = r.destination.droppableId as DeliveryColumn;
    if (order && deliveryColumn(order.deliveryStatus) !== to) p.onMove(order, to);
  };

  return (
    <div data-dl-board className="dl-root">
      <div className="dl-head">
        <div className="dl-titles">
          <h1 data-dl-title>Delivery board</h1>
          <p data-dl-subtitle>{boardSubtitle(active, strip.filter(c => c.online).length)}</p>
        </div>
        <div className="dl-head-actions">
          <div className="dl-seg" role="group" aria-label="View">
            <button type="button" data-on="" aria-pressed="true">Board</button>
            <button type="button" aria-pressed="false" data-dl-map onClick={p.onOpenMap}>Map</button>
          </div>
          <button type="button" className="dl-btn dl-btn-ghost" data-dl-riders-open onClick={p.onOpenRiders}><Bike aria-hidden className="h-4 w-4" />Rider list</button>
        </div>
      </div>

      <div className="dl-strip" data-dl-strip>
        {strip.map(c => (
          <span key={c.id} data-dl-rider-strip={c.id} data-online={c.online ? '' : undefined} className="dl-strip-chip">{c.online && <i className="dl-dot" data-on="" />}{c.label}</span>
        ))}
        {strip.length === 0 && <span className="dl-strip-empty">No riders yet</span>}
        <span className="dl-grow" />
        <button type="button" data-dl-history aria-pressed={history} className="dl-link" onClick={() => setHistory(h => !h)}>
          {history ? 'Hide delivered & cancelled' : `Show delivered & cancelled${finished ? ` (${finished})` : ''}`}
        </button>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="dl-lanes" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(220px, 1fr))` }}>
          {lanes.map(c => {
            const rows = p.orders.filter(o => deliveryColumn(o.deliveryStatus) === c.key);
            return (
              <section key={c.key} className="dl-lane" data-dl-lane={c.key} aria-label={c.label}>
                <div className="dl-lane-head"><b>{c.label}</b><span className="dl-count">{rows.length}</span></div>
                <Droppable droppableId={c.key}>
                  {(drop, snap) => (
                    <div ref={drop.innerRef} {...drop.droppableProps} className="dl-lane-body" data-over={snap.isDraggingOver ? '' : undefined}>
                      {rows.map((o, i) => (
                        <Draggable key={o.id} draggableId={o.id} index={i}>
                          {drag => (
                            <div ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps}>
                              <Card order={o} col={c.key} p={p} />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {drop.placeholder}
                    </div>
                  )}
                </Droppable>
              </section>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
