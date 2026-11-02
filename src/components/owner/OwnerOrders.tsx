// ============================================================
// OWNER APP — Orders (OWN-06) and Order detail (OWN-07), v1.86.0
//
// Watch the floor from anywhere: what is running, what is paid, what was voided — and everything about one bill,
// read-only, with who did what. Void, refund and edit stay in the POS, where the permission checks and the audit
// trail live.
// ============================================================
import { useMemo, useState } from 'react';
import { Bike, Phone, Search, Share2, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate, useParams } from '@/lib/hash-router';
import { getBranches, getOrders } from '@/lib/store';
import {
  ORDER_CHIPS, UNASSIGNED, filterOrders, orderBadge, orderCharges, orderSubtitle, orderTimeline, orderTitle, rangeOf, typeName,
  type OrderChip, type RangePreset,
} from '@/lib/ownerApp';
import { orderPdf, shareOrDownload } from '@/lib/ownerPdf';
import { cn } from '@/lib/utils';
import { Badge, Card, Empty, IconButton, PresetChips, ScreenHeader } from './ownerUi';
import { OWNER_BASE, rs, useBranchVisibility, useLiveTick } from './ownerHooks';

const PAGE = 60;
const when = (iso?: string) => { const t = iso ? new Date(iso) : null; return t && Number.isFinite(t.getTime()) ? t.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }) : ''; };
const day = (iso?: string) => { const t = iso ? new Date(iso) : null; return t && Number.isFinite(t.getTime()) ? t.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : ''; };
const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

export function OwnerOrders() {
  const navigate = useNavigate();
  const tick = useLiveTick(['orders']);
  const vis = useBranchVisibility();
  const [chip, setChip] = useState<OrderChip>('all');
  const [query, setQuery] = useState('');
  const [preset, setPreset] = useState<RangePreset>('today');
  const [branchId, setBranchId] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const branches = useMemo(() => getBranches().filter(b => vis.allowed(b.id)), [tick, vis.showUnassigned]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const visible = getOrders().filter(o => (o.branchId ? vis.allowed(String(o.branchId)) : vis.showUnassigned));
    return filterOrders(visible, { chip, query, branchId, range: rangeOf(preset) });
  }, [tick, chip, query, branchId, preset, vis.showUnassigned]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = chip !== 'all' || !!query || branchId !== 'all' || preset !== 'today';
  const clear = () => { setChip('all'); setQuery(''); setBranchId('all'); setPreset('today'); };

  return (
    <div className="space-y-3" data-testid="owner-orders">
      <ScreenHeader
        title="Orders"
        right={<IconButton label="Filters" onClick={() => setShowFilters(v => !v)} badge={(branchId !== 'all' ? 1 : 0) + (preset !== 'today' ? 1 : 0)}><SlidersHorizontal className="h-5 w-5" /></IconButton>}
      />
      {showFilters && (
        <Card className="space-y-3" data-testid="own-order-filters">
          <div className="text-[13px] font-semibold text-muted-foreground">Period (Running always shows what is open now)</div>
          <PresetChips value={preset} onChange={setPreset} />
          {branches.length > 1 && (
            <label className="block text-[13px] font-semibold text-muted-foreground">
              Branch
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-card px-3 text-[15px] font-semibold text-foreground">
                <option value="all">All branches</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                {vis.showUnassigned && <option value={UNASSIGNED}>No branch recorded</option>}
              </select>
            </label>
          )}
        </Card>
      )}
      <label className="flex h-12 items-center gap-2.5 rounded-2xl border bg-card px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input value={query} onChange={e => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Search #, customer, table" aria-label="Search orders" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground" />
      </label>
      <div role="tablist" aria-label="Status" className="own-scroll-x -mx-4 flex gap-2 px-4 pb-1">
        {ORDER_CHIPS.map(c => (
          <button key={c.id} type="button" role="tab" aria-selected={chip === c.id} data-own-chip onClick={() => { setChip(c.id); setLimit(PAGE); }}>{c.label}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty action={filtered ? <button type="button" onClick={clear} className="rounded-full border bg-card px-4 py-2 text-[14px] font-semibold text-primary">Clear filters</button> : undefined}>
          {filtered ? 'No orders match' : 'No orders today yet'}
        </Empty>
      ) : (
        <div className="space-y-2.5" data-testid="own-order-list">
          {rows.slice(0, limit).map(o => {
            const b = orderBadge(o);
            const today = new Date().toDateString() === new Date(o.createdAt).toDateString();
            return (
              <button key={o.id} type="button" onClick={() => navigate(`${OWNER_BASE}/orders/${encodeURIComponent(o.id)}`)} className="block w-full text-left" data-testid="own-order-row">
                <Card className="flex items-center gap-3 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15.5px] font-bold">{orderTitle(o)}</div>
                    <div className="truncate text-[13px] text-muted-foreground">{orderSubtitle(o)}{!today && ` · ${day(o.createdAt)}`}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={b.tone}>{b.label}</Badge>
                    <div className="text-[15px] font-extrabold tabular-nums">{rs(o.grandTotal)}</div>
                  </div>
                </Card>
              </button>
            );
          })}
          {rows.length > limit && (
            <button type="button" onClick={() => setLimit(l => l + PAGE)} className="w-full rounded-2xl border bg-card py-3 text-[14px] font-semibold text-primary">
              Show more ({rows.length - limit} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function OwnerOrderDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const tick = useLiveTick(['orders']);
  const vis = useBranchVisibility();
  const order = useMemo(() => getOrders().find(o => o.id === decodeURIComponent(id)), [tick, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sharing, setSharing] = useState(false);
  const allowed = order && (order.branchId ? vis.allowed(String(order.branchId)) : vis.showUnassigned);

  if (!order || !allowed) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="Order" back={`${OWNER_BASE}/orders`} />
        <Empty>This bill is not on this device — it may belong to another branch, or it has not synced yet.</Empty>
      </div>
    );
  }
  const b = orderBadge(order);
  const charges = orderCharges(order);
  const events = orderTimeline(order);
  const pays = (order.payments || []).filter(p => Number(p.amount) > 0);
  const cust = order.customer;
  const share = async () => {
    setSharing(true);
    try {
      const blob = await orderPdf(order, rs);
      const r = await shareOrDownload(blob, `bill-${order.orderNumber}.pdf`, `Bill #${order.orderNumber}`);
      if (r === 'downloaded') toast.success('Bill saved as PDF');
    } catch { toast.error('Could not make the PDF on this device'); } finally { setSharing(false); }
  };

  return (
    <div className="space-y-3" data-testid="owner-order-detail">
      <ScreenHeader
        title={`Order #${order.orderNumber}`}
        back={`${OWNER_BASE}/orders`}
        right={<IconButton label={sharing ? 'Preparing…' : 'Share receipt (PDF)'} onClick={() => { if (!sharing) void share(); }}><Share2 className="h-5 w-5" /></IconButton>}
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <Badge tone={b.tone}>{b.label}</Badge>
        <span className="text-[13.5px] text-muted-foreground">{[typeName(order.orderType as string), order.tableName || order.tableLabel, `${day(order.createdAt)} ${when(order.createdAt)}`].filter(Boolean).join(' · ')}</span>
      </div>

      <Card data-testid="own-order-items">
        <ul className="space-y-2.5">
          {(order.items || []).map((it, i) => (
            <li key={`${it.id}-${i}`} className="flex items-start justify-between gap-3 text-[15px]">
              <span className="min-w-0">{it.quantity} × {it.name}{it.variantName ? ` (${it.variantName})` : ''}</span>
              <span className="shrink-0 tabular-nums">{rs(it.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="my-3 border-t" />
        {charges.map(c => (
          <div key={c.label} className="flex justify-between text-[14px] text-muted-foreground"><span>{c.label}</span><span className="tabular-nums">{rs(c.amount)}</span></div>
        ))}
        <div className="mt-1 flex justify-between text-[18px] font-extrabold"><span>Total</span><span className="tabular-nums" data-testid="own-order-total">{rs(order.grandTotal)}</span></div>
        {pays.length > 0 && (
          <div className="mt-3 space-y-1 border-t pt-3 text-[13.5px]">
            {pays.map(p => (
              <div key={p.id} className="flex justify-between"><span className="capitalize text-muted-foreground">{p.method}{p.by ? ` · ${p.by}` : ''}</span><span className="tabular-nums">{rs(p.amount)}</span></div>
            ))}
          </div>
        )}
      </Card>

      {cust?.name && (
        <Card className="flex items-center gap-3" data-testid="own-order-customer">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-[15px] font-extrabold text-primary">{initials(cust.name)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15.5px] font-bold">{cust.name}</div>
            <div className="truncate text-[13px] text-muted-foreground">{cust.address || cust.phone || ''}</div>
          </div>
          {cust.phone && <a href={`tel:${cust.phone.replace(/[^\d+]/g, '')}`} aria-label="Call customer" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-card"><Phone className="h-5 w-5" /></a>}
        </Card>
      )}

      {order.riderName && (
        <Card className="flex items-center gap-3" data-testid="own-order-rider">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-primary"><Bike className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15.5px] font-bold">{order.riderName}</div>
            <div className="text-[13px] text-muted-foreground">Rider</div>
          </div>
          {order.riderPhone && <a href={`tel:${order.riderPhone.replace(/[^\d+]/g, '')}`} aria-label="Call rider" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-card"><Phone className="h-5 w-5" /></a>}
        </Card>
      )}

      <Card data-testid="own-order-timeline">
        <div className="mb-2 text-[16px] font-bold">Timeline</div>
        {events.length === 0 ? <div className="text-[13.5px] text-muted-foreground">No times recorded on this bill.</div> : (
          <ul className="space-y-2">
            {events.map((e, i) => (
              <li key={`${e.label}-${e.at}-${i}`} className="grid grid-cols-[4.2rem_1fr] gap-2 text-[14.5px]">
                <span className="tabular-nums text-muted-foreground">{when(e.at)}</span>
                <span>{e.label}{e.who && <span className="text-muted-foreground"> — {e.who}</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className={cn('px-1 pb-2 text-[12px] text-muted-foreground')}>Read-only on the phone. Void, refund and edit stay in the POS, where the permission checks and the audit trail live.</p>
    </div>
  );
}
