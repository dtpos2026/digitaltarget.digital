import { useState, useMemo } from 'react';
import { getCategories, getMenuItems, saveCategory, deleteCategory, saveMenuItem, deleteMenuItem, getKitchens, genId, saveInventoryItem, getInventory, getCurrentUser, resetSelectedData, getDeletedMenuItems, getDeletedCategories, restoreMenuItem, restoreCategory, permanentDeleteMenuItem, permanentDeleteCategory, getSettings
} from '@/lib/store';
import { Category, MenuItem, InventoryItem, ItemVariant } from '@/lib/types';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Edit2, Save, ImagePlus, Download, Search, FolderInput, CheckCircle2, XCircle, X, Images, Tags, RotateCcw, Archive, ChevronUp, ChevronDown, Pencil, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { featureActive } from '@/lib/optionalModules';
import { uploadTenantImage } from '@/lib/storage';
import BulkImageUpload from '@/components/BulkImageUpload';
import ExcelImportDialog from '@/components/ExcelImportDialog';

async function pickAndUpload(file: File, prefix: string, setUrl: (u: string) => void) {
  const tId = toast.loading('Uploading image…');
  try {
    const url = await uploadTenantImage(file, prefix);
    setUrl(url);
    toast.success('Image uploaded', { id: tId });
  } catch (e: any) {
    toast.error(e?.message || 'Upload failed', { id: tId });
  }
}

/** Inline editor for size / inch variant rows. Each row = name + price; add / remove as needed. */
function VariantEditor({
  title, placeholder, defaultRows, rows, onChange,
}: {
  title: string;
  placeholder: string;
  defaultRows: string[];
  rows: ItemVariant[];
  onChange: (rows: ItemVariant[]) => void;
}) {
  const list = rows.length ? rows : defaultRows.map(n => ({ name: n, price: 0 }));
  const update = (i: number, patch: Partial<ItemVariant>) => {
    const next = list.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onChange(next);
  };
  const add = () => onChange([...list, { name: '', price: 0 }]);
  const remove = (i: number) => onChange(list.filter((_, idx) => idx !== i));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</label>
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Row
        </Button>
      </div>
      <div className="space-y-1">
        {list.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input
              placeholder={placeholder}
              value={r.name}
              onChange={e => update(i, { name: e.target.value })}
              className="h-7 text-xs flex-1"
            />
            <Input
              type="number"
              placeholder="Price"
              value={r.price || ''}
              onChange={e => update(i, { price: Number(e.target.value) })}
              className="h-7 text-xs w-24"
            />
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => remove(i)}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}



export default function MenuManagerPage() {
  const [categories, setCategories] = useState(() => getCategories());

  // ===== v1.9.1 — category ordering + rename =====
  // Sorted view used everywhere on this page. Falls back to name order for
  // legacy rows whose sortOrder was never set.
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => {
      const ao = Number.isFinite(a.sortOrder as number) ? (a.sortOrder as number) : 9999;
      const bo = Number.isFinite(b.sortOrder as number) ? (b.sortOrder as number) : 9999;
      return ao !== bo ? ao - bo : String(a.name).localeCompare(String(b.name));
    }),
    [categories],
  );
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatIcon, setEditCatIcon] = useState('');

  const startEditCategory = (c: Category) => {
    setEditCat(c);
    setEditCatName(c.name);
    setEditCatIcon(c.icon || '');
  };
  const commitEditCategory = () => {
    if (!editCat) return;
    const name = editCatName.trim();
    if (!name) { toast.error('A category name cannot be empty'); return; }
    saveCategory({ ...editCat, name, icon: editCatIcon.trim() || editCat.icon });
    setEditCat(null);
    refresh();
    toast.success('Category updated');
  };
  /** Swap this category with its neighbour and persist both. */
  const moveCategory = (id: string, dir: -1 | 1) => {
    const list = [...sortedCategories];
    const idx = list.findIndex(c => c.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    // Renumber the whole list so ordering stays stable and gap-free.
    list.forEach((c, i) => saveCategory({ ...c, sortOrder: i + 1 }));
    refresh();
  };
  const [items, setItems] = useState(() => getMenuItems());
  const kitchens = getKitchens();

  const [selectedCat, setSelectedCat] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'fixed' | 'weight' | 'manual'>('all');

  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [showCatDialog, setShowCatDialog] = useState(false);
  const [catName, setCatName] = useState('');
  const [catIcon, setCatIcon] = useState('📋');
  const [catImage, setCatImage] = useState('');

  // Bulk selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveCat, setBulkMoveCat] = useState('');
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [bulkSubCatOpen, setBulkSubCatOpen] = useState(false);
  const [bulkSubCatValue, setBulkSubCatValue] = useState('');

  // Recycle Bin
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [deletedItems, setDeletedItems] = useState(() => getDeletedMenuItems());
  const [deletedCats, setDeletedCats] = useState(() => getDeletedCategories());
  const [trashTab, setTrashTab] = useState<'items' | 'categories'>('items');

  const refresh = () => {
    setCategories(getCategories());
    setItems(getMenuItems());
    setDeletedItems(getDeletedMenuItems());
    setDeletedCats(getDeletedCategories());
  };

  // User import + bulk image upload
  const [excelOpen, setExcelOpen] = useState(false);            // user uploads xlsx/csv
  const [bulkImgOpen, setBulkImgOpen] = useState(false);
  const inventoryItems = getInventory();

  /**
   * ===== v1.28.2 — a 1300-row menu used to freeze the screen =====
   *
   * This was three synchronous forEach loops. Every saveMenuItem() reads the
   * whole app cache, mutates an array and writes it back, so importing a real
   * restaurant's menu ran ~1300 whole-cache serialisations back to back on the
   * main thread: no paint, no input, and a spreadsheet import that looked like
   * a crash.
   *
   * The same saves, in chunks, with the thread handed back between them. The
   * work is identical — what changes is that the browser gets to breathe, and
   * the operator gets a count instead of a frozen dialog.
   *
   * Errors are per row: one malformed line is reported and skipped rather than
   * abandoning the rest of the sheet.
   */
  const runExcelImport = async (data: { categories: Category[]; menuItems: MenuItem[]; inventory: InventoryItem[] }) => {
    const CHUNK = 100;
    const total = data.categories.length + data.menuItems.length + data.inventory.length;
    const toastId = 'menu-import';
    let done = 0;
    let failed = 0;

    const runAll = async <T,>(rows: T[], save: (row: T) => void, label: string) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        for (const row of rows.slice(i, i + CHUNK)) {
          try { save(row); }
          catch (e: any) {
            failed++;
            console.warn(`[menu import] ${label} row skipped — ${e?.message || e}`, row);
          }
          done++;
        }
        toast.loading(`Importing ${label}… ${done}/${total}`, { id: toastId });
        // Yield so React can paint the progress the operator is waiting on.
        await new Promise(r => setTimeout(r, 0));
      }
    };

    toast.loading(`Importing… 0/${total}`, { id: toastId });
    // Categories first: menu items reference them.
    await runAll(data.categories, c => saveCategory(c), 'categories');
    await runAll(data.menuItems, i => saveMenuItem(i), 'items');
    await runAll(data.inventory, iv => saveInventoryItem(iv), 'ingredients');

    refresh();
    const summary = `Imported ${data.menuItems.length} items, ${data.inventory.length} ingredients, ${data.categories.length} new categories`;
    if (failed) toast.warning(`${summary} — ${failed} row(s) skipped, see the console`, { id: toastId });
    else toast.success(summary, { id: toastId });
  };

  /**
   * ===== v1.49.0 — the items that were never given a price =====
   *
   * REPORTED as "bill zero aa raha hai". On the live menu, 53 of 129 items
   * carried price 0; 41 of those had no size variant and no rate per kg
   * either, so there was no price anywhere. They showed a confident "Rs.0" on
   * the till and rang up as Rs 0.
   *
   * The POS now refuses to add one silently. This is the other half: the owner
   * needs to SEE which ones, and get to them in one click, rather than
   * discovering them a bill at a time.
   */
  const unpriced = useMemo(() => items.filter(i =>
    (i.pricingType ?? 'fixed') === 'fixed'
    && !(Number(i.price) > 0)
    && !(i.sizeVariants?.length)
    && !(i.inchVariants?.length)
    && !(Number(i.ratePerKg) > 0)
    && i.isActive !== false
  ), [items]);

  const unpricedIds = useMemo(() => new Set(unpriced.map(i => i.id)), [unpriced]);

  const filteredItems = useMemo(() => {
    return items.filter(i => {
      if (selectedCat !== 'all' && i.categoryId !== selectedCat) return false;
      if (statusFilter === 'active' && i.isActive === false) return false;
      if (statusFilter === 'inactive' && i.isActive !== false) return false;
      if (typeFilter !== 'all' && i.pricingType !== typeFilter) return false;
      // v1.49.0 — the "Show them" button on the no-price banner. A sentinel
      // rather than a fourth filter dropdown: it is a one-off repair job, not a
      // view anyone wants to keep.
      if (search === '__unpriced__') {
        return unpricedIds.has(i.id);
      }
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        if (!i.name.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, selectedCat, statusFilter, typeFilter, search, unpricedIds]);

  // All existing sub-category names (for autocomplete suggestions)
  const allSubCategories = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => { if (i.subCategory && i.subCategory.trim()) set.add(i.subCategory.trim()); });
    return Array.from(set).sort();
  }, [items]);

  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every(i => selected.has(i.id));
  const someSelected = selected.size > 0;

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const next = new Set(selected);
      filteredItems.forEach(i => next.delete(i.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filteredItems.forEach(i => next.add(i.id));
      setSelected(next);
    }
  };
  const clearSelection = () => setSelected(new Set());

  const addCategory = () => {
    if (!catName) return;
    saveCategory({ id: genId(), name: catName, icon: catIcon, image: catImage, sortOrder: categories.length + 1 });
    setCatName(''); setCatIcon('📋'); setCatImage('');
    setShowCatDialog(false);
    refresh();
    toast.success('Category added');
  };

  const openNewItem = () => {
    setEditItem({ id: genId(), name: '', categoryId: categories[0]?.id || '', pricingType: 'fixed', price: 0, ratePerKg: 0, isActive: true });
    setShowItemDialog(true);
  };

  const openEditItem = (item: MenuItem) => {
    setEditItem({ ...item });
    setShowItemDialog(true);
  };

  const saveItem = () => {
    if (!editItem || !editItem.name) return;
    saveMenuItem(editItem);
    setShowItemDialog(false);
    refresh();
    toast.success('Item saved');
  };

  // ---- Bulk actions ----
  const doBulkDelete = async () => {
    if (deleteConfirmText !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    const ids = Array.from(selected);
    const t = toast.loading(`Deleting ${ids.length} items…`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      try { await Promise.resolve(deleteMenuItem(id)); ok++; } catch { fail++; }
    }
    setBulkDeleteOpen(false);
    setDeleteConfirmText('');
    clearSelection();
    refresh();
    if (fail) toast.error(`${ok} deleted, ${fail} failed`, { id: t });
    else toast.success(`${ok} items moved to Recycle Bin`, { id: t });
  };

  const doBulkMove = async () => {
    if (!bulkMoveCat) { toast.error('Select a category'); return; }
    const ids = Array.from(selected);
    const t = toast.loading(`Moving ${ids.length} items…`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      const it = items.find(x => x.id === id);
      if (!it) { fail++; continue; }
      try { await Promise.resolve(saveMenuItem({ ...it, categoryId: bulkMoveCat })); ok++; } catch { fail++; }
    }
    setBulkMoveOpen(false);
    setBulkMoveCat('');
    clearSelection();
    refresh();
    if (fail) toast.error(`${ok} moved, ${fail} failed`, { id: t });
    else toast.success(`${ok} items moved`, { id: t });
  };

  const doBulkSetActive = async (active: boolean) => {
    const ids = Array.from(selected);
    const t = toast.loading(`Updating ${ids.length} items…`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      const it = items.find(x => x.id === id);
      if (!it) { fail++; continue; }
      try { await Promise.resolve(saveMenuItem({ ...it, isActive: active })); ok++; } catch { fail++; }
    }
    clearSelection();
    refresh();
    if (fail) toast.error(`${ok} updated, ${fail} failed`, { id: t });
    else toast.success(`${ok} items marked ${active ? 'Active' : 'Inactive'}`, { id: t });
  };

  const doBulkSetSubCategory = async () => {
    const val = bulkSubCatValue.trim();
    const ids = Array.from(selected);
    const t = toast.loading(`Updating ${ids.length} items…`);
    let ok = 0, fail = 0;
    for (const id of ids) {
      const it = items.find(x => x.id === id);
      if (!it) { fail++; continue; }
      try { await Promise.resolve(saveMenuItem({ ...it, subCategory: val || undefined })); ok++; } catch { fail++; }
    }
    setBulkSubCatOpen(false);
    setBulkSubCatValue('');
    clearSelection();
    refresh();
    if (fail) toast.error(`${ok} updated, ${fail} failed`, { id: t });
    else toast.success(val ? `${ok} items → "${val}"` : `${ok} items: sub-category cleared`, { id: t });
  };

  return (
    <div className="p-4 lg:p-6">
      {unpriced.length > 0 && search !== '__unpriced__' && (
        <div className="mb-4 rounded-lg border-2 border-status-warning/50 bg-status-warning/10 p-3 flex flex-wrap items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-status-warning shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">
              {unpriced.length} item{unpriced.length === 1 ? '' : 's'} ha{unpriced.length === 1 ? 's' : 've'} no price
            </div>
            <p className="text-xs text-muted-foreground">
              These show “No price” on the till and cannot be rung up until someone types a
              price. Set them here and every bill is right from then on.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => { setSearch('__unpriced__'); setSelectedCat('all'); }}>
            Show them
          </Button>
        </div>
      )}
      {search === '__unpriced__' && (
        <div className="mb-4 rounded-lg border bg-card p-3 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-status-warning shrink-0" />
          <span className="text-sm font-semibold">
            Showing the {unpriced.length} item{unpriced.length === 1 ? '' : 's'} with no price
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSearch('')}>
            Show all
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="text-lg font-bold">Menu Manager</h2>
        <Button size="sm" variant="outline" onClick={() => setShowCatDialog(true)}><Plus className="h-3 w-3 mr-1" /> Category</Button>
        <Button size="sm" onClick={openNewItem}><Plus className="h-3 w-3 mr-1" /> Item</Button>
        <Button size="sm" variant="secondary" onClick={() => setExcelOpen(true)}>
          <Download className="h-3 w-3 mr-1" /> Import Excel/CSV
        </Button>
        <Button size="sm" variant="secondary" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setBulkImgOpen(true)}>
          <Images className="h-3 w-3 mr-1" /> Bulk Upload Images
        </Button>
        <Button size="sm" variant="outline" onClick={() => { refresh(); setRecycleOpen(true); }} className="relative">
          <Archive className="h-3 w-3 mr-1" /> Recycle Bin
          {(deletedItems.length + deletedCats.length) > 0 && (
            <Badge className="ml-2 h-4 px-1 text-[10px] bg-amber-500 hover:bg-amber-500">{deletedItems.length + deletedCats.length}</Badge>
          )}
        </Button>
        {getCurrentUser()?.role === 'admin' && (
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              const ans = prompt(`This will PERMANENTLY delete the entire menu (${items.length} items + ${categories.length} categories).\n\nTo confirm, type "DELETE ALL":`);
              if (ans !== 'DELETE ALL') { if (ans !== null) toast.error('Cancelled — the text did not match'); return; }
              const t = toast.loading('Deleting all menu…');
              try {
                const res = await resetSelectedData(['menuItems', 'categories']);
                if (res.failed.length) {
                  toast.error(
                    `The server refused: ${res.failed.map(f => f.error).join('; ')}. ` +
                    'The menu is unchanged — nothing was lost.',
                    { id: t, duration: 15000 },
                  );
                  return;
                }
                toast.success('The entire menu was deleted', { id: t });
                refresh();
              } catch (e: any) {
                toast.error(e?.message || 'Delete failed', { id: t });
              }
            }}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Delete All Menu
          </Button>
        )}
      </div>


      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="pl-7 h-8 text-xs" />
        </div>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="weight">Weight</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setSelectedCat('all')}
          className={`px-3 py-1 rounded-lg text-xs font-medium ${selectedCat === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card border hover:bg-accent'}`}>
          All
        </button>
        {/* v1.9.1 — categories now render in sortOrder, and each row carries
            rename + reorder controls. `sortOrder` existed on the type since
            early versions but nothing read it, so the order was effectively
            insertion order and there was no way to rename a category. */}
        {sortedCategories.map((c, i) => (
          <div key={c.id} className="flex items-center gap-1">
            <button onClick={() => setSelectedCat(c.id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${selectedCat === c.id ? 'bg-primary text-primary-foreground' : 'bg-card border hover:bg-accent'}`}>
              {c.icon} {c.name}
            </button>
            <button
              onClick={() => moveCategory(c.id, -1)}
              disabled={i === 0}
              title="Move up"
              className="text-muted-foreground hover:text-foreground disabled:opacity-25"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              onClick={() => moveCategory(c.id, 1)}
              disabled={i === sortedCategories.length - 1}
              title="Move down"
              className="text-muted-foreground hover:text-foreground disabled:opacity-25"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <button onClick={() => startEditCategory(c)} title="Naam badlein"
              className="text-primary hover:text-primary/80">
              <Pencil className="h-3 w-3" />
            </button>
            <button onClick={() => { deleteCategory(c.id); refresh(); }} className="text-destructive hover:text-destructive/80">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Bulk action toolbar */}
      {someSelected && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 bg-violet-600 text-white rounded-lg px-3 py-2 shadow">
          <span className="text-xs font-bold">{selected.size} selected</span>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setBulkMoveOpen(true)}>
            <FolderInput className="h-3 w-3 mr-1" /> Move to Category
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => { setBulkSubCatValue(''); setBulkSubCatOpen(true); }}>
            <Tags className="h-3 w-3 mr-1" /> Set Sub-Category
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => doBulkSetActive(true)}>
            <CheckCircle2 className="h-3 w-3 mr-1" /> Mark Active
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => doBulkSetActive(false)}>
            <XCircle className="h-3 w-3 mr-1" /> Mark Inactive
          </Button>
          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-white hover:text-white hover:bg-white/20 ml-auto" onClick={clearSelection}>
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
        </div>
      )}

      {/* Items list */}
      <div className="bg-card border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="border-b">
            <th className="px-3 py-2 w-8">
              <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} aria-label="Select all" />
            </th>
            <th className="text-left px-4 py-2 text-muted-foreground font-medium">Image</th>
            <th className="text-left px-4 py-2 text-muted-foreground font-medium">Name</th>
            <th className="text-left px-4 py-2 text-muted-foreground font-medium">Category</th>
            <th className="text-left px-4 py-2 text-muted-foreground font-medium">Kitchen</th>
            <th className="text-left px-4 py-2 text-muted-foreground font-medium">Type</th>
            <th className="text-left px-4 py-2 text-muted-foreground font-medium">Status</th>
            <th className="text-right px-4 py-2 text-muted-foreground font-medium">Price/Rate</th>
            <th className="px-4 py-2"></th>
          </tr></thead>

          <tbody>
            {filteredItems.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-muted-foreground italic">No items match filters</td></tr>
            )}
            {filteredItems.map(item => (
              <tr key={item.id} className={`border-b hover:bg-muted/30 ${selected.has(item.id) ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}>
                <td className="px-3 py-2">
                  <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleOne(item.id)} aria-label={`Select ${item.name}`} />
                </td>
                <td className="px-4 py-2">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">📷</div>
                  )}
                </td>
                <td className="px-4 py-2 font-medium">{item.name}</td>
                <td className="px-4 py-2">{categories.find(c => c.id === item.categoryId)?.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{kitchens.find(k => k.id === item.kitchenId)?.name || <span className="italic text-[10px]">—</span>}</td>
                <td className="px-4 py-2"><Badge variant="secondary" className="text-[10px]">{item.pricingType}</Badge></td>
                <td className="px-4 py-2">
                  {item.isActive === false
                    ? <Badge variant="outline" className="text-[10px] border-zinc-400 text-zinc-600">Inactive</Badge>
                    : <Badge className="text-[10px] bg-green-600 hover:bg-green-700">Active</Badge>}
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  {item.pricingType === 'fixed' ? `PKR ${item.price}` : `PKR ${item.ratePerKg}/kg`}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => openEditItem(item)}><Edit2 className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => { deleteMenuItem(item.id); refresh(); }}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk Move dialog */}
      {/* Bulk Set Sub-Category dialog */}
      <Dialog open={bulkSubCatOpen} onOpenChange={setBulkSubCatOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Set Sub-Category — {selected.size} items</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input
              list="bulk-sub-category-suggestions"
              placeholder="Type, or choose from existing…"
              value={bulkSubCatValue}
              onChange={e => setBulkSubCatValue(e.target.value)}
              autoFocus
            />
            <datalist id="bulk-sub-category-suggestions">
              {allSubCategories.map(s => <option key={s} value={s} />)}
            </datalist>
            <p className="text-[10px] text-muted-foreground">
              Khali chhodne se selected items se sub-category remove ho jayegi.
            </p>
            {allSubCategories.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {allSubCategories.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBulkSubCatValue(s)}
                    className={`px-2 py-0.5 rounded text-[10px] border ${bulkSubCatValue === s ? 'bg-violet-600 text-white border-violet-600' : 'bg-card hover:bg-accent'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkSubCatOpen(false)}>Cancel</Button>
            <Button onClick={doBulkSetSubCategory} className="bg-violet-600 hover:bg-violet-700 text-white">
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Move {selected.size} items</DialogTitle></DialogHeader>
          <Select value={bulkMoveCat} onValueChange={setBulkMoveCat}>
            <SelectTrigger><SelectValue placeholder="Choose category…" /></SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMoveOpen(false)}>Cancel</Button>
            <Button onClick={doBulkMove} className="bg-violet-600 hover:bg-violet-700 text-white">Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete dialog */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(o) => { setBulkDeleteOpen(o); if (!o) setDeleteConfirmText(''); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">Delete {selected.size} items?</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            Ye items Recycle Bin me move ho jayenge — galti ho to wahan se restore kar sakte hain. Confirm karne k liye neeche <b className="text-destructive">DELETE</b> type karein.
          </p>
          <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder="Type DELETE" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doBulkDelete} disabled={deleteConfirmText !== 'DELETE'}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={showCatDialog} onOpenChange={setShowCatDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Category</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Category name" value={catName} onChange={e => setCatName(e.target.value)} />
            <Input placeholder="Icon emoji" value={catIcon} onChange={e => setCatIcon(e.target.value)} />
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Category Image (optional)</label>
              <div className="flex items-center gap-2">
                {catImage && <img src={catImage} alt="Cat" className="h-12 w-12 rounded object-cover border" />}
                <Button variant="outline" size="sm" asChild>
                  <label className="cursor-pointer">
                    <ImagePlus className="h-3 w-3 mr-1" /> Upload
                    <input type="file" accept="image/*" className="hidden" onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      pickAndUpload(file, 'category', (u) => setCatImage(u));
                    }} />
                  </label>
                </Button>
                {catImage && <Button variant="ghost" size="sm" onClick={() => setCatImage('')}>Remove</Button>}
              </div>
            </div>
            <Button onClick={addCategory} className="w-full">Add</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Dialog */}
      <Dialog open={showItemDialog} onOpenChange={setShowItemDialog}>
        <DialogContent className="sm:max-w-sm max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editItem?.id ? 'Edit Item' : 'Add Item'}</DialogTitle></DialogHeader>
          {editItem && (
            <div className="space-y-3">
              <Input placeholder="Item name" value={editItem.name} onChange={e => setEditItem({ ...editItem, name: e.target.value })} />
              {/* v1.9.1 — barcode / SKU. Optional; only shown when the
                  restaurant enables the barcode feature (minimart use). */}
              {/* v1.14.1 — RETAIL stock link. Without this, a minimart item's
                  stock never moved, because deduction only ran through
                  recipes. Optional: leave blank for restaurant dishes. */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Stock item link (retail — recipe ki zaroorat nahi)
                </label>
                <select
                  value={editItem.inventoryItemId || ''}
                  onChange={e => setEditItem({ ...editItem, inventoryItemId: e.target.value || undefined })}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— koi nahi (restaurant dish) —</option>
                  {getInventory().filter((i: any) => i.isActive !== false).map((i: any) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.baseUnit || i.unit})</option>
                  ))}
                </select>
                {editItem.inventoryItemId && (
                  <Input
                    type="number"
                    step="any"
                    placeholder="How much to deduct per sale (default 1)"
                    value={editItem.stockPerUnit ?? ''}
                    onChange={e => setEditItem({
                      ...editItem,
                      stockPerUnit: e.target.value === '' ? undefined : Number(e.target.value),
                    })}
                  />
                )}
              </div>
              {getSettings().barcodeEnabled && (
                <Input
                  placeholder="Barcode / SKU (scanner)"
                  value={editItem.barcode || ''}
                  onChange={e => setEditItem({ ...editItem, barcode: e.target.value.trim() })}
                />
              )}
              <Select value={editItem.categoryId} onValueChange={v => setEditItem({ ...editItem, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select
                value={editItem.kitchenId || '__none__'}
                onValueChange={v => setEditItem({ ...editItem, kitchenId: v === '__none__' ? undefined : v })}
              >
                <SelectTrigger><SelectValue placeholder="Kitchen (routing)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No kitchen (default) —</SelectItem>
                  {kitchens.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Flavors / Variations (optional)
                </label>
                <Input
                  placeholder="e.g. Spicy, Mild, Garlic, BBQ"
                  value={(editItem.flavors || []).join(', ')}
                  onChange={e => setEditItem({
                    ...editItem,
                    flavors: e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(Boolean),
                  })}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Comma se separate karen. Agar set ho to online order par customer ko ek flavor select karna hoga.
                </p>
              </div>
              {/* Sub-Category / Flavor Group */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Sub-Category / Flavor Group (optional)
                </label>
                <Input
                  list="sub-category-suggestions"
                  placeholder="Type, or choose from existing…"
                  value={editItem.subCategory || ''}
                  onChange={e => setEditItem({ ...editItem, subCategory: e.target.value })}
                />
                <datalist id="sub-category-suggestions">
                  {allSubCategories.map(s => <option key={s} value={s} />)}
                </datalist>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {allSubCategories.length > 0
                    ? `${allSubCategories.length} existing group(s) — type to search or create a new one.`
                    : 'Type a name to create a new group. It will be suggested here on future items.'}
                </p>
              </div>

              <Select value={editItem.pricingType} onValueChange={(v: any) => setEditItem({ ...editItem, pricingType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Simple Price (Fixed)</SelectItem>
                  <SelectItem value="size">Size Wise (Small/Medium/Large …)</SelectItem>
                  <SelectItem value="inch">Inches Wise (7"/9"/12" …)</SelectItem>
                  <SelectItem value="both">Both — Size + Inches</SelectItem>
                  <SelectItem value="weight">Weight / KG Wise</SelectItem>
                  <SelectItem value="manual">Manual Price</SelectItem>
                </SelectContent>
              </Select>
              {editItem.pricingType === 'fixed' ? (
                <Input type="number" placeholder="Price (PKR)" value={editItem.price || ''} onChange={e => setEditItem({ ...editItem, price: Number(e.target.value) })} />
              ) : editItem.pricingType === 'weight' ? (
                <Input type="number" placeholder="Rate per KG (PKR)" value={editItem.ratePerKg || ''} onChange={e => setEditItem({ ...editItem, ratePerKg: Number(e.target.value) })} />
              ) : (editItem.pricingType === 'size' || editItem.pricingType === 'inch' || editItem.pricingType === 'both') ? (
                <div className="space-y-3 border rounded-md p-2 bg-muted/30 max-h-[300px] overflow-y-auto">
                  {(editItem.pricingType === 'size' || editItem.pricingType === 'both') && (
                    <VariantEditor
                      title="Size Variants"
                      placeholder="e.g. Small"
                      defaultRows={['Small', 'Medium', 'Large', 'Extra Large']}
                      rows={editItem.sizeVariants || []}
                      onChange={rows => setEditItem({ ...editItem, sizeVariants: rows })}
                    />
                  )}
                  {(editItem.pricingType === 'inch' || editItem.pricingType === 'both') && (
                    <VariantEditor
                      title="Inch Variants"
                      placeholder='e.g. 12"'
                      defaultRows={['7 Inch', '9 Inch', '12 Inch', '15 Inch', '21 Inch']}
                      rows={editItem.inchVariants || []}
                      onChange={rows => setEditItem({ ...editItem, inchVariants: rows })}
                    />
                  )}
                  <p className="text-[10px] text-muted-foreground italic">Base price hidden — POS pe customer variant select karega.</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">Manual price — operator enters price at POS</p>
              )}
              {/* Active toggle */}
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={editItem.isActive !== false} onCheckedChange={(v) => setEditItem({ ...editItem, isActive: !!v })} />
                Active (show in POS)
              </label>
              {/* v1.3.0 — Token item (only shown when the Token module is ON) */}
              {featureActive(getSettings(), 'tokenModuleEnabled') && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={editItem.isTokenItem === true}
                    onCheckedChange={(v) => setEditItem({ ...editItem, isTokenItem: !!v })}
                  />
                  Is Token Item (Print Token se instant sale)
                </label>
              )}
              {/* Item Image Upload */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Item Image (optional)</label>
                <div className="flex items-center gap-2">
                  {editItem.image && <img src={editItem.image} alt="Item" className="h-12 w-12 rounded object-cover border" />}
                  <Button variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      <ImagePlus className="h-3 w-3 mr-1" /> Upload
                      <input type="file" accept="image/*" className="hidden" onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file || !editItem) return;
                        pickAndUpload(file, 'item', (u) => setEditItem({ ...editItem, image: u }));
                      }} />
                    </label>
                  </Button>
                  {editItem.image && <Button variant="ghost" size="sm" onClick={() => setEditItem({ ...editItem, image: '' })}>Remove</Button>}
                </div>
              </div>
              <Button onClick={saveItem} className="w-full"><Save className="h-3 w-3 mr-1" /> Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Recycle Bin */}
      <Dialog open={recycleOpen} onOpenChange={setRecycleOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4" /> Recycle Bin
            </DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 border-b pb-2">
            <button
              onClick={() => setTrashTab('items')}
              className={`px-3 py-1 rounded text-xs font-medium ${trashTab === 'items' ? 'bg-primary text-primary-foreground' : 'bg-card border hover:bg-accent'}`}
            >
              Items ({deletedItems.length})
            </button>
            <button
              onClick={() => setTrashTab('categories')}
              className={`px-3 py-1 rounded text-xs font-medium ${trashTab === 'categories' ? 'bg-primary text-primary-foreground' : 'bg-card border hover:bg-accent'}`}
            >
              Categories ({deletedCats.length})
            </button>
            {(deletedItems.length + deletedCats.length) > 0 && (
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto h-7 text-xs"
                onClick={() => {
                  const total = deletedItems.length + deletedCats.length;
                  const ans = prompt(`${total} entries will be PERMANENTLY deleted from the Recycle Bin.\n\nTo confirm, type "DELETE ALL":`);
                  if (ans !== 'DELETE ALL') { if (ans !== null) toast.error('Cancelled'); return; }
                  deletedItems.forEach(i => permanentDeleteMenuItem(i.id));
                  deletedCats.forEach(c => permanentDeleteCategory(c.id));
                  refresh();
                  toast.success('Recycle Bin empty');
                }}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Empty Bin
              </Button>
            )}
          </div>

          {trashTab === 'items' && (
            deletedItems.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground italic text-xs">No deleted items</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="border-b">
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Name</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Category</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Deleted</th>
                  <th className="px-2 py-2"></th>
                </tr></thead>
                <tbody>
                  {deletedItems.map(it => {
                    const cat = [...categories, ...deletedCats].find(c => c.id === it.categoryId);
                    return (
                      <tr key={it.id} className="border-b hover:bg-muted/30">
                        <td className="px-2 py-2 font-medium">{it.name}</td>
                        <td className="px-2 py-2 text-muted-foreground">{cat?.name || <span className="italic">—</span>}</td>
                        <td className="px-2 py-2 text-muted-foreground text-[10px]">
                          {(it as any).deletedAt ? new Date((it as any).deletedAt).toLocaleString() : '—'}
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => { restoreMenuItem(it.id); refresh(); toast.success(`Restored: ${it.name}`); }}>
                            <RotateCcw className="h-3 w-3 mr-1" /> Restore
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                            if (!confirm(`"${it.name}" be deleted PERMANENTLY?\n\nThis action cannot be undone.`)) return;
                            permanentDeleteMenuItem(it.id); refresh(); toast.success('Permanently deleted');
                          }}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}

          {trashTab === 'categories' && (
            deletedCats.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground italic text-xs">No deleted categories</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="border-b">
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Name</th>
                  <th className="text-left px-2 py-2 text-muted-foreground font-medium">Deleted</th>
                  <th className="px-2 py-2"></th>
                </tr></thead>
                <tbody>
                  {deletedCats.map(c => (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="px-2 py-2 font-medium">{c.icon} {c.name}</td>
                      <td className="px-2 py-2 text-muted-foreground text-[10px]">
                        {(c as any).deletedAt ? new Date((c as any).deletedAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => { restoreCategory(c.id); refresh(); toast.success(`Restored: ${c.name}`); }}>
                          <RotateCcw className="h-3 w-3 mr-1" /> Restore
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                          if (!confirm(`Category "${c.name}" be deleted PERMANENTLY?\n\nThis action cannot be undone.`)) return;
                          permanentDeleteCategory(c.id); refresh(); toast.success('Permanently deleted');
                        }}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          <p className="text-[10px] text-muted-foreground italic">
            Note: Deleted items POS, Online Order aur reports me show nahi honge. Restore karne par wapas active ho jayenge.
          </p>
        </DialogContent>
      </Dialog>

      {bulkImgOpen && (
        <BulkImageUpload
          items={items}
          inventory={inventoryItems}
          onClose={() => setBulkImgOpen(false)}
          onSaved={() => { setBulkImgOpen(false); refresh(); }}
        />
      )}

      {excelOpen && (
        <ExcelImportDialog
          existingCategories={categories}
          existingItems={items}
          existingInventory={inventoryItems}
          onClose={() => setExcelOpen(false)}
          onImport={runExcelImport}
        />
      )}


      {/* v1.9.1 — rename category */}
      <Dialog open={!!editCat} onOpenChange={(o) => { if (!o) setEditCat(null); }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Category Edit</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Naam</label>
              <Input value={editCatName} onChange={e => setEditCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEditCategory(); }} autoFocus />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Icon (emoji)</label>
              <Input value={editCatIcon} onChange={e => setEditCatIcon(e.target.value)} placeholder="🍕" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={commitEditCategory}>Save</Button>
              <Button variant="outline" onClick={() => setEditCat(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
