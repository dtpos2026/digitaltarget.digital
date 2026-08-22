// ============================================================
// LEGACY shim — kept for backward compatibility.
// All real logic now lives in src/printing/*.
// New code should import from '@/printing' directly.
//
// The previous implementation forced a minimum page height
// (paperWidth + 5mm) which printed ~85mm of blank paper after
// short receipts on Electron. That logic has been removed.
// ============================================================
import type { RestaurantSettings } from './types';
import { buildPrintCss as buildCss, injectPrintCss, paperWidthToMicrons, paperWidthToMm } from '@/printing';
import type { PaperSize } from '@/printing';
import { loadPrintMargins } from '@/lib/printMargins';

// ============================================================
// v1.5.0 — TOP-FEED / MARGIN GUARDRAIL
//
// Reported: "top margin bohot zyada feed kar raha hai" — a receipt with a
// huge blank gap before the first line. Root cause: nothing in the print
// pipeline ever capped how large a top-margin/top-feed value could be.
// The old clamp allowed up to 30mm (over an inch), the per-printer
// "Top Feed (mm)" field in Printer Settings had NO limit at all, and two
// different screens enforced two different maximums (6mm vs 30mm) — so a
// single typo (e.g. "30" instead of "3") silently produced exactly this.
//
// MAX_TOP_MARGIN_MM is now the ONE ceiling every top-margin/top-feed value
// in the app is clamped to, and out-of-range values already saved on a
// device are corrected the next time they're read (self-healing) — the
// restaurant does not have to find and fix the setting themselves.
// ============================================================
export const MAX_TOP_MARGIN_MM = 10;

function safeMm(value: unknown, fallback: number, max = 20) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(max, value))
    : fallback;
}

/** Clamp any top-margin/top-feed number to the shared safe ceiling. */
export function clampTopMarginMm(value: unknown, fallback = 0): number {
  return safeMm(value, fallback, MAX_TOP_MARGIN_MM);
}

export function getThermalPaperWidthMicrons(paperWidth: RestaurantSettings['paperSize']) {
  return paperWidthToMicrons((paperWidth || '80mm') as PaperSize);
}

export function getPaperWidthMm(paperWidth: RestaurantSettings['paperSize']) {
  return paperWidthToMm((paperWidth || '80mm') as PaperSize);
}

export function getEffectiveReceiptMargins(settings: RestaurantSettings) {
  const deviceMargins = loadPrintMargins();
  return {
    // Top margin uses the tight shared ceiling — this is the value that
    // caused the reported "too much blank paper before the receipt" bug.
    top: clampTopMarginMm(deviceMargins.top ?? settings.receiptMarginTop, 0),
    bottom: safeMm(deviceMargins.bottom ?? settings.receiptMarginBottom, 0, 30),
    left: safeMm(deviceMargins.left ?? settings.receiptMarginLeft, 4, 30),
    right: safeMm(deviceMargins.right ?? settings.receiptMarginRight, 4, 30),
  };
}

// ============================================================
// Blank-Receipt Fix v1.2.3 — exact content-height measurement.
//
// Why: Electron's silent print previously went out with either a forced
// 500mm page (long blank feed / driver scale-to-fit -> BLANK output on
// several thermal drivers) or no height at all. Measuring the rendered
// receipt and sending its exact height means the printer feeds precisely
// as much paper as the content needs.
//
// Measurement must run while the thermal-print DOM session is active
// (portal visible at real mm width) and AFTER fonts/images have loaded.
// ============================================================
const PX_PER_MM = 96 / 25.4; // CSS px per mm (96 DPI CSS)
const HEIGHT_BUFFER_MM = 4;  // safety so descenders/borders never clip
const MIN_HEIGHT_MM = 25;
const MAX_HEIGHT_MM = 1500;

function findReceiptEl(rootEl: HTMLElement | null): HTMLElement | null {
  if (!rootEl) return null;
  if (rootEl.classList?.contains('print-receipt')) return rootEl;
  return (rootEl.querySelector?.('.print-receipt') as HTMLElement | null)
    || (rootEl.closest?.('.print-receipt') as HTMLElement | null)
    || rootEl;
}

export function measureThermalContentHeightMm(rootEl: HTMLElement | null, _settings: RestaurantSettings, min = MIN_HEIGHT_MM): number | undefined {
  try {
    const el = findReceiptEl(rootEl);
    if (!el) return undefined;
    // scrollHeight includes padding (print margins are applied as padding)
    const px = Math.max(el.scrollHeight || 0, el.offsetHeight || 0, Math.ceil(el.getBoundingClientRect().height || 0));
    if (!px || !Number.isFinite(px)) return undefined;
    const mm = px / PX_PER_MM + HEIGHT_BUFFER_MM;
    if (mm <= 1) return undefined;
    return Math.max(min, Math.min(MAX_HEIGHT_MM, Math.ceil(mm)));
  } catch {
    return undefined;
  }
}

export function getThermalPrintJobHeightMm(rootEl: HTMLElement | null, settings: RestaurantSettings): number | undefined {
  return measureThermalContentHeightMm(rootEl, settings);
}

/**
 * Wait until the receipt is actually paintable: web fonts (incl. the large
 * Urdu Nastaleeq fonts) loaded + every <img> inside the receipt decoded.
 * Races against a timeout so a broken logo URL can never hang printing.
 */
export function waitForPrintAssets(rootEl: HTMLElement | null, timeoutMs = 1500): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const tasks: Promise<unknown>[] = [];
  try {
    const fonts: any = (document as any).fonts;
    if (fonts?.ready) tasks.push(Promise.resolve(fonts.ready).catch(() => {}));
  } catch {}
  try {
    const scope = findReceiptEl(rootEl) || document.body;
    const imgs = Array.from(scope.querySelectorAll('img')) as HTMLImageElement[];
    for (const img of imgs) {
      if (img.complete && img.naturalWidth > 0) continue;
      tasks.push(new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        // decode() resolves after the image is ready to paint
        try { (img as any).decode?.().then(done).catch(() => {}); } catch {}
      }));
    }
  } catch {}
  if (tasks.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(tasks).then(() => undefined),
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Blank-content guard — never send an empty slip to the printer. */
export function hasPrintableContent(rootEl: HTMLElement | null): boolean {
  try {
    const el = findReceiptEl(rootEl);
    if (!el) return false;
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, '');
    return text.length >= 5;
  } catch {
    return true; // never block printing on a guard failure
  }
}

export function shouldUsePrinterDefaultPageSize(_settings: RestaurantSettings) {
  // Always true — dynamic height is the rule.
  return true;
}

export function prepareThermalPrintSession(rootEl: HTMLElement | null, compact: boolean = false) {
  if (typeof document === 'undefined') return () => {};
  const body = document.body;
  const portal = rootEl?.closest('.receipt-print-portal') as HTMLElement | null;
  body.classList.add('thermal-printing');
  if (compact) body.classList.add('thermal-compact');
  body.dataset.printActive = 'true';
  if (portal) portal.dataset.activePrint = 'true';
  return () => {
    body.classList.remove('thermal-printing');
    body.classList.remove('thermal-compact');
    delete body.dataset.printActive;
    if (portal) delete portal.dataset.activePrint;
  };
}

function applyPrintMarginVariables(rootEl: HTMLElement | null, settings?: RestaurantSettings) {
  if (!rootEl || !settings) return;
  const margins = getEffectiveReceiptMargins(settings);
  rootEl.style.setProperty('--dt-print-padding-top', `${margins.top}mm`);
  rootEl.style.setProperty('--dt-print-padding-bottom', `${margins.bottom}mm`);
  rootEl.style.setProperty('--dt-print-padding-left', `${margins.left}mm`);
  rootEl.style.setProperty('--dt-print-padding-right', `${margins.right}mm`);
  // Compact mode tuning (user-set from Settings)
  const s = settings as any;
  const fs = typeof s.receiptCompactFontSize === 'number' ? Math.max(8, Math.min(16, s.receiptCompactFontSize)) : 11;
  const lh = typeof s.receiptCompactLineHeight === 'number' ? Math.max(1, Math.min(2, s.receiptCompactLineHeight)) : 1.15;
  rootEl.style.setProperty('--dt-compact-font-size', `${fs}px`);
  rootEl.style.setProperty('--dt-compact-line-height', `${lh}`);
}

export function beginThermalPrintDomSession(
  rootEl: HTMLElement | null,
  paperWidth: NonNullable<RestaurantSettings['paperSize']>,
  _heightMm?: number,
  settings?: RestaurantSettings,
) {
  applyPrintMarginVariables(rootEl, settings);
  const compact = !!(settings as any)?.receiptCompactMode || (settings as any)?.receiptDesign === 'compact-thermal';
  const shrinkLogo = compact && (settings as any)?.receiptCompactPreserveLogo === false;
  if (typeof document !== 'undefined') {
    if (shrinkLogo) document.body.classList.add('thermal-compact-shrink-logo');
    else document.body.classList.remove('thermal-compact-shrink-logo');
  }
  const removeStyle = injectPrintCss(paperWidth as PaperSize, compact);
  const cleanupSession = prepareThermalPrintSession(rootEl, compact);
  // ===== v1.2.4 WHITE-SCREEN FIX =====
  // If ANY print path throws between session start and cleanup (IPC error,
  // component unmount, crashed dialog), the thermal-print CSS used to stay
  // applied — hiding the whole app behind a white screen until restart, and
  // losing unsynced work. Cleanup is now (a) idempotent, and (b) backed by a
  // 30s watchdog that force-restores the UI even if no one calls cleanup.
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    try { cleanupSession(); } catch {}
    try { removeStyle(); } catch {}
    if (typeof document !== 'undefined') {
      document.body.classList.remove('thermal-compact-shrink-logo');
      // belt-and-braces: make sure no print-session markers survive
      document.body.classList.remove('thermal-printing');
      delete (document.body as any).dataset?.printActive;
      try { document.body.removeAttribute('data-print-active'); } catch {}
    }
  };
  let watchdog: ReturnType<typeof setTimeout> | null =
    typeof window !== 'undefined'
      ? setTimeout(() => {
          watchdog = null;
          if (!done) {
            console.warn('[DT-Print] print session watchdog fired — force-restoring UI');
            cleanup();
          }
        }, 30000)
      : null;
  return cleanup;
}

export function waitForThermalPrintLayout() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function buildThermalPrintCss(paperWidth: NonNullable<RestaurantSettings['paperSize']>, _heightMm?: number, compact: boolean = false) {
  return buildCss(paperWidth as PaperSize, compact);
}
