// Super Admin → Branding: the payment details and terms printed on every invoice (beside the signature image).
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { getInvoiceProfile, saveInvoiceProfile, type InvoiceProfile } from '@/lib/invoiceProfile';

export default function InvoiceDetailsPanel() {
  const [p, setP] = useState<InvoiceProfile>(() => getInvoiceProfile());
  const [terms, setTerms] = useState(() => getInvoiceProfile().terms.join('\n'));
  useEffect(() => { const cur = getInvoiceProfile(); setP(cur); setTerms(cur.terms.join('\n')); }, []);

  const save = () => {
    try {
      const saved = saveInvoiceProfile({ ...p, terms: terms.split('\n') });
      setP(saved); setTerms(saved.terms.join('\n'));
      toast.success('Invoice details saved');
    } catch { toast.error('Save failed'); }
  };

  return (
    <div className="border rounded-xl p-4 bg-card/50 space-y-3">
      <div className="flex items-center gap-2">
        <Landmark className="h-5 w-5 text-violet-600" />
        <div>
          <div className="font-extrabold text-sm">Invoice payment details &amp; terms</div>
          <div className="text-[11px] text-muted-foreground">Printed on every invoice. Leave the account fields empty to print no payment block.</div>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="text-xs font-semibold">Account title
          <Input className="mt-1" value={p.accountTitle} onChange={e => setP({ ...p, accountTitle: e.target.value })} maxLength={120} /></label>
        <label className="text-xs font-semibold">Bank
          <Input className="mt-1" value={p.bank} onChange={e => setP({ ...p, bank: e.target.value })} maxLength={120} /></label>
        <label className="text-xs font-semibold">Account / IBAN
          <Input className="mt-1" value={p.accountNo} onChange={e => setP({ ...p, accountNo: e.target.value })} maxLength={60} /></label>
      </div>
      <label className="text-xs font-semibold block">Terms &amp; conditions (one per line)
        <textarea className="mt-1 w-full rounded-md border bg-background p-2 text-sm min-h-[72px]" value={terms} onChange={e => setTerms(e.target.value)} />
      </label>
      <Button size="sm" onClick={save} className="bg-violet-600 hover:bg-violet-700 text-white">Save</Button>
    </div>
  );
}
