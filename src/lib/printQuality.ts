// ============================================================
// Device-local PRINT QUALITY settings (thermal raster printing).
//
//  • mode      — 'auto' picks safe defaults; 'manual' uses the values below.
//  • darkness  — 1 (light) .. 10 (very dark). Controls how many dots fire.
//  • bold      — adds a 1-dot smear so thin fonts stay solid/clean.
//  • scale     — render resolution multiplier (1 = printer dots, 2 = 2x
//                supersampling for the sharpest small text, 3 = maximum).
//
// Saved per computer in localStorage — every counter can tune its own printer.
// ============================================================

/**
 * How heavy the text prints.
 *  - 'standard'  body text regular, headings / items / totals bold — the
 *                clear, normal receipt look (default).
 *  - 'bold'      every template's own weights, unchanged.
 *  - 'extra'     template weights plus a one-dot smear on every stroke — the
 *                old default. Very heavy; thin white text inside black bars
 *                can close up.
 */
export type TextWeight = 'standard' | 'bold' | 'extra';

export interface PrintQuality {
  mode: 'auto' | 'manual';
  darkness: number;
  bold: boolean;
  scale: number;
  weight: TextWeight;
}

const KEY = 'dtpos-print-quality-v1';

/** What each weight means on the raster path when quality is Auto. */
export const WEIGHT_PRESETS: Record<TextWeight, { darkness: number; bold: boolean }> = {
  standard: { darkness: 6, bold: false },
  bold: { darkness: 6, bold: false },
  extra: { darkness: 7, bold: true },
};

export const WEIGHT_LABELS: Record<TextWeight, { label: string; hint: string }> = {
  standard: { label: 'Standard', hint: 'Regular text, bold headings and totals — clear and easy to read.' },
  bold: { label: 'Bold', hint: 'The template’s own weights — every line bold.' },
  extra: { label: 'Extra bold', hint: 'Heaviest print. Use only for a faint printer.' },
};

// Standard used to be "darkness 7 + bold smear" — every stroke a dot wider
// than drawn, which shops read as "too bold" and which closed up white text
// inside black bars.
export const DEFAULT_QUALITY: PrintQuality = { mode: 'auto', darkness: 6, bold: false, scale: 2, weight: 'standard' };

const WEIGHTS: TextWeight[] = ['standard', 'bold', 'extra'];

function clampDarkness(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_QUALITY.darkness;
  return Math.max(1, Math.min(10, v));
}

function clampScale(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_QUALITY.scale;
  return Math.max(1, Math.min(3, v));
}

export function loadPrintQuality(): PrintQuality {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_QUALITY };
    const p = JSON.parse(raw) || {};
    const mode = p.mode === 'manual' ? 'manual' : 'auto';
    return {
      mode,
      darkness: clampDarkness(p.darkness),
      bold: p.bold !== false,
      scale: clampScale(p.scale),
      // A shop that tuned quality by hand keeps the look it tuned: its
      // template weights. Everyone on Auto gets Standard.
      weight: WEIGHTS.includes(p.weight) ? p.weight : (mode === 'manual' ? 'bold' : 'standard'),
    };
  } catch {
    return { ...DEFAULT_QUALITY };
  }
}

export function savePrintQuality(q: PrintQuality) {
  const safe: PrintQuality = {
    mode: q.mode === 'manual' ? 'manual' : 'auto',
    darkness: clampDarkness(q.darkness),
    bold: q.bold !== false,
    scale: clampScale(q.scale),
    weight: WEIGHTS.includes(q.weight) ? q.weight : 'standard',
  };
  try { localStorage.setItem(KEY, JSON.stringify(safe)); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent('dtpos-print-quality-changed', { detail: safe })); } catch { /* no window */ }
}

export function resetPrintQuality() {
  savePrintQuality({ ...DEFAULT_QUALITY });
}

/**
 * The values actually sent to the printer. Auto takes darkness and smear
 * from the chosen text weight; Manual uses the shop's own sliders.
 */
export function effectivePrintQuality(): PrintQuality {
  const q = loadPrintQuality();
  return q.mode === 'manual' ? q : { mode: 'auto', scale: 2, weight: q.weight, ...WEIGHT_PRESETS[q.weight] };
}
