// Receipt template picker + one-click printing behaviour.
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Check, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import {
  RECEIPT_TEMPLATES, getReceiptTemplate, setReceiptTemplate, type ReceiptTemplate,
} from '@/lib/receiptTemplates';
import { isPrintPreviewEnabled, setPrintPreviewEnabled } from '@/lib/printPreferences';
import { getSettings, saveSettings } from '@/lib/store';

export default function ReceiptTemplateCard() {
  const [template, setTemplate] = useState<ReceiptTemplate>(getReceiptTemplate());
  const [preview, setPreview] = useState(isPrintPreviewEnabled());
  const [showBill, setShowBill] = useState(false);

  useEffect(() => {
    try { setShowBill(!!getSettings().showBillOnScreen); } catch { /* not ready */ }
  }, []);

  const choose = (id: ReceiptTemplate) => {
    setTemplate(id);
    setReceiptTemplate(id);
    toast.success(`${RECEIPT_TEMPLATES.find(t => t.id === id)?.name} template selected`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Receipt className="h-5 w-5" /> Receipt Template
        </CardTitle>
        <CardDescription>
          Pick one ready-made bill design. Values fill in automatically — nothing to design.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          {RECEIPT_TEMPLATES.map(t => {
            const active = template === t.id;
            return (
              <button
                key={t.id}
                onClick={() => choose(t.id)}
                className={`rounded-lg border p-3 text-left transition ${
                  active ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{t.name}</span>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm font-medium">Show the bill on screen before printing</Label>
            <p className="text-xs text-muted-foreground">
              Off = one click and the bill comes straight out of the printer.
            </p>
          </div>
          <Switch
            checked={preview}
            onCheckedChange={(v) => {
              setPreview(v);
              setPrintPreviewEnabled(v);
              toast.success(v ? 'Bill will appear on screen first' : 'One-click instant printing is on');
            }}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm font-medium">Keep a copy of the paid bill open on screen</Label>
            <p className="text-xs text-muted-foreground">
              Off = the screen stays on billing, the paper comes out on its own.
            </p>
          </div>
          <Switch
            checked={showBill}
            onCheckedChange={(v) => {
              setShowBill(v);
              try { saveSettings({ ...getSettings(), showBillOnScreen: v }); } catch { /* ignore */ }
              toast.success(v ? 'Paid bill will stay on screen' : 'Screen will not stop after payment');
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
