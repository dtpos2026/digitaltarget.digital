// ============================================================
// TEXT SPACING — line, word and letter spacing for bills and KOTs.
//
// Settings → Receipt / KOT → Text spacing. Nothing is added to a slip until
// the shop picks a value, so "As designed" prints every template exactly as
// before. A chosen value travels on the slip's root element as data
// attributes plus CSS variables; the same rules apply them on screen
// (src/index.css) and in the print window (printCss.ts), so the preview is
// what prints.
//
//   Line spacing   — one line height for every line of the slip (1.0–2.2),
//                    the way a word processor applies "1.5 lines".
//   Word spacing   — extra space between words, in px.
//   Letter spacing — extra space between letters, in px, for text whose
//                    template does not set its own tracking.
// ============================================================
import type React from 'react';

export type SpacingKind = 'bill' | 'kot';

export interface TextSpacing {
  /** Line height multiplier, or null for the template's own. */
  line: number | null;
  /** Extra px between words (0 = template's own). */
  word: number;
  /** Extra px between letters (0 = template's own). */
  letter: number;
}

export const SPACING_KEYS = {
  bill: { line: 'receiptLineSpacing', word: 'receiptWordSpacing', letter: 'receiptLetterSpacing' },
  kot: { line: 'kotLineSpacing', word: 'kotWordSpacing', letter: 'kotLetterSpacing' },
} as const;

export const LINE_SPACING = { min: 1, max: 2.2, step: 0.05 };
export const WORD_SPACING = { min: 0, max: 10, step: 0.5 };
export const LETTER_SPACING = { min: 0, max: 3, step: 0.25 };

/** Quick picks shown above the slider. */
export const LINE_PRESETS: { label: string; value: number | null }[] = [
  { label: 'As designed', value: null },
  { label: 'Compact', value: 1.1 },
  { label: 'Normal', value: 1.3 },
  { label: 'Relaxed', value: 1.5 },
  { label: 'Wide', value: 1.8 },
];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round = (n: number, step: number) => Math.round(n / step) * step;

/** The shop's spacing for one kind of slip, cleaned up and bounded. */
export function readSpacing(settings: unknown, kind: SpacingKind): TextSpacing {
  const s = (settings || {}) as Record<string, unknown>;
  const k = SPACING_KEYS[kind];
  const line = Number(s[k.line]);
  const word = Number(s[k.word]);
  const letter = Number(s[k.letter]);
  return {
    line: Number.isFinite(line) && line > 0
      ? Number(round(clamp(line, LINE_SPACING.min, LINE_SPACING.max), LINE_SPACING.step).toFixed(2))
      : null,
    word: Number.isFinite(word) && word > 0 ? Number(round(clamp(word, 0, WORD_SPACING.max), WORD_SPACING.step).toFixed(2)) : 0,
    letter: Number.isFinite(letter) && letter > 0 ? Number(round(clamp(letter, 0, LETTER_SPACING.max), LETTER_SPACING.step).toFixed(2)) : 0,
  };
}

/** True when the shop has changed anything for this kind of slip. */
export function hasSpacing(sp: TextSpacing): boolean {
  return sp.line != null || sp.word > 0 || sp.letter > 0;
}

/**
 * Attributes and CSS variables for a slip's root element (preview and print
 * node alike). Empty when the shop kept "As designed".
 */
export function spacingNodeProps(settings: unknown, kind: SpacingKind): {
  attrs: Record<string, string>;
  style: React.CSSProperties;
} {
  const sp = readSpacing(settings, kind);
  const attrs: Record<string, string> = {};
  const style: Record<string, string> = {};
  if (sp.line != null) {
    attrs['data-dt-line'] = '';
    style['--dt-line-height'] = String(sp.line);
  }
  if (sp.word > 0 || sp.letter > 0) {
    attrs['data-dt-spacing'] = '';
    style['--dt-word-spacing'] = `${sp.word}px`;
    style['--dt-letter-spacing'] = `${sp.letter}px`;
  }
  return { attrs, style: style as React.CSSProperties };
}

/** A settings patch that writes one kind's spacing (null/0 clears it). */
export function spacingPatch(kind: SpacingKind, next: Partial<TextSpacing>): Record<string, number | undefined> {
  const k = SPACING_KEYS[kind];
  const patch: Record<string, number | undefined> = {};
  if ('line' in next) patch[k.line] = next.line == null ? undefined : next.line;
  if ('word' in next) patch[k.word] = next.word ? next.word : undefined;
  if ('letter' in next) patch[k.letter] = next.letter ? next.letter : undefined;
  return patch;
}
