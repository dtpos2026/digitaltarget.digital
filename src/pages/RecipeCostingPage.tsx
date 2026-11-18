// Recipe Costing (v1.116.0) — the menu from the bottom up: ingredient cost, production cost, selling price, gross profit, food cost %
// against the target, and what price would reach it. One row per item (per size where an item has sizes), costed at the chosen branch's
// own ingredient prices. The second tab is menu engineering: which dishes are Stars, Plowhorses, Puzzles and Dogs.
import { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import { money } from '@/lib/currency';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, FilterBar, PageHeader } from '@/components/layout/PageFrame';
import MasterDetail from '@/components/layout/MasterDetail';
import { getBranches, getCategories, getInventory, getMenuItems, getOrders, getRecipes, getSettings, saveSettings } from '@/lib/store';
import { scopeToBranch } from '@/lib/cashierScope';
import { DEFAULT_TARGET_FOOD_COST_PCT, MENU_CLASS_ADVICE, costMenu, foodCostStatus, menuEngineering, suggestedPrice, summarize, type FoodCostStatus, type ItemCost } from '@/lib/recipeCosting';
import ReportActions from '@/components/ReportActions';
import type { ReportDoc } from '@/lib/reportExport';
import { cn } from '@/lib/utils';

const STATUS: Record<FoodCostStatus, { label: string; cls: string }> = {
  healthy: { label: 'On target', cls: 'bg-status-success/15 text-status-success border-status-success/30' },
  watch: { label: 'Watch', cls: 'bg-status-warning/15 text-status-warning border-status-warning/30' },
  over: { label: 'Over target', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
  none: { label: 'No recipe', cls: 'bg-muted text-muted-foreground' },
};
const CLASS_TONE = { star: 'bg-status-success/15 text-status-success', plowhorse: 'bg-status-warning/15 text-status-warning', puzzle: 'bg-blue-500/15 text-blue-700', dog: 'bg-destructive/15 text-destructive' } as const;
type Show = 'all' | FoodCostStatus;
const rowKey = (c: ItemCost) => `${c.menuItemId}|${c.variantKey}`;

export default function RecipeCostingPage() {
  const menu = useMemo(() => getMenuItems(), []);
  const recipes = useMemo(() => getRecipes(), []);
  const inventory = useMemo(() => getInventory(), []);
  const categories = useMemo(() => getCategories(), []);
  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false), []);
  const orders = useMemo(() => scopeToBranch(getOrders()), []);

  const [target, setTarget] = useState<number>(() => Number(getSettings().targetFoodCostPct) || DEFAULT_TARGET_FOOD_COST_PCT);
  const [branch, setBranch] = useState('all');
  const [cat, setCat] = useState('all');
  const [show, setShow] = useState<Show>('all');
  const [q, setQ] = useState('');
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const [whatIf, setWhatIf] = useState('');

  const branchId = branch === 'all' ? undefined : branch;
  const all = useMemo(() => costMenu(menu, recipes, inventory, branchId), [menu, recipes, inventory, branchId]);
  const sum = useMemo(() => summarize(all, target), [all, target]);
  const needle = q.trim().toLowerCase();
  const rows = all.filter(c => (cat === 'all' || c.categoryId === cat) && (!needle || c.name.toLowerCase().includes(needle)) && (show === 'all' || foodCostStatus(c, target) === show));
  const current = all.find(c => rowKey(c) === selected) ?? null;
  const catName = (id?: string) => categories.find(c => c.id === id)?.name ?? '';
  const setTargetSaved = (n: number) => { const v = Math.min(90, Math.max(5, n || DEFAULT_TARGET_FOOD_COST_PCT)); setTarget(v); try { saveSettings({ ...getSettings(), targetFoodCostPct: v }); } catch { /* the target still applies on this screen */ } };

  const since = Date.now() - days * 86_400_000;
  const eng = useMemo(() => menuEngineering(orders.filter(o => (branchId ? o.branchId === branchId : true) && new Date(o.createdAt).getTime() >= since), all), [orders, all, branchId, since]);

  const reportDoc = (): ReportDoc => ({
    title: 'Recipe costing', subtitle: `Target food cost ${target}%`, filename: 'recipe-costing',
    meta: [...(branchId ? [{ label: 'Branch', value: branches.find(b => b.id === branchId)?.name ?? '' }] : []), ...(sum.avgFoodCostPct !== null ? [{ label: 'Average food cost', value: `${sum.avgFoodCostPct}%` }] : [])],
    columns: [{ key: 'item', label: 'Item' }, { key: 'cost', label: 'Cost', align: 'right' }, { key: 'price', label: 'Price', align: 'right' }, { key: 'profit', label: 'Profit', align: 'right' }, { key: 'fc', label: 'Food cost', align: 'right' }, { key: 'status', label: 'Status' }],
    rows: rows.map(c => ({ item: `${c.name}${c.variantLabel ? ` (${c.variantLabel})` : ''}`, cost: c.hasRecipe ? money(c.productionCost) : '—', price: money(c.price), profit: c.hasRecipe ? money(c.grossProfit) : '—', fc: c.foodCostPct === null ? '—' : `${c.foodCostPct}%`, status: STATUS[foodCostStatus(c, target)].label })),
    notes: ['Cost = ingredients (with waste allowance) + packaging, at each ingredient’s average cost.'],
  });
  const panel = current ? (() => {
    const price = Number(whatIf) > 0 ? Number(whatIf) : current.price;
    const fc = price > 0 && current.hasRecipe ? Math.round((current.productionCost / price) * 1000) / 10 : null;
    const gp = Math.round((price - current.productionCost) * 100) / 100;
    const suggest = suggestedPrice(current.productionCost, target);
    return (
      <div className="space-y-3 text-sm" data-cost-panel={rowKey(current)}>
        <div className="text-xs text-muted-foreground">{[catName(current.categoryId), current.variantLabel].filter(Boolean).join(' · ')}{current.perKg ? ' · per kg' : ''}</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border p-2"><div className="text-[10px] uppercase text-muted-foreground">Cost</div><div className="font-extrabold" data-cost-production>{money(current.productionCost)}</div></div>
          <div className="rounded-xl border p-2"><div className="text-[10px] uppercase text-muted-foreground">Price</div><div className="font-extrabold">{money(price)}</div></div>
          <div className="rounded-xl border p-2"><div className="text-[10px] uppercase text-muted-foreground">Profit</div><div className={cn('font-extrabold', gp < 0 && 'text-destructive')} data-cost-profit>{money(gp)}</div></div>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
          <span>Food cost</span><span className="font-extrabold" data-cost-fc>{fc === null ? '—' : `${fc}%`}</span>
          <span className="text-xs text-muted-foreground">target {target}%</span>
        </div>
        {!current.hasRecipe ? <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground" data-cost-norecipe>This item has no recipe yet, so its cost is not known. Add one in Recipes.</p> : (
          <>
            <div>
              <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Where the cost goes</h4>
              <ul className="divide-y text-xs">
                {current.lines.map(l => (
                  <li key={l.inventoryItemId} className="flex items-center justify-between gap-2 py-1.5" data-cost-line={l.inventoryItemId}>
                    <span className="min-w-0 truncate">{l.name}<span className="block text-[10px] text-muted-foreground">{l.qty} {l.unit}{l.wastePct > 0 ? ` + ${l.wastePct}% waste` : ''}{l.noCost ? ' · no cost yet' : ''}</span></span>
                    <span className="text-right font-semibold">{money(l.cost)}<span className="block text-[10px] font-normal text-muted-foreground">{l.sharePct}%</span></span>
                  </li>
                ))}
                {current.packagingCost > 0 && <li className="flex justify-between py-1.5 text-xs"><span>Packaging</span><span className="font-semibold">{money(current.packagingCost)}</span></li>}
              </ul>
            </div>
            <label className="block text-xs font-semibold text-muted-foreground">What if the price were…
              <Input type="number" min={0} value={whatIf} onChange={e => setWhatIf(e.target.value)} placeholder={String(current.price)} className="mt-1" data-cost-whatif />
            </label>
            <p className="rounded-lg bg-primary/5 p-2.5 text-xs" data-cost-suggest>To reach {target}% the price is <b>{money(suggest)}</b>{suggest > current.price ? ` (${money(suggest - current.price)} more than now)` : ' — the current price already does'}.</p>
          </>
        )}
        {current.usesDefault && <p className="text-[11px] text-amber-700">This size has no recipe of its own; the item’s default recipe is used.</p>}
        {current.warnings.map(w => <p key={w} className="text-[11px] text-amber-700">⚠ {w}</p>)}
      </div>
    );
  })() : null;

  return (
    <div className="space-y-4 p-4 lg:p-6" data-recipe-costing>
      <PageHeader icon={<Calculator />} title="Costing" subtitle="From the ingredient to the production price, gross profit and the menu’s best and weakest dishes — branch by branch" actions={<ReportActions build={reportDoc} disabled={rows.length === 0} />} />
      <FilterBar label="Costing filters">
        <Input type="search" placeholder="Search item" aria-label="Search item" value={q} onChange={e => setQ(e.target.value)} data-filter-grow data-cost-search />
        {branches.length > 1 && (
          <select value={branch} onChange={e => setBranch(e.target.value)} aria-label="Branch" data-cost-branch>
            <option value="all">Recipe prices</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Category" data-cost-cat>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">Target food cost
          <Input type="number" min={5} max={90} value={target} onChange={e => setTargetSaved(Number(e.target.value))} className="w-20" data-cost-target />%
        </label>
      </FilterBar>

      <div className="flex flex-wrap items-center gap-2 text-sm" data-cost-summary>
        <Badge variant="secondary">{sum.costed} of {sum.items} costed</Badge>
        <Badge variant="outline" data-cost-avg>{sum.avgFoodCostPct === null ? 'Average food cost —' : `Average food cost ${sum.avgFoodCostPct}%`}</Badge>
        {(['healthy', 'watch', 'over', 'none'] as const).map(s => (
          <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(show === s ? 'all' : s)} data-cost-show={s}
            className={cn('h-8 rounded-full border-2 px-3 text-xs font-semibold', show === s ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50')}>{STATUS[s].label} · {sum[s]}</button>
        ))}
      </div>

      <Tabs defaultValue="costing">
        <TabsList>
          <TabsTrigger value="costing" data-tab-costing>Costing</TabsTrigger>
          <TabsTrigger value="engineering" data-tab-engineering>Menu engineering</TabsTrigger>
        </TabsList>

        <TabsContent value="costing">
          <MasterDetail
            title={current ? `${current.name}${current.variantLabel ? ` — ${current.variantLabel}` : ''}` : 'Item'} open={!!current} onClose={() => { setSelected(null); setWhatIf(''); }}
            emptyText="Select an item to see where its cost goes and what price reaches your target." dialogClassName="sm:max-w-md max-h-[90vh] overflow-y-auto"
            detail={panel}
            list={rows.length === 0 ? <EmptyState icon={<Calculator />} title="Nothing to show" hint="Add recipes to your menu items, or change the filters." /> : (
              <Table data-cost-table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Food cost</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(c => {
                    const st = foodCostStatus(c, target);
                    return (
                      <TableRow key={rowKey(c)} data-cost-row={rowKey(c)} onClick={() => { setSelected(rowKey(c)); setWhatIf(''); }} className={cn('cursor-pointer', selected === rowKey(c) && 'bg-primary/5')}>
                        <TableCell className="font-semibold">{c.name}{c.variantLabel && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{c.variantLabel}</span>}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.hasRecipe ? money(c.productionCost) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.price)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', c.hasRecipe && c.grossProfit < 0 && 'text-destructive')}>{c.hasRecipe ? money(c.grossProfit) : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.foodCostPct === null ? '—' : `${c.foodCostPct}%`}</TableCell>
                        <TableCell><Badge className={cn('text-[10px]', STATUS[st].cls)}>{STATUS[st].label}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          />
        </TabsContent>

        <TabsContent value="engineering" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5 font-semibold">Sales of the last
              <select value={days} onChange={e => setDays(Number(e.target.value))} data-eng-days>
                {[7, 30, 90].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <span>Popular = at least 70% of an equal share of units sold ({eng.popularityBar}%) · profitable = contribution per unit at or above the average ({money(eng.avgCm)}).</span>
          </div>
          {eng.rows.length === 0 ? <EmptyState icon={<Calculator />} title="Not enough sales with recipes" hint="Menu engineering needs sold items that have a recipe — it fills in as you trade." /> : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-eng-cards>
                {(Object.keys(MENU_CLASS_ADVICE) as (keyof typeof MENU_CLASS_ADVICE)[]).map(k => (
                  <div key={k} className="rounded-2xl border bg-card p-3" data-eng-class={k}>
                    <div className="flex items-center justify-between"><Badge className={cn('text-[10px]', CLASS_TONE[k])}>{MENU_CLASS_ADVICE[k].label}</Badge><span className="text-lg font-extrabold">{eng.rows.filter(r => r.cls === k).length}</span></div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{MENU_CLASS_ADVICE[k].advice}</p>
                  </div>
                ))}
              </div>
              <Table data-eng-table>
                <TableHeader>
                  <TableRow><TableHead>Item</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Share</TableHead><TableHead className="text-right">Per unit</TableHead><TableHead className="text-right">Contribution</TableHead><TableHead>Class</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {eng.rows.map(r => (
                    <TableRow key={r.menuItemId} data-eng-row={r.menuItemId}>
                      <TableCell className="font-semibold">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.sharePct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.cmPerUnit)}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{money(r.contribution)}</TableCell>
                      <TableCell><Badge className={cn('text-[10px]', CLASS_TONE[r.cls])}>{MENU_CLASS_ADVICE[r.cls].label}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </TabsContent>
      </Tabs>
      <p className="text-[11px] text-muted-foreground">
        Costs use each ingredient’s average purchase cost (for a branch, that branch’s own price). The waste allowance and packaging are costing figures — stock still moves by the recipe quantity, and anything extra that was really used shows up when you count the shelves.
      </p>
    </div>
  );
}
