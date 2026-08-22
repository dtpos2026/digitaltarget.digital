// Premium VINCE theme gating helpers.
// Super Admin allots premium theme per-restaurant via Firestore
// (tenants/{tid}/meta/settings.premiumThemeAllowed). The restaurant owner
// can then enable/disable it from Settings → Theme.

import { getSettings } from './store';
import { setActiveTheme, getActiveTheme, type ThemeId } from './themes';

export const PREMIUM_THEME_ID: ThemeId = 'vince-premium';
export const PREMIUM_BRAND_NAME = 'VINCE BY TAIMOOR';

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
  return isPremiumThemeEnabled() && getActiveTheme() === PREMIUM_THEME_ID;
}

/** Auto-revert if a user has premium theme active but allotment was revoked. */
export function enforcePremiumThemeGate() {
  try {
    if (getActiveTheme() === PREMIUM_THEME_ID && !isPremiumThemeAllowed()) {
      setActiveTheme('dt-pos-purple');
      try { window.location.reload(); } catch {}
    }
  } catch {}
}
