// ============================================================
// DISPLAY TEMPLATES — the look of the two screens customers and cooks watch.
//
// One model, two surfaces
// -----------------------
// The customer display and the kitchen board are different jobs, but they are
// the same KIND of thing: a full-screen board, read from a distance, whose
// colours and type scale should be a shop's choice rather than a developer's.
// So both are described by the same `DisplayTemplate` and both render from the
// same CSS custom properties. A template is data — no template ships its own
// component, so none of them can drift from the others or quietly stop
// showing an order.
//
// Whose brand is this
// -------------------
// The restaurant's. Digital Target writes the software; the shop it is
// installed in is the one whose customers are looking at the screen, so the
// logo, the name and (where the shop sets one) the accent colour are theirs.
// Digital Target appears once, small, as a developer credit — the same way a
// builder's plate sits by a door rather than across the front of the house.
// `DEVELOPER_CREDIT` is that line, and it is the only place the name belongs.
//
// Automatic mode
// --------------
// A shop plugs in whatever screen it has: a 1920x1080 TV, a 1366x768 monitor
// turned sideways, a small 4:3 panel over a counter. `pickAutoTemplate` reads
// the actual resolution and picks a template whose density and type scale suit
// it. It never stretches a layout to fit — the templates differ in how much
// they put on screen, not in how far they are scaled.
// ============================================================

export type DisplaySurface = 'customer' | 'kitchen';

/** The colours a template paints with. Every one is a CSS colour string. */
export interface DisplayTheme {
  /** Page background. */
  bg: string;
  /** Card / panel surface. */
  surface: string;
  /** Card border. */
  border: string;
  /** Primary text. */
  text: string;
  /** Secondary text — labels, wait times. */
  muted: string;
  /** The shop's accent: header band, headings. */
  accent: string;
  /** Text that sits on the accent. */
  onAccent: string;
  /** Orders being made. */
  preparing: string;
  /** Orders ready to collect. */
  ready: string;
  /** Late, cancelled, needs attention. */
  alert: string;
  /**
   * The CARD surface, and the text on it.
   *
   * Separate from `surface` because the boards are two-tone by design: a
   * coloured frame around light cards. A customer reads an order row, and a
   * cook reads a ticket, the way they read paper — dark text on light — while
   * the frame around it carries the shop's colour. Optional: a template that
   * does not set these gets white cards, which is what the printed designs
   * show.
   */
  panel?: string;
  onPanel?: string;
  panelMuted?: string;
  panelBorder?: string;
}

/**
 * The status colours, fixed across every template.
 *
 * These are not a matter of taste. A cook learns "red means it has not been
 * started" in their first shift and then reads the board by colour alone from
 * across the kitchen; a template that renamed those colours would cost them
 * that. So the palette is shared, and what a template changes is the frame
 * around it.
 */
export const STATUS_COLOURS = {
  new: '#EF4444',        // red — nobody has picked it up yet
  preparing: '#F59E0B',  // amber — being cooked
  ready: '#22C55E',      // green — go and collect it
  delivery: '#3B82F6',   // blue — out with a rider
  takeaway: '#7B2CBF',   // purple — waiting at the counter
  completed: '#9CA3AF',  // grey — done, and no longer anybody's job
} as const;

export type StatusKey = keyof typeof STATUS_COLOURS;

/** Card surface tokens, with the printed designs' white as the default. */
export function panelVars(t: DisplayTemplate): Record<string, string> {
  return {
    '--dt-panel': t.theme.panel || '#FFFFFF',
    '--dt-on-panel': t.theme.onPanel || '#1A1033',
    '--dt-panel-muted': t.theme.panelMuted || '#6B7280',
    '--dt-panel-border': t.theme.panelBorder || '#E5E7EB',
  };
}

export interface DisplayTemplate {
  id: string;
  name: string;
  surface: DisplaySurface;
  /** One line, shown in the picker. */
  description: string;
  theme: DisplayTheme;
  /** Corner radius in px. */
  radius: number;
  /** Multiplier on the base type scale. */
  typeScale: number;
  /** Multiplier on the order number specifically — the big-number templates. */
  numberScale: number;
  /** Share of the width the order columns take, when media is shown (%). */
  orderRatio: number;
  /** How much the board puts on screen at once. */
  density: 'comfortable' | 'compact';
  /**
   * The shape of the customer board.
   *
   *  'columns'     two status columns of number tiles, side by side.
   *  'now-serving' the shop's media on one side and a READ-DOWN LIST of
   *                orders on the other — number, what it is, and a READY
   *                badge. This is the layout on the printed mockups, and it
   *                is the better one for a queue: a list is read top to
   *                bottom the way people join a queue, and it has room for
   *                the item name and the table, which a bare number tile
   *                does not.
   *
   * And on the kitchen board:
   *
   *  'grid'         every active ticket in one wall, oldest first.
   *  'status-lanes' a lane per stage — NEW, PREPARING, READY, DELIVERY,
   *                 COMPLETED — which is the layout on the mockups. A cook
   *                 reads their own lane instead of scanning the whole wall
   *                 for the tickets that are theirs, and an order visibly
   *                 travels left to right as it is worked.
   */
  layout?: 'columns' | 'now-serving' | 'grid' | 'status-lanes';
  /**
   * Which screens this template suits, for automatic mode.
   * `minAspect`/`maxAspect` are width/height; `minWidth` is in CSS pixels.
   */
  suits: { minAspect?: number; maxAspect?: number; minWidth?: number };
}

/**
 * The developer credit. One line, one place.
 *
 * Kept as a constant so it cannot end up worded three different ways on three
 * screens, and so it is obvious at a glance that it appears nowhere else.
 */
export const DEVELOPER_CREDIT = 'Powered by Digital Target';

/**
 * The purple the shop asked their screens to be built around, and its
 * companions. Named rather than repeated so a future brand change is one edit.
 */
const PURPLE = '#3C096C';
const PURPLE_DEEP = '#240046';
const PURPLE_LIFT = '#5A189A';
const WHITE = '#FFFFFF';

// ---------------------------------------------------------------------------
// CUSTOMER DISPLAY TEMPLATES
// ---------------------------------------------------------------------------

export const CUSTOMER_TEMPLATES: DisplayTemplate[] = [
  {
    id: 'premium',
    name: 'Premium',
    surface: 'customer',
    description: 'Deep purple and white. The default: calm, high contrast, reads from across a room.',
    theme: {
      bg: PURPLE_DEEP, surface: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.16)',
      text: WHITE, muted: 'rgba(255,255,255,0.62)',
      accent: PURPLE, onAccent: WHITE,
      preparing: '#FFB703', ready: '#4ADE80', alert: '#F87171',
    },
    radius: 20, typeScale: 1, numberScale: 1, orderRatio: 40,
    density: 'comfortable', layout: 'now-serving', suits: { minAspect: 1.3 },
  },
  {
    id: 'modern',
    name: 'Modern',
    surface: 'customer',
    description: 'Near-black with a purple accent. Understated, suits a screen in a bright room.',
    theme: {
      bg: '#0B1220', surface: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)',
      text: WHITE, muted: 'rgba(255,255,255,0.55)',
      accent: PURPLE_LIFT, onAccent: WHITE,
      preparing: '#FBBF24', ready: '#22C55E', alert: '#EF4444',
    },
    radius: 16, typeScale: 1, numberScale: 1, orderRatio: 40,
    density: 'comfortable', layout: 'now-serving', suits: { minAspect: 1.3 },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    surface: 'customer',
    description: 'White background, black type. Nothing but the numbers.',
    theme: {
      bg: '#FFFFFF', surface: '#F4F4F5', border: '#D4D4D8',
      text: '#18181B', muted: '#71717A',
      accent: PURPLE, onAccent: WHITE,
      preparing: '#B45309', ready: '#15803D', alert: '#B91C1C',
    },
    radius: 12, typeScale: 1, numberScale: 1, orderRatio: 70,
    density: 'comfortable', suits: { minAspect: 1.3 },
  },
  {
    id: 'colorful',
    name: 'Colourful',
    surface: 'customer',
    description: 'Warm and saturated. For a family restaurant that wants the screen to be cheerful.',
    theme: {
      bg: '#1A0B2E', surface: 'rgba(255,255,255,0.09)', border: 'rgba(255,196,0,0.35)',
      text: WHITE, muted: 'rgba(255,255,255,0.65)',
      accent: '#7B2CBF', onAccent: WHITE,
      preparing: '#FF9E00', ready: '#06D6A0', alert: '#EF476F',
    },
    radius: 22, typeScale: 1, numberScale: 1, orderRatio: 65,
    density: 'comfortable', suits: { minAspect: 1.3 },
  },
  {
    id: 'restaurant',
    name: 'Restaurant',
    surface: 'customer',
    description: 'Warm neutrals and gold. Dine-in rooms where the screen should not shout.',
    theme: {
      bg: '#1C1917', surface: 'rgba(255,255,255,0.06)', border: 'rgba(212,175,55,0.35)',
      text: '#FAFAF9', muted: 'rgba(250,250,249,0.6)',
      accent: '#78350F', onAccent: '#FEF3C7',
      preparing: '#D4AF37', ready: '#84CC16', alert: '#DC2626',
    },
    radius: 14, typeScale: 1, numberScale: 1, orderRatio: 70,
    density: 'comfortable', suits: { minAspect: 1.3 },
  },
  {
    id: 'promotional',
    name: 'Promotional',
    surface: 'customer',
    description: 'Half the screen for deals and offers, half for the orders.',
    theme: {
      bg: PURPLE_DEEP, surface: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.18)',
      text: WHITE, muted: 'rgba(255,255,255,0.6)',
      accent: PURPLE, onAccent: WHITE,
      preparing: '#FFB703', ready: '#4ADE80', alert: '#F87171',
    },
    radius: 18, typeScale: 0.95, numberScale: 0.9, orderRatio: 50,
    density: 'compact', suits: { minAspect: 1.5 },
  },
  {
    id: 'large-order',
    name: 'Large Order',
    surface: 'customer',
    description: 'Order numbers as big as the screen allows. For a wide counter or a noisy hall.',
    theme: {
      bg: PURPLE_DEEP, surface: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.2)',
      text: WHITE, muted: 'rgba(255,255,255,0.6)',
      accent: PURPLE, onAccent: WHITE,
      preparing: '#FFB703', ready: '#4ADE80', alert: '#F87171',
    },
    radius: 24, typeScale: 1.1, numberScale: 1.6, orderRatio: 100,
    density: 'comfortable', suits: { minWidth: 1280 },
  },
  {
    id: 'order-ad',
    name: 'Order + Advert',
    surface: 'customer',
    description: 'Orders on the left, a standing advert panel on the right.',
    theme: {
      bg: '#10002B', surface: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.15)',
      text: WHITE, muted: 'rgba(255,255,255,0.58)',
      accent: PURPLE_LIFT, onAccent: WHITE,
      preparing: '#FFB703', ready: '#4ADE80', alert: '#F87171',
    },
    radius: 18, typeScale: 1, numberScale: 1, orderRatio: 38,
    density: 'comfortable', layout: 'now-serving', suits: { minAspect: 1.5 },
  },
  {
    id: 'media-focused',
    name: 'Media Focused',
    surface: 'customer',
    description: 'Mostly your video or banners, with a slim order strip beside them.',
    theme: {
      bg: '#000000', surface: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.14)',
      text: WHITE, muted: 'rgba(255,255,255,0.55)',
      accent: PURPLE, onAccent: WHITE,
      preparing: '#FBBF24', ready: '#22C55E', alert: '#EF4444',
    },
    radius: 14, typeScale: 0.9, numberScale: 0.85, orderRatio: 30,
    density: 'compact', layout: 'now-serving', suits: { minAspect: 1.5 },
  },
  {
    id: 'compact',
    name: 'Compact',
    surface: 'customer',
    description: 'Fits more on a small or square screen without shrinking the numbers.',
    theme: {
      bg: PURPLE_DEEP, surface: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.16)',
      text: WHITE, muted: 'rgba(255,255,255,0.6)',
      accent: PURPLE, onAccent: WHITE,
      preparing: '#FFB703', ready: '#4ADE80', alert: '#F87171',
    },
    radius: 12, typeScale: 0.85, numberScale: 0.85, orderRatio: 75,
    density: 'compact', suits: { maxAspect: 1.45 },
  },
];

// ---------------------------------------------------------------------------
// KITCHEN DISPLAY TEMPLATES
// ---------------------------------------------------------------------------
// A kitchen board is watched for a whole shift by people with their hands
// full, so these differ from the customer set in what they optimise: item
// legibility and how many tickets fit, not atmosphere.

export const KITCHEN_TEMPLATES: DisplayTemplate[] = [
  {
    id: 'clean',
    name: 'Clean',
    surface: 'kitchen',
    description: 'Black on white. The most legible option under kitchen lighting.',
    theme: {
      bg: '#FFFFFF', surface: '#F4F4F5', border: '#D4D4D8',
      text: '#18181B', muted: '#52525B',
      accent: '#27272A', onAccent: WHITE,
      preparing: '#1D4ED8', ready: '#15803D', alert: '#B91C1C',
    },
    radius: 12, typeScale: 1, numberScale: 1, orderRatio: 100,
    density: 'comfortable', layout: 'grid', suits: { minAspect: 1.3 },
  },
  {
    id: 'modern',
    name: 'Modern',
    surface: 'kitchen',
    description: 'The dark board the kitchen has been using. Amber for waiting, green for ready.',
    theme: {
      bg: '#000000', surface: '#18181B', border: '#3F3F46',
      text: '#FFFFFF', muted: '#A1A1AA',
      accent: '#18181B', onAccent: '#FFFFFF',
      preparing: '#3B82F6', ready: '#22C55E', alert: '#EF4444',
    },
    radius: 12, typeScale: 1, numberScale: 1, orderRatio: 100,
    density: 'comfortable', layout: 'status-lanes', suits: { minAspect: 1.3 },
  },
  {
    id: 'premium',
    name: 'Premium',
    surface: 'kitchen',
    description: 'Purple and white, matching the customer screen.',
    theme: {
      bg: PURPLE_DEEP, surface: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.18)',
      text: WHITE, muted: 'rgba(255,255,255,0.62)',
      accent: PURPLE, onAccent: WHITE,
      preparing: '#60A5FA', ready: '#4ADE80', alert: '#F87171',
    },
    radius: 18, typeScale: 1, numberScale: 1, orderRatio: 100,
    density: 'comfortable', layout: 'status-lanes', suits: { minAspect: 1.3 },
  },
  {
    id: 'compact',
    name: 'Compact',
    surface: 'kitchen',
    description: 'More tickets on screen at once. For a busy kitchen on one monitor.',
    theme: {
      bg: '#09090B', surface: '#18181B', border: '#3F3F46',
      text: '#FAFAFA', muted: '#A1A1AA',
      accent: '#18181B', onAccent: '#FAFAFA',
      preparing: '#3B82F6', ready: '#22C55E', alert: '#EF4444',
    },
    radius: 10, typeScale: 0.85, numberScale: 0.85, orderRatio: 100,
    density: 'compact', layout: 'status-lanes', suits: { maxAspect: 1.45 },
  },
  {
    id: 'large-order',
    name: 'Large Order',
    surface: 'kitchen',
    description: 'Fewer tickets, much bigger type. For a board read from several metres away.',
    theme: {
      bg: '#000000', surface: '#18181B', border: '#52525B',
      text: '#FFFFFF', muted: '#A1A1AA',
      accent: '#18181B', onAccent: '#FFFFFF',
      preparing: '#60A5FA', ready: '#4ADE80', alert: '#F87171',
    },
    radius: 16, typeScale: 1.25, numberScale: 1.5, orderRatio: 100,
    density: 'comfortable', layout: 'grid', suits: { minWidth: 1600 },
  },
  {
    id: 'colorful',
    name: 'Colourful',
    surface: 'kitchen',
    description: 'Stronger status colours, so a delayed ticket is unmissable.',
    theme: {
      bg: '#1A0B2E', surface: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.2)',
      text: WHITE, muted: 'rgba(255,255,255,0.65)',
      accent: '#7B2CBF', onAccent: WHITE,
      preparing: '#00B4D8', ready: '#06D6A0', alert: '#EF476F',
    },
    radius: 18, typeScale: 1, numberScale: 1.1, orderRatio: 100,
    density: 'comfortable', layout: 'status-lanes', suits: { minAspect: 1.3 },
  },
  {
    id: 'fast-kitchen',
    name: 'Fast Kitchen',
    surface: 'kitchen',
    description: 'Densest of all: item lines first, everything else stripped back.',
    theme: {
      bg: '#000000', surface: '#0F0F11', border: '#27272A',
      text: '#FFFFFF', muted: '#71717A',
      accent: '#000000', onAccent: '#FFFFFF',
      preparing: '#38BDF8', ready: '#4ADE80', alert: '#FB7185',
    },
    radius: 8, typeScale: 0.8, numberScale: 0.9, orderRatio: 100,
    density: 'compact', layout: 'grid', suits: { minWidth: 1280 },
  },
];

const BY_SURFACE: Record<DisplaySurface, DisplayTemplate[]> = {
  customer: CUSTOMER_TEMPLATES,
  kitchen: KITCHEN_TEMPLATES,
};

/** Every template for a surface, in picker order. */
export function templatesFor(surface: DisplaySurface): DisplayTemplate[] {
  return BY_SURFACE[surface];
}

/** Resolve an id to a template, falling back to the surface's first. */
export function templateById(surface: DisplaySurface, id: string | undefined): DisplayTemplate {
  const list = BY_SURFACE[surface];
  return list.find(t => t.id === id) || list[0];
}

/**
 * Choose a template from the screen's own dimensions.
 *
 * The rules are deliberately few, because a rule nobody can predict is worse
 * than no rule: a tall or square screen gets the compact template (it fits
 * more without shrinking the numbers), a very wide screen gets the large-order
 * one (there is room for the type), and everything in between gets the
 * surface's default. Nothing is scaled to fit — the templates differ in how
 * much they show, which is what actually helps on a small screen.
 */
export function pickAutoTemplate(
  surface: DisplaySurface,
  width: number,
  height: number,
): DisplayTemplate {
  const list = BY_SURFACE[surface];
  const fallback = list[0];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;

  const aspect = width / height;

  // Square-ish or portrait: fit more, keep the type readable.
  if (aspect <= 1.45) return list.find(t => t.id === 'compact') || fallback;

  // Wide and genuinely large: there is room for the big numbers.
  if (width >= (surface === 'kitchen' ? 1600 : 1280) && aspect >= 1.7) {
    return list.find(t => t.id === 'large-order') || fallback;
  }

  return fallback;
}

/**
 * The template as CSS custom properties.
 *
 * Returned as a plain style object so a page spreads it onto its root element
 * and every child reads `var(--dt-ready)` and so on. Templates therefore
 * cannot introduce their own markup or their own component, which is what
 * keeps ten of them from becoming ten places an order can fail to appear.
 */
export function templateVars(t: DisplayTemplate): Record<string, string> {
  return {
    '--dt-bg': t.theme.bg,
    '--dt-surface': t.theme.surface,
    '--dt-border': t.theme.border,
    '--dt-text': t.theme.text,
    '--dt-muted': t.theme.muted,
    '--dt-accent': t.theme.accent,
    '--dt-on-accent': t.theme.onAccent,
    '--dt-preparing': t.theme.preparing,
    '--dt-ready': t.theme.ready,
    '--dt-alert': t.theme.alert,
    '--dt-radius': `${t.radius}px`,
    '--dt-type': String(t.typeScale),
    '--dt-number': String(t.numberScale),
    ...panelVars(t),
    '--dt-status-new': STATUS_COLOURS.new,
    '--dt-status-preparing': STATUS_COLOURS.preparing,
    '--dt-status-ready': STATUS_COLOURS.ready,
    '--dt-status-delivery': STATUS_COLOURS.delivery,
    '--dt-status-takeaway': STATUS_COLOURS.takeaway,
    '--dt-status-completed': STATUS_COLOURS.completed,
  };
}

/**
 * A font size for an order number that FITS ITS OWN TILE.
 *
 * The bug this replaces was on the shop's screen: four-digit order numbers
 * printed as "#111" with the last digit sheared off, and "#1105" spilling
 * outside its tile. The number was sized from the VIEWPORT, while its tile is
 * only as wide as the column split and the column count leave it — so the
 * same font that fits "#12" on a wide screen cuts "#1105" on the same screen
 * the moment the shop gives the banners more room.
 *
 * `cqw` is a percentage of the TILE, not of the window, so the number is
 * measured against the box it actually has to fit in. The divisor is the
 * digit count: a bold tabular digit is about 0.62em wide, so N characters
 * need N x 0.62 x font, and 88% of the tile is what is left after the
 * padding. The result is capped so that a two-digit number does not become
 * absurd, and floored in px so a small screen stays readable.
 *
 * The tile must declare `container-type: inline-size` or `cqw` resolves
 * against the viewport and the bug comes straight back.
 */
export function fitNumberFont(text: string, scale = 1): string {
  const chars = Math.max(2, String(text || '').length);
  const CHAR_EM = 0.62;
  const USABLE = 88;
  const cqw = Math.min(34, USABLE / (CHAR_EM * chars)) * scale;
  return `clamp(1.1rem, ${cqw.toFixed(1)}cqw, ${(3.2 * scale).toFixed(2)}rem)`;
}

/**
 * A font size that scales with the template AND with the screen.
 *
 * `clamp` rather than a media query, so a 1366x768 monitor and a 4K TV both
 * get type in proportion to the screen rather than one of three fixed steps.
 * The floor keeps a small screen legible; the ceiling stops a 4K TV printing
 * two enormous digits and nothing else.
 */
export function scaledFont(baseRem: number, scale: number, vw = 1.2): string {
  const min = (baseRem * scale * 0.72).toFixed(2);
  const max = (baseRem * scale).toFixed(2);
  return `clamp(${min}rem, ${(vw * scale).toFixed(2)}vw + ${(baseRem * scale * 0.3).toFixed(2)}rem, ${max}rem)`;
}
