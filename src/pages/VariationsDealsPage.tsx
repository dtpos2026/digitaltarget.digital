import { useEffect, useState } from 'react';
import { money, currencySymbol } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Package, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  getMenuItems, getCategories, saveCategory, saveMenuItem, deleteMenuItem,
  getDeals, saveDeal, deleteDeal, genId, onDataChange,
} from '@/lib/store';
import { Category, MenuItem, Deal } from '@/lib/types';

const DEALS_CATEGORY_ID = 'cat-deals';

function ensureDealsCategory(): Category {
  const cats = getCategories();
  let cat = cats.find(c => c.id === DEALS_CATEGORY_ID) || cats.find(c => c.name.toLowerCase() === 'deals');
  if (!cat) {
    cat = { id: DEALS_CATEGORY_ID, name: 'Deals', icon: '🎁', sortOrder: cats.length };
    saveCategory(cat);
  }
  return cat;
}

function syncDealToMenu(d: Deal) {
  const cat = ensureDealsCategory();
  const item: MenuItem = {
    id: d.id, // same id as deal so we can find/remove easily
    name: d.name,
    categoryId: cat.id,
    pricingType: 'fixed' as any,
    price: d.price,
    ratePerKg: 0,
    isActive: d.isActive,
  };
  saveMenuItem(item);
}

const blankDeal = (): Deal => ({ id: genId(), name: '', items: [], price: 0, isActive: true, createdAt: new Date().toISOString() });

type VariantPick = { name: string; type: 'size' | 'inch' };

export default function VariationsDealsPage() {
  const [items, setItems] = useState<MenuItem[]>(() => getMenuItems().filter(i => i.categoryId !== DEALS_CATEGORY_ID));
  const [deals, setDeals] = useState<Deal[]>(() => getDeals());
  const [dOpen, setDOpen] = useState(false);
  const [editD, setEditD] = useState<Deal>(blankDeal());
  const [itemSearch, setItemSearch] = useState('');
  const [variantPickItem, setVariantPickItem] = useState<MenuItem | null>(null);

  useEffect(() => {
    const off = onDataChange((col) => {
      if (col === 'deals' || col === '*') setDeals(getDeals());
      if (col === 'menuItems' || col === '*') setItems(getMenuItems().filter(i => i.categoryId !== DEALS_CATEGORY_ID));
    });
    return off;
  }, []);

  const nameOf = (id: string) => items.find(i => i.id === id)?.name || '—';
  const displayLine = (di: { menuItemId: string; quantity: number; variantName?: string }) =>
    di.variantName ? `${nameOf(di.menuItemId)} — ${di.variantName}` : nameOf(di.menuItemId);

  const itemVariants = (i: MenuItem): VariantPick[] => {
    const sizes = (i.sizeVariants || []).filter(v => v && v.name).map(v => ({ name: v.name, type: 'size' as const }));
    const inches = (i.inchVariants || []).filter(v => v && v.name).map(v => ({ name: v.name, type: 'inch' as const }));
    return [...sizes, ...inches];
  };

  const findRow = (menuItemId: string, variantName?: string) =>
    editD.items.find(x => x.menuItemId === menuItemId && (x.variantName || '') === (variantName || ''));

  const addRow = (menuItemId: string, variant?: VariantPick) => {
    if (findRow(menuItemId, variant?.name)) return;
    setEditD(d => ({
      ...d,
      items: [...d.items, { menuItemId, quantity: 1, variantName: variant?.name, variantType: variant?.type }],
    }));
  };

  const removeRow = (menuItemId: string, variantName?: string) => {
    setEditD(d => ({
      ...d,
      items: d.items.filter(x => !(x.menuItemId === menuItemId && (x.variantName || '') === (variantName || ''))),
    }));
  };

  const updateQty = (menuItemId: string, qty: number, variantName?: string) => {
    setEditD(d => ({
      ...d,
      items: d.items.map(x =>
        x.menuItemId === menuItemId && (x.variantName || '') === (variantName || '')
          ? { ...x, quantity: qty } : x
      ),
    }));
  };

  const handleItemClick = (i: MenuItem) => {
    const vs = itemVariants(i);
    if (vs.length === 0) {
      // Toggle directly
      if (findRow(i.id)) removeRow(i.id);
      else addRow(i.id);
    } else {
      setVariantPickItem(i);
    }
  };

  const handleSave = () => {
    if (!editD.name || editD.items.length === 0) { toast.error('Name + items required'); return; }
    saveDeal(editD);
    syncDealToMenu(editD);
    setDeals(getDeals());
    setDOpen(false);
    toast.success('Deal saved & added to Menu → Deals category');
  };

  const handleDelete = (d: Deal) => {
    if (!confirm(`Delete "${d.name}"? It will be removed from the menu as well.`)) return;
    deleteDeal(d.id);
    deleteMenuItem(d.id);
    setDeals(getDeals());
    toast.success('Deal deleted');
  };

  const q = itemSearch.trim().toLowerCase();
  const filteredItems = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;

  const itemSelectedCount = (i: MenuItem) =>
    editD.items.filter(x => x.menuItemId === i.id).reduce((a, b) => a + b.quantity, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6 text-primary" /> Deals / Combos</h1>
          <p className="text-sm text-muted-foreground">Combo deals banayein — automatic Menu → <b>Deals</b> category me add ho jayengi aur POS se bill ho sakegi.</p>
        </div>
        <Button onClick={() => { setEditD(blankDeal()); setDOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Add Deal</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {deals.length === 0 && (
          <p className="text-muted-foreground col-span-3 text-center p-6 border rounded-xl border-dashed">
            Koi deal nahi. "Add Deal" se naya combo banayein.
          </p>
        )}
        {deals.map(d => (
          <Card key={d.id} className="p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold">{d.name}</h3>
                <p className="text-2xl font-bold text-primary">{money(d.price)}</p>
                {!d.isActive && <span className="text-[10px] uppercase bg-muted px-1.5 py-0.5 rounded">Inactive</span>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => { setEditD(d); setDOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(d)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
            <ul className="text-xs space-y-0.5 text-muted-foreground border-t pt-2">
              {d.items.map((di, idx) => <li key={idx}>• {di.quantity}× {displayLine(di)}</li>)}
            </ul>
          </Card>
        ))}
      </div>

      {/* Deal dialog */}
      <Dialog open={dOpen} onOpenChange={setDOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Deal / Combo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Deal Name</Label><Input value={editD.name} onChange={e => setEditD({ ...editD, name: e.target.value })} placeholder="Family Deal 2" /></div>
            <div><Label>Combo Price ({currencySymbol()})</Label><Input type="number" value={editD.price} onChange={e => setEditD({ ...editD, price: Number(e.target.value) })} /></div>

            <div>
              <Label>Items in Deal</Label>
              <p className="text-[11px] text-muted-foreground mb-1">
                Item par <b>click</b> karein — agar uske variants (Small/Medium/Large …) hain to variant select karne ka popup khulega, jaise POS me hota hai.
              </p>
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  placeholder="Search item by name…"
                  className="pl-8 h-9"
                />
              </div>

              {/* Items grid — POS style */}
              <div className="border rounded p-2 max-h-72 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2">
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center p-3 col-span-full">Pehle Menu me items add karein</p>
                )}
                {items.length > 0 && filteredItems.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center p-3 col-span-full">Koi item match nahi hua "{itemSearch}"</p>
                )}
                {filteredItems.map(i => {
                  const vs = itemVariants(i);
                  const count = itemSelectedCount(i);
                  return (
                    <button
                      type="button"
                      key={i.id}
                      onClick={() => handleItemClick(i)}
                      className={`relative text-left text-sm border rounded p-2 hover:bg-accent transition ${count > 0 ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <div className="font-medium line-clamp-2">{i.name}</div>
                      {vs.length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">{vs.length} variants</div>
                      )}
                      {count > 0 && (
                        <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-5 min-w-5 px-1 flex items-center justify-center">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected items list with qty editing */}
            {editD.items.length > 0 && (
              <div>
                <Label>Selected ({editD.items.length})</Label>
                <div className="border rounded p-2 space-y-1 max-h-48 overflow-y-auto">
                  {editD.items.map((di, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{displayLine(di)}</span>
                      <Input
                        type="number"
                        min={1}
                        className="w-20 h-7"
                        value={di.quantity}
                        onChange={e => updateQty(di.menuItemId, Number(e.target.value), di.variantName)}
                      />
                      <Button size="sm" variant="ghost" onClick={() => removeRow(di.menuItemId, di.variantName)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2"><input type="checkbox" checked={editD.isActive} onChange={e => setEditD({ ...editD, isActive: e.target.checked })} /> Active</label>
            <Button className="w-full" onClick={handleSave}>Save Deal</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Variant picker dialog */}
      <Dialog open={!!variantPickItem} onOpenChange={(o) => { if (!o) setVariantPickItem(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{variantPickItem?.name} — Select Variant</DialogTitle></DialogHeader>
          {variantPickItem && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Jo variants deal me chahiye unhe select karein. Qty bhi yahin set kar sakte hain.</p>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {itemVariants(variantPickItem).map(v => {
                  const existing = findRow(variantPickItem.id, v.name);
                  return (
                    <div key={`${v.type}::${v.name}`} className="flex items-center gap-2 text-sm border rounded p-2">
                      <input
                        type="checkbox"
                        checked={!!existing}
                        onChange={e => {
                          if (e.target.checked) addRow(variantPickItem.id, v);
                          else removeRow(variantPickItem.id, v.name);
                        }}
                      />
                      <span className="flex-1">{v.name} <span className="text-[10px] text-muted-foreground uppercase">({v.type})</span></span>
                      {existing && (
                        <Input
                          type="number"
                          min={1}
                          className="w-20 h-7"
                          value={existing.quantity}
                          onChange={e => updateQty(variantPickItem.id, Number(e.target.value), v.name)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <Button className="w-full" onClick={() => setVariantPickItem(null)}>Done</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
