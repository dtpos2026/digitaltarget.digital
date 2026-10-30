// ============================================================================
// The reference theme set — 13 Modern + 8 DT Retail, as data
//
// Source: DESIGN_UI_A_TO_Z.md §3.2 / §3.3 (the offline DT Retail POS design
// package). Its own advice is "themes as data": a small table, and everything
// else derived — which is what this is. Accent, page background, sidebar
// style, text-on-accent, and (for DT Retail) the sidebar and hero gradients
// are the document's values; the rest of the palette is derived from them.
//
// Two deliberate departures from the document, both for readability:
//   * The accent is moved (hue and saturation untouched) until the text on it,
//     AND the accent used as text on the page, reach 4.5 : 1. The document
//     accepts 3 : 1 for white on its brand oranges and greens; a till is read at
//     arm's length, so we do not.
//   * Where one value cannot do both jobs (Sunny Yellow: dark text on a pale
//     accent; the two dark-page themes: an accent dark enough for white text is
//     too dark to read on a dark page) the theme also carries `--primary-text`,
//     a second shade used wherever the accent is text — the document's own
//     "two values for a light accent" rule.
//
// A theme here is CSS variables and nothing else. It cannot touch a bill, a
// price, stock, a user or a printer. Every theme is premium-gated, so a
// restaurant sees it only when Super Admin allows it; nobody else's screen moves.
// ============================================================================
import type { ThemeConfig } from './themes';
import { contrast, fmtHsl, hexToHsl, parseHsl, safeAccent, type HSL } from './colorContrast';

type Family = 'modern' | 'retail';

interface Spec {
  id: string;
  name: string;
  emoji: string;
  description: string;
  family: Family;
  /** Accent as the document gives it (before it is made readable). */
  accent: string;
  /** 'dark' = dark text sits on the accent. */
  textOnAccent: 'light' | 'dark';
  /** Page background, "h s% l%" or a #hex. */
  page: string;
  /** A dark PAGE (Black & Gold, Night). */
  darkPage?: boolean;
  /** Modern only: a dark sidebar. */
  darkSidebar?: string;
  /** Retail only: sidebar gradient, top then bottom. */
  sidebar?: readonly [string, string];
  /** Retail only: hero-banner gradient, start then end. */
  hero?: readonly [string, string];
  /** Retail only: the highlight colour (the "Popular" badge, the gold mark). */
  highlight?: string;
  /** Deeper shade for the accent used as text, when the accent itself is too light. */
  primaryText?: string;
}

const hsl = (s: string): HSL => (s.startsWith('#') ? hexToHsl(s) : parseHsl(s));

export const REFERENCE_THEME_SPECS = [
  // ---- 13 Modern ------------------------------------------------------------
  { id: 'ember', name: 'Ember Orange', emoji: '🔥', family: 'modern', accent: '16 88% 44%', textOnAccent: 'light', page: '40 18% 96%', description: 'Warm and appetising — the reference default.' },
  { id: 'tomato', name: 'Tomato Red', emoji: '🍅', family: 'modern', accent: '356 78% 45%', textOnAccent: 'light', page: '24 12% 96%', description: 'Bold pizza-menu red on clean white.' },
  { id: 'pizza', name: 'Red & Yellow', emoji: '🍕', family: 'modern', accent: '357 82% 46%', textOnAccent: 'light', page: '220 16% 96%', highlight: '#facc15', description: 'Fast-food brand look: red actions, yellow highlights, cream plates.' },
  { id: 'fresh', name: 'Fresh Green', emoji: '🥗', family: 'modern', accent: '152 62% 30%', textOnAccent: 'light', page: '148 24% 96%', description: 'Salad-bar green with a mint-white page.' },
  { id: 'sunny', name: 'Sunny Yellow', emoji: '🌞', family: 'modern', accent: '44 97% 52%', textOnAccent: 'dark', page: '48 46% 95%', primaryText: '34 90% 30%', description: 'Lemon yellow with dark, easy-to-read text on it.' },
  { id: 'white', name: 'Clean White', emoji: '⚪', family: 'modern', accent: '222 22% 14%', textOnAccent: 'light', page: '220 20% 98%', description: 'Milk-white and graphite. Calm and minimal.' },
  { id: 'ocean', name: 'Ocean Blue', emoji: '🌊', family: 'modern', accent: '217 80% 46%', textOnAccent: 'light', page: '214 34% 96%', description: 'Cool blue for a seafood or modern café.' },
  { id: 'coffee', name: 'Coffee Brown', emoji: '☕', family: 'modern', accent: '24 52% 30%', textOnAccent: 'light', page: '32 30% 95%', description: 'Latte cream and espresso brown, made for cafés.' },
  { id: 'rose', name: 'Rose Pink', emoji: '🌸', family: 'modern', accent: '336 76% 44%', textOnAccent: 'light', page: '340 32% 97%', description: 'Sweet-shop and bakery pink.' },
  { id: 'violet', name: 'Royal Purple', emoji: '💜', family: 'modern', accent: '271 70% 38%', textOnAccent: 'light', page: '266 32% 97%', description: 'Deep purple, close to the Digital Target brand.' },
  { id: 'teal', name: 'Mint Teal', emoji: '🍃', family: 'modern', accent: '176 70% 29%', textOnAccent: 'light', page: '176 28% 96%', description: 'Fresh teal, light and clean.' },
  { id: 'charcoal', name: 'Charcoal Orange', emoji: '⚫', family: 'modern', accent: '16 88% 44%', textOnAccent: 'light', page: '40 18% 96%', darkSidebar: '220 10% 13%', description: 'Dark charcoal sidebar with the orange accent.' },
  { id: 'navy', name: 'Navy Night', emoji: '🌙', family: 'modern', accent: '217 80% 46%', textOnAccent: 'light', page: '214 34% 96%', darkSidebar: '222 45% 14%', description: 'Deep navy sidebar with a bright blue accent.' },

  // ---- 8 DT Retail ----------------------------------------------------------
  { id: 'dtr-royal', name: 'DT Royal Purple', emoji: '👑', family: 'retail', accent: '263 70% 50%', textOnAccent: 'light', page: '#f4f2f9', sidebar: ['265 79% 18%', '265 88% 10%'], hero: ['270 85% 21%', '259 82% 66%'], highlight: '#f5b301', description: 'Digital Target signature — deep purple luxury.' },
  { id: 'dtr-crimson', name: 'DT Crimson & White', emoji: '❤️', family: 'retail', accent: '0 72% 51%', textOnAccent: 'light', page: '#faf6f5', sidebar: ['356 58% 10%', '357 64% 5%'], hero: ['0 64% 31%', '0 81% 62%'], highlight: '#ffffff', description: 'Bold red with clean white cards.' },
  { id: 'dtr-gold', name: 'DT Black & Gold', emoji: '✨', family: 'retail', accent: '43 80% 46%', textOnAccent: 'dark', page: '#1a1810', darkPage: true, sidebar: ['0 0% 2%', '40 27% 4%'], hero: ['43 98% 19%', '46 77% 55%'], highlight: '#f6efdc', description: 'Dark luxury with gold accents.' },
  { id: 'dtr-emerald', name: 'DT Emerald', emoji: '💚', family: 'retail', accent: '161 94% 30%', textOnAccent: 'light', page: '#f2f8f5', sidebar: ['162 81% 12%', '160 80% 6%'], hero: ['164 86% 17%', '160 69% 43%'], highlight: '#ffffff', description: 'Fresh green — food and grocery.' },
  { id: 'dtr-sunset', name: 'DT Sunset Orange', emoji: '🌇', family: 'retail', accent: '21 90% 48%', textOnAccent: 'light', page: '#faf6f2', sidebar: ['18 67% 12%', '18 74% 6%'], hero: ['16 76% 29%', '26 94% 63%'], highlight: '#facc15', description: 'Warm, energetic and friendly.' },
  { id: 'dtr-ocean', name: 'DT Ocean Blue', emoji: '🐬', family: 'retail', accent: '200 98% 39%', textOnAccent: 'light', page: '#f1f6fa', sidebar: ['204 82% 16%', '203 87% 9%'], hero: ['202 81% 25%', '199 89% 61%'], highlight: '#ffffff', description: 'Calm, corporate and clear.' },
  { id: 'dtr-night', name: 'DT Night', emoji: '🌌', family: 'retail', accent: '258 90% 66%', textOnAccent: 'light', page: '#0b1120', darkPage: true, sidebar: ['221 53% 6%', '222 48% 11%'], hero: ['273 84% 22%', '259 87% 67%'], highlight: '#e6ebf5', description: 'Dark mode for dim shops.' },
  { id: 'dtr-espresso', name: 'DT Espresso Orange', emoji: '🟤', family: 'retail', accent: '21 90% 48%', textOnAccent: 'light', page: '#faf6f2', sidebar: ['17 68% 12%', '16 73% 6%'], hero: ['17 79% 32%', '25 91% 57%'], highlight: '#f5802d', description: 'Espresso brown and orange — the look of DT Retail POS v1.8.' },
] as const satisfies readonly Spec[];

export type ReferenceThemeId = typeof REFERENCE_THEME_SPECS[number]['id'];

export const REFERENCE_GROUP_MODERN = 'Premium · Modern collection';
export const REFERENCE_GROUP_RETAIL = 'Premium · DT Retail collection';

/** Build one full theme (the variable set the theme engine and picker expect) from its spec. */
export function buildReferenceTheme(spec: Spec): ThemeConfig & { group: string } {
  const [ph, ps, pl] = hsl(spec.page);
  const dark = !!spec.darkPage;
  const retail = spec.family === 'retail';

  // Surfaces first: the accent has to read AS TEXT on them (prices, links), not only carry text.
  const pageHsl: HSL = [ph, ps, pl];
  const cardHsl: HSL = dark ? [ph, ps, pl + 4] : [0, 0, 100];

  // 1. text ON the accent (buttons).
  let accent = safeAccent(hsl(spec.accent), spec.textOnAccent);
  // 2. on a light page a darker accent satisfies both uses with ONE value, so use it.
  //    (A dark-text accent — Sunny Yellow — cannot go darker; it carries `primaryText`.)
  let primaryText = spec.primaryText;
  const readsAsText = (c: HSL) => contrast(c, pageHsl) >= 4.5 && contrast(c, cardHsl) >= 4.5;
  if (!dark && spec.textOnAccent === 'light') {
    for (let i = 0; i < 60 && !readsAsText(accent); i++) accent = [accent[0], accent[1], accent[2] - 1];
  }
  // 3. on a dark page the accent that carries white text is too dark to read as text,
  //    so the document's two-value rule applies: a lighter shade for text.
  if (dark && !readsAsText(accent) && !primaryText) {
    let t: HSL = accent;
    for (let i = 0; i < 80 && !readsAsText(t); i++) t = [t[0], t[1], t[2] + 1];
    primaryText = fmtHsl(t);
  }
  const [ah] = accent;

  const primary = fmtHsl(accent);
  const onPrimary = spec.textOnAccent === 'light' ? '0 0% 100%' : `${r(ah)} 45% 9%`;

  // ---- page surfaces ------------------------------------------------------
  const background = fmtHsl([ph, ps, pl]);
  const foreground = dark ? `${r(ph)} 20% 92%` : `${r(ph)} 25% 11%`;
  const card = dark ? fmtHsl([ph, ps, pl + 4]) : '0 0% 100%';
  const muted = dark ? fmtHsl([ph, ps, pl + 7]) : fmtHsl([ph, Math.min(ps, 20), pl - 3]);
  const mutedFg = dark ? `${r(ph)} 14% 68%` : `${r(ph)} 12% 36%`;
  const border = dark ? fmtHsl([ph, 14, pl + 14]) : fmtHsl([ph, 18, pl - 8]);
  const input = dark ? fmtHsl([ph, 14, pl + 11]) : fmtHsl([ph, 18, pl - 10]);
  const secondary = dark ? `${r(ah)} 30% ${r(pl + 10)}%` : `${r(ah)} 45% 94%`;
  const secondaryFg = dark ? `${r(ah)} 40% 88%` : `${r(ah)} 55% 22%`;
  const accentNeutral = dark ? fmtHsl([ph, 20, pl + 9]) : fmtHsl([ph, 22, pl - 4]);

  // ---- sidebar ------------------------------------------------------------
  let sbBg: string, sbFg: string, sbAccent: string, sbAccentFg: string, sbBorder: string;
  const sbFrom = spec.sidebar?.[0];
  const sbTo = spec.sidebar?.[1];
  const darkSidebar = retail || !!spec.darkSidebar;
  if (retail) {
    sbBg = sbFrom!;
    const [sh, ss] = parseHsl(sbFrom!);
    sbFg = '0 0% 100%';
    sbAccent = fmtHsl([sh, Math.min(ss, 45), 22]);
    sbAccentFg = '0 0% 100%';
    sbBorder = fmtHsl([sh, Math.min(ss, 40), 20]);
  } else if (spec.darkSidebar) {
    sbBg = spec.darkSidebar;
    const [sh, ss, sl] = parseHsl(spec.darkSidebar);
    sbFg = '0 0% 96%';
    sbAccent = fmtHsl([sh, ss, sl + 8]);
    sbAccentFg = '0 0% 100%';
    sbBorder = fmtHsl([sh, ss, sl + 6]);
  } else {
    sbBg = '0 0% 100%';
    sbFg = `${r(ph)} 20% 20%`;
    sbAccent = fmtHsl([ph, 20, 95]);
    sbAccentFg = sbFg;
    sbBorder = fmtHsl([ph, 16, 91]);
  }

  // "gold" is the highlight the sidebar uses for the active item.
  const highlight = spec.highlight ? hsl(spec.highlight) : null;
  const lightened: HSL = [ah, accent[1], Math.max(62, accent[2])];
  // On a light sidebar "gold" is TEXT (the subtitle, the active icon), so it uses the readable shade.
  const gold = fmtHsl(darkSidebar ? (highlight ?? lightened) : (primaryText ? parseHsl(primaryText) : accent));
  const goldFg = contrast(gold, '0 0% 100%') >= 4.5 ? '0 0% 100%' : '222 30% 10%';

  const variables: Record<string, string> = {
    '--radius': retail ? '1rem' : '0.75rem',

    '--background': background,
    '--foreground': foreground,
    '--card': card,
    '--card-foreground': foreground,
    '--popover': card,
    '--popover-foreground': foreground,

    '--primary': primary,
    '--primary-foreground': onPrimary,

    '--secondary': secondary,
    '--secondary-foreground': secondaryFg,
    '--muted': muted,
    '--muted-foreground': mutedFg,
    '--accent': accentNeutral,
    '--accent-foreground': foreground,

    '--border': border,
    '--input': input,
    '--ring': primary,

    '--gold': gold,
    '--gold-foreground': goldFg,

    '--pos-sidebar': sbBg,
    '--pos-sidebar-foreground': sbFg,
    '--pos-cart': card,
    '--pos-grid-bg': background,

    '--sidebar-background': sbBg,
    '--sidebar-foreground': sbFg,
    '--sidebar-primary': primary,
    '--sidebar-primary-foreground': onPrimary,
    '--sidebar-accent': sbAccent,
    '--sidebar-accent-foreground': sbAccentFg,
    '--sidebar-border': sbBorder,
    '--sidebar-ring': primary,
  };

  if (primaryText) variables['--primary-text'] = primaryText;
  if (dark) variables['--theme-mode'] = 'dark';
  if (!darkSidebar) variables['--theme-sidebar'] = 'light';
  if (!retail) {
    // Modern themes had no hero gradient of their own, so the engine derived one from the sidebar's
    // accent tone — fine for a dark sidebar, but on a light one it ran to a pale tint and the white
    // banner text vanished (Sunny Yellow). Build it from the accent instead, kept deep enough for white.
    const base: HSL = spec.textOnAccent === 'light' ? accent : (primaryText ? parseHsl(primaryText) : safeAccent(accent, 'light'));
    variables['--hero-from'] = fmtHsl([base[0], base[1], Math.max(base[2] - 10, 12)]);
    variables['--hero-to'] = fmtHsl(base);
  }
  if (retail) {
    variables['--theme-look'] = 'retail';
    variables['--sidebar-gradient-from'] = sbFrom!;
    variables['--sidebar-gradient-to'] = sbTo!;
    variables['--hero-from'] = spec.hero![0];
    variables['--hero-to'] = spec.hero![1];
    variables['--brand-card-bg'] = sbTo!;
  }

  return {
    id: spec.id as ThemeConfig['id'],
    name: spec.name,
    description: spec.description,
    emoji: spec.emoji,
    group: retail ? REFERENCE_GROUP_RETAIL : REFERENCE_GROUP_MODERN,
    variables,
  };
}

const r = (n: number) => Math.round(n * 10) / 10;

export const referenceThemes = REFERENCE_THEME_SPECS.map(buildReferenceTheme);
