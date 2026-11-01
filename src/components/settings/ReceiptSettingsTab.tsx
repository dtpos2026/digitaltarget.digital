// ============================================================
// The receipt tab of Settings.
//
// Lifted out of SettingsPage.tsx, which had grown to nearly four thousand lines
// — a file where the risk of breaking something while changing something else
// is high enough that people stop changing it.
//
// Nothing about the tab changed. It takes the same four things it used to read
// from the surrounding closure and does exactly what it did before. The small
// prop list is the point: it is what made this safe to move at all, and what
// keeps the settings screen from quietly growing another tangle.
// ============================================================
import { uploadTenantImage } from '@/lib/storage';
import React from 'react';
import { toast } from 'sonner';
import { RestaurantSettings, DiningTable, Floor, Kitchen, Waiter, Rider, ReceiptTextStyle } from '@/lib/types';
import ReceiptPreview from '@/components/ReceiptPreview';
import TextSpacingCard from '@/components/TextSpacingCard';
import ReceiptCodesCard from '@/components/settings/ReceiptCodesCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, AlertTriangle, Download, Printer, Palette, MapPin, Navigation, ShoppingBag, Globe2, Settings as SettingsIcon, MessageCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface Props {
  settings: RestaurantSettings;
  setSettings: React.Dispatch<React.SetStateAction<RestaurantSettings>>;
  onSave: () => void;
  sampleOrder: any;
}

export default function ReceiptSettingsTab({ settings, setSettings, onSave, sampleOrder }: Props) {
  return (
    <div className="space-y-4">
            {/* Receipt Design Selector */}
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-bold">🎨 Receipt Design Template</h3>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'standard', name: '⭐ Standard (Recommended)', desc: '80mm compact, clean. Logo→Name→Address→Phone, table never wraps, toggles for all sections' },
                  { id: 'compact-thermal', name: '🧾 Compact Thermal (Paper Saver)', desc: 'FoodFight/Zesto style — smallest fonts, tightest spacing, ~30-40% less paper. Auto-applies compact mode to print.' },
                  { id: 'classic', name: '📋 Classic', desc: 'Bordered table, traditional look' },
                  { id: 'modern', name: '🖤 Modern Branded', desc: 'Clean lines, inverted header' },
                  { id: 'compact', name: '📏 Compact Mini', desc: 'Minimal size, paper saver' },
                  { id: 'luxury', name: '✨ Luxury VIP', desc: 'Double borders, serif fonts' },
                  { id: 'executive', name: '🏢 Executive', desc: 'Premium corporate, monogram + striped rows' },
                  { id: 'royal', name: '👑 Royal Dining', desc: 'Fine-dining ornaments, serif elegance' },
                  { id: 'bistro', name: '☕ Bistro Café', desc: 'Friendly café vibe, rounded badges' },
                  { id: 'heritage', name: '🏛 Heritage', desc: 'Vintage stamp header, classic ledger feel' },
                  { id: 'metro', name: '🚇 Metro', desc: 'Bold uppercase, ticket-style bands' },
                  { id: 'shahenshah', name: '👑 Shahenshah Style', desc: 'Boxed header sections, classic dhaba look' },
                  { id: 'taste-bistro', name: '🍴 Taste Bistro', desc: 'Chef hat header, bordered items table' },
                  { id: 'food-palace', name: '🍽 Food Palace', desc: 'Circle cloche logo, clean minimal lines' },
                  { id: 'spice-house', name: '🌶 Spice House', desc: 'Crossed cutlery emblem, dotted item rows' },
                  { id: 'taimoor', name: '📋 Taimoor', desc: 'Clean customer receipt — chef logo header, # / Item / Qty / Rate / Amount table' },
                  { id: 'design1-table', name: '📊 Design 1 — Table Style', desc: 'Classic bordered table, dashed separators, full info grid' },
                  { id: 'design2-box', name: '📦 Design 2 — Box Style', desc: 'Boxed info layout, bordered items, dark change bar' },
                  { id: 'design3-modern', name: '🎨 Design 3 — Modern Style', desc: 'Black banner header, icon info rows, 3-col totals' },
                  { id: 'design4-compact', name: '📏 Design 4 — Compact Style', desc: 'Ultra compact, short labels, minimal spacing' },
                  { id: 'design5-delivery', name: '🚚 Design 5 — Delivery Style', desc: 'Delivery receipt with driver info, delivery charge' },
                  { id: 'sero', name: '✨ Sero — Sleek Minimal', desc: 'Customer receipt: clean lines, dotted rows, bold total band' },
                  { id: 'bero', name: '⚡ Bero — Bold Contrast', desc: 'Customer receipt: inverted header, boxed details, dark grand total' },
                  { id: 'kot-style', name: '👨‍🍳 KOT Style', desc: 'Customer receipt: chef hat logo header, info grid, bordered Qty/Note table, Special Notes box' },
                  { id: 'kot-classic', name: '🍽 KOT Classic', desc: 'Clean dashed lines, chef-hat & cloche logo, dotted item rows, fully editable text & fonts' },
                  { id: 'premium-paid-banner', name: '🧾 Premium — Paid Banner', desc: 'Centred header, bold PAID/UNPAID banner, full meta block, bordered item grid' },
                  { id: 'premium-tax-invoice', name: '🧮 Premium — Tax Invoice', desc: 'Large name, tax-number row, boxed date bar, full grid and a QR block' },
                  { id: 'premium-panel', name: '🗂 Premium — Panelled Bill', desc: 'Framed address panel, bold title bar, big boxed order number, panelled totals' },
                  { id: 'premium-fine-dining', name: '🍷 Premium — Fine Dining', desc: 'Serif type, generous spacing, rules instead of boxes, large table number' },
                  { id: 'premium-grid-invoice', name: '📐 Premium — Grid Invoice', desc: 'Two-column meta grid and a fully ruled table with a variant column' },
                  { id: 'premium-hall-detail', name: '🏨 Premium — Hall Detail', desc: 'Every charge itemised, plus the grand total spelled out in words' },
                  { id: 'premium-quick-bill', name: '⚡ Premium — Quick Bill', desc: 'Dashed rules, big bill number, oversized grand total, QR to pay' },
                  { id: 'premium-two-column', name: '🪧 Premium — Two Column', desc: 'Logo left with shop details right, paired meta columns, heavy net line' },
                  { id: 'premium-retail', name: '🛍 Premium — Retail Counter', desc: 'Shop-counter layout with policy footer and contact block' },
                  { id: 'premium-grouped', name: '🍱 Premium — Grouped Menu', desc: 'Items gathered under their menu category, boxed payable block and QR' },
                  { id: 'premium-token-hero', name: '🎫 Premium — Token Hero', desc: 'Very large token number under a decorated header, compact item list' },
                  { id: 'premium-boxed-ledger', name: '📒 Premium — Boxed Ledger', desc: 'Stacked framed meta panels, totals inside the item frame, amount in words' },
                  { id: 'premium-rounded-panel', name: '🫧 Premium — Rounded Panel', desc: 'Logo beside the shop block, soft-cornered item table and totals panel' },
                  { id: 'premium-cafe-classic', name: '☕ Café — Classic', desc: 'Rounded pickup number with the customer name, "2 × Item" lines, light regular type' },
                  { id: 'premium-coffee-house', name: '🫖 Café — Coffee House', desc: 'Warm serif guest check, framed header, soft totals panel and a QR for menu or feedback' },
                  { id: 'premium-cafe-counter', name: '🥤 Café — Counter', desc: 'Very large pickup number to call out, paired details, "2 × Item" lines, large total' },
                ] as const).map(d => (
                  <button
                    key={d.id}
                    onClick={() => setSettings({ ...settings, receiptDesign: d.id })}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      (settings.receiptDesign || 'classic') === d.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card hover:bg-accent'
                    }`}
                  >
                    <div className="text-sm font-bold">{d.name}</div>
                    <div className="text-xs opacity-80">{d.desc}</div>
                  </button>
                ))}
              </div>

              {/* Line / word / letter spacing — shown in the preview below */}
              <div className="mt-4">
                <TextSpacingCard settings={settings} setSettings={setSettings} kind="bill" />
              </div>

              {/* Live Receipt Preview — shows currently selected design with sample data */}
              <div className="mt-4 border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold">👁 Live Preview — <span className="text-primary">{settings.receiptDesign || 'classic'}</span></h4>
                  <span className="text-[10px] text-muted-foreground">Sample order — the actual print looks the same</span>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 overflow-auto max-h-[520px] flex justify-center">
                  <div className="bg-white shadow-md">
                    <ReceiptPreview order={sampleOrder as any} settings={settings} showPrintButton={false} />
                  </div>
                </div>
              </div>
            </div>

            {/* ===== Standard Receipt — Section Toggles ===== */}
            <div className="border-t pt-3 mt-2">
              <h4 className="text-xs font-bold mb-2">⭐ Standard Receipt — Show/Hide Sections</h4>
              <div className="grid sm:grid-cols-2 gap-2">
                {[
                  { key: 'receiptShowLogo',      label: 'Show Logo',          def: true },
                  { key: 'receiptShowAddress',   label: 'Show Address',       def: true },
                  { key: 'receiptShowPhone',     label: 'Show Phone',         def: true },
                  { key: 'receiptShowDiscount',  label: 'Show Discount',      def: true },
                  { key: 'receiptShowTax',       label: 'Show Tax / Service Charge', def: true },
                  { key: 'receiptShowFooter',    label: 'Show Footer (Thank You)', def: true },
                  { key: 'receiptShowPoweredBy', label: 'Show "Powered by Digital Target"', def: true },
                  { key: 'receiptCompactMode',   label: '🧾 Compact Print Mode (GLOBAL — applies to ALL receipts + KOT, saves 30-40% paper)', def: false },
                ].map(t => {
                  const val = (settings as any)[t.key];
                  const on = val === undefined ? t.def : !!val;
                  return (
                    <label key={t.key} className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
                      <span className="text-xs font-semibold">{t.label}</span>
                      <button type="button" onClick={() => setSettings({ ...settings, [t.key]: !on } as any)}
                        className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                        <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </label>
                  );
                })}
              </div>
              <div className="mt-2">
                <label className="text-xs font-medium text-muted-foreground">Support Phone (shown in "Powered by" line)</label>
                <Input value={(settings as any).supportPhone ?? ''} placeholder="0345-1873354"
                  onChange={e => setSettings({ ...settings, supportPhone: e.target.value } as any)} />
              </div>

              {/* Compact Mode tuning — only meaningful when Compact Print Mode is ON */}
              <div className="mt-3 p-3 rounded-lg border bg-muted/30">
                <div className="text-xs font-bold mb-2">🧾 Compact Print — Fine Tuning</div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Compact Font Size (px)</label>
                    <Input type="number" min={8} max={16} step={1}
                      value={(settings as any).receiptCompactFontSize ?? 11}
                      onChange={e => setSettings({ ...settings, receiptCompactFontSize: Math.max(8, Math.min(16, Number(e.target.value) || 11)) } as any)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Compact Line Spacing (1.0 – 2.0)</label>
                    <Input type="number" min={1} max={2} step={0.05}
                      value={(settings as any).receiptCompactLineHeight ?? 1.15}
                      onChange={e => setSettings({ ...settings, receiptCompactLineHeight: Math.max(1, Math.min(2, Number(e.target.value) || 1.15)) } as any)} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Logo in Compact Mode</label>
                    {(() => {
                      const preserve = (settings as any).receiptCompactPreserveLogo !== false; // default true
                      return (
                        <label className="flex items-center justify-between gap-2 bg-background px-3 py-2 rounded-lg cursor-pointer border mt-1">
                          <span className="text-xs font-semibold">{preserve ? 'Keep original size' : 'Shrink (40×40)'}</span>
                          <button type="button" onClick={() => setSettings({ ...settings, receiptCompactPreserveLogo: !preserve } as any)}
                            className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${preserve ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                            <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${preserve ? 'translate-x-6' : 'translate-x-0.5'}`} />
                          </button>
                        </label>
                      );
                    })()}
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground mt-2">
                  These values apply only when Compact Mode is ON. The logo prints at its set size by default — compact mode does not shrink it.
                </div>
              </div>
            </div>




            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">"Thank You" Text (Receipt)</label>
                <Input value={settings.thankYouText ?? ''} placeholder="Thank You!" onChange={e => setSettings({ ...settings, thankYouText: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">"Visit Again" Text (Receipt)</label>
                <Input value={settings.visitAgainText ?? ''} placeholder="Please Visit Again" onChange={e => setSettings({ ...settings, visitAgainText: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">KOT "Thank You" Text</label>
                <Input value={settings.kotThankYouText ?? ''} placeholder="Thank You" onChange={e => setSettings({ ...settings, kotThankYouText: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">KOT Footer Note</label>
                <Input value={settings.kotFooterNote ?? ''} placeholder="Please check the order before preparing" onChange={e => setSettings({ ...settings, kotFooterNote: e.target.value })} />
              </div>
            </div>

            {/* ===== WHOSE TICKET IT IS =====
                The restaurant's name belongs at the top of its own kitchen
                ticket. The rendered KOT always printed it and the raw one did
                not, so switching a kitchen printer to raw quietly stripped it
                off. Both do now, and both carry the same one-line developer
                credit underneath, which a shop can switch off. */}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-md border p-3 gap-3">
                <span className="min-w-0">
                  <span className="text-sm block">Restaurant name on the KOT</span>
                  <span className="text-xs text-muted-foreground">
                    Printed above &ldquo;Kitchen Order&rdquo; on every ticket, rendered or raw.
                  </span>
                </span>
                <Switch
                  checked={settings.kotShowShopName !== false}
                  onCheckedChange={v => setSettings({ ...settings, kotShowShopName: v })}
                />
              </label>
              <label className="flex items-center justify-between rounded-md border p-3 gap-3">
                <span className="min-w-0">
                  <span className="text-sm block">&ldquo;Powered by Digital Target&rdquo; on the KOT</span>
                  <span className="text-xs text-muted-foreground">
                    One small line under your own footer.
                  </span>
                </span>
                <Switch
                  checked={settings.kotShowDeveloperCredit !== false}
                  onCheckedChange={v => setSettings({ ...settings, kotShowDeveloperCredit: v })}
                />
              </label>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Receipt Footer Text</label>
              <Textarea value={settings.receiptFooter} onChange={e => setSettings({ ...settings, receiptFooter: e.target.value })} rows={3} />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Marketing Footer (printed at bottom of every receipt)</label>
              <Textarea
                value={settings.marketingFooter || ''}
                onChange={e => setSettings({ ...settings, marketingFooter: e.target.value })}
                rows={4}
                placeholder={'DIGITAL TARGET SOFTWARE SOLUTIONS\nDeveloped By: Taimoor Younas\n📞 0345-1873354'}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Editable — appears on POS receipt, kitchen ticket and reports.</p>
            </div>


            {/* Receipt QR & Barcode — automatic, multi-link or single-link QR and a receipt barcode */}
            <ReceiptCodesCard settings={settings} setSettings={setSettings} onSave={onSave} sampleOrder={sampleOrder} />

            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-bold">Payment QR &amp; older automatic QR</h3>
              <p className="text-[11px] text-muted-foreground">
                An uploaded payment QR (JazzCash, Easypaisa, bank) keeps printing as before. The older automatic QR is
                replaced by the Receipt QR above whenever that is switched on.
              </p>
            
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">QR Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSettings({ ...settings, qrMode: 'auto' })}
                    className={`flex-1 p-3 rounded-lg border text-xs font-semibold text-center transition-colors ${
                      settings.qrMode === 'auto'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card hover:bg-accent'
                    }`}
                  >
                    🔄 Auto QR
                    <p className="text-[10px] font-normal mt-0.5 opacity-80">Auto-generate QR per bill with order data</p>
                  </button>
                  <button
                    onClick={() => setSettings({ ...settings, qrMode: 'custom' })}
                    className={`flex-1 p-3 rounded-lg border text-xs font-semibold text-center transition-colors ${
                      settings.qrMode === 'custom'
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card hover:bg-accent'
                    }`}
                  >
                    📱 Custom QR
                    <p className="text-[10px] font-normal mt-0.5 opacity-80">Upload your own QR (JazzCash, Reviews, etc.)</p>
                  </button>
                </div>
              </div>

              {settings.qrMode === 'custom' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Upload Custom QR Image</label>
                  <div className="flex items-center gap-3 mt-1">
                    {settings.customQrImage && (
                      <img src={settings.customQrImage} alt="Custom QR" className="h-20 w-20 object-contain rounded border bg-background" />
                    )}
                    <div className="flex flex-col gap-1">
                      <Button variant="outline" size="sm" asChild>
                        <label className="cursor-pointer">
                          Upload QR Image
                          <input type="file" accept="image/*" className="hidden" onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (file.size > 2 * 1024 * 1024) { toast.error('Image must be under 2MB'); return; }
                            try {
                              // Cloud storage, not base64: the picture survives a refresh and does not bloat the
                              // settings record (which every device downloads).
                              const url = await uploadTenantImage(file, 'payment-qr');
                              setSettings({ ...settings, customQrImage: url });
                            } catch (err: any) { toast.error(err?.message || 'Upload failed'); }
                          }} />
                        </label>
                      </Button>
                      {settings.customQrImage && (
                        <Button variant="ghost" size="sm" onClick={() => setSettings({ ...settings, customQrImage: '' })}>Remove</Button>
                      )}
                      <p className="text-[10px] text-muted-foreground">e.g. Google Review QR, JazzCash/Easypaisa, Bank Payment QR</p>
                    </div>
                  </div>
                </div>
              )}

              {settings.qrMode === 'custom' && settings.customQrImage && (
                <div className="space-y-3 border rounded-lg p-3 bg-muted/30">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">QR Width (px)</label>
                      <Input
                        type="number"
                        min={40}
                        max={400}
                        value={settings.customQrWidth ?? 80}
                        onChange={e => {
                          const v = Math.max(40, Math.min(400, Number(e.target.value) || 80));
                          setSettings({ ...settings, customQrWidth: v });
                        }}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">QR Height (px)</label>
                      <Input
                        type="number"
                        min={40}
                        max={400}
                        value={settings.customQrHeight ?? 80}
                        onChange={e => {
                          const v = Math.max(40, Math.min(400, Number(e.target.value) || 80));
                          setSettings({ ...settings, customQrHeight: v });
                        }}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <input
                    type="range"
                    min={40}
                    max={400}
                    value={settings.customQrWidth ?? 80}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setSettings({ ...settings, customQrWidth: v, customQrHeight: v });
                    }}
                    className="w-full"
                  />
                  <div className="flex items-center gap-3 bg-background rounded border p-2">
                    <span className="text-[10px] text-muted-foreground">Live preview:</span>
                    <img
                      src={settings.customQrImage}
                      alt="QR preview"
                      style={{
                        width: `${settings.customQrWidth ?? 80}px`,
                        height: `${settings.customQrHeight ?? 80}px`,
                        objectFit: 'contain',
                        background: '#fff',
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground">{settings.customQrWidth ?? 80} × {settings.customQrHeight ?? 80} px</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">⚠ Pressing Save Receipt Settings is required, otherwise printing will use the old size.</p>
                </div>
              )}

              {/* Bank Name for QR */}
              {settings.qrMode === 'custom' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Bank Name (printed with QR)</label>
                  <Input
                    value={settings.bankName || ''}
                    onChange={e => setSettings({ ...settings, bankName: e.target.value })}
                    placeholder="e.g. Meezan Bank, JazzCash, Easypaisa"
                    className="mt-1"
                  />
                </div>
              )}

              {settings.qrMode === 'auto' && (
                <div className="bg-accent rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">
                    ✅ Each receipt prints a QR with the order ID, date, type and total (no customer details). Works fully offline.
                    For a QR that opens a proper receipt page on the phone, use Receipt QR &amp; Barcode above.
                  </p>
                </div>
              )}
            </div>

            <Button onClick={onSave}>Save Receipt Settings</Button>
    </div>
  );
}
