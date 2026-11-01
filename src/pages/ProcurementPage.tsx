// ============================================================================
// PROCUREMENT — purchase orders and reorder suggestions (v1.79.0).
//
// A screen over lib/procurement.ts. The rules (who may do what, what can be received, how freight is spread, what is owed) live
// in that tested module; this file collects input and calls it. Stock and cost still move through saveReceivingEntry(), the one
// place that owns the moving average, so a PO receipt and a direct goods-receiving note leave inventory in the same state.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Printer, PackageCheck, Send, CheckCircle2, XCircle, Lightbulb, ShoppingBasket } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { PageHeader, SectionCard, StatusBadge, EmptyState, type Tone } from '@/components/ui-kit';
import { money } from '@/lib/currency';
import {
  getPurchaseOrders, savePurchaseOrder, getInventory, getParties, getReceivingEntries, saveReceivingEntry, addLedgerEntry,
  getCurrentUser, genId, getBranches, getCurrentBranchId, onDataChange,
} from '@/lib/store';
import { getStockLogs } from '@/lib/store';
import { logStaffAction } from '@/lib/staffAudit';
import {
  PO_STATUS_LABEL, canTransition, isEditable, isReceivable, nextPoNumber, lineTotal, lineRemaining, poTotals, validatePo,
  receiveAgainstPo, closeShort, suggestReorders, draftsFromSuggestions, type ReorderSuggestion,
} from '@/lib/procurement';
import { getBaseUnit, unitFactor } from '@/lib/units';
import type { PurchaseOrder, PurchaseOrderLine, PoStatus, InventoryItem } from '@/lib/types';
import { cn } from '@/lib/utils';

const rs = (n: number) => money(Math.round(n).toLocaleString('en-PK'));
const TONE: Record<PoStatus, Tone> = { draft: 'neutral', approved: 'info', sent: 'accent', partial: 'warning', received: 'success', cancelled: 'danger' };
const STATUSES: PoStatus[] = ['draft', 'approved', 'sent', 'partial', 'received', 'cancelled'];

/** Units an item can be bought in: its purchase units first, then its base unit. */
function unitsFor(item: InventoryItem | undefined): string[] {
  if (!item) return [];
  return [...new Set([...(item.conversions || []).map(c => c.unit), getBaseUnit(item)])];
}

export default function ProcurementPage() {
  const [tick, setTick] = useState(0);
  useEffect(() => onDataChange(() => setTick(t => t + 1)), []);
  const refresh = () => setTick(t => t + 1);

  const user = getCurrentUser();
  const role = (typeof localStorage !== 'undefined' && localStorage.getItem('pos-user-role')) || user?.role || '';
  const canApprove = role === 'admin' || role === 'manager';
  const by = user?.name || 'Staff';

  const data = useMemo(() => ({
    orders: getPurchaseOrders(), inventory: getInventory(), parties: getParties(), receiving: getReceivingEntries(), logs: getStockLogs(),
  }), [tick]);
  const suppliers = data.parties.filter(p => p.type === 'supplier' && p.isActive !== false);
  const itemById = useMemo(() => new Map(data.inventory.map(i => [i.id, i])), [data.inventory]);

  const [filter, setFilter] = useState<PoStatus | 'all'>('all');
  const orders = useMemo(() => data.orders.filter(o => filter === 'all' || o.status === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data.orders, filter]);

  // -------- reorder suggestions
  const suggestions = useMemo(() => suggestReorders(data.inventory, data.logs, data.receiving, { nowMs: Date.now() }), [data, tick]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(suggestions.map(s => s.item.id))), [suggestions.length]);

  // -------- editor
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  const blankPo = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
    id: genId(), number: nextPoNumber(getPurchaseOrders()), supplierId: '', supplierName: '', status: 'draft', lines: [],
    branchId: getCurrentBranchId() || undefined, createdAt: new Date().toISOString(), createdBy: by, ...over,
  });

  const persist = (po: PurchaseOrder, action?: Parameters<typeof logStaffAction>[0], reason?: string) => {
    savePurchaseOrder(po);
    if (action) logStaffAction(action, { reason, meta: { po: po.number, supplier: po.supplierName, total: poTotals(po).ordered } });
    refresh();
  };

  const createDrafts = () => {
    const chosen = suggestions.filter(s => picked.has(s.item.id));
    if (!chosen.length) { toast.error('Tick at least one item'); return; }
    const drafts = draftsFromSuggestions(chosen, data.parties, genId);
    let made = 0;
    let existing = getPurchaseOrders();
    for (const d of drafts) {
      const po = blankPo({ number: nextPoNumber(existing), supplierId: d.supplierId, supplierName: d.supplierName, lines: d.lines, notes: 'Created from reorder suggestions' });
      existing = [...existing, po];
      persist(po, 'PO_CREATED');
      made++;
    }
    toast.success(`${made} draft order${made > 1 ? 's' : ''} created — review, approve and send`);
  };

  const setStatus = (po: PurchaseOrder, to: PoStatus) => {
    if (!canTransition(po.status, to)) { toast.error(`A ${PO_STATUS_LABEL[po.status].toLowerCase()} order cannot become ${PO_STATUS_LABEL[to].toLowerCase()}`); return; }
    if ((to === 'approved' || to === 'cancelled') && !canApprove) { toast.error('Only an owner or manager can do that'); return; }
    if (to === 'approved') {
      const problems = validatePo(po);
      if (problems.length) { toast.error(problems[0].message); return; }
    }
    const now = new Date().toISOString();
    const next: PurchaseOrder = { ...po, status: to };
    if (to === 'approved') { next.approvedAt = now; next.approvedBy = by; }
    if (to === 'sent') next.sentAt = now;
    if (to === 'cancelled') { next.cancelledAt = now; next.cancelledBy = by; }
    persist(next, to === 'approved' ? 'PO_APPROVED' : to === 'sent' ? 'PO_SENT' : to === 'cancelled' ? 'PO_CANCELLED' : undefined);
    toast.success(`${po.number}: ${PO_STATUS_LABEL[to]}`);
  };

  // -------- editor helpers
  const patchLine = (id: string, patch: Partial<PurchaseOrderLine>) =>
    setEditing(e => e && ({ ...e, lines: e.lines.map(l => (l.id === id ? { ...l, ...patch } : l)) }));
  const lastRate = (it: InventoryItem, unit: string): number => {
    const f = unitFactor(it, unit) ?? 1;
    const recent = data.receiving.filter(r => r.inventoryItemId === it.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const perBase = recent?.baseUnitCost && recent.baseUnitCost > 0 ? recent.baseUnitCost : (it.avgCostPrice ?? it.costPrice ?? 0);
    return Math.round(perBase * f * 100) / 100;
  };
  const addLine = () => setEditing(e => e && ({ ...e, lines: [...e.lines, { id: genId(), inventoryItemId: '', itemName: '', unit: '', quantity: 1, rate: 0, receivedQty: 0 }] }));
  const pickItem = (lineId: string, itemId: string) => {
    const it = itemById.get(itemId);
    if (!it) return patchLine(lineId, { inventoryItemId: '', itemName: '' });
    const unit = unitsFor(it)[0];
    patchLine(lineId, { inventoryItemId: it.id, itemName: it.name, unit, rate: lastRate(it, unit) });
  };

  const saveEditing = (approve: boolean) => {
    if (!editing) return;
    const isNew = !getPurchaseOrders().some(p => p.id === editing.id);
    const supplier = suppliers.find(s => s.id === editing.supplierId);
    const po = { ...editing, supplierName: supplier?.name || editing.supplierName };
    persist(po, isNew ? 'PO_CREATED' : undefined);
    setEditing(null);
    if (approve) setStatus(po, 'approved'); else toast.success(`${po.number} saved`);
  };

  const printPo = (po: PurchaseOrder) => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { toast.error('Allow pop-ups to print'); return; }
    const t = poTotals(po);
    const rows = po.lines.map(l => `<tr><td>${l.itemName}</td><td>${l.quantity} ${l.unit}</td><td style="text-align:right">${l.rate}</td><td style="text-align:right">${lineTotal(l)}</td></tr>`).join('');
    w.document.write(`<html><head><title>${po.number}</title><style>body{font:14px system-ui;padding:24px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}h1{margin:0}</style></head><body>
      <h1>Purchase Order ${po.number}</h1><p>Supplier: <b>${po.supplierName}</b><br/>Date: ${po.createdAt.slice(0, 10)}${po.expectedDate ? `<br/>Expected: ${po.expectedDate}` : ''}</p>
      <table><thead><tr><th>Item</th><th>Quantity</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3"><b>Total</b></td><td style="text-align:right"><b>${t.ordered}</b></td></tr></tfoot></table>${po.notes ? `<p>${po.notes}</p>` : ''}</body></html>`);
    w.document.close(); w.print();
  };

  const edProblems = editing ? validatePo(editing) : [];

  return (
    <div className="space-y-4 p-4 lg:p-6" data-testid="procurement">
      <PageHeader
        title="Procurement"
        description="Order from suppliers, receive against the order, and see what to buy next."
        actions={<Button size="sm" onClick={() => setEditing(blankPo())}><Plus className="mr-1 h-4 w-4" /> New purchase order</Button>}
      />

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders"><ShoppingBasket className="mr-1.5 h-4 w-4" /> Purchase orders ({data.orders.length})</TabsTrigger>
          <TabsTrigger value="suggest"><Lightbulb className="mr-1.5 h-4 w-4" /> Reorder suggestions ({suggestions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(['all', ...STATUSES] as const).map(s => (
              <button key={s} onClick={() => setFilter(s)} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', filter === s ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent')}>
                {s === 'all' ? 'All' : PO_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <SectionCard title="Orders">
            {orders.length === 0 ? <EmptyState title="No purchase orders" description="Create one, or start from the reorder suggestions." /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Order</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Expected</TableHead>
                  <TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Still to come</TableHead><TableHead />
                </TableRow></TableHeader>
                <TableBody>
                  {orders.map(o => {
                    const t = poTotals(o);
                    return (
                      <TableRow key={o.id} data-po={o.number}>
                        <TableCell className="font-bold">{o.number}</TableCell>
                        <TableCell>{o.supplierName || <span className="text-muted-foreground">— no supplier yet</span>}</TableCell>
                        <TableCell><StatusBadge tone={TONE[o.status]}>{PO_STATUS_LABEL[o.status]}</StatusBadge></TableCell>
                        <TableCell>{o.expectedDate || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{rs(t.ordered)}</TableCell>
                        <TableCell className="text-right tabular-nums">{o.status === 'cancelled' ? '—' : rs(t.outstanding)}</TableCell>
                        <TableCell className="space-x-1 whitespace-nowrap text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>{isEditable(o) ? 'Edit' : 'View'}</Button>
                          {o.status === 'draft' && canApprove && <Button size="sm" variant="outline" onClick={() => setStatus(o, 'approved')}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Approve</Button>}
                          {o.status === 'approved' && <Button size="sm" variant="outline" onClick={() => setStatus(o, 'sent')}><Send className="mr-1 h-3.5 w-3.5" />Mark sent</Button>}
                          {isReceivable(o) && <Button size="sm" onClick={() => setReceiving(o)}><PackageCheck className="mr-1 h-3.5 w-3.5" />Receive</Button>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="suggest">
          <SectionCard
            title="Below their alert level"
            description="Average daily use over the last 30 days; buys up to the alert level plus 7 days of use, in whole packs, from whoever last supplied the item."
            actions={<Button size="sm" onClick={createDrafts} disabled={!suggestions.length}>Create draft orders</Button>}
          >
            {suggestions.length === 0 ? <EmptyState title="Nothing is below its alert level" description="Set an alert level on an inventory item and it appears here when stock runs low." /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-10" /><TableHead>Item</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Alert</TableHead>
                  <TableHead className="text-right">Use / day</TableHead><TableHead className="text-right">Buy</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Value</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {suggestions.map((s: ReorderSuggestion) => (
                    <TableRow key={s.item.id}>
                      <TableCell><Checkbox checked={picked.has(s.item.id)} onCheckedChange={v => setPicked(p => { const n = new Set(p); v ? n.add(s.item.id) : n.delete(s.item.id); return n; })} /></TableCell>
                      <TableCell className="font-semibold">{s.item.name}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', s.onHand <= 0 && 'font-bold text-destructive')}>{s.onHand} {getBaseUnit(s.item)}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.alertLevel}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.avgDailyUse}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{s.suggestedQty} {s.purchaseUnit}</TableCell>
                      <TableCell>{s.supplierName || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{rs(s.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      {/* ---------------- editor ---------------- */}
      <Dialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-3xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">{editing.number} <StatusBadge tone={TONE[editing.status]}>{PO_STATUS_LABEL[editing.status]}</StatusBadge></DialogTitle>
                <DialogDescription>{isEditable(editing) ? 'Add the items you want and the rate you expect to pay. Approve it when it is ready to go.' : 'This order is approved, so its lines are locked: it is what the supplier was told.'}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold text-muted-foreground sm:col-span-2">Supplier
                  <select className="mt-1 block h-9 w-full rounded-md border bg-background px-2 text-sm" disabled={!isEditable(editing)} value={editing.supplierId} onChange={e => setEditing({ ...editing, supplierId: e.target.value, supplierName: suppliers.find(s => s.id === e.target.value)?.name || '' })}>
                    <option value="">Choose a supplier…</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-muted-foreground">Expected on
                  <Input type="date" className="mt-1" disabled={!isEditable(editing)} value={editing.expectedDate || ''} onChange={e => setEditing({ ...editing, expectedDate: e.target.value })} />
                </label>
              </div>
              {suppliers.length === 0 && <p className="text-xs text-[hsl(var(--status-warning))]">No suppliers yet — add one in Party Master (type: supplier).</p>}

              <div className="max-h-[40vh] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-28">Unit</TableHead><TableHead className="w-28">Rate</TableHead><TableHead className="w-28 text-right">Amount</TableHead><TableHead className="w-24 text-right">Received</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
                  <TableBody>
                    {editing.lines.map(l => {
                      const it = itemById.get(l.inventoryItemId);
                      const ro = !isEditable(editing);
                      return (
                        <TableRow key={l.id}>
                          <TableCell>
                            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" disabled={ro} value={l.inventoryItemId} onChange={e => pickItem(l.id, e.target.value)}>
                              <option value="">Choose…</option>
                              {data.inventory.filter(i => i.isActive !== false || i.id === l.inventoryItemId).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                            </select>
                          </TableCell>
                          <TableCell><Input type="number" min={0} step="any" disabled={ro} value={l.quantity} onChange={e => patchLine(l.id, { quantity: Number(e.target.value) })} /></TableCell>
                          <TableCell>
                            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" disabled={ro || !it} value={l.unit} onChange={e => patchLine(l.id, { unit: e.target.value, rate: it ? lastRate(it, e.target.value) : l.rate })}>
                              {unitsFor(it).map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </TableCell>
                          <TableCell><Input type="number" min={0} step="any" disabled={ro} value={l.rate} onChange={e => patchLine(l.id, { rate: Number(e.target.value) })} /></TableCell>
                          <TableCell className="text-right tabular-nums">{rs(lineTotal(l))}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{l.receivedQty || 0}{lineRemaining(l) > 0 && l.receivedQty ? ` / ${l.quantity}` : ''}</TableCell>
                          <TableCell>{!ro && <Button size="icon" variant="ghost" aria-label="Remove line" onClick={() => setEditing({ ...editing, lines: editing.lines.filter(x => x.id !== l.id) })}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {isEditable(editing) && <Button variant="outline" size="sm" onClick={addLine}><Plus className="mr-1 h-4 w-4" /> Add item</Button>}
              <label className="text-xs font-semibold text-muted-foreground">Notes
                <Input className="mt-1" disabled={!isEditable(editing)} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Delivery instructions, payment terms…" />
              </label>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{editing.lines.length} line{editing.lines.length === 1 ? '' : 's'}</span>
                <span className="font-extrabold">Total {rs(poTotals(editing).ordered)}</span>
              </div>
              {isEditable(editing) && edProblems.length > 0 && <ul className="list-disc pl-5 text-xs text-muted-foreground">{edProblems.slice(0, 4).map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
              <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => printPo(editing)} disabled={!editing.lines.length}><Printer className="mr-1 h-4 w-4" /> Print</Button>
                  {!['received', 'cancelled'].includes(editing.status) && getPurchaseOrders().some(p => p.id === editing.id) && canApprove && (
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setStatus(editing, 'cancelled'); setEditing(null); }}><XCircle className="mr-1 h-4 w-4" /> Cancel order</Button>
                  )}
                  {editing.status === 'partial' && canApprove && <Button variant="outline" size="sm" onClick={() => { persist(closeShort(editing, new Date().toISOString(), by)); setEditing(null); toast.success('Closed — nothing more is expected'); }}>Close short</Button>}
                </div>
                {isEditable(editing) && (
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => saveEditing(false)}>Save draft</Button>
                    {canApprove && <Button onClick={() => saveEditing(true)} disabled={edProblems.length > 0}>Save &amp; approve</Button>}
                  </div>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {receiving && <ReceiveDialog po={receiving} inventory={data.inventory} by={by} onClose={() => setReceiving(null)} onDone={refresh} />}
    </div>
  );
}

function ReceiveDialog({ po, inventory, by, onClose, onDone }: { po: PurchaseOrder; inventory: InventoryItem[]; by: string; onClose: () => void; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const [over, setOver] = useState(false);

  const submit = () => {
    const receipts = po.lines.map(l => ({ lineId: l.id, quantity: Number(qty[l.id]) || 0 }));
    const r = receiveAgainstPo(po, receipts, { now: new Date().toISOString(), by, newId: genId, extraCharges: Number(extra) || 0, allowOver: over, inventory });
    if (!r.ok || !r.po) { toast.error(r.error || 'Could not receive'); return; }
    // Stock and moving-average cost move through the same function a direct goods-receiving note uses.
    r.entries.forEach(e => saveReceivingEntry(e));
    if (r.payable && r.payable.amount > 0) {
      addLedgerEntry({ id: genId(), partyId: r.payable.partyId, date: new Date().toISOString(), description: r.payable.description, debit: 0, credit: r.payable.amount, reference: r.payable.reference });
    }
    savePurchaseOrder(r.po);
    logStaffAction('PO_RECEIVED', { reason: `Against ${po.number}`, amount: r.payable?.amount, meta: { po: po.number, supplier: po.supplierName } });
    toast.success(`${po.number}: received${r.po.status === 'received' ? ' in full' : ' (partly)'} · owed to ${po.supplierName}: ${rs(r.payable?.amount || 0)}`);
    onDone(); onClose();
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive goods — {po.number}</DialogTitle>
          <DialogDescription>Enter what actually arrived. Stock and cost update, and the amount is added to what you owe {po.supplierName}.</DialogDescription>
        </DialogHeader>
        <Table>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Still to come</TableHead><TableHead className="w-32">Received now</TableHead></TableRow></TableHeader>
          <TableBody>
            {po.lines.map(l => (
              <TableRow key={l.id}>
                <TableCell className="font-semibold">{l.itemName}</TableCell>
                <TableCell className="text-right tabular-nums">{l.quantity} {l.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{lineRemaining(l)} {l.unit}</TableCell>
                <TableCell><Input type="number" min={0} step="any" value={qty[l.id] ?? ''} placeholder="0" onChange={e => setQty({ ...qty, [l.id]: e.target.value })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-muted-foreground">Freight / loading / other charges
            <Input type="number" min={0} className="mt-1" value={extra} onChange={e => setExtra(e.target.value)} placeholder="0" />
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-muted-foreground">
            <Checkbox checked={over} onCheckedChange={v => setOver(!!v)} /> The supplier sent more than ordered
          </label>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit}><PackageCheck className="mr-1 h-4 w-4" /> Receive</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
