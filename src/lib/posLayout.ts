// ============================================================
// POS LAYOUT ENGINE — panel sizes and product columns from real space.
//
// The product grid used to follow WINDOW breakpoints (xl → 6 columns), while
// the menu sidebar, the category panel and a fixed 380 px cart took their
// share first. At 1366×768 that squeezed 6 columns into ~550 px; on narrower
// screens the grid collapsed to 2–3 cramped columns.
//
// This module measures what the POS actually has (the container, after the
// app menu and header) and decides, in order:
//   1. the layout mode (wide / standard / narrow / square / portrait)
//   2. where the cart and categories go (side, top, bottom, drawer)
//   3. how wide the side panels are — shrinking them BEFORE giving up
//      product columns
//   4. how many product columns fit at a usable card width
//
// Pure functions only: the POS screen and the Settings preview call the same
// code, so the preview shows exactly what the POS will draw. Nothing here
// uses CSS transform/zoom scaling.
//
// Saved choices are per screen (resolution + scaling) and per machine, like
// printer settings — a till and a kitchen screen never share them.
// ============================================================

export type LayoutMode = 'wide' | 'standard' | 'narrow' | 'square' | 'portrait';
export type CardSize = 'small' | 'medium' | 'large';

export interface ScreenLayoutConfig {
  mode: 'auto' | LayoutMode;
  /** 2–8, or auto. */
  productColumns: 'auto' | number;
  cardSize: 'auto' | CardSize;
  /** Cart column width in px (260–600), or auto. */
  cartWidth: 'auto' | number;
  /** 'side' = a panel on the left of the products, 'right' = between the products and the bill. */
  categoryPlacement: 'auto' | 'top' | 'side' | 'right';
  /** Side category panel width in px (104–240), or auto. */
  categoryWidth: 'auto' | number;
  density: 'auto' | 'comfortable' | 'compact';
  /** The app's left menu while the POS screen is open. */
  menuCollapse: 'auto' | 'collapsed' | 'expanded';
  /** Calculator keypad in the cart: auto = the cashier's own toggle. */
  keypad: 'auto' | 'show' | 'hide';
}

export const AUTO_CONFIG: ScreenLayoutConfig = {
  mode: 'auto',
  productColumns: 'auto',
  cardSize: 'auto',
  cartWidth: 'auto',
  categoryPlacement: 'auto',
  categoryWidth: 'auto',
  density: 'auto',
  menuCollapse: 'auto',
  keypad: 'auto',
};

export interface LayoutInput {
  /** POS container width in CSS px (after the app menu). */
  width: number;
  /** POS container height in CSS px (after the header). */
  height: number;
  /** Coarse pointer (touchscreen) detected. */
  touch: boolean;
  /** The restaurant-wide category setting (Settings → POS display). */
  categoryLayoutSetting: 'top' | 'side' | 'right';
  /** The restaurant-wide "Menu items per row" (3–6): the most columns auto mode uses. */
  preferredColumns?: number;
  config: ScreenLayoutConfig;
}

export interface PosLayout {
  mode: LayoutMode;
  cartPlacement: 'side' | 'bottom' | 'drawer';
  cartWidth: number;
  cartHeight: number;
  categoryPlacement: 'top' | 'side' | 'right';
  categoryWidth: number;
  productColumns: number;
  /** True when a fixed column count had to be lowered to keep cards usable. */
  columnsLimited: boolean;
  cardSize: CardSize;
  cardWidth: number;
  cardImageHeight: number;
  density: 'comfortable' | 'compact';
  gap: number;
  padding: number;
  touch: boolean;
  /** Minimum height for tappable controls, px. */
  touchTarget: number;
  productAreaWidth: number;
  /**
   * A short screen (800×600, 1280×600 …): the bill keeps its rows visible by tucking
   * Discount / Promo behind one line and dropping the keyboard-shortcut strip.
   */
  short: boolean;
}

/** Below this POS height (after the header) the bill area is compacted. */
export const SHORT_HEIGHT = 680;

export const RESIZE_HANDLE = 6;
const SCROLLBAR = 8;
const CARD_MIN: Record<CardSize, number> = { small: 116, medium: 138, large: 162 };
/** Below this a card cannot show a name and a price legibly. */
const CARD_FLOOR = 88;
const TARGET_COLUMNS: Record<LayoutMode, number> = { wide: 6, standard: 5, narrow: 4, square: 4, portrait: 4 };
const CART: Record<Exclude<LayoutMode, 'portrait'>, { ratio: number; min: number; max: number; floor: number }> = {
  wide:     { ratio: 0.25, min: 360, max: 440, floor: 340 },
  standard: { ratio: 0.29, min: 320, max: 380, floor: 300 },
  narrow:   { ratio: 0.33, min: 280, max: 320, floor: 270 },
  square:   { ratio: 0.38, min: 290, max: 360, floor: 280 },
};
const CATEGORY: Record<LayoutMode, number> = { wide: 184, standard: 156, narrow: 124, square: 124, portrait: 124 };
const CATEGORY_FLOOR = 108;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function detectMode(width: number, height: number): LayoutMode {
  const aspect = width / Math.max(1, height);
  if (aspect < 0.95) return 'portrait';
  if (aspect < 1.35) return 'square';
  if (width >= 1450) return 'wide';
  if (width >= 980) return 'standard';
  return 'narrow';
}

function columnsFor(area: number, cardMin: number, gap: number): number {
  return Math.max(1, Math.floor((area + gap) / (cardMin + gap)));
}

export function computePosLayout(input: LayoutInput): PosLayout {
  const cfg = { ...AUTO_CONFIG, ...input.config };
  const width = Math.max(320, Math.round(input.width));
  const height = Math.max(320, Math.round(input.height));
  const mode: LayoutMode = cfg.mode === 'auto' ? detectMode(width, height) : cfg.mode;

  const density: PosLayout['density'] = cfg.density !== 'auto'
    ? cfg.density
    : (height < 700 || mode === 'narrow' ? 'compact' : 'comfortable');
  const gap = density === 'compact' ? 8 : 10;
  const padding = density === 'compact' ? 8 : 12;

  const cardSize: CardSize = cfg.cardSize !== 'auto'
    ? cfg.cardSize
    : (input.touch ? 'large' : mode === 'wide' ? 'medium' : 'small');
  const cardMin = CARD_MIN[cardSize];

  // --- cart ---
  let cartPlacement: PosLayout['cartPlacement'] = mode === 'portrait' ? 'bottom' : 'side';
  if (width < 640) cartPlacement = 'drawer';
  const cartSpec = CART[mode === 'portrait' ? 'square' : mode];
  let cartWidth = typeof cfg.cartWidth === 'number'
    ? clamp(cfg.cartWidth, 260, 600)
    : clamp(Math.round(width * cartSpec.ratio), cartSpec.min, cartSpec.max);
  const cartHeight = clamp(Math.round(height * 0.42), 300, 520);

  // --- categories ---
  const categoryPlacement: PosLayout['categoryPlacement'] = cfg.categoryPlacement !== 'auto'
    ? cfg.categoryPlacement
    : (mode === 'square' || mode === 'portrait' || cartPlacement === 'drawer' ? 'top' : input.categoryLayoutSetting);
  let categoryWidth = typeof cfg.categoryWidth === 'number' ? clamp(cfg.categoryWidth, 104, 240) : CATEGORY[mode];

  const area = () => width
    - (cartPlacement === 'side' ? cartWidth + RESIZE_HANDLE : 0)
    - (categoryPlacement !== 'top' ? categoryWidth : 0)
    - 2 * padding - SCROLLBAR;

  // Give side panels back to the products before giving up columns.
  const preferred = clamp(Math.round(input.preferredColumns || 6), 2, 8);
  const target = typeof cfg.productColumns === 'number' ? cfg.productColumns : Math.min(TARGET_COLUMNS[mode], preferred);
  if (columnsFor(area(), cardMin, gap) < target) {
    if (cartPlacement === 'side' && cfg.cartWidth === 'auto') cartWidth = cartSpec.floor;
    if (categoryPlacement !== 'top' && cfg.categoryWidth === 'auto') categoryWidth = CATEGORY_FLOOR;
  }
  const productAreaWidth = Math.max(0, area());

  let productColumns: number;
  let columnsLimited = false;
  if (typeof cfg.productColumns === 'number') {
    const wanted = clamp(Math.round(cfg.productColumns), 2, 8);
    const most = Math.max(2, columnsFor(productAreaWidth, CARD_FLOOR, gap));
    productColumns = Math.min(wanted, most);
    columnsLimited = productColumns < wanted;
  } else {
    productColumns = clamp(Math.min(columnsFor(productAreaWidth, cardMin, gap), preferred), 2, 8);
  }

  const cardWidth = Math.floor((productAreaWidth - gap * (productColumns - 1)) / productColumns);
  const cardImageHeight = clamp(Math.round(cardWidth * (density === 'compact' ? 0.5 : 0.6)), 52, 124);

  return {
    mode, cartPlacement, cartWidth, cartHeight, categoryPlacement, categoryWidth,
    productColumns, columnsLimited, cardSize, cardWidth, cardImageHeight,
    density, gap, padding,
    touch: input.touch,
    touchTarget: input.touch ? 48 : density === 'compact' ? 36 : 40,
    productAreaWidth,
    short: height < SHORT_HEIGHT,
  };
}

// ---------- the app menu on the POS screen ----------
export const MENU_EXPANDED = 230;
export const MENU_COLLAPSED = 64;
export const HEADER_HEIGHT = 48;

/** Whether the app's left menu should be collapsed while the POS is open. */
export function shouldCollapseMenu(windowW: number, windowH: number, config: ScreenLayoutConfig): boolean {
  if (config.menuCollapse === 'collapsed') return true;
  if (config.menuCollapse === 'expanded') return false;
  if (windowW < 1024) return false; // below lg the menu is an overlay anyway
  const aspect = windowW / Math.max(1, windowH);
  return windowW < 1440 || aspect < 1.4;
}

/** The POS container a window of this size gets (for the Settings preview). */
export function containerFor(windowW: number, windowH: number, config: ScreenLayoutConfig): { width: number; height: number; menuWidth: number } {
  const menuWidth = windowW < 1024 ? 0 : (shouldCollapseMenu(windowW, windowH, config) ? MENU_COLLAPSED : MENU_EXPANDED);
  return { width: windowW - menuWidth, height: windowH - HEADER_HEIGHT, menuWidth };
}

// ---------- screen facts ----------
const RATIOS: [number, string][] = [
  [16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [5 / 4, '5:4'], [3 / 2, '3:2'],
  [21 / 9, '21:9'], [32 / 9, '32:9'], [1, '1:1'], [9 / 16, '9:16'], [10 / 16, '10:16'], [3 / 4, '3:4'],
];

/** "16:9" for 1366×768 (which is really 683:384) — the nearest common ratio. */
export function aspectLabel(w: number, h: number): string {
  const r = w / Math.max(1, h);
  let best = RATIOS[0];
  for (const cand of RATIOS) if (Math.abs(cand[0] - r) < Math.abs(best[0] - r)) best = cand;
  if (Math.abs(best[0] - r) / best[0] < 0.04) return best[1];
  return `${(r >= 1 ? r : 1 / r).toFixed(2)}:1`;
}

export interface ScreenFacts {
  /** Window content size in CSS px (what the layout uses). */
  windowW: number; windowH: number;
  /** Monitor resolution in physical pixels. */
  screenW: number; screenH: number;
  /** Windows display scaling, e.g. 1.25 for 125 %. */
  scale: number;
  orientation: 'landscape' | 'portrait';
  aspect: string;
  touch: boolean;
  /** Key under which this screen's layout choices are saved. */
  signature: string;
}

export function readScreenFacts(): ScreenFacts {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const sw = typeof screen !== 'undefined' ? screen.width : 1366;
  const sh = typeof screen !== 'undefined' ? screen.height : 768;
  const screenW = Math.round(sw * dpr);
  const screenH = Math.round(sh * dpr);
  const windowW = typeof window !== 'undefined' ? window.innerWidth : sw;
  const windowH = typeof window !== 'undefined' ? window.innerHeight : sh;
  let touch = false;
  try {
    touch = (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
      || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0);
  } catch { /* no media queries */ }
  return {
    windowW, windowH, screenW, screenH, scale: Math.round(dpr * 100) / 100,
    orientation: screenW >= screenH ? 'landscape' : 'portrait',
    aspect: aspectLabel(screenW, screenH),
    touch,
    signature: `${screenW}x${screenH}@${Math.round(dpr * 100)}`,
  };
}

// ---------- saved per-screen choices (machine-local) ----------
export const SCREEN_LAYOUTS_KEY = 'dtpos-screen-layouts';
export const SCREEN_LAYOUT_EVENT = 'dtpos-screen-layout-changed';
const LEGACY_CART_WIDTH_KEY = 'dtpos-cart-width';

function readAll(): Record<string, Partial<ScreenLayoutConfig>> {
  try {
    const raw = JSON.parse(localStorage.getItem(SCREEN_LAYOUTS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

export function sanitizeConfig(c: Partial<ScreenLayoutConfig> | null | undefined): ScreenLayoutConfig {
  const out: ScreenLayoutConfig = { ...AUTO_CONFIG };
  if (!c) return out;
  const pick = <K extends keyof ScreenLayoutConfig>(k: K, allowed: readonly unknown[]) => {
    if (allowed.includes(c[k] as unknown)) (out[k] as unknown) = c[k];
  };
  pick('mode', ['auto', 'wide', 'standard', 'narrow', 'square', 'portrait']);
  pick('cardSize', ['auto', 'small', 'medium', 'large']);
  pick('categoryPlacement', ['auto', 'top', 'side', 'right']);
  pick('density', ['auto', 'comfortable', 'compact']);
  pick('menuCollapse', ['auto', 'collapsed', 'expanded']);
  pick('keypad', ['auto', 'show', 'hide']);
  if (typeof c.productColumns === 'number' && c.productColumns >= 2 && c.productColumns <= 8) out.productColumns = Math.round(c.productColumns);
  if (typeof c.cartWidth === 'number' && c.cartWidth >= 260 && c.cartWidth <= 600) out.cartWidth = Math.round(c.cartWidth);
  if (typeof c.categoryWidth === 'number' && c.categoryWidth >= 104 && c.categoryWidth <= 240) out.categoryWidth = Math.round(c.categoryWidth);
  return out;
}

export function loadScreenConfig(signature: string): ScreenLayoutConfig {
  const all = readAll();
  if (all[signature]) return sanitizeConfig(all[signature]);
  // v1.11 kept one dragged cart width for every screen. A width the cashier
  // chose on purpose (not the old 380 default) carries over once.
  const cfg = { ...AUTO_CONFIG };
  try {
    const legacy = Number(localStorage.getItem(LEGACY_CART_WIDTH_KEY));
    if (Number.isFinite(legacy) && legacy >= 260 && legacy <= 600 && legacy !== 380) cfg.cartWidth = Math.round(legacy);
  } catch { /* ignore */ }
  return cfg;
}

export function saveScreenConfig(signature: string, config: ScreenLayoutConfig): void {
  const all = readAll();
  all[signature] = sanitizeConfig(config);
  try { localStorage.setItem(SCREEN_LAYOUTS_KEY, JSON.stringify(all)); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(SCREEN_LAYOUT_EVENT)); } catch { /* non-browser */ }
}

export function resetScreenConfig(signature: string): void {
  const all = readAll();
  delete all[signature];
  try {
    localStorage.setItem(SCREEN_LAYOUTS_KEY, JSON.stringify(all));
    localStorage.removeItem(LEGACY_CART_WIDTH_KEY);
  } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(SCREEN_LAYOUT_EVENT)); } catch { /* non-browser */ }
}
