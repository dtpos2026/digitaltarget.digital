// ============================================================
// OWNER APP — operations on the phone (v1.90.0)
//   OWN-08 Online approvals · OWN-09 Kitchen · OWN-10 Delivery and riders · OWN-16 Staff · OWN-17 Customers and credit
//   · OWN-22 Profile and workspace
//
// Until v1.89.0 these rows of More opened the till's full pages inside the owner's phone. They are phone screens now,
// on the same rows. Rules: lib/ownerOps.ts. The one action that needed care is Approve (see approveFromPhone): the
// phone has no printer, so a till prints the kitchen ticket.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bike, Check, ChefHat, Clock, MapPin, Phone, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  getAttendance, getBranches, getCreditPayments, getCustomers, getEmployees, getOrders, getRiders, getSettings, getUsers, saveOrder,
} from '@/lib/store';
import { REJECT_REASONS, SOURCE_LABELS, rejectOrder, sourceKeyForOrder } from '@/lib/onlineApproval';
import {
  ROLE_LABEL, approveFromPhone, creditRows, customerRows, deliveryBoard, kitchenBoard, onDutyToday, pendingApprovals, staffList,
  type StaffMember,
} from '@/lib/ownerOps';
import { localYmd } from '@/lib/ownerApp';
import { DELIVERY_STAGE_LABEL } from '@/lib/delivery';
import { loadStaff } from '@/lib/branchCloud';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import LeafletMap, { type MapMarker } from '@/components/LeafletMap';
import WorkspaceCodeCard from '@/components/WorkspaceCodeCard';
import PlanStatusWidget from '@/components/PlanStatusWidget';
import { Badge, Card, Empty, Label, ScreenHeader } from './ownerUi';
import { OWNER_BASE, rs, useBranchVisibility, useLiveTick } from './ownerHooks';

const ago = (iso: string | undefined, now = Date.now()) => {
  const m = Math.max(0, Math.floor((now - Date.parse(iso || '')) / 60000));
  if (!Number.isFinite(m)) return '';
  return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const tel = (phone?: string) => (phone || '').replace(/[^\d+]/g, '');

function CallLink({ phone, label }: { phone?: string; label: string }) {
  if (!tel(phone)) return null;
  return (
    <a href={`tel:${tel(phone)}`} aria-label={label} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border bg-card px-3.5 text-[14px] font-semibold">
      <Phone className="h-4 w-4" /> Call
    </a>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone?: 'bad' | 'ok' | 'warn' }) {
  const c = tone === 'bad' ? 'text-[hsl(var(--own-bad))]' : tone === 'ok' ? 'text-[hsl(var(--own-ok))]' : tone === 'warn' ? 'text-[hsl(var(--own-warn))]' : 'text-foreground';
  return (
    <Card className="px-2 py-3 text-center">
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div className={cn('text-[22px] font-extrabold leading-tight', c)}>{value}</div>
    </Card>
  );
}

/** Orders this user may see: their branches, and bills with no branch only for an owner. */
function useVisibleOrders(tick: number): Order[] {
  const { allowed, showUnassigned } = useBranchVisibility();
  return useMemo(() => getOrders().filter(o => (o.branchId ? allowed(o.branchId) : showUnassigned)), [tick, allowed, showUnassigned]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ------------------------------------------------------------------ OWN-08
export function OwnerApprovals({ by }: { by: { userId?: string; userName?: string } }) {
  const tick = useLiveTick(['orders']);
  const [version, bump] = useState(0);
  const orders = useVisibleOrders(tick + version);
  const pending = useMemo(() => pendingApprovals(orders), [orders]);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [reason, setReason] = useState<string>(REJECT_REASONS[0]);
  const [note, setNote] = useState('');

  const approve = (o: Order) => {
    saveOrder(approveFromPhone(o, by));
    bump(v => v + 1);
    toast.success(`#${o.orderNumber} approved — it is on the kitchen screen, and a till prints the ticket`);
  };
  const reject = () => {
    if (!rejecting) return;
    const why = reason === 'Other' ? (note.trim() || 'Other') : (note.trim() ? `${reason} — ${note.trim()}` : reason);
    rejectOrder(rejecting.id, why, by);
    toast(`#${rejecting.orderNumber} rejected`);
    setRejecting(null); setNote(''); setReason(REJECT_REASONS[0]);
    bump(v => v + 1);
  };

  return (
    <div className="space-y-3" data-testid="owner-approvals">
      <ScreenHeader title="Online approvals" back={`${OWNER_BASE}/more`} sub={pending.length ? `${pending.length} waiting` : undefined} />
      {pending.length === 0 ? <Empty>No orders are waiting for approval.</Empty> : pending.map(o => {
        const key = sourceKeyForOrder(o);
        return (
          <Card key={o.id} className="space-y-3" data-testid={`own-approval-${o.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[17px] font-extrabold">#{o.orderNumber} · {rs(o.grandTotal)}</div>
                <div className="text-[13px] text-muted-foreground">{key ? SOURCE_LABELS[key] : 'Online'} · {o.orderType === 'delivery' ? 'Delivery' : o.tableName ? `Table ${o.tableName}` : o.orderType}</div>
              </div>
              <Badge tone="warning"><Clock className="mr-1 h-3.5 w-3.5" />{ago(o.createdAt)}</Badge>
            </div>
            {o.customer && (
              <div className="text-[14px]">
                <div className="font-semibold">{o.customer.name || 'Customer'}{o.customer.phone ? ` · ${o.customer.phone}` : ''}</div>
                {o.customer.address && <div className="flex items-start gap-1 text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{o.customer.address}</div>}
              </div>
            )}
            <ul className="space-y-0.5 text-[14px]">
              {(o.items || []).map(i => (
                <li key={i.id} className="flex justify-between gap-3"><span className="min-w-0">{i.quantity} × {i.name}{i.variantName ? ` (${i.variantName})` : ''}</span><span className="shrink-0 text-muted-foreground">{rs(i.lineTotal)}</span></li>
              ))}
            </ul>
            {o.notes?.trim() && <div className="rounded-xl bg-muted px-3 py-2 text-[13.5px]">{o.notes.trim()}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={() => approve(o)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-bold text-primary-foreground"><Check className="h-4 w-4" />Approve</button>
              <button type="button" onClick={() => setRejecting(o)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border bg-card text-[15px] font-bold text-[hsl(var(--own-bad))]"><X className="h-4 w-4" />Reject</button>
              <CallLink phone={o.customer?.phone} label={`Call ${o.customer?.name || 'the customer'}`} />
            </div>
          </Card>
        );
      })}
      <p className="px-1 text-[12px] text-muted-foreground">Approve puts the order on the kitchen screen at once. This phone has no printer: a till prints the kitchen ticket, as it does for website orders (Settings → printing decides).</p>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={`Reject #${rejecting.orderNumber}`}>
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setRejecting(null)} />
          <div className="relative mx-auto w-full max-w-[560px] space-y-3 rounded-t-3xl bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="text-[18px] font-extrabold">Reject #{rejecting.orderNumber}?</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
              {REJECT_REASONS.map(r => (
                <button key={r} type="button" role="radio" aria-checked={reason === r} data-own-chip onClick={() => setReason(r)} aria-pressed={reason === r}>{r}</button>
              ))}
            </div>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={reason === 'Other' ? 'Why? (the customer sees the order as rejected)' : 'Note (optional)'}
              className="h-11 w-full rounded-xl border bg-background px-3 text-[15px]" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setRejecting(null)} className="h-11 flex-1 rounded-xl border bg-card text-[15px] font-semibold">Cancel</button>
              <button type="button" onClick={reject} className="h-11 flex-1 rounded-xl bg-[hsl(var(--own-bad))] text-[15px] font-bold text-white">Reject order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ OWN-09
export function OwnerKitchen() {
  const tick = useLiveTick(['orders', 'settings']);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const orders = useVisibleOrders(tick);
  const board = useMemo(() => kitchenBoard(orders, getSettings(), now), [orders, now]);
  const STATE = { new: { label: 'New', tone: 'info' as const }, cooking: { label: 'Cooking', tone: 'warning' as const }, ready: { label: 'Ready', tone: 'success' as const } };
  return (
    <div className="space-y-3" data-testid="owner-kitchen">
      <ScreenHeader title="Kitchen" back={`${OWNER_BASE}/more`} />
      <div className="grid grid-cols-4 gap-2" data-testid="own-kitchen-counts">
        <Tile label="New" value={board.counts.new} />
        <Tile label="Cooking" value={board.counts.cooking} tone="warn" />
        <Tile label="Ready" value={board.counts.ready} tone="ok" />
        <Tile label="Late" value={board.counts.late} tone={board.counts.late ? 'bad' : undefined} />
      </div>
      {board.tickets.length === 0 ? <Empty>The kitchen has no open tickets.</Empty> : (
        <div className="space-y-2" data-testid="own-kitchen-list">
          {board.tickets.map(t => (
            <Card key={t.id} className={cn('flex items-center gap-3 py-3', t.late && 'border-[hsl(var(--own-bad))]')}>
              <ChefHat className={cn('h-5 w-5 shrink-0', t.late ? 'text-[hsl(var(--own-bad))]' : 'text-muted-foreground')} />
              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-bold">#{t.orderNumber} · {t.label}</div>
                <div className="text-[13px] text-muted-foreground">{t.items} item{t.items === 1 ? '' : 's'} · {t.age} min{t.late ? ' · late' : ''}</div>
              </div>
              <Badge tone={STATE[t.state].tone}>{STATE[t.state].label}</Badge>
            </Card>
          ))}
        </div>
      )}
      <p className="px-1 text-[12px] text-muted-foreground">Read-only: the kitchen moves tickets on its own screen. Late after {board.lateAfter} min (Settings → Kitchen).</p>
    </div>
  );
}

// ------------------------------------------------------------------ OWN-10
export function OwnerDelivery() {
  const tick = useLiveTick(['orders', 'riders']);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const orders = useVisibleOrders(tick);
  const board = useMemo(() => deliveryBoard(orders, getRiders(), now), [orders, tick, now]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pins: a Live rider's last position, from the deliveries they are carrying.
  const markers = useMemo<MapMarker[]>(() => board.riders.flatMap(r => {
    if (!r.live) return [];
    const at = r.current.find(o => o.delivery?.riderLat != null && o.delivery?.riderLng != null);
    return at ? [{ id: r.id, lat: at.delivery!.riderLat!, lng: at.delivery!.riderLng!, title: r.name, color: 'green' as const, popupHtml: `<b>${r.name.replace(/</g, '&lt;')}</b>` }] : [];
  }), [board]);
  return (
    <div className="space-y-3" data-testid="owner-delivery">
      <ScreenHeader title="Delivery and riders" back={`${OWNER_BASE}/more`} />
      <div className="grid grid-cols-3 gap-2" data-testid="own-delivery-counts">
        <Tile label="Waiting" value={board.counts.waiting} tone={board.counts.waiting ? 'warn' : undefined} />
        <Tile label="On the way" value={board.counts.onway} />
        <Tile label="Delivered today" value={board.counts.delivered} tone="ok" />
      </div>
      {markers.length > 0 && (
        <div className="overflow-hidden rounded-2xl border"><LeafletMap markers={markers} height={220} zoom={12} center={[markers[0].lat, markers[0].lng]} /></div>
      )}
      {board.stuck.length > 0 && (
        <div>
          <Label>Needs attention</Label>
          <div className="space-y-2" data-testid="own-delivery-stuck">
            {board.stuck.map(({ order: o, why }) => (
              <Card key={o.id} className="flex items-center gap-3 border-amber-300/80 py-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-[hsl(var(--own-warn))]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold">#{o.orderNumber} · {why}</div>
                  <div className="truncate text-[13px] text-muted-foreground">{[o.customer?.name, o.customer?.address].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="shrink-0 text-[14px] font-bold">{rs(o.grandTotal)}</span>
              </Card>
            ))}
          </div>
        </div>
      )}
      <div>
        <Label right={`${board.riders.filter(r => r.live).length} live`}>Riders</Label>
        {board.riders.length === 0 ? <Empty>No riders added yet.</Empty> : (
          <Card className="divide-y py-1" data-testid="own-delivery-riders">
            {board.riders.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-3">
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', r.live ? 'bg-[hsl(var(--own-ok))]' : 'bg-muted-foreground/40')} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">{r.name}</div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {r.live ? 'Live' : r.lastSeen ? `Offline · seen ${ago(r.lastSeen, now)} ago` : 'Offline'}
                    {r.current.length > 0 && ` · ${r.current.map(o => `#${o.orderNumber} ${DELIVERY_STAGE_LABEL[o.deliveryStatus || 'pending']}`).join(', ')}`}
                  </div>
                </div>
                <CallLink phone={r.phone} label={`Call ${r.name}`} />
              </div>
            ))}
          </Card>
        )}
      </div>
      {board.unassigned.length > 0 && (
        <div>
          <Label>Waiting for a rider</Label>
          <Card className="divide-y py-1">
            {board.unassigned.map(o => (
              <div key={o.id} className="flex items-center gap-3 py-3">
                <Bike className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">#{o.orderNumber} · {DELIVERY_STAGE_LABEL[o.deliveryStatus || 'pending']}</div>
                  <div className="truncate text-[13px] text-muted-foreground">{o.customer?.address || o.customer?.name || 'Delivery'} · {ago(o.createdAt, now)}</div>
                </div>
                <span className="shrink-0 text-[14px] font-bold">{rs(o.grandTotal)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
      <p className="px-1 text-[12px] text-muted-foreground">Assigning a rider stays at the till (Delivery board). A rider who is not Live in DT Rider has no pin.</p>
    </div>
  );
}

// ------------------------------------------------------------------ OWN-17
export function OwnerCustomers({ credit: showCredit }: { credit: boolean }) {
  const tick = useLiveTick(['customers', 'orders', 'creditPayments']);
  const [seg, setSeg] = useState<'customers' | 'credit'>(showCredit ? 'credit' : 'customers');
  const [q, setQ] = useState('');
  const orders = useVisibleOrders(tick);
  const customers = useMemo(() => customerRows(getCustomers(), q), [tick, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const credit = useMemo(() => creditRows(orders, getCreditPayments()).filter(r => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()) || r.phone.includes(q.trim())), [orders, tick, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalOwed = credit.reduce((s, r) => s + r.owed, 0);
  return (
    <div className="space-y-3" data-testid="owner-customers">
      <ScreenHeader title="Customers and credit" back={`${OWNER_BASE}/more`} />
      <div className="flex gap-2" role="tablist" aria-label="Customers or credit">
        <button type="button" role="tab" aria-selected={seg === 'customers'} data-own-chip onClick={() => setSeg('customers')}>Customers</button>
        {showCredit && <button type="button" role="tab" aria-selected={seg === 'credit'} data-own-chip onClick={() => setSeg('credit')}>Credit{credit.length ? ` (${credit.length})` : ''}</button>}
      </div>
      <label className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or phone" className="h-full flex-1 bg-transparent text-[15px] outline-none" aria-label="Search customers" />
      </label>
      {seg === 'customers' ? (
        customers.length === 0 ? <Empty>{q ? 'No customer matches.' : 'No customers yet.'}</Empty> : (
          <Card className="divide-y py-1" data-testid="own-customer-list">
            {customers.slice(0, 200).map(c => (
              <div key={c.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{c.name || c.phone}</div>
                  <div className="text-[13px] text-muted-foreground">{c.phone} · {c.totalOrders || 0} order{c.totalOrders === 1 ? '' : 's'} · {rs(c.totalSpent || 0)}</div>
                </div>
                <CallLink phone={c.phone} label={`Call ${c.name || c.phone}`} />
              </div>
            ))}
          </Card>
        )
      ) : (
        <>
          <Card className="flex items-center justify-between" data-testid="own-credit-total">
            <span className="text-[14px] text-muted-foreground">Still owed on credit</span>
            <b className="text-[20px] text-[hsl(var(--own-bad))]">{rs(totalOwed)}</b>
          </Card>
          {credit.length === 0 ? <Empty>Nobody owes anything on credit.</Empty> : (
            <Card className="divide-y py-1" data-testid="own-credit-list">
              {credit.map(r => (
                <div key={r.key} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{r.name}</div>
                    <div className="text-[13px] text-muted-foreground">{r.bills} bill{r.bills === 1 ? '' : 's'} · since {new Date(r.oldest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                  </div>
                  <b className="shrink-0 text-[15px] text-[hsl(var(--own-bad))]">{rs(r.owed)}</b>
                  <CallLink phone={r.phone} label={`Call ${r.name}`} />
                </div>
              ))}
            </Card>
          )}
          <p className="px-1 text-[12px] text-muted-foreground">Receiving a credit payment stays at the till (it records the payment).</p>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ OWN-16
export function OwnerStaff() {
  const tick = useLiveTick(['users', 'employees', 'attendance']);
  const [cloud, setCloud] = useState<{ rows: StaffMember[]; ok: boolean } | null>(null);
  const [role, setRole] = useState<string>('all');
  useEffect(() => {
    let off = false;
    loadStaff().then(r => { if (!off) setCloud(r.ok ? { rows: r.rows, ok: true } : { rows: [], ok: false }); }).catch(() => { if (!off) setCloud({ rows: [], ok: false }); });
    return () => { off = true; };
  }, []);
  // The cloud list is the real one (every account); this phone's copy fills in when offline, and gives phones.
  const local = useMemo(() => getUsers(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const phoneOf = new Map(local.map(u => [u.id, u.phone || '']));
  const all: StaffMember[] = cloud?.ok && cloud.rows.length
    ? cloud.rows
    : local.map(u => ({ id: u.id, name: u.name, role: u.role, branchId: u.branchId || null, active: u.isActive !== false }));
  const rows = staffList(all, role);
  const roles = [...new Set(all.map(s => s.role))];
  const branchName = new Map(getBranches().map(b => [b.id, b.name]));
  const onDuty = useMemo(() => onDutyToday(getEmployees(), getAttendance(), localYmd()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const keepsAttendance = useMemo(() => getAttendance().some(a => a.date === localYmd()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3" data-testid="owner-staff">
      <ScreenHeader title="Staff" back={`${OWNER_BASE}/more`} />
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Accounts active" value={all.filter(s => s.active).length} />
        <Tile label="On duty now" value={keepsAttendance ? onDuty.length : '—'} tone={keepsAttendance ? 'ok' : undefined} />
      </div>
      {!keepsAttendance && <p className="px-1 text-[12.5px] text-muted-foreground">On duty comes from HR attendance; nobody is marked in today.</p>}
      {cloud && !cloud.ok && <p className="px-1 text-[12.5px] text-[hsl(var(--own-warn))]">The full staff list needs a connection; showing the accounts on this phone.</p>}
      <div className="own-scroll-x -mx-4 flex gap-2 px-4 pb-1" role="tablist" aria-label="Role">
        <button type="button" role="tab" aria-selected={role === 'all'} data-own-chip onClick={() => setRole('all')}>All</button>
        {roles.map(r => <button key={r} type="button" role="tab" aria-selected={role === r} data-own-chip onClick={() => setRole(r)}>{ROLE_LABEL[r] || r}</button>)}
      </div>
      {rows.length === 0 ? <Empty>No staff accounts.</Empty> : (
        <Card className="divide-y py-1" data-testid="own-staff-list">
          {rows.map(s => (
            <div key={s.id} className={cn('flex items-center gap-3 py-3', !s.active && 'opacity-55')}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{s.name}</div>
                <div className="text-[13px] text-muted-foreground">{s.branchId ? branchName.get(s.branchId) || 'One branch' : 'All branches'}{s.active ? '' : ' · inactive'}</div>
              </div>
              <Badge tone={s.role === 'admin' ? 'accent' : 'neutral'}>{ROLE_LABEL[s.role] || s.role}</Badge>
              <CallLink phone={phoneOf.get(s.id)} label={`Call ${s.name}`} />
            </div>
          ))}
        </Card>
      )}
      <p className="px-1 text-[12px] text-muted-foreground">Salaries and payroll are not shown on the phone. Adding staff and changing roles stay in the full software.</p>
    </div>
  );
}

// ------------------------------------------------------------------ OWN-22
export function OwnerProfile({ userName, role, onLogout }: { userName: string; role: string; onLogout: () => void }) {
  const settings = getSettings();
  return (
    <div className="space-y-3" data-testid="owner-profile">
      <ScreenHeader title="Profile and workspace" back={`${OWNER_BASE}/more`} />
      <Card className="space-y-0.5">
        <div className="text-[17px] font-bold">{userName || role}</div>
        <div className="text-[13.5px] capitalize text-muted-foreground">{ROLE_LABEL[role] || role} · {settings.name}</div>
      </Card>
      <div><Label>Workspace code — staff type it into DT Rider and DT Order Taker</Label><WorkspaceCodeCard /></div>
      <PlanStatusWidget />
      <button type="button" onClick={onLogout} className="w-full rounded-2xl border bg-card py-3.5 text-[15px] font-semibold text-[hsl(var(--own-bad))]">Sign out</button>
      <p className="px-1 text-[12px] text-muted-foreground">Changing your password stays in the full software (Users &amp; Access).</p>
    </div>
  );
}
