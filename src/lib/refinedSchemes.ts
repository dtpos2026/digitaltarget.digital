// ============================================================
// DT REFINED colour schemes — ready-made pairs of a page colour and an accent (v1.96.0), shared by Settings → Appearance and the
// top bar's quick switcher (v1.103.0). The owner's rule: a theme changes colours only, so a scheme is nothing but these two values.
// ============================================================
import { clearAccent, setAccent, setRefinedSurface, type RefinedSurface } from '@/lib/uiStyle';

/** DT Refined colour schemes (v1.96.0): a page colour and an accent, chosen together. No accent = the design package's own purple. */
export interface RefinedScheme { id: string; name: string; blurb: string; surface: RefinedSurface; accent: string | null }
export const REFINED_SCHEMES: RefinedScheme[] = [
  { id: 'dt-purple', name: 'DT Purple', blurb: 'The design package as drawn: lavender page, DT purple.', surface: 'lavender', accent: null },
  { id: 'ocean', name: 'Ocean', blurb: 'Pale blue-grey page, deep blue actions.', surface: 'cool', accent: '#0369a1' },
  { id: 'emerald', name: 'Emerald', blurb: 'Clean grey page, fresh green actions.', surface: 'white', accent: '#047857' },
  { id: 'sunset', name: 'Sunset', blurb: 'Warm cream page, burnt-orange actions.', surface: 'warm', accent: '#c2410c' },
  { id: 'rose', name: 'Rose', blurb: 'Clean grey page, crimson actions.', surface: 'white', accent: '#be123c' },
  { id: 'graphite', name: 'Graphite', blurb: 'Neutral and quiet: grey page, slate actions.', surface: 'white', accent: '#334155' },
  { id: 'berry', name: 'Berry', blurb: 'Soft white page, raspberry-pink actions (the food-delivery look).', surface: 'white', accent: '#be185d' },
  { id: 'sunrise', name: 'Sunrise', blurb: 'Warm cream page, bright orange actions (the bakery look).', surface: 'warm', accent: '#d9480f' },
  { id: 'night', name: 'Night', blurb: 'Dark page and panels with a violet accent, for a dim shop.', surface: 'night', accent: '#8b5cf6' },
];

/** Put a scheme on: its page colour, and its accent (or the design package's own purple when it has none). */
export function applyRefinedScheme(sc: RefinedScheme): void {
  setRefinedSurface(sc.surface);
  if (sc.accent) setAccent(sc.accent); else clearAccent();
}

/** The scheme that is on right now, or null for a custom accent / surface the schemes do not describe. */
export function activeRefinedScheme(surface: RefinedSurface, accentOverride: string | null): RefinedScheme | null {
  const accent = (accentOverride || '').toLowerCase();
  return REFINED_SCHEMES.find(s => s.surface === surface && (s.accent ? accent === s.accent : !accentOverride)) ?? null;
}
