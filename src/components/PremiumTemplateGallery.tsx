// ============================================================
// PREMIUM TEMPLATE GALLERY
//
// Pick one of the premium layouts, see it filled in with the
// shop's own latest order, adjust what it shows, and save. A saved template
// prints exactly as previewed — the customization is stored, the CONTENT is
// read fresh from each order at print time, so nothing has to be typed in
// again per bill.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Check, LayoutTemplate, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { getOrders, getSettings, saveSettings } from '@/lib/store';
import { pickPreviewOrder } from '@/lib/sampleOrder';
import PremiumReceipt from '@/components/PremiumReceipt';
import {
  PREMIUM_TEMPLATES,
  DTR_TEMPLATES,
  ALL_PREMIUM_TEMPLATES,
  type PremiumTemplate,
  loadCustomization,
  saveCustomization,
  resetCustomization,
  customizedTemplateIds,
  getSelectedPremiumTemplate,
  setSelectedPremiumTemplate,
  isPremiumTemplateId,
  templateDisplayName,
  type PremiumCustomization,
  type PremiumTemplateId,
} from '@/lib/premiumReceiptTemplates';

/** Which customization switches appear, grouped as the user thinks of them. */
const TOGGLE_GROUPS: { title: string; items: [keyof PremiumCustomization, string][] }[] = [
  {
    title: 'Header',
    items: [
      ['showLogo', 'Logo'],
      ['showName', 'Restaurant name'],
      ['showAddress', 'Address'],
      ['showPhone', 'Phone'],
    ],
  },
  {
    title: 'Order details',
    items: [
      ['showOrderNumber', 'Order number'],
      ['showDateTime', 'Date & time'],
      ['showTable', 'Table'],
      ['showCashier', 'Cashier / waiter'],
      ['showCustomer', 'Customer'],
      ['showDelivery', 'Delivery address & rider'],
      ['showOrderType', 'Order type'],
    ],
  },
  {
    title: 'Items',
    items: [
      ['showSerial', 'Serial number column'],
      ['showVariants', 'Variant column'],
      ['showItemNotes', 'Item notes'],
    ],
  },
  {
    title: 'Totals',
    items: [
      ['showSubtotal', 'Subtotal'],
      ['showDiscount', 'Discount'],
      ['showTax', 'Tax'],
      ['showServiceCharge', 'Service charge'],
      ['showPaymentMethod', 'Payment method'],
      ['showChange', 'Paid & change'],
    ],
  },
  {
    title: 'Footer',
    items: [
      ['showQr', 'QR code'],
      ['showPoweredBy', 'Powered-by line'],
    ],
  },
];

const SLIDERS: [keyof PremiumCustomization, string, number, number, number, string][] = [
  ['fontSize', 'Font size', 9, 20, 1, 'px'],
  ['logoWidthPx', 'Logo size', 24, 260, 4, 'px'],
  ['itemSpacing', 'Item spacing', 0, 12, 1, 'px'],
  ['sectionSpacing', 'Section spacing', 0, 24, 1, 'px'],
  ['topSpacing', 'Top spacing', 0, 40, 1, 'px'],
  ['bottomSpacing', 'Bottom spacing', 0, 40, 1, 'px'],
];

export default function PremiumTemplateGallery() {
  const [openId, setOpenId] = useState<PremiumTemplateId | null>(null);
  const [draft, setDraft] = useState<PremiumCustomization | null>(null);
  const [activeDesign, setActiveDesign] = useState<string>('');
  const [saved, setSaved] = useState<PremiumTemplateId[]>([]);

  useEffect(() => {
    try { setActiveDesign(String(getSettings().receiptDesign || '')); } catch { /* not ready */ }
    setSaved(customizedTemplateIds());
  }, []);

  // The preview uses the shop's most recent real bill so the layout is
  // judged against its own item names and totals, not invented ones.
  const previewOrder = useMemo(() => {
    try { return pickPreviewOrder(getOrders()); } catch { return pickPreviewOrder(null); }
  }, [openId]);
  const settings = useMemo(() => {
    try { return getSettings(); } catch { return {} as any; }
  }, [openId]);

  const open = (id: PremiumTemplateId) => {
    setOpenId(id);
    setDraft(loadCustomization(id));
    setSelectedPremiumTemplate(id);
  };

  const patch = (key: keyof PremiumCustomization, value: unknown) =>
    setDraft(d => (d ? { ...d, [key]: value } as PremiumCustomization : d));

  /** Save the layout adjustments AND make this the template that prints. */
  const handleSave = () => {
    if (!openId || !draft) return;
    saveCustomization(openId, draft);
    try {
      saveSettings({ ...getSettings(), receiptDesign: openId } as any);
      setActiveDesign(openId);
    } catch {
      toast.error('Template saved, but it could not be set as the active design');
      setSaved(customizedTemplateIds());
      return;
    }
    setSaved(customizedTemplateIds());
    toast.success('Template saved — new bills will print in this design');
  };

  const handleReset = () => {
    if (!openId) return;
    resetCustomization(openId);
    setDraft(loadCustomization(openId));
    setSaved(customizedTemplateIds());
    toast.success('Reset to the template defaults');
  };

  const renderCard = (t: PremiumTemplate) => {
    const isActive = activeDesign === t.id;
    const isSaved = saved.includes(t.id);
    return (
      <button
        key={t.id}
        onClick={() => open(t.id)}
        className={`rounded-lg border p-3 text-left transition ${
          isActive ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'hover:bg-muted/50'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{templateDisplayName(t.id)}</span>
          {isActive
            ? <Check className="h-4 w-4 shrink-0 text-primary" />
            : isSaved ? <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">SAVED</span> : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t.hint}</p>
      </button>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LayoutTemplate className="h-5 w-5" /> Premium Receipt Templates
        </CardTitle>
        <CardDescription>
          {DTR_TEMPLATES.length} DT Retail designs and {PREMIUM_TEMPLATES.length} more professional layouts (80mm; 58mm is the same design narrower).
          Tap one to preview it with your own order data, adjust what it shows, and save —
          your prices, items and totals fill in automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">DT Retail designs</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{DTR_TEMPLATES.map(renderCard)}</div>
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">More premium layouts</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{PREMIUM_TEMPLATES.map(renderCard)}</div>
        </div>

        {openId && draft && (
          <div className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
              <div>
                <p className="text-sm font-semibold">
                  {templateDisplayName(openId)} — preview &amp; customize
                </p>
                <p className="text-xs text-muted-foreground">
                  Showing your latest order. Saving also makes this the design used for printing.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleReset}>
                  <RotateCcw className="mr-1 h-3 w-3" /> Reset
                </Button>
                <Button size="sm" onClick={handleSave}>
                  <Save className="mr-1 h-3 w-3" /> Save &amp; use
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>Close</Button>
              </div>
            </div>

            <div className="grid gap-4 p-3 lg:grid-cols-2">
              {/* ---- Live preview ---- */}
              <div className="rounded-md bg-muted/30 p-3">
                <div className="mx-auto w-fit max-w-full overflow-auto bg-white p-2 shadow-sm">
                  {/* 72mm is the printable width of an 80mm roll — the same
                      width the print pipeline lays the slip out at, so what
                      is on screen matches what comes out of the printer. */}
                  <div style={{ width: '72mm', background: '#fff', color: '#000' }}>
                    <PremiumReceipt
                      order={previewOrder}
                      settings={settings}
                      templateId={openId}
                      customization={draft}
                    />
                  </div>
                </div>
              </div>

              {/* ---- Customization ---- */}
              <div className="space-y-4">
                <div className="space-y-3">
                  {SLIDERS.map(([key, label, min, max, step, unit]) => (
                    <div key={String(key)}>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">{label}</Label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {String(draft[key])}{unit}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={Number(draft[key])}
                        onChange={e => patch(key, Number(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>
                  ))}
                  <div>
                    <Label className="text-xs font-medium">Font</Label>
                    <div className="mt-1 flex gap-1.5">
                      {(['sans', 'grotesk', 'serif', 'slab', 'mono'] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => patch('fontFamily', f)}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-bold capitalize ${
                            draft.fontFamily === f ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted/50'
                          }`}
                        >{f}</button>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      All five ship with Windows, so the printed slip uses the same face you see
                      here. Grotesk is condensed — it fits more per line; mono lines the columns up.
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-2">
                    <Label className="text-xs font-medium">Bold body text</Label>
                    <Switch checked={draft.boldBody} onCheckedChange={v => patch('boldBody', v)} />
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Template name</Label>
                    <input
                      value={draft.displayName}
                      onChange={e => patch('displayName', e.target.value)}
                      placeholder={ALL_PREMIUM_TEMPLATES.find(t => t.id === openId)?.name}
                      className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      What this design is called in the picker. Leave blank for the built-in name.
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Extra header line</Label>
                    <input
                      value={draft.headerNote}
                      onChange={e => patch('headerNote', e.target.value)}
                      placeholder="e.g. tax registration number"
                      className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Thank-you message</Label>
                    <input
                      value={draft.thankYouText}
                      onChange={e => patch('thankYouText', e.target.value)}
                      placeholder="Thank You!"
                      className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Footer text</Label>
                    <input
                      value={draft.footerText}
                      onChange={e => patch('footerText', e.target.value)}
                      placeholder="Leave blank to use the shop's receipt footer"
                      className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                    />
                  </div>
                </div>

                {TOGGLE_GROUPS.map(group => (
                  <div key={group.title}>
                    <p className="mb-1 text-xs font-semibold">{group.title}</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {group.items.map(([key, label]) => (
                        <label key={String(key)} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1">
                          <span className="text-[11px]">{label}</span>
                          <Switch
                            checked={!!draft[key]}
                            onCheckedChange={v => patch(key, v)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!openId && (
          <p className="text-xs text-muted-foreground">
            {isPremiumTemplateId(activeDesign)
              ? `Currently printing: ${templateDisplayName(activeDesign)}.`
              : 'Your current receipt design is unchanged. Picking a premium template here will switch to it when you save.'}
            {getSelectedPremiumTemplate() ? '' : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
