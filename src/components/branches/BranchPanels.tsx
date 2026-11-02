// ============================================================
// BRANCH MANAGEMENT — panels shared by the desktop Branch Management page and the Owner app (v1.87.0)
//
// Stock, staff, tills and targets of one branch. Every panel reads the records the rest of the software uses; the
// staff and till lists come from the cloud (lib/branchCloud.ts) and say so when they cannot load.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Circle, MonitorSmartphone, Search, Target, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { getBranchTargets, getInventory, getOrders, saveBranchTarget } from '@/lib/store';
import { branchItems, branchStock, costOf, isOnline, parseTarget, staffOf, targetFor, targetProgress, type DeviceRow, type StaffRow } from '@/lib/branchHub';
import { loadDevices, loadStaff, type CloudList } from '@/lib/branchCloud';
import { branchFigures, rangeOf } from '@/lib/ownerApp';
import { cn } from '@/lib/utils';
import { rs, useLiveTick } from '@/components/owner/ownerHooks';

const box = 'rounded-2xl border bg-card';
const ago = (iso?: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return 'never';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

function useCloud<T>(load: (force?: boolean) => Promise<CloudList<T>>): [CloudList<T> | null, () => void] {
  const [state, setState] = useState<CloudList<T> | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { let off = false; void load(n > 0).then(v => { if (!off) setState(v); }); return () => { off = true; }; }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, () => setN(x => x + 1)];
}

function Problem({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
      <span>{text}</span>
      <button type="button" onClick={retry} className="shrink-0 rounded-full border border-amber-300 bg-white px-3 py-1 text-[13px] font-semibold">Retry</button>
    </div>
  );
}

/** What the branch holds: low stock first, then everything, with value at cost. */
export function BranchStockPanel({ branchId }: { branchId: string }) {
  const tick = useLiveTick(['inventory']);
  const [q, setQ] = useState('');
  const items = useMemo(() => branchItems(getInventory(), branchId), [tick, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = useMemo(() => branchStock(getInventory(), branchId), [tick, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = items
    .filter(i => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()))
    .map(i => ({ i, low: Number(i.quantity) <= Number(i.lowStockThreshold || 0) }))
    .sort((a, b) => Number(b.low) - Number(a.low) || a.i.name.localeCompare(b.i.name));
  return (
    <div className="space-y-3" data-testid="branch-stock">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className={cn(box, 'p-3')}><div className="text-[12px] text-muted-foreground">Items</div><div className="text-[20px] font-extrabold tabular-nums">{sum.items}</div></div>
        <div className={cn(box, 'p-3 sm:order-last')}><div className="text-[12px] text-muted-foreground">Low</div><div className={cn('text-[20px] font-extrabold tabular-nums', sum.low > 0 && 'text-red-600')}>{sum.low}</div></div>
        <div className={cn(box, 'col-span-2 p-3 sm:col-span-1')}><div className="text-[12px] text-muted-foreground">Value at cost</div><div className="truncate text-[20px] font-extrabold tabular-nums">{rs(sum.value)}</div></div>
      </div>
      {items.length > 6 && (
        <label className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search stock" aria-label="Search stock" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
        </label>
      )}
      {items.length === 0 ? <div className="rounded-2xl border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">No stock recorded for this branch yet.</div> : (
        <ul className={cn(box, 'divide-y')}>
          {rows.slice(0, 200).map(({ i, low }) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
              {low && <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-label="Low stock" />}
              <span className="min-w-0 flex-1 truncate font-semibold">{i.name}</span>
              <span className={cn('shrink-0 tabular-nums', low ? 'font-bold text-red-600' : 'text-muted-foreground')}>{Number(i.quantity) || 0}{low && ` / ${i.lowStockThreshold}`} {i.baseUnit || i.unit}</span>
              <span className="hidden w-24 shrink-0 text-right tabular-nums text-muted-foreground sm:block">{rs((Number(i.quantity) || 0) * costOf(i))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Who works at the branch, and who works across every branch. */
export function BranchStaffPanel({ branchId }: { branchId: string }) {
  const [state, retry] = useCloud<StaffRow>(loadStaff);
  if (!state) return <div className="py-6 text-center text-[14px] text-muted-foreground">Loading staff…</div>;
  if (!state.ok) return <Problem text={state.error} retry={retry} />;
  const { assigned, everywhere } = staffOf(state.rows, branchId);
  const Row = ({ s }: { s: StaffRow }) => (
    <li className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
      <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className={cn('min-w-0 flex-1 truncate font-semibold', !s.active && 'text-muted-foreground line-through')}>{s.name}</span>
      <span className="shrink-0 capitalize text-muted-foreground">{s.role.replace('_', ' ')}{!s.active && ' · inactive'}</span>
    </li>
  );
  return (
    <div className="space-y-3" data-testid="branch-staff">
      <div className="text-[13px] font-semibold text-muted-foreground">Assigned to this branch ({assigned.length})</div>
      {assigned.length === 0 ? <div className="rounded-2xl border border-dashed px-4 py-5 text-center text-[14px] text-muted-foreground">Nobody is assigned to this branch. Assign staff in Users (Assigned branch).</div>
        : <ul className={cn(box, 'divide-y')}>{assigned.map(s => <Row key={s.id} s={s} />)}</ul>}
      {everywhere.length > 0 && (
        <>
          <div className="text-[13px] font-semibold text-muted-foreground">Work across all branches ({everywhere.length})</div>
          <ul className={cn(box, 'divide-y')}>{everywhere.map(s => <Row key={s.id} s={s} />)}</ul>
        </>
      )}
    </div>
  );
}

/** The branch's tills and phones: online now (seen in the last 5 minutes) or when they were last seen. */
export function BranchTillsPanel({ branchId }: { branchId: string }) {
  const [state, retry] = useCloud<DeviceRow>(loadDevices);
  if (!state) return <div className="py-6 text-center text-[14px] text-muted-foreground">Loading tills…</div>;
  if (!state.ok) return <Problem text={state.error} retry={retry} />;
  const now = Date.now();
  const mine = state.rows.filter(d => String(d.branchId || '') === branchId)
    .sort((a, b) => Number(isOnline(b, now)) - Number(isOnline(a, now)) || a.label.localeCompare(b.label));
  return (
    <div className="space-y-3" data-testid="branch-tills">
      {mine.length === 0 ? <div className="rounded-2xl border border-dashed px-4 py-5 text-center text-[14px] text-muted-foreground">No device is registered to this branch.</div> : (
        <ul className={cn(box, 'divide-y')}>
          {mine.map(d => {
            const on = isOnline(d, now);
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
                <MonitorSmartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-semibold">{d.label}{d.platform ? <span className="font-normal text-muted-foreground"> · {d.platform}</span> : null}</span>
                <span className={cn('flex shrink-0 items-center gap-1.5', on ? 'font-semibold text-green-700' : 'text-muted-foreground')}>
                  <Circle className={cn('h-2.5 w-2.5', on ? 'fill-green-600 text-green-600' : 'fill-muted-foreground/40 text-muted-foreground/40')} />
                  {d.blocked ? 'Blocked' : d.approved === false ? 'Waiting for approval' : on ? 'Online' : `Seen ${ago(d.lastSeenAt)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Today and this month against the branch's targets; the owner sets them here. */
export function BranchTargetsPanel({ branchId, canEdit, by }: { branchId: string; canEdit: boolean; by: string }) {
  const tick = useLiveTick(['orders', 'branchTargets']);
  const [version, bump] = useState(0);
  const target = useMemo(() => targetFor(getBranchTargets(), branchId), [tick, version, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const orders = useMemo(() => getOrders(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = useMemo(() => branchFigures(orders, [{ id: branchId, name: '' }], rangeOf('today'), { allowed: id => id === branchId }).totals.revenue, [orders, branchId]);
  const month = useMemo(() => branchFigures(orders, [{ id: branchId, name: '' }], rangeOf('month'), { allowed: id => id === branchId }).totals.revenue, [orders, branchId]);
  const [daily, setDaily] = useState(target?.daily ? String(target.daily) : '');
  const [monthly, setMonthly] = useState(target?.monthly ? String(target.monthly) : '');
  useEffect(() => { setDaily(target?.daily ? String(target.daily) : ''); setMonthly(target?.monthly ? String(target.monthly) : ''); }, [target?.daily, target?.monthly]);
  const d = targetProgress(today, target?.daily, 'daily');
  const m = targetProgress(month, target?.monthly, 'monthly');
  const save = () => {
    const dv = parseTarget(daily), mv = parseTarget(monthly);
    if (dv === null || mv === null) { toast.error('Targets are whole amounts, e.g. 60000 — or leave empty'); return; }
    try {
      saveBranchTarget({ id: branchId, branchId, daily: dv, monthly: mv, updatedAt: new Date().toISOString(), updatedBy: by || undefined });
      bump(x => x + 1);
      toast.success('Targets saved');
    } catch { toast.error('Could not save'); }
  };
  const Progress = ({ label, p, actual }: { label: string; p: ReturnType<typeof targetProgress>; actual: number }) => (
    <div className={cn(box, 'p-4')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        {p && <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-bold', p.onTrack ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800')}>{p.onTrack ? 'On track' : 'Behind'}</span>}
      </div>
      <div className="mt-1 text-[22px] font-extrabold tabular-nums">{rs(actual)}{p && <span className="text-[14px] font-semibold text-muted-foreground"> of {rs(p.target)}</span>}</div>
      {p ? (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', p.onTrack ? 'bg-green-600' : 'bg-amber-500')} style={{ width: `${Math.min(100, p.pct)}%` }} /></div>
          <div className="mt-1 text-[12.5px] text-muted-foreground">{p.pct}%{label.startsWith('This month') ? ` · by today it should be ${rs(p.expected)}` : ''}</div>
        </>
      ) : <div className="mt-1 text-[12.5px] text-muted-foreground">No target set</div>}
    </div>
  );
  return (
    <div className="space-y-3" data-testid="branch-targets">
      <div className="grid gap-3 sm:grid-cols-2">
        <Progress label="Today" p={d} actual={today} />
        <Progress label="This month" p={m} actual={month} />
      </div>
      {canEdit && (
        <div className={cn(box, 'space-y-3 p-4')}>
          <div className="flex items-center gap-2 text-[14px] font-bold"><Target className="h-4 w-4 text-primary" /> Set targets (money taken)</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12.5px] font-semibold text-muted-foreground">Daily
              <input inputMode="numeric" value={daily} onChange={e => setDaily(e.target.value)} placeholder="e.g. 60000" aria-label="Daily target" className="mt-1 h-11 w-full rounded-xl border bg-card px-3 text-[15px] font-semibold tabular-nums text-foreground outline-none" />
            </label>
            <label className="text-[12.5px] font-semibold text-muted-foreground">Monthly
              <input inputMode="numeric" value={monthly} onChange={e => setMonthly(e.target.value)} placeholder="e.g. 1800000" aria-label="Monthly target" className="mt-1 h-11 w-full rounded-xl border bg-card px-3 text-[15px] font-semibold tabular-nums text-foreground outline-none" />
            </label>
          </div>
          <button type="button" onClick={save} className="w-full rounded-xl bg-primary py-2.5 text-[14px] font-bold text-primary-foreground" data-testid="save-targets">Save targets</button>
        </div>
      )}
    </div>
  );
}
