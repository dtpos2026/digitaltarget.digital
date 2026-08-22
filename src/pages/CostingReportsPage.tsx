import { useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { getOrders, getInventory, getRecipes, getSettings } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Printer, TrendingUp, Soup, Package, Boxes } from 'lucide-react';
import { toBaseQty, getBaseUnit } from '@/lib/units';
import DateTimeRangeFilter, { DateTimeRange } from '@/components/DateTimeRangeFilter';
import { getCurrentBusinessDay } from '@/lib/businessDay';

const fmt = (n: number) => `${money((Math.round(n) || 0).toLocaleString('en-PK'))}`;

export default function CostingReportsPage() {
  const settings = getSettings();
  const costEnabled = !!settings.costTrackingEnabled;

  const [range, setRange] = useState<DateTimeRange>(() => {
    const bd = getCurrentBusinessDay();
    return { startMs: bd.startMs, endMs: bd.endMs, preset: 'today' };
  });

  const orders = getOrders().filter(o => o.status === 'paid');
  const inventory = getInventory();
  const recipes = getRecipes();

  const inv = useMemo(() => Object.fromEntries(inventory.map(i => [i.id, i])), [inventory]);
  const recipeByMenu = useMemo(() => Object.fromEntries(recipes.map(r => [r.menuItemId, r])), [recipes]);

  const inRange = (d: string) => {
    const t = new Date(d).getTime();
    return t >= range.startMs && t < range.endMs;
  };

  const filteredOrders = orders.filter(o => inRange(o.createdAt));

  /** Compute cost of 1 unit of a menu item using its recipe. */
  const menuItemCost = (menuItemId: string): number => {
    const r = recipeByMenu[menuItemId];
    if (!r) return 0;
    let cost = 0;
    for (const c of r.components) {
      const item = inv[c.inventoryItemId];
      if (!item) continue;
      const baseQty = toBaseQty(item, c.quantity, c.unit);
      const unitCost = item.avgCostPrice ?? item.costPrice ?? 0;
      cost += baseQty * unitCost;
    }
    return cost;
  };

  // ===== Food Cost Report (per menu item) =====
  const foodCostRows = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; sales: number; cost: number }>();
    for (const o of filteredOrders) {
      for (const it of o.items) {
        const m = map.get(it.menuItemId) || { name: it.name, qty: 0, sales: 0, cost: 0 };
        m.qty += it.pricingType === 'weight' ? ((it.weightGrams || 0) / 1000) : it.quantity;
        m.sales += it.lineTotal;
        m.cost += menuItemCost(it.menuItemId) * (it.pricingType === 'weight' ? ((it.weightGrams || 0) / 1000) : it.quantity);
        map.set(it.menuItemId, m);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales);
  }, [filteredOrders]);

  const totals = foodCostRows.reduce(
    (a, r) => ({ qty: a.qty + r.qty, sales: a.sales + r.sales, cost: a.cost + r.cost }),
    { qty: 0, sales: 0, cost: 0 },
  );
  const foodCostPct = totals.sales > 0 ? (totals.cost / totals.sales) * 100 : 0;

  // ===== Ingredient Consumption =====
  const consumptionRows = useMemo(() => {
    const map = new Map<string, { name: string; baseUnit: string; qty: number; cost: number }>();
    for (const o of filteredOrders) {
      for (const it of o.items) {
        const r = recipeByMenu[it.menuItemId];
        if (!r) continue;
        const multiplier = it.pricingType === 'weight' ? ((it.weightGrams || 0) / 1000) : it.quantity;
        for (const c of r.components) {
          const item = inv[c.inventoryItemId];
          if (!item) continue;
          const baseQty = toBaseQty(item, c.quantity, c.unit) * multiplier;
          const unitCost = item.avgCostPrice ?? item.costPrice ?? 0;
          const prev = map.get(item.id) || { name: item.name, baseUnit: getBaseUnit(item), qty: 0, cost: 0 };
          prev.qty += baseQty;
          prev.cost += baseQty * unitCost;
          map.set(item.id, prev);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
  }, [filteredOrders]);

  // ===== Inventory Valuation =====
  const valuationRows = useMemo(() => {
    return inventory
      .filter(i => i.isActive !== false)
      .map(i => {
        const cost = i.avgCostPrice ?? i.costPrice ?? 0;
        return {
          name: i.name,
          unit: getBaseUnit(i),
          qty: i.quantity || 0,
          cost,
          value: (i.quantity || 0) * cost,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [inventory]);

  const totalValuation = valuationRows.reduce((s, r) => s + r.value, 0);

  // ===== Profitability summary =====
  const profitRows = foodCostRows.map(r => ({
    ...r,
    profit: r.sales - r.cost,
    margin: r.sales > 0 ? ((r.sales - r.cost) / r.sales) * 100 : 0,
  }));
  const totalProfit = totals.sales - totals.cost;
  const totalMargin = totals.sales > 0 ? (totalProfit / totals.sales) * 100 : 0;

  const printReport = (title: string, html: string) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>${title}</title>
      <style>body{font-family:Arial;padding:18px;font-size:12px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#800020;color:#fff}.r{text-align:right}</style>
      </head><body>
      <h2>${settings.name || 'DT POS'}</h2>
      <div>${title} — ${new Date(range.startMs).toLocaleString('en-PK')} to ${new Date(range.endMs).toLocaleString('en-PK')}</div>
      ${html}
      </body></html>`);
    w.document.close();
    w.print();
  };

  if (!costEnabled) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto bg-card border rounded-xl p-6 text-center space-y-3">
          <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="text-lg font-bold">Cost Reports Disabled</h2>
          <p className="text-sm text-muted-foreground">
            Food cost, profit & inventory valuation reports show only when "Food Cost & Profit Tracking" is enabled in Settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">Costing & Profit Reports</h2>
        <div className="ml-auto">
          <DateTimeRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Sales</p>
          <p className="text-xl font-bold text-primary">{fmt(totals.sales)}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Total Food Cost</p>
          <p className="text-xl font-bold text-status-warning">{fmt(totals.cost)}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Profit</p>
          <p className="text-xl font-bold text-status-success">{fmt(totalProfit)}</p>
        </div>
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Food Cost %</p>
          <p className="text-xl font-bold">{foodCostPct.toFixed(1)}% <span className="text-xs text-muted-foreground">/ Margin {totalMargin.toFixed(1)}%</span></p>
        </div>
      </div>

      <Tabs defaultValue="foodcost" className="w-full">
        <TabsList>
          <TabsTrigger value="foodcost"><Soup className="h-3.5 w-3.5 mr-1" />Food Cost</TabsTrigger>
          <TabsTrigger value="profit"><TrendingUp className="h-3.5 w-3.5 mr-1" />Profitability</TabsTrigger>
          <TabsTrigger value="consumption"><Package className="h-3.5 w-3.5 mr-1" />Consumption</TabsTrigger>
          <TabsTrigger value="valuation"><Boxes className="h-3.5 w-3.5 mr-1" />Inventory Valuation</TabsTrigger>
        </TabsList>

        {/* FOOD COST */}
        <TabsContent value="foodcost">
          <div className="bg-card border rounded-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <h3 className="text-sm font-semibold">Food Cost by Item</h3>
              <Button size="sm" variant="outline" onClick={() => printReport('Food Cost Report',
                `<table><thead><tr><th>Item</th><th class="r">Qty Sold</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">FC%</th></tr></thead><tbody>
                ${foodCostRows.map(r => `<tr><td>${r.name}</td><td class="r">${r.qty}</td><td class="r">${fmt(r.sales)}</td><td class="r">${fmt(r.cost)}</td><td class="r">${r.sales > 0 ? ((r.cost / r.sales) * 100).toFixed(1) : '—'}%</td></tr>`).join('')}
                <tr><th>Total</th><th class="r">${totals.qty}</th><th class="r">${fmt(totals.sales)}</th><th class="r">${fmt(totals.cost)}</th><th class="r">${foodCostPct.toFixed(1)}%</th></tr>
                </tbody></table>`)}><Printer className="h-3 w-3 mr-1" />Print</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">FC %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {foodCostRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">{r.qty}</TableCell>
                    <TableCell className="text-right">{fmt(r.sales)}</TableCell>
                    <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                    <TableCell className="text-right">{r.sales > 0 ? ((r.cost / r.sales) * 100).toFixed(1) : '—'}%</TableCell>
                  </TableRow>
                ))}
                {foodCostRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No sales in range</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* PROFITABILITY */}
        <TabsContent value="profit">
          <div className="bg-card border rounded-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <h3 className="text-sm font-semibold">Profitability by Item</h3>
              <Button size="sm" variant="outline" onClick={() => printReport('Profitability Report',
                `<table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">Profit</th><th class="r">Margin%</th></tr></thead><tbody>
                ${profitRows.map(r => `<tr><td>${r.name}</td><td class="r">${r.qty}</td><td class="r">${fmt(r.sales)}</td><td class="r">${fmt(r.cost)}</td><td class="r">${fmt(r.profit)}</td><td class="r">${r.margin.toFixed(1)}%</td></tr>`).join('')}
                <tr><th>Total</th><th class="r">${totals.qty}</th><th class="r">${fmt(totals.sales)}</th><th class="r">${fmt(totals.cost)}</th><th class="r">${fmt(totalProfit)}</th><th class="r">${totalMargin.toFixed(1)}%</th></tr>
                </tbody></table>`)}><Printer className="h-3 w-3 mr-1" />Print</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin %</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {profitRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">{r.qty}</TableCell>
                    <TableCell className="text-right">{fmt(r.sales)}</TableCell>
                    <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                    <TableCell className={`text-right font-semibold ${r.profit >= 0 ? 'text-status-success' : 'text-destructive'}`}>{fmt(r.profit)}</TableCell>
                    <TableCell className="text-right">{r.margin.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
                {profitRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No data</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* CONSUMPTION */}
        <TabsContent value="consumption">
          <div className="bg-card border rounded-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <h3 className="text-sm font-semibold">Ingredient Consumption</h3>
              <Button size="sm" variant="outline" onClick={() => printReport('Ingredient Consumption',
                `<table><thead><tr><th>Ingredient</th><th class="r">Qty Used</th><th>Unit</th><th class="r">Cost Value</th></tr></thead><tbody>
                ${consumptionRows.map(r => `<tr><td>${r.name}</td><td class="r">${r.qty.toFixed(2)}</td><td>${r.baseUnit}</td><td class="r">${fmt(r.cost)}</td></tr>`).join('')}
                </tbody></table>`)}><Printer className="h-3 w-3 mr-1" />Print</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Ingredient</TableHead><TableHead className="text-right">Qty Used</TableHead>
                <TableHead>Unit</TableHead><TableHead className="text-right">Cost Value</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {consumptionRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">{r.qty.toFixed(2)}</TableCell>
                    <TableCell>{r.baseUnit}</TableCell>
                    <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                  </TableRow>
                ))}
                {consumptionRows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No recipes consumed in range</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* VALUATION */}
        <TabsContent value="valuation">
          <div className="bg-card border rounded-xl">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <h3 className="text-sm font-semibold">Inventory Valuation <span className="text-xs text-muted-foreground">(current stock × avg cost)</span></h3>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-primary">Total: {fmt(totalValuation)}</span>
                <Button size="sm" variant="outline" onClick={() => printReport('Inventory Valuation',
                  `<table><thead><tr><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Avg Cost</th><th class="r">Value</th></tr></thead><tbody>
                  ${valuationRows.map(r => `<tr><td>${r.name}</td><td class="r">${r.qty}</td><td>${r.unit}</td><td class="r">${fmt(r.cost)}</td><td class="r">${fmt(r.value)}</td></tr>`).join('')}
                  <tr><th colspan="4">Total Valuation</th><th class="r">${fmt(totalValuation)}</th></tr>
                  </tbody></table>`)}><Printer className="h-3 w-3 mr-1" />Print</Button>
              </div>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead><TableHead className="text-right">Avg Cost</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {valuationRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">{r.qty}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="text-right">{fmt(r.cost)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(r.value)}</TableCell>
                  </TableRow>
                ))}
                {valuationRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No inventory items</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
