// Stock Count (v1.115.1) — count the shelves, see what differs from the system, value the difference at cost, post it to the stock ledger.
// Built on the shared page frame (header, filter bar, table, empty state) like every screen. The count is kept as a draft on this device,
// so a refresh or a lunch break does not lose it; nothing touches the stock until a manager presses "Post to stock".
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { money } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, FilterBar, PageHeader } from '@/components/layout/PageFrame';
import { adjustStock, genId, getBranches, getCategories, getCurrentUser, getInventory } from '@/lib/store';
import { userHasFeature } from '@/lib/permissions';
import { getTenantId } from '@/lib/tenant';
import { countLines, loadDraft, postCount, saveDraft, summarize, type Adjust } from '@/lib/stockCount';
import ReportActions from '@/components/ReportActions';
import type { ReportDoc } from '@/lib/reportExport';
import { cn } from '@/lib/utils';

type Show = 'all' | 'counted' | 'differences';

export default function StockCountPage() {
  const [tick, setTick] = useState(0);
  const items = useMemo(() => getInventory().filter(i => i.isActive !== false), [tick]);
  const categories = useMemo(() => getCategories(), []);
  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false), []);

  const [branch, setBranch] = useState<string>('all');
  const [cat, setCat] = useState<string>('all');
  const [show, setShow] = useState<Show>('all');
  const [q, setQ] = useState('');
  const scope = `${getTenantId() || 'local'}:${branch}`;
  const [counts, setCounts] = useState<Record<string, string>>(() => loadDraft(scope));
  const [confirm, setConfirm] = useState(false);
  const [sessionId, setSessionId] = useState(genId);
  // posting moves stock, so it is a right of its own (Rights → Actions → Post Stock Count)
  const canPost = userHasFeature(getCurrentUser(), 'feat.inv.count');

  useEffect(() => { setCounts(loadDraft(scope)); }, [scope]);
  useEffect(() => { saveDraft(scope, counts); }, [scope, counts]);

  const inScope = useMemo(() => items.filter(i => (branch === 'all' || !i.branchId || i.branchId === branch) && (cat === 'all' || i.categoryId === cat)), [items, branch, cat]);
  const allLines = useMemo(() => countLines(inScope, counts), [inScope, counts]);
  const byId = new Map(inScope.map(i => [i.id, i]));
  const needle = q.trim().toLowerCase();
  const lines = allLines.filter(l => {
    if (needle && !(l.name.toLowerCase().includes(needle) || (byId.get(l.itemId)?.sku || '').toLowerCase().includes(needle))) return false;
    if (show === 'counted') return l.counted !== null;
    if (show === 'differences') return !!l.diff && Math.abs(l.diff) > 1e-9;
    return true;
  });
  const sum = summarize(allLines);
  const label = new Date().toISOString().slice(0, 10);

  const reportDoc = (): ReportDoc => ({
    title: 'Stock count', subtitle: label, filename: `stock-count-${label}`,
    meta: [...(branch !== 'all' ? [{ label: 'Branch', value: branches.find(b => b.id === branch)?.name ?? '' }] : []), { label: 'Net difference', value: `${sum.net < 0 ? '−' : ''}${money(Math.abs(sum.net))}` }],
    columns: [{ key: 'item', label: 'Item' }, { key: 'unit', label: 'Unit' }, { key: 'system', label: 'In system', align: 'right' }, { key: 'counted', label: 'Counted', align: 'right' }, { key: 'diff', label: 'Difference', align: 'right' }, { key: 'value', label: 'Value', align: 'right' }],
    rows: lines.map(l => ({ item: l.name, unit: l.unit, system: l.expected, counted: l.counted ?? '', diff: l.diff ?? '', value: l.value === null || l.value === 0 ? '' : `${l.value < 0 ? '−' : ''}${money(Math.abs(l.value))}` })),
    totals: { value: `${sum.net < 0 ? '−' : ''}${money(Math.abs(sum.net))}` },
    notes: ['The value is the difference × the item’s cost.'],
  });
  const post = () => {
    if (!canPost) { toast.error('You do not have the right to post a stock count'); return; }
    const live = new Map(getInventory().map(i => [i.id, Number(i.quantity) || 0]));
    const r = postCount(allLines, sessionId, label, id => (live.has(id) ? (live.get(id) as number) : null), adjustStock as unknown as Adjust);
    toast.success(`${r.applied} correction${r.applied === 1 ? '' : 's'} posted${r.duplicates ? ` · ${r.duplicates} already posted` : ''}`);
    setConfirm(false);
    setCounts({});
    setSessionId(genId());
    setTick(t => t + 1);
  };

  return (
    <div className="space-y-4 p-4 lg:p-6" data-stock-count>
      <PageHeader
        icon={<ClipboardCheck />} title="Stock Count" subtitle="Count the shelves, see what differs, post the difference to stock"
        actions={<><ReportActions build={reportDoc} disabled={lines.length === 0} /><Button size="sm" disabled={sum.withDifference === 0 || !canPost} title={canPost ? undefined : 'Ask an admin for the right to post a stock count'} onClick={() => setConfirm(true)} data-count-post>Post to stock{sum.withDifference ? ` (${sum.withDifference})` : ''}</Button></>}
      />

      <FilterBar label="Count filters">
        <Input type="search" placeholder="Search item or SKU" aria-label="Search item or SKU" value={q} onChange={e => setQ(e.target.value)} data-filter-grow data-count-search />
        {branches.length > 1 && (
          <select value={branch} onChange={e => setBranch(e.target.value)} aria-label="Branch" data-count-branch>
            <option value="all">All branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Category" data-count-cat>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div role="group" aria-label="Show" className="flex gap-1.5">
          {(['all', 'counted', 'differences'] as const).map(s => (
            <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)} data-count-show={s}
              className={cn('h-9 rounded-full border-2 px-3 text-xs font-semibold capitalize', show === s ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50')}>{s}</button>
          ))}
        </div>
      </FilterBar>

      <div className="flex flex-wrap items-center gap-2 text-sm" data-count-summary>
        <Badge variant="secondary">{sum.counted} of {allLines.length} counted</Badge>
        <Badge variant="outline">{sum.withDifference} differ</Badge>
        <Badge variant="outline" className="text-status-success" data-count-gains>Gain {money(sum.gains)}</Badge>
        <Badge variant="outline" className="text-destructive" data-count-losses>Loss {money(Math.abs(sum.losses))}</Badge>
        <Badge variant={sum.net < 0 ? 'destructive' : 'secondary'} data-count-net>Net {sum.net < 0 ? '−' : ''}{money(Math.abs(sum.net))}</Badge>
        {Object.keys(counts).length > 0 && <button type="button" onClick={() => setCounts({})} className="text-xs font-semibold text-primary underline" data-count-clear>Clear this count</button>}
      </div>

      {allLines.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="No stock items to count" hint="Add items in Inventory first; they appear here ready to count." />
      ) : lines.length === 0 ? (
        <EmptyState title="Nothing matches" hint="Change the search or the filters above." />
      ) : (
        <Table data-count-table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead><TableHead>Unit</TableHead>
              <TableHead className="text-right">In system</TableHead><TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Difference</TableHead><TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map(l => (
              <TableRow key={l.itemId} data-count-row={l.itemId}>
                <TableCell className="font-semibold">{l.name}<span className="block text-[11px] font-normal text-muted-foreground">{byId.get(l.itemId)?.sku}</span></TableCell>
                <TableCell className="text-muted-foreground">{l.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{l.expected}</TableCell>
                <TableCell className="text-right">
                  <Input type="number" inputMode="decimal" min={0} step="any" value={counts[l.itemId] ?? ''} placeholder="—" aria-label={`Counted ${l.name}`} data-count-input={l.itemId}
                    onChange={e => setCounts(c => { const n = { ...c }; if (e.target.value === '') delete n[l.itemId]; else n[l.itemId] = e.target.value; return n; })}
                    className="ml-auto w-24 text-right font-bold tabular-nums" />
                </TableCell>
                <TableCell className={cn('text-right font-bold tabular-nums', l.diff && l.diff > 0 && 'text-status-success', l.diff && l.diff < 0 && 'text-destructive')} data-count-diff>
                  {l.diff === null ? '' : l.diff > 0 ? `+${l.diff}` : l.diff}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', (l.value ?? 0) < 0 && 'text-destructive')}>{l.value === null || l.value === 0 ? '' : `${l.value < 0 ? '−' : ''}${money(Math.abs(l.value))}`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="font-bold">Net difference</TableCell>
              <TableCell colSpan={2} className={cn('text-right font-bold tabular-nums', sum.net < 0 && 'text-destructive')}>{sum.net < 0 ? '−' : ''}{money(Math.abs(sum.net))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
      <p className="text-[11px] text-muted-foreground">
        Leave a line empty to leave that item alone. After posting, the stock equals what you counted — count while the shop is closed so nothing is sold in between. The value is the difference × the item’s cost.
      </p>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md" data-count-confirm>
          <DialogHeader>
            <DialogTitle>Post {sum.withDifference} correction{sum.withDifference === 1 ? '' : 's'} to stock?</DialogTitle>
            <DialogDescription>Each one is written to the stock ledger with your count as the reason. It cannot be posted twice.</DialogDescription>
          </DialogHeader>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt>Gains</dt><dd className="font-bold text-status-success">{money(sum.gains)}</dd></div>
            <div className="flex justify-between"><dt>Losses</dt><dd className="font-bold text-destructive">{money(Math.abs(sum.losses))}</dd></div>
            <div className="flex justify-between border-t pt-1.5"><dt className="font-bold">Net</dt><dd className="font-extrabold">{sum.net < 0 ? '−' : ''}{money(Math.abs(sum.net))}</dd></div>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Not yet</Button>
            <Button onClick={post} data-count-confirm-post>Post to stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
