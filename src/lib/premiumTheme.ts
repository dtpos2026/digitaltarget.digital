// Premium VINCE theme gating helpers.
// Super Admin allots premium theme per-restaurant via Firestore
// (tenants/{tid}/meta/settings.premiumThemeAllowed). The restaurant owner
// can then enable/disable it from Settings → Theme.

import { isRefinedTheme } from './uiThemes';
import { getSettings } from './store';
import { setActiveTheme, getActiveTheme, type ThemeId } from './themes';
import { REFERENCE_THEME_SPECS } from './referenceThemes';
import { getUiStyle, setUiStyle, getThemeId } from './uiStyle';

export const PREMIUM_THEME_ID: ThemeId = 'vince-premium';
export const PREMIUM_BRAND_NAME = 'VINCE BY TAIMOOR';

/**
 * v1.61.0 — premium is a SET, not one theme.
 *
 * REQUESTED: "me super admin sy us resturant ko allow kro ga tu who update py
 * desine ui change hoj ga ... me super admin sy ksi b resturan ko allow kr
 * skta hon."
 *
 * That is exactly what premiumThemeAllowed already does — it just only ever
 * gated ONE id, hardcoded in three places. Soft Light joins the same gate, so
 * allowing a restaurant from the Super Admin panel hands them the new look and
 * revoking it takes them back, with no separate mechanism to keep in step.
 *
 * The rollout the request describes already falls out of this: the flag lives
 * in tenant_settings, the app reads it on load, so the web picks it up on the
 * next refresh and the Windows build on the next restart. Nothing about POS
 * behaviour is touched either way — a theme is CSS variables.
 */
export const PREMIUM_THEME_IDS: readonly ThemeId[] = [
  'vince-premium', 'soft-light',
  // v1.68.0 — the reference set (13 Modern + 8 DT Retail) is premium too: one gate, one switch.
  ...REFERENCE_THEME_SPECS.map(s => s.id),
];

export function isPremiumTheme(id: ThemeId): boolean {
  return PREMIUM_THEME_IDS.includes(id);
}

export function isPremiumThemeAllowed(): boolean {
  try {
    const s: any = getSettings();
    return !!s?.premiumThemeAllowed;
  } catch { return false; }
}

export function isPremiumThemeEnabled(): boolean {
  try {
    const s: any = getSettings();
    return !!s?.premiumThemeAllowed && !!s?.premiumThemeEnabled;
  } catch { return false; }
}

export function isPremiumThemeActive(): boolean {
  return isPremiumThemeEnabled() && isPremiumTheme(getActiveTheme());
}

/**
 * v1.68.0 — only the Vince theme carries the "VINCE BY TAIMOOR" brand.
 *
 * isPremiumThemeActive() is true for EVERY premium theme, and the sidebar used it
 * to swap the restaurant's name for Vince's. Soft Light (v1.61.0) and the whole
 * reference set joined the premium gate and inherited that swap, so a restaurant on
 * Soft Light saw another company's name where its own belongs. The restaurant's name
 * and logo lead on every theme except the one that is itself a brand.
 */
export function isVinceBrandActive(): boolean {
  return isPremiumThemeEnabled() && getActiveTheme() === PREMIUM_THEME_ID;
}

/** Auto-revert if a user has a premium theme active but allotment was revoked. */
export function enforcePremiumThemeGate() {
  try {
    // v1.61.0 — checks every premium theme, not just the first one. A
    // restaurant left on Soft Light after revocation would otherwise keep a
    // look it is no longer entitled to, silently.
    if (isPremiumTheme(getActiveTheme()) && !isPremiumThemeAllowed()) {
      setActiveTheme('dt-pos-purple');
      try { window.location.reload(); } catch {}
    }
    // v1.78.0 — the Modern interface style (its 13 themes, the 8 DT Retail looks and Custom themes) is part of the same
    // premium set. A restaurant whose allotment was revoked goes back to the Classic (DT Enterprise) look.
    // v1.85.0 — except the DT design package's own theme (DT Refined): it is the product's standard design, open to all.
    if (getUiStyle() === 'modern' && !isPremiumThemeAllowed() && !isRefinedTheme(getThemeId())) {
      setUiStyle('classic');
    }
  } catch {}
}
