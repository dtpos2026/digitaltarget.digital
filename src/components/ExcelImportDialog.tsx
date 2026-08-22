// Excel/CSV Import — parse multi-sheet xlsx, auto-classify rows into
// categories, menu items, ingredients, then hand off to MenuImportPreview.
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { genId } from '@/lib/store';
import type { Category, MenuItem, InventoryItem } from '@/lib/types';
import MenuImportPreview from './MenuImportPreview';

interface Props {
  existingCategories: Category[];
  existingItems: MenuItem[];
  existingInventory: InventoryItem[];
  onClose: () => void;
  onImport: (data: { categories: Category[]; menuItems: MenuItem[]; inventory: InventoryItem[] }) => Promise<void> | void;
}

function norm(s: any): string {
  return String(s ?? '').trim().toLowerCase().replace(/[_\-\s]+/g, '');
}
function pick(row: any, ...keys: string[]): any {
  const idx: Record<string, any> = {};
  for (const k of Object.keys(row)) idx[norm(k)] = row[k];
  for (const k of keys) {
    const v = idx[norm(k)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}
function num(v: any, d = 0): number {
  if (v === undefined || v === null || v === '') return d;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : d;
}

type SheetKind = 'categories' | 'items' | 'inventory' | 'unknown';

function classifySheet(name: string, headers: string[]): SheetKind {
  const n = norm(name);
  if (/categor/.test(n) && !/ingredient|inv/.test(n)) return 'categories';
  if (/ingredient|inventory|stock/.test(n)) return 'inventory';
  if (/item|menu|product/.test(n)) return 'items';
  const h = headers.map(norm);
  const has = (k: string) => h.some(x => x.includes(k));
  if (has('costprice') || has('sku') || has('unit') || has('baseunit')) return 'inventory';
  if (has('price') || has('rateperkg') || has('pricingtype')) return 'items';
  if (h.length <= 3 && has('name')) return 'categories';
  return 'unknown';
}

export default function ExcelImportDialog({
  existingCategories, existingItems, existingInventory, onClose, onImport,
}: Props) {
  const [parsed, setParsed] = useState<{ categories: Category[]; menuItems: MenuItem[]; inventory: InventoryItem[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });

      // Build a working category map (name -> id) starting from existing
      const catByName = new Map<string, Category>();
      existingCategories.forEach(c => catByName.set(norm(c.name), c));
      const newCats: Category[] = [];
      const ensureCat = (name: string, icon = '📋'): Category => {
        const k = norm(name);
        if (!k) return existingCategories[0] || { id: 'uncategorized', name: 'Uncategorized', icon, sortOrder: 0 };
        const ex = catByName.get(k);
        if (ex) return ex;
        const c: Category = { id: genId(), name: String(name).trim(), icon, sortOrder: catByName.size };
        catByName.set(k, c);
        newCats.push(c);
        return c;
      };

      const exItemByName = new Map<string, MenuItem>();
      existingItems.forEach(i => exItemByName.set(norm(i.name), i));
      const exInvByKey = new Map<string, InventoryItem>();
      existingInventory.forEach(i => {
        exInvByKey.set(norm(i.name), i);
        if (i.sku) exInvByKey.set(norm(i.sku), i);
      });

      const menuItems: MenuItem[] = [];
      const inventory: InventoryItem[] = [];

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (rows.length === 0) continue;
        const headers = Object.keys(rows[0]);
        const kind = classifySheet(sheetName, headers);

        if (kind === 'categories') {
          for (const r of rows) {
            const name = pick(r, 'name', 'category', 'title');
            if (!name) continue;
            ensureCat(String(name), String(pick(r, 'icon') || '📋'));
          }
        } else if (kind === 'items' || kind === 'unknown') {
          // Merge rows by (categoryId + lowercased name) to combine variant rows of the same item
          const byKey = new Map<string, MenuItem>();
          // Pre-seed with items already collected so far (from earlier sheets)
          for (const mi of menuItems) byKey.set(`${mi.categoryId}::${norm(mi.name)}`, mi);
          for (const r of rows) {
            const name = pick(r, 'name', 'item', 'product', 'title');
            if (!name) continue;
            const catName = pick(r, 'category', 'cat', 'categoryname');
            const cat = ensureCat(catName ? String(catName) : 'Uncategorized');
            const key = `${cat.id}::${norm(name)}`;
            const ex = exItemByName.get(norm(name));
            let merged = byKey.get(key);

            // Detect variant-row columns
            const sizeName = String(pick(r, 'sizename', 'size') || '').trim();
            const sizePrice = pick(r, 'sizeprice');
            const inchSize = String(pick(r, 'inchsize', 'inches', 'inch') || '').trim();
            const inchPrice = pick(r, 'inchprice');
            const declaredType = String(pick(r, 'pricingtype', 'type') || '').toLowerCase();
            const subCat = String(pick(r, 'subcategory', 'flavorgroup', 'flavor') || ex?.subCategory || '').trim();

            if (!merged) {
              merged = {
                id: ex?.id || genId(),
                name: String(name).trim(),
                categoryId: cat.id,
                pricingType: 'fixed',
                price: num(pick(r, 'price', 'saleprice', 'rate'), ex?.price || 0),
                ratePerKg: num(pick(r, 'rateperkg', 'kgprice'), ex?.ratePerKg || 0),
                image: String(pick(r, 'image', 'imageurl', 'photo') || ex?.image || ''),
                isActive: ex?.isActive ?? true,
                kitchenId: String(pick(r, 'kitchen', 'kitchenid') || ex?.kitchenId || ''),
                subCategory: subCat || undefined,
                sizeVariants: ex?.sizeVariants ? [...ex.sizeVariants] : [],
                inchVariants: ex?.inchVariants ? [...ex.inchVariants] : [],
              };
              byKey.set(key, merged);
              menuItems.push(merged);
            }
            if (subCat && !merged.subCategory) merged.subCategory = subCat;

            // Apply variant rows
            if (sizeName && sizePrice !== undefined && String(sizePrice).trim() !== '') {
              merged.sizeVariants = merged.sizeVariants || [];
              if (!merged.sizeVariants.some(v => norm(v.name) === norm(sizeName))) {
                merged.sizeVariants.push({ name: sizeName, price: num(sizePrice, 0) });
              }
            }
            if (inchSize && inchPrice !== undefined && String(inchPrice).trim() !== '') {
              merged.inchVariants = merged.inchVariants || [];
              if (!merged.inchVariants.some(v => norm(v.name) === norm(inchSize))) {
                merged.inchVariants.push({ name: inchSize, price: num(inchPrice, 0) });
              }
            }

            // Auto-derive pricingType after collecting any variant rows
            const hasSize = (merged.sizeVariants?.length || 0) > 0;
            const hasInch = (merged.inchVariants?.length || 0) > 0;
            if (['fixed', 'weight', 'manual', 'size', 'inch', 'both'].includes(declaredType)) {
              merged.pricingType = declaredType as any;
            } else if (hasSize && hasInch) {
              merged.pricingType = 'both';
            } else if (hasSize) {
              merged.pricingType = 'size';
            } else if (hasInch) {
              merged.pricingType = 'inch';
            }
          }
        } else if (kind === 'inventory') {
          for (const r of rows) {
            const name = pick(r, 'name', 'ingredient', 'item');
            if (!name) continue;
            const sku = String(pick(r, 'sku', 'code') || '');
            const catName = pick(r, 'category', 'cat');
            const cat = ensureCat(catName ? String(catName) : 'Ingredients');
            const ex = exInvByKey.get(norm(name)) || (sku ? exInvByKey.get(norm(sku)) : undefined);
            inventory.push({
              id: ex?.id || genId(),
              name: String(name).trim(),
              sku: sku || ex?.sku || '',
              categoryId: cat.id,
              costPrice: num(pick(r, 'costprice', 'cost'), ex?.costPrice || 0),
              salePrice: num(pick(r, 'saleprice', 'price'), ex?.salePrice || 0),
              quantity: num(pick(r, 'quantity', 'stock', 'qty'), ex?.quantity || 0),
              unit: String(pick(r, 'unit') || ex?.unit || 'pcs'),
              baseUnit: (String(pick(r, 'baseunit') || ex?.baseUnit || 'pcs').toLowerCase() as any),
              lowStockThreshold: num(pick(r, 'lowstockthreshold', 'lowstock'), ex?.lowStockThreshold || 0),
              image: String(pick(r, 'image', 'imageurl') || ex?.image || ''),
              isActive: ex?.isActive ?? true,
            });
          }
        }
      }

      const data = { categories: newCats, menuItems, inventory };
      if (newCats.length === 0 && menuItems.length === 0 && inventory.length === 0) {
        toast.error('No valid data found in the file. Check the headers: name, category, price/costPrice.');
        return;
      }
      setParsed(data);
    } catch (e: any) {
      toast.error(`Read failed: ${e?.message || e}`);
    }
  };

  const confirm = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      await onImport(parsed);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'Import failed');
    }
    setSaving(false);
  };

  if (parsed) {
    return (
      <MenuImportPreview
        data={parsed}
        existingCategories={existingCategories}
        existingItems={existingItems}
        existingInventory={existingInventory}
        onCancel={() => setParsed(null)}
        onConfirm={confirm}
        saving={saving}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-violet-600" /> Import Excel / CSV
          </DialogTitle>
        </DialogHeader>

        <label className="border-2 border-dashed border-violet-400 rounded-xl p-6 text-center cursor-pointer hover:bg-violet-500/5 transition block">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="flex items-center justify-center gap-2 text-violet-700">
            <Upload className="h-5 w-5" />
            <span className="font-bold">Choose an Excel or CSV file</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2 text-left">
            <b>Supported sheets / columns:</b><br />
            • <b>Categories</b> sheet → <code>name, icon</code><br />
            • <b>Menu Items</b> / Products sheet → <code>name, category, subCategory, price, pricingType, sizeName, sizePrice, inchSize, inchPrice, image, kitchen</code><br />
            <span className="text-[10px] text-amber-700">Pizza / variant items: same <code>name</code> with multiple rows (different <code>sizeName</code>/<code>inchSize</code>) auto-merge into variants.</span><br />
            • <b>Ingredients</b> / Inventory sheet → <code>name, sku, category, costPrice, salePrice, quantity, unit, baseUnit, lowStockThreshold, image</code><br />
            If there is no sheet name, it is auto-detected from the columns.
          </div>
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
