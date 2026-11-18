// The "Day sheet" tab of Production (v1.115.1): what the bakery planned, made, sold and had left, one branch and one day at a time.
// The baker adds each tray as it comes out (+6, +12, or a typed figure) and counts what is left on the shelf at closing; sold comes from
// the day's bills; the gap says how many pieces are neither on the shelf nor sold. Saved as one small synced document per branch and day.
import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, FilterBar } from '@/components/layout/PageFrame';
import { getBranches, getCurrentUser, getMenuItems, getOrders, getProductionSheets, saveProductionSheet } from '@/lib/store';
import { userHasFeature } from '@/lib/permissions';
import { scopeToBranch } from '@/lib/cashierScope';
import { buildPlan, localDay, soldOn } from '@/lib/productionPlan';
import { addItem, addMade, reconcile, setLine, sheetFromPlan, sheetId, totals, type ProductionSheet } from '@/lib/productionSheet';
import ReportActions from '@/components/ReportActions';
import type { ReportDoc } from '@/lib/reportExport';
import { cn } from '@/lib/utils';

const sameSheet = (a: ProductionSheet | null, b: ProductionSheet | null) => JSON.stringify(a?.lines ?? null) === JSON.stringify(b?.lines ?? null);

export default function ProductionSheetPanel() {
  const orders = useMemo(() => scopeToBranch(getOrders()), []);
  const items = useMemo(() => getMenuItems().filter(m => m.isActive !== false && m.pricingType !== 'weight'), []);
  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false), []);
  const [day, setDay] = useState(() => localDay(new Date()));
  const [branch, setBranch] = useState<string>(branches[0]?.id ?? '');
  const branchId = branches.length > 0 ? branch : undefined;

  const stored = useMemo(() => getProductionSheets().find(s => s.id === sheetId(day, branchId)) ?? null, [day, branchId]);
  const [sheet, setSheet] = useState<ProductionSheet | null>(stored);
  const [saved, setSaved] = useState<ProductionSheet | null>(stored);
  useEffect(() => { setSheet(stored); setSaved(stored); }, [stored]);

  const planItems = useMemo(() => items.map(m => ({ id: m.id, name: m.name, categoryId: m.categoryId, pricingType: m.pricingType })), [items]);
  const sold = useMemo(() => soldOn(orders, planItems, day, branchId), [orders, planItems, day, branchId]);
  const rows = useMemo(() => (sheet ? reconcile(sheet.lines, sold) : []), [sheet, sold]);
  const tot = totals(rows);
  const canEdit = userHasFeature(getCurrentUser(), 'feat.prod.edit');
  const dirty = !!sheet && !sameSheet(sheet, saved);

  const start = () => {
    const plan = buildPlan({
      orders: branchId ? orders.filter(o => o.branchId === branchId) : orders, items: planItems,
      target: new Date(`${day}T12:00:00`), weeks: 4, bufferPct: 10, branchIds: branchId ? [branchId] : undefined,
    });
    const col = branchId ?? 'all';
    setSheet(sheetFromPlan(day, branchId, plan.rows.map(r => ({ itemId: r.itemId, name: r.name, qty: r.forecast[col] ?? 0 })), getCurrentUser()?.name));
  };
  const save = () => {
    if (!sheet) return;
    const next = { ...sheet, updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || sheet.updatedBy };
    saveProductionSheet(next);
    setSaved(next); setSheet(next);
    toast.success('Day sheet saved');
  };
  const reportDoc = (): ReportDoc => ({
    title: 'Production day sheet', subtitle: day, filename: `production-sheet-${day}`,
    meta: [...(branchId ? [{ label: 'Branch', value: branches.find(b => b.id === branchId)?.name ?? '' }] : []), ...(tot.wastePct !== null ? [{ label: 'Unsold', value: `${tot.wastePct}%` }] : [])],
    columns: [{ key: 'item', label: 'Item' }, ...['planned:Planned', 'made:Made', 'sold:Sold', 'unsold:Unsold', 'left:Left on shelf', 'gap:Gap'].map(x => ({ key: x.split(':')[0], label: x.split(':')[1], align: 'right' as const }))],
    rows: rows.map(r => ({ item: r.name, planned: r.planned, made: r.made, sold: r.sold, unsold: r.unsold, left: r.leftover ?? '', gap: r.gap ?? '' })),
    totals: { planned: tot.planned, made: tot.made, sold: tot.sold, unsold: tot.unsold, gap: tot.counted > 0 ? tot.gap : '' },
    notes: ['Unsold = made − sold. Gap = unsold − what was counted on the shelf.'],
  });
  const notOnSheet = items.filter(m => !sheet?.lines.some(l => l.menuItemId === m.id));

  return (
    <div className="space-y-4" data-day-sheet>
      <FilterBar label="Day sheet">
        <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">Day
          <Input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="w-40" data-sheet-date />
        </label>
        {branches.length > 0 && (
          <label className="grid gap-1 text-[11px] font-bold text-muted-foreground">Branch
            <select value={branch} onChange={e => setBranch(e.target.value)} data-sheet-branch>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
        <div className="ml-auto flex items-end gap-2">
          {sheet && <ReportActions build={reportDoc} />}
          {sheet && <Button size="sm" onClick={save} disabled={!dirty || !canEdit} title={canEdit ? undefined : 'Ask an admin for the right to edit the production sheet'} data-sheet-save>Save sheet</Button>}
        </div>
      </FilterBar>

      {!sheet ? (
        <div data-sheet-empty>
          <EmptyState icon={<Plus />} title="No sheet for this day yet" hint="Start it from the plan — the planned figures are filled in from the same weekday’s sales — then add each tray as it comes out of the oven."
            action={<Button size="sm" onClick={start} data-sheet-start>Start the sheet</Button>} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm" data-sheet-summary>
            <Badge variant="secondary">Made {tot.made}</Badge>
            <Badge variant="outline">Sold {tot.sold}</Badge>
            <Badge variant="outline" data-sheet-waste>{tot.wastePct === null ? 'Unsold —' : `Unsold ${tot.wastePct}%`}</Badge>
            {tot.counted > 0 && <Badge variant={tot.gap > 0 ? 'destructive' : 'secondary'} data-sheet-gap>{tot.gap > 0 ? `${tot.gap} pieces unaccounted` : tot.gap < 0 ? `${-tot.gap} more on the shelf than expected` : 'Everything accounted for'}</Badge>}
            {saved && <span className="text-[11px] text-muted-foreground">Saved {new Date(saved.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{saved.updatedBy ? ` by ${saved.updatedBy}` : ''}</span>}
          </div>

          <Table data-sheet-table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Made</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Unsold</TableHead>
                <TableHead className="text-right">Left on shelf</TableHead>
                <TableHead className="text-right">Gap</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.itemId} data-sheet-row={r.itemId}>
                  <TableCell className="font-semibold">{r.name}{r.wastePct !== null && r.wastePct > 0 && <span className="ml-2 text-[11px] font-normal text-muted-foreground">{r.wastePct}% unsold</span>}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.planned}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {[6, 12].map(n => <Button key={n} size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={() => sheet && setSheet(addMade(sheet, r.itemId, n))} data-sheet-add={`${r.itemId}|${n}`} aria-label={`Add ${n} ${r.name}`}>+{n}</Button>)}
                      <Input type="number" min={0} value={r.made} aria-label={`Made ${r.name}`} data-sheet-made={r.itemId} className="w-20 text-right font-bold tabular-nums"
                        onChange={e => sheet && setSheet(setLine(sheet, r.itemId, { made: Number(e.target.value) }))} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.sold}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.unsold < 0 && 'text-muted-foreground')}>{r.unsold}</TableCell>
                  <TableCell className="text-right">
                    <Input type="number" min={0} value={r.leftover ?? ''} placeholder="—" aria-label={`Left on shelf ${r.name}`} data-sheet-left={r.itemId} className="ml-auto w-20 text-right tabular-nums"
                      onChange={e => sheet && setSheet(setLine(sheet, r.itemId, { leftover: e.target.value === '' ? null : Number(e.target.value) }))} />
                  </TableCell>
                  <TableCell className={cn('text-right font-bold tabular-nums', r.gap !== null && r.gap > 0 && 'text-destructive')} data-sheet-gap-cell>{r.gap === null ? '' : r.gap > 0 ? `+${r.gap}` : r.gap}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">All items</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{tot.planned}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{tot.made}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{tot.sold}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{tot.unsold}</TableCell>
                <TableCell />
                <TableCell className="text-right font-bold tabular-nums">{tot.counted > 0 ? tot.gap : ''}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>

          {notOnSheet.length > 0 && (
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">Add an item to the sheet
              <select value="" onChange={e => { const m = items.find(i => i.id === e.target.value); if (m && sheet) setSheet(addItem(sheet, m.id, m.name)); }} data-sheet-additem>
                <option value="">Choose…</option>
                {notOnSheet.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          )}
          <p className="text-[11px] text-muted-foreground">
            Unsold = made − sold. Gap = unsold − what you counted on the shelf: the pieces that were wasted, given away or miscounted. Sold comes from this branch’s bills for the day (weighed items are not planned here).
          </p>
        </>
      )}
    </div>
  );
}
