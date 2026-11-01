// ============================================================
// FAST BILLING MODE — one switch for the whole shop.
//
// Shops genuinely split on this. Some want their logo and their chosen
// receipt design on every bill. Others want the counter to move and do not
// care what the slip looks like. The switch is GLOBAL on purpose: a shop that
// chooses speed wants it on everything, and a raw bill followed by a rendered
// token is the worst of both — two different looks, two different speeds.
//
// When it is on, the bill, the KOT, the token and the shift report are all
// built as raw ESC/POS text and sent straight to the printer. When it is off,
// all four print their designed template and still go out as one silent RAW
// job with no dialog.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { getSettings, saveSettings } from '@/lib/store';

export default function FastBillingModeCard() {
  const [on, setOn] = useState(false);
  const [size, setSize] = useState<'normal' | 'large'>('large');
  const [bold, setBold] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const s: any = getSettings();
      setOn(!!s.fastRawPrintMode);
      setSize(s.receiptRawTextSize === 'normal' ? 'normal' : 'large');
      setBold(s.receiptRawBold !== false);
    } catch { /* settings not ready — leave the defaults */ }
    setReady(true);
  }, []);

  const setTextSize = (next: 'normal' | 'large') => {
    setSize(next);
    try {
      const s: any = getSettings();
      saveSettings({ ...s, receiptRawTextSize: next, kotRawTextSize: next });
      toast.success(next === 'large'
        ? 'Raw slips will print at the larger size.'
        : 'Raw slips will print at the compact size.');
    } catch (e: any) {
      toast.error(`Could not save the setting: ${e?.message || String(e)}`);
    }
  };

  const toggleBold = (next: boolean) => {
    setBold(next);
    try {
      const s: any = getSettings();
      saveSettings({ ...s, receiptRawBold: next });
      toast.success(next ? 'Raw slips will print in bold.' : 'Raw slips will print in normal weight.');
    } catch (e: any) {
      setBold(!next);
      toast.error(`Could not save the setting: ${e?.message || String(e)}`);
    }
  };

  const toggle = (next: boolean) => {
    setOn(next);
    try {
      const s: any = getSettings();
      saveSettings({ ...s, fastRawPrintMode: next });
      toast.success(
        next
          ? 'Fast Billing is on. Bills, KOTs, tokens and reports now print as plain text, without the logo or template.'
          : 'Fast Billing is off. Every slip prints its designed template again.',
      );
    } catch (e: any) {
      setOn(!next);
      toast.error(`Could not save the setting: ${e?.message || String(e)}`);
    }
  };

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Zap className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="flex-1">
          <h3 className="text-lg font-semibold">Fast Billing Mode</h3>
          <p className="text-xs text-muted-foreground mt-1">
            The fastest possible printing. Applies to <b>every</b> slip: bill, KOT,
            token and shift report.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-0.5 pr-4">
          <Label htmlFor="fast-billing" className="text-sm">
            Raw ESC/POS for everything
          </Label>
          <p className="text-xs text-muted-foreground">
            {on
              ? 'On — plain text slips. No logo, no QR, no receipt design.'
              : 'Off — full receipt design, logo and QR. Still silent and fast.'}
          </p>
        </div>
        <Switch id="fast-billing" checked={on} onCheckedChange={toggle} disabled={!ready} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Raw slip text size</Label>
        <div className="flex gap-2">
          <Button
            type="button" size="sm" disabled={!ready}
            variant={size === 'large' ? 'default' : 'outline'}
            onClick={() => setTextSize('large')}
          >
            Large (recommended)
          </Button>
          <Button
            type="button" size="sm" disabled={!ready}
            variant={size === 'normal' ? 'default' : 'outline'}
            onClick={() => setTextSize('normal')}
          >
            Compact
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <b>Large</b> prints item rows and the total at double height, so the plain
          slip reads close to the designed template. The line width does not change,
          so the same number of characters still fits. Applies to the bill and the KOT.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-0.5 pr-4">
          <Label htmlFor="raw-bold" className="text-sm">Bold text on raw slips</Label>
          <p className="text-xs text-muted-foreground">
            Keeps an ageing print head legible. Costs no extra paper.
          </p>
        </div>
        <Switch id="raw-bold" checked={bold} onCheckedChange={toggleBold} disabled={!ready} />
      </div>

      <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
        <p className="font-medium">What changes</p>
        <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
          <li><b>On:</b> no render step at all — the printer receives text bytes directly. Nothing is drawn, so the logo, QR code and premium layouts are not printed.</li>
          <li><b>Off:</b> the chosen template is rendered once and sent as a single RAW job. Still no dialog and no preview.</li>
          <li>Margins stay equal on both sides either way.</li>
        </ul>
        <p className="text-muted-foreground pt-1">
          A single printer can override this in Printer Settings &rarr; Print Mode,
          for a machine whose driver refuses raw bytes.
        </p>
      </div>
    </Card>
  );
}
