// ============================================================
// Device-local print margins (mm). User can set from 0 mm upward.
// Writes CSS variables consumed by src/printing/printCss.ts:
//   --dt-print-padding-top / -right / -bottom / -left
// Saved in localStorage per device (not synced) so each machine
// can tune to its own printer.
// ============================================================

export interface PrintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const KEY = 'dtpos-print-margins';
export const DEFAULT_MARGINS: PrintMargins = { top: 0, right: 4, bottom: 0, left: 4 };

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 30) return 30;
  return Math.round(n * 10) / 10;
}

/**
 * v1.57.0 — has THIS device been given its own margins?
 *
 * REPORTED: "left right margin printer ke hisab se adjust ho sake, auto aur
 * manually bhi."
 *
 * Manual already worked. Auto never did, and this is why: loadPrintMargins()
 * always returns concrete numbers — DEFAULT_MARGINS when nothing is saved —
 * and getEffectiveReceiptMargins() then did
 *
 *     deviceMargins.left ?? settings.receiptMarginLeft
 *
 * `??` only falls through on null/undefined, and the left value is always a
 * number, so settings.receiptMarginLeft was NEVER read. The Compact /
 * Standard / Bold presets each set margins and not one of them ever reached
 * the paper.
 *
 * Asking whether the device has its own saved value is what separates the two
 * cases: no saved value means "follow the preset" (auto), a saved value means
 * "this printer needs its own" (manual), and a manual 0 stays 0 rather than
 * being mistaken for "unset".
 */
export function hasDevicePrintMargins(): boolean {
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
}

export function loadPrintMargins(): PrintMargins {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_MARGINS };
    const p = JSON.parse(raw);
    return {
      top: clamp(p.top ?? DEFAULT_MARGINS.top),
      right: clamp(p.right ?? DEFAULT_MARGINS.right),
      bottom: clamp(p.bottom ?? DEFAULT_MARGINS.bottom),
      left: clamp(p.left ?? DEFAULT_MARGINS.left),
    };
  } catch {
    return { ...DEFAULT_MARGINS };
  }
}

export function savePrintMargins(m: PrintMargins) {
  const safe: PrintMargins = {
    top: clamp(m.top),
    right: clamp(m.right),
    bottom: clamp(m.bottom),
    left: clamp(m.left),
  };
  try { localStorage.setItem(KEY, JSON.stringify(safe)); } catch {}
  applyPrintMargins(safe);
  try { window.dispatchEvent(new CustomEvent('dtpos-print-margins-changed', { detail: safe })); } catch {}
}

export function applyPrintMargins(m: PrintMargins = loadPrintMargins()) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--dt-print-padding-top', `${m.top}mm`);
  r.setProperty('--dt-print-padding-right', `${m.right}mm`);
  r.setProperty('--dt-print-padding-bottom', `${m.bottom}mm`);
  r.setProperty('--dt-print-padding-left', `${m.left}mm`);
}

/**
 * Hand this device back to the receipt preset (AUTO).
 *
 * v1.57.0 — this used to SAVE the defaults, which left the key in place. With
 * margins now meaning "device has its own" when the key exists, saving would
 * have made auto unreachable: once a device had ever been tuned it could
 * never follow a preset again. Removing the key is what "reset" always meant.
 */
export function resetPrintMargins() {
  try { localStorage.removeItem(KEY); } catch { /* private mode — nothing saved anyway */ }
  const back = loadPrintMargins();
  applyPrintMargins(back);
  try { window.dispatchEvent(new CustomEvent('dtpos-print-margins-changed', { detail: back })); } catch {}
}
