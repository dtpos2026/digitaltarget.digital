import { useState, useMemo } from 'react';
import { money, currencySymbol } from '@/lib/currency';
import { InventoryItem, StockLog, UnitConversion } from '@/lib/types';
import { getInventory, saveInventoryItem, deleteInventoryItem, getStockLogs, adjustStock, getCategories, genId, getSettings } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Search, PackagePlus, PackageMinus, AlertTriangle, History, Edit, Package, FolderInput, CheckCircle2, XCircle, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog as ConfirmDialog, DialogContent as ConfirmContent, DialogHeader as ConfirmHeader, DialogTitle as ConfirmTitle, DialogFooter as ConfirmFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { BASE_UNITS, PURCHASE_UNITS, getBaseUnit } from '@/lib/units';

const UNITS = ['pcs', 'kg', 'g', 'l', 'ml']; // legacy alias list (kept for backward compat)

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>(() => getInventory());
  const [logs, setLogs] = useState<StockLog[]>(() => getStockLogs());
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [stockItem, setStockItem] = useState<InventoryItem | null>(null);
  const [stockType, setStockType] = useState<'in' | 'out'>('in');
  const [stockQty, setStockQty] = useState('');
  const [stockNote, setStockNote] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<'kg' | 'g' | 'l' | 'ml' | 'pcs'>('pcs');
  const [lowStockThreshold, setLowStockThreshold] = useState('10');
  const [conversions, setConversions] = useState<UnitConversion[]>([]);
  const [costMode, setCostMode] = useState<'total' | 'perUnit'>('total');

  // Bulk select + filters
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'low' | 'out' | 'active' | 'inactive'>('all');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveCat, setBulkMoveCat] = useState('');
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const categories = useMemo(() => getCategories(), []);
  const costEnabled = !!getSettings().costTrackingEnabled;


  const filtered = useMemo(() => {
    let arr = items;
    if (catFilter !== 'all') arr = arr.filter(i => i.categoryId === catFilter);
    if (statusFilter !== 'all') {
      arr = arr.filter(i => {
        const isOut = i.quantity === 0;
        const isLow = !isOut && i.quantity <= i.lowStockThreshold;
        if (statusFilter === 'out') return isOut;
        if (statusFilter === 'low') return isLow;
        if (statusFilter === 'ok') return !isOut && !isLow;
        if (statusFilter === 'active') return i.isActive !== false;
        if (statusFilter === 'inactive') return i.isActive === false;
        return true;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(i => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
    }
    return arr;
  }, [items, search, catFilter, statusFilter]);

  const allVisibleSelected = filtered.length > 0 && filtered.every(i => selected.has(i.id));
  const someSelected = selected.size > 0;
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) filtered.forEach(i => next.delete(i.id));
    else filtered.forEach(i => next.add(i.id));
    setSelected(next);
  };
  const clearSelection = () => setSelected(new Set());

  const lowStockItems = useMemo(() => items.filter(i => i.isActive && i.quantity <= i.lowStockThreshold), [items]);

  const refresh = () => {
    setItems(getInventory());
    setLogs(getStockLogs());
  };

  const doBulkDelete = async () => {
    if (deleteConfirmText !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    const ids = Array.from(selected);
    const t = toast.loading(`Deleting ${ids.length} items…`);
    let ok = 0, fail = 0;
    for (const id of ids) { try { await Promise.resolve(deleteInventoryItem(id)); ok++; } catch { fail++; } }
    setBulkDeleteOpen(false); setDeleteConfirmText(''); clearSelection(); refresh();
    if (fail) toast.error(`${ok} deleted, ${fail} failed`, { id: t });
    else toast.success(`${ok} items deleted`, { id: t });
  };
  const doBulkMove = async () => {
    if (!bulkMoveCat) { toast.error('Select a category'); return; }
    const t = toast.loading(`Moving ${selected.size} items…`);
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      const it = items.find(x => x.id === id); if (!it) { fail++; continue; }
      try { await Promise.resolve(saveInventoryItem({ ...it, categoryId: bulkMoveCat })); ok++; } catch { fail++; }
    }
    setBulkMoveOpen(false); setBulkMoveCat(''); clearSelection(); refresh();
    if (fail) toast.error(`${ok} moved, ${fail} failed`, { id: t });
    else toast.success(`${ok} items moved`, { id: t });
  };
  const doBulkSetActive = async (active: boolean) => {
    const t = toast.loading(`Updating ${selected.size} items…`);
    let ok = 0, fail = 0;
    for (const id of Array.from(selected)) {
      const it = items.find(x => x.id === id); if (!it) { fail++; continue; }
      try { await Promise.resolve(saveInventoryItem({ ...it, isActive: active })); ok++; } catch { fail++; }
    }
    clearSelection(); refresh();
    if (fail) toast.error(`${ok} updated, ${fail} failed`, { id: t });
    else toast.success(`${ok} items marked ${active ? 'Active' : 'Inactive'}`, { id: t });
  };

  const openAdd = () => {
    setEditItem(null);
    setName(''); setSku(''); setCategoryId(''); setCostPrice(''); setSalePrice('');
    setQuantity('0'); setUnit('pcs'); setLowStockThreshold('10'); setConversions([]);
    setCostMode('total');
    setShowForm(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditItem(item);
    setName(item.name); setSku(item.sku); setCategoryId(item.categoryId);
    setCostPrice(String(item.avgCostPrice ?? item.costPrice ?? 0)); setSalePrice(String(item.salePrice));
    setQuantity(String(item.quantity));
    setUnit(getBaseUnit(item));
    setLowStockThreshold(String(item.lowStockThreshold));
    setConversions(item.conversions ? [...item.conversions] : []);
    setShowForm(true);
  };

  const parsedQty = parseFloat(quantity) || 0;
  const enteredCost = parseFloat(costPrice) || 0;
  const normalizedUnitCost = !editItem && costMode === 'total' && parsedQty > 0 ? enteredCost / parsedQty : enteredCost;

  const saveItem = () => {
    if (!name) { toast.error('Name is required'); return; }
    const cleanConv = conversions
      .map(c => ({ unit: (c.unit || '').trim(), factor: Number(c.factor) || 0 }))
      .filter(c => c.unit && c.factor > 0);
    const item: InventoryItem = {
      id: editItem?.id || genId(),
      name,
      sku: sku || `SKU-${Date.now().toString(36).toUpperCase()}`,
      categoryId,
      costPrice: normalizedUnitCost,
      avgCostPrice: normalizedUnitCost || editItem?.avgCostPrice,
      salePrice: parseFloat(salePrice) || 0,
      quantity: parsedQty,
      unit,
      baseUnit: unit,
      conversions: cleanConv,
      lowStockThreshold: parseInt(lowStockThreshold) || 10,
      isActive: editItem?.isActive ?? true,
      image: editItem?.image,
    };
    saveInventoryItem(item);
    toast.success(editItem ? 'Item updated' : 'Item added');
    setShowForm(false);
    refresh();
  };

  const handleDelete = (id: string) => {
    deleteInventoryItem(id);
    toast.success('Item deleted');
    refresh();
  };

  const openStockAdjust = (item: InventoryItem, type: 'in' | 'out') => {
    setStockItem(item);
    setStockType(type);
    setStockQty('');
    setStockNote('');
    setShowStockDialog(true);
  };

  const handleStockAdjust = () => {
    const qty = parseFloat(stockQty);
    if (!stockItem || isNaN(qty) || qty <= 0) { toast.error('Enter valid quantity'); return; }
    adjustStock(stockItem.id, qty, stockType, stockNote || (stockType === 'in' ? 'Stock In' : 'Stock Out'));
    toast.success(`Stock ${stockType === 'in' ? 'added' : 'removed'}: ${qty} ${stockItem.unit}`);
    setShowStockDialog(false);
    refresh();
  };

  const itemLogs = useMemo(() => {
    if (!stockItem) return [];
    return logs.filter(l => l.inventoryItemId === stockItem.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);
  }, [stockItem, logs]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" /> Inventory Management
        </h2>
        <Button onClick={openAdd} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Item
        </Button>
      </div>

      {/* Low Stock Alerts */}
      {lowStockItems.length > 0 && (
        <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-3">
          <p className="text-sm font-bold text-status-warning flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4" /> Low Stock Alert ({lowStockItems.length} items)
          </p>
          <div className="flex flex-wrap gap-2">
            {lowStockItems.map(i => (
              <Badge key={i.id} variant="secondary" className="bg-status-warning/20 text-status-warning border-status-warning/30 text-xs">
                {i.name}: {i.quantity} {i.unit}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="h-9 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="ok">In Stock (OK)</SelectItem>
            <SelectItem value="low">Low Stock</SelectItem>
            <SelectItem value="out">Out of Stock</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action toolbar */}
      {someSelected && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-violet-600 text-white rounded-lg px-3 py-2 shadow">
          <span className="text-xs font-bold">{selected.size} selected</span>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setBulkMoveOpen(true)}>
            <FolderInput className="h-3 w-3 mr-1" /> Move to Category
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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-primary">{items.length}</p>
          <p className="text-xs text-muted-foreground">Total Items</p>
        </div>
        <div className="bg-card rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-status-success">{items.filter(i => i.quantity > i.lowStockThreshold).length}</p>
          <p className="text-xs text-muted-foreground">In Stock</p>
        </div>
        <div className="bg-card rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-status-warning">{lowStockItems.length}</p>
          <p className="text-xs text-muted-foreground">Low Stock</p>
        </div>
        <div className="bg-card rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-destructive">{items.filter(i => i.quantity === 0).length}</p>
          <p className="text-xs text-muted-foreground">Out of Stock</p>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="py-2.5 px-3 w-8"><Checkbox checked={allVisibleSelected} onCheckedChange={toggleAllVisible} aria-label="Select all" /></th>
                <th className="text-left py-2.5 px-3 font-bold">Item</th>
                <th className="text-left py-2.5 px-3 font-bold">SKU</th>
                <th className="text-left py-2.5 px-3 font-bold">Category</th>
                <th className="text-right py-2.5 px-3 font-bold">Avg Cost / Unit</th>
                <th className="text-right py-2.5 px-3 font-bold">Sale</th>
                <th className="text-center py-2.5 px-3 font-bold">Stock</th>
                <th className="text-center py-2.5 px-3 font-bold">Unit</th>
                <th className="text-center py-2.5 px-3 font-bold">Status</th>
                <th className="text-center py-2.5 px-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">No inventory items found. Click "Add Item" to start.</td></tr>
              ) : (
                filtered.map((item, idx) => {
                  const cat = categories.find(c => c.id === item.categoryId);
                  const isLow = item.quantity <= item.lowStockThreshold;
                  const isOut = item.quantity === 0;
                  return (
                    <tr key={item.id} className={`border-b hover:bg-accent/30 transition-colors ${selected.has(item.id) ? 'bg-violet-50 dark:bg-violet-950/30' : idx % 2 === 0 ? '' : 'bg-muted/20'}`}>
                      <td className="py-2 px-3"><Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggleOne(item.id)} aria-label={`Select ${item.name}`} /></td>
                      <td className="py-2 px-3 font-semibold">{item.name}</td>
                      <td className="py-2 px-3 text-muted-foreground font-mono text-xs">{item.sku}</td>
                      <td className="py-2 px-3">{cat ? `${cat.icon} ${cat.name}` : '—'}</td>
                        <td className="py-2 px-3 text-right">{money((item.avgCostPrice ?? item.costPrice ?? 0))} / {getBaseUnit(item)}</td>
                      <td className="py-2 px-3 text-right font-bold text-primary">{money(item.salePrice)}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`font-bold ${isOut ? 'text-destructive' : isLow ? 'text-status-warning' : 'text-status-success'}`}>
                          {item.quantity}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center text-muted-foreground">{item.unit}</td>
                      <td className="py-2 px-3 text-center">
                        {isOut ? (
                          <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-[10px]">Out</Badge>
                        ) : isLow ? (
                          <Badge className="bg-status-warning/20 text-status-warning border-status-warning/30 text-[10px]">Low</Badge>
                        ) : (
                          <Badge className="bg-status-success/20 text-status-success border-status-success/30 text-[10px]">OK</Badge>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 text-status-success border-status-success/30 hover:bg-status-success/10"
                            onClick={() => openStockAdjust(item, 'in')}>
                            <PackagePlus className="h-3 w-3 mr-0.5" /> In
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 text-status-warning border-status-warning/30 hover:bg-status-warning/10"
                            onClick={() => openStockAdjust(item, 'out')}>
                            <PackageMinus className="h-3 w-3 mr-0.5" /> Out
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(item)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDelete(item.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editItem ? 'Edit Item' : 'Add Inventory Item'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold text-muted-foreground">Item Name *</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Chicken Breast" autoFocus />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">SKU / Barcode</label>
              <Input value={sku} onChange={e => setSku(e.target.value)} placeholder="Auto-generated if empty" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">Category</label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select Category" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-muted-foreground">
                  {editItem
                    ? `Cost Per ${unit.toUpperCase()} ({currencySymbol()})`
                    : costMode === 'total'
                      ? `Total Bulk Cost ({currencySymbol()})`
                      : `Cost Per ${unit.toUpperCase()} ({currencySymbol()})`}
                </label>
                {!editItem && (
                  <div className="flex gap-1 text-[10px]">
                    <button type="button"
                      onClick={() => setCostMode('total')}
                      className={`px-2 py-0.5 rounded border ${costMode === 'total' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted'}`}>
                      Bulk Total
                    </button>
                    <button type="button"
                      onClick={() => setCostMode('perUnit')}
                      className={`px-2 py-0.5 rounded border ${costMode === 'perUnit' ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted'}`}>
                      Per {unit}
                    </button>
                  </div>
                )}
              </div>
              <Input type="number" value={costPrice} onChange={e => setCostPrice(e.target.value)} placeholder="0" />
              <p className="text-[10px] text-muted-foreground mt-1">
                {editItem
                  ? `Price per 1 ${unit}`
                  : costMode === 'total'
                    ? `Total value of the whole opening stock. The per-${unit} rate is calculated automatically.`
                    : `Enter the rate for 1 ${unit} only.`}
              </p>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">Sale Price ({currencySymbol()})</label>
              <Input type="number" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">Opening Stock</label>
              <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">Base Unit (stock unit)</label>
              <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BASE_UNITS.map(u => <SelectItem key={u} value={u}>{u.toUpperCase()}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground">Low Stock Alert At</label>
              <Input type="number" value={lowStockThreshold} onChange={e => setLowStockThreshold(e.target.value)} placeholder="10" />
            </div>
          </div>

          {!editItem && parsedQty > 0 && enteredCost > 0 && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Opening stock</span>
                <span className="font-semibold">{parsedQty} {unit}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{costMode === 'total' ? 'Total purchase cost' : `Rate per ${unit}`}</span>
                <span className="font-semibold">{money(enteredCost)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-1">
                <span className="text-muted-foreground">Cost per {unit}</span>
                <span className="font-bold text-primary">{money(normalizedUnitCost.toFixed(2))}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Total stock value</span>
                <span className="font-semibold">{money((normalizedUnitCost * parsedQty))}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Example: 50 {unit} ka total bill Rs. 6000 ho to recipe me 100g / 250g cost automatically sahi niklegi.
              </p>
            </div>
          )}

          {/* Purchase unit conversions */}
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold">Purchase Unit Conversions</h4>
                <p className="text-[10px] text-muted-foreground">
                  e.g. 1 Gatta = 20 KG → unit "Gatta", factor "20" (in base unit {unit.toUpperCase()})
                </p>
              </div>
              <Button size="sm" variant="outline" type="button"
                onClick={() => setConversions(c => [...c, { unit: '', factor: 0 }])}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {conversions.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">
                Built-in: 1 KG = 1000 g, 1 L = 1000 ml. Add custom packs (Gatta/Bag/Carton) here.
              </p>
            )}
            {conversions.map((c, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <Input
                    placeholder="Unit name (Gatta / Bag / Carton)"
                    value={c.unit}
                    list={`pu-list-${idx}`}
                    onChange={e => setConversions(arr => arr.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))}
                  />
                  <datalist id={`pu-list-${idx}`}>
                    {PURCHASE_UNITS.map(u => <option key={u} value={u} />)}
                  </datalist>
                </div>
                <div className="col-span-2 text-center text-xs">=</div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="Factor"
                    value={c.factor || ''}
                    onChange={e => setConversions(arr => arr.map((x, i) => i === idx ? { ...x, factor: parseFloat(e.target.value) || 0 } : x))}
                  />
                </div>
                <div className="col-span-1 text-[10px] text-muted-foreground">{unit}</div>
                <div className="col-span-1 text-right">
                  <Button size="sm" variant="ghost" type="button" className="h-7 w-7 p-0 text-destructive"
                    onClick={() => setConversions(arr => arr.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button className="w-full mt-2" onClick={saveItem}>
            {editItem ? 'Update Item' : 'Add Item'}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Stock In/Out Dialog */}
      <Dialog open={showStockDialog} onOpenChange={setShowStockDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {stockType === 'in' ? <PackagePlus className="h-5 w-5 text-status-success" /> : <PackageMinus className="h-5 w-5 text-status-warning" />}
              {stockType === 'in' ? 'Stock In' : 'Stock Out'} — {stockItem?.name}
            </DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="adjust">
            <TabsList className="w-full">
              <TabsTrigger value="adjust" className="flex-1">Adjust Stock</TabsTrigger>
              <TabsTrigger value="history" className="flex-1">
                <History className="h-3.5 w-3.5 mr-1" /> History
              </TabsTrigger>
            </TabsList>
            <TabsContent value="adjust" className="space-y-3">
              <div className="bg-accent rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Current Stock</p>
                <p className="text-2xl font-bold text-primary">{stockItem?.quantity} {stockItem?.unit}</p>
              </div>
              <Input type="number" placeholder={`Enter ${stockType === 'in' ? 'received' : 'used'} quantity`}
                value={stockQty} onChange={e => setStockQty(e.target.value)} autoFocus />
              <Input placeholder="Note (optional)" value={stockNote} onChange={e => setStockNote(e.target.value)} />
              <Button className={`w-full ${stockType === 'in' ? 'bg-status-success hover:bg-status-success/90 text-status-success-foreground' : 'bg-status-warning hover:bg-status-warning/90 text-status-warning-foreground'}`}
                onClick={handleStockAdjust}>
                {stockType === 'in' ? '+ Add Stock' : '- Remove Stock'}
              </Button>
            </TabsContent>
            <TabsContent value="history">
              <div className="max-h-[300px] overflow-y-auto pos-scrollbar space-y-1">
                {itemLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No history yet</p>
                ) : (
                  itemLogs.map(log => (
                    <div key={log.id} className="flex items-center justify-between bg-accent/50 rounded-md px-3 py-2 text-xs">
                      <div>
                        <Badge className={`text-[10px] mr-2 ${
                          log.type === 'in' ? 'bg-status-success/20 text-status-success' :
                          log.type === 'sale' ? 'bg-primary/20 text-primary' :
                          'bg-status-warning/20 text-status-warning'
                        }`}>{log.type.toUpperCase()}</Badge>
                        <span className="text-muted-foreground">{log.note}</span>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold ${log.type === 'in' ? 'text-status-success' : 'text-destructive'}`}>
                          {log.type === 'in' ? '+' : '-'}{log.quantity}
                        </span>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(log.date).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Bulk Move dialog */}
      <ConfirmDialog open={bulkMoveOpen} onOpenChange={setBulkMoveOpen}>
        <ConfirmContent className="sm:max-w-sm">
          <ConfirmHeader><ConfirmTitle>Move {selected.size} items</ConfirmTitle></ConfirmHeader>
          <Select value={bulkMoveCat} onValueChange={setBulkMoveCat}>
            <SelectTrigger><SelectValue placeholder="Choose category…" /></SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <ConfirmFooter>
            <Button variant="outline" onClick={() => setBulkMoveOpen(false)}>Cancel</Button>
            <Button onClick={doBulkMove} className="bg-violet-600 hover:bg-violet-700 text-white">Move</Button>
          </ConfirmFooter>
        </ConfirmContent>
      </ConfirmDialog>

      {/* Bulk Delete dialog */}
      <ConfirmDialog open={bulkDeleteOpen} onOpenChange={(o) => { setBulkDeleteOpen(o); if (!o) setDeleteConfirmText(''); }}>
        <ConfirmContent className="sm:max-w-sm">
          <ConfirmHeader><ConfirmTitle className="text-destructive">Delete {selected.size} items?</ConfirmTitle></ConfirmHeader>
          <p className="text-xs text-muted-foreground">
            Ye action permanent hai. Confirm karne k liye neeche <b className="text-destructive">DELETE</b> type karein.
          </p>
          <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder="Type DELETE" />
          <ConfirmFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doBulkDelete} disabled={deleteConfirmText !== 'DELETE'}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete {selected.size}
            </Button>
          </ConfirmFooter>
        </ConfirmContent>
      </ConfirmDialog>
    </div>
  );
}