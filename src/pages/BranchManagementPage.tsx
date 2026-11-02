// ============================================================
// BRANCH MANAGEMENT (v1.87.0) — every branch, A to Z, for the owner (desktop; the Owner app has the same panels)
//
//   cards:  live now · money taken · target · open bills · stock (low) · tills online · stock on the road
//   detail: Overview · Stock · Staff · Tills · Targets · Transfers · Info
//   below:  every stock transfer between branches
//
// It adds no new tables: branches, orders, inventory, users and devices are the existing records; transfers and targets
// are documents in the existing document store. Figures come from lib/ownerApp.ts (the Owner Management arithmetic),
// branch rules from lib/branchHub.ts. Who sees which branch is the database's branch access, as everywhere.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, Building2, Circle, MapPin, Pencil, Truck } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { getBranchTargets, getBranches, getInventory, getOrders, getStockTransfers } from '@/lib/store';
import { authorizedBranchIds, hasAllBranchAccess, isBranchAllowed, loadBranchAccess } from '@/lib/branchAccess';
import { PRESETS, branchFigures, ofBranch, paymentSplit, rangeOf, typeSplit, type RangePreset } from '@/lib/ownerApp';
import { branchStock, liveStatus, targetFor, targetProgress, type DeviceRow } from '@/lib/branchHub';
import { loadDevices } from '@/lib/branchCloud';
import { ownerAppAccess } from '@/lib/ownerAccess';
import { cn } from '@/lib/utils';
import { rs, useLiveTick } from '@/components/owner/ownerHooks';
import { BranchStaffPanel, BranchStockPanel, BranchTargetsPanel, BranchTillsPanel } from '@/components/branches/BranchPanels';
import { TransferList } from '@/components/branches/Transfers';

type Tab = 'overview' | 'stock' | 'staff' | 'tills' | 'targets' | 'transfers' | 'info';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'stock', label: 'Stock' }, { id: 'staff', label: 'Staff' }, { id: 'tills', label: 'Tills' },
  { id: 'targets', label: 'Targets' }, { id: 'transfers', label: 'Transfers' }, { id: 'info', label: 'Info' },
];
const ago = (iso: string | null) => {
  if (!iso) return 'no bills yet';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'last bill just now' : m < 60 ? `last bill ${m} min ago` : m < 1440 ? `last bill ${Math.round(m / 60)} h ago` : `last bill ${Math.round(m / 1440)} d ago`;
};

export default function BranchManagementPage() {
  const navigate = useNavigate();
  const tick = useLiveTick(['orders', 'branches', 'inventory', 'stockTransfers', 'branchTargets']);
  const [preset, setPreset] = useState<RangePreset>('today');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [, setAccess] = useState(0);
  useEffect(() => { void loadBranchAccess().then(() => setAccess(x => x + 1)); }, []);
  useEffect(() => { void loadDevices().then(r => setDevices(r.ok ? r.rows : [])); }, []);
  const { user, can } = useMemo(() => ownerAppAccess(), []);
  const showUnassigned = hasAllBranchAccess() || authorizedBranchIds() === null;

  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false && isBranchAllowed(b.id)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const orders = useMemo(() => getOrders(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const inventory = useMemo(() => getInventory(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const transfers = useMemo(() => getStockTransfers(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const targets = useMemo(() => getBranchTargets(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rows } = useMemo(() => branchFigures(orders, branches, rangeOf(preset), { allowed: isBranchAllowed, showUnassigned: false }), [orders, branches, preset]);
  const byId = new Map(rows.map(r => [r.id, r] as const));
  const now = Date.now();
  const current = selected && branches.some(b => b.id === selected) ? selected : null;
  const caps = { can: (id: string) => isBranchAllowed(id), stock: can('inventory'), by: user?.name || '' };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 md:p-6" data-testid="branch-management">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[26px] font-extrabold tracking-tight"><Building2 className="h-6 w-6 text-primary" /> Branch Management</h1>
          <p className="text-[13px] text-muted-foreground">Every branch, A to Z — live now, takings and targets, stock, staff, tills, and stock moving between branches.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Period" className="inline-flex flex-wrap gap-0.5 rounded-xl bg-muted p-1">
            {PRESETS.map(p => (
              <button key={p.id} type="button" role="tab" aria-selected={preset === p.id} onClick={() => setPreset(p.id)}
                className={cn('h-8 rounded-[9px] px-3 text-[13px] font-semibold', preset === p.id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{p.label}</button>
            ))}
          </div>
          {can('branch-performance') && <button type="button" onClick={() => navigate('/branch-performance')} className="inline-flex h-10 items-center gap-2 rounded-[10px] border bg-card px-3 text-[13px] font-semibold"><BarChart3 className="h-4 w-4" /> Compare</button>}
          {can('branches') && <button type="button" onClick={() => navigate('/branches')} className="inline-flex h-10 items-center gap-2 rounded-[10px] border bg-card px-3 text-[13px] font-semibold"><Pencil className="h-4 w-4" /> Edit branches</button>}
        </div>
      </div>

      {branches.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center text-[14px] text-muted-foreground">No branches yet — add them in Settings → Branches.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="branch-cards">
          {branches.map(b => {
            const f = byId.get(b.id);
            const live = liveStatus(orders, devices || [], b.id, now);
            const stock = branchStock(inventory, b.id);
            const t = targetFor(targets, b.id);
            const tp = preset === 'today' ? targetProgress(f?.revenue || 0, t?.daily, 'daily') : preset === 'month' ? targetProgress(f?.revenue || 0, t?.monthly, 'monthly') : null;
            const incoming = transfers.filter(x => x.status === 'in_transit' && x.toBranchId === b.id).length;
            const outgoing = transfers.filter(x => x.status === 'in_transit' && x.fromBranchId === b.id).length;
            return (
              <button key={b.id} type="button" onClick={() => { setSelected(b.id); setTab('overview'); }} data-testid={`branch-card-${b.id}`}
                className={cn('flex flex-col items-stretch justify-start rounded-[var(--ui-radius-card,1rem)] border bg-card p-5 text-left shadow-sm transition-shadow hover:shadow-md', current === b.id && 'ring-2 ring-primary/40')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-bold">{b.name}</div>
                    <div className="truncate text-[12.5px] text-muted-foreground">{[b.city, ago(live.lastBillAt)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-bold', live.live ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground')}>
                    <Circle className={cn('h-2 w-2', live.live ? 'fill-green-600 text-green-600' : 'fill-current')} /> {live.live ? 'Live' : 'Quiet'}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="min-w-0"><div className="text-[12px] text-muted-foreground">Money taken</div><div className="truncate text-[19px] font-extrabold tabular-nums">{rs(f?.revenue || 0)}</div></div>
                  <div><div className="text-[12px] text-muted-foreground">Bills</div><div className="text-[19px] font-extrabold tabular-nums">{f?.bills || 0}</div></div>
                  <div className="text-right"><div className="text-[12px] text-muted-foreground">Open now</div><div className={cn('text-[19px] font-extrabold tabular-nums', (f?.openNow || 0) > 0 && 'text-amber-700')}>{f?.openNow || 0}</div></div>
                </div>
                {tp && (
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', tp.onTrack ? 'bg-green-600' : 'bg-amber-500')} style={{ width: `${Math.min(100, tp.pct)}%` }} /></div>
                    <div className="mt-1 text-[12px] text-muted-foreground">{tp.pct}% of the {preset === 'today' ? 'daily' : 'monthly'} target ({rs(tp.target)}) · {tp.onTrack ? 'on track' : 'behind'}</div>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                  <span>Stock {stock.items}{stock.low > 0 && <b className="text-red-600"> · {stock.low} low</b>}</span>
                  <span>{devices === null ? 'Tills …' : `Tills ${live.devicesOnline}/${live.devicesTotal} online`}</span>
                  {(incoming > 0 || outgoing > 0) && <span className="font-semibold text-amber-700"><Truck className="mr-1 inline h-3.5 w-3.5" />{incoming > 0 && `${incoming} incoming`}{incoming > 0 && outgoing > 0 && ' · '}{outgoing > 0 && `${outgoing} on the way out`}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {current && (() => {
        const b = branches.find(x => x.id === current)!;
        const mine = ofBranch(orders, current);
        const f = byId.get(current);
        const range = rangeOf(preset);
        return (
          <section className="space-y-4 rounded-[var(--ui-radius-card,1rem)] border bg-card p-5 shadow-sm" data-testid="branch-detail" data-section-card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[19px] font-extrabold">{b.name}</h2>
              <button type="button" onClick={() => setSelected(null)} className="text-[13px] font-semibold text-muted-foreground hover:text-foreground">Close</button>
            </div>
            <div role="tablist" aria-label="Branch" className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
              {TABS.map(x => (
                <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
                  className={cn('h-8 rounded-[9px] px-3 text-[13px] font-semibold', tab === x.id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{x.label}</button>
              ))}
            </div>
            {tab === 'overview' && (
              <div className="grid gap-4 lg:grid-cols-3" data-testid="branch-overview">
                <div className="grid grid-cols-2 gap-3 lg:col-span-1">
                  {[['Money taken', rs(f?.revenue || 0)], ['Bills', String(f?.bills || 0)], ['Still owed', rs(f?.owed || 0)], ['Void / cancelled', String(f?.voided || 0)]].map(([l, v]) => (
                    <div key={l} className="rounded-2xl border p-3"><div className="text-[12px] text-muted-foreground">{l}</div><div className="truncate text-[20px] font-extrabold tabular-nums">{v}</div></div>
                  ))}
                </div>
                {[['How it was paid', paymentSplit(mine, range)], ['Order types', typeSplit(mine, range)]].map(([title, list]) => (
                  <div key={title as string} className="rounded-2xl border p-4">
                    <div className="mb-2 text-[13px] font-semibold text-muted-foreground">{title as string}</div>
                    {(list as ReturnType<typeof paymentSplit>).length === 0 ? <div className="text-[13.5px] text-muted-foreground">No sales in this period</div> : (
                      <ul className="space-y-2">{(list as ReturnType<typeof paymentSplit>).map(s => (
                        <li key={s.key}><div className="flex justify-between text-[14px]"><span>{s.name}</span><span className="tabular-nums text-muted-foreground">{rs(s.amount)} · {s.pct}%</span></div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${s.pct}%` }} /></div></li>
                      ))}</ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            {tab === 'stock' && <BranchStockPanel branchId={current} />}
            {tab === 'staff' && <BranchStaffPanel branchId={current} />}
            {tab === 'tills' && <BranchTillsPanel branchId={current} />}
            {tab === 'targets' && <BranchTargetsPanel branchId={current} canEdit={can('branches')} by={user?.name || ''} />}
            {tab === 'transfers' && <TransferList caps={caps} branchId={current} />}
            {tab === 'info' && (
              <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2" data-testid="branch-info">
                {[['Address', b.address], ['City', b.city], ['Phone', b.phone], ['E-mail', b.email], ['Branch code', b.branchCode], ['Invoice prefix', b.invoicePrefix],
                  ['Tax number', b.taxNumber], ['Delivery radius', b.serviceRadiusKm ? `${b.serviceRadiusKm} km` : '']].map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3 border-b py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v || '—'}</dd></div>
                ))}
                <div className="flex flex-wrap gap-2 pt-2 sm:col-span-2">
                  {b.lat != null && b.lng != null && <a href={`https://www.google.com/maps?q=${b.lat},${b.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold"><MapPin className="h-4 w-4" /> Open on the map</a>}
                  {can('branches') && <button type="button" onClick={() => navigate('/branches')} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold"><Pencil className="h-4 w-4" /> Edit in Branches</button>}
                </div>
              </dl>
            )}
          </section>
        );
      })()}

      {branches.length > 1 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground"><Truck className="h-4 w-4" /> Stock between branches</h2>
          <TransferList caps={caps} />
        </section>
      )}
      {showUnassigned && rows.length > 0 && (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <ArrowRight className="h-3.5 w-3.5" /> Bills saved without a branch are shown in Owner Management under “No branch recorded”.
        </p>
      )}
    </div>
  );
}
