// ============================================================
// Device-local print margins (mm). User can set from 0 mm upward.
// Writes CSS variables consumed by src/printing/printCss.ts:
//   --dt-print-padding-top / -right / -bottom / -left
// Saved in localStorage per device (not synced) so each machine
// can tune to its own printer.
// ============================================================

import { safeMarginMmOf } from '@/printing/paperProfile';

export interface PrintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Optional printable content width (mm). 0 = auto (use full paper width).
   *  Typical values: 48 (58mm paper), 68 (80mm paper), tune per printer. */
  contentWidthMm?: number;
}

const KEY = 'dtpos-print-margins';
/**
 * The safe inset the 80mm profile calculates, on both sides.
 *
 * These margins are device-level and the device does not know which roll is
 * loaded, so the standard 80mm head is the reference; a printer configured
 * for another paper carries its own margins in Printer Settings and those win.
 *
 * Why not zero. An earlier build defaulted both sides to 0 on the reasoning
 * that the head's own ~4mm unmarkable edge already IS the margin. On a
 * perfectly loaded roll that holds. On a hand-loaded one it does not: the
 * first markable column lands at or past the paper's edge and the left side
 * of every RAW slip prints clipped — reported from the shop floor as "RAW
 * print ka left side cut ho raha hai". The inset comes from the paper
 * profile so it tracks the head rather than being a number typed in here.
 */
const SAFE_SIDE_MM = safeMarginMmOf('80mm');

export const DEFAULT_MARGINS: PrintMargins = {
  top: 0,
  right: SAFE_SIDE_MM,
  bottom: 0,
  left: SAFE_SIDE_MM,
  contentWidthMm: 0,
};
// ============================================================
// ONE-TIME GEOMETRY MIGRATION
//
// v2 reset calibration values that created a top gap and a long blank tail.
// v3 moved to equal 2mm defaults.
//
// v4 exists because v3 did not actually reach the machines that needed it.
// The flag is written on FIRST RUN of any build that carries it, so a client
// already running a v3 build had the flag set with whatever asymmetric values
// were in storage at the time. The migration then never ran again, and every
// later release inherited those numbers.
//
// That is why the equal-margin work still printed lopsided on real paper:
// the printer-config default was corrected, but `loadPrintMargins()` kept
// handing out the stale device values — and it feeds the receipt, the KOT,
// the token and the shift report alike, which is exactly the "it is on every
// slip" report. Physical paper was right and the code was wrong.
//
// Only the device's print margins are touched; no shop or sales data.
// ============================================================
const GEOM_FLAG = 'dtpos-print-geometry-v5';
// Flags from superseded migrations. They are cleared so that a machine which
// later downgrades and upgrades again is migrated rather than skipped.
const SUPERSEDED_FLAGS = ['dtpos-print-geometry-v2', 'dtpos-print-geometry-v3', 'dtpos-print-geometry-v4'];

// ============================================================
// SAFE-INSET TOP-UP (v6)
//
// v5 set both side margins to 0 on every machine it reached. That removed the
// lopsided band, and it also removed the only thing standing between the
// first character and the edge of the paper — which is how the left-clipping
// report arrived. v6 raises a side margin back to the profile's safe inset
// ONLY where it is currently zero.
//
// The "only where zero" part is the whole point. A shop that calibrated its
// own printer to 3mm left and 5mm right because that is what squares the slip
// on their machine keeps those numbers: a non-zero margin is somebody's
// measurement, and this migration does not know better than the paper.
// ============================================================
const SAFE_FLAG = 'dtpos-print-safe-inset-v6';

try {
  if (typeof localStorage !== 'undefined' && !localStorage.getItem(GEOM_FLAG)) {
    // v1.21.0 wrote DEFAULT_MARGINS here on every machine. In the cloud app that made every device look "tuned by
    // hand", so the Compact / Standard / Bold receipt presets (which carry margins) could never reach the paper:
    // a device with no margins of its own FOLLOWS the preset (auto), and one that has been tuned keeps its own
    // (manual). The values themselves are the same either way — only the key is no longer created for nothing.
    // A machine that already holds a key is repaired exactly as before (the v5/v6 passes below).
    if (localStorage.getItem(KEY) !== null) localStorage.setItem(KEY, JSON.stringify(DEFAULT_MARGINS));
    localStorage.setItem(GEOM_FLAG, '1');
    localStorage.setItem(SAFE_FLAG, '1');
    for (const old of SUPERSEDED_FLAGS) {
      try { localStorage.removeItem(old); } catch { /* best effort */ }
    }
  } else if (typeof localStorage !== 'undefined' && !localStorage.getItem(SAFE_FLAG)) {
    const raw = localStorage.getItem(KEY);
    const cur = raw ? JSON.parse(raw) : null;
    if (cur && typeof cur === 'object') {
      const left = Number(cur.left) || 0;
      const right = Number(cur.right) || 0;
      if (left === 0 || right === 0) {
        localStorage.setItem(KEY, JSON.stringify({
          ...cur,
          left: left === 0 ? SAFE_SIDE_MM : left,
          right: right === 0 ? SAFE_SIDE_MM : right,
        }));
      }
    }
    localStorage.setItem(SAFE_FLAG, '1');
  }
} catch {}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < -100) return -100;
  if (n > 100) return 100;
  return Math.round(n * 10) / 10;
}

function positive(n: number): number { return Math.max(0, clamp(n)); }
function offset(n: number): number { return Math.min(0, clamp(n)); }

function clampWidth(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 30) return 30;
  if (n > 110) return 110;
  return Math.round(n * 10) / 10;
}

/**
 * Has THIS device been given its own margins? (cloud app, v1.57.0)
 *
 * No saved value = "follow the receipt preset" (auto); a saved value = "this printer needs its own" (manual).
 * A manual 0 stays 0 — it is a decision, not a missing value.
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
      contentWidthMm: clampWidth(p.contentWidthMm ?? 0),
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
    contentWidthMm: clampWidth(m.contentWidthMm ?? 0),
  };
  try { localStorage.setItem(KEY, JSON.stringify(safe)); } catch {}
  applyPrintMargins(safe);
  try { window.dispatchEvent(new CustomEvent('dtpos-print-margins-changed', { detail: safe })); } catch {}
}

export function applyPrintMargins(m: PrintMargins = loadPrintMargins()) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  // CSS padding cannot be negative. Positive values become padding; negative
  // values become a physical content offset so badly-calibrated drivers can be
  // counter-adjusted from Printer Settings.
  r.setProperty('--dt-print-padding-top', `${positive(m.top)}mm`);
  r.setProperty('--dt-print-padding-right', `${positive(m.right)}mm`);
  r.setProperty('--dt-print-padding-bottom', `${positive(m.bottom)}mm`);
  r.setProperty('--dt-print-padding-left', `${positive(m.left)}mm`);
  r.setProperty('--dt-print-offset-top', `${offset(m.top)}mm`);
  r.setProperty('--dt-print-offset-left', `${offset(m.left)}mm`);
  r.setProperty('--dt-print-offset-right', `${offset(m.right)}mm`);
  r.setProperty('--dt-print-offset-bottom', `${offset(m.bottom)}mm`);
  if (m.contentWidthMm && m.contentWidthMm > 0) {
    r.setProperty('--dt-print-content-width', `${m.contentWidthMm}mm`);
  } else {
    r.removeProperty('--dt-print-content-width');
  }
}

/**
 * Hand this device back to the receipt preset (auto). Removing the key is what "reset" means: saving the defaults
 * would leave the key in place and make auto unreachable for any device that had ever been tuned.
 */
export function resetPrintMargins() {
  try { localStorage.removeItem(KEY); } catch { /* private mode — nothing saved anyway */ }
  const back = loadPrintMargins();
  applyPrintMargins(back);
  try { window.dispatchEvent(new CustomEvent('dtpos-print-margins-changed', { detail: back })); } catch { /* ignore */ }
}

/**
 * Force the side margins equal, keeping top/bottom and any calibrated width.
 *
 * Offered as a one-click action because a machine can reach an asymmetric
 * pair in several ways — an old migration, a hand calibration, a restored
 * backup — and hunting for which one is not the shop's job.
 */
export function equaliseSideMargins(mm: number = DEFAULT_MARGINS.left): PrintMargins {
  const current = loadPrintMargins();
  const side = Math.max(0, Math.min(20, Math.round((Number(mm) || 0) * 10) / 10));
  const next: PrintMargins = { ...current, left: side, right: side };
  savePrintMargins(next);
  return next;
}

/** True when this device's stored side margins are not equal. */
export function hasUnequalSideMargins(m: PrintMargins = loadPrintMargins()): boolean {
  return Math.abs((Number(m.left) || 0) - (Number(m.right) || 0)) > 0.05;
}
