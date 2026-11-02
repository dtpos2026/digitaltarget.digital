// ============================================================
// OWNER APP — Sales report (OWN-11), v1.86.0
//
// The numbers an owner checks every night: the period's money taken against the period before, a bar per day (or
// hour, or month) and the best sellers — the same revenue timestamp as the Windows reports, so the two agree.
// ============================================================
import { useMemo, useState } from 'react';
import { Bar as RBar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { getBranches, getMenuItems, getOrders } from '@/lib/store';
import { UNASSIGNED, ofBranch, presetLabel, salesReport, type RangePreset } from '@/lib/ownerApp';
import { salesReportPdf, shareOrDownload } from '@/lib/ownerPdf';
import { tileHue, tileInitials } from '@/lib/tileLook';
import { cn } from '@/lib/utils';
import { Card, Empty, IconButton, Label, PresetChips, ScreenHeader } from './ownerUi';
import { rs, useBranchVisibility, useLiveTick } from './ownerHooks';

export function OwnerReports() {
  const tick = useLiveTick(['orders', 'menuItems']);
  const vis = useBranchVisibility();
  const [preset, setPreset] = useState<RangePreset>('week');
  const [branchId, setBranchId] = useState('all');
  const [busy, setBusy] = useState(false);
  const branches = useMemo(() => getBranches().filter(b => vis.allowed(b.id)), [tick, vis.showUnassigned]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(() => {
    const visible = getOrders().filter(o => (o.branchId ? vis.allowed(String(o.branchId)) : vis.showUnassigned));
    return salesReport(ofBranch(visible, branchId), preset, new Date(), getMenuItems());
  }, [tick, preset, branchId, vis.showUnassigned]); // eslint-disable-line react-hooks/exhaustive-deps
  const branchName = branchId === 'all' ? undefined : branchId === UNASSIGNED ? 'No branch recorded' : branches.find(b => b.id === branchId)?.name;
  const last = report.bars.length - 1;

  const exportPdf = async () => {
    setBusy(true);
    try {
      const blob = await salesReportPdf(report, preset, rs, branchName);
      const r = await shareOrDownload(blob, `sales-${preset}.pdf`, `Sales — ${presetLabel(preset)}`);
      if (r === 'downloaded') toast.success('Report saved as PDF');
    } catch { toast.error('Could not make the PDF on this device'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="owner-reports">
      <ScreenHeader title="Reports" right={<IconButton label={busy ? 'Preparing…' : 'Export PDF'} onClick={() => { if (!busy) void exportPdf(); }}><Share2 className="h-5 w-5" /></IconButton>} />
      <PresetChips value={preset} onChange={setPreset} />
      {branches.length > 1 && (
        <select value={branchId} onChange={e => setBranchId(e.target.value)} aria-label="Branch" className="h-11 w-full rounded-xl border bg-card px-3 text-[15px] font-semibold">
          <option value="all">All branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          {vis.showUnassigned && <option value={UNASSIGNED}>No branch recorded</option>}
        </select>
      )}

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13.5px] text-muted-foreground">{presetLabel(preset)}{branchName ? ` · ${branchName}` : ''}</div>
            <div className="truncate text-[28px] font-extrabold tabular-nums tracking-tight" data-testid="own-report-total">{rs(report.total)}</div>
            <div className="text-[13px] text-muted-foreground">{report.bills} bill{report.bills === 1 ? '' : 's'} · before: {rs(report.prevTotal)}</div>
          </div>
          {report.pct !== null && report.pct !== 0 && (
            <span data-testid="own-report-change" className={cn('shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold', report.pct > 0 ? 'bg-[hsl(var(--own-ok-bg))] text-[hsl(var(--own-ok))]' : 'bg-[hsl(var(--own-bad-bg))] text-[hsl(var(--own-bad))]')}>
              {report.pct > 0 ? '▲' : '▼'} {Math.abs(report.pct)}%
            </span>
          )}
        </div>
        {report.total === 0 ? <div className="mt-3"><Empty>No sales in this period</Empty></div> : (
          <div className="mt-3 h-[150px]" data-testid="own-report-bars">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.bars} margin={{ top: 6, right: 0, left: 0, bottom: 0 }} barCategoryGap="22%">
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <Tooltip formatter={(v: number) => rs(v)} cursor={{ fill: 'hsl(var(--muted))' }} />
                <RBar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                  {report.bars.map((b, i) => <Cell key={b.key} fill={i === last ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.45)'} />)}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div>
        <Label>Top items</Label>
        {report.top.length === 0 ? <Empty>No items sold in this period</Empty> : (
          <div className="space-y-2.5" data-testid="own-report-top">
            {report.top.map(t => (
              <Card key={t.key} className="flex items-center gap-3 py-3.5">
                {t.image
                  ? <img src={t.image} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                  : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[13px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, hsl(${tileHue(t.name)} 75% 52%), hsl(${tileHue(t.name)} 70% 38%))` }}>{tileInitials(t.name)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] font-bold">{t.name}</div>
                  <div className="text-[13px] text-muted-foreground">{t.qty} sold</div>
                </div>
                <div className="shrink-0 text-[15px] font-extrabold tabular-nums">{rs(t.amount)}</div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
