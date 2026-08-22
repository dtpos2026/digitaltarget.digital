import { useState, useEffect } from 'react';
import { money } from '@/lib/currency';
import { PromoCode } from '@/lib/types';
import { getPromoCodes, savePromoCode, deletePromoCode, genId } from '@/lib/store';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Edit3, Trash2, Tag, Percent, Banknote } from 'lucide-react';
import { toast } from 'sonner';

function emptyPromo(): PromoCode {
  return {
    id: genId(),
    code: '',
    discountType: 'percent',
    discountValue: 10,
    isActive: true,
    usageCount: 0,
    createdAt: new Date().toISOString(),
  };
}

export default function PromoCodesPage() {
  const [list, setList] = useState<PromoCode[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PromoCode>(emptyPromo());

  const refresh = () => setList(getPromoCodes());
  useEffect(() => { refresh(); }, []);

  const onSave = () => {
    if (!draft.code.trim()) return toast.error('Code required');
    if (!draft.discountValue || draft.discountValue <= 0) return toast.error('Discount value required');
    savePromoCode(draft);
    toast.success('Promo saved');
    setOpen(false);
    refresh();
  };

  const onEdit = (p: PromoCode) => { setDraft({ ...p }); setOpen(true); };
  const onNew = () => { setDraft(emptyPromo()); setOpen(true); };
  const onDelete = (id: string) => {
    if (!confirm('Delete this promo code?')) return;
    deletePromoCode(id);
    refresh();
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" /> Promo Codes
        </h1>
        <Button onClick={onNew} size="sm"><Plus className="h-4 w-4 mr-1" /> New Promo</Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="text-left p-2">Code</th>
              <th className="text-left p-2">Type</th>
              <th className="text-right p-2">Value</th>
              <th className="text-center p-2">Validity</th>
              <th className="text-center p-2">Used / Limit</th>
              <th className="text-center p-2">Status</th>
              <th className="text-right p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={7} className="text-center text-muted-foreground p-6 text-xs">
                No promo codes yet. Click "New Promo" to create one.
              </td></tr>
            )}
            {list.map(p => (
              <tr key={p.id} className="border-t hover:bg-accent/30">
                <td className="p-2 font-mono font-bold">{p.code}</td>
                <td className="p-2">
                  {p.discountType === 'percent'
                    ? <Badge variant="secondary"><Percent className="h-3 w-3 mr-1" /> Percent</Badge>
                    : <Badge variant="secondary"><Banknote className="h-3 w-3 mr-1" /> PKR</Badge>}
                </td>
                <td className="p-2 text-right font-semibold">
                  {p.discountType === 'percent' ? `${p.discountValue}%` : `${money(p.discountValue)}`}
                </td>
                <td className="p-2 text-center text-xs">
                  {p.startDate || p.endDate
                    ? `${p.startDate || '—'} → ${p.endDate || '—'}`
                    : 'Always'}
                </td>
                <td className="p-2 text-center text-xs">
                  {p.usageCount || 0}{p.usageLimit ? ` / ${p.usageLimit}` : ''}
                </td>
                <td className="p-2 text-center">
                  {p.isActive ? <Badge className="bg-green-600">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                </td>
                <td className="p-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(p)}><Edit3 className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(p.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{draft.code ? 'Edit' : 'New'} Promo Code</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Code (e.g. EID50)</Label>
              <Input value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })} className="uppercase font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={draft.discountType} onValueChange={v => setDraft({ ...draft, discountType: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage %</SelectItem>
                    <SelectItem value="pkr">Flat PKR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Value</Label>
                <Input type="number" value={draft.discountValue || ''} onChange={e => setDraft({ ...draft, discountValue: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Start date</Label>
                <Input type="date" value={draft.startDate?.slice(0, 10) || ''} onChange={e => setDraft({ ...draft, startDate: e.target.value || undefined })} />
              </div>
              <div>
                <Label className="text-xs">End date</Label>
                <Input type="date" value={draft.endDate?.slice(0, 10) || ''} onChange={e => setDraft({ ...draft, endDate: e.target.value || undefined })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Usage limit (optional)</Label>
                <Input type="number" value={draft.usageLimit || ''} onChange={e => setDraft({ ...draft, usageLimit: Number(e.target.value) || undefined })} />
              </div>
              <div>
                <Label className="text-xs">Min order (PKR, optional)</Label>
                <Input type="number" value={draft.minOrderAmount || ''} onChange={e => setDraft({ ...draft, minOrderAmount: Number(e.target.value) || undefined })} />
              </div>
            </div>
            <div className="flex items-center justify-between border rounded p-2">
              <Label className="text-sm">Active</Label>
              <Switch checked={draft.isActive} onCheckedChange={v => setDraft({ ...draft, isActive: v })} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={onSave} className="flex-1">Save</Button>
              <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
