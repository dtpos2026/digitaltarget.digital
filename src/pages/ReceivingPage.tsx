import { useState, useMemo, useEffect } from 'react';
import { money } from '@/lib/currency';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Printer, Package } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SearchableSelect from '@/components/SearchableSelect';
import { toast } from 'sonner';
import {
  getReceivingEntries, saveReceivingEntry, deleteReceivingEntry, getInventory, getParties,
} from '@/lib/store';
import type { ReceivingEntry, InventoryItem, Party } from '@/lib/types';
import { getBaseUnit, toBaseQty, PURCHASE_UNITS } from '@/lib/units';

type FormState = {
  supplierName: string;
  inventoryItemId: string;
  itemName: string;
  quantity: number;
  unit: string;
  rate: number;
  surcharge: number;
  receivedBy: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  supplierName: '',
  inventoryItemId: '',
  itemName: '',
  quantity: 0,
  unit: 'kg',
  rate: 0,
  surcharge: 0,
  receivedBy: '',
  notes: '',
});

export default function ReceivingPage() {
  const [entries, setEntries] = useState<ReceivingEntry[]>(() => getReceivingEntries());
  const inventory = useMemo<InventoryItem[]>(() => getInventory(), []);
  const [partiesTick, setPartiesTick] = useState(0);
  const supplierParties = useMemo<Party[]>(
    () => getParties().filter(p => p.type === 'supplier' && p.isActive !== false),
    [partiesTick],
  );
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [dateFilter, setDateFilter] = useState('');

  const selectedItem = inventory.find(i => i.id === form.inventoryItemId);

  // Build per-item unit options (base + built-in + custom)
  const unitOptions = useMemo(() => {
    if (!selectedItem) return PURCHASE_UNITS;
    const base = getBaseUnit(selectedItem);
    const opts = new Set<string>([base]);
    if (base === 'kg') opts.add('g');
    if (base === 'g') opts.add('kg');
    if (base === 'l') opts.add('ml');
    if (base === 'ml') opts.add('l');
    (selectedItem.conversions || []).forEach(c => c.unit && opts.add(c.unit));
    PURCHASE_UNITS.forEach(u => opts.add(u));
    return Array.from(opts);
  }, [selectedItem]);

  // Auto-set unit when item changes
  useEffect(() => {
    if (selectedItem) {
      const base = getBaseUnit(selectedItem);
      setForm(f => ({ ...f, itemName: selectedItem.name, unit: f.unit || base }));
    }
  }, [selectedItem]);

  const baseQty = selectedItem ? toBaseQty(selectedItem, form.quantity || 0, form.unit) : 0;
  const baseUnit = selectedItem ? getBaseUnit(selectedItem) : '';
  const subtotal = (form.quantity || 0) * (form.rate || 0);
  const total = subtotal + (form.surcharge || 0);
  const baseUnitCost = baseQty > 0 ? total / baseQty : 0;

  const filtered = useMemo(() => {
    if (!dateFilter) return entries;
    return entries.filter(e => e.date.startsWith(dateFilter));
  }, [entries, dateFilter]);

  const addEntry = () => {
    if (!form.supplierName || !form.itemName || !form.quantity) {
      toast.error('Supplier, item and quantity are required');
      return;
    }
    if (!form.inventoryItemId) {
      toast.error('Select an inventory item (otherwise stock will not update)');
      return;
    }
    const entry: ReceivingEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      supplierName: form.supplierName,
      inventoryItemId: form.inventoryItemId,
      itemName: form.itemName,
      quantity: form.quantity,
      unit: form.unit,
      rate: form.rate,
      surcharge: form.surcharge || 0,
      receivedBy: form.receivedBy,
      notes: form.notes,
      date: new Date().toISOString(),
    };
    saveReceivingEntry(entry);
    setEntries(getReceivingEntries().slice());
    setPartiesTick(t => t + 1);
    setShowDialog(false);
    setForm(emptyForm());
    toast.success(`Stock updated: +${baseQty.toFixed(2)} ${baseUnit} • Supplier ledger updated`);
  };

  const deleteEntry = (id: string) => {
    if (!confirm('Delete this receiving entry? (Stock will not be adjusted back)')) return;
    deleteReceivingEntry(id);
    setEntries(entries.filter(e => e.id !== id));
    toast.info('Entry deleted');
  };

  const printSlip = (entry: ReceivingEntry) => {
    const w = window.open('', '_blank', 'width=320,height=500');
    if (!w) return;
    w.document.write(`
      <html><head><title>GRN Slip</title>
      <style>body{font-family:monospace;font-size:12px;width:80mm;margin:0 auto;padding:10px;}
      h2{text-align:center;margin:0 0 8px}hr{border:none;border-top:1px dashed #000}
      .row{display:flex;justify-content:space-between;margin:2px 0}
      .bold{font-weight:bold}</style></head><body>
      <h2>GOODS RECEIVING NOTE</h2><hr/>
      <div class="row"><span>Date:</span><span>${new Date(entry.date).toLocaleString('en-PK')}</span></div>
      <div class="row"><span>Supplier:</span><span class="bold">${entry.supplierName}</span></div>
      <hr/>
      <div class="row"><span>Item:</span><span class="bold">${entry.itemName}</span></div>
      <div class="row"><span>Qty:</span><span>${entry.quantity} ${entry.unit}</span></div>
      ${entry.baseQty ? `<div class="row"><span>Stock added:</span><span>${entry.baseQty.toFixed(2)} ${entry.baseUnit || ''}</span></div>` : ''}
      ${entry.rate ? `<div class="row"><span>Rate:</span><span>PKR ${entry.rate} / ${entry.unit}</span></div>` : ''}
      ${entry.rate ? `<div class="row"><span>Subtotal:</span><span>PKR ${(entry.quantity * entry.rate).toLocaleString()}</span></div>` : ''}
      ${entry.surcharge ? `<div class="row"><span>Surcharge:</span><span>PKR ${entry.surcharge.toLocaleString()}</span></div>` : ''}
      ${(entry.rate || entry.surcharge) ? `<div class="row bold"><span>Total:</span><span>PKR ${((entry.quantity * entry.rate) + (entry.surcharge || 0)).toLocaleString()}</span></div>` : ''}
      <hr/>
      ${entry.receivedBy ? `<div class="row"><span>Received By:</span><span>${entry.receivedBy}</span></div>` : ''}
      ${entry.notes ? `<div class="row"><span>Notes:</span><span>${entry.notes}</span></div>` : ''}
      </body></html>
    `);
    w.document.close();
    w.print();
  };

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Package className="h-5 w-5 text-status-teal" /> Goods Receiving (GRN)
        </h2>
        <Button size="sm" onClick={() => { setForm(emptyForm()); setShowDialog(true); }}>
          <Plus className="h-3 w-3 mr-1" /> New Entry
        </Button>
        <div className="ml-auto">
          <Input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="h-8 text-xs w-40" />
        </div>
      </div>

      {inventory.length === 0 && (
        <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-3 text-sm mb-3">
          ⚠️ Pehle <strong>Inventory</strong> page se items add karein, phir un ka stock yahan se receive ho ga.
        </div>
      )}

      <div className="bg-card border rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-bold">Date</th>
              <th className="text-left px-3 py-2 font-bold">Supplier</th>
              <th className="text-left px-3 py-2 font-bold">Item</th>
              <th className="text-right px-3 py-2 font-bold">Purchase Qty</th>
              <th className="text-right px-3 py-2 font-bold">Stock Added (Base)</th>
              <th className="text-right px-3 py-2 font-bold">Rate</th>
              <th className="text-right px-3 py-2 font-bold">Total</th>
              <th className="text-left px-3 py-2 font-bold">Received By</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} className="border-b hover:bg-accent/30">
                <td className="px-3 py-2 text-muted-foreground">{new Date(e.date).toLocaleDateString('en-PK')}</td>
                <td className="px-3 py-2 font-medium">{e.supplierName}</td>
                <td className="px-3 py-2 font-bold">{e.itemName}</td>
                <td className="px-3 py-2 text-right">
                  <span className="font-semibold">{e.quantity}</span> <Badge variant="secondary" className="text-[10px] ml-1">{e.unit}</Badge>
                </td>
                <td className="px-3 py-2 text-right">
                  {e.baseQty != null
                    ? <span className="font-bold text-status-success">+{e.baseQty.toFixed(2)} {e.baseUnit || ''}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 text-right">{e.rate ? `PKR ${e.rate}` : '—'}</td>
                <td className="px-3 py-2 text-right font-bold text-primary">
                  {(e.rate || e.surcharge) ? `PKR ${((e.quantity * e.rate) + (e.surcharge || 0)).toLocaleString()}` : '—'}
                  {e.surcharge ? <div className="text-[9px] font-normal text-muted-foreground">+{money(e.surcharge)} surcharge</div> : null}
                </td>
                <td className="px-3 py-2">{e.receivedBy || '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => printSlip(e)}><Printer className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteEntry(e.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No receiving entries</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>📦 New Receiving Entry</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Supplier * (Party Master)</label>
              <Input
                placeholder="Type supplier name — existing parties auto-suggest"
                value={form.supplierName}
                onChange={e => setForm({ ...form, supplierName: e.target.value })}
                list="receiving-supplier-list"
                autoFocus
              />
              <datalist id="receiving-supplier-list">
                {supplierParties.map(p => (
                  <option key={p.id} value={p.name}>{p.phone ? `${p.phone}` : ''}</option>
                ))}
              </datalist>
              <p className="text-[10px] text-muted-foreground mt-1">
                Nayi supplier likhne pe Party Master me automatic add ho jayega — same record Accounts, Ledger, Expenses sab jagah use ho ga.
              </p>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Inventory Item *</label>
              <SearchableSelect
                placeholder="Select item..."
                searchPlaceholder="Search inventory item..."
                emptyText={inventory.length === 0 ? 'No inventory items — add in Inventory page' : 'No match'}
                value={form.inventoryItemId}
                onChange={(v) => {
                  const it = inventory.find(i => i.id === v);
                  setForm(f => ({ ...f, inventoryItemId: v, itemName: it?.name || '', unit: it ? getBaseUnit(it) : f.unit }));
                }}
                options={inventory.map(i => ({
                  value: i.id,
                  label: i.name,
                  hint: getBaseUnit(i),
                }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Qty *</label>
                <Input type="number" step="0.01" placeholder="0" value={form.quantity || ''}
                  onChange={e => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Purchase Unit</label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {unitOptions.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Rate (per {form.unit})</label>
                <Input type="number" step="0.01" placeholder="0" value={form.rate || ''}
                  onChange={e => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })} />
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                Surcharge / Extra Charges (Freight, Loading, Tax etc.)
              </label>
              <Input type="number" step="0.01" placeholder="0"
                value={form.surcharge || ''}
                onChange={e => setForm({ ...form, surcharge: parseFloat(e.target.value) || 0 })} />
              <p className="text-[10px] text-muted-foreground mt-1">
                Yeh amount item ki cost me add ho jayega (per-unit cost barhayega).
              </p>
            </div>

            {selectedItem && form.quantity > 0 && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between"><span>Stock added in base unit:</span>
                  <span className="font-bold text-status-success">+{baseQty.toFixed(3)} {baseUnit}</span></div>
                {(form.rate > 0 || form.surcharge > 0) && (
                  <>
                    <div className="flex justify-between"><span>Subtotal ({form.quantity} × {form.rate}):</span>
                      <span>PKR {subtotal.toLocaleString()}</span></div>
                    {form.surcharge > 0 && (
                      <div className="flex justify-between"><span>+ Surcharge:</span>
                        <span>PKR {form.surcharge.toLocaleString()}</span></div>
                    )}
                    <div className="flex justify-between"><span>Cost per {baseUnit} (incl. surcharge):</span>
                      <span className="font-bold">PKR {baseUnitCost.toFixed(2)}</span></div>
                    <div className="flex justify-between border-t pt-1 mt-1">
                      <span>Total bill:</span>
                      <span className="font-bold text-primary">PKR {total.toLocaleString()}</span>
                    </div>
                  </>
                )}
                {baseQty === form.quantity && form.unit !== baseUnit && (
                  <div className="text-destructive text-[10px]">
                    ⚠️ Conversion missing for "{form.unit}". Add it in Inventory → Edit item → Purchase Unit Conversions.
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Received By" value={form.receivedBy} onChange={e => setForm({ ...form, receivedBy: e.target.value })} />
              <Input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>

            <Button className="w-full" onClick={addEntry}>Save Entry & Update Stock</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
