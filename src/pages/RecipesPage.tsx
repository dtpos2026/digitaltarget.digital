import { useState, useMemo } from 'react';
import { money } from '@/lib/currency';
import { MenuItem, InventoryItem, Recipe, RecipeComponent } from '@/lib/types';
import {
  getMenuItems, getInventory, getRecipes, saveRecipe, deleteRecipe, genId,
} from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SearchableSelect from '@/components/SearchableSelect';
import { BookOpen, Plus, Trash2, Edit, Search, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { RECIPE_UNITS, getBaseUnit, toBaseQty, isCompatible } from '@/lib/units';

// Build list of variant options for a menu item (size + inch). Returns [{key, label, price}].
type VariantOpt = { key: string; label: string; price: number };
function variantsFor(m: MenuItem): VariantOpt[] {
  const out: VariantOpt[] = [];
  for (const v of (m.sizeVariants || [])) out.push({ key: `size:${v.name}`, label: `Size: ${v.name}`, price: v.price || 0 });
  for (const v of (m.inchVariants || [])) out.push({ key: `inch:${v.name}`, label: `Inch: ${v.name}`, price: v.price || 0 });
  return out;
}

export default function RecipesPage() {
  const [menuItems] = useState<MenuItem[]>(() => getMenuItems());
  const [inventory] = useState<InventoryItem[]>(() => getInventory());
  const [recipes, setRecipes] = useState<Recipe[]>(() => getRecipes());
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  // editing represents either the default recipe (variantKey='') or a specific variant.
  const [editing, setEditing] = useState<{ menuItem: MenuItem; variantKey: string; recipe: Recipe } | null>(null);
  const [components, setComponents] = useState<RecipeComponent[]>([]);
  const [notes, setNotes] = useState('');

  const refresh = () => setRecipes(getRecipes());

  type Row = { menuItem: MenuItem; variantKey: string; variantLabel: string; recipe?: Recipe; cost: number; sale: number; margin: number };

  const rows = useMemo<Row[]>(() => {
    const q = search.toLowerCase();
    const out: Row[] = [];
    for (const m of menuItems) {
      if (!m.isActive) continue;
      if (q && !m.name.toLowerCase().includes(q)) continue;
      const variants = variantsFor(m);
      // Build one row per variant + always a "default" row for non-variant items.
      const targets: Array<{ key: string; label: string; sale: number }> = variants.length
        ? variants.map(v => ({ key: v.key, label: v.label, sale: v.price }))
        : [{ key: '', label: '—', sale: m.pricingType === 'weight' ? m.ratePerKg : m.price }];
      for (const t of targets) {
        const r = recipes.find(x => x.menuItemId === m.id && (x.variantKey || '') === t.key);
        const cost = r ? r.components.reduce((sum, c) => {
          const inv = inventory.find(i => i.id === c.inventoryItemId);
          if (!inv) return sum;
          const perBase = toBaseQty(inv, c.quantity, c.unit);
          const unitCost = inv.avgCostPrice ?? inv.costPrice ?? 0;
          return sum + unitCost * perBase;
        }, 0) : 0;
        const margin = t.sale > 0 ? ((t.sale - cost) / t.sale) * 100 : 0;
        out.push({ menuItem: m, variantKey: t.key, variantLabel: t.label, recipe: r, cost, sale: t.sale, margin });
      }
    }
    return out;
  }, [menuItems, recipes, inventory, search]);

  const openEdit = (menuItem: MenuItem, variantKey: string) => {
    const r = recipes.find(x => x.menuItemId === menuItem.id && (x.variantKey || '') === variantKey);
    const id = r?.id || (variantKey ? `${menuItem.id}__${variantKey}` : menuItem.id);
    setEditing({
      menuItem,
      variantKey,
      recipe: r || { id, menuItemId: menuItem.id, variantKey: variantKey || undefined, components: [] },
    });
    setComponents(r ? [...r.components] : []);
    setNotes(r?.notes || '');
    setOpen(true);
  };

  const addRow = () => setComponents(c => [...c, { inventoryItemId: '', quantity: 0, unit: 'g' }]);
  const removeRow = (idx: number) => setComponents(c => c.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<RecipeComponent>) =>
    setComponents(c => c.map((x, i) => i === idx ? { ...x, ...patch } : x));

  const save = () => {
    if (!editing) return;
    const cleaned = components.filter(c => c.inventoryItemId && c.quantity > 0);
    if (!cleaned.length) {
      // Delete recipe if user removed all components
      if (recipes.find(r => r.id === editing.recipe.id)) deleteRecipe(editing.recipe.id);
      toast.success('Recipe cleared');
      setOpen(false); refresh(); return;
    }
    const r: Recipe = { ...editing.recipe, components: cleaned, notes };
    saveRecipe(r);
    toast.success('Recipe saved');
    setOpen(false);
    refresh();
  };

  const currentCost = useMemo(() => components.reduce((sum, c) => {
    const inv = inventory.find(i => i.id === c.inventoryItemId);
    if (!inv) return sum;
    const perBase = toBaseQty(inv, c.quantity, c.unit);
    const unitCost = inv.avgCostPrice ?? inv.costPrice ?? 0;
    return sum + unitCost * perBase;
  }, 0), [components, inventory]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" /> Recipes & Food Cost
        </h2>
        <div className="text-xs text-muted-foreground">
          {recipes.length} of {menuItems.length} items have recipes
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search menu item..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
      </div>

      {inventory.length === 0 && (
        <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-3 text-sm">
          ⚠️ Pehle <strong>Inventory</strong> mein ingredients add karein, phir un ko recipes mein link kar sakte hain.
        </div>
      )}

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2.5 px-3 font-bold">Menu Item</th>
                <th className="text-center py-2.5 px-3 font-bold">Ingredients</th>
                <th className="text-right py-2.5 px-3 font-bold">Food Cost</th>
                <th className="text-right py-2.5 px-3 font-bold">Sale</th>
                <th className="text-right py-2.5 px-3 font-bold">Margin %</th>
                <th className="text-center py-2.5 px-3 font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No menu items. Add items in Menu first.</td></tr>
              ) : rows.map(({ menuItem, variantKey, variantLabel, recipe, cost, sale, margin }, idx) => (
                <tr key={menuItem.id + '__' + variantKey} className={`border-b hover:bg-accent/30 ${idx % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="py-2 px-3 font-semibold">
                    {menuItem.name}
                    {variantKey && <span className="ml-2 text-xs font-normal text-primary">· {variantLabel}</span>}
                  </td>
                  <td className="py-2 px-3 text-center">
                    {recipe ? (
                      <Badge className="bg-status-success/20 text-status-success">{recipe.components.length} items</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">No recipe</Badge>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">{recipe ? `${money(cost.toFixed(0))}` : '—'}</td>
                  <td className="py-2 px-3 text-right text-primary font-bold">{money(sale)}{menuItem.pricingType === 'weight' && !variantKey && '/kg'}</td>
                  <td className={`py-2 px-3 text-right font-bold ${margin < 30 ? 'text-destructive' : margin < 50 ? 'text-status-warning' : 'text-status-success'}`}>
                    {recipe ? `${margin.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <Button size="sm" variant="outline" onClick={() => openEdit(menuItem, variantKey)}>
                      <Edit className="h-3.5 w-3.5 mr-1" /> {recipe ? 'Edit' : 'Build'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" /> Recipe — {editing?.menuItem.name}
              {editing?.variantKey && (
                <span className="text-sm font-normal text-primary">· {editing.variantKey.split(':')[1]}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="bg-muted/30 rounded p-3 text-xs text-muted-foreground">
              Jab is item ka order <strong>paid</strong> hota hai, neeche di gayi quantities automatically inventory se deduct ho jati hain.
              {editing?.variantKey && (
                <> Yeh recipe sirf <strong>{editing.variantKey.split(':')[1]}</strong> variant ke liye apply hogi.</>
              )}
              {editing?.menuItem.pricingType === 'weight' && !editing?.variantKey && (
                <> Weight-based item ke liye quantities <strong>per 1 kg</strong> menu item enter karein.</>
              )}
              {editing?.menuItem.pricingType !== 'weight' && (
                <> Quantities <strong>per 1 unit/plate</strong> enter karein.</>
              )}
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pos-scrollbar">
              {components.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">No ingredients added yet.</p>
              )}
              {components.map((c, idx) => {
                const inv = inventory.find(i => i.id === c.inventoryItemId);
                const perBase = inv ? toBaseQty(inv, c.quantity, c.unit) : c.quantity;
                const unitCost = inv ? (inv.avgCostPrice ?? inv.costPrice ?? 0) : 0;
                const lineCost = unitCost * perBase;
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-accent/20 rounded p-2">
                    <div className="col-span-5">
                      <SearchableSelect
                        placeholder="Ingredient..."
                        searchPlaceholder="Search ingredient..."
                        value={c.inventoryItemId}
                        onChange={(v) => {
                          const it = inventory.find(i => i.id === v);
                          updateRow(idx, { inventoryItemId: v, unit: it ? getBaseUnit(it) : c.unit });
                        }}
                        options={inventory.map(i => ({
                          value: i.id,
                          label: i.name,
                          hint: `${money(i.avgCostPrice?.toFixed(0) ?? i.costPrice)}/${getBaseUnit(i)}`,
                        }))}
                        triggerClassName="h-9"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input type="number" step="0.01" value={c.quantity || ''} onChange={e => updateRow(idx, { quantity: parseFloat(e.target.value) || 0 })} placeholder="Qty" className="h-9" />
                    </div>
                    <div className="col-span-3">
                      <Select value={c.unit || (inv ? getBaseUnit(inv) : 'g')} onValueChange={(v) => updateRow(idx, { unit: v })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RECIPE_UNITS.map(u => {
                            const ok = !inv || isCompatible(inv, u);
                            return <SelectItem key={u} value={u} disabled={!ok}>{u}{!ok ? ' (incompatible)' : ''}</SelectItem>;
                          })}
                          {(inv?.conversions || []).map(cv => (
                            <SelectItem key={cv.unit} value={cv.unit}>{cv.unit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1 text-xs text-right font-semibold">{money(lineCost.toFixed(0))}</div>
                    <div className="col-span-1 text-right">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => removeRow(idx)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button variant="outline" size="sm" onClick={addRow} className="w-full">
              <Plus className="h-4 w-4 mr-1" /> Add Ingredient
            </Button>

            <Input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />

            <div className="flex items-center justify-between bg-primary/10 border border-primary/30 rounded p-3">
              <span className="text-sm font-semibold flex items-center gap-2"><Calculator className="h-4 w-4" /> Food Cost</span>
              <span className="text-lg font-bold text-primary">{money(currentCost.toFixed(0))}</span>
            </div>

            <Button className="w-full" onClick={save}>Save Recipe</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
