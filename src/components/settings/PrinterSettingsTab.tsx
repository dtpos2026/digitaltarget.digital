// ============================================================
// The printer tab of Settings.
//
// Lifted out of SettingsPage.tsx unchanged. Note this is the printer section of
// the general Settings screen, which is a different thing from Printer Center —
// that one owns the devices, their roles and their calibration.
// ============================================================
import React from 'react';
import { toast } from 'sonner';
import { RestaurantSettings, DiningTable, Floor, Kitchen, Waiter, Rider, ReceiptTextStyle } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, AlertTriangle, Download, Printer, Palette, MapPin, Navigation, ShoppingBag, Globe2, Settings as SettingsIcon, MessageCircle } from 'lucide-react';
import { isElectron, getPrinters, getAutoStart, setAutoStart } from '@/lib/electron';
import { Slider } from '@/components/ui/slider';
import { getBrowserPrintStyle, setBrowserPrintStyle, type BrowserPrintStyle } from '@/printing/printCss';

interface Props {
  settings: RestaurantSettings;
  setSettings: React.Dispatch<React.SetStateAction<RestaurantSettings>>;
  onSave: () => void;
  printers: { name: string; isDefault?: boolean }[];
  receiptSizePresets: readonly any[];
  autoStartEnabled: boolean;
  onToggleAutoStart: (next: boolean) => void;
}

export default function PrinterSettingsTab({ settings, setSettings, onSave, printers, receiptSizePresets, autoStartEnabled, onToggleAutoStart }: Props) {
  // v1.105.0 — how a slip prints from a BROWSER (the desktop app is unaffected).
  const [browserStyle, setBrowserStyle] = React.useState<BrowserPrintStyle>(() => getBrowserPrintStyle());
  return (
    <div className="space-y-4">
      {!isElectron() && (
        <div className="rounded-xl border bg-card p-4 shadow-sm" data-testid="browser-print-style">
          <p className="text-sm font-bold">Printing from the browser</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose how a receipt, KOT or token looks when it is printed from this browser. The desktop app has its own printing and is not affected.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Browser print style">
            {([
              ['design', 'Exactly as designed', 'Your template\'s own colours, borders, fonts and logo — what you see in the preview. Best for laser, inkjet and PDF.'],
              ['thermal', 'Print for a thermal head', 'Everything pure black with fixed grid lines and a darkened logo, tuned for a thermal receipt printer.'],
            ] as const).map(([id, title, hint]) => (
              <button
                key={id} type="button" role="radio" aria-checked={browserStyle === id} data-style={id}
                onClick={() => { setBrowserPrintStyle(id); setBrowserStyle(id); toast.success(id === 'design' ? 'Browser printing will print the design exactly' : 'Browser printing is tuned for a thermal head'); }}
                className={`rounded-xl border p-3 text-left transition-colors ${browserStyle === id ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'hover:border-primary/40'}`}
              >
                <span className="block text-[13px] font-bold">{title}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Printer className="h-5 w-5" />
                <h3 className="text-sm font-bold">🖨️ Printer Settings</h3>
              </div>
              <p className="text-xs text-muted-foreground">Printers installed in Windows are listed here. Choose the default printer.</p>

              {/* Auto-start on Windows boot (Electron only) */}
              {isElectron() && (
                <div className="flex items-center justify-between rounded-lg border bg-card p-3">
                  <div>
                    <div className="text-sm font-medium">Auto-start on Windows boot</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">DT POS will launch in the background as soon as the computer turns on.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={autoStartEnabled}
                      onChange={e => onToggleAutoStart(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-muted rounded-full peer-checked:bg-primary transition-colors relative">
                      <div className={`absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full shadow transition-transform ${autoStartEnabled ? 'translate-x-5' : ''}`} />
                    </div>
                  </label>
                </div>
              )}


              {/* Printer Selection */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Default Printer</label>
                {isElectron() ? (
                  printers.length > 0 ? (
                    <select
                      className="w-full border rounded-lg p-2 text-sm bg-card"
                      value={settings.defaultPrinter || ''}
                      onChange={e => setSettings({ ...settings, defaultPrinter: e.target.value })}
                    >
                      <option value="">-- Select Printer --</option>
                      {printers.map(p => (
                        <option key={p.name} value={p.name}>
                          {p.name} {p.isDefault ? '(System Default)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground bg-accent rounded-lg p-3">No printer found. Install the printer in Windows first.</p>
                  )
                ) : (
                  <div className="bg-accent rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">⚠️ Printers can be chosen in the Windows desktop app only. In a browser the system print dialog is used.</p>
                  </div>
                )}
              </div>

              {/* KOT (Kitchen) Printer Selection */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  🍳 Kitchen (KOT) Printer
                  <span className="ml-2 text-[10px] text-muted-foreground/70">— Network/USB printer for kitchen tickets</span>
                </label>
                {isElectron() ? (
                  printers.length > 0 ? (
                    <select
                      className="w-full border rounded-lg p-2 text-sm bg-card"
                      value={settings.kotPrinter || ''}
                      onChange={e => setSettings({ ...settings, kotPrinter: e.target.value })}
                    >
                      <option value="">— Same as Receipt Printer —</option>
                      {printers.map(p => (
                        <option key={p.name} value={p.name}>
                          {p.name} {p.isDefault ? '(System Default)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground bg-accent rounded-lg p-3">No printer found.</p>
                  )
                ) : (
                  <div className="bg-accent rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">⚠️ The KOT printer can be chosen in the Windows desktop app only.</p>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Two-printer setup: the one above prints <b>Receipts</b> (POS bills), this one prints <b>Kitchen</b> slips (KOT). For a network printer, install its shared name in Windows first; it then appears here.
                </p>
              </div>

              {/* ===== Phase-3: Backup Printer + Auto-Reprint + Offline Alert ===== */}
              <div className="border-t pt-3 mt-2 space-y-3">
                <h4 className="text-xs font-bold">🛟 Backup Printer & Failover</h4>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    Backup Printer
                    <span className="ml-2 text-[10px] text-muted-foreground/70">— used if primary printer fails after retries</span>
                  </label>
                  {isElectron() && printers.length > 0 ? (
                    <select
                      className="w-full border rounded-lg p-2 text-sm bg-card"
                      value={settings.backupPrinter || ''}
                      onChange={e => setSettings({ ...settings, backupPrinter: e.target.value })}
                    >
                      <option value="">— None —</option>
                      {printers.map(p => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground bg-accent rounded-lg p-3">⚠️ The backup printer can be chosen in the Windows desktop app only.</p>
                  )}
                </div>
                <div className="flex items-center justify-between bg-card border rounded-lg p-3 border-l-2 border-l-emerald-500">
                  <div>
                    <p className="text-xs font-bold">Auto Reprint on Failure</p>
                    <p className="text-[10px] text-muted-foreground">If the primary printer fails, the job automatically moves to the backup printer</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, autoReprintOnFailure: settings.autoReprintOnFailure === false ? true : false })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.autoReprintOnFailure !== false ? 'bg-emerald-500' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.autoReprintOnFailure !== false ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between bg-card border rounded-lg p-3 border-l-2 border-l-red-500">
                  <div>
                    <p className="text-xs font-bold">Offline Printer Alert</p>
                    <p className="text-[10px] text-muted-foreground">Shows a red banner while the printer is offline (jobs are held)</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, offlinePrinterAlert: settings.offlinePrinterAlert === false ? true : false })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${settings.offlinePrinterAlert !== false ? 'bg-red-500' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.offlinePrinterAlert !== false ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* Token Printer Selection (separate from receipt + kot) */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  🎫 Token / Customer-Token Printer
                  <span className="ml-2 text-[10px] text-muted-foreground/70">— Optional 3rd printer for token slips</span>
                </label>
                {isElectron() ? (
                  printers.length > 0 ? (
                    <select
                      className="w-full border rounded-lg p-2 text-sm bg-card"
                      value={settings.tokenPrinter || ''}
                      onChange={e => setSettings({ ...settings, tokenPrinter: e.target.value })}
                    >
                      <option value="">— Same as Receipt Printer —</option>
                      {printers.map(p => (
                        <option key={p.name} value={p.name}>
                          {p.name} {p.isDefault ? '(System Default)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground bg-accent rounded-lg p-3">No printer found.</p>
                  )
                ) : (
                  <div className="bg-accent rounded-lg p-3">
                    <p className="text-xs text-muted-foreground">⚠️ The token printer can be chosen in the Windows desktop app only.</p>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  An optional third printer for <b>Token / Customer slips</b> only. Leave it empty to use the receipt printer.
                </p>
              </div>

              {/* Silent Print Toggle */}
              <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                <div>
                  <p className="text-xs font-bold">Silent Print (no dialog)</p>
                  <p className="text-[10px] text-muted-foreground">On Pay / Print the receipt goes straight to the printer, without a print dialog</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, silentPrint: !settings.silentPrint })}
                  className={`w-12 h-6 rounded-full transition-colors relative ${settings.silentPrint ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.silentPrint ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {/* Receipt Size Presets - lock-in 3 ready combos */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Receipt Size (80mm Quick Preset)</label>
                <p className="text-[10px] text-muted-foreground mb-2">Three ready 80mm options for the DTB Pro 20 / FP-1100 — compact, standard, bold. Width stays the same; only the text and layout change.</p>
                <div className="grid grid-cols-3 gap-2">
                  {receiptSizePresets.map(preset => {
                    const active = (settings.receiptSizePreset || 'standard-80') === preset.key;
                    return (
                      <button
                        key={preset.key}
                        onClick={() => setSettings({
                          ...settings,
                          receiptSizePreset: preset.key,
                          paperSize: preset.paperSize,
                          receiptScale: preset.receiptScale,
                          receiptMarginTop: preset.receiptMarginTop,
                          receiptMarginBottom: preset.receiptMarginBottom,
                          receiptMarginLeft: preset.receiptMarginLeft,
                          receiptMarginRight: preset.receiptMarginRight,
                          receiptTrimMm: preset.receiptTrimMm,
                          receiptDesign: preset.receiptDesign,
                        })}
                        className={`p-3 rounded-lg border text-center transition-colors ${
                          active ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-accent'
                        }`}
                      >
                        <div className="text-xl">{preset.emoji}</div>
                        <div className="text-xs font-bold mt-1">{preset.label}</div>
                        <div className="text-[10px] opacity-80">{preset.sub}</div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">To avoid a blank top feed, all presets are tuned for continuous roll with a zero top-margin approach.</p>
              </div>

              {/* FP-1100 Raster One-Click Preset */}
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-bold flex items-center gap-2">🖨️ Fujitsu FP-1100 Raster Preset</div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      One click sets the best values for the FP-1100 Raster driver: Windows GDI driver, 80mm width, top margin 0, extra feed off, trim 0, cut allowance 0. Tuned to keep the blank feed at the top to a minimum.
                    </p>
                  </div>
                  <button
                    onClick={() => setSettings({
                      ...settings,
                      paperSize: '80mm',
                      printerDriverType: 'windows',
                      receiptMode: 'continuous',
                      receiptMarginTop: 0,
                      receiptMarginBottom: 1,
                      receiptMarginLeft: 3,
                      receiptMarginRight: 3,
                      receiptTrimMm: 0,
                      disableExtraFeed: true,
                      autoCut: true,
                      receiptScale: 100,
                    })}
                    className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 whitespace-nowrap"
                  >
                    Apply FP-1100
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Receipt Mode</label>
                  <div className="flex gap-2">
                    {([
                      { value: 'continuous', label: 'Continuous Roll' },
                      { value: 'paged', label: 'Page Mode' },
                    ] as const).map(mode => (
                      <button
                        key={mode.value}
                        onClick={() => setSettings({ ...settings, receiptMode: mode.value })}
                        className={`flex-1 p-3 rounded-lg border text-xs font-bold text-center transition-colors ${
                          (settings.receiptMode || 'continuous') === mode.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card hover:bg-accent'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Driver Type</label>
                  <div className="flex gap-2">
                      {([
                        { value: 'escpos', label: 'ESC/POS (Recommended)' },
                      { value: 'windows', label: 'Windows GDI' },
                    ] as const).map(driver => (
                      <button
                        key={driver.value}
                        onClick={() => setSettings({ ...settings, printerDriverType: driver.value })}
                        className={`flex-1 p-3 rounded-lg border text-xs font-bold text-center transition-colors ${
                          (settings.printerDriverType || 'escpos') === driver.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card hover:bg-accent'
                        }`}
                      >
                        {driver.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Header/Footer Toggle */}
              <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                <div>
                  <p className="text-xs font-bold">Print Header & Footer</p>
                  <p className="text-[10px] text-muted-foreground">Browser print header/footer (URL, date etc.)</p>
                </div>
                <button
                  onClick={() => setSettings({ ...settings, printHeaderFooter: !settings.printHeaderFooter })}
                  className={`w-12 h-6 rounded-full transition-colors relative ${settings.printHeaderFooter ? 'bg-primary' : 'bg-muted'}`}
                >
                  <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.printHeaderFooter ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                  <div>
                    <p className="text-xs font-bold">Disable Extra Feed</p>
                    <p className="text-[10px] text-muted-foreground">Suppress the blank paper feed before the receipt starts — keep on for the FP-1100</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, disableExtraFeed: !(settings.disableExtraFeed !== false) })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${(settings.disableExtraFeed !== false) ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${(settings.disableExtraFeed !== false) ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between bg-card border rounded-lg p-3">
                  <div>
                    <p className="text-xs font-bold">Auto Cut After Receipt</p>
                    <p className="text-[10px] text-muted-foreground">Cut exactly at the end of the receipt</p>
                  </div>
                  <button
                    onClick={() => setSettings({ ...settings, autoCut: !(settings.autoCut !== false) })}
                    className={`w-12 h-6 rounded-full transition-colors relative ${(settings.autoCut !== false) ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${(settings.autoCut !== false) ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Cut Mode</label>
                <div className="flex gap-2">
                  {([
                    { value: 'full', label: 'Full Cut' },
                    { value: 'partial', label: 'Partial Cut' },
                  ] as const).map(mode => (
                    <button
                      key={mode.value}
                      onClick={() => setSettings({ ...settings, cutMode: mode.value })}
                      className={`flex-1 p-3 rounded-lg border text-xs font-bold text-center transition-colors ${
                        (settings.cutMode || 'full') === mode.value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card hover:bg-accent'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto Kitchen Print - moved to KOT Settings tab */}
            </div>

            {/* Receipt Scale & Margin Controls */}
            <div className="border rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-bold">📐 Receipt Scale & Margins</h3>
              <p className="text-xs text-muted-foreground">A safe left / right margin of at least 3 mm keeps receipts and KOTs from being cut off.</p>

              {/* Scale */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Scale: {settings.receiptScale || 100}%</label>
                <Slider
                  value={[settings.receiptScale || 100]}
                  onValueChange={([v]) => setSettings({ ...settings, receiptScale: v })}
                  min={50}
                  max={200}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>50%</span>
                  <span>100%</span>
                  <span>200%</span>
                </div>
              </div>

              {/* Margins */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Top Margin (mm)</label>
                  <Input
                    type="number"
                    value={settings.receiptMarginTop ?? 0}
                    onChange={e => setSettings({ ...settings, receiptMarginTop: Math.max(0, Math.min(6, Number(e.target.value))) })}
                    min={0} max={20} step={0.5}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Bottom Margin (mm)</label>
                  <Input
                    type="number"
                    value={settings.receiptMarginBottom ?? 0}
                    onChange={e => setSettings({ ...settings, receiptMarginBottom: Math.max(0, Math.min(6, Number(e.target.value))) })}
                    min={0} max={20} step={0.5}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Left Margin (mm)</label>
                  <Input
                    type="number"
                    value={settings.receiptMarginLeft ?? 3}
                    onChange={e => setSettings({ ...settings, receiptMarginLeft: Math.max(3, Math.min(12, Number(e.target.value))) })}
                    min={3} max={12} step={0.5}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Right Margin (mm)</label>
                  <Input
                    type="number"
                    value={settings.receiptMarginRight ?? 3}
                    onChange={e => setSettings({ ...settings, receiptMarginRight: Math.max(3, Math.min(12, Number(e.target.value))) })}
                    min={3} max={12} step={0.5}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Paper Cut Trim (mm) — increase to waste less paper
                  </label>
                  <Input
                    type="number"
                    value={settings.receiptTrimMm ?? 3}
                    onChange={e => setSettings({ ...settings, receiptTrimMm: Math.max(0, Math.min(12, Number(e.target.value))) })}
                    min={0} max={20} step={1}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    2–3mm is best for a Fujitsu / Fishto FP-1100 80mm. If the last line gets cut, reduce to 1–2mm, and if extra paper appears at the end, increase up to 4mm.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-3 text-[11px] leading-5 text-muted-foreground">
                <p className="font-bold text-foreground mb-1">Windows printer preference for this printer</p>
                <p>Paper: 80mm Receipt / Roll, Source: Roll Paper, Orientation: Portrait, Margins: None, Scale: 100%, Copies: 1, Continuous paper mode on. Do not select A4 or Letter.</p>
              </div>

              {/* Preview box */}
              <div className="border-2 border-dashed rounded-lg p-2 bg-accent/30">
                <p className="text-[10px] text-center text-muted-foreground mb-1">Preview (approximate)</p>
                <div
                  className="mx-auto bg-white border rounded"
                  style={{
                    width: '60mm',
                    height: '40mm',
                    position: 'relative',
                  }}
                >
                  <div
                    className="bg-muted/50 absolute"
                    style={{
                      top: `${(settings.receiptMarginTop ?? 0) * 1.5}px`,
                      bottom: `${(settings.receiptMarginBottom ?? 0) * 1.5}px`,
                      left: `${(settings.receiptMarginLeft ?? 0) * 1.5}px`,
                      right: `${(settings.receiptMarginRight ?? 0) * 1.5}px`,
                    }}
                  >
                    <p className="text-[8px] text-center text-muted-foreground mt-2" style={{ transform: `scale(${(settings.receiptScale || 100) / 100})` }}>
                      Receipt Content ({settings.receiptScale || 100}%)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={onSave} className="flex-1">Save Printer Settings</Button>
              <Button variant="outline" onClick={() => { window.print(); toast.info('Test print sent'); }}>
                🖨️ Print Test
              </Button>
            </div>
    </div>
  );
}
