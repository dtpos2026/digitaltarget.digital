// ============================================================
// OWNER APP — Compare branches and Stock transfers (v1.87.0)
//
// Compare: every branch ranked by one measure for a period (the Owner Management figures). Transfers: stock moving
// between branches — send, receive, cancel — the same screens as the desktop Branch Management page.
// ============================================================
import { useMemo, useState } from 'react';
import { useNavigate } from '@/lib/hash-router';
import { getBranches, getOrders } from '@/lib/store';
import { COMPARE_MEASURES as MEASURES, branchFigures, rangeOf, rankBranches, type CompareMeasure as Measure, type RangePreset } from '@/lib/ownerApp';
import { cn } from '@/lib/utils';
import { TransferList, type TransferCaps } from '@/components/branches/Transfers';
import { Card, Empty, PresetChips, ScreenHeader } from './ownerUi';
import { OWNER_BASE, rs, useBranchVisibility, useLiveTick } from './ownerHooks';

export function OwnerCompare() {
  const navigate = useNavigate();
  const tick = useLiveTick(['orders', 'branches']);
  const vis = useBranchVisibility();
  const [preset, setPreset] = useState<RangePreset>('week');
  const [measure, setMeasure] = useState<Measure>('revenue');
  const rows = useMemo(() => {
    const { rows: all } = branchFigures(getOrders(), getBranches().filter(b => b.isActive !== false), rangeOf(preset), { allowed: vis.allowed, showUnassigned: false });
    return rankBranches(all, measure);
  }, [tick, preset, measure, vis.showUnassigned]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = MEASURES.find(x => x.id === measure)!;
  const max = Math.max(1, ...rows.map(r => r[measure]));
  return (
    <div className="space-y-3" data-testid="owner-compare">
      <ScreenHeader title="Compare branches" back={OWNER_BASE} />
      <PresetChips value={preset} onChange={setPreset} />
      <div role="tablist" aria-label="Measure" className="own-scroll-x -mx-4 flex gap-2 px-4 pb-1">
        {MEASURES.map(x => <button key={x.id} type="button" role="tab" aria-selected={measure === x.id} data-own-chip onClick={() => setMeasure(x.id)}>{x.label}</button>)}
      </div>
      {rows.length < 2 ? <Empty>Comparing needs two or more branches.</Empty> : (
        <div className="space-y-2.5" data-testid="own-compare-list">
          {rows.map((r, i) => (
            <button key={r.id} type="button" onClick={() => navigate(`${OWNER_BASE}/branch/${encodeURIComponent(r.id)}`)} className="block w-full text-left">
              <Card className="space-y-2 py-3.5">
                <div className="flex items-center gap-3">
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-extrabold', i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[15.5px] font-bold">{r.name}</span>
                  <span className="shrink-0 text-[16px] font-extrabold tabular-nums">{m.money ? rs(r[measure]) : r[measure]}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((r[measure] / max) * 100)}%` }} /></div>
              </Card>
            </button>
          ))}
        </div>
      )}
      <p className="px-1 pb-2 text-[12px] text-muted-foreground">{m.lowerIsBetter ? 'Lowest first — less is better here.' : 'Highest first.'} The same figures as Owner Management; the full comparison (expenses, profit, stock, staff) is Branch Performance on the desktop.</p>
    </div>
  );
}

export function OwnerTransfers({ caps }: { caps: TransferCaps }) {
  return (
    <div className="space-y-3" data-testid="owner-transfers">
      <ScreenHeader title="Stock transfers" back={`${OWNER_BASE}/more`} />
      <TransferList caps={caps} compact />
    </div>
  );
}
