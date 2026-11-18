// Cake Orders (v1.117.2) — a custom cake taken days ahead with an advance, baked for a date, handed over when the balance is paid.
// Every payment is posted to Accounts as income "Cake orders"; the linked menu item's recipe feeds stock when baking starts.
import { useMemo, useState } from 'react';
import { Cake, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SearchableSelect from '@/components/SearchableSelect';
import ReportActions from '@/components/ReportActions';
import MasterDetail from '@/components/layout/MasterDetail';
import { EmptyState, FilterBar, PageHeader } from '@/components/layout/PageFrame';
import { money } from '@/lib/currency';
import { cancelCake, genId, getBranches, getCakeOrders, getCurrentBranchId, getCurrentUser, getMenuItems, moveCake, recordCakePayment, saveCakeOrder } from '@/lib/store';
import { userHasFeature } from '@/lib/permissions';
import { balanceOf, draftIssues, dueState, isOpen, nextNumber, paidOf, slipDoc, sortOrders, suggestedAdvance, summarize, type CakeDraft, type CakeOrder, type CakeStatus, type DueState } from '@/lib/cakeOrders';
import { localDay } from '@/lib/productionPlan';
import { cn } from '@/lib/utils';

type Show = 'open' | 'ready' | 'delivered' | 'cancelled' | 'all';
const STATUS: Record<CakeStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-primary/10 text-primary' }, baking: { label: 'Baking', cls: 'bg-status-warning/15 text-status-warning' },
  ready: { label: 'Ready', cls: 'bg-status-success/15 text-status-success' }, delivered: { label: 'Handed over', cls: 'bg-muted text-muted-foreground' }, cancelled: { label: 'Cancelled', cls: 'bg-destructive/10 text-destructive' },
};
const DUE: Record<DueState, { label: string; cls: string } | null> = {
  overdue: { label: 'Overdue', cls: 'bg-destructive/15 text-destructive' }, today: { label: 'Today', cls: 'bg-status-warning/20 text-status-warning' }, tomorrow: { label: 'Tomorrow', cls: 'bg-primary/10 text-primary' }, later: null, done: null,
};
const METHODS = ['cash', 'card', 'online'];
const blank = (today: string): CakeDraft & { menuItemId: string; message: string; weightKg: string; method: string } => ({ customerName: '', phone: '', description: '', quantity: 1, dueDate: '', dueTime: '', handover: 'pickup', address: '', total: 0, advance: 0, menuItemId: '', message: '', weightKg: '', method: 'cash' });

export default function CakeOrdersPage() {
  const [version, setVersion] = useState(0);
  const today = localDay(new Date());
  const orders = useMemo(() => sortOrders(getCakeOrders()), [version]);
  const menu = useMemo(() => getMenuItems().filter(m => m.isActive !== false && m.pricingType !== 'weight'), []);
  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false), []);
  const me = getCurrentUser();
  const canCancel = userHasFeature(me, 'feat.cake.cancel');
  const [show, setShow] = useState<Show>('open');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [cancelling, setCancelling] = useState(false);
  const [refund, setRefund] = useState(true);

  const sum = summarize(orders, today);
  const needle = q.trim().toLowerCase();
  const rows = orders.filter(o => (show === 'all' || (show === 'open' ? isOpen(o) : o.status === show))
    && (!needle || `${o.number} ${o.customerName} ${o.phone ?? ''} ${o.description}`.toLowerCase().includes(needle)));
  const current = orders.find(o => o.id === selected) ?? null;
  const refresh = () => setVersion(v => v + 1);

  // ------------------------------------------------------------------ a new order
  const issues = draft ? draftIssues(draft, today) : [];
  const setItem = (id: string) => {
    const m = menu.find(x => x.id === id);
    setDraft(d => d && { ...d, menuItemId: id, description: d.description || (m ? m.name : ''), total: d.total || (m ? (Number(m.price) || 0) * (d.quantity || 1) : 0) });
  };
  const create = () => {
    if (!draft || issues.length) return;
    const now = new Date().toISOString();
    const item = menu.find(m => m.id === draft.menuItemId);
    const branchId = branches.length > 0 ? (getCurrentBranchId() || undefined) : undefined;
    const order: CakeOrder = {
      id: genId(), number: nextNumber(getCakeOrders()), createdAt: now, createdBy: me?.name, branchId, customerName: draft.customerName.trim(), phone: draft.phone?.trim(),
      menuItemId: item?.id, itemName: item?.name, description: draft.description.trim(), message: draft.message.trim() || undefined, quantity: Number(draft.quantity) || 1,
      weightKg: Number(draft.weightKg) > 0 ? Number(draft.weightKg) : undefined, dueDate: draft.dueDate, dueTime: draft.dueTime || undefined, handover: draft.handover,
      address: draft.handover === 'delivery' ? draft.address?.trim() : undefined, total: Number(draft.total), payments: [], status: 'new', updatedAt: now,
    };
    saveCakeOrder(order);
    if (Number(draft.advance) > 0) {
      const r = recordCakePayment(order.id, { amount: Number(draft.advance), method: draft.method, by: me?.name, kind: 'advance' });
      if (!r.ok) toast.error(r.reason);
    }
    toast.success(`${order.number} saved`);
    setDraft(null); setSelected(order.id); setShow('open'); refresh();
  };

  // ------------------------------------------------------------------ one order
  const takePayment = () => {
    if (!current) return;
    const r = recordCakePayment(current.id, { amount: Number(payAmount), method: payMethod, by: me?.name });
    if (!r.ok) { toast.error(r.reason); return; }
    toast.success('Payment recorded'); setPayAmount(''); refresh();
  };
  const move = (to: Exclude<CakeStatus, 'cancelled'>) => {
    if (!current) return;
    const r = moveCake(current.id, to, me?.name);
    if (!r.ok) { toast.error(r.reason); return; }
    toast.success(to === 'delivered' ? 'Handed over' : `${STATUS[to].label}`); refresh();
  };
  const doCancel = () => {
    if (!current) return;
    const r = cancelCake(current.id, refund, me?.name);
    setCancelling(false);
    if (!r.ok) { toast.error(r.reason); return; }
    toast.success(refund && paidOf(current) > 0 ? 'Cancelled — advance refunded' : 'Cancelled'); refresh();
  };

  const panel = current ? (() => {
    const bal = balanceOf(current);
    const nextStep: [Exclude<CakeStatus, 'cancelled'>, string] | null = current.status === 'new' ? ['baking', 'Start baking'] : current.status === 'baking' ? ['ready', 'Mark ready'] : current.status === 'ready' ? ['delivered', 'Hand over'] : null;
    return (
      <div className="space-y-4" data-cake-panel={current.id}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', STATUS[current.status].cls)}>{STATUS[current.status].label}</span>
          <span className="text-sm text-muted-foreground">Needed {current.dueDate}{current.dueTime ? ` at ${current.dueTime}` : ''} · {current.handover === 'delivery' ? 'Delivery' : 'Pick-up'}</span>
        </div>
        <div className="space-y-1 text-sm">
          <p><b>{current.customerName}</b> · {current.phone}</p>
          <p>{current.itemName ? `${current.itemName} — ` : ''}{current.description}{current.quantity > 1 ? ` × ${current.quantity}` : ''}{current.weightKg ? ` · ${current.weightKg} kg` : ''}</p>
          {current.message && <p>Message: “{current.message}”</p>}
          {current.address && <p>Deliver to: {current.address}</p>}
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">Total</div><div className="font-extrabold tabular-nums" data-cake-total>{money(current.total)}</div></div>
          <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">Paid</div><div className="font-extrabold tabular-nums" data-cake-paid>{money(paidOf(current))}</div></div>
          <div className={cn('rounded-lg p-2', bal > 0 ? 'bg-destructive/10' : 'bg-status-success/10')}><div className="text-[10px] font-bold uppercase text-muted-foreground">Balance</div><div className="font-extrabold tabular-nums" data-cake-balance>{money(bal)}</div></div>
        </div>
        {current.payments.length > 0 && (
          <ul className="space-y-1 text-sm" data-cake-payments>
            {current.payments.map(p => <li key={p.id} className="flex justify-between"><span>{p.kind === 'refund' ? 'Refund' : p.kind === 'advance' ? 'Advance' : 'Payment'} · {p.at.slice(0, 10)} · {p.method}</span><span className="tabular-nums">{p.kind === 'refund' ? '−' : ''}{money(p.amount)}</span></li>)}
          </ul>
        )}
        {isOpen(current) && bal > 0 && (
          <div className="flex items-end gap-2" data-cake-pay>
            <label className="flex-1 text-xs font-semibold">Take a payment<Input type="number" min="0" value={payAmount} placeholder={String(bal)} onChange={e => setPayAmount(e.target.value)} className="h-9" data-cake-pay-amount /></label>
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)} aria-label="Method" className="h-9 rounded-md border bg-background px-2 text-sm">{METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select>
            <Button size="sm" variant="outline" onClick={() => setPayAmount(String(bal))} data-cake-pay-full>Full</Button>
            <Button size="sm" onClick={takePayment} disabled={!(Number(payAmount) > 0)} data-cake-pay-save>Take</Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {nextStep && <Button size="sm" onClick={() => move(nextStep[0])} data-cake-move={nextStep[0]}>{nextStep[1]}</Button>}
          {isOpen(current) && <Button size="sm" variant="outline" className="text-destructive" disabled={!canCancel} title={canCancel ? undefined : 'Ask an admin for the right to cancel a cake order'} onClick={() => { setRefund(paidOf(current) > 0); setCancelling(true); }} data-cake-cancel>Cancel order</Button>}
          <div className="ml-auto"><ReportActions build={() => slipDoc(current, n => money(n))} /></div>
        </div>
        {current.status === 'ready' && bal > 0 && <p className="text-xs text-destructive" data-cake-owes>The customer still owes {money(bal)} — collect it before handing over.</p>}
        {current.ingredientCost ? <p className="text-xs text-muted-foreground">Ingredients taken from stock · cost {money(current.ingredientCost)} (booked in Accounts as “Cake ingredients”).</p> : null}
      </div>
    );
  })() : null;

  return (
    <div className="space-y-4 p-4 lg:p-6" data-cake-orders>
      <PageHeader icon={<Cake />} title="Cake Orders" subtitle="Custom cakes taken with an advance, baked for a date, handed over when the balance is paid"
        actions={<Button size="sm" onClick={() => setDraft(blank(today))} data-cake-new><Plus className="mr-1 h-3.5 w-3.5" /> New cake order</Button>} />
      <FilterBar label="Cake order filters">
        <Input type="search" placeholder="Search number, customer, phone or cake" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} data-filter-grow data-cake-search />
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {(['open', 'ready', 'delivered', 'cancelled', 'all'] as const).map(s => (
            <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)} data-cake-show={s}
              className={cn('h-9 rounded-full border-2 px-3 text-xs font-semibold capitalize', show === s ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50')}>{s === 'delivered' ? 'Handed over' : s}</button>
          ))}
        </div>
      </FilterBar>
      <div className="flex flex-wrap items-center gap-2 text-sm" data-cake-summary>
        <Badge variant="secondary" data-cake-open>{sum.open} open</Badge>
        <Badge variant={sum.dueToday ? 'default' : 'outline'} data-cake-today>{sum.dueToday} due today</Badge>
        <Badge variant={sum.overdue ? 'destructive' : 'outline'} data-cake-overdue>{sum.overdue} overdue</Badge>
        <Badge variant="outline" data-cake-owed>Balance to collect {money(sum.balanceOwed)}</Badge>
        <Badge variant="outline">Advances held {money(sum.advanceHeld)}</Badge>
      </div>

      <MasterDetail title={current ? `${current.number} — ${current.customerName}` : 'Cake order'} open={!!current} onClose={() => setSelected(null)} emptyText="Select an order to see its payments and move it along." dialogClassName="sm:max-w-lg max-h-[90vh] overflow-y-auto" detail={panel}
        list={orders.length === 0 ? <EmptyState icon={<Cake />} title="No cake orders yet" hint="Take the first one: customer, the cake, the day it is needed and the advance." />
          : rows.length === 0 ? <EmptyState title="Nothing matches" hint="Change the search or the filter above." /> : (
            <>
            {/* phone: one card per order (a six-column table does not fit) */}
            <div className="space-y-2 sm:hidden" data-cake-cards>
              {rows.map(o => {
                const due = DUE[dueState(o, today)];
                return (
                  <button key={o.id} type="button" onClick={() => setSelected(o.id)} data-cake-card={o.id} className={cn('block w-full rounded-xl border bg-card p-3 text-left', selected === o.id && 'border-primary bg-primary/5')}>
                    <div className="flex items-center justify-between gap-2"><span className="font-extrabold">{o.number} · {o.customerName}</span><span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', STATUS[o.status].cls)}>{STATUS[o.status].label}</span></div>
                    <div className="mt-0.5 truncate text-sm text-muted-foreground">{o.description}</div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                      <span className="whitespace-nowrap">{o.dueDate}{o.dueTime ? ` ${o.dueTime}` : ''} {due && <span className={cn('ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold', due.cls)}>{due.label}</span>}</span>
                      <span className="whitespace-nowrap tabular-nums"><b>{money(balanceOf(o))}</b> <span className="text-muted-foreground">of {money(o.total)}</span></span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="hidden sm:block">
            <Table data-cake-table>
              <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Needed</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(o => {
                  const due = DUE[dueState(o, today)];
                  return (
                    <TableRow key={o.id} onClick={() => setSelected(o.id)} className={cn('cursor-pointer', selected === o.id && 'bg-primary/5')} data-cake-row={o.id}>
                      <TableCell className="whitespace-nowrap font-semibold">{o.number}</TableCell>
                      <TableCell>{o.customerName}<div className="max-w-[16rem] truncate text-xs text-muted-foreground">{o.description}</div></TableCell>
                      <TableCell className="whitespace-nowrap">{o.dueDate}{o.dueTime ? ` ${o.dueTime}` : ''}{due && <div><span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', due.cls)}>{due.label}</span></div>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums"><b>{money(balanceOf(o))}</b><div className="text-xs text-muted-foreground">of {money(o.total)}</div></TableCell>
                      <TableCell className="whitespace-nowrap"><span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', STATUS[o.status].cls)}>{STATUS[o.status].label}</span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
            </>
          )} />

      <Dialog open={!!draft} onOpenChange={o => !o && setDraft(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-cake-editor>
          <DialogHeader><DialogTitle>New cake order</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold">Customer<Input value={draft.customerName} onChange={e => setDraft({ ...draft, customerName: e.target.value })} className="h-9" data-cake-customer /></label>
                <label className="text-xs font-semibold">Phone<Input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} className="h-9" data-cake-phone /></label>
              </div>
              <label className="block text-xs font-semibold">Based on a menu item (optional — its recipe feeds stock)
                <SearchableSelect placeholder="Custom cake…" searchPlaceholder="Search menu…" value={draft.menuItemId} onChange={setItem} options={menu.map(m => ({ value: m.id, label: m.name, hint: money(Number(m.price) || 0) }))} triggerClassName="h-9" />
              </label>
              <label className="block text-xs font-semibold">The cake (flavour, size, tiers, design)<Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className="h-9" data-cake-description /></label>
              <div className="grid grid-cols-12 gap-2">
                <label className="col-span-12 text-xs font-semibold sm:col-span-6">Message on the cake<Input value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })} className="h-9" /></label>
                <label className="col-span-6 text-xs font-semibold sm:col-span-3">How many<Input type="number" min="1" value={draft.quantity || ''} onChange={e => setDraft({ ...draft, quantity: parseInt(e.target.value, 10) || 0 })} className="h-9" /></label>
                <label className="col-span-6 text-xs font-semibold sm:col-span-3">Weight (kg)<Input type="number" min="0" step="0.5" value={draft.weightKg} onChange={e => setDraft({ ...draft, weightKg: e.target.value })} className="h-9" /></label>
              </div>
              <div className="grid grid-cols-12 gap-2">
                <label className="col-span-6 text-xs font-semibold sm:col-span-4">Needed on<Input type="date" min={today} value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} className="h-9" data-cake-date /></label>
                <label className="col-span-6 text-xs font-semibold sm:col-span-3">At<Input type="time" value={draft.dueTime} onChange={e => setDraft({ ...draft, dueTime: e.target.value })} className="h-9" /></label>
                <label className="col-span-12 text-xs font-semibold sm:col-span-5">Handover
                  <select value={draft.handover} onChange={e => setDraft({ ...draft, handover: e.target.value as 'pickup' | 'delivery' })} className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="pickup">Pick-up</option><option value="delivery">Delivery</option></select>
                </label>
              </div>
              {draft.handover === 'delivery' && <label className="block text-xs font-semibold">Delivery address<Input value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} className="h-9" /></label>}
              <div className="grid grid-cols-12 items-end gap-2">
                <label className="col-span-6 text-xs font-semibold sm:col-span-4">Total price<Input type="number" min="0" value={draft.total || ''} onChange={e => setDraft({ ...draft, total: parseFloat(e.target.value) || 0 })} className="h-9" data-cake-total-input /></label>
                <label className="col-span-6 text-xs font-semibold sm:col-span-4">Advance<Input type="number" min="0" value={draft.advance || ''} onChange={e => setDraft({ ...draft, advance: parseFloat(e.target.value) || 0 })} className="h-9" data-cake-advance /></label>
                <Button type="button" variant="outline" size="sm" className="col-span-6 sm:col-span-2" onClick={() => setDraft({ ...draft, advance: suggestedAdvance(draft.total) })} data-cake-half>Half</Button>
                <select value={draft.method} onChange={e => setDraft({ ...draft, method: e.target.value })} aria-label="Advance method" className="col-span-6 h-9 rounded-md border bg-background px-2 text-sm sm:col-span-2">{METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select>
              </div>
              <p className="text-sm" data-cake-balance-preview>Balance on the day: <b>{money(Math.max(0, (Number(draft.total) || 0) - (Number(draft.advance) || 0)))}</b></p>
              {issues.length > 0 && (draft.customerName || draft.description || draft.total > 0) && <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive" data-cake-issues>{issues.map(m => <li key={m}>{m}</li>)}</ul>}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={create} disabled={issues.length > 0} data-cake-save>Save order</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent className="max-w-md" data-cake-cancel-dialog>
          <DialogHeader><DialogTitle>Cancel {current?.number}?</DialogTitle></DialogHeader>
          {current && paidOf(current) > 0
            ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={refund} onChange={e => setRefund(e.target.checked)} className="mt-1" data-cake-refund /><span>Give the advance of <b>{money(paidOf(current))}</b> back to the customer (recorded in Accounts as a refund). Untick to keep it.</span></label>
            : <p className="text-sm">Nothing has been paid on this order.</p>}
          <DialogFooter><Button variant="outline" onClick={() => setCancelling(false)}>Keep the order</Button><Button variant="destructive" onClick={doCancel} data-cake-cancel-confirm>Cancel the order</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
