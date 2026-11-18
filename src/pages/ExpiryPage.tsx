// Expiry (v1.117.1) — what is going off, how soon, and what it is worth; write off what has expired. Lots come from receipts and batches
// that carry an expiry date (lib/lots.ts); stock leaves them first-expired-first-out, so what is on the shelf is always the newest.
import { useMemo, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SearchableSelect from '@/components/SearchableSelect';
import ReportActions from '@/components/ReportActions';
import { EmptyState, FilterBar, PageHeader } from '@/components/layout/PageFrame';
import type { ReportDoc } from '@/lib/reportExport';
import { money } from '@/lib/currency';
import { getCurrentUser, getInventory, getStockLots, openStockLot, writeOffExpired, effectiveLotsByItem } from '@/lib/store';
import { userHasFeature } from '@/lib/permissions';
import { getBaseUnit } from '@/lib/units';
import { daysLeft, expiryStatus, lotValue, summarizeLots, type ExpiryStatus } from '@/lib/lots';
import { localDay } from '@/lib/productionPlan';
import { cn } from '@/lib/utils';

type Show = 'all' | 'expired' | 'soon' | 'ok';
const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('en-PK');
const SOURCE: Record<string, string> = { receiving: 'Received', production: 'Batch', opening: 'Counted in' };
const BADGE: Record<ExpiryStatus, { label: (d: number | null) => string; cls: string }> = {
  expired: { label: d => `Expired ${Math.abs(d ?? 0)} day${Math.abs(d ?? 0) === 1 ? '' : 's'} ago`, cls: 'bg-destructive/15 text-destructive' },
  today: { label: () => 'Last day', cls: 'bg-status-warning/20 text-status-warning' },
  soon: { label: d => `${d} day${d === 1 ? '' : 's'} left`, cls: 'bg-status-warning/15 text-status-warning' },
  ok: { label: d => `${d} days left`, cls: 'bg-status-success/15 text-status-success' },
  none: { label: () => 'No date', cls: 'bg-muted text-muted-foreground' },
};

export default function ExpiryPage() {
  const [version, setVersion] = useState(0);
  const today = localDay(new Date());
  const inventory = useMemo(() => getInventory().filter(i => i.isActive !== false), [version]);
  const invMap = useMemo(() => new Map(inventory.map(i => [i.id, i])), [inventory]);
  const lots = useMemo(() => effectiveLotsByItem(getStockLots(), invMap), [invMap, version]);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [soonDays, setSoonDays] = useState(7);
  const [confirm, setConfirm] = useState(false);
  const [add, setAdd] = useState<{ itemId: string; qty: string; expiry: string } | null>(null);
  const me = getCurrentUser();
  const canEdit = userHasFeature(me, 'feat.inv.count');

  const sum = summarizeLots(lots, today, soonDays);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => lots
    .map(l => { const d = daysLeft(l.expiryDate, today); return { lot: l, days: d, status: expiryStatus(d, soonDays) }; })
    .filter(r => (!needle || r.lot.itemName.toLowerCase().includes(needle))
      && (show === 'all' || (show === 'expired' ? r.status === 'expired' : show === 'soon' ? r.status === 'soon' || r.status === 'today' : r.status === 'ok' || r.status === 'none')))
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)), [lots, needle, show, soonDays, today]);

  const expiredValue = sum.expired.value;
  const writeOff = () => {
    const r = writeOffExpired(today, me?.name);
    setConfirm(false); setVersion(v => v + 1);
    if (r.items === 0) toast.error('Nothing has expired'); else toast.success(`${r.items} item${r.items > 1 ? 's' : ''} written off — ${money(r.value)}`);
  };

  const addItem = add ? invMap.get(add.itemId) : undefined;
  const dated = addItem ? lots.filter(l => l.inventoryItemId === addItem.id).reduce((s, l) => s + l.remaining, 0) : 0;
  const room = addItem ? Math.max(0, (Number(addItem.quantity) || 0) - dated) : 0;
  const addQty = Number(add?.qty) || 0;
  const addProblem = !add ? '' : !addItem ? 'Choose the item' : !(addQty > 0) ? 'Say how much' : addQty > room + 1e-9 ? `Only ${qty(room)} ${getBaseUnit(addItem)} of ${addItem.name} is in stock without a date` : !/^\d{4}-\d{2}-\d{2}$/.test(add.expiry) ? 'Pick the expiry date' : '';
  const saveAdd = () => {
    if (!add || !addItem || addProblem) return;
    openStockLot({ inventoryItemId: addItem.id, expiryDate: add.expiry, qty: addQty, unitCost: Number(addItem.avgCostPrice ?? addItem.costPrice) || 0, source: 'opening' });
    toast.success(`${qty(addQty)} ${getBaseUnit(addItem)} of ${addItem.name} dated`);
    setAdd(null); setVersion(v => v + 1);
  };

  const reportDoc = (): ReportDoc => ({
    title: 'Expiry', subtitle: today, filename: `expiry-${today}`,
    meta: [{ label: 'Expired', value: `${sum.expired.lots} · ${money(sum.expired.value)}` }, { label: `Within ${soonDays} days`, value: `${sum.soon.lots + sum.today.lots} · ${money(sum.soon.value + sum.today.value)}` }],
    columns: [{ key: 'item', label: 'Item' }, { key: 'expires', label: 'Expires' }, { key: 'left', label: 'Days left', align: 'right' }, { key: 'remaining', label: 'Remaining', align: 'right' }, { key: 'value', label: 'Value', align: 'right' }],
    rows: rows.map(r => ({ item: r.lot.itemName, expires: r.lot.expiryDate ?? '—', left: r.days === null ? '' : r.days, remaining: `${qty(r.lot.remaining)} ${getBaseUnit(invMap.get(r.lot.inventoryItemId) ?? { unit: '' })}`, value: money(lotValue(r.lot)) })),
    totals: { value: money(rows.reduce((s, r) => s + lotValue(r.lot), 0)) },
  });

  return (
    <div className="space-y-4 p-4 lg:p-6" data-expiry-page>
      <PageHeader icon={<CalendarClock />} title="Expiry" subtitle="What is going off, how soon, and what it is worth — the oldest is used first"
        actions={<>
          <ReportActions build={reportDoc} disabled={rows.length === 0} />
          {canEdit && <Button size="sm" variant="outline" onClick={() => setAdd({ itemId: '', qty: '', expiry: '' })} data-expiry-add><Plus className="mr-1 h-3.5 w-3.5" /> Date existing stock</Button>}
          <Button size="sm" disabled={sum.expired.lots === 0 || !canEdit} title={canEdit ? undefined : 'Ask an admin for the right to write off stock'} onClick={() => setConfirm(true)} data-expiry-writeoff>Write off expired{sum.expired.lots ? ` (${money(expiredValue)})` : ''}</Button>
        </>} />

      <FilterBar label="Expiry filters">
        <Input type="search" placeholder="Search item" aria-label="Search item" value={q} onChange={e => setQ(e.target.value)} data-filter-grow data-expiry-search />
        <select value={soonDays} onChange={e => setSoonDays(Number(e.target.value))} aria-label="Expiring within" data-expiry-window>
          {[3, 7, 14, 30].map(n => <option key={n} value={n}>Expiring within {n} days</option>)}
        </select>
        <div role="group" aria-label="Show" className="flex gap-1.5">
          {(['all', 'expired', 'soon', 'ok'] as const).map(s => (
            <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)} data-expiry-show={s}
              className={cn('h-9 rounded-full border-2 px-3 text-xs font-semibold capitalize', show === s ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50')}>{s === 'soon' ? 'Soon' : s}</button>
          ))}
        </div>
      </FilterBar>

      <div className="flex flex-wrap items-center gap-2 text-sm" data-expiry-summary>
        <Badge variant={sum.expired.lots ? 'destructive' : 'secondary'} data-expiry-expired>Expired {sum.expired.lots} · {money(sum.expired.value)}</Badge>
        <Badge variant="outline" className="text-status-warning" data-expiry-soon>Within {soonDays} days {sum.soon.lots + sum.today.lots} · {money(sum.soon.value + sum.today.value)}</Badge>
        <Badge variant="outline">Fine {sum.ok}</Badge>
      </div>

      {lots.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="No dated stock yet" hint="Put an expiry date on a receipt in Receiving, or on a batch of something made in Production, and it appears here. Stock you already have can be dated with “Date existing stock”." />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing matches" hint="Change the search or the filters above." />
      ) : (
        <>
        <div className="space-y-2 sm:hidden" data-expiry-cards>
          {rows.map(({ lot, days, status }) => (
            <div key={lot.id} data-lot-card={lot.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2"><span className="font-extrabold">{lot.itemName}</span><span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', BADGE[status].cls)}>{BADGE[status].label(days)}</span></div>
              <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Expires <b className="text-foreground">{lot.expiryDate ?? '—'}</b> · {SOURCE[lot.source] ?? lot.source} {lot.receivedAt}</span>
                <span className="whitespace-nowrap tabular-nums"><b>{qty(lot.remaining)} {getBaseUnit(invMap.get(lot.inventoryItemId) ?? { unit: '' })}</b> · {money(lotValue(lot))}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden sm:block">
        <Table data-expiry-table>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Came in</TableHead><TableHead>Expires</TableHead><TableHead>Days left</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(({ lot, days, status }) => (
              <TableRow key={lot.id} data-lot-row={lot.id} data-lot-status={status}>
                <TableCell className="font-semibold">{lot.itemName}</TableCell>
                <TableCell className="whitespace-nowrap">{lot.receivedAt} <span className="text-xs text-muted-foreground">· {SOURCE[lot.source] ?? lot.source}</span></TableCell>
                <TableCell className="whitespace-nowrap">{lot.expiryDate ?? '—'}</TableCell>
                <TableCell className="whitespace-nowrap"><span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', BADGE[status].cls)}>{BADGE[status].label(days)}</span></TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{qty(lot.remaining)} {getBaseUnit(invMap.get(lot.inventoryItemId) ?? { unit: '' })}</TableCell>
                <TableCell className="text-right tabular-nums">{money(lotValue(lot))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        </>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-md" data-expiry-confirm>
          <DialogHeader><DialogTitle>Write off expired stock?</DialogTitle></DialogHeader>
          <p className="text-sm">{sum.expired.lots} lot{sum.expired.lots === 1 ? '' : 's'} worth <b>{money(expiredValue)}</b> will leave stock as wastage (reason: expired). This is recorded in Wastage and cannot be undone here.</p>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="destructive" onClick={writeOff} data-expiry-confirm-writeoff>Write off</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!add} onOpenChange={o => !o && setAdd(null)}>
        <DialogContent className="max-w-md" data-expiry-add-dialog>
          <DialogHeader><DialogTitle>Date stock you already have</DialogTitle></DialogHeader>
          {add && (
            <div className="space-y-3">
              <label className="block text-xs font-semibold">Item
                <SearchableSelect placeholder="Choose the item…" searchPlaceholder="Search stock…" value={add.itemId} onChange={v => setAdd({ ...add, itemId: v })}
                  options={inventory.map(i => ({ value: i.id, label: i.name, hint: `${qty(Number(i.quantity) || 0)} ${getBaseUnit(i)}` }))} triggerClassName="h-9" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold">How much{addItem ? ` (${getBaseUnit(addItem)})` : ''}<Input type="number" min="0" step="0.01" value={add.qty} onChange={e => setAdd({ ...add, qty: e.target.value })} className="h-9" data-expiry-add-qty /></label>
                <label className="text-xs font-semibold">Expires on<Input type="date" value={add.expiry} onChange={e => setAdd({ ...add, expiry: e.target.value })} className="h-9" data-expiry-add-date /></label>
              </div>
              {addProblem && add.itemId && <p className="text-sm text-destructive" data-expiry-add-problem>{addProblem}</p>}
              <p className="text-xs text-muted-foreground">This does not change how much is in stock — it says that part of it goes off on that date.</p>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setAdd(null)}>Cancel</Button><Button onClick={saveAdd} disabled={!!addProblem} data-expiry-add-save>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
