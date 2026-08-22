// ============================================================
// Print Service — single entry point for all receipt printing.
// Renders DOM -> injects strict CSS -> waits render delay ->
// prints (Electron silent or browser) -> cleans up.
//
// Rules enforced:
//  - No pre-feed / form-feed characters injected (Rule 9, 10)
//  - 500–1000ms render delay (Rule 11)
//  - Browser and Electron use the SAME CSS + DOM (Rule 13)
// ============================================================
import { PRINT_CONFIG, type PaperSize } from './printConfig';
import { injectPrintCss } from './printCss';
import { electronPrintReceipt, isElectronPrintAvailable } from './electronPrint';

function waitFrames(n = 2) {
  return new Promise<void>((resolve) => {
    let i = 0;
    const tick = () => {
      i += 1;
      if (i >= n) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait for web fonts + every <img> inside the portal, capped by a timeout. */
function waitForAssets(scope: HTMLElement, timeoutMs = 1500): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  try {
    const fonts: any = (document as any).fonts;
    if (fonts?.ready) tasks.push(Promise.resolve(fonts.ready).catch(() => {}));
  } catch {}
  try {
    const imgs = Array.from(scope.querySelectorAll('img')) as HTMLImageElement[];
    for (const img of imgs) {
      if (img.complete && img.naturalWidth > 0) continue;
      tasks.push(new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
        try { (img as any).decode?.().then(() => resolve()).catch(() => {}); } catch {}
      }));
    }
  } catch {}
  if (!tasks.length) return Promise.resolve();
  return Promise.race([
    Promise.all(tasks).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Content height in microns (96 CSS px/inch), with a small safety buffer. */
function measureHeightMicrons(portalEl: HTMLElement): number | undefined {
  try {
    const el = (portalEl.querySelector('.print-receipt') as HTMLElement | null) || portalEl;
    const px = Math.max(el.scrollHeight || 0, el.offsetHeight || 0);
    if (!px || !Number.isFinite(px)) return undefined;
    const mm = px * 25.4 / 96 + 4; // +4mm buffer
    if (mm <= 1) return undefined;
    return Math.round(Math.max(25, Math.min(1500, mm)) * 1000);
  } catch {
    return undefined;
  }
}

interface PrintNodeOpts {
  paperWidth?: PaperSize;
  printerName?: string;
  silent?: boolean;          // force Electron silent path
  copies?: number;
  /** When false, just opens browser print dialog even if Electron is available. */
  preferElectron?: boolean;
}

/**
 * Print a hidden DOM portal containing the receipt.
 * The portal element MUST have class `receipt-print-portal`. This service
 * toggles `data-active-print="true"` on it and `thermal-printing` on body.
 */
export async function printNode(portalEl: HTMLElement, opts: PrintNodeOpts = {}): Promise<{ success: boolean; error?: string }> {
  if (!portalEl) return { success: false, error: 'no portal element' };

  const paperWidth = opts.paperWidth || '80mm';

  // Mark active
  portalEl.setAttribute('data-active-print', 'true');
  document.body.classList.add('thermal-printing');
  document.body.dataset.printActive = 'true';

  const removeStyle = injectPrintCss(paperWidth);

  const cleanup = () => {
    removeStyle();
    portalEl.removeAttribute('data-active-print');
    document.body.classList.remove('thermal-printing');
    delete document.body.dataset.printActive;
  };

  try {
    // Wait for layout to settle, then a render delay (Phase-1: separate for Electron/Browser)
    await waitFrames(2);
    // Blank-Receipt Fix: fonts (incl. Urdu Nastaleeq) and images must be
    // paintable before rasterizing, otherwise short/blank pages go out.
    await waitForAssets(portalEl);
    await waitFrames(2);
    const useElectron = opts.preferElectron !== false && (opts.silent ?? true) && isElectronPrintAvailable();
    const delay = useElectron
      ? Math.max(100, Math.min(500, PRINT_CONFIG.electronRenderDelayMs))
      : Math.max(300, Math.min(1000, PRINT_CONFIG.browserRenderDelayMs));
    await sleep(delay);

    if (useElectron) {
      // Measure the rendered receipt so the printer feeds exactly the content
      // length (no blank paper after, no clipping). Falls back to printer
      // default page size when measurement is unavailable.
      const heightMicrons = measureHeightMicrons(portalEl);
      const res = await electronPrintReceipt({
        printerName: opts.printerName,
        paperWidth,
        copies: opts.copies,
        pageHeightMicrons: heightMicrons,
      });
      if (!res.success) {
        // Fallback to browser print
        await browserPrint();
      }
      return res;
    }

    await browserPrint();
    return { success: true };
  } finally {
    // small delay before cleanup so print dialog can capture DOM
    setTimeout(cleanup, 300);
  }
}

function browserPrint(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('afterprint', done);
      resolve();
    };
    window.addEventListener('afterprint', done, { once: true });
    try {
      window.print();
    } catch {
      resolve();
    }
    // safety fallback (some browsers don't fire afterprint)
    setTimeout(done, 4000);
  });
}
