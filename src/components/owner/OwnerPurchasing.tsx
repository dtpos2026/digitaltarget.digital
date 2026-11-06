// OWNER APP — Purchases, Inventory and Suppliers (v1.111.0).
//
// The owner asked for an Owner app that is a control app in its own right — sales, purchases, inventory, branches — not a doorway into
// the software. These three screens close the gap on the buying side:
//   • Purchases   what arrived, from whom, at what rate; "New purchase" saves the SAME record the software's Receiving page saves
//                 (saveReceivingEntry: stock goes up, the moving-average cost and the supplier's ledger follow).
//   • Inventory   every item with its stock; tap one to count it or to take out waste. Each change is written to the stock log.
//   • Suppliers   who supplies what, how much was bought from them, and a Call button.
import { useMemo, useState } from 'react';
import { Boxes, Minus, Phone, Plus, Search, ShoppingBasket, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { genId, addStockLog, getInventory, getParties, getReceivingEntries, saveInventoryItem, saveReceivingEntry } from '@/lib/store';
import { getBaseUnit, PURCHASE_UNITS, toBaseQty } from '@/lib/units';
import type { InventoryItem, ReceivingEntry } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Bar, Card, Empty, Label, ScreenHeader } from './ownerUi';
import { OWNER_BASE, rs, useLiveTick } from './ownerHooks';

const dayLabel = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); };
const num = (v: string) => { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

/** Units an item can be bought in: its base unit, the usual pairs, its own conversions, then the common pack units. */
export function purchaseUnitsFor(item: InventoryItem | undefined): string[] {
  if (!item) return PURCHASE_UNITS;
  const base = getBaseUnit(item);
  const set = new Set<string>([base]);
  if (base === 'kg') set.add('g'); if (base === 'g') set.add('kg'); if (base === 'l') set.add('ml'); if (base === 'ml') set.add('l');
  (item.conversions || []).forEach(c => c.unit && set.add(c.unit));
  PURCHASE_UNITS.forEach(u => set.add(u));
  return Array.from(set);
}

/** What a purchase would do, before it is saved: the stock added, the total and the cost per base unit. */
export function purchasePreview(item: InventoryItem | undefined, qty: number, unit: string, rate: number, surcharge: number) {
  const baseQty = item ? toBaseQty(item, qty, unit) : 0;
  const total = qty * rate + surcharge;
  return { baseQty, total, perBase: baseQty > 0 ? total / baseQty : 0, after: item ? (item.quantity || 0) + baseQty : 0 };
}

// ------------------------------------------------------------------ purchases

export function OwnerPurchases({ userName }: { userName: string }) {
  const tick = useLiveTick(['receivingEntries', 'inventory', 'parties']);
  const [version, bump] = useState(0);
  const entries = useMemo(() => getReceivingEntries().slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80), [tick, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const month = useMemo(() => {
    const now = new Date(); const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return getReceivingEntries().filter(e => e.date.startsWith(key)).reduce((s, e) => s + (e.rate || 0) * (e.quantity || 0) + (e.surcharge || 0), 0);
  }, [tick, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => {
    const m = new Map<string, ReceivingEntry[]>();
    entries.forEach(e => { const k = e.date.slice(0, 10); m.set(k, [...(m.get(k) || []), e]); });
    return Array.from(m.entries());
  }, [entries]);
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3 pb-24" data-testid="owner-purchases">
      <ScreenHeader title="Purchases" back={OWNER_BASE} />
      <Card className="bg-muted">
        <div className="text-[13.5px] text-muted-foreground">Bought this month</div>
        <div className="text-[30px] font-extrabold tabular-nums tracking-tight" data-testid="own-purchase-total">{rs(month)}</div>
      </Card>
      {days.length === 0 ? <Empty>No purchases recorded yet.</Empty> : (
        <div className="space-y-4" data-testid="own-purchase-list">
          {days.map(([k, rows]) => (
            <div key={k}>
              <Label right={rs(rows.reduce((s, e) => s + (e.rate || 0) * (e.quantity || 0) + (e.surcharge || 0), 0))}>{dayLabel(k)}</Label>
              <div className="space-y-2.5">
                {rows.map(e => (
                  <Card key={e.id} className="flex items-center gap-3 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15.5px] font-bold">{e.itemName}</div>
                      <div className="truncate text-[13px] text-muted-foreground">{e.supplierName} · {e.quantity} {e.unit} @ {rs(e.rate)}</div>
                    </div>
                    <div className="shrink-0 text-[15.5px] font-extrabold tabular-nums">{rs((e.rate || 0) * (e.quantity || 0) + (e.surcharge || 0))}</div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-[560px] px-4 md:bottom-6">
        <button type="button" onClick={() => setOpen(true)} data-testid="own-purchase-new" className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-bold text-primary-foreground shadow-lg">
          <Plus className="h-5 w-5" /> New purchase
        </button>
      </div>
      {open && <PurchaseSheet userName={userName} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); bump(x => x + 1); }} />}
    </div>
  );
}

function PurchaseSheet({ userName, onClose, onSaved }: { userName: string; onClose: () => void; onSaved: () => void }) {
  const items = useMemo(() => getInventory().filter(i => i.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)), []);
  const suppliers = useMemo(() => getParties().filter(p => p.type === 'supplier' && p.isActive !== false), []);
  const [itemId, setItemId] = useState('');
  const item = items.find(i => i.id === itemId);
  const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [rate, setRate] = useState('');
  const [extra, setExtra] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const unitNow = unit || (item ? getBaseUnit(item) : '');
  const p = purchasePreview(item, num(qty), unitNow, num(rate), num(extra));

  const save = () => {
    if (!item) return setError('Pick the item that arrived.');
    if (!supplier.trim()) return setError('Who supplied it? Pick or type a supplier.');
    if (num(qty) <= 0) return setError('How much arrived? Type the quantity.');
    if (num(rate) < 0) return setError('The rate cannot be negative.');
    try {
      saveReceivingEntry({
        id: genId(), supplierName: supplier.trim(), inventoryItemId: item.id, itemName: item.name, quantity: num(qty), unit: unitNow,
        rate: num(rate), surcharge: num(extra), receivedBy: userName, notes: note.trim(), date: new Date().toISOString(),
      });
    } catch { return setError('Could not save — check the connection and try again.'); }
    toast.success(`Stock updated: +${p.baseQty.toFixed(2)} ${getBaseUnit(item)} · ${rs(p.total)}`);
    onSaved();
  };

  const input = 'mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[16px]';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" role="dialog" aria-modal="true" aria-label="New purchase">
      <div className="max-h-[92dvh] w-full max-w-[560px] space-y-3 overflow-y-auto rounded-t-3xl bg-background p-5 md:rounded-3xl" data-testid="own-purchase-sheet">
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] font-extrabold">New purchase</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl border bg-card"><X className="h-5 w-5" /></button>
        </div>
        {error && <div role="alert" data-testid="own-purchase-error" className="rounded-xl border border-[hsl(var(--own-bad)/.3)] bg-[hsl(var(--own-bad-bg))] px-3 py-2 text-[14px] font-semibold text-[hsl(var(--own-bad))]">{error}</div>}
        <label className="block text-[13px] font-semibold text-muted-foreground">Item
          <select aria-label="Item" className={input} value={itemId} onChange={e => { setItemId(e.target.value); setUnit(''); setError(''); }}>
            <option value="">Choose an item…</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name} — {i.quantity ?? 0} {getBaseUnit(i)} in stock</option>)}
          </select>
        </label>
        <label className="block text-[13px] font-semibold text-muted-foreground">Supplier
          <input aria-label="Supplier" list="own-suppliers" className={input} value={supplier} onChange={e => { setSupplier(e.target.value); setError(''); }} placeholder="Pick or type a name" />
          <datalist id="own-suppliers">{suppliers.map(s => <option key={s.id} value={s.name} />)}</datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[13px] font-semibold text-muted-foreground">Quantity
            <input aria-label="Quantity" inputMode="decimal" className={input} value={qty} onChange={e => { setQty(e.target.value); setError(''); }} placeholder="0" />
          </label>
          <label className="block text-[13px] font-semibold text-muted-foreground">Unit
            <select aria-label="Unit" className={input} value={unitNow} onChange={e => setUnit(e.target.value)}>
              {purchaseUnitsFor(item).map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="block text-[13px] font-semibold text-muted-foreground">Rate per {unitNow || 'unit'}
            <input aria-label="Rate" inputMode="decimal" className={input} value={rate} onChange={e => { setRate(e.target.value); setError(''); }} placeholder="0" />
          </label>
          <label className="block text-[13px] font-semibold text-muted-foreground">Extra charge
            <input aria-label="Extra charge" inputMode="decimal" className={input} value={extra} onChange={e => setExtra(e.target.value)} placeholder="0 (freight, loading)" />
          </label>
        </div>
        <label className="block text-[13px] font-semibold text-muted-foreground">Note <span className="font-normal">(optional)</span>
          <input aria-label="Note" className={input} value={note} onChange={e => setNote(e.target.value)} placeholder="Invoice no., who received it …" />
        </label>
        {item && num(qty) > 0 && (
          <div className="rounded-2xl bg-muted px-4 py-3 text-[14px]" data-testid="own-purchase-preview">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><b className="tabular-nums">{rs(p.total)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Stock becomes</span><b className="tabular-nums">{p.after.toFixed(2)} {getBaseUnit(item)}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cost per {getBaseUnit(item)}</span><b className="tabular-nums">{rs(p.perBase)}</b></div>
          </div>
        )}
        <button type="button" onClick={save} data-testid="own-purchase-save" className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[16px] font-bold text-primary-foreground">
          <ShoppingBasket className="h-5 w-5" /> Save purchase
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ inventory

type StockFilter = 'all' | 'low' | 'out';

export function stockState(i: Pick<InventoryItem, 'quantity' | 'lowStockThreshold'>): 'ok' | 'low' | 'out' {
  const q = Number(i.quantity) || 0;
  if (q <= 0) return 'out';
  return q <= (Number(i.lowStockThreshold) || 0) ? 'low' : 'ok';
}

export function OwnerInventory({ userName }: { userName: string }) {
  const tick = useLiveTick(['inventory', 'stockLogs']);
  const [version, bump] = useState(0);
  const all = useMemo(() => getInventory().filter(i => i.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)), [tick, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState<StockFilter>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<InventoryItem | null>(null);
  const counts = useMemo(() => ({ all: all.length, low: all.filter(i => stockState(i) === 'low').length, out: all.filter(i => stockState(i) === 'out').length }), [all]);
  const shown = all.filter(i => (filter === 'all' || stockState(i) === filter) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())));
  const chip = (id: StockFilter, label: string) => (
    <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} data-testid={`own-inv-${id}`}
      className={cn('h-10 shrink-0 rounded-full border px-4 text-[14px] font-semibold', filter === id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>
      {label} <span className="tabular-nums opacity-80">{counts[id]}</span>
    </button>
  );

  return (
    <div className="space-y-3" data-testid="owner-inventory">
      <ScreenHeader title="Inventory" back={OWNER_BASE} />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-muted-foreground" aria-hidden />
        <input aria-label="Search stock" value={q} onChange={e => setQ(e.target.value)} placeholder="Search items" className="h-12 w-full rounded-2xl border bg-card pl-11 pr-3 text-[16px]" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Stock filter">{chip('all', 'All')}{chip('low', 'Low')}{chip('out', 'Out')}</div>
      {shown.length === 0 ? <Empty>{all.length === 0 ? 'No inventory items yet.' : 'Nothing matches.'}</Empty> : (
        <div className="space-y-2.5" data-testid="own-inv-list">
          {shown.map(i => {
            const st = stockState(i);
            const level = i.lowStockThreshold > 0 ? Math.min(1, (Number(i.quantity) || 0) / (i.lowStockThreshold * 2)) : 1;
            return (
              <Card key={i.id} className="cursor-pointer space-y-2" role="button" tabIndex={0} data-testid={`own-inv-item-${i.id}`} aria-label={`${i.name}, ${i.quantity} ${getBaseUnit(i)}`}
                onClick={() => setPicked(i)} onKeyDown={e => { if (e.key === 'Enter') setPicked(i); }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-[15.5px] font-bold">{i.name}</div>
                  <div className="shrink-0 text-[15px] tabular-nums"><b className={cn(st === 'out' && 'text-[hsl(var(--own-bad))]', st === 'low' && 'text-[hsl(var(--own-warn))]')}>{Number(i.quantity || 0).toFixed(2).replace(/\.00$/, '')}</b> <span className="text-muted-foreground">{getBaseUnit(i)}</span></div>
                </div>
                <Bar value={level * 100} tone={st === 'ok' ? 'primary' : 'bad'} />
                <div className="text-[12.5px] text-muted-foreground">Worth {rs((Number(i.quantity) || 0) * (i.avgCostPrice ?? i.costPrice ?? 0))} · reorder at {i.lowStockThreshold || 0}</div>
              </Card>
            );
          })}
        </div>
      )}
      {picked && <AdjustSheet item={picked} userName={userName} onClose={() => setPicked(null)} onSaved={() => { setPicked(null); bump(x => x + 1); }} />}
    </div>
  );
}

function AdjustSheet({ item, userName, onClose, onSaved }: { item: InventoryItem; userName: string; onClose: () => void; onSaved: () => void }) {
  const base = getBaseUnit(item);
  const [mode, setMode] = useState<'count' | 'waste'>('count');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const current = Number(item.quantity) || 0;
  const target = mode === 'count' ? num(value) : current - num(value);
  const delta = target - current;

  const save = () => {
    if (value.trim() === '' || !Number.isFinite(Number(value))) return setError(mode === 'count' ? 'Type the quantity you counted.' : 'Type how much was wasted.');
    if (num(value) < 0) return setError('The number cannot be negative.');
    if (mode === 'waste' && num(value) > current) return setError(`Only ${current} ${base} in stock.`);
    if (delta === 0) return setError('That is what the system already shows.');
    try {
      saveInventoryItem({ ...item, quantity: target });
      addStockLog({
        id: genId(), inventoryItemId: item.id, type: 'adjustment', quantity: delta,
        note: `${mode === 'count' ? 'Stock count' : 'Waste'} (Owner app)${reason.trim() ? ` • ${reason.trim()}` : ''} • ${userName}`, date: new Date().toISOString(),
      });
    } catch { return setError('Could not save — check the connection and try again.'); }
    toast.success(`${item.name}: ${current} → ${target} ${base}`);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" role="dialog" aria-modal="true" aria-label={`Adjust ${item.name}`}>
      <div className="w-full max-w-[560px] space-y-3 rounded-t-3xl bg-background p-5 md:rounded-3xl" data-testid="own-adjust-sheet">
        <div className="flex items-start justify-between gap-2">
          <div><h2 className="text-[19px] font-extrabold">{item.name}</h2><div className="text-[13.5px] text-muted-foreground">In stock now: <b className="tabular-nums">{current} {base}</b></div></div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl border bg-card"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-muted p-1" role="group" aria-label="Adjust">
          {(['count', 'waste'] as const).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setValue(''); setError(''); }} className={cn('h-11 rounded-xl text-[14.5px] font-bold', mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
              {m === 'count' ? 'I counted' : 'Waste / used'}
            </button>
          ))}
        </div>
        {error && <div role="alert" data-testid="own-adjust-error" className="rounded-xl border border-[hsl(var(--own-bad)/.3)] bg-[hsl(var(--own-bad-bg))] px-3 py-2 text-[14px] font-semibold text-[hsl(var(--own-bad))]">{error}</div>}
        <label className="block text-[13px] font-semibold text-muted-foreground">{mode === 'count' ? `Counted quantity (${base})` : `Quantity taken out (${base})`}
          <div className="mt-1 flex items-center gap-2">
            <button type="button" aria-label="Less" onClick={() => setValue(String(Math.max(0, num(value) - 1)))} className="grid h-12 w-12 place-items-center rounded-xl border bg-card"><Minus className="h-5 w-5" /></button>
            <input aria-label="Quantity" inputMode="decimal" className="h-12 min-w-0 flex-1 rounded-xl border bg-card px-3 text-center text-[18px] font-bold" value={value} onChange={e => { setValue(e.target.value); setError(''); }} placeholder="0" />
            <button type="button" aria-label="More" onClick={() => setValue(String(num(value) + 1))} className="grid h-12 w-12 place-items-center rounded-xl border bg-card"><Plus className="h-5 w-5" /></button>
          </div>
        </label>
        <label className="block text-[13px] font-semibold text-muted-foreground">Reason <span className="font-normal">(optional)</span>
          <input aria-label="Reason" className="mt-1 h-12 w-full rounded-xl border bg-card px-3 text-[16px]" value={reason} onChange={e => setReason(e.target.value)} placeholder={mode === 'count' ? 'Weekly count' : 'Spoiled, spilled …'} />
        </label>
        {value.trim() !== '' && delta !== 0 && <div className="rounded-2xl bg-muted px-4 py-3 text-[14px]" data-testid="own-adjust-preview">Stock becomes <b className="tabular-nums">{target} {base}</b> <span className="text-muted-foreground">({delta > 0 ? '+' : ''}{Number(delta.toFixed(3))})</span></div>}
        <button type="button" onClick={save} data-testid="own-adjust-save" className="flex h-14 w-full items-center justify-center rounded-2xl bg-primary text-[16px] font-bold text-primary-foreground"><Boxes className="mr-2 h-5 w-5" />Save</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ suppliers

export function OwnerSuppliers() {
  const tick = useLiveTick(['parties', 'receivingEntries']);
  const rows = useMemo(() => {
    const entries = getReceivingEntries();
    const by = new Map<string, { name: string; phone?: string; bought: number; last?: string; items: Set<string> }>();
    getParties().filter(p => p.type === 'supplier' && p.isActive !== false).forEach(p => by.set(p.name.trim().toLowerCase(), { name: p.name, phone: p.phone, bought: 0, items: new Set() }));
    entries.forEach(e => {
      const k = (e.supplierName || '').trim().toLowerCase(); if (!k) return;
      const r = by.get(k) || { name: e.supplierName, bought: 0, items: new Set<string>() };
      r.bought += (e.rate || 0) * (e.quantity || 0) + (e.surcharge || 0);
      r.items.add(e.itemName);
      if (!r.last || e.date > r.last) r.last = e.date;
      by.set(k, r);
    });
    return Array.from(by.values()).sort((a, b) => b.bought - a.bought);
  }, [tick]);
  return (
    <div className="space-y-3" data-testid="owner-suppliers">
      <ScreenHeader title="Suppliers" back={OWNER_BASE} />
      {rows.length === 0 ? <Empty>No suppliers yet. They appear here when you record a purchase.</Empty> : (
        <div className="space-y-2.5" data-testid="own-supplier-list">
          {rows.map(r => (
            <Card key={r.name} className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate text-[15.5px] font-bold"><Truck className="mr-1.5 inline h-4 w-4 text-muted-foreground" aria-hidden />{r.name}</div>
                <div className="shrink-0 text-[15px] font-extrabold tabular-nums">{rs(r.bought)}</div>
              </div>
              <div className="truncate text-[13px] text-muted-foreground">{r.items.size ? Array.from(r.items).slice(0, 3).join(', ') + (r.items.size > 3 ? ` +${r.items.size - 3}` : '') : 'Nothing bought yet'}{r.last ? ` · last ${dayLabel(r.last)}` : ''}</div>
              {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-3.5 text-[14px] font-semibold" aria-label={`Call ${r.name}`}><Phone className="h-4 w-4" /> Call</a>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
