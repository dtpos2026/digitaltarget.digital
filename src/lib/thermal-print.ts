// ============================================================
// LEGACY shim — kept for backward compatibility.
// All real logic now lives in the src/printing folder.
// New code should import from '@/printing' directly.
//
// The previous implementation forced a minimum page height
// (paperWidth + 5mm) which printed ~85mm of blank paper after
// short receipts on Electron. That logic has been removed.
// ============================================================
import type { RestaurantSettings } from './types';
import { buildPrintCss as buildCss, injectPrintCss, paperWidthToMicrons, paperWidthToMm } from '@/printing';
import type { PaperSize } from '@/printing';
import { loadPrintMargins, hasDevicePrintMargins, DEFAULT_MARGINS } from '@/lib/printMargins';

function safeMm(value: unknown, fallback: number, max = 100) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-max, Math.min(max, value))
    : fallback;
}

function positiveMm(value: number) { return Math.max(0, value); }
function offsetMm(value: number) { return Math.min(0, value); }

export function getThermalPaperWidthMicrons(paperWidth: RestaurantSettings['paperSize']) {
  return paperWidthToMicrons((paperWidth || '80mm') as PaperSize);
}

export function getPaperWidthMm(paperWidth: RestaurantSettings['paperSize']) {
  return paperWidthToMm((paperWidth || '80mm') as PaperSize);
}

export function getEffectiveReceiptMargins(settings: RestaurantSettings) {
  // AUTO when this device has set no margins of its own, MANUAL when it has (cloud app, v1.57.0). The device value
  // used to be read with `??`, but loadPrintMargins() always returns numbers, so the preset on the right-hand side was
  // never reached and none of the Compact / Standard / Bold presets ever touched the paper. A device that HAS been
  // tuned keeps winning, including when tuned to 0: "0 mm" is a decision, not a missing value.
  const manual = hasDevicePrintMargins();
  const deviceMargins = loadPrintMargins();
  const pick = (device: number, fromSettings: unknown, fallback: number) =>
    manual ? safeMm(device, fallback, 100) : safeMm(fromSettings, fallback, 100);
  // A positive top margin has one ceiling (the cloud app's guard): a single typo — "30" for "3" — once ejected a blank
  // strip of paper before every receipt. A NEGATIVE top (the v1.21.0 offset that pulls the slip up) is untouched.
  const topRaw = manual ? deviceMargins.top : settings.receiptMarginTop;
  const top = safeMm(topRaw, 0, 100);
  return {
    top: top > 0 ? Math.min(MAX_TOP_MARGIN_MM, top) : top,
    bottom: pick(deviceMargins.bottom, settings.receiptMarginBottom, 0),
    left: pick(deviceMargins.left, settings.receiptMarginLeft, DEFAULT_MARGINS.left),
    right: pick(deviceMargins.right, settings.receiptMarginRight, DEFAULT_MARGINS.right),
  };
}

/** No longer used to fix a page height — kept returning undefined so
 *  callers fall back to `usePrinterDefaultPageSize: true` (auto height). */
export function getThermalPrintJobHeightMm(rootEl: HTMLElement | null, _settings: RestaurantSettings): number | undefined {
  // OLD-POS PORT: measure the content's actual height and send it as the
  // page height — this makes the print start from the top and avoids extra
  // blank feed after the receipt (the page is exactly as long as the
  // content). Formula from the old software: px @96dpi → mm, +2mm safety, min 20mm.
  // Callers hand over either the receipt or the portal that wraps it; measure the receipt itself (cloud app's
  // findReceiptEl, below) so the wrapper's own box never stands in for the slip.
  const el = findReceiptEl(rootEl);
  if (!el || typeof el.getBoundingClientRect !== 'function') return undefined;
  try {
    const rect = el.getBoundingClientRect();
    const px = Math.max(rect?.height || 0, el.scrollHeight || 0);
    if (!px || px < 4) return undefined;
    // +4mm slack — fonts/logo may grow slightly in the final render;
    // the page being a few mm larger is fine, smaller means page-2 spill.
    // The ceiling is the cloud app's guard (not in v1.21.0): a runaway measurement must never become a page size of
    // many metres. No real slip comes near it.
    return Math.min(1500, Math.max(20, Math.ceil((px / 96) * 25.4) + 4));
  } catch { return undefined; }
}

export function measureThermalContentHeightMm(rootEl: HTMLElement | null, settings: RestaurantSettings, min = 18): number | undefined {
  const h = getThermalPrintJobHeightMm(rootEl, settings);
  return h == null ? undefined : Math.max(min, h);
}

export function shouldUsePrinterDefaultPageSize(_settings: RestaurantSettings) {
  // OLD-POS PORT: always FALSE — an explicit pageSize (width + measured height)
  // is sent for every print. Relying on the driver-default page was the root
  // cause of top-offset, uneven margins, and extra blank feed.
  return false;
}

/**
 * Longest a slip may legitimately hold the POS in print mode. While
 * `thermal-printing` is on the body the print CSS hides the whole POS UI, so
 * if a cleanup is ever missed the cashier is left staring at a white screen
 * with a slip in the corner and has to restart the app. Every session now
 * carries its own watchdog as a last line of defence — cleanup is still done
 * properly by the callers' `finally` blocks, this only catches the
 * impossible case.
 */
const PRINT_SESSION_WATCHDOG_MS = 15000;

/** Force the POS out of print mode, whatever left it there. */
export function forceExitThermalPrintMode() {
  if (typeof document === 'undefined') return;
  const body = document.body;
  body.classList.remove('thermal-printing');
  body.classList.remove('thermal-compact');
  body.classList.remove('thermal-compact-shrink-logo');
  delete body.dataset.printActive;
  document.querySelectorAll('.receipt-print-portal[data-active-print]')
    .forEach(el => el.removeAttribute('data-active-print'));
}

export function prepareThermalPrintSession(rootEl: HTMLElement | null, compact: boolean = false) {
  if (typeof document === 'undefined') return () => {};
  const body = document.body;
  const portal = rootEl?.closest('.receipt-print-portal') as HTMLElement | null;
  body.classList.add('thermal-printing');
  if (compact) body.classList.add('thermal-compact');
  body.dataset.printActive = 'true';
  if (portal) portal.dataset.activePrint = 'true';

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    body.classList.remove('thermal-printing');
    body.classList.remove('thermal-compact');
    delete body.dataset.printActive;
    if (portal) delete portal.dataset.activePrint;
  };
  const watchdog = setTimeout(() => {
    if (done) return;
    console.warn('[DT-Print] print session watchdog fired — restoring the POS screen');
    cleanup();
    forceExitThermalPrintMode();
  }, PRINT_SESSION_WATCHDOG_MS);

  return cleanup;
}

function applyPrintMarginVariables(rootEl: HTMLElement | null, settings?: RestaurantSettings) {
  if (!rootEl || !settings) return;
  const margins = getEffectiveReceiptMargins(settings);
  rootEl.style.setProperty('--dt-print-padding-top', `${positiveMm(margins.top)}mm`);
  rootEl.style.setProperty('--dt-print-padding-bottom', `${positiveMm(margins.bottom)}mm`);
  rootEl.style.setProperty('--dt-print-padding-left', `${positiveMm(margins.left)}mm`);
  rootEl.style.setProperty('--dt-print-padding-right', `${positiveMm(margins.right)}mm`);
  rootEl.style.setProperty('--dt-print-offset-top', `${offsetMm(margins.top)}mm`);
  rootEl.style.setProperty('--dt-print-offset-left', `${offsetMm(margins.left)}mm`);
  rootEl.style.setProperty('--dt-print-offset-right', `${offsetMm(margins.right)}mm`);
  rootEl.style.setProperty('--dt-print-offset-bottom', `${offsetMm(margins.bottom)}mm`);
  // Compact mode tuning (user-set from Settings)
  const s = settings as any;
  const fs = typeof s.receiptCompactFontSize === 'number' ? Math.max(10, Math.min(16, s.receiptCompactFontSize)) : 12;
  const lh = typeof s.receiptCompactLineHeight === 'number' ? Math.max(1, Math.min(2, s.receiptCompactLineHeight)) : 1.12;
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
  return () => {
    cleanupSession();
    removeStyle();
    if (typeof document !== 'undefined') document.body.classList.remove('thermal-compact-shrink-logo');
  };
}

/**
 * Wait until the receipt is actually laid out and painted.
 *
 * Callers used to follow this with a flat `await sleep(150)` because a
 * freshly injected print stylesheet could still be settling and the printer
 * would capture a blank page. A fixed sleep is both too slow on a healthy
 * machine and too short on a loaded one, so it now waits for the things that
 * really matter: two animation frames (style + layout), webfonts (the usual
 * cause of a late reflow on a thermal slip), then one more frame to paint.
 * On a warm cache this returns in well under a frame's time.
 */
export function waitForThermalPrintLayout(): Promise<void> {
  const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
  const fonts = (): Promise<void> => {
    const f: any = typeof document !== 'undefined' ? (document as any).fonts : null;
    if (!f?.ready) return Promise.resolve();
    // Never let a stuck font loader hold a print job.
    return Promise.race([
      f.ready.then(() => undefined),
      new Promise<void>(r => setTimeout(r, 250)),
    ]);
  };
  return frame().then(frame).then(fonts).then(frame);
}

export function buildThermalPrintCss(paperWidth: NonNullable<RestaurantSettings['paperSize']>, _heightMm?: number, compact: boolean = false) {
  return buildCss(paperWidth as PaperSize, compact);
}

// ============================================================
// Kept from the cloud app's own thermal-print.ts (not in v1.21.0): the blank-content guard, the asset wait that the
// token slip uses, and the one ceiling for a top margin — a single typo ("30" for "3") once ejected a blank strip
// of paper before every receipt, so the Settings screen clamps what a person types. The engine's own margin maths
// above is v1.21.0's, unchanged.
// ============================================================
export const MAX_TOP_MARGIN_MM = 10;

/** Clamp any top-margin / top-feed number typed by a person to the shared safe ceiling. */
export function clampTopMarginMm(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_TOP_MARGIN_MM, value))
    : fallback;
}

function findReceiptEl(rootEl: HTMLElement | null): HTMLElement | null {
  if (!rootEl) return null;
  if (rootEl.classList?.contains('print-receipt')) return rootEl;
  return (rootEl.querySelector?.('.print-receipt') as HTMLElement | null)
    || (rootEl.closest?.('.print-receipt') as HTMLElement | null)
    || rootEl;
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

