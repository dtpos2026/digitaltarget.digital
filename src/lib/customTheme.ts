// ============================================================
// CUSTOM THEMES — a theme anyone can design, save, export and import.
//
// The company (or a developer) picks a handful of colours and a look, the software
// turns them into a complete theme — page, panels, borders, quiet text, sidebar, the
// accent as text, the DT Retail gradients — and checks that everything is readable.
// The result is applied exactly like a built-in theme: one attribute and a stylesheet
// block on <html>. Nothing here can reach data, orders, users, the licence or printing.
//
// A theme is a small JSON file (`dtpos-theme`), so a theme designed once can be handed
// to any shop: Settings → Appearance → Custom → Import.
//
// Safe by construction: only #rrggbb colours and a short name are accepted, and the
// stylesheet is built from numbers computed from them, never from the text that came in.
// ============================================================
import {
  contrastWithWhite, getThemeId, hexToHsl, hslToHex, hslToRgb, refreshUiStyle, rgbToHsl, setTheme, type Hsl,
} from './uiStyle';
import {
  DEFAULT_THEME_ID, INK_ON_ACCENT, getRegisteredCustomThemes, registerCustomThemes, type Triplet, type UiTheme,
} from './uiThemes';

export const CUSTOM_THEMES_KEY = 'dtpos-custom-themes';
export const CUSTOM_ID_PREFIX = 'custom-';
export const MAX_CUSTOM_THEMES = 12;
export const THEME_FILE_FORMAT = 'dtpos-theme';

export type CustomLook = 'modern' | 'retail';

/** What a designer chooses. Everything else is derived. */
export interface CustomThemeDef {
  id: string;
  name: string;
  /** 'modern' = flat shell; 'retail' = the DT Retail look (gradient sidebar, banner, motion). */
  look: CustomLook;
  /** A dark page (like Night), not just a dark sidebar. */
  dark: boolean;
  /** Buttons, selection, highlights. */
  accent: string;
  /** The page behind the panels. */
  page: string;
  /** Cards and panels. */
  panel: string;
  /** Body text. */
  text: string;
  sidebarStyle: 'light' | 'dark';
  /** The sidebar colour (dark sidebar), and the base of the retail sidebar gradient. */
  sidebarColor: string;
}

export const DEFAULT_CUSTOM_DEF: Omit<CustomThemeDef, 'id'> = {
  name: 'My theme',
  look: 'modern',
  dark: false,
  accent: '#0f766e',
  page: '#f4f7f6',
  panel: '#ffffff',
  text: '#10201d',
  sidebarStyle: 'dark',
  sidebarColor: '#0b2723',
};

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v.trim());
const clean = (v: string) => v.trim().toLowerCase();

// ------------------------------------------------------------ colour helpers
type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHsl = (hex: string): Hsl => { const [r, g, b] = toRgb(hex); return rgbToHsl(r, g, b); };
const triplet = (c: Hsl): Triplet => `${Math.round(c.h)} ${Math.round(c.s)}% ${Math.round(c.l)}%`;
const hexOf = (c: Hsl) => hslToHex(c);

function lum([r, g, b]: Rgb): number {
  const ch = [r, g, b].map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrastOf(a: Rgb, b: Rgb): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const contrastHsl = (a: Hsl, b: Hsl) => contrastOf(hslToRgb(a), hslToRgb(b));

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
}
const hslOfRgb = (c: Rgb): Hsl => rgbToHsl(c[0], c[1], c[2]);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Moves a colour's lightness away from `against` until it reads (contrast >= min) on every given background. */
function readableOn(color: Hsl, backgrounds: Hsl[], min: number): Hsl {
  const worst = (c: Hsl) => Math.min(...backgrounds.map(b => contrastHsl(c, b)));
  if (worst(color) >= min) return color;
  const lightBg = backgrounds.reduce((s, b) => s + b.l, 0) / backgrounds.length > 50;
  let c = { ...color };
  for (let i = 0; i < 100 && worst(c) < min; i++) c = { ...c, l: clamp(c.l + (lightBg ? -1 : 1), 0, 100) };
  return c;
}

// ------------------------------------------------------------ validation
/** Turns anything that came from storage or a file into a clean definition, or null if it cannot be one. */
export function normalizeDef(raw: unknown): CustomThemeDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : '';
  if (!/^custom-[a-z0-9][a-z0-9-]{0,40}$/.test(id)) return null;
  const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32) : '';
  if (!name) return null;
  const colour = (v: unknown, fallback: string) => (isHex(v) ? clean(v as string) : fallback);
  const d = DEFAULT_CUSTOM_DEF;
  return {
    id,
    name,
    look: r.look === 'retail' ? 'retail' : 'modern',
    dark: r.dark === true,
    accent: colour(r.accent, d.accent),
    page: colour(r.page, d.page),
    panel: colour(r.panel, d.panel),
    text: colour(r.text, d.text),
    sidebarStyle: r.look === 'retail' || r.sidebarStyle === 'dark' ? 'dark' : 'light',
    sidebarColor: colour(r.sidebarColor, d.sidebarColor),
  };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'theme';
}

/** A fresh id (`custom-<name>`), unique among the saved themes. */
export function newCustomId(name: string, taken: string[]): string {
  const base = `${CUSTOM_ID_PREFIX}${slugify(name)}`;
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.includes(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

// ------------------------------------------------------------ building a theme
export interface BuiltCustomTheme {
  theme: UiTheme;
  /** Things the designer should know: a colour was made readable, or a pair is only just readable. */
  notes: string[];
}

/** Derives a complete, readable theme from the handful of colours a designer chose. Pure. */
export function buildCustomTheme(def: CustomThemeDef): BuiltCustomTheme {
  const notes: string[] = [];
  const pageRgb = toRgb(def.page);
  const panelRgb = toRgb(def.panel);
  const pageHsl = hslOfRgb(pageRgb);
  const panelHsl = hslOfRgb(panelRgb);

  // Body text must read on the page and on panels.
  let text = toHsl(def.text);
  const readableText = readableOn(text, [pageHsl, panelHsl], 7);
  if (readableText.l !== text.l) notes.push('The text colour was adjusted so it is easy to read on the page and panels.');
  text = readableText;
  const textRgb = hslToRgb(text);

  // Quiet text, subtle fills and borders are mixed from the page and the text colour.
  const mutedFill = mix(pageRgb, textRgb, def.dark ? 0.1 : 0.06);
  const border = mix(pageRgb, textRgb, def.dark ? 0.16 : 0.12);
  const input = mix(pageRgb, textRgb, def.dark ? 0.24 : 0.2);
  const mutedHsl = hslOfRgb(mutedFill);
  const mutedText = readableOn(hslOfRgb(mix(textRgb, pageRgb, 0.38)), [pageHsl, mutedHsl, panelHsl], 4.5);

  // The accent: exact where it can be. A pale one gets dark text on it; a very pale/dark clash is darkened.
  let accent = toHsl(def.accent);
  let onAccent: 'light' | 'dark' = 'light';
  const whiteOn = contrastWithWhite(accent);
  if (whiteOn < 3) {
    const [ih, is, il] = INK_ON_ACCENT.replace(/%/g, '').split(/\s+/).map(Number);
    const ink = hslToRgb({ h: ih, s: is, l: il });
    if (contrastOf(hslToRgb(accent), ink) >= 4.5) onAccent = 'dark';
    else {
      while (accent.l > 14 && contrastWithWhite(accent) < 4.6) accent = { ...accent, l: accent.l - 1 };
      notes.push('The accent colour was darkened a little so white text on buttons is readable.');
    }
  } else if (whiteOn < 4.5) {
    notes.push(`White text on the accent colour reads at ${whiteOn.toFixed(1)} : 1 — fine for buttons and headings, a little light for small text.`);
  }
  // The accent used as text (links, prices, active labels) must read on the page and panels.
  const accentText = readableOn(accent, [pageHsl, panelHsl], 4.5);

  // Sidebar.
  const sidebarHsl = toHsl(def.sidebarColor);
  const darkSidebar = def.look === 'retail' || def.sidebarStyle === 'dark';
  const sbFg = readableOn({ h: sidebarHsl.h, s: Math.min(sidebarHsl.s, 30), l: 86 }, [sidebarHsl], 4.5);
  const sbMuted = readableOn({ h: sidebarHsl.h, s: Math.min(sidebarHsl.s, 22), l: 70 }, [sidebarHsl], 4.5);
  const sbBorder: Hsl = { h: sidebarHsl.h, s: Math.min(sidebarHsl.s, 45), l: clamp(sidebarHsl.l + 10, 0, 40) };
  const sbHover: Hsl = { h: sidebarHsl.h, s: Math.min(sidebarHsl.s, 50), l: clamp(sidebarHsl.l + 8, 0, 40) };
  const gradTop: Hsl = { ...sidebarHsl, l: clamp(sidebarHsl.l + 3, 0, 45) };
  const gradBot: Hsl = { ...sidebarHsl, l: clamp(sidebarHsl.l - 4, 2, 45) };

  // DT Retail banner: a deep and a light shade of the accent.
  const heroA: Hsl = { h: accent.h, s: clamp(accent.s, 30, 90), l: clamp(accent.l - 24, 14, 40) };
  const heroB: Hsl = { h: accent.h, s: clamp(accent.s, 30, 90), l: clamp(accent.l + 14, 45, 72) };

  const surface = {
    background: triplet(pageHsl),
    card: triplet(panelHsl),
    foreground: triplet(text),
    mutedForeground: triplet(mutedText),
    muted: triplet(mutedHsl),
    border: triplet(hslOfRgb(border)),
  };

  const theme: UiTheme = {
    id: def.id,
    name: def.name,
    tagline: def.look === 'retail' ? 'Custom · DT Retail look' : 'Custom · Modern look',
    accent,
    onAccent,
    accentText: accentText.l !== accent.l ? accentText : undefined,
    surface,
    sidebar: darkSidebar ? 'dark' : 'light',
    sidebarColor: darkSidebar ? triplet(sidebarHsl) : undefined,
    family: def.look === 'retail' ? 'retail' : undefined,
    dark: def.dark || undefined,
    sidebarGradient: def.look === 'retail' ? [triplet(gradTop), triplet(gradBot)] : undefined,
    hero: def.look === 'retail' ? [triplet(heroA), triplet(heroB)] : undefined,
    swatches: [def.sidebarColor, hexOf(accent), def.page, def.panel],
    custom: true,
  };

  const decl: Array<[string, string]> = [
    ['--background', surface.background],
    ['--foreground', surface.foreground],
    ['--card', surface.card],
    ['--card-foreground', surface.foreground],
    ['--popover', surface.card],
    ['--popover-foreground', surface.foreground],
    ['--secondary', surface.muted],
    ['--secondary-foreground', surface.foreground],
    ['--muted', surface.muted],
    ['--muted-foreground', surface.mutedForeground],
    ['--accent', surface.muted],
    ['--accent-foreground', surface.foreground],
    ['--border', surface.border],
    ['--input', triplet(hslOfRgb(input))],
    ['--pos-grid-bg', surface.background],
    ['--pos-sidebar', surface.card],
    ['--pos-cart', surface.card],
    ['--pos-sidebar-foreground', surface.foreground],
  ];
  if (darkSidebar) {
    decl.push(
      ['--sidebar-foreground', triplet(sbFg)], ['--sidebar-border', triplet(sbBorder)],
      ['--ui-sb-bg', triplet(sidebarHsl)], ['--ui-sb-fg', triplet(sbFg)], ['--ui-sb-border', triplet(sbBorder)],
      ['--ui-sb-hover', triplet(sbHover)], ['--ui-sb-muted-fg', triplet(sbMuted)],
    );
  } else {
    decl.push(['--sidebar-foreground', surface.mutedForeground], ['--sidebar-border', surface.border]);
  }
  if (def.look === 'retail') {
    decl.push(
      ['--dtr-sb-top', triplet(gradTop)], ['--dtr-sb-bot', triplet(gradBot)],
      ['--dtr-hero-a', triplet(heroA)], ['--dtr-hero-b', triplet(heroB)], ['--dtr-highlight', '44 98% 50%'],
    );
  }
  const body = decl.map(([k, v]) => `  ${k}: ${v};`).join('\n') + (def.dark ? '\n  color-scheme: dark;' : '');
  theme.css = `:root[data-ui="modern"][data-ui-theme="${def.id}"] {\n${body}\n}\n`;

  return { theme, notes };
}

// ------------------------------------------------------------ storage (this computer only)
export function getCustomThemeDefs(): CustomThemeDef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: CustomThemeDef[] = [];
    for (const item of raw) {
      const def = normalizeDef(item);
      if (def && !seen.has(def.id)) { seen.add(def.id); out.push(def); }
    }
    return out.slice(0, MAX_CUSTOM_THEMES);
  } catch { return []; }
}

function writeDefs(defs: CustomThemeDef[]): void {
  try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(defs)); } catch { /* session only */ }
}

/** Makes the saved custom themes known to the theme picker. Call before the first applyUiStyle(). */
export function loadCustomThemes(): UiTheme[] {
  const list = getCustomThemeDefs().map(d => buildCustomTheme(d).theme);
  registerCustomThemes(list);
  return getRegisteredCustomThemes();
}

/** Adds or replaces a theme. Returns the saved definition (with its id), or an error message. */
/** The project does not use strict null checks, so results are flat: `ok` tells which of `def` / `error` is set. */
export interface ThemeResult { ok: boolean; def?: CustomThemeDef; error?: string }

export function saveCustomThemeDef(input: Omit<CustomThemeDef, 'id'> & { id?: string }): ThemeResult {
  const defs = getCustomThemeDefs();
  const id = input.id && defs.some(d => d.id === input.id) ? input.id : newCustomId(input.name, defs.map(d => d.id));
  const def = normalizeDef({ ...input, id });
  if (!def) return { ok: false, error: 'Give the theme a name and valid colours.' };
  const exists = defs.some(d => d.id === def.id);
  if (!exists && defs.length >= MAX_CUSTOM_THEMES) return { ok: false, error: `You can keep up to ${MAX_CUSTOM_THEMES} custom themes. Delete one first.` };
  writeDefs(exists ? defs.map(d => (d.id === def.id ? def : d)) : [...defs, def]);
  loadCustomThemes();
  if (getThemeId() === def.id) refreshUiStyle(); // the theme in use changed: repaint now
  return { ok: true, def };
}

/** Removes a theme. If it was the one in use, the default theme takes over. */
export function deleteCustomThemeDef(id: string): void {
  const wasActive = getThemeId() === id;
  writeDefs(getCustomThemeDefs().filter(d => d.id !== id));
  loadCustomThemes();
  if (wasActive) setTheme(DEFAULT_THEME_ID);
}

// ------------------------------------------------------------ theme files
export function exportThemeFile(def: CustomThemeDef): string {
  return JSON.stringify({ format: THEME_FILE_FORMAT, version: 1, theme: def }, null, 2);
}

/** Reads a theme file. Never throws; a bad file comes back as a plain-language error. */
export function parseThemeFile(text: string, takenIds: string[] = []): ThemeResult {
  let json: any;
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'This is not a theme file.' }; }
  if (!json || json.format !== THEME_FILE_FORMAT) return { ok: false, error: 'This file is not a DT POS theme.' };
  const raw = json.theme && typeof json.theme === 'object' ? { ...json.theme } : null;
  if (!raw) return { ok: false, error: 'The theme file is empty.' };
  // Always give an imported theme a fresh id so it can never overwrite a theme that is already here.
  const name = typeof raw.name === 'string' ? raw.name : '';
  raw.id = newCustomId(name || 'imported', takenIds);
  const def = normalizeDef(raw);
  if (!def) return { ok: false, error: 'The theme file is missing a name or its colours are not valid.' };
  return { ok: true, def };
}

/** Starting colours copied from a built-in theme, so a designer can begin from something close. */
export function defFromTheme(theme: UiTheme): Omit<CustomThemeDef, 'id'> {
  const hex = (t: Triplet) => {
    const [h, s, l] = t.replace(/%/g, '').split(/\s+/).map(Number);
    return hslToHex({ h, s, l });
  };
  return {
    name: `${theme.name} copy`.slice(0, 32),
    look: theme.family === 'retail' ? 'retail' : 'modern',
    dark: !!theme.dark,
    accent: hslToHex(theme.accent),
    page: hex(theme.surface.background),
    panel: theme.surface.card ? hex(theme.surface.card) : '#ffffff',
    text: hex(theme.surface.foreground),
    sidebarStyle: theme.sidebar,
    sidebarColor: theme.sidebarColor ? hex(theme.sidebarColor) : DEFAULT_CUSTOM_DEF.sidebarColor,
  };
}

