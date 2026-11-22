// v1.146.0 — Foodpanda orders in the design's shape (SW-38): "Entered at the counter", New order, lanes New · Preparing · Ready · Picked of white cards —
// the reference in monospace, the amount, one "Next →" button. Cancelled orders, the search, the Foodpanda mode switch and Cancel are kept (the ⋯ and the header).
import { useState } from 'react';
import { ArrowRight, MoreHorizontal, Plus, Power, Search, XCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { money } from '@/lib/currency';
import type { FoodpandaStatus, Order } from '@/lib/types';
import { FP_ACTIVE, FP_LANES, fpLanes, fpRef, fpStatus, fpSubtitle, FP_NEXT, nextWord } from '@/lib/foodpandaBoard';

export interface RefinedFoodpandaProps {
  orders: Order[];
  enabled: boolean;
  onToggleMode: () => void;
  onNew: () => void;
  onSetStatus: (o: Order, s: FoodpandaStatus) => void;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function CardMenu({ o, p }: { o: Order; p: RefinedFoodpandaProps }) {
  const [open, setOpen] = useState(false);
  const s = fpStatus(o);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="fp-more" aria-label={`More for ${fpRef(o)}`} data-fp-more><MoreHorizontal className="h-4 w-4" /></button></PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5" data-fp-menu>
        <p className="fp-menu-meta">{[`Bill #${o.orderNumber}`, o.customer?.name, `${o.items.length} ${o.items.length === 1 ? 'item' : 'items'}`, timeOf(o.createdAt)].filter(Boolean).join(' · ')}</p>
        {s !== 'cancelled' && s !== 'picked' && <button type="button" className="fp-menu-item fp-menu-danger" data-fp-cancel onClick={() => { setOpen(false); p.onSetStatus(o, 'cancelled'); }}><XCircle className="h-4 w-4" />Cancel order</button>}
        {(s === 'cancelled' || s === 'picked') && <p className="fp-menu-meta">Nothing more to do with this order.</p>}
      </PopoverContent>
    </Popover>
  );
}

export default function RefinedFoodpanda(p: RefinedFoodpandaProps) {
  const [q, setQ] = useState('');
  const [history, setHistory] = useState(false);
  const lanes = fpLanes(p.orders, q);
  const total = p.orders.filter(o => o.orderType === 'foodpanda').length;
  const keys = FP_LANES.map(l => l.key).filter(k => FP_ACTIVE.includes(k) || history);
  return (
    <div data-fp-page className="fp-root">
      <div className="fp-head">
        <div className="fp-titles"><h1 data-fp-title>Foodpanda orders</h1><p>{fpSubtitle}</p></div>
        <div className="fp-head-actions">
          <button type="button" className="fp-mode" data-fp-mode data-on={p.enabled ? '' : undefined} aria-pressed={p.enabled} onClick={p.onToggleMode}><Power aria-hidden className="h-4 w-4" />Foodpanda mode {p.enabled ? 'on' : 'off'}</button>
          <button type="button" className="fp-btn" data-fp-new onClick={p.onNew}><Plus aria-hidden className="h-4 w-4" />New order</button>
        </div>
      </div>
      {!p.enabled && (
        <div className="fp-banner" data-fp-off><b>Foodpanda mode is off.</b> The POS shows only Dine-In / Takeaway / Delivery. Switch it on and the POS gets a fourth order type, “Foodpanda”.</div>
      )}
      <div className="fp-filters" role="search" aria-label="Search Foodpanda orders">
        <label className="fp-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label="Search Foodpanda orders" placeholder="Bill #, customer, Foodpanda ref…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <button type="button" className="fp-link" data-fp-history aria-pressed={history} onClick={() => setHistory(h => !h)}>{history ? 'Hide cancelled' : `Show cancelled${lanes.cancelled.length ? ` (${lanes.cancelled.length})` : ''}`}</button>
      </div>
      {total === 0 ? (
        <div className="fp-empty" data-fp-empty>No Foodpanda orders yet. Key one in at the counter with “New order”.</div>
      ) : (
        <div className="fp-lanes" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
          {keys.map(k => (
            <section key={k} className="fp-lane" data-fp-lane={k} aria-label={FP_LANES.find(l => l.key === k)!.label}>
              <div className="fp-lane-head"><b>{FP_LANES.find(l => l.key === k)!.label}</b><span className="fp-count">{lanes[k].length}</span></div>
              {lanes[k].map(o => {
                const next = FP_NEXT[k];
                return (
                  <article key={o.id} data-fp-card={fpRef(o)} className="fp-card">
                    <div className="fp-card-top"><span className="fp-ref">{fpRef(o)}</span><CardMenu o={o} p={p} /></div>
                    <b className="fp-amount">{money(o.grandTotal)}</b>
                    <span className="fp-sub">{o.foodpandaRef ? `#${o.orderNumber} · ` : ''}{o.items.length} {o.items.length === 1 ? 'item' : 'items'} · {timeOf(o.createdAt)}</span>
                    {next && <button type="button" data-fp-next className="fp-next" title={nextWord(k)} onClick={() => p.onSetStatus(o, next)}>Next <ArrowRight aria-hidden className="h-3.5 w-3.5" /></button>}
                  </article>
                );
              })}
              {lanes[k].length === 0 && <div className="fp-quiet">None</div>}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
