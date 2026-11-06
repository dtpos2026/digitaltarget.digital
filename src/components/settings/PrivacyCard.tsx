// Settings → General → Privacy (v1.109.0): the two requests every customer may make — "show me my data" and "forget me".
// The rules are in lib/privacy.ts (tested); this card only asks for the phone number, shows what would be touched,
// and requires the number to be typed again before anything is erased.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Download, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { exportCustomerPrivacyData } from '@/lib/store';
import { eraseEverywhere } from '@/lib/privacyErasures';
import { customerExportCsv, erasureConfirmed, phoneKey } from '@/lib/privacy';

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PrivacyCard() {
  const [phone, setPhone] = useState('');
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<{ profile: boolean; orders: number } | null>(null);

  const key = useMemo(() => phoneKey(phone), [phone]);

  const look = () => {
    if (!key) { toast.error('Type the customer’s phone number first'); return; }
    const exp = exportCustomerPrivacyData(phone);
    setFound({ profile: !!exp.profile, orders: exp.orders.length });
    setTyped('');
  };

  const exportData = (kind: 'json' | 'csv') => {
    if (!key) { toast.error('Type the customer’s phone number first'); return; }
    const exp = exportCustomerPrivacyData(phone);
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'json') download(`customer-data-${key}-${stamp}.json`, 'application/json', JSON.stringify(exp, null, 2));
    else download(`customer-orders-${key}-${stamp}.csv`, 'text/csv', customerExportCsv(exp));
    toast.success('File ready');
  };

  const erase = async () => {
    if (!erasureConfirmed(typed, phone)) { toast.error('Type the same phone number again to confirm'); return; }
    const r = await eraseEverywhere(phone);
    toast.success(`Erased: profile ${r.profileDeleted ? 'deleted' : 'not found'}, ${r.liveOrders + r.archivedOrders} order(s) made anonymous${r.marked ? ' · other devices will do the same when they next open' : ''}`);
    setFound(null); setTyped(''); setPhone('');
  };

  return (
    <div className="rounded-lg border p-3 space-y-3" data-testid="privacy-card">
      <div className="flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 text-primary shrink-0" aria-hidden />
        <div>
          <h4 className="text-sm font-bold">Privacy — customer data</h4>
          <p className="text-[11px] text-muted-foreground">
            A customer can ask to see what you hold about them, or to be forgotten. <b>Export</b> gives one file.
            <b> Erase</b> deletes the profile and removes the name, phone, address and map position from their orders; the sale
            (items, totals, tax, payment) stays, because your books must. No card number is stored by this software.
          </p>
        </div>
      </div>

      <a href="#/privacy" target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-primary underline" data-testid="privacy-policy-link">
        Open the privacy policy page (the link to give a customer)
      </a>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <Label htmlFor="privacy-phone" className="text-xs text-muted-foreground">Customer phone</Label>
          <Input id="privacy-phone" value={phone} onChange={e => { setPhone(e.target.value); setFound(null); }} placeholder="03xx xxxxxxx" inputMode="tel" />
        </div>
        <Button size="sm" variant="outline" onClick={look}>Find</Button>
        <Button size="sm" variant="outline" onClick={() => exportData('json')}><Download className="w-3.5 h-3.5 mr-1" aria-hidden />Export (JSON)</Button>
        <Button size="sm" variant="outline" onClick={() => exportData('csv')}><Download className="w-3.5 h-3.5 mr-1" aria-hidden />Orders (CSV)</Button>
      </div>

      {found && (
        <div className="rounded-md border p-2 space-y-2 text-[11px]" data-testid="privacy-found" role="status">
          <div>
            {found.profile ? 'A profile exists' : 'No profile'} · <b>{found.orders}</b> order(s) name this number.
            {!found.profile && found.orders === 0 && ' Nothing to erase.'}
          </div>
          {(found.profile || found.orders > 0) && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[12rem]">
                <Label htmlFor="privacy-confirm" className="text-xs text-muted-foreground">Type the phone number again to erase</Label>
                <Input id="privacy-confirm" value={typed} onChange={e => setTyped(e.target.value)} inputMode="tel" />
              </div>
              <Button size="sm" variant="destructive" onClick={erase} disabled={!erasureConfirmed(typed, phone)}>
                <Trash2 className="w-3.5 h-3.5 mr-1" aria-hidden />Erase this customer
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
