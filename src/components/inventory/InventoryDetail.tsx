// The panel of the Inventory screen (v1.120.0): one item at a glance, with the actions that used to be small row buttons.
import { useMemo } from 'react';
import { PackageMinus, PackagePlus, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/currency';
import { getMenuItems, getPrepRecipes, getRecipes, getStockLots, getInventory } from '@/lib/store';
import { effectiveLotsByItem } from '@/lib/store';
import { coverDays, costPerBase, recentMovements, stockStatus, stockValue, unitOf, usagePerDay, whereUsed } from '@/lib/inventoryPanel';
import { daysLeft } from '@/lib/lots';
import { localDay } from '@/lib/productionPlan';
import type { InventoryItem, StockLog } from '@/lib/types';
import { cn } from '@/lib/utils';

const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('en-PK');
const STATUS = { out: { label: 'Out of stock', cls: 'bg-destructive/15 text-destructive' }, low: { label: 'Low', cls: 'bg-status-warning/20 text-status-warning' }, ok: { label: 'In stock', cls: 'bg-status-success/15 text-status-success' } };
const MOVE: Record<string, string> = { in: 'In', out: 'Out', sale: 'Sale', adjustment: 'Adjusted' };

export default function InventoryDetail({ item, logs, categoryName, onStock, onEdit }: { item: InventoryItem; logs: StockLog[]; categoryName?: string; onStock: (type: 'in' | 'out') => void; onEdit: () => void }) {
  const today = localDay(new Date());
  const st = stockStatus(item);
  const unit = unitOf(item);
  const perDay = usagePerDay(logs, item.id, new Date());
  const cover = coverDays(Number(item.quantity) || 0, perDay);
  const used = useMemo(() => whereUsed(item.id, getRecipes(), getMenuItems(), getPrepRecipes(), getInventory()), [item.id]);
  const lots = useMemo(() => effectiveLotsByItem(getStockLots().filter(l => l.inventoryItemId === item.id), new Map([[item.id, item]])), [item]);
  const soonest = lots.filter(l => l.expiryDate).sort((a, b) => (a.expiryDate! < b.expiryDate! ? -1 : 1))[0];
  const moves = recentMovements(logs, item.id);
  return (
    <div className="min-w-0 space-y-4 break-words" data-inventory-panel={item.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', STATUS[st].cls)} data-panel-status={st}>{STATUS[st].label}</span>
        {item.isActive === false && <Badge variant="outline">Inactive</Badge>}
        <span className="text-xs text-muted-foreground">{item.sku}{categoryName ? ` · ${categoryName}` : ''}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">On hand</div><div className="font-extrabold tabular-nums" data-panel-qty>{qty(Number(item.quantity) || 0)} {unit}</div></div>
        <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">Worth</div><div className="font-extrabold tabular-nums" data-panel-value>{money(stockValue(item))}</div></div>
        <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">Lasts</div><div className="font-extrabold tabular-nums" data-panel-cover>{cover === null ? '—' : cover === 0 ? 'Out' : `${cover} d`}</div></div>
      </div>
      <p className="text-xs text-muted-foreground" data-panel-use>
        {perDay > 0 ? `Uses about ${qty(perDay)} ${unit} a day (last 14 days).` : 'Not used in the last 14 days.'} Reorder at {qty(Number(item.lowStockThreshold) || 0)} {unit}. Cost {money(Math.round(costPerBase(item) * 100) / 100)}/{unit}{item.salePrice ? ` · sells at ${money(item.salePrice)}` : ''}.
      </p>
      {soonest && <p className="text-xs" data-panel-expiry>Dated stock: first goes off on <b>{soonest.expiryDate}</b> ({(() => { const d = daysLeft(soonest.expiryDate, today); return d === null ? '' : d < 0 ? `expired ${-d} d ago` : `${d} d left`; })()}) · {lots.length} lot{lots.length === 1 ? '' : 's'}.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="text-status-success" onClick={() => onStock('in')} data-panel-in><PackagePlus className="mr-1 h-3.5 w-3.5" /> Stock in</Button>
        <Button size="sm" variant="outline" className="text-status-warning" onClick={() => onStock('out')} data-panel-out><PackageMinus className="mr-1 h-3.5 w-3.5" /> Stock out</Button>
        <Button size="sm" variant="outline" onClick={onEdit} data-panel-edit><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button>
      </div>
      <section data-panel-used>
        <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Used in</h4>
        {used.menu.length + used.preps.length === 0 ? <p className="text-sm text-muted-foreground">No recipe uses it yet.</p> : (
          <ul className="space-y-0.5 text-sm">
            {used.menu.map(m => <li key={`${m.id}-${m.variant ?? ''}`} className="flex justify-between"><span>{m.name}{m.variant ? ` (${m.variant})` : ''}</span><span className="tabular-nums text-muted-foreground">{qty(m.qty)} {m.unit}</span></li>)}
            {used.preps.map(p => <li key={p.id} className="flex justify-between"><span>{p.name} <span className="text-[10px] uppercase text-muted-foreground">prep</span></span><span className="tabular-nums text-muted-foreground">{qty(p.qty)} {p.unit}</span></li>)}
          </ul>
        )}
      </section>
      <section data-panel-moves>
        <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Latest movements</h4>
        {moves.length === 0 ? <p className="text-sm text-muted-foreground">Nothing has moved yet.</p> : (
          <ul className="space-y-0.5 text-sm">
            {moves.map(m => <li key={m.id} className="flex min-w-0 justify-between gap-2"><span className="min-w-0 truncate"><b>{MOVE[m.type] ?? m.type}</b> · {new Date(m.date).toLocaleDateString('en-PK')} · <span className="text-muted-foreground">{m.note}</span></span><span className="tabular-nums">{m.type === 'in' ? '+' : m.type === 'adjustment' ? '' : '−'}{qty(Number(m.quantity) || 0)}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
