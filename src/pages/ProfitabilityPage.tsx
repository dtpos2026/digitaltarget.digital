import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getOrders, getRecipes, getInventory, getWastages, getMenuItems } from '@/lib/store';
import { Recipe, InventoryItem, Wastage, CartItem } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, DollarSign, Trash2, Percent, Award } from 'lucide-react';
import DateTimeRangeFilter, { DateTimeRange } from '@/components/DateTimeRangeFilter';
import { getCurrentBusinessDay, getBusinessDayRange } from '@/lib/businessDay';

import { toBaseQty } from '@/lib/units';

function lineFoodCost(line: CartItem, recipes: Recipe[], inv: InventoryItem[]): number {
  const recipe = recipes.find(r => r.menuItemId === line.menuItemId);
  if (!recipe) return 0;
  const multiplier = line.pricingType === 'weight'
    ? (line.weightGrams || 0) / 1000
    : (line.quantity || 0);
  let cost = 0;
  for (const c of recipe.components) {
    const item = inv.find(i => i.id === c.inventoryItemId);
    if (!item) continue;
    const perBase = toBaseQty(item, c.quantity, c.unit);
    const unitCost = item.avgCostPrice ?? item.costPrice ?? 0;
    cost += unitCost * perBase * multiplier;
  }
  return cost;
}

export default function ProfitabilityPage() {
  const [range, setRange] = useState<DateTimeRange>(() => {
    const w = getBusinessDayRange(30);
    const today = getCurrentBusinessDay();
    return { startMs: w.startMs, endMs: today.endMs, preset: 'month' };
  });
  const orders = useMemo(() => getOrders(), []);
  const recipes = useMemo(() => getRecipes(), []);
  const inventory = useMemo(() => getInventory(), []);
  const wastages = useMemo(() => getWastages(), []);
  const menuItems = useMemo(() => getMenuItems(), []);

  const paidOrders = useMemo(
    () => orders.filter(o => {
      if (o.status !== 'paid') return false;
      const t = new Date(o.paidAt || o.createdAt).getTime();
      return t >= range.startMs && t < range.endMs;
    }),
    [orders, range.startMs, range.endMs]
  );

  const stats = useMemo(() => {
    let revenue = 0;
    let foodCost = 0;
    let withRecipeRevenue = 0;
    const perItem = new Map<string, { name: string; revenue: number; cost: number; qty: number }>();
    for (const o of paidOrders) {
      for (const line of o.items) {
        const r = line.lineTotal || 0;
        const c = lineFoodCost(line, recipes, inventory);
        revenue += r;
        foodCost += c;
        const hasRecipe = recipes.some(rc => rc.menuItemId === line.menuItemId);
        if (hasRecipe) withRecipeRevenue += r;
        const e = perItem.get(line.menuItemId) || { name: line.name, revenue: 0, cost: 0, qty: 0 };
        e.revenue += r; e.cost += c;
        e.qty += line.pricingType === 'weight' ? ((line.weightGrams || 0) / 1000) : (line.quantity || 0);
        perItem.set(line.menuItemId, e);
      }
    }
    const wastageCost = wastages
      .filter(w => { const t = new Date(w.date).getTime(); return t >= range.startMs && t < range.endMs; })
      .reduce((s, w) => s + (w.costValue || 0), 0);
    const grossProfit = revenue - foodCost;
    const netProfit = grossProfit - wastageCost;
    const foodCostPct = withRecipeRevenue > 0 ? (foodCost / withRecipeRevenue) * 100 : 0;
    const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const itemRows = Array.from(perItem.values()).map(e => ({
      ...e,
      profit: e.revenue - e.cost,
      margin: e.revenue > 0 ? ((e.revenue - e.cost) / e.revenue) * 100 : 0,
    }));
    return { revenue, foodCost, wastageCost, grossProfit, netProfit, foodCostPct, marginPct, withRecipeRevenue, itemRows };
  }, [paidOrders, recipes, inventory, wastages, range.startMs, range.endMs]);

  const topByRevenue = useMemo(() => stats.itemRows.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 10), [stats]);
  const topByMargin = useMemo(() => stats.itemRows.filter(r => r.cost > 0).sort((a, b) => b.margin - a.margin).slice(0, 10), [stats]);
  const worstByMargin = useMemo(() => stats.itemRows.filter(r => r.cost > 0).sort((a, b) => a.margin - b.margin).slice(0, 5), [stats]);

  const recipeCoverage = useMemo(() => {
    const activeItems = menuItems.filter(m => m.isActive).length;
    return activeItems > 0 ? (recipes.length / activeItems) * 100 : 0;
  }, [menuItems, recipes]);

  const fmt = (n: number) => `${money(Math.round(n))}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const marginColor = (m: number) => m >= 50 ? 'text-emerald-600' : m >= 30 ? 'text-amber-600' : 'text-destructive';
  const fcpColor = stats.foodCostPct === 0 ? 'text-muted-foreground' : stats.foodCostPct <= 35 ? 'text-emerald-600' : stats.foodCostPct <= 45 ? 'text-amber-600' : 'text-destructive';

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Profitability Dashboard</h2>
        <DateTimeRangeFilter value={range} onChange={setRange} />
      </div>

      {recipeCoverage < 50 && (
        <Card className="p-3 bg-amber-50 border-amber-200 text-amber-900 text-xs">
          ⚠️ Only {recipes.length} of {menuItems.filter(m => m.isActive).length} active menu items have recipes.
          Add recipes (Inventory → Recipes) for accurate food cost analysis.
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Revenue</div>
          <div className="text-lg font-bold text-primary">{fmt(stats.revenue)}</div>
          <div className="text-[10px] text-muted-foreground">{paidOrders.length} orders</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Food Cost</div>
          <div className="text-lg font-bold">{fmt(stats.foodCost)}</div>
          <div className="text-[10px] text-muted-foreground">Recipe-based</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Percent className="h-3 w-3" /> Food Cost %</div>
          <div className={`text-lg font-bold ${fcpColor}`}>{pct(stats.foodCostPct)}</div>
          <div className="text-[10px] text-muted-foreground">Target: 30–35%</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gross Profit</div>
          <div className="text-lg font-bold text-emerald-600">{fmt(stats.grossProfit)}</div>
          <div className="text-[10px] text-muted-foreground">{pct(stats.marginPct)} margin</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Trash2 className="h-3 w-3" /> Wastage</div>
          <div className="text-lg font-bold text-destructive">{fmt(stats.wastageCost)}</div>
          <div className="text-[10px] text-muted-foreground">Loss</div>
        </Card>
        <Card className="p-3 bg-primary/5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Net Profit</div>
          <div className={`text-lg font-bold ${stats.netProfit >= 0 ? 'text-emerald-700' : 'text-destructive'}`}>{fmt(stats.netProfit)}</div>
          <div className="text-[10px] text-muted-foreground">After wastage</div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Top by revenue */}
        <Card className="p-3">
          <div className="text-sm font-semibold mb-2 flex items-center gap-2"><Award className="h-4 w-4" /> Top Items by Revenue</div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b">
              <tr><th className="text-left py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Revenue</th><th className="text-right">Margin</th></tr>
            </thead>
            <tbody>
              {topByRevenue.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5 font-medium truncate max-w-[140px]">{r.name}</td>
                  <td className="text-right">{r.qty.toFixed(1)}</td>
                  <td className="text-right">{fmt(r.revenue)}</td>
                  <td className={`text-right font-semibold ${marginColor(r.margin)}`}>{r.cost > 0 ? pct(r.margin) : '—'}</td>
                </tr>
              ))}
              {topByRevenue.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-muted-foreground">No data</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Top by margin */}
        <Card className="p-3">
          <div className="text-sm font-semibold mb-2 flex items-center gap-2 text-emerald-700"><TrendingUp className="h-4 w-4" /> Best Margin Items</div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b">
              <tr><th className="text-left py-1">Item</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th className="text-right">Margin</th></tr>
            </thead>
            <tbody>
              {topByMargin.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5 font-medium truncate max-w-[140px]">{r.name}</td>
                  <td className="text-right">{fmt(r.revenue)}</td>
                  <td className="text-right text-emerald-700">{fmt(r.profit)}</td>
                  <td className={`text-right font-bold ${marginColor(r.margin)}`}>{pct(r.margin)}</td>
                </tr>
              ))}
              {topByMargin.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-muted-foreground">Add recipes to see margins</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Worst margin alert */}
        {worstByMargin.length > 0 && (
          <Card className="p-3 lg:col-span-2 border-destructive/30">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2 text-destructive"><TrendingDown className="h-4 w-4" /> Low-Margin Items (review pricing or recipe)</div>
            <div className="flex flex-wrap gap-2">
              {worstByMargin.map((r, i) => (
                <Badge key={i} variant="outline" className={`${marginColor(r.margin)} border-current`}>
                  {r.name} — {pct(r.margin)}
                </Badge>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
