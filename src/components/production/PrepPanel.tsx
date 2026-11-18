// The "Prep & batches" tab of Production (v1.117.0): how the things a bakery keeps in stock are made (dough, a sauce, a filling, a finished
// croissant), and the act of making a batch — raw materials leave stock, the made item enters it at what it really cost.
import { useMemo, useState } from 'react';
import { ChefHat, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SearchableSelect from '@/components/SearchableSelect';
import { EmptyState } from '@/components/layout/PageFrame';
import ReportActions from '@/components/ReportActions';
import type { ReportDoc } from '@/lib/reportExport';
import { money } from '@/lib/currency';
import { adjustStock, deletePrepRecipe, genId, openStockLot, getBranches, getCurrentUser, getInventory, getPrepRecipes, getProductionBatches, receiveProducedStock, savePrepRecipe, saveProductionBatch } from '@/lib/store';
import { userHasFeature } from '@/lib/permissions';
import { RECIPE_UNITS, getBaseUnit } from '@/lib/units';
import { batchesForQty, planBatch, postBatch, prepCostPerUnit, prepIssues, recentBatches, type PrepRecipe } from '@/lib/prep';
import { localDay } from '@/lib/productionPlan';
import type { InventoryItem, RecipeComponent } from '@/lib/types';

const blank = (): PrepRecipe => ({ id: '', outputItemId: '', yieldQty: 1, yieldUnit: 'kg', components: [], updatedAt: '' });
// small costs (a gram of dough, a spoon of yeast) need their paisa: two decimals here, whatever the currency's own rule
const m2 = (n: number) => money(Math.round(n * 100) / 100, { decimals: 2 });
const qtyText = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('en-PK');

export default function PrepPanel() {
  const [version, setVersion] = useState(0);
  const inventory = useMemo<InventoryItem[]>(() => getInventory().filter(i => i.isActive !== false), [version]);
  const preps = useMemo(() => getPrepRecipes(), [version]);
  const batches = useMemo(() => getProductionBatches(), [version]);
  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false), []);
  const me = getCurrentUser();
  const canEdit = userHasFeature(me, 'feat.prod.edit');
  const byId = useMemo(() => new Map(inventory.map(i => [i.id, i])), [inventory]);

  const [edit, setEdit] = useState<PrepRecipe | null>(null);
  const [make, setMake] = useState<PrepRecipe | null>(null);
  const [qty, setQty] = useState('');
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);

  // ------------------------------------------------------------------ the editor
  const issues = edit ? prepIssues(edit, inventory, preps) : [];
  const setComp = (i: number, patch: Partial<RecipeComponent>) => setEdit(e => e && { ...e, components: e.components.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const save = () => {
    if (!edit || issues.length) return;
    const made = byId.get(edit.outputItemId)!;
    const rec: PrepRecipe = { ...edit, id: edit.outputItemId, components: edit.components.filter(c => c.inventoryItemId), updatedAt: new Date().toISOString(), updatedBy: me?.name };
    savePrepRecipe(rec);
    toast.success(`${made.name} can now be made in batches`);
    setEdit(null); setVersion(v => v + 1);
  };
  const remove = () => {
    if (!edit || !edit.id) return;
    deletePrepRecipe(edit.id);
    toast.success('Prep recipe removed — batches already made stay in the history');
    setEdit(null); setVersion(v => v + 1);
  };

  // ------------------------------------------------------------------ making a batch
  const madeItem = make ? byId.get(make.outputItemId) : undefined;
  const nBatches = make ? batchesForQty(make, madeItem, Number(qty) || 0, make.yieldUnit) : 0;
  const plan = make ? planBatch(make, nBatches, inventory) : null;
  const openMake = (p: PrepRecipe) => { setMake(p); setQty(String(p.yieldQty)); setNote(''); };
  const post = () => {
    if (!make || !plan || plan.batches <= 0 || posting) return;
    setPosting(true);
    try {
      const id = genId();
      const done = postBatch(plan, { id, date: localDay(new Date()), branchId: branches.length > 0 ? branchId : undefined, note, by: me?.name, now: new Date(), shelfLifeDays: make.shelfLifeDays }, {
        consume: (itemId, baseQty, n, movementId, refId) => adjustStock(itemId, baseQty, 'out', n, { movementId, refType: 'production', refId }),
        produce: (itemId, baseQty, unitCost, n, movementId, refId) => receiveProducedStock(itemId, baseQty, unitCost, n, movementId, refId),
      });
      if (!done) { toast.error('Nothing to make — check the quantity'); return; }
      saveProductionBatch(done);
      if (done.expiryDate) openStockLot({ inventoryItemId: done.outputItemId, expiryDate: done.expiryDate, qty: done.outputBaseQty, unitCost: done.unitCost, source: 'production', refId: done.id, receivedAt: done.date });
      toast.success(`${qtyText(done.outputBaseQty)} ${done.outputUnit} of ${done.outputName} made — ${m2(done.totalCost)}`);
      setMake(null); setVersion(v => v + 1);
    } finally { setPosting(false); }
  };

  const history = recentBatches(batches, { limit: 15 });
  const reportDoc = (): ReportDoc => ({
    title: 'Production batches', subtitle: `Last ${history.length} batches`, filename: 'production-batches',
    columns: [{ key: 'date', label: 'Date' }, { key: 'item', label: 'Made' }, { key: 'qty', label: 'Quantity', align: 'right' }, { key: 'cost', label: 'Cost', align: 'right' }, { key: 'unit', label: 'Per unit', align: 'right' }],
    rows: history.map(b => ({ date: b.date, item: b.outputName, qty: `${qtyText(b.outputBaseQty)} ${b.outputUnit}`, cost: m2(b.totalCost), unit: m2(Math.round(b.unitCost * 100) / 100) })),
    totals: { cost: m2(history.reduce((s, b) => s + b.totalCost, 0)) },
  });

  return (
    <div className="space-y-4" data-prep-panel>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">A prep item (dough, a sauce, a filling) is made from raw material and kept in stock. Make a batch and the raw material leaves stock, the prep item enters it at its real cost. Then use it as an ingredient in the menu recipes.</p>
        {canEdit && <Button size="sm" onClick={() => setEdit(blank())} data-prep-new><Plus className="mr-1 h-3.5 w-3.5" /> New prep recipe</Button>}
      </div>

      {preps.length === 0 ? (
        <EmptyState icon={<ChefHat />} title="No prep recipes yet" hint="Add one for dough, a sauce or a filling — say what goes in and how much comes out." />
      ) : (
        <Table data-prep-table>
          <TableHeader><TableRow><TableHead>Made item</TableHead><TableHead className="text-right">One batch makes</TableHead><TableHead className="text-right">Cost per unit</TableHead><TableHead className="text-right">In stock</TableHead><TableHead className="w-44" /></TableRow></TableHeader>
          <TableBody>
            {preps.map(p => {
              const made = byId.get(p.outputItemId);
              const bad = prepIssues(p, inventory, preps);
              return (
                <TableRow key={p.id} data-prep-row={p.id}>
                  <TableCell className="font-semibold">{made?.name ?? 'Item removed from stock'} {bad.length > 0 && <Badge variant="destructive" className="ml-1 text-[10px]">Needs attention</Badge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.yieldQty} {p.yieldUnit}</TableCell>
                  <TableCell className="text-right tabular-nums">{made ? `${m2(Math.round(prepCostPerUnit(p, inventory) * 100) / 100)}/${p.yieldUnit}` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{made ? `${qtyText(Number(made.quantity) || 0)} ${getBaseUnit(made)}` : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" className="mr-1" disabled={!canEdit || bad.length > 0} onClick={() => openMake(p)} data-prep-make={p.id}>Make a batch</Button>
                    <Button size="icon" variant="ghost" aria-label={`Edit ${made?.name ?? 'prep recipe'}`} onClick={() => setEdit(p)} data-prep-edit={p.id}><Pencil className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Batches made</h3>
        <div className="ml-auto"><ReportActions build={reportDoc} disabled={history.length === 0} /></div>
      </div>
      {history.length === 0 ? <p className="text-sm text-muted-foreground" data-prep-no-history>No batch made yet.</p> : (
        <Table data-prep-history>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Made</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Per unit</TableHead><TableHead>By</TableHead></TableRow></TableHeader>
          <TableBody>
            {history.map(b => (
              <TableRow key={b.id} data-batch-row={b.id}>
                <TableCell>{b.date}{b.branchId ? ` · ${branches.find(x => x.id === b.branchId)?.name ?? ''}` : ''}</TableCell>
                <TableCell className="font-semibold">{b.outputName}{b.shortOf && <Badge variant="outline" className="ml-1 text-[10px]" title={`Stock was short of ${b.shortOf.join(', ')}`}>Short of {b.shortOf.length}</Badge>}</TableCell>
                <TableCell className="text-right tabular-nums">{qtyText(b.outputBaseQty)} {b.outputUnit}</TableCell>
                <TableCell className="text-right tabular-nums">{m2(b.totalCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{m2(Math.round(b.unitCost * 100) / 100)}</TableCell>
                <TableCell>{b.by ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* ---------------------------------------------------------------- editor */}
      <Dialog open={!!edit} onOpenChange={o => !o && setEdit(null)}>
        <DialogContent className="max-w-2xl" data-prep-editor>
          <DialogHeader><DialogTitle>{edit?.id ? 'Prep recipe' : 'New prep recipe'}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2">
                <label className="col-span-12 text-xs font-semibold sm:col-span-6">Makes (a stock item)
                  {edit.id
                    ? <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-semibold" data-prep-made>{byId.get(edit.outputItemId)?.name ?? 'Item removed from stock'}</div>
                    : <SearchableSelect placeholder="Choose the item…" searchPlaceholder="Search stock…" value={edit.outputItemId}
                        onChange={v => { const it = byId.get(v); setEdit({ ...edit, outputItemId: v, yieldUnit: it ? getBaseUnit(it) : edit.yieldUnit }); }}
                        options={inventory.filter(i => !preps.some(p => p.id === i.id)).map(i => ({ value: i.id, label: i.name, hint: getBaseUnit(i) }))} triggerClassName="h-9" />}
                </label>
                <label className="col-span-6 text-xs font-semibold sm:col-span-3">One batch makes
                  <Input type="number" min="0" step="0.01" value={edit.yieldQty || ''} onChange={e => setEdit({ ...edit, yieldQty: parseFloat(e.target.value) || 0 })} className="h-9" data-prep-yield />
                </label>
                <label className="col-span-6 text-xs font-semibold sm:col-span-3">Unit
                  <Select value={edit.yieldUnit} onValueChange={v => setEdit({ ...edit, yieldUnit: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{RECIPE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
              </div>
              <div className="space-y-2">
                <div className="flex items-center"><h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Goes into one batch</h4>
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEdit({ ...edit, components: [...edit.components, { inventoryItemId: '', quantity: 0, unit: 'g' }] })} data-prep-add-ingredient><Plus className="mr-1 h-3.5 w-3.5" /> Ingredient</Button></div>
                {edit.components.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No ingredients added yet.</p>}
                {edit.components.map((c, i) => {
                  const ing = byId.get(c.inventoryItemId);
                  return (
                    <div key={i} className="grid grid-cols-12 items-center gap-2 rounded bg-accent/20 p-2" data-prep-ingredient={i}>
                      <div className="col-span-6"><SearchableSelect placeholder="Ingredient…" searchPlaceholder="Search ingredient…" value={c.inventoryItemId}
                        onChange={v => { const it = byId.get(v); setComp(i, { inventoryItemId: v, unit: it ? getBaseUnit(it) : c.unit }); }}
                        options={inventory.filter(x => x.id !== edit.outputItemId).map(x => ({ value: x.id, label: x.name, hint: `${m2(Math.round((x.avgCostPrice ?? x.costPrice ?? 0) * 100) / 100)}/${getBaseUnit(x)}` }))} triggerClassName="h-9" /></div>
                      <div className="col-span-3"><Input type="number" min="0" step="0.01" value={c.quantity || ''} placeholder="Qty" onChange={e => setComp(i, { quantity: parseFloat(e.target.value) || 0 })} className="h-9" aria-label={`Quantity of ${ing?.name ?? 'ingredient'}`} /></div>
                      <div className="col-span-2"><Select value={c.unit} onValueChange={v => setComp(i, { unit: v })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{RECIPE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></div>
                      <Button size="icon" variant="ghost" className="col-span-1" aria-label="Remove ingredient" onClick={() => setEdit({ ...edit, components: edit.components.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-12 gap-2">
                <label className="col-span-12 text-xs font-semibold sm:col-span-4">Keeps for (days)
                  <Input type="number" min="0" step="1" value={edit.shelfLifeDays ?? ''} placeholder="Optional" onChange={e => setEdit({ ...edit, shelfLifeDays: parseInt(e.target.value, 10) > 0 ? parseInt(e.target.value, 10) : undefined })} className="h-9" data-prep-shelf />
                </label>
                <label className="col-span-12 text-xs font-semibold sm:col-span-8">Notes
                  <Input value={edit.notes ?? ''} onChange={e => setEdit({ ...edit, notes: e.target.value })} className="h-9" placeholder="Oven, proving time…" />
                </label>
              </div>
              {edit.outputItemId && issues.length === 0 && (
                <p className="rounded bg-muted/50 p-2 text-sm" data-prep-cost>One batch costs <b>{m2(planBatch(edit, 1, inventory).totalCost)}</b> — <b>{m2(Math.round(prepCostPerUnit(edit, inventory) * 100) / 100)}</b> per {edit.yieldUnit}, from today's ingredient costs.</p>
              )}
              {issues.length > 0 && edit.outputItemId && <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive" data-prep-issues>{issues.map(m => <li key={m}>{m}</li>)}</ul>}
            </div>
          )}
          <DialogFooter className="gap-2">
            {edit?.id && <Button variant="ghost" className="mr-auto text-destructive" onClick={remove} data-prep-delete>Remove</Button>}
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={save} disabled={issues.length > 0} data-prep-save>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- make a batch */}
      <Dialog open={!!make} onOpenChange={o => !o && setMake(null)}>
        <DialogContent className="max-w-xl" data-prep-make-dialog>
          <DialogHeader><DialogTitle>Make {madeItem?.name ?? 'a batch'}</DialogTitle></DialogHeader>
          {make && plan && (
            <div className="space-y-3">
              <div className="grid grid-cols-12 items-end gap-2">
                <label className="col-span-6 text-xs font-semibold">How much to make ({make.yieldUnit})
                  <Input type="number" min="0" step="0.01" value={qty} onChange={e => setQty(e.target.value)} className="h-9" data-prep-qty />
                </label>
                {branches.length > 1 && (
                  <label className="col-span-6 text-xs font-semibold">Branch
                    <select value={branchId} onChange={e => setBranchId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-prep-branch>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                  </label>
                )}
              </div>
              <Table data-prep-plan>
                <TableHeader><TableRow><TableHead>Raw material</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">In stock</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {plan.lines.map(l => (
                    <TableRow key={l.itemId} data-plan-line={l.itemId} className={l.short > 0 ? 'bg-destructive/10' : undefined}>
                      <TableCell>{l.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyText(l.baseQty)} {l.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyText(l.available)} {l.unit}{l.short > 0 && <span className="ml-1 font-bold text-destructive" data-plan-short>short {qtyText(l.short)}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{m2(l.cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm" data-prep-result>Makes <b>{qtyText(plan.outputBaseQty)} {plan.outputUnit}</b> of {plan.outputName} for <b>{m2(plan.totalCost)}</b> ({m2(Math.round(plan.unitCost * 100) / 100)} per {plan.outputUnit}).</p>
              {plan.shortCount > 0 && <p className="text-sm text-destructive" data-prep-short-note>Stock is short of {plan.shortCount} raw material{plan.shortCount > 1 ? 's' : ''}. You can still post: the shortage is flagged for review, stock never goes below zero.</p>}
              {plan.warnings.length > 0 && <p className="text-xs text-muted-foreground">{plan.warnings.join(' · ')}</p>}
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className="h-9" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMake(null)}>Cancel</Button>
            <Button onClick={post} disabled={!plan || plan.batches <= 0 || posting} data-prep-post>Post the batch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
