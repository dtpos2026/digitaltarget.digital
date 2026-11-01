// ============================================================================
// Interface-style boot (v1.78.0)
//
// Applies the saved interface style (Classic = the DT Enterprise look every restaurant already has, or Modern) as early
// as the client bundle runs, so the first render is already in the chosen look rather than flashing the default.
// Client only; a no-op during server rendering. Presentation only — see lib/uiStyle.ts.
// ============================================================================
import { applyUiStyle, getUiStyle, setTheme, setUiStyle } from './uiStyle';
import { getActiveTheme, setActiveTheme } from './themes';
import { REFERENCE_THEME_SPECS } from './referenceThemes';
import { isThemeId } from './uiThemes';
import { applyPremiumPolish } from './premiumPolish';

const MIGRATED_KEY = 'dtpos-ui-migrated-ref-themes';

/**
 * v1.68.0 restaurants picked one of the 21 reference themes from the Classic list (a palette-only version). Those looks
 * now live in the Modern style, drawn properly. A restaurant that was on one keeps that look: it is switched to the
 * Modern style with the same theme, and the Classic selection returns to the brand default. Runs once per browser.
 */
export function migrateReferenceThemeSelection(): boolean {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return false;
    localStorage.setItem(MIGRATED_KEY, '1');
    const id = getActiveTheme();
    if (!REFERENCE_THEME_SPECS.some(s => s.id === id) || !isThemeId(id)) return false;
    setActiveTheme('dt-pos-purple');
    setTheme(id);
    setUiStyle('modern');
    return true;
  } catch { return false; }
}

export function bootUiStyle(): void {
  if (typeof document === 'undefined') return;
  migrateReferenceThemeSelection();
  applyUiStyle(getUiStyle());
  applyPremiumPolish();
}

bootUiStyle();
