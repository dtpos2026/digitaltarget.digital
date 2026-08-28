// ============================================================================
// v1.28.8 — ready-made themes for the customer app
//
// The panel already had a colour picker and a light/dark toggle, and between
// them they can express any theme at all. That is the problem: picking a hex
// value that looks right on a phone, at a glance, next to a logo, is a design
// decision, and asking an operator to make it for every restaurant with a
// colour wheel gets a different quality of answer every time.
//
// So: a shortlist. Twelve, each one a hue that a restaurant plausibly wants and
// a mode chosen to suit it — deep colours on dark, where they read as rich
// rather than muddy; bright and warm ones on light, where dark would drain
// them. The picker is unchanged and still there, so this constrains nothing.
//
// Each colour is also what the LAUNCHER ICON's tile is painted (tools/brand.mjs
// reads theme.primary), so choosing a theme brands the home screen too.
//
// CONTRAST
// --primary carries white text throughout the customer app, so every colour
// here clears 4.5:1 against white — WCAG AA for body text. Anything lighter
// would need the foreground flipped, which is a bigger change than a palette.
// The ratios are asserted in src/test/appThemes_v1_28_8.test.ts rather than
// trusted; two candidates were dropped when they did not pass.
// ============================================================================

export interface AppTheme {
  id: string;
  name: string;
  /** Hex, applied as --primary and as the launcher icon's background. */
  primary: string;
  mode: 'light' | 'dark';
}

export const APP_THEMES: readonly AppTheme[] = [
  { id: 'royal-purple', name: 'Royal Purple', primary: '#5B21B6', mode: 'dark' },
  { id: 'midnight',     name: 'Midnight',     primary: '#1E3A8A', mode: 'dark' },
  { id: 'emerald',      name: 'Emerald',      primary: '#047857', mode: 'dark' },
  { id: 'crimson',      name: 'Crimson',      primary: '#B91C1C', mode: 'dark' },
  { id: 'charcoal',     name: 'Charcoal',     primary: '#334155', mode: 'dark' },
  { id: 'teal',         name: 'Teal',         primary: '#0F766E', mode: 'dark' },
  { id: 'saffron',      name: 'Saffron',      primary: '#B45309', mode: 'light' },
  { id: 'terracotta',   name: 'Terracotta',   primary: '#C2410C', mode: 'light' },
  { id: 'rose',         name: 'Rose',         primary: '#BE185D', mode: 'light' },
  { id: 'olive',        name: 'Olive',        primary: '#4D7C0F', mode: 'light' },
  { id: 'indigo',       name: 'Indigo',       primary: '#4338CA', mode: 'light' },
  { id: 'coffee',       name: 'Coffee',       primary: '#78350F', mode: 'light' },
] as const;

/** The theme a saved colour corresponds to, or null when it was hand-picked. */
export function themeFor(primary: string | null, mode: string | null): AppTheme | null {
  if (!primary) return null;
  const hex = primary.trim().toUpperCase();
  return APP_THEMES.find(t => t.primary.toUpperCase() === hex && t.mode === mode) ?? null;
}

// ---------------------------------------------------------------- contrast
//
// Exported so the test can assert the palette rather than take its word, and
// so the panel can warn about a hand-picked colour that white text will not
// survive on.

/** Relative luminance, WCAG 2.1 §1.4.3. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio against white, which is what --primary-foreground is. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}
