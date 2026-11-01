// ============================================================
// The kitchen-ticket tab of Settings.
//
// Lifted out of SettingsPage.tsx unchanged — the largest of the three sections
// that could be moved with a small, checkable prop list.
// ============================================================
import React from 'react';
import { toast } from 'sonner';
import NotePresetsEditor from '@/components/settings/NotePresetsEditor';
import { RestaurantSettings, DiningTable, Floor, Kitchen, Waiter, Rider, ReceiptTextStyle } from '@/lib/types';
import ReceiptStyleEditor from '@/components/ReceiptStyleEditor';
import KitchenReceipt from '@/components/KitchenReceipt';
import TextSpacingCard from '@/components/TextSpacingCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, AlertTriangle, Download, Printer, Palette, MapPin, Navigation, ShoppingBag, Globe2, Settings as SettingsIcon, MessageCircle } from 'lucide-react';
import { isElectron, getPrinters, getAutoStart, setAutoStart } from '@/lib/electron';
import { getTenantId, getTenantName } from '@/lib/tenant';

interface Props {
  settings: RestaurantSettings;
  setSettings: React.Dispatch<React.SetStateAction<RestaurantSettings>>;
  onSave: () => void;
  printers: { name: string; isDefault?: boolean }[];
  kitchens: any[];
  sampleOrder: any;
  onTestPrint: (kind: null | 'kot' | 'receipt') => void;
}

export default function KotSettingsTab({ settings, setSettings, onSave, printers, kitchens, sampleOrder, onTestPrint }: Props) {
  return (
    <div className="space-y-4">
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🍳</span>
                <h3 className="text-sm font-bold">Kitchen Order Ticket (KOT) Settings</h3>
              </div>
              <p className="text-xs text-muted-foreground">Choose the kitchen slip design, what it shows and how it prints.</p>
            </div>

            {/* ===== Professional Printing Settings ===== */}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Printer className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold">Printing Settings (Print Service)</h3>
              </div>
              <p className="text-xs text-muted-foreground">One-phase printing — a KOT when the order is created, the receipt on payment. No duplicate prints.</p>

              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { key: 'kotEnabled', label: 'Enable KOT Printing', def: true },
                  { key: 'autoPrintKot', label: 'Auto Print KOT on New Order', def: true },
                  { key: 'noReceiptOnPay', label: 'No Receipt on Pay (no slip when a bill is paid)', def: false },
                  { key: 'paymentDialogEnabled', label: 'Payment screen on Pay (OFF = paid in cash and printed at once)', def: true },
                  { key: 'tokenPrintEnabled', label: 'Tandoor Token (a separate token slip for roti / naan)', def: false },
                  { key: 'tokenCountsInSales', label: 'Count token items in sales', def: true },
                  { key: 'manualSendToKitchen', label: 'Manual "Send to Kitchen" only', def: false },
                  { key: 'autoPrintCustomerReceipt', label: 'Auto Print Customer Receipt (on payment)', def: false },
                  { key: 'showBillOnScreen', label: 'Show bill on screen after payment (OFF = print only, nothing on screen)', def: false },
                ].map(t => {
                  const val = (settings as any)[t.key];
                  const on = val === undefined ? t.def : !!val;
                  return (
                    <label key={t.key} className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer">
                      <span className="text-xs font-semibold">{t.label}</span>
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, [t.key]: !on } as any)}
                        className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                      >
                        <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </label>
                  );
                })}
              </div>

              {/* ===== Per-Order-Type Auto KOT switches ===== */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🎛️</span>
                  <h4 className="text-xs font-bold">Order Type wise Auto-KOT</h4>
                </div>
                <p className="text-[11px] text-muted-foreground">Turn each order type's (Dining / Takeaway / Delivery) auto-KOT ON/OFF separately. If turned OFF, that type's KOT will not auto print — "Send to Kitchen" will need to be done manually.</p>
                <div className="grid sm:grid-cols-3 gap-2">
                  {[
                    { key: 'autoKotDining',   label: '🍽️ Dining (Dine-in)' },
                    { key: 'autoKotTakeaway', label: '🥡 Takeaway' },
                    { key: 'autoKotDelivery', label: '🛵 Delivery' },
                  ].map(t => {
                    const masterOn = (settings.autoPrintKot ?? (settings as any).autoKitchenPrint ?? false);
                    const raw = (settings as any)[t.key];
                    const on = raw === undefined ? !!masterOn : !!raw;
                    return (
                      <label key={t.key} className="flex items-center justify-between gap-2 bg-background px-3 py-2 rounded-md border cursor-pointer">
                        <span className="text-xs font-semibold">{t.label}</span>
                        <button
                          type="button"
                          onClick={() => setSettings({ ...settings, [t.key]: !on } as any)}
                          className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-status-success' : 'bg-muted-foreground/30'}`}
                        >
                          <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* ===== Cancel KOT switch ===== */}
              <label className="flex items-center justify-between gap-2 bg-rose-500/5 border border-rose-500/30 px-3 py-2 rounded-lg cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-rose-700">❌ Print CANCEL KOT to Kitchen</p>
                  <p className="text-[11px] text-muted-foreground">When an order is cancelled / voided, send a CANCELLED slip to the kitchen so cooking stops.</p>
                </div>
                {(() => {
                  const on = settings.printKotOnCancel !== false; // default ON
                  return (
                    <button
                      type="button"
                      onClick={() => setSettings({ ...settings, printKotOnCancel: !on })}
                      className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-rose-500' : 'bg-muted-foreground/30'}`}
                    >
                      <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                  );
                })()}
              </label>


              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Printer Type</label>
                  <select
                    value={settings.printerType || 'browser'}
                    onChange={e => setSettings({ ...settings, printerType: e.target.value as any })}
                    className="w-full h-9 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="browser">Browser Print</option>
                    <option value="network">Network Printer</option>
                    <option value="usb">USB Printer</option>
                    <option value="silent">Silent Print Agent</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">KOT Copies</label>
                  <select
                    value={settings.kotCopies || 1}
                    onChange={e => setSettings({ ...settings, kotCopies: Number(e.target.value) })}
                    className="w-full h-9 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value={1}>1 Copy</option>
                    <option value={2}>2 Copies</option>
                    <option value={3}>3 Copies</option>
                  </select>
                </div>
                <label className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2 rounded-lg cursor-pointer self-end">
                  <span className="text-xs font-semibold">Auto Cut Paper</span>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, autoCut: settings.autoCut === false })}
                    className={`w-12 h-6 rounded-full transition-colors relative shrink-0 ${settings.autoCut !== false ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.autoCut !== false ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </label>
              </div>

              {/* Per-station KOT printer assignment */}
              {kitchens.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground block">Assign KOT Printer by Station</label>
                  {kitchens.map(k => (
                    <div key={k.id} className="flex items-center gap-2">
                      <span className="text-xs font-semibold w-28 shrink-0 truncate">{k.name}</span>
                      <select
                        value={(settings.stationPrinters || {})[k.id] || ''}
                        onChange={e => setSettings({ ...settings, stationPrinters: { ...(settings.stationPrinters || {}), [k.id]: e.target.value } })}
                        className="flex-1 h-9 rounded-md border bg-background px-2 text-xs"
                      >
                        <option value="">Default KOT printer</option>
                        {printers.map(p => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
                      </select>
                    </div>
                  ))}
                  {!isElectron() && <p className="text-[10px] text-muted-foreground">Per-station physical routing works in desktop (Silent Agent) mode. Browser mode uses the default printer.</p>}
                </div>
              )}

              {settings.tokenPrintEnabled && (
                <div className="py-2 border-t">
                  <p className="text-sm font-medium">Token Categories &amp; Items</p>
                  <p className="text-xs text-muted-foreground">
                    Assign as many categories as you need, plus individual menu items, in
                    Printer Settings → <b>Token Printing — Rules &amp; Design</b>. An item gets a
                    token if either rule covers it.
                  </p>
                </div>
              )}


              {/* KOT Design Templates */}
            </div>

            <div className="border rounded-lg p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-2">KOT Template Design</label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'classic', label: '🍳 Classic', desc: 'Traditional design — icons and dashed borders' },
                    { value: 'bold', label: '★ Bold', desc: 'Heavy font — large QTY, black bar' },
                    { value: 'minimal', label: '◻ Minimal', desc: 'Simple and clean — the fewest elements' },
                    { value: 'elegant', label: '✦ Elegant', desc: 'Refined — letter spacing and a fine look' },
                    { value: 'vip-chef', label: '👨‍🍳 VIP Chef', desc: 'Large bold badges — easy for the chef to read' },
                    { value: 'station', label: '🏷 Station', desc: 'COLD / HOT / BEVG tags — station routing' },
                    { value: 'taimoor1', label: '📋 Taimoor 1', desc: 'Clean table design — Order / Token / Date / Time / Type / Table' },
                    { value: 'taimoor2', label: '📋 Taimoor 2', desc: 'Taimoor 1 + Waiter + Pax + Printed time' },
                    { value: 'dtr-kitchen', label: '🧾 DT Kitchen Order', desc: 'DT Retail — black title bar, DINE-IN / Table box, big quantities' },
                  ] as const).map(t => (
                    <button
                      key={t.value}
                      onClick={() => setSettings({ ...settings, kotDesign: t.value })}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        (settings.kotDesign || 'classic') === t.value
                          ? 'bg-primary text-primary-foreground border-primary shadow-md'
                          : 'bg-card hover:bg-accent hover:shadow-sm'
                      }`}
                    >
                      <span className="text-sm font-bold block">{t.label}</span>
                      <span className="text-[10px] block mt-0.5 opacity-80">{t.desc}</span>
                    </button>
                  ))}
                </div>

                {/* Line / word / letter spacing — shown in the preview below */}
                <div className="mt-4">
                  <TextSpacingCard settings={settings} setSettings={setSettings} kind="kot" />
                </div>

                {/* Live KOT Preview — shows currently selected KOT design with sample data */}
                <div className="mt-4 border-t pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold">👁 Live KOT Preview — <span className="text-primary">{settings.kotDesign || 'classic'}</span></h4>
                    <span className="text-[10px] text-muted-foreground">Sample KOT — the actual print looks the same</span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 overflow-auto max-h-[520px] flex justify-center">
                    <div className="bg-white shadow-md">
                      <KitchenReceipt order={sampleOrder as any} settings={settings} showPrintButton={false} noPrintPortal />
                    </div>
                  </div>
                </div>
              </div>


              {/* KOT Elements Toggle */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground block">What the KOT shows</label>
                {([
                  { key: 'kotShowLogo', label: 'Logo', desc: 'Show the restaurant logo' },
                  { key: 'kotShowAddress', label: 'Address', desc: 'Show the address' },
                  { key: 'kotShowPhone', label: 'Phone', desc: 'Show the phone number' },
                  { key: 'kotShowDateTime', label: 'Date & Time', desc: 'Date and time' },
                  { key: 'kotShowWaiter', label: 'Waiter Name', desc: 'Waiter name' },
                  { key: 'kotShowCustomer', label: 'Customer Info', desc: 'Customer details' },
                  { key: 'kotShowCustomerAddress', label: 'Customer Address', desc: 'Show the delivery / customer address on the KOT' },
                  { key: 'kotShowRider', label: 'Rider Name', desc: 'Rider name' },
                  { key: 'kotShowNotes', label: 'Order Notes', desc: 'Order notes' },
                ] as const).map(item => (
                  <div key={item.key} className="flex items-center justify-between bg-card border rounded-lg p-2.5">
                    <div>
                      <p className="text-xs font-bold">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, [item.key]: !(settings[item.key as keyof RestaurantSettings] !== false) })}
                      className={`w-10 h-5 rounded-full transition-colors relative ${(settings[item.key as keyof RestaurantSettings] !== false) ? 'bg-primary' : 'bg-muted'}`}
                    >
                      <span className={`block w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${(settings[item.key as keyof RestaurantSettings] !== false) ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Special Note Presets — quick-pick chips on POS/Order Taker cart */}
              <div className="space-y-2 border-t pt-4">
                <label className="text-xs font-bold block">📝 Special Note Presets</label>
                <p className="text-[10px] text-muted-foreground">
                  Create quick-note buttons here (e.g. "No onion", "Extra spicy"). They will appear as chips on the POS and Order Taker cart — click to add to the order. Manual typing is still available.
                </p>
                <NotePresetsEditor
                  value={settings.kotNotePresets || []}
                  onChange={(list) => setSettings({ ...settings, kotNotePresets: list })}
                />
              </div>


              {/* KOT Text Font Settings */}
              <div className="border-t pt-4 space-y-3">
                <h4 className="text-xs font-bold">🔤 KOT Print Text Font</h4>
                <p className="text-[10px] text-muted-foreground">Control the kitchen print's font, size, bold and alignment from here. The item font applies to the whole KOT.</p>
                <ReceiptStyleEditor
                  label="Header (Restaurant Name / Title)"
                  style={settings.kotStyles?.header || { font: 'default', size: 14, align: 'center', bold: true }}
                  onChange={s => setSettings({ ...settings, kotStyles: { ...(settings.kotStyles || {}), header: s } })}
                  onReset={() => setSettings({ ...settings, kotStyles: { ...(settings.kotStyles || {}), header: undefined } })}
                  preview={settings.name || 'Restaurant'}
                />
                <ReceiptStyleEditor
                  label="Items (Main Body — applies to all KOT text)"
                  style={settings.kotStyles?.items || { font: 'default', size: 12, align: 'left', bold: true }}
                  onChange={s => setSettings({ ...settings, kotStyles: { ...(settings.kotStyles || {}), items: s } })}
                  onReset={() => setSettings({ ...settings, kotStyles: { ...(settings.kotStyles || {}), items: undefined } })}
                  preview="1. Chicken Karahi ×2"
                />
                <ReceiptStyleEditor
                  label="Footer / Notes"
                  style={settings.kotStyles?.footer || { font: 'default', size: 10, align: 'center', bold: false }}
                  onChange={s => setSettings({ ...settings, kotStyles: { ...(settings.kotStyles || {}), footer: s } })}
                  onReset={() => setSettings({ ...settings, kotStyles: { ...(settings.kotStyles || {}), footer: undefined } })}
                  preview="— Kitchen Copy —"
                />
              </div>

              {/* Auto Kitchen Print */}
              <div className="border-t pt-4 space-y-3">
                <h4 className="text-xs font-bold">🖨️ KOT Print Mode</h4>
                <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                  <div>
                    <p className="text-xs font-bold">Auto Kitchen Print</p>
                    <p className="text-[10px] text-muted-foreground">Print the kitchen slip as soon as an order is created</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, autoKitchenPrint: !settings.autoKitchenPrint })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.autoKitchenPrint ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.autoKitchenPrint ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {settings.autoKitchenPrint && (
                  <>
                    <div className="flex items-center justify-between bg-card border rounded-lg p-3 ml-3 border-l-2 border-l-primary">
                      <div>
                        <p className="text-xs font-bold">Combined Print (Receipt + KOT)</p>
                        <p className="text-[10px] text-muted-foreground">Print the KOT together with the receipt — each is cut separately</p>
                      </div>
                      <button
                        onClick={() => setSettings({ ...settings, kotCombinedPrint: !settings.kotCombinedPrint })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.kotCombinedPrint ? 'bg-primary' : 'bg-muted'}`}
                      >
                        <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.kotCombinedPrint ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between bg-card border rounded-lg p-3 ml-3 border-l-2 border-l-primary">
                      <div>
                        <p className="text-xs font-bold">Fallback to Receipt Printer</p>
                        <p className="text-[10px] text-muted-foreground">If no kitchen printer is set, print the KOT on the counter (receipt) printer</p>
                      </div>
                      <button
                        onClick={() => setSettings({ ...settings, kotFallbackToReceipt: settings.kotFallbackToReceipt === false ? true : false })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.kotFallbackToReceipt !== false ? 'bg-primary' : 'bg-muted'}`}
                      >
                        <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.kotFallbackToReceipt !== false ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between bg-card border rounded-lg p-3 ml-3 border-l-2 border-l-amber-500">
                      <div>
                        <p className="text-xs font-bold">🪞 KOT Mirror on Cash Printer (Verify)</p>
                        <p className="text-[10px] text-muted-foreground">Every KOT also prints one extra copy on the cash / receipt printer, so the counter can see it was sent</p>
                      </div>
                      <button
                        onClick={() => setSettings({ ...settings, kotMirrorToReceiptPrinter: !settings.kotMirrorToReceiptPrinter })}
                        className={`w-12 h-6 rounded-full transition-colors relative ${settings.kotMirrorToReceiptPrinter ? 'bg-amber-500' : 'bg-muted'}`}
                      >
                        <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.kotMirrorToReceiptPrinter ? 'translate-x-6' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                  </>
                )}

                {/* Auto-KOT trigger toggles (Phase 2) */}
                <div className="border-t pt-3 mt-2 space-y-2">
                  <h4 className="text-xs font-bold">🎯 Auto KOT Triggers</h4>
                  <p className="text-[10px] text-muted-foreground">When should automatic KOT printing happen — each one can be toggled on/off separately.</p>
                  {([
                    { key: 'autoKotOnOrderTakerSave', label: 'Order Taker saves', desc: 'Print the KOT as soon as an order is saved from the Order Taker portal' },
                    { key: 'autoKotOnOnlineOrder', label: 'Online order receive ho', desc: 'Website se naya order aate hi KOT print' },
                    { key: 'autoKotOnDeliveryRunning', label: 'Delivery → Preparing', desc: 'Print the KOT when a delivery order moves to Preparing' },
                  ] as const).map(item => {
                    const on = settings[item.key as keyof RestaurantSettings] !== false;
                    return (
                      <div key={item.key} className="flex items-center justify-between bg-card border rounded-lg p-3 ml-3 border-l-2 border-l-orange-500">
                        <div>
                          <p className="text-xs font-bold">{item.label}</p>
                          <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                        </div>
                        <button
                          onClick={() => setSettings({ ...settings, [item.key]: !on })}
                          className={`w-12 h-6 rounded-full transition-colors relative ${on ? 'bg-orange-500' : 'bg-muted'}`}
                        >
                          <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Silent / Hold KOT Mode — master kill switch */}
                <div className="border-t pt-3 mt-2 space-y-2">
                  <h4 className="text-xs font-bold">🤫 Silent KOT Mode (Hold All Tokens)</h4>
                  <p className="text-[10px] text-muted-foreground">
                    When ON, no automatic KOT/Token print will come out until you manually approve / print. Receipts are unaffected.
                  </p>
                  <div className="flex items-center justify-between bg-card border-2 rounded-lg p-3 border-l-4 border-l-rose-500">
                    <div>
                      <p className="text-xs font-bold">{settings.kotSilentMode ? '🔴 Silent Mode ON — KOT printing PAUSED' : '🟢 Silent Mode OFF — KOT auto-printing'}</p>
                      <p className="text-[10px] text-muted-foreground">Master switch — overrides all the auto-KOT triggers above.</p>
                    </div>
                    <button
                      onClick={() => setSettings({ ...settings, kotSilentMode: !settings.kotSilentMode })}
                      className={`w-12 h-6 rounded-full transition-colors relative ${settings.kotSilentMode ? 'bg-rose-500' : 'bg-muted'}`}
                    >
                      <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.kotSilentMode ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </button>
                  </div>

                  {/* Test Print buttons */}
                  <div className="bg-card border rounded-lg p-3 ml-3 border-l-2 border-l-blue-500 space-y-2">
                    <p className="text-xs font-bold">🧪 Test Print</p>
                    <p className="text-[10px] text-muted-foreground">Print with a test order — check whether the printer is working correctly. (KOT from the Kitchen printer, Receipt from the Cash printer.)</p>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onTestPrint('kot')}>
                        🍳 Test KOT Print
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onTestPrint('receipt')}>
                        🧾 Test Receipt Print
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Order Taker portal share link */}
                {(() => {
                  const tid = getTenantId() || '';
                  const origin = typeof window !== 'undefined' ? window.location.origin : '';
                  const url = tid ? `${origin}/#/order-taker/${tid}` : `${origin}/#/order-taker`;
                  return (
                    <div className="border-t pt-3 mt-2 space-y-2">
                      <h4 className="text-xs font-bold">📋 Order Taker Portal Link</h4>
                      <p className="text-[10px] text-muted-foreground">Order taker staff will log in via this link by entering a PIN — they will only have access to POS, Tables and Running Bills.</p>
                      <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                        <code className="text-[11px] flex-1 truncate font-mono">{url}</code>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]"
                          onClick={() => { navigator.clipboard.writeText(url); toast.success('Order Taker link copied!'); }}>
                          📋 Copy
                        </Button>
                        <a href={url.replace(origin, '')} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline" className="h-7 text-[11px]">↗ Open</Button>
                        </a>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Create a new user from the Users page → role: <b>Order Taker</b> → set username + PIN.</p>
                    </div>
                  );
                })()}
              </div>

              <div className="border-t pt-4 space-y-3">
                <h4 className="text-xs font-bold">⏱ Kitchen Delay Timer</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Preparing Minutes</label>
                    <Input
                      type="number"
                      value={settings.kitchenPreparingMinutes ?? 5}
                      onChange={e => {
                        const preparing = Math.max(1, Math.min(120, Number(e.target.value) || 1));
                        setSettings({
                          ...settings,
                          kitchenPreparingMinutes: preparing,
                          kitchenWarningMinutes: Math.max(settings.kitchenWarningMinutes ?? 10, preparing + 1),
                        });
                      }}
                      min={1}
                      max={120}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Delayed Minutes</label>
                    <Input
                      type="number"
                      value={settings.kitchenWarningMinutes ?? 10}
                      onChange={e => {
                        const delayed = Math.max((settings.kitchenPreparingMinutes ?? 5) + 1, Math.min(180, Number(e.target.value) || 1));
                        setSettings({ ...settings, kitchenWarningMinutes: delayed });
                      }}
                      min={(settings.kitchenPreparingMinutes ?? 5) + 1}
                      max={180}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">The kitchen display shows Preparing, In Progress and Delayed using these times.</p>
              </div>
            </div>

            <Button onClick={onSave} className="w-full">Save KOT Settings</Button>

            {/* ===== v1.0.4 — Business Day Timing (Shift) ===== */}
            <div className="border rounded-lg p-4 space-y-3 bg-card mt-6">
              <div className="flex items-center gap-2">
                <span className="text-lg">🕒</span>
                <h3 className="text-sm font-bold">Business Day Timing (Shift)</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Set the restaurant's business day Start and Close time. For example, if Start is <b>08:00 AM</b> and Close is <b>03:00 AM</b> (next day),
                then all sales from 08 AM until 03 AM the next day are counted in <b>a single business day</b>. Dashboard, reports and exports all follow this timing.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1">Business Day Start</label>
                  <Input
                    type="time"
                    value={settings.businessDayStart || '08:00'}
                    onChange={(e) => setSettings({ ...settings, businessDayStart: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Business Day Close</label>
                  <Input
                    type="time"
                    value={settings.businessDayClose || '03:00'}
                    onChange={(e) => setSettings({ ...settings, businessDayClose: e.target.value })}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">If the Close time is earlier than the Start time, it will be treated as the next day.</p>
                </div>
              </div>
              <Button onClick={onSave} className="w-full">Save Business Day Timing</Button>
            </div>
    </div>
  );
}
