import { useState, useMemo } from 'react';
import { money } from '@/lib/currency';
import { InventoryItem, Wastage, WastageReason } from '@/lib/types';
import { getInventory, getWastages, saveWastage, deleteWastage, genId } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getBaseUnit, toBaseQty } from '@/lib/units';

const REASONS: { value: WastageReason; label: string }[] = [
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'spilled', label: 'Spilled' },
  { value: 'returned', label: 'Customer Returned' },
  { value: 'staff-meal', label: 'Staff Meal' },
  { value: 'other', label: 'Other' },
];

export default function WastagePage() {
  const [inventory] = useState<InventoryItem[]>(() => getInventory());
  const [wastages, setWastages] = useState<Wastage[]>(() => getWastages());
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<WastageReason>('expired');
  const [note, setNote] = useState('');

  const refresh = () => setWastages(getWastages());

  const totals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    let todayValue = 0, monthValue = 0;
    for (const w of wastages) {
      if (w.date.slice(0, 10) === today) todayValue += w.costValue;
      if (w.date.slice(0, 7) === month) monthValue += w.costValue;
    }
    return { todayValue, monthValue, total: wastages.length };
  }, [wastages]);

  const sorted = useMemo(() =>
    [...wastages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  , [wastages]);

  const save = () => {
    const item = inventory.find(i => i.id === itemId);
    const q = parseFloat(qty);
    if (!item) { toast.error('Select an ingredient'); return; }
    if (!q || q <= 0) { toast.error('Enter valid quantity'); return; }
    const baseQty = toBaseQty(item, q, getBaseUnit(item));
    const unitCost = item.avgCostPrice ?? item.costPrice ?? 0;
    const w: Wastage = {
      id: genId(),
      date: new Date().toISOString(),
      inventoryItemId: item.id,
      inventoryItemName: item.name,
      quantity: q,
       unit: getBaseUnit(item),
       costValue: baseQty * unitCost,
      reason,
      note,
      recordedBy: localStorage.getItem('pos-user-id') || undefined,
    };
    saveWastage(w);
    toast.success(`Wastage logged: ${q} ${item.unit} (${money(w.costValue.toFixed(0))})`);
    setOpen(false);
    setItemId(''); setQty(''); setReason('expired'); setNote('');
    refresh();
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-destructive" /> Wastage Management
        </h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Log Wastage
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-destructive">{money(totals.todayValue.toFixed(0))}</p>
          <p className="text-xs text-muted-foreground">Today's Wastage</p>
        </div>
        <div className="bg-card rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-status-warning">{money(totals.monthValue.toFixed(0))}</p>
          <p className="text-xs text-muted-foreground">This Month</p>
        </div>
        <div className="bg-card rounded-lg border p-3 text-center">
          <p className="text-2xl font-bold text-primary">{totals.total}</p>
          <p className="text-xs text-muted-foreground">Total Entries</p>
        </div>
      </div>

      {inventory.length === 0 && (
        <div className="bg-status-warning/10 border border-status-warning/30 rounded-lg p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-status-warning" />
          Pehle Inventory mein items add karein.
        </div>
      )}

      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-2.5 px-3 font-bold">Date</th>
                <th className="text-left py-2.5 px-3 font-bold">Item</th>
                <th className="text-right py-2.5 px-3 font-bold">Qty</th>
                <th className="text-center py-2.5 px-3 font-bold">Reason</th>
                <th className="text-left py-2.5 px-3 font-bold">Note</th>
                <th className="text-right py-2.5 px-3 font-bold">Cost</th>
                <th className="text-center py-2.5 px-3 font-bold">Action</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No wastage logged yet.</td></tr>
              ) : sorted.map((w, idx) => (
                <tr key={w.id} className={`border-b hover:bg-accent/30 ${idx % 2 ? 'bg-muted/20' : ''}`}>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{new Date(w.date).toLocaleString('en-PK', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="py-2 px-3 font-semibold">{w.inventoryItemName}</td>
                  <td className="py-2 px-3 text-right">{w.quantity} {w.unit}</td>
                  <td className="py-2 px-3 text-center">
                    <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] capitalize">{w.reason}</Badge>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground text-xs">{w.note || '—'}</td>
                  <td className="py-2 px-3 text-right font-bold text-destructive">{money(w.costValue.toFixed(0))}</td>
                  <td className="py-2 px-3 text-center">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                      onClick={() => { deleteWastage(w.id); toast.success('Removed'); refresh(); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log Wastage</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-muted-foreground">Ingredient *</label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder="Select item..." /></SelectTrigger>
                <SelectContent>
                  {inventory.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} in stock)</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground">Quantity *</label>
                <Input type="number" step="0.01" value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground">Reason</label>
                <Select value={reason} onValueChange={v => setReason(v as WastageReason)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
            <Button className="w-full" onClick={save}>Save & Deduct Stock</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
