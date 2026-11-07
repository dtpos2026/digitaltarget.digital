// DT Rider — the four tabs' content and the sheets that open from lists (v1.88.0).
// RID-04 Home · RID-05 Available · RID-06 New order alert · RID-08 Claim · RID-16 Record · RID-17 History.
import { useMemo, useState } from 'react';
import { Bell, Bike, ClipboardList, Home, MapPin, PackageCheck, RefreshCw, User as UserIcon, Wallet, X } from 'lucide-react';
import { money } from '@/lib/currency';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  RIDER_PERIODS, RIDER_STAGE_LABEL, collectFor, periodSummary, stageTone, whenDelivered,
  type DeliveryRecord, type RiderPeriod,
} from '@/lib/riderApp';
import { Banner, EmptyState, RBadge, RButton, RCard, RLabel, Segmented, Sheet, Skeleton } from './riderUi';

export type RiderTab = 'home' | 'orders' | 'record' | 'profile';
export type OrdersSeg = 'mine' | 'available' | 'history';

const RIDER_TABS: { id: RiderTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'record', label: 'Record', icon: Wallet },
  { id: 'profile', label: 'Profile', icon: UserIcon },
];

export function TabBar({ tab, onTab, badge }: { tab: RiderTab; onTab: (t: RiderTab) => void; badge?: number }) {
  return (
    <nav data-rd-tabbar aria-label="Rider app" className="sticky bottom-0 z-30 flex">
      {RIDER_TABS.map(t => (
        <button
          key={t.id}
          type="button"
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => onTab(t.id)}
          className="relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11.5px] font-bold"
        >
          <t.icon className="h-[22px] w-[22px]" />
          {t.label}
          {t.id === 'orders' && !!badge && (
            <span className="absolute right-[calc(50%-22px)] top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10.5px] text-primary-foreground">{badge}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** The distance line the board computes from the rider's last ping. */
function distanceText(o: Order): string | null {
  const km = o.delivery?.distanceKm;
  if (km == null) return null;
  const eta = o.delivery?.etaMinutes;
  return `${km.toFixed(1)} km${eta ? ` · ~${eta} min` : ''}`;
}

/** RID-04 — one delivery on the Home and Mine lists; the one in progress is tinted. */
export function OrderCard({ order, onOpen, active }: { order: Order; onOpen: () => void; active?: boolean }) {
  const dist = distanceText(order);
  const collect = collectFor(order);
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left" data-rider-order={order.id}>
      <RCard active={active} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[16px] font-extrabold">#{order.orderNumber}</span>
          <RBadge tone={stageTone(order.deliveryStatus)}>{RIDER_STAGE_LABEL[order.deliveryStatus || 'pending']}</RBadge>
        </div>
        <div>
          <div className="text-[15px] font-bold">{order.customer?.name || 'Customer'}</div>
          {order.customer?.address && (
            <div className="flex items-start gap-1 text-[13px] text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="line-clamp-2">{order.customer.address}</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[16px] font-extrabold text-primary">{money(order.grandTotal)}</span>
          {dist && <span className="text-[13px] text-muted-foreground">{dist}</span>}
        </div>
        {/* v1.112.0 — what to take at the door (or that there is nothing to take), without opening the order */}
        <div data-rider-collect-chip><RBadge tone={collect.amount > 0 ? 'warn' : 'ok'}>{collect.amount > 0 ? `Collect ${money(collect.amount)}` : collect.label}</RBadge></div>
      </RCard>
    </button>
  );
}

/** RID-05 — an order nobody has taken yet: total and area, and Claim. */
export function AvailableRow({ order, onClaim }: { order: Order; onClaim: () => void }) {
  return (
    <RCard className="flex items-center gap-3" data-rider-available={order.id}>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-extrabold">#{order.orderNumber} · {money(order.grandTotal)}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {[order.customer?.name, order.customer?.address].filter(Boolean).join(' · ') || 'Delivery'}
        </div>
        {order.deliveryStatus && order.deliveryStatus !== 'ready' && (
          <div className="mt-1"><RBadge tone="neutral">{RIDER_STAGE_LABEL[order.deliveryStatus]}</RBadge></div>
        )}
      </div>
      <RButton variant="primary" size="sm" onClick={onClaim}>Claim</RButton>
    </RCard>
  );
}

/** RID-08 — one confirmation so a stray tap does not take an order. */
export function ClaimSheet({ order, onClose, onClaim }: { order: Order | null; onClose: () => void; onClaim: (o: Order) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  if (!order) return null;
  const c = collectFor(order);
  const dist = distanceText(order);
  return (
    <Sheet open onClose={onClose} label={`Claim order #${order.orderNumber}`}>
      <h2 className="text-[19px] font-extrabold">Claim order #{order.orderNumber}?</h2>
      <dl className="space-y-2 text-[15px]">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Deliver to</dt><dd className="min-w-0 truncate text-right font-bold">{order.customer?.address || order.customer?.name || '—'}</dd></div>
        {dist && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Distance</dt><dd className="font-bold">{dist}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Collect</dt><dd className="font-bold">{c.amount > 0 ? `${money(c.amount)} · ${c.label}` : c.label}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Kitchen</dt><dd className="font-bold">{RIDER_STAGE_LABEL[order.deliveryStatus || 'pending']}</dd></div>
      </dl>
      <RButton variant="primary" size="lg" className="w-full" busy={busy}
        onClick={async () => { setBusy(true); try { await onClaim(order); } finally { setBusy(false); } }}>
        Claim order
      </RButton>
      <RButton className="w-full" onClick={onClose}>Cancel</RButton>
    </Sheet>
  );
}

/** RID-06 — an order became ready while the app is open. */
export function ReadyAlert({ order, mine, onAct, onLater }: { order: Order; mine: boolean; onAct: () => void; onLater: () => void }) {
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-40 mx-auto max-w-md px-3 pt-[calc(8px+env(safe-area-inset-top,0px))]">
      <div data-rd-card className="flex items-center gap-3 border-primary p-3 shadow-[0_12px_36px_rgba(26,21,35,.18)]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Bell className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-extrabold">Order #{order.orderNumber} is ready</div>
          <div className="truncate text-[13px] text-muted-foreground">{[order.customer?.address, money(order.grandTotal)].filter(Boolean).join(' · ')}</div>
        </div>
        <RButton variant="primary" size="sm" onClick={onAct}>{mine ? 'Open' : 'Claim'}</RButton>
        <button type="button" aria-label="Later" onClick={onLater} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/** The skeleton rows a list shows while it loads. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-label="Loading">
      <Skeleton className="h-3.5 w-3/5" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
    </div>
  );
}

export function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  return (
    <RButton className="w-full" disabled={refreshing} onClick={onRefresh}>
      <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </RButton>
  );
}

/** RID-05 / RID-17 — Mine · Available · History. */
export function OrdersTab({
  seg, onSeg, mine, available, history, historyState, onOpen, onClaim, onRecord, onRetryHistory, refresh, now,
}: {
  seg: OrdersSeg; onSeg: (s: OrdersSeg) => void;
  mine: Order[]; available: Order[];
  history: DeliveryRecord[]; historyState: 'loading' | 'ready' | 'failed';
  onOpen: (o: Order) => void; onClaim: (o: Order) => void; onRecord: (r: DeliveryRecord) => void; onRetryHistory: () => void;
  refresh: React.ReactNode; now: Date;
}) {
  return (
    <div className="space-y-3">
      <Segmented<OrdersSeg>
        label="Orders"
        value={seg}
        onChange={onSeg}
        options={[
          { id: 'mine', label: `Mine (${mine.length})` },
          { id: 'available', label: `Available (${available.length})` },
          { id: 'history', label: 'History' },
        ]}
      />
      {seg === 'mine' && (
        mine.length === 0
          ? <EmptyState icon={Bike} title="No active orders" action={refresh}>Claim one from Available, or wait for the restaurant to assign you.</EmptyState>
          : <div className="space-y-2">{mine.map((o, i) => <OrderCard key={o.id} order={o} active={i === 0} onOpen={() => onOpen(o)} />)}</div>
      )}
      {seg === 'available' && (
        available.length === 0
          ? <EmptyState icon={PackageCheck} title="No orders waiting" action={refresh}>New orders appear here automatically.</EmptyState>
          : <div className="space-y-2">{available.map(o => <AvailableRow key={o.id} order={o} onClaim={() => onClaim(o)} />)}</div>
      )}
      {seg === 'history' && (
        <HistoryList rows={history} state={historyState} onRecord={onRecord} onRetry={onRetryHistory} now={now} />
      )}
    </div>
  );
}

function HistoryList({ rows, state, onRecord, onRetry, now }: { rows: DeliveryRecord[]; state: 'loading' | 'ready' | 'failed'; onRecord: (r: DeliveryRecord) => void; onRetry: () => void; now: Date }) {
  if (state === 'loading' && !rows.length) return <ListSkeleton rows={4} />;
  return (
    <div className="space-y-2">
      {state === 'failed' && <Banner tone="bad" action={<RButton size="sm" onClick={onRetry}>Retry</RButton>}>Could not load your record.</Banner>}
      {rows.length === 0 && state !== 'failed' && <EmptyState icon={ClipboardList} title="No completed deliveries yet" />}
      {rows.map(r => <RecordRow key={r.id} r={r} now={now} onOpen={() => onRecord(r)} long />)}
    </div>
  );
}

function RecordRow({ r, now, onOpen, long }: { r: DeliveryRecord; now: Date; onOpen: () => void; long?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="block w-full text-left" data-rider-record={r.id}>
      <RCard className="flex items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">#{r.orderNumber}{long ? ` · ${r.customerName}` : ''}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {long ? [r.address, whenDelivered(r.deliveredAt, now, true)].filter(Boolean).join(' · ') : `${r.customerName} · ${whenDelivered(r.deliveredAt, now)}`}
          </div>
        </div>
        <span className="shrink-0 text-[15px] font-extrabold">{money(r.total)}</span>
      </RCard>
    </button>
  );
}

/** A delivered order, read-only (from History or Record). */
export function RecordSheet({ r, onClose }: { r: DeliveryRecord | null; onClose: () => void }) {
  if (!r) return null;
  const d = new Date(r.deliveredAt);
  return (
    <Sheet open onClose={onClose} label={`Order #${r.orderNumber}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[19px] font-extrabold">Order #{r.orderNumber}</h2>
        <RBadge tone="ok">Delivered</RBadge>
      </div>
      <dl className="space-y-2 text-[15px]">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Customer</dt><dd className="font-bold">{r.customerName}</dd></div>
        {r.address && <div className="flex justify-between gap-3"><dt className="shrink-0 text-muted-foreground">Address</dt><dd className="text-right font-semibold">{r.address}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Delivered</dt><dd className="font-bold">{d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Bill</dt><dd className="font-extrabold text-primary">{money(r.total)}</dd></div>
      </dl>
      <RButton className="w-full" onClick={onClose}>Close</RButton>
    </Sheet>
  );
}

/**
 * RID-16 — the rider's record for a period. The server's figure (portal_my_history "earnings") is the total of the
 * bills the rider delivered, not the rider's pay, and the screen says so rather than calling it earnings.
 */
export function RecordTab({ rows, lifetime, state, onRetry, onRecord, now }: {
  rows: DeliveryRecord[]; lifetime?: number; state: 'loading' | 'ready' | 'failed'; onRetry: () => void; onRecord: (r: DeliveryRecord) => void; now: Date;
}) {
  const [period, setPeriod] = useState<RiderPeriod>('today');
  const sum = useMemo(() => periodSummary(rows, period, now), [rows, period, now]);
  const max = Math.max(1, ...sum.bars.map(b => b.total));
  const label = RIDER_PERIODS.find(p => p.id === period)!.label.toLowerCase();
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Period" className="flex gap-2">
        {RIDER_PERIODS.map(p => (
          <button key={p.id} type="button" role="tab" aria-selected={period === p.id} data-rd-chip onClick={() => setPeriod(p.id)}>{p.label}</button>
        ))}
      </div>
      {state === 'failed' && <Banner tone="bad" action={<RButton size="sm" onClick={onRetry}>Retry</RButton>}>Could not load your record.</Banner>}
      {state === 'loading' && !rows.length ? (
        <><Skeleton className="h-28 w-full" /><ListSkeleton rows={3} /></>
      ) : (
        <>
          <RCard className="space-y-1 border-transparent bg-[hsl(var(--rd-tint))]" data-rider-record-total>
            <div className="text-[13px] text-muted-foreground">Bills delivered {label === 'today' ? 'today' : label}</div>
            <div className="text-[32px] font-extrabold leading-tight text-primary">{money(sum.total)}</div>
            <div className="text-[13px] text-muted-foreground">
              {sum.count} {sum.count === 1 ? 'delivery' : 'deliveries'}{typeof lifetime === 'number' ? ` · ${lifetime} in total` : ''}
            </div>
          </RCard>
          <RCard className="pb-3" aria-label={`Deliveries ${label}, by ${period === 'today' ? 'hour' : 'day'}`}>
            <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={sum.bars.map(b => `${b.label}: ${b.count}`).join(', ')}>
              {sum.bars.map((b, i) => (
                <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${b.label}: ${b.count} · ${money(b.total)}`}>
                  <div className={cn('w-full rounded-t-[4px]', b.total > 0 ? 'bg-primary' : 'bg-muted')} style={{ height: `${b.total > 0 ? Math.max(6, (b.total / max) * 100) : 4}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{sum.bars[0]?.label}</span>
              <span>{sum.bars[Math.floor(sum.bars.length / 2)]?.label}</span>
              <span>{sum.bars[sum.bars.length - 1]?.label}</span>
            </div>
          </RCard>
          <p className="px-1 text-[12.5px] text-muted-foreground">The value of the bills you delivered. Your pay is agreed with your restaurant.</p>
          <RLabel>Delivered {label === 'today' ? 'today' : label}</RLabel>
          {sum.rows.length === 0
            ? <EmptyState icon={Wallet} title="No deliveries in this period" />
            : <div className="space-y-2">{sum.rows.map(r => <RecordRow key={r.id} r={r} now={now} onOpen={() => onRecord(r)} />)}</div>}
        </>
      )}
    </div>
  );
}
