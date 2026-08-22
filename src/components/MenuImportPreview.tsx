// Menu Import Preview — shows what will be added/updated before saving
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, RefreshCw, Plus, AlertCircle } from 'lucide-react';
import type { Category, MenuItem, InventoryItem } from '@/lib/types';

interface ImportData {
  categories: Category[];
  menuItems: MenuItem[];
  inventory: InventoryItem[];
}

interface Props {
  data: ImportData;
  existingCategories: Category[];
  existingItems: MenuItem[];
  existingInventory: InventoryItem[];
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}

export default function MenuImportPreview({
  data, existingCategories, existingItems, existingInventory, onConfirm, onCancel, saving,
}: Props) {
  const [tab, setTab] = useState<'categories' | 'items' | 'inventory'>('items');

  const diff = useMemo(() => {
    const exCatIds = new Set(existingCategories.map(c => c.id));
    const exItemIds = new Set(existingItems.map(i => i.id));
    const exInvIds = new Set(existingInventory.map(i => i.id));

    const newCats = data.categories.filter(c => !exCatIds.has(c.id));
    const updCats = data.categories.filter(c => exCatIds.has(c.id));
    const newItems = data.menuItems.filter(i => !exItemIds.has(i.id));
    const updItems = data.menuItems.filter(i => exItemIds.has(i.id));
    const newInv = data.inventory.filter(i => !exInvIds.has(i.id));
    const updInv = data.inventory.filter(i => exInvIds.has(i.id));

    return { newCats, updCats, newItems, updItems, newInv, updInv };
  }, [data, existingCategories, existingItems, existingInventory]);

  const totalNew = diff.newCats.length + diff.newItems.length + diff.newInv.length;
  const totalUpd = diff.updCats.length + diff.updItems.length + diff.updInv.length;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-violet-600" /> Import Preview
          </DialogTitle>
        </DialogHeader>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <SummaryCard label="Categories" newN={diff.newCats.length} updN={diff.updCats.length} />
          <SummaryCard label="Menu Items" newN={diff.newItems.length} updN={diff.updItems.length} />
          <SummaryCard label="Ingredients" newN={diff.newInv.length} updN={diff.updInv.length} />
        </div>

        <div className="flex gap-2 border-b pt-2">
          <TabBtn active={tab === 'categories'} onClick={() => setTab('categories')}>
            Categories ({data.categories.length})
          </TabBtn>
          <TabBtn active={tab === 'items'} onClick={() => setTab('items')}>
            Menu Items ({data.menuItems.length})
          </TabBtn>
          <TabBtn active={tab === 'inventory'} onClick={() => setTab('inventory')}>
            Ingredients ({data.inventory.length})
          </TabBtn>
        </div>

        <div className="flex-1 overflow-y-auto border rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Name</th>
                {tab !== 'categories' && <th className="text-left px-3 py-2">Category</th>}
                {tab === 'items' && <th className="text-right px-3 py-2">Price</th>}
                {tab === 'inventory' && <th className="text-right px-3 py-2">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {tab === 'categories' && data.categories.map(c => {
                const isNew = diff.newCats.some(x => x.id === c.id);
                return (
                  <tr key={c.id} className="border-b">
                    <td className="px-3 py-1.5"><ActionBadge isNew={isNew} /></td>
                    <td className="px-3 py-1.5 font-medium">{c.icon} {c.name}</td>
                  </tr>
                );
              })}
              {tab === 'items' && data.menuItems.map(it => {
                const isNew = diff.newItems.some(x => x.id === it.id);
                const cat = data.categories.find(c => c.id === it.categoryId)?.name || existingCategories.find(c => c.id === it.categoryId)?.name || '—';
                return (
                  <tr key={it.id} className="border-b">
                    <td className="px-3 py-1.5"><ActionBadge isNew={isNew} /></td>
                    <td className="px-3 py-1.5 font-medium">{it.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{cat}</td>
                    <td className="px-3 py-1.5 text-right">PKR {it.price || it.ratePerKg || 0}</td>
                  </tr>
                );
              })}
              {tab === 'inventory' && data.inventory.map(iv => {
                const isNew = diff.newInv.some(x => x.id === iv.id);
                const cat = data.categories.find(c => c.id === iv.categoryId)?.name || existingCategories.find(c => c.id === iv.categoryId)?.name || '—';
                return (
                  <tr key={iv.id} className="border-b">
                    <td className="px-3 py-1.5"><ActionBadge isNew={isNew} /></td>
                    <td className="px-3 py-1.5 font-medium">{iv.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{cat}</td>
                    <td className="px-3 py-1.5 text-right">PKR {iv.costPrice || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-muted-foreground">
          <span className="font-bold text-green-600">{totalNew}</span> new entries will be added · {' '}
          <span className="font-bold text-blue-600">{totalUpd} updated</span> hongi. Missing categories/ingredients auto-create ho jaayengi.
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={onConfirm} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            <CheckCircle2 className="h-4 w-4 mr-1" />
            {saving ? 'Importing…' : `Confirm Import (${totalNew + totalUpd})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, newN, updN }: { label: string; newN: number; updN: number }) {
  return (
    <div className="border rounded-lg p-2 bg-card">
      <div className="text-[10px] uppercase font-bold text-muted-foreground">{label}</div>
      <div className="flex gap-2 mt-1">
        <Badge className="bg-green-600 text-white text-[10px]"><Plus className="h-3 w-3 mr-0.5" /> {newN} new</Badge>
        <Badge className="bg-blue-600 text-white text-[10px]"><RefreshCw className="h-3 w-3 mr-0.5" /> {updN} upd</Badge>
      </div>
    </div>
  );
}

function ActionBadge({ isNew }: { isNew: boolean }) {
  return isNew
    ? <Badge className="bg-green-600 text-white text-[10px]"><Plus className="h-3 w-3 mr-0.5" /> New</Badge>
    : <Badge className="bg-blue-600 text-white text-[10px]"><RefreshCw className="h-3 w-3 mr-0.5" /> Update</Badge>;
}

function TabBtn({ children, active, onClick }: { children: any; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 text-xs font-bold border-b-2 -mb-px ${active ? 'border-violet-600 text-violet-700' : 'border-transparent text-muted-foreground'}`}>
      {children}
    </button>
  );
}
