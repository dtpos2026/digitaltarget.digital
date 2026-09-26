// ============================================================================
// v1.64.0 — Owner Management
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
// Every figure comes from src/lib/sales.ts — the same helpers the POS,
// Reports and Day Close use. Writing a second set of totals here is how two
// screens start disagreeing about the day's money, and then nobody trusts
// either one.
// ============================================================================
import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getOrders, getBranches } from '@/lib/store';
import { presetRange, revenueTimestamp, type RangePreset } from '@/lib/salesReport';
import {
  isPaidSale, isPartialSale, paidRevenue, balanceDue, isVoidish, isOpen,
} from '@/lib/sales';
import type { Order } from '@/lib/types';
import {
  Building2, TrendingUp, Receipt, Clock, AlertCircle, Wallet, ShoppingBag,
} from 'lucide-react';

const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week',      label: 'Last 7 days' },
  { id: 'month',     label: 'This month' },
  { id: 'year',      label: 'This year' },
];

interface BranchFigures {
  id: string;
  name: string;
  /** Money actually taken — paid bills plus part-payments on open ones. */
  revenue: number;
  /** Bills that produced that revenue. */
  bills: number;
  /** Still owed on credit / partially-paid bills. */
  outstanding: number;
  /** Bills still open on the floor right now (not date-filtered). */
  openNow: number;
  /** Void / complimentary / cancelled in the period — worth an owner's eye. */
  voided: number;
  avgBill: number;
}

export default function OwnerManagementPage() {
  // Read once: this is a report over a point in time, so a stable snapshot is
  // also the more correct thing to render. (Same lesson as the CRM page, which
  // re-read the store on every render and stalled.)
  const [allOrders] = useState<Order[]>(() => getOrders());
  const [branches]  = useState(() => getBranches());
  const [preset, setPreset] = useState<RangePreset>('today');

  const { rows, totals } = useMemo(() => {
    const { from, to } = presetRange(preset);
    const inPeriod = (o: Order) => {
      const t = Date.parse(revenueTimestamp(o));
      return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime();
    };

    // A branch that exists but took nothing still deserves a row — an empty
    // branch is information, and hiding it reads as "everything is fine".
    const buckets = new Map<string, BranchFigures>();
    const blank = (id: string, name: string): BranchFigures => ({
      id, name, revenue: 0, bills: 0, outstanding: 0, openNow: 0, voided: 0, avgBill: 0,
    });
    for (const b of branches) buckets.set(b.id, blank(b.id, b.name));

    // Orders whose branch was never stamped are shown under their own heading
    // rather than dropped or silently added to one branch. They are usually
    // rows that predate branch stamping, and an owner should see that they
    // exist instead of wondering why the totals do not add up.
    const UNASSIGNED = '__unassigned__';

    const bucketFor = (o: Order): BranchFigures => {
      const id = (o as any).branchId || UNASSIGNED;
      if (!buckets.has(id)) {
        buckets.set(id, blank(id, id === UNASSIGNED ? 'No branch recorded' : 'Unknown branch'));
      }
      return buckets.get(id)!;
    };

    for (const o of allOrders) {
      const b = bucketFor(o);

      // "Open right now" is a floor question, not a date-range one — an owner
      // checking last month still wants to know what is sitting open today.
      if (isOpen(o)) b.openNow += 1;

      if (!inPeriod(o)) continue;

      if (isVoidish(o)) { b.voided += 1; continue; }

      if (isPaidSale(o) || isPartialSale(o)) {
        b.revenue += paidRevenue(o);
        b.bills   += 1;
      }
      const due = balanceDue(o);
      if (due > 0) b.outstanding += due;
    }

    const rows = [...buckets.values()]
      .map(r => ({ ...r, avgBill: r.bills ? r.revenue / r.bills : 0 }))
      .sort((a, b) => b.revenue - a.revenue);

    const totals = rows.reduce((t, r) => ({
      revenue: t.revenue + r.revenue,
      bills: t.bills + r.bills,
      outstanding: t.outstanding + r.outstanding,
      openNow: t.openNow + r.openNow,
      voided: t.voided + r.voided,
    }), { revenue: 0, bills: 0, outstanding: 0, openNow: 0, voided: 0 });

    return { rows, totals };
  }, [allOrders, branches, preset]);

  const best = rows.find(r => r.revenue > 0);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" /> Owner Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Every branch side by side — what came in, what is still owed, what is open.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <Button
              key={p.id}
              size="sm"
              variant={preset === p.id ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ---- the whole business, in one line ---- */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Stat icon={<TrendingUp className="h-4 w-4" />} label="Money taken" value={money(totals.revenue)} tone="green" />
        <Stat icon={<Receipt className="h-4 w-4" />}     label="Bills"        value={String(totals.bills)} />
        <Stat icon={<Wallet className="h-4 w-4" />}      label="Still owed"   value={money(totals.outstanding)} tone={totals.outstanding > 0 ? 'amber' : undefined} />
        <Stat icon={<Clock className="h-4 w-4" />}       label="Open now"     value={String(totals.openNow)} tone={totals.openNow > 0 ? 'amber' : undefined} />
        <Stat icon={<AlertCircle className="h-4 w-4" />} label="Void / cancelled" value={String(totals.voided)} tone={totals.voided > 0 ? 'red' : undefined} />
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No branches set up yet — add them in Settings → Branches.
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            By branch
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map(r => (
              <Card key={r.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold truncate">{r.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.bills} bill{r.bills === 1 ? '' : 's'}
                      {r.bills > 0 && <> · avg {money(r.avgBill)}</>}
                    </div>
                  </div>
                  {best && r.id === best.id && r.revenue > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400 shrink-0">
                      Top
                    </span>
                  )}
                </div>

                <div className="text-2xl font-extrabold">{money(r.revenue)}</div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <Mini label="Still owed" value={money(r.outstanding)} bad={r.outstanding > 0} />
                  <Mini label="Open now"   value={String(r.openNow)}    bad={r.openNow > 0} />
                  <Mini label="Void"       value={String(r.voided)}     bad={r.voided > 0} />
                </div>

                {/* Share of the business, so one branch carrying the rest is
                    obvious without doing the arithmetic. */}
                {totals.revenue > 0 && (
                  <div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.round((r.revenue / totals.revenue) * 100)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {Math.round((r.revenue / totals.revenue) * 100)}% of takings
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <ShoppingBag className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Figures use the same calculations as the POS, Reports and Day Close, so they
          agree with the till. “Money taken” counts paid bills and part-payments;
          “still owed” is the balance on credit and partly-paid bills. Void,
          complimentary and cancelled bills are counted separately and never added
          to takings.
        </span>
      </p>
    </div>
  );
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string;
  tone?: 'green' | 'amber' | 'red';
}) {
  const toneClass =
    tone === 'green' ? 'text-green-600'
    : tone === 'amber' ? 'text-amber-600'
    : tone === 'red' ? 'text-red-600'
    : '';
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={`text-xl font-extrabold mt-1 truncate ${toneClass}`}>{value}</div>
    </Card>
  );
}

function Mini({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/50 py-1.5">
      <div className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold ${bad ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  );
}
