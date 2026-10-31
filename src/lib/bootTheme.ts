// The first frame of the app should already be in the restaurant's colour.
//
// The theme is applied by script after the app has loaded, so the page used to paint in the default purple for a
// moment and then change. applyTheme() now saves the two colours the splash is made of (primary and its text
// colour); a few bytes of inline script in the document head put them back before anything is painted.
// Plain constants and one function, so it is safe to import from the root route and from the theme file.

import { PUBLIC_PREFIXES } from './publicRoutes';

export const BOOT_COLORS_KEY = 'dt-boot-colors';

/** The colour the POS opens in when nothing has been saved yet: the default theme's primary. */
export const DEFAULT_BOOT_PRIMARY = '273 89% 23%';

export interface BootColors { p: string; f: string }

/** What applyTheme saves: the `--primary` and `--primary-foreground` values of the theme being applied. */
export function saveBootColors(primary: string | undefined, foreground: string | undefined): void {
  if (!primary || !foreground) return;
  try { localStorage.setItem(BOOT_COLORS_KEY, JSON.stringify({ p: primary, f: foreground } satisfies BootColors)); } catch { /* private mode */ }
}

/** Takes the page's own background off once the app is up; the splash (opaque, fixed) covers until then. */
export function releaseBootBackground(): void {
  try { document.documentElement.style.removeProperty('background-color'); } catch { /* nothing to release */ }
}

/**
 * Runs in <head>, before first paint; never throws.
 *  - On a public route (customer site, portals) it marks the page and does nothing else: those paint their own colours.
 *  - Otherwise the page itself is painted in the restaurant's colour (the saved one, or the default purple), so no white
 *    frame comes before the splash — in the browser, and in the Windows window's first paint.
 */
export const BOOT_THEME_SCRIPT =
  `(function(){var d=document.documentElement,s=d.style,h=location.hash||'',P=${JSON.stringify(PUBLIC_PREFIXES)};` +
  `for(var i=0;i<P.length;i++){if(h.indexOf(P[i])===0){d.setAttribute('data-public-route','');return;}}` +
  `var p='${DEFAULT_BOOT_PRIMARY}';` +
  `try{var c=JSON.parse(localStorage.getItem('${BOOT_COLORS_KEY}')||'null');` +
  `if(c&&typeof c.p==='string'&&typeof c.f==='string'&&/^[0-9.\\s%]+$/.test(c.p)&&/^[0-9.\\s%]+$/.test(c.f)){` +
  `s.setProperty('--primary',c.p);s.setProperty('--primary-foreground',c.f);p=c.p;}}catch(e){}` +
  `s.backgroundColor='hsl('+p.trim().split(/\\s+/).join(',')+')';})();`;
