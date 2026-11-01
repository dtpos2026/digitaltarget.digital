// ============================================================
// PRINT ALIGNMENT TEST — the calibration slip, printed both ways.
//
// Acceptance test for the equal-margin work. Code and simulators cannot
// settle whether the margins are equal on a given machine; only paper can.
// This prints a slip designed to be measured with a ruler, through whichever
// path the user picks, and records the active profile and strategy ON the
// slip so a photograph of it is self-describing.
//
// Pass condition: the left and right gaps match within about 1mm, and the
// '=' ruler reaches both edges on ONE line. If the ruler wraps, the
// characters-per-line constant for that paper profile is wrong — fix it in
// src/printing/paperProfile.ts, never by shrinking the font.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Ruler } from 'lucide-react';
import { printNode } from '@/printing';
import {
  alignmentTestLines,
  buildAlignmentTestBytes,
  alignmentFontPx,
} from '@/printing/alignmentTest';
import { resolveReceiptLayout, expectedMargins, computeMarginCorrection } from '@/printing/receiptLayout';
import { PAPER_PROFILE_LIST, type PaperProfileId } from '@/printing/paperProfile';
import { loadPrintMargins, savePrintMargins, equaliseSideMargins } from '@/lib/printMargins';
import { loadPrinterSettings, savePrinterSettings, resolvePrinterForRole, equalisePrinterMargins, type PrinterConfig } from '@/lib/printerSettings';
import { getDeviceId } from '@/lib/tenant';

type Mode = 'raw' | 'driver';

export default function PrintAlignmentTestCard() {
  const portalRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [paper, setPaper] = useState<PaperProfileId>('80mm');
  const [counter, setCounter] = useState<PrinterConfig | undefined>();

  // The counter printer decides the paper profile and margins, so the test
  // slip is printed with exactly the geometry a real bill would use.
  useEffect(() => {
    let alive = true;
    loadPrinterSettings()
      .then((s) => {
        if (!alive) return;
        const cfg = resolvePrinterForRole(s, 'counter', getDeviceId());
        setCounter(cfg);
        if (cfg?.paperSize) setPaper(cfg.paperSize as PaperProfileId);
      })
      .catch(() => { /* fall back to the device defaults below */ });
    return () => { alive = false; };
  }, []);

  // What the shop measured off the printed slip with a ruler.
  const [measuredLeft, setMeasuredLeft] = useState('');
  const [measuredRight, setMeasuredRight] = useState('');
  const [marginTick, setMarginTick] = useState(0);
  // Re-read after an equalise so the panel and the slip agree immediately.
  const device = useMemo(() => { void marginTick; return loadPrintMargins(); }, [marginTick]);
  const leftMm = counter?.leftMarginMm ?? device.left;
  const rightMm = counter?.rightMarginMm ?? device.right;
  // Which of the two stores is actually in force, printed on the slip.
  const marginSource = counter?.leftMarginMm != null ? `printer: ${counter.name || counter.printerName || 'counter'}` : 'device settings';
  const unequal = Math.abs(leftMm - rightMm) > 0.05;
  const contentWidthMm = counter?.printWidthMm || device.contentWidthMm || undefined;

  const layout = useMemo(
    () => resolveReceiptLayout({ paper, leftMm, rightMm, contentWidthMm }),
    [paper, leftMm, rightMm, contentWidthMm],
  );
  const gaps = expectedMargins(layout, 'html');

  const correction = useMemo(() => {
    if (measuredLeft.trim() === '' || measuredRight.trim() === '') return null;
    return computeMarginCorrection(layout, Number(measuredLeft), Number(measuredRight));
  }, [layout, measuredLeft, measuredRight]);

  const rawAvailable = !!(window as any).electronAPI?.printRaw;

  /**
   * Force both stores equal. A machine can hold an asymmetric pair in the
   * printer's own configuration OR in this device's settings, and the shop
   * should not have to work out which one is in force — so both are set.
   */
  const equaliseNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const side = Math.max(0, Math.min(leftMm, rightMm));
      equaliseSideMargins(side);
      if (counter) {
        const all = await loadPrinterSettings();
        const next = {
          ...all,
          printers: all.printers.map(p => (p.id === counter.id ? equalisePrinterMargins(p, side) : p)),
        };
        await savePrinterSettings(next);
        setCounter(equalisePrinterMargins(counter, side));
      }
      setMarginTick(t => t + 1);
      toast.success(`Margins set to ${side} mm on both sides. Print the alignment slip again to confirm.`);
    } catch (e: any) {
      toast.error(`Could not update the margins: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Nudge both side margins together, in 0.5mm steps.
   *
   * Together, not separately: a shop tuning this is deciding how much blank
   * paper it wants on each edge, and letting the two drift apart is what
   * produced the lopsided slips in the first place. A genuine per-machine
   * head offset is a different setting, on the calibration screen.
   */
  const nudge = async (delta: number) => {
    if (busy) return;
    const next = Math.max(0, Math.min(20, Math.round((Math.min(leftMm, rightMm) + delta) * 10) / 10));
    setBusy(true);
    try {
      equaliseSideMargins(next);
      if (counter) {
        const all = await loadPrinterSettings();
        await savePrinterSettings({
          ...all,
          printers: all.printers.map(p => (p.id === counter.id ? equalisePrinterMargins(p, next) : p)),
        });
        setCounter(equalisePrinterMargins(counter, next));
      }
      setMarginTick(t => t + 1);
    } catch (e: any) {
      toast.error(`Could not update the margins: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /** Write one pair of side margins to whichever store is in force. */
  const writeMargins = async (left: number, right: number) => {
    savePrintMargins({ ...loadPrintMargins(), left, right });
    if (counter) {
      const all = await loadPrinterSettings();
      await savePrinterSettings({
        ...all,
        printers: all.printers.map(p =>
          p.id === counter.id ? { ...p, leftMarginMm: left, rightMarginMm: right } : p),
      });
      setCounter({ ...counter, leftMarginMm: left, rightMarginMm: right });
    }
    setMarginTick(t => t + 1);
  };

  /**
   * Turn two ruler measurements into the margins that centre the slip.
   *
   * This is the step that used to be an evening of print, look, adjust, print
   * again — which is how a client arrived at Left 3 / Right 5 for their own
   * machine. The measurement is theirs; the arithmetic does not have to be.
   */
  const applyCorrection = async () => {
    if (busy || !correction) return;
    setBusy(true);
    try {
      await writeMargins(correction.leftMm, correction.rightMm);
      setMeasuredLeft('');
      setMeasuredRight('');
      toast.success(
        `Margins set to ${correction.leftMm} / ${correction.rightMm} mm. Print the slip again to confirm on paper.`,
      );
    } catch (e: any) {
      toast.error(`Could not update the margins: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const run = async (mode: Mode) => {
    if (busy) return;
    setBusy(true);
    try {
      const printerName =
        (counter && (counter.connection || 'system') === 'system' && counter.printerName) ||
        localStorage.getItem('pos-default-printer') ||
        undefined;

      // ---- Raw ESC/POS: bytes straight to the spooler, no render step ----
      if (mode === 'raw') {
        const api: any = (window as any).electronAPI;
        if (!api?.printRaw) {
          toast.error('Raw ESC/POS printing is available in the desktop app on Windows only.');
          return;
        }
        const bytes = buildAlignmentTestBytes({
          paper, leftMm, rightMm, contentWidthMm,
          strategy: 'raw-escpos', printerName, marginSource,
        });
        const res = await api.printRaw({ printerName, data: bytes, copies: 1 });
        if (res?.success) {
          toast.success(`Alignment slip sent${printerName ? ` to ${printerName}` : ''}. Measure both edges.`);
        } else {
          toast.error(`Raw alignment print failed: ${res?.error || 'unknown error'}`);
        }
        return;
      }

      // ---- Windows driver: the same slip through the HTML path ----
      const el = portalRef.current;
      if (!el) return;
      const res = await printNode(el, {
        paperWidth: paper,
        printerName,
        silent: true,
        copies: 1,
        marginLeftMm: leftMm,
        marginRightMm: rightMm,
        contentWidthMm,
        logType: 'test',
      });
      if (res.success) {
        toast.success(`Alignment slip sent${printerName ? ` to ${printerName}` : ''}. Measure both edges.`);
      } else {
        toast.error(`Alignment print failed: ${res.error || 'unknown error'}`);
      }
    } catch (e: any) {
      toast.error(`Alignment print error: ${e?.message || String(e)}`);
    } finally {
      setTimeout(() => setBusy(false), 600);
    }
  };

  const lines = alignmentTestLines({ paper, leftMm, rightMm, contentWidthMm, strategy: 'windows-driver', marginSource });

  return (
    <Card className="p-4 md:p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Ruler className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-lg font-semibold">Print Alignment Test</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Prints a calibration slip. The left and right blank edges must match
            within about 1&nbsp;mm, and the <code>=</code> ruler must reach both
            edges on a single line.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Paper profile</Label>
        <div className="flex flex-wrap gap-2">
          {PAPER_PROFILE_LIST.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={paper === p.id ? 'default' : 'outline'}
              onClick={() => setPaper(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Printable width</span><span className="text-right font-mono">{layout.printableMm} mm · {layout.printableDots} dots</span>
        <span>Content width</span><span className="text-right font-mono">{layout.contentMm} mm · {layout.contentDots} dots</span>
        <span>Characters per line</span><span className="text-right font-mono">{layout.columnsFontA}</span>
        <span>Margins (L / R)</span><span className="text-right font-mono">{layout.leftMm} / {layout.rightMm} mm</span>
        <span>Expected paper gap</span><span className="text-right font-mono">{gaps.leftGapMm} / {gaps.rightGapMm} mm</span>
      </div>

      {unequal && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
          <p className="text-xs">
            This printer's margins are <b>not equal</b> ({leftMm} mm left vs {rightMm} mm right),
            so the slip will print off-centre. The values are coming from{' '}
            <b>{marginSource}</b>.
          </p>
          <Button size="sm" onClick={equaliseNow} disabled={busy}>
            Make margins equal
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs">Side margins (both edges)</Label>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => nudge(-0.5)}>-0.5 mm</Button>
          <span className="font-mono text-sm w-20 text-center">{Math.min(leftMm, rightMm)} mm</span>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => nudge(0.5)}>+0.5 mm</Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => nudge(-99)}>Full width</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          0&nbsp;mm uses everything the head can mark — the paper's own unprintable
          edge (about {((layout.paperMm - layout.printableMm) / 2).toFixed(1)}&nbsp;mm a side on
          this profile) is already the visible margin. Print the slip after each change.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run('raw')} disabled={busy || !rawAvailable}>
          Print via Raw ESC/POS
        </Button>
        <Button variant="outline" onClick={() => run('driver')} disabled={busy}>
          Print via Windows driver
        </Button>
      </div>

      {/* ===== MEASURE, THEN LET THE APP DO THE ARITHMETIC =====
          Finding the pair that squares a slip used to be an evening of print,
          look, adjust, print again — which is how a client arrived at Left 3 /
          Right 5 for their own machine. The measurement has to be theirs; the
          sum does not. Half the difference between the two gaps moves from the
          wide side to the narrow one, and the slip is centred. */}
      <div className="rounded-md border p-3 space-y-3">
        <div>
          <Label className="text-sm">Measured on the printed slip</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Print the slip, measure the blank paper at each edge with a ruler,
            and type both figures. The margins that centre it are worked out
            for you — no trial and error.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {([
            ['Left gap (mm)', measuredLeft, setMeasuredLeft],
            ['Right gap (mm)', measuredRight, setMeasuredRight],
          ] as const).map(([label, value, set]) => (
            <div key={label} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                type="number" min={0} max={40} step={0.5}
                placeholder="0.0"
                value={value}
                onChange={e => set(e.target.value)}
                className="h-9"
              />
            </div>
          ))}
        </div>

        {correction && (
          <div className="space-y-2">
            {Math.abs(correction.widthMismatchMm) > 3 && (
              <p className="text-xs text-status-warning">
                Those two gaps add up to {Math.abs(correction.widthMismatchMm)}&nbsp;mm
                {correction.widthMismatchMm > 0 ? ' more' : ' less'} blank paper than
                this profile expects. That means the slip is printing at the wrong
                <b> width</b>, not just off-centre — check the paper profile above
                and the printer's own paper size first. Moving the margins would
                only hide it.
              </p>
            )}
            {correction.applicable ? (
              <>
                <p className="text-xs">
                  The slip is {Math.abs(correction.offsetMm)}&nbsp;mm too far to the{' '}
                  <b>{correction.offsetMm > 0 ? 'right' : 'left'}</b>. Setting the
                  margins to <b>{correction.leftMm}&nbsp;/&nbsp;{correction.rightMm}&nbsp;mm</b> centres it.
                </p>
                <Button size="sm" onClick={applyCorrection} disabled={busy}>
                  Apply {correction.leftMm} / {correction.rightMm} mm
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Both edges already match within half a millimetre — this slip is
                centred. Nothing to change.
              </p>
            )}
          </div>
        )}
      </div>
      {!rawAvailable && (
        <p className="text-xs text-muted-foreground">
          Raw ESC/POS printing is available in the desktop app on Windows.
        </p>
      )}

      {/* Hidden portal — the driver path prints this node. */}
      {createPortal(
        <div className="receipt-print-portal" aria-hidden="true" ref={portalRef}>
          <div
            className="print-receipt"
            data-paper-size={paper}
            style={{
              fontFamily: "'Lucida Console','Consolas','Courier New',monospace",
              fontWeight: 700,
              color: '#000',
              background: '#fff',
              whiteSpace: 'pre',
              fontSize: `${alignmentFontPx({ paper, leftMm, rightMm, contentWidthMm })}px`,
              lineHeight: 1.25,
            }}
          >
            {lines.join('\n')}
          </div>
        </div>,
        document.body,
      )}
    </Card>
  );
}
