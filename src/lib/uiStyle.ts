// ============================================================
// INTERFACE STYLE — "Modern" (the new look) or "Classic" (the look every
// earlier version had). PRESENTATION ONLY.
//
// This module reads and writes two device-local preferences and sets one
// attribute plus three CSS variables on <html>. It never touches the
// database, the licence, users, permissions, orders, inventory, reports or
// any printer setting — switching back and forth changes how the screen
// looks and nothing else. Both keys live in localStorage under their own
// names, so no existing storage key is renamed or migrated.
//
//   dtpos-ui-style   'modern' | 'classic'        (absent → classic: the cloud app's default is the DT Enterprise look
//                                                  every restaurant already has; Modern is something a restaurant chooses)
//   dtpos-ui-theme   a theme id (uiThemes.ts)    (absent → ember, the orange default)
//   dtpos-ui-accent  a preset id, or '#rrggbb'   (absent → the theme's own accent)
//   dtpos-ui-anim    'on' | 'off'                (absent → on; DT Retail motion only)
//   dtpos-ui-prev    JSON of the look in use before a DT Retail theme was picked,
//                    so "Back to my previous look" can restore it
//
// Modern is a set of twelve themes (surface tint, accent, sidebar style). The
// accent key is an optional override for shops that want their own colour on
// top of a theme; choosing a theme clears it.
// ============================================================
import { useSyncExternalStore } from 'react';
import { ALL_THEMES, DEFAULT_THEME_ID, INK_ON_ACCENT, RETAIL_THEMES, UI_THEMES, WHITE, findTheme, isRetailTheme, isThemeId, type UiTheme } from './uiThemes';

export type UiStyle = 'modern' | 'classic';

export const UI_STYLE_KEY = 'dtpos-ui-style';
export const UI_ACCENT_KEY = 'dtpos-ui-accent';
export const UI_THEME_KEY = 'dtpos-ui-theme';
export const UI_ANIM_KEY = 'dtpos-ui-anim';
export const UI_PREV_KEY = 'dtpos-ui-prev';
export const UI_STYLE_EVENT = 'dtpos-ui-style-changed';

export interface AccentPreset {
  id: string;
  name: string;
  /** Hue 0-360, saturation and lightness in percent. Lightness is a starting point:
   *  applyUiStyle darkens it until white text on it is readable (see safeAccent). */
  h: number;
  s: number;
  l: number;
}

/** The restaurant's colour. Digital Target purple stays available as a preset. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'ember', name: 'Ember', h: 16, s: 88, l: 46 },
  { id: 'tomato', name: 'Tomato', h: 4, s: 76, l: 47 },
  { id: 'saffron', name: 'Saffron', h: 30, s: 90, l: 40 },
  { id: 'emerald', name: 'Emerald', h: 152, s: 62, l: 30 },
  { id: 'teal', name: 'Teal', h: 176, s: 70, l: 29 },
  { id: 'ocean', name: 'Ocean', h: 217, s: 80, l: 46 },
  { id: 'violet', name: 'Violet', h: 271, s: 70, l: 38 },
  { id: 'brand', name: 'Digital Target', h: 271, s: 84, l: 23 },
  { id: 'graphite', name: 'Graphite', h: 222, s: 18, l: 16 },
];
export const DEFAULT_ACCENT_ID = 'ember';

/** Minimum contrast of white text on the accent (WCAG AA for normal text is 4.5). */
export const MIN_ACCENT_CONTRAST = 4.6;

// ------------------------------------------------------------ colour maths
export interface Hsl { h: number; s: number; l: number }

export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

export function hslToHex(c: Hsl): string {
  return '#' + hslToRgb(c).map(v => v.toString(16).padStart(2, '0')).join('');
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = [r, g, b].map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Contrast ratio of white text on this colour. */
export function contrastWithWhite(c: Hsl): number {
  return 1.05 / (luminance(hslToRgb(c)) + 0.05);
}

/**
 * The accent, darkened just enough that white text on it reads. A shop picking
 * a pale colour gets the nearest readable version instead of a button nobody
 * can read. Saturation is capped so a very dark result does not turn muddy.
 */
export function safeAccent(c: Hsl): Hsl {
  let { h, s, l } = c;
  h = ((Math.round(h) % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, Math.round(s)));
  l = Math.max(8, Math.min(90, Math.round(l)));
  while (l > 14 && contrastWithWhite({ h, s, l }) < MIN_ACCENT_CONTRAST) l -= 1;
  return { h, s, l };
}

// ------------------------------------------------------------ preferences
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function getUiStyle(): UiStyle {
  return read(UI_STYLE_KEY) === 'modern' ? 'modern' : 'classic';
}

/** A preset id, or a '#rrggbb' custom colour. Anything else falls back to the default. */
export function getAccentChoice(): string {
  const v = read(UI_ACCENT_KEY);
  if (v && (ACCENT_PRESETS.some(p => p.id === v) || /^#[0-9a-f]{6}$/i.test(v))) return v;
  return DEFAULT_ACCENT_ID;
}

/** The stored theme id; anything unknown falls back to the default theme. */
export function getThemeId(): string {
  const v = read(UI_THEME_KEY);
  return isThemeId(v) ? v : DEFAULT_THEME_ID;
}

export function getTheme(): UiTheme {
  return findTheme(getThemeId());
}

/** A shop's own accent on top of the theme, or null when the theme's colour is in use. */
export function getAccentOverride(): string | null {
  const v = read(UI_ACCENT_KEY);
  if (v && (ACCENT_PRESETS.some(p => p.id === v) || /^#[0-9a-f]{6}$/i.test(v))) return v;
  return null;
}

export function resolveAccent(choice: string = getAccentChoice()): Hsl {
  const preset = ACCENT_PRESETS.find(p => p.id === choice);
  const base = preset ? { h: preset.h, s: preset.s, l: preset.l } : (hexToHsl(choice) || ACCENT_PRESETS[0]);
  return safeAccent({ h: base.h, s: base.s, l: base.l });
}

/** Everything the Modern look sets inline on <html>, so Classic can remove it all. */
const MODERN_VARS = [
  '--ui-accent-h', '--ui-accent-s', '--ui-accent-l',
  '--ui-text-h', '--ui-text-s', '--ui-text-l',
  '--ui-on-accent', '--ui-soft-s', '--ui-gold-on-dark',
];
const MODERN_ATTRS = ['data-ui', 'data-ui-theme', 'data-sidebar', 'data-on-accent', 'data-look', 'data-ui-mode', 'data-anim'];

const softSaturation = (c: Hsl) => Math.max(6, Math.min(85, Math.round(c.s * 0.9)));

export interface ModernLook {
  theme: UiTheme;
  accent: Hsl;
  /** Triplet of the colour used for text and icons sitting on the accent. */
  onAccent: string;
  /** True when that colour is dark (a light accent such as yellow). */
  darkOnAccent: boolean;
  /** The accent when it is used as text on a light surface. */
  text: Hsl;
  overridden: boolean;
}

/** What the Modern look is, given the stored theme and any accent override. Pure. */
export function resolveLook(themeId: string = getThemeId(), override: string | null = getAccentOverride()): ModernLook {
  const theme = findTheme(themeId);
  if (override) {
    // A shop's own colour: darkened until white text on it is readable.
    const accent = resolveAccent(override);
    return { theme, accent, onAccent: WHITE, darkOnAccent: false, text: accent, overridden: true };
  }
  const dark = theme.onAccent === 'dark';
  return {
    theme,
    accent: theme.accent,
    onAccent: dark ? INK_ON_ACCENT : WHITE,
    darkOnAccent: dark,
    text: theme.accentText || theme.accent,
    overridden: false,
  };
}

const CUSTOM_STYLE_ID = 'dtpos-custom-theme';

/** Puts the active custom theme's stylesheet block on the page, or takes it off when none is active. */
function syncCustomThemeStyle(css: string | undefined): void {
  const existing = document.getElementById(CUSTOM_STYLE_ID);
  if (!css) { existing?.remove(); return; }
  const el = (existing as HTMLStyleElement | null) || document.createElement('style');
  if (!existing) { el.id = CUSTOM_STYLE_ID; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

/** Sets the attributes and variables of the Modern look, or removes them all for Classic. Safe to call any number of times. */
export function applyUiStyle(style: UiStyle = getUiStyle()): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  try {
    if (style === 'modern') {
      const look = resolveLook();
      root.setAttribute('data-ui', 'modern');
      root.setAttribute('data-ui-theme', look.theme.id);
      syncCustomThemeStyle(look.theme.custom ? look.theme.css : undefined);
      root.setAttribute('data-sidebar', look.theme.sidebar);
      root.setAttribute('data-on-accent', look.darkOnAccent ? 'dark' : 'light');
      // DT Retail: one more attribute switches on its extra rules (ui-retail.css);
      // a dark page and the animation preference ride along. All removed with the rest.
      if (look.theme.family === 'retail') root.setAttribute('data-look', 'retail'); else root.removeAttribute('data-look');
      if (look.theme.dark) root.setAttribute('data-ui-mode', 'dark'); else root.removeAttribute('data-ui-mode');
      if (getAnimations()) root.removeAttribute('data-anim'); else root.setAttribute('data-anim', 'off');
      const set = (k: string, v: string) => root.style.setProperty(k, v);
      set('--ui-accent-h', String(look.accent.h));
      set('--ui-accent-s', `${look.accent.s}%`);
      set('--ui-accent-l', `${look.accent.l}%`);
      set('--ui-text-h', String(look.text.h));
      set('--ui-text-s', `${look.text.s}%`);
      set('--ui-text-l', `${look.text.l}%`);
      set('--ui-on-accent', look.onAccent);
      set('--ui-soft-s', `${softSaturation(look.accent)}%`);
      set('--ui-gold-on-dark', look.darkOnAccent ? INK_ON_ACCENT : `${look.accent.h} 90% 82%`);
    } else {
      MODERN_ATTRS.forEach(a => root.removeAttribute(a));
      MODERN_VARS.forEach(v => root.style.removeProperty(v));
      syncCustomThemeStyle(undefined);
    }
  } catch { /* a locked-down webview must never stop the app from starting */ }
}

function announce(): void {
  try { window.dispatchEvent(new CustomEvent(UI_STYLE_EVENT)); } catch { /* no window */ }
}

/** Re-applies the look after a custom theme was saved or removed (so the screen follows without a reload). */
export function refreshUiStyle(): void {
  applyUiStyle();
  announce();
}

export function setUiStyle(style: UiStyle): void {
  try { localStorage.setItem(UI_STYLE_KEY, style); } catch { /* private mode: applies for this session only */ }
  applyUiStyle(style);
  announce();
}

export function setAccent(choice: string): void {
  try { localStorage.setItem(UI_ACCENT_KEY, choice); } catch { /* session only */ }
  applyUiStyle();
  announce();
}

/** Back to the colour the theme was designed with. */
export function clearAccent(): void {
  try { localStorage.removeItem(UI_ACCENT_KEY); } catch { /* session only */ }
  applyUiStyle();
  announce();
}

/** What the screen looked like before a DT Retail theme was picked. */
export interface PreviousLook { style: UiStyle; theme: string; accent: string | null }

export function getPreviousLook(): PreviousLook | null {
  try {
    const raw = localStorage.getItem(UI_PREV_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PreviousLook>;
    if (!v || (v.style !== 'modern' && v.style !== 'classic') || !isThemeId(v.theme)) return null;
    return { style: v.style, theme: v.theme, accent: typeof v.accent === 'string' ? v.accent : null };
  } catch { return null; }
}

/** Picks a theme. A theme is a whole look, so any accent override is dropped with it. */
export function setTheme(id: string): void {
  if (!isThemeId(id)) return;
  try {
    // Moving onto a DT Retail theme from anything else: remember where we came from,
    // so one click puts it all back. Moving between DT Retail themes keeps that memory.
    const comingFrom = getThemeId();
    if (isRetailTheme(id) && (!isRetailTheme(comingFrom) || getUiStyle() === 'classic') && !getPreviousLook()) {
      const prev: PreviousLook = { style: getUiStyle(), theme: isRetailTheme(comingFrom) ? DEFAULT_THEME_ID : comingFrom, accent: getAccentOverride() };
      localStorage.setItem(UI_PREV_KEY, JSON.stringify(prev));
    } else if (!isRetailTheme(id)) {
      localStorage.removeItem(UI_PREV_KEY);
    }
    localStorage.setItem(UI_THEME_KEY, id);
    localStorage.removeItem(UI_ACCENT_KEY);
    // A DT Retail theme is a Modern look.
    if (isRetailTheme(id)) localStorage.setItem(UI_STYLE_KEY, 'modern');
  } catch { /* session only */ }
  applyUiStyle();
  announce();
}

/** Puts back the style, theme and accent that were in use before the DT Retail theme. */
export function restorePreviousLook(): boolean {
  const prev = getPreviousLook();
  if (!prev) return false;
  try {
    localStorage.setItem(UI_STYLE_KEY, prev.style);
    localStorage.setItem(UI_THEME_KEY, prev.theme);
    if (prev.accent) localStorage.setItem(UI_ACCENT_KEY, prev.accent); else localStorage.removeItem(UI_ACCENT_KEY);
    localStorage.removeItem(UI_PREV_KEY);
  } catch { /* session only */ }
  applyUiStyle();
  announce();
  return true;
}

/** Smooth animations (DT Retail): on unless switched off for a slow computer. */
export function getAnimations(): boolean {
  return read(UI_ANIM_KEY) !== 'off';
}

export function setAnimations(on: boolean): void {
  try { localStorage.setItem(UI_ANIM_KEY, on ? 'on' : 'off'); } catch { /* session only */ }
  applyUiStyle();
  announce();
}

/** Which look is on screen: DT Retail, plain Modern, or Classic. */
export type UiLook = 'retail' | 'modern' | 'classic';
export function getUiLook(): UiLook {
  if (getUiStyle() === 'classic') return 'classic';
  return isRetailTheme(getThemeId()) ? 'retail' : 'modern';
}

// ------------------------------------------------------------ React
function subscribe(cb: () => void): () => void {
  window.addEventListener(UI_STYLE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(UI_STYLE_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useUiStyle(): UiStyle {
  return useSyncExternalStore(subscribe, getUiStyle, () => 'classic' as UiStyle);
}

export function useAccentChoice(): string {
  return useSyncExternalStore(subscribe, getAccentChoice, () => DEFAULT_ACCENT_ID);
}

export function useThemeId(): string {
  return useSyncExternalStore(subscribe, getThemeId, () => DEFAULT_THEME_ID);
}

export function useUiLook(): UiLook {
  return useSyncExternalStore(subscribe, getUiLook, () => 'classic' as UiLook);
}

export function useAnimations(): boolean {
  return useSyncExternalStore(subscribe, getAnimations, () => true);
}

export function usePreviousLook(): PreviousLook | null {
  // A stable string snapshot: the object itself would be new on every read.
  const raw = useSyncExternalStore(subscribe, () => read(UI_PREV_KEY) || '', () => '');
  return raw ? getPreviousLook() : null;
}

export function useAccentOverride(): string | null {
  return useSyncExternalStore(subscribe, getAccentOverride, () => null);
}

export { UI_THEMES, RETAIL_THEMES, ALL_THEMES };

export function isModernUi(): boolean {
  return getUiStyle() === 'modern';
}
