// ============================================================================
// v1.64.0 — Owner Management   ·   v1.86.0 — the design package's desktop layout (06-owner-app, OWN-04 desktop)
//
// REQUESTED: "ak owner kelyi app hoga, apka manage kr sky, or web b ho uska",
// and "multi branch wala b check krna ky data wgara owner me show ho konsi
// bransh ye fla, a to z".
//
// WHAT THIS IS FOR, and why it is a separate screen rather than another
// report: the POS answers "what is happening at this till, right now". An
// owner is asking something different — "which of my branches is actually
// earning, and what is tied up". Those are different questions and they want
// different shapes, which is why the branch breakdown is the FIRST thing on
// the page rather than a dropdown to hunt for.
//
// It is deliberately READ-ONLY. An owner looking at last week's numbers must
// not be one mis-click from editing a bill; the POS already owns that.
//
// v1.86.0 — every figure now comes from lib/ownerApp.ts (branchFigures), which the Owner app on the phone uses too,
// so the two can never disagree. That module builds on src/lib/sales.ts — the same helpers the POS, Reports and Day
// Close use. One correction came with it: "still owed" counted every bill of the period that was not fully paid,
// including bills still open on the floor (they are "open now", not owed); it is now the unpaid part of part-paid
// and credit bills, as the label always said.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clock, Receipt, ShoppingBag, Smartphone, TrendingUp, Wallet } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { getOrders, getBranches, getSettings, getUsers } from '@/lib/store';
import { authorizedBranchIds, hasAllBranchAccess, isBranchAllowed, loadBranchAccess } from '@/lib/branchAccess';
import { visiblePagesForUser } from '@/lib/permissions';
import { money } from '@/lib/currency';
import { PRESETS, branchFigures, rangeOf, type RangePreset } from '@/lib/ownerApp';
import type { Order } from '@/lib/types';
import { cn } from '@/lib/utils';

const rs = (n: number) => money(Math.round(n));

export default function OwnerManagementPage() {
  const navigate = useNavigate();
  // Read once: this is a report over a point in time, so a stable snapshot is
  // also the more correct thing to render. (Same lesson as the CRM page, which
  // re-read the store on every render and stalled.)
  const [allOrders] = useState<Order[]>(() => getOrders());
  const [branches]  = useState(() => getBranches());
  const [preset, setPreset] = useState<RangePreset>('today');
  const [, setAccessLoaded] = useState(0);
  useEffect(() => { void loadBranchAccess().then(() => setAccessLoaded(x => x + 1)); }, []);
  const showUnassigned = hasAllBranchAccess() || authorizedBranchIds() === null;

  // A branch that took nothing still gets a card; bills with no branch are shown under "No branch recorded", never
  // added to one branch (lib/ownerApp.ts branchFigures).
  const { rows, totals } = useMemo(
    () => branchFigures(allOrders, branches, rangeOf(preset), { allowed: isBranchAllowed, showUnassigned }),
    [allOrders, branches, preset, showUnassigned],
  );
  const settings = getSettings();
  const canPhone = (() => {
    try {
      const user = getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || ''));
      return visiblePagesForUser(user, !!settings.costTrackingEnabled, settings, { branchCount: branches.length }).some(p => p.key === 'owner-app');
    } catch { return false; }
  })();
  const nameOf = (r: (typeof rows)[number]) => (r.unassigned && branches.length === 0 ? settings.name || 'Your restaurant' : r.name);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 md:p-6" data-testid="owner-management">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">Owner Management</h1>
          <p className="text-[13px] text-muted-foreground">Every branch side by side — what came in, what is still owed, what is open.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Period" className="inline-flex flex-wrap items-center gap-0.5 rounded-xl bg-muted p-1">
            {PRESETS.map(p => (
              <button key={p.id} type="button" role="tab" aria-selected={preset === p.id} onClick={() => setPreset(p.id)}
                className={cn('h-8 rounded-[9px] px-3.5 text-[13px] font-semibold transition-colors', preset === p.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {p.label}
              </button>
            ))}
          </div>
          {canPhone && (
            <button type="button" onClick={() => navigate('/owner-app')} className="inline-flex h-10 items-center gap-2 rounded-[10px] border bg-card px-3.5 text-[13px] font-semibold hover:border-primary/40" title="The same figures, laid out for a phone">
              <Smartphone className="h-4 w-4" /> Phone view
            </button>
          )}
        </div>
      </div>

      {/* ---- the whole business, in one line ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={<TrendingUp className="h-4 w-4" />} label="Money taken" value={rs(totals.revenue)} tone="green" id="revenue" />
        <Stat icon={<Receipt className="h-4 w-4" />}     label="Bills"        value={String(totals.bills)} id="bills" />
        <Stat icon={<Wallet className="h-4 w-4" />}      label="Still owed"   value={rs(totals.owed)} tone={totals.owed > 0 ? 'amber' : undefined} id="owed" />
        <Stat icon={<Clock className="h-4 w-4" />}       label="Open now"     value={String(totals.openNow)} tone={totals.openNow > 0 ? 'amber' : undefined} id="open" />
        <Stat icon={<AlertCircle className="h-4 w-4" />} label="Void / cancelled" value={String(totals.voided)} tone={totals.voided > 0 ? 'red' : undefined} id="void" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[var(--ui-radius-card,1rem)] border bg-card p-8 text-center text-sm text-muted-foreground">
          No branches set up yet — add them in Settings → Branches.
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">By branch</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="owner-branch-cards">
            {rows.map(r => (
              <div key={r.id} data-section-card className="space-y-3 rounded-[var(--ui-radius-card,1rem)] border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-[15px] font-bold">{nameOf(r)}</div>
                  {r.openNow > 0 && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-bold text-amber-800">{r.openNow} open now</span>}
                </div>
                <div className="grid grid-cols-[1.4fr_0.8fr_1fr] gap-2">
                  <div className="min-w-0"><div className="text-[12.5px] text-muted-foreground">Money taken</div><div className="truncate text-[21px] font-extrabold tabular-nums">{rs(r.revenue)}</div></div>
                  <div><div className="text-[12.5px] text-muted-foreground">Bills</div><div className="text-[21px] font-extrabold tabular-nums">{r.bills}</div></div>
                  <div className="min-w-0 text-right"><div className="text-[12.5px] text-muted-foreground">Still owed</div><div className={cn('truncate text-[21px] font-extrabold tabular-nums', r.owed > 0 && 'text-amber-700')}>{rs(r.owed)}</div></div>
                </div>
                {/* Share of the business, so one branch carrying the rest is obvious without doing the arithmetic. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${r.share}%` }} /></div>
                <div className="text-[12.5px] text-muted-foreground">
                  {r.share}% of the business{r.bills > 0 && ` · avg ${rs(r.avgBill)}`}{r.voided > 0 && ` · ${r.voided} void / cancelled`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
        <ShoppingBag className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Figures use the same calculations as the POS, Reports and Day Close, so they agree with the till — and with
          the Owner app on the phone. “Money taken” counts paid bills and part-payments; “still owed” is the unpaid part
          of part-paid and credit bills (a bill still open on the floor is “open now”). Void, complimentary and
          cancelled bills are counted separately and never added to takings.
        </span>
      </p>
    </div>
  );
}

function Stat({ icon, label, value, tone, id }: { icon: React.ReactNode; label: string; value: string; tone?: 'green' | 'amber' | 'red'; id: string }) {
  const toneClass = tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-red-600' : '';
  return (
    <div data-stat-card data-testid={`owner-kpi-${id}`} className="rounded-[var(--ui-radius-card,1rem)] border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">{icon} {label}</div>
      <div className={cn('mt-1 truncate text-[22px] font-extrabold tabular-nums', toneClass)}>{value}</div>
    </div>
  );
}
