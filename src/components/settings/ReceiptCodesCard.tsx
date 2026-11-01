// ============================================================
// RECEIPT QR & BARCODE — Settings → Receipt.
//
// Two independent codes, each with its own switch, position and size, and a
// live 80mm preview of the bill as it will print. Everything is generated on
// this computer when a bill prints — nothing to generate by hand, nothing
// sent anywhere. Save keeps it (the tab's Save button does the same).
// ============================================================
import type React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ArrowDown, ArrowUp, Plus, QrCode, ScanBarcode, Trash2 } from 'lucide-react';
import ReceiptPreview from '@/components/ReceiptPreview';
import { barcodeLayout, maxCodeWidthMm, qrLayout } from '@/components/ReceiptCodes';
import type { RestaurantSettings } from '@/lib/types';
import {
  DEFAULT_SCAN_PAGE, LINK_TYPES, LINK_TYPE_ORDER, QR_SIZE_MM,
  barcodeValueFor, normalizeLink, detectLinkType, qrCaption, qrValueFor, readReceiptCodes,
  type CodePosition, type QrLinkType, type ReceiptCodesConfig,
} from '@/lib/receiptCodes';

interface Props {
  settings: RestaurantSettings;
  setSettings: React.Dispatch<React.SetStateAction<RestaurantSettings>>;
  onSave: () => void;
  sampleOrder: any;
}

const POSITIONS: { value: CodePosition; label: string }[] = [
  { value: 'above', label: 'Above receipt' },
  { value: 'footer', label: 'Footer' },
  { value: 'below', label: 'Below receipt' },
];

function Segmented<T extends string>({ value, options, onChange, testId }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1" data-testid={testId}>
      {options.map(o => (
        <Button key={o.value} type="button" size="sm" className="h-8 px-3 text-xs"
          variant={value === o.value ? 'default' : 'outline'} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

export default function ReceiptCodesCard({ settings, setSettings, onSave, sampleOrder }: Props) {
  const cfg = readReceiptCodes(settings);
  const write = (next: ReceiptCodesConfig) =>
    setSettings(prev => ({ ...prev, receiptCodes: { ...next, v: 2 } }) as RestaurantSettings);
  const setQr = (patch: Partial<ReceiptCodesConfig['qr']>) => write({ ...cfg, qr: { ...cfg.qr, ...patch } });
  const setBar = (patch: Partial<ReceiptCodesConfig['barcode']>) => write({ ...cfg, barcode: { ...cfg.barcode, ...patch } });

  // What the codes come out as on a typical bill — for the hints below.
  const maxMm = maxCodeWidthMm(settings);
  const qrValue = cfg.qr.enabled ? qrValueFor(sampleOrder, settings, cfg) : null;
  const qr = qrValue ? qrLayout(qrValue, cfg.qr.sizeMm, maxMm) : null;
  const barValue = cfg.barcode.enabled ? barcodeValueFor(sampleOrder, cfg, settings) : null;
  const bar = barValue ? barcodeLayout(cfg.barcode.format, barValue, cfg.barcode.size, maxMm) : null;

  const links = cfg.qr.links;
  const setLinks = (next: typeof links) => setQr({ links: next });
  const moveLink = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= links.length) return;
    const next = [...links];
    [next[i], next[j]] = [next[j], next[i]];
    setLinks(next);
  };

  return (
    <div className="border rounded-lg p-4 space-y-4" data-testid="receipt-codes-card">
      <div>
        <h3 className="text-sm font-bold">Receipt QR &amp; Barcode</h3>
        <p className="text-xs text-muted-foreground">
          Printed on every customer bill while switched on. Generated automatically on this computer when the bill
          prints — works offline, and no customer name, phone or address is ever put in a code.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-4 min-w-0">
          {/* ================= QR CODE ================= */}
          <section className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4" />
                <span className="text-sm font-semibold">QR code</span>
              </div>
              <Switch aria-label="QR code on receipts" checked={cfg.qr.enabled} onCheckedChange={v => setQr({ enabled: v })} />
            </div>

            {cfg.qr.enabled && (
              <>
                <div className="grid gap-2 sm:grid-cols-3" data-testid="qr-modes">
                  {([
                    { value: 'auto', title: 'Automatic receipt QR', desc: 'Unique to every bill: bill no., date, items, total, payment status.' },
                    { value: 'multi', title: 'Multi-link QR', desc: 'Google review, Facebook, WhatsApp… one QR, customer picks a link.' },
                    { value: 'single', title: 'Single link / text QR', desc: 'Any link (opens directly) or any text (shown on the phone).' },
                  ] as const).map(m => (
                    <button key={m.value} type="button" onClick={() => setQr({ mode: m.value })}
                      className={`rounded-lg border p-2.5 text-left transition-colors ${cfg.qr.mode === m.value ? 'border-primary bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-accent'}`}>
                      <span className="block text-xs font-bold">{m.title}</span>
                      <span className="block text-[11px] text-muted-foreground mt-0.5">{m.desc}</span>
                    </button>
                  ))}
                </div>

                {cfg.qr.mode === 'auto' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">When a customer scans it</Label>
                    <Segmented testId="qr-auto-view" value={cfg.qr.autoView} onChange={v => setQr({ autoView: v })} options={[
                      { value: 'text', label: 'Show the bill as text (recommended)' },
                      { value: 'page', label: 'Open the digital receipt page' },
                    ]} />
                    <p className="text-[11px] text-muted-foreground">
                      {cfg.qr.autoView === 'page'
                        ? 'A clean receipt page on the phone. Needs the scan page published once from Super Admin (see below) and internet on the phone.'
                        : 'Any phone camera shows the bill — shop, bill no., date, items, total, paid — as text. No internet, nothing to set up.'}
                    </p>
                  </div>
                )}

                {cfg.qr.mode === 'multi' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">When a customer scans it</Label>
                    <Segmented testId="qr-multi-view" value={cfg.qr.multiView} onChange={v => setQr({ multiView: v })} options={[
                      { value: 'text', label: 'Show the links (recommended)' },
                      { value: 'page', label: 'Open the links page' },
                    ]} />
                    <p className="text-[11px] text-muted-foreground">
                      {cfg.qr.multiView === 'page'
                        ? 'A page with one button per link. Needs the scan page published once from Super Admin (see below) and internet on the phone.'
                        : 'The phone shows your shop name and every link, one per line — the customer taps the one they want. Nothing to set up.'}
                    </p>
                  </div>
                )}

                {cfg.qr.mode === 'multi' && (
                  <div className="space-y-2" data-testid="qr-links">
                    <Label className="text-xs">Links (in the order customers see them)</Label>
                    {links.length === 0 && <p className="text-[11px] text-muted-foreground">No links yet — add Google Reviews, Facebook, WhatsApp…</p>}
                    {links.map((l, i) => {
                      const ok = !l.url.trim() || !!normalizeLink(l.type, l.url);
                      return (
                        <div key={l.id} className="rounded-md border p-2 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select aria-label="Link type" className="h-8 rounded-md border bg-background px-2 text-xs"
                              value={l.type} onChange={e => setLinks(links.map((x, k) => k === i ? { ...x, type: e.target.value as QrLinkType } : x))}>
                              {LINK_TYPE_ORDER.map(t => <option key={t} value={t}>{LINK_TYPES[t].label}</option>)}
                            </select>
                            <Input aria-label="Button text" className="h-8 flex-1 min-w-[120px] text-xs" placeholder={`Button text (default: ${LINK_TYPES[l.type].label})`}
                              value={l.label} onChange={e => setLinks(links.map((x, k) => k === i ? { ...x, label: e.target.value } : x))} />
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Move up" disabled={i === 0} onClick={() => moveLink(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Move down" disabled={i === links.length - 1} onClick={() => moveLink(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Remove link" onClick={() => setLinks(links.filter((_, k) => k !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                          <Input aria-label="Link" className={`h-8 text-xs ${ok ? '' : 'border-destructive'}`} placeholder={LINK_TYPES[l.type].placeholder}
                            value={l.url} onChange={e => setLinks(links.map((x, k) => k === i ? { ...x, url: e.target.value } : x))} />
                          {!ok && <p className="text-[11px] text-destructive">Not a valid link — it will be left out of the QR.</p>}
                        </div>
                      );
                    })}
                    <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={links.length >= 10}
                      onClick={() => setLinks([...links, { id: `link-${Date.now().toString(36)}`, type: LINK_TYPE_ORDER[Math.min(links.length, LINK_TYPE_ORDER.length - 1)], label: '', url: '' }])}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add link
                    </Button>
                  </div>
                )}

                {cfg.qr.mode === 'single' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Link or text</Label>
                    <Input aria-label="Single link" className="h-8 text-xs" placeholder="https://g.page/r/…/review  ·  0300 1234567 (WhatsApp)  ·  or any text, e.g. Wi-Fi: ChaiKhass / 12345678"
                      value={cfg.qr.singleUrl} onChange={e => setQr({ singleUrl: e.target.value })} />
                    {cfg.qr.singleUrl.trim() && (normalizeLink(detectLinkType(cfg.qr.singleUrl), cfg.qr.singleUrl)
                      ? <p className="text-[11px] text-muted-foreground">Scanning opens: {normalizeLink(detectLinkType(cfg.qr.singleUrl), cfg.qr.singleUrl)}</p>
                      : <p className="text-[11px] text-muted-foreground">Not a link — scanning shows this text on the phone.</p>)}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Caption under the QR</Label>
                    <Input className="h-8 text-xs" placeholder={qrCaption({ ...cfg, qr: { ...cfg.qr, caption: '' } })}
                      value={cfg.qr.caption} onChange={e => setQr({ caption: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Position</Label>
                    <Segmented testId="qr-position" value={cfg.qr.position} options={POSITIONS} onChange={v => setQr({ position: v })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Size</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">{qr ? `${qr.widthMm.toFixed(1)} mm` : `${cfg.qr.sizeMm} mm`}</span>
                  </div>
                  <Slider aria-label="QR size" min={QR_SIZE_MM.min} max={QR_SIZE_MM.max} step={1} value={[cfg.qr.sizeMm]} onValueChange={([v]) => setQr({ sizeMm: v })} />
                  {qrValue && !qr && <p className="text-[11px] text-destructive">Too much data for a QR on this paper.</p>}
                  {qr && qr.dotsPerModule < 4 && (
                    <p className="text-[11px] text-amber-600">Each QR square prints {(qr.dotsPerModule / 8).toFixed(2)} mm — make the QR larger (or put less in it) so every phone reads it off thermal paper.</p>
                  )}
                  {cfg.qr.mode === 'auto' && cfg.qr.autoView === 'text' && (
                    <p className="text-[11px] text-muted-foreground">A larger QR lists more of the bill's items; the rest are counted.</p>
                  )}
                  {cfg.qr.enabled && !qrValue && cfg.qr.mode !== 'auto' && (
                    <p className="text-[11px] text-destructive">{cfg.qr.mode === 'multi' ? 'Add a valid link' : 'Type a link or some text'} — without it no QR prints.</p>
                  )}
                </div>
              </>
            )}
          </section>

          {/* ================= BARCODE ================= */}
          <section className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ScanBarcode className="h-4 w-4" />
                <span className="text-sm font-semibold">Barcode</span>
              </div>
              <Switch aria-label="Barcode on receipts" checked={cfg.barcode.enabled} onCheckedChange={v => setBar({ enabled: v })} />
            </div>

            {cfg.barcode.enabled && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">What it carries</Label>
                  <Segmented testId="barcode-content" value={cfg.barcode.content} onChange={v => setBar({ content: v })} options={[
                    { value: 'info', label: 'Bill info (recommended)' },
                    { value: 'receipt', label: 'Short reference' },
                    { value: 'custom', label: 'Custom text' },
                  ]} />
                  {cfg.barcode.content === 'custom'
                    ? <Input aria-label="Barcode text" className="h-8 text-xs font-mono" placeholder={cfg.barcode.format === 'code39' ? 'Up to 12 characters: A-Z 0-9 - . $ / + %' : 'Up to 20 characters'}
                        value={cfg.barcode.customText} onChange={e => setBar({ customText: e.target.value })} />
                    : <p className="text-[11px] text-muted-foreground">
                        Scanning shows <span className="font-mono font-semibold">{barValue ?? barcodeValueFor(sampleOrder, { ...cfg, barcode: { ...cfg.barcode, enabled: true } }, settings)}</span>
                        {cfg.barcode.content === 'info'
                          ? (/Rs/.test(barValue ?? '') ? ' — the bill number and amount' : ' — the bill number (Small bars fit the amount too)')
                          : ' — R, the date and the bill number'}.
                        Scanned at the POS it opens that bill in Bill Reprint.
                      </p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Format</Label>
                    <Segmented testId="barcode-format" value={cfg.barcode.format} onChange={v => setBar({ format: v })} options={[
                      { value: 'code128', label: 'Code 128 (recommended)' },
                      { value: 'code39', label: 'Code 39' },
                    ]} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Branch / counter code (optional)</Label>
                    <Input className="h-8 text-xs font-mono uppercase" maxLength={6} placeholder="e.g. LHR1"
                      value={cfg.barcode.prefix} onChange={e => setBar({ prefix: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Position</Label>
                    <Segmented testId="barcode-position" value={cfg.barcode.position} options={POSITIONS} onChange={v => setBar({ position: v })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Size</Label>
                    <Segmented testId="barcode-size" value={cfg.barcode.size} onChange={v => setBar({ size: v })} options={[
                      { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
                    ]} />
                    <p className="text-[11px] text-muted-foreground">Medium and Large bars scan best off thermal paper; Small fits the most text.</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 items-end">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Caption (optional)</Label>
                    <Input className="h-8 text-xs" placeholder="e.g. Keep this receipt for returns" value={cfg.barcode.caption} onChange={e => setBar({ caption: e.target.value })} />
                  </div>
                  <label className="flex items-center justify-between gap-2 rounded-md border px-3 h-8 text-xs">
                    Print the text under the bars
                    <Switch checked={cfg.barcode.showText} onCheckedChange={v => setBar({ showText: v })} />
                  </label>
                </div>
                {barValue && !bar && <p className="text-[11px] text-destructive">Too long for this paper — use Code 128 or a shorter text.</p>}
                {bar?.fellBack && <p className="text-[11px] text-amber-600">Code 39 is too wide for this paper with this text; the bill prints it as Code 128 (most scanners read both).</p>}
                {cfg.barcode.content === 'custom' && !barValue && <p className="text-[11px] text-destructive">Type the text to encode — without it no barcode prints.</p>}
              </>
            )}
          </section>

          {cfg.qr.enabled && ((cfg.qr.mode === 'auto' && cfg.qr.autoView === 'page') || (cfg.qr.mode === 'multi' && cfg.qr.multiView === 'page')) && (
            <div className="space-y-1.5">
              <Label className="text-xs">Scan page address</Label>
              <Input className="h-8 text-xs font-mono" placeholder={DEFAULT_SCAN_PAGE} value={cfg.scanPageUrl === DEFAULT_SCAN_PAGE ? '' : cfg.scanPageUrl}
                onChange={e => write({ ...cfg, scanPageUrl: e.target.value || DEFAULT_SCAN_PAGE })} />
              <p className="text-[11px] text-muted-foreground">
                The page the receipt and link QR codes open. It is published with the Super Admin panel (scan.html);
                change it only if you host that page somewhere else.
              </p>
            </div>
          )}

          <Button type="button" onClick={onSave}>Save QR &amp; Barcode</Button>
        </div>

        {/* ================= PRINT PREVIEW ================= */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">Print preview</p>
          <div className="bg-muted/30 rounded-lg p-2 overflow-auto max-h-[640px] flex justify-center">
            <div className="bg-white shadow-md">
              <ReceiptPreview order={sampleOrder} settings={settings} showPrintButton={false} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">Sample bill · the printer uses the same design and sizes.</p>
        </div>
      </div>
    </div>
  );
}
