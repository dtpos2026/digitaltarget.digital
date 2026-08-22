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

export function resetPrintMargins() {
  savePrintMargins({ ...DEFAULT_MARGINS });
}
