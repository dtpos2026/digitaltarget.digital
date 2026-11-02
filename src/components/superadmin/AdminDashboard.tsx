// The Super Admin dashboard (v1.84.0): the cards, the "waiting for approval" list, the renewals that are due, and a quick
// "+ New invoice". Every figure comes from lib/superAdminOverview.ts; a figure the console cannot know is not shown.
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, CalendarClock, CheckCircle2, CircleDollarSign, Clock3, FilePlus2, HandCoins, RefreshCw, Smartphone, Store, UserCheck, Wifi,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { EmptyState, SectionCard } from '@/components/ui-kit';
import { TONE_CLASS, type Tone } from '@/components/ui-kit/StatusBadge';
import {
  buildKpis, renewalsDue, waitingForApproval,
  type DeviceInfo, type InvoiceInfo, type PaymentInfo, type TenantRow,
} from '@/lib/superAdminOverview';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const when = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }));

interface Props {
  tenants: TenantRow[];
  devices: DeviceInfo[];
  onApprove: (tenantId: string) => void;
  onOpenBilling: (tenantId: string) => void;
  onGo: (tab: string) => void;
  onRefresh: () => void;
  /** Loaders for money; injectable for tests. Default: the console's Supabase helpers. */
  loadMoney?: () => Promise<{ invoices: InvoiceInfo[]; payments: PaymentInfo[] }>;
}

async function defaultLoadMoney(): Promise<{ invoices: InvoiceInfo[]; payments: PaymentInfo[] }> {
  const { listInvoices, listPayments } = await import('@/lib/superAdminSupabase');
  const [inv, pay] = await Promise.all([listInvoices(), listPayments()]);
  return {
    invoices: inv.map(i => ({ tenantId: i.tenant_id, total: Number(i.total) || 0, paidTotal: Number(i.paid_total) || 0, status: i.status })),
    payments: pay.map(p => ({ amount: Number(p.amount) || 0, receivedAt: p.received_at })),
  };
}

function Card({ label, value, icon: Icon, tone, hint, onClick, testId }: { label: string; value: string; icon: typeof Store; tone: Tone; hint?: string; onClick?: () => void; testId: string }) {
  const body = (
    <>
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', TONE_CLASS[tone])}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[26px] font-extrabold leading-none tracking-tight tabular-nums" data-testid={`${testId}-value`}>{value}</span>
        <span className="mt-1 block truncate text-[12.5px] font-semibold text-muted-foreground">{label}</span>
        {hint && <span className="block truncate text-[11.5px] text-muted-foreground/80">{hint}</span>}
      </span>
    </>
  );
  const cls = 'flex items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm';
  return onClick
    ? <button type="button" data-testid={testId} onClick={onClick} className={cn(cls, 'transition-colors hover:border-primary/40')}>{body}</button>
    : <div data-testid={testId} className={cls}>{body}</div>;
}

export default function AdminDashboard({ tenants, devices, onApprove, onOpenBilling, onGo, onRefresh, loadMoney = defaultLoadMoney }: Props) {
  const [money, setMoney] = useState<{ invoices: InvoiceInfo[]; payments: PaymentInfo[] } | null>(null);
  const [moneyError, setMoneyError] = useState(false);
  const [pick, setPick] = useState(false);
  const [chosen, setChosen] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let off = false;
    setMoneyError(false);
    loadMoney().then(m => { if (!off) setMoney(m); }).catch(() => { if (!off) { setMoney({ invoices: [], payments: [] }); setMoneyError(true); } });
    return () => { off = true; };
  }, [loadMoney, tick]);

  const nowMs = Date.now();
  const kpi = useMemo(() => buildKpis({ tenants, devices, invoices: money?.invoices ?? [], payments: money?.payments ?? [], nowMs }), [tenants, devices, money, Math.floor(nowMs / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => waitingForApproval(tenants), [tenants]);
  const renewals = useMemo(() => renewalsDue(tenants, nowMs), [tenants, Math.floor(nowMs / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const moneyReady = money !== null && !moneyError;
  const m = (n: number) => (moneyReady ? rs(n) : '—');

  const badge = { expired: ['Expired', 'bg-[hsl(var(--status-danger)/0.12)] text-[hsl(var(--status-danger))]'], soon: ['Expiring soon', 'bg-amber-500/15 text-amber-800'], active: ['Active', 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]'] } as const;

  return (
    <div className="space-y-5" data-testid="admin-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-extrabold tracking-tight">Dashboard</h2>
          <p className="text-[13px] text-muted-foreground">Restaurants, devices and money, as of now.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { onRefresh(); setTick(t => t + 1); }} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border bg-card px-3 text-[13px] font-semibold hover:border-primary/40"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
          <button type="button" data-testid="new-invoice" onClick={() => setPick(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[13px] font-bold text-primary-foreground hover:bg-primary/90"><FilePlus2 className="h-4 w-4" /> New invoice</button>
        </div>
      </div>

      {moneyError && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] font-semibold text-amber-800" role="alert">
          <AlertTriangle className="h-4 w-4" /> The money figures could not be loaded, so they are not shown. Press Refresh to try again.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card testId="k-restaurants" label="Restaurants" value={String(kpi.restaurants)} icon={Store} tone="accent" onClick={() => onGo('restaurants')} />
        <Card testId="k-waiting" label="Waiting for approval" value={String(kpi.waiting)} icon={Clock3} tone={kpi.waiting ? 'warning' : 'neutral'} onClick={() => onGo('restaurants')} />
        <Card testId="k-devices-new" label="New device requests" value={String(kpi.newDeviceRequests)} icon={Smartphone} tone={kpi.newDeviceRequests ? 'warning' : 'neutral'} onClick={() => onGo('devices')} />
        <Card testId="k-active" label="Active" value={String(kpi.active)} icon={CheckCircle2} tone="success" hint="Approved, plan not expired" />
        <Card testId="k-payment-pending" label="Payment pending" value={moneyReady ? String(kpi.paymentPending) : '—'} icon={HandCoins} tone={kpi.paymentPending ? 'warning' : 'neutral'} hint="Restaurants with an open invoice" onClick={() => onGo('clients')} />
        <Card testId="k-expired" label="Expired" value={String(kpi.expired)} icon={Ban} tone={kpi.expired ? 'danger' : 'neutral'} onClick={() => onGo('clients')} />
        <Card testId="k-expiring" label="Expiring in 7 days" value={String(kpi.expiring7)} icon={CalendarClock} tone={kpi.expiring7 ? 'warning' : 'neutral'} onClick={() => onGo('clients')} />
        <Card testId="k-blocked" label="Blocked devices" value={String(kpi.blockedDevices)} icon={Ban} tone={kpi.blockedDevices ? 'danger' : 'neutral'} onClick={() => onGo('devices')} />
        <Card testId="k-collected" label="Collected this month" value={m(kpi.collectedThisMonth)} icon={CircleDollarSign} tone="success" />
        <Card testId="k-outstanding" label="Outstanding" value={m(kpi.outstanding)} icon={HandCoins} tone={kpi.outstanding ? 'danger' : 'neutral'} hint="Open invoices, not yet paid" onClick={() => onGo('reports')} />
        <Card testId="k-online" label="Devices online now" value={String(kpi.devicesOnline)} icon={Wifi} tone="info" hint="Seen in the last 5 minutes" onClick={() => onGo('monitor')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Waiting for approval" description={waiting.total ? `${waiting.total} restaurant${waiting.total === 1 ? '' : 's'}, longest wait first` : undefined}>
          {waiting.rows.length === 0 ? (
            <EmptyState className="border-0 bg-transparent py-8" title="Nobody is waiting" description="New restaurants that need approval appear here." />
          ) : (
            <ul className="divide-y" data-testid="waiting-list">
              {waiting.rows.map(r => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', TONE_CLASS.warning)}><UserCheck className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{r.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{r.email || 'No e-mail on file'} · since {when(r.createdMs)}</span>
                  </span>
                  <button type="button" onClick={() => onApprove(r.id)} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] font-bold text-primary hover:bg-primary/10">Approve</button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Renewals due" description={renewals.total ? `Expired, or ending within 14 days (${renewals.total})` : undefined}>
          {renewals.rows.length === 0 ? (
            <EmptyState className="border-0 bg-transparent py-8" title="No renewals due" description="Plans that expire within 14 days appear here." />
          ) : (
            <ul className="divide-y" data-testid="renewals-list">
              {renewals.rows.map(r => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{r.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{r.plan ? `${r.plan} · ` : ''}{r.badge === 'expired' ? `expired ${Math.abs(r.days)} day${Math.abs(r.days) === 1 ? '' : 's'} ago` : `ends ${when(r.expiresAt)} (${r.days} day${r.days === 1 ? '' : 's'})`}</span>
                  </span>
                  <span className={cn('rounded-full px-2.5 py-1 text-[11.5px] font-bold', badge[r.badge][1])}>{badge[r.badge][0]}</span>
                  <button type="button" onClick={() => onOpenBilling(r.id)} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] font-bold text-primary hover:bg-primary/10">Invoice</button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <p className="text-[12px] text-muted-foreground">
        Not shown on purpose: the sales each restaurant rang up today. That lives in each restaurant's own data, and the console does not read it.
      </p>

      <Dialog open={pick} onOpenChange={setPick}>
        <DialogContent className="sm:max-w-md" data-testid="invoice-picker">
          <DialogHeader><DialogTitle>New invoice — which restaurant?</DialogTitle></DialogHeader>
          <select value={chosen} onChange={e => setChosen(e.target.value)} aria-label="Restaurant" className="h-10 w-full rounded-lg border bg-background px-3 text-[14px]">
            <option value="">Choose a restaurant…</option>
            {tenants.slice().sort((a, b) => a.name.localeCompare(b.name)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            type="button"
            disabled={!chosen}
            onClick={() => { setPick(false); onOpenBilling(chosen); setChosen(''); }}
            className="h-10 rounded-lg bg-primary text-[14px] font-bold text-primary-foreground disabled:opacity-50"
          >
            Open billing
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

