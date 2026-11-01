// ============================================================
// PRINTER TEST SLIP — printed by the SAME route the bills take.
//
// Printer Center's Test Print used to go through the Windows driver (the POS
// window's own print), while bills, KOTs and tokens go through the rendered
// image sent as one RAW job. So a printer could pass the test and still
// print every bill blank — the test never exercised the route that failed.
// That is how a Black Copper that prints blank bills could look "OK".
//
// Now the test uses the printer's own Print Mode (and the shop's Fast
// Billing switch), exactly as a bill would. When the paper comes out blank,
// the shop presses "Came out blank" and the printer moves to the next mode:
//   Automatic (image → RAW)  →  Windows driver  →  Raw ESC/POS text
// A physical test decides, not a guess.
// ============================================================
import { printNode } from '@/printing';
import { resolvePrintMode, type ResolvedPrintMode } from '@/printing/printMode';
import { resolveSlipMargin } from '@/lib/slipMargins';
import type { PrinterConfig } from '@/lib/printerSettings';

export type TestMode = ResolvedPrintMode; // 'auto' | 'driver' | 'raw'

export const TEST_MODE_LABEL: Record<TestMode, string> = {
  auto: 'Automatic (image sent as RAW)',
  driver: 'Windows driver',
  raw: 'Raw ESC/POS text',
};

/** The order a blank printer is moved through. */
const BLANK_ORDER: TestMode[] = ['auto', 'driver', 'raw'];

/** The mode to try after a test came out blank, or null when all were tried. */
export function nextModeAfterBlank(mode: TestMode): TestMode | null {
  const i = BLANK_ORDER.indexOf(mode);
  return i >= 0 && i < BLANK_ORDER.length - 1 ? BLANK_ORDER[i + 1] : null;
}

/** The mode a bill on this printer would use right now. */
export function testModeFor(p: Pick<PrinterConfig, 'printMode' | 'escposMode'>, settings?: { fastRawPrintMode?: boolean } | null): TestMode {
  return resolvePrintMode({ printerConfig: p, settings });
}

export interface TestSlipResult {
  success: boolean;
  error?: string;
  mode: TestMode;
  /** What actually printed it, in words ("image sent as RAW", "Windows driver"…). */
  route: string;
}

function lines(p: PrinterConfig, mode: TestMode): string[] {
  return [
    '*** DT POS TEST ***',
    p.name || 'Printer',
    p.printerName || '',
    `Mode: ${TEST_MODE_LABEL[mode]}`,
    new Date().toLocaleString('en-GB'),
    '------------------------------',
    '1 x Test Item',
    '1 x Sample Product',
    '------------------------------',
    'If you can read this,',
    'this mode works on this printer.',
  ];
}

/** Print the test slip on `p` using `mode` — the route a bill would take. */
export async function printTestSlip(p: PrinterConfig, mode: TestMode): Promise<TestSlipResult> {
  const api: any = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  const margin = resolveSlipMargin('receipt', p.leftMarginMm, p.rightMarginMm);

  if (mode === 'raw') {
    if (!api?.printRaw) return { success: false, mode, route: TEST_MODE_LABEL.raw, error: 'Raw printing needs the Windows app.' };
    const { EscposDoc } = await import('@/printing/escposBuilder');
    const d = new EscposDoc(p.paperSize || '80mm', { leftMm: margin.left, rightMm: margin.right, contentWidthMm: p.printWidthMm });
    d.center().bold(true);
    for (const [i, l] of lines(p, mode).entries()) {
      if (i === 1) d.bold(false);
      if (l.startsWith('---')) d.rule('-'); else d.fit(l);
    }
    if (p.autoCut === false) d.feed(3); else d.cut();
    const res = await api.printRaw({ printerName: p.printerName, data: d.bytes(), copies: 1 });
    return { success: !!res?.success, error: res?.error, mode, route: TEST_MODE_LABEL.raw };
  }

  // Rendered slip through printNode — the bill's own route. In 'driver'
  // mode the image stage is skipped, exactly as for a bill.
  const portal = document.createElement('div');
  portal.className = 'receipt-print-portal';
  portal.setAttribute('aria-hidden', 'true');
  portal.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;';
  const inner = document.createElement('div');
  inner.className = 'print-receipt bg-white text-black';
  inner.setAttribute('data-paper-size', p.paperSize || '80mm');
  inner.style.cssText = `width:${p.paperSize || '80mm'};background:#fff;color:#000;font-family:Arial,sans-serif;font-size:13px;font-weight:700;line-height:1.35;text-align:center;`;
  inner.innerHTML = lines(p, mode)
    .map((l, i) => l.startsWith('---')
      ? '<div style="border-top:1px dashed #000;margin:4px 0"></div>'
      : `<div style="${i === 0 ? 'font-size:15px;font-weight:900;' : ''}">${l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</div>`)
    .join('');
  portal.appendChild(inner);
  document.body.appendChild(portal);
  try {
    const res = await printNode(portal, {
      paperWidth: p.paperSize || '80mm',
      printerName: p.printerName,
      silent: true,
      copies: 1,
      printMode: mode === 'driver' ? 'driver' : undefined,
      marginLeftMm: margin.left,
      marginRightMm: margin.right,
      contentWidthMm: p.printWidthMm,
      autoCut: p.autoCut !== false,
      logType: 'test',
    });
    const attempt = String(res?.attempts?.[0] || '');
    const refused = /image route: (.+)\)$/.exec(attempt)?.[1];
    const route = attempt.startsWith('fast-window:raster') ? 'image sent as RAW'
      : attempt.startsWith('fast-window:driver') ? `Windows driver${refused ? ` (image route refused: ${refused})` : ''}`
      : res?.success ? 'Windows print' : TEST_MODE_LABEL[mode];
    return { success: !!res?.success, error: res?.success ? undefined : ((res as any)?.message || res?.error), mode, route };
  } catch (e: any) {
    return { success: false, error: e?.message || String(e), mode, route: TEST_MODE_LABEL[mode] };
  } finally {
    setTimeout(() => { try { portal.remove(); } catch { /* already gone */ } }, 800);
  }
}
