// The first frame of the app should already be in the restaurant's colour.
//
// The theme is applied by script after the app has loaded, so the page used to paint in the default purple for a
// moment and then change. applyTheme() now saves the two colours the splash is made of (primary and its text
// colour); a few bytes of inline script in the document head put them back before anything is painted.
// Plain constants and one function, so it is safe to import from the root route and from the theme file.

export const BOOT_COLORS_KEY = 'dt-boot-colors';

export interface BootColors { p: string; f: string }

/** What applyTheme saves: the `--primary` and `--primary-foreground` values of the theme being applied. */
export function saveBootColors(primary: string | undefined, foreground: string | undefined): void {
  if (!primary || !foreground) return;
  try { localStorage.setItem(BOOT_COLORS_KEY, JSON.stringify({ p: primary, f: foreground } satisfies BootColors)); } catch { /* private mode */ }
}

/** Runs in <head>, before first paint. Never throws; with nothing saved it changes nothing. */
export const BOOT_THEME_SCRIPT =
  `(function(){try{var c=JSON.parse(localStorage.getItem('${BOOT_COLORS_KEY}')||'null');` +
  `if(c&&typeof c.p==='string'&&typeof c.f==='string'&&/^[0-9.\\s%]+$/.test(c.p)&&/^[0-9.\\s%]+$/.test(c.f)){` +
  `var s=document.documentElement.style;s.setProperty('--primary',c.p);s.setProperty('--primary-foreground',c.f);}}catch(e){}})();`;
