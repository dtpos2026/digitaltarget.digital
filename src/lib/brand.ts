// ============================================================================
// DT POS — the brand, in one place.
//
// Every surface that shows the brand reads it from here: the sign-in frame, the owner portal, the invoices,
// the Android icons and splash screens, the brand guide. A name, a phone number or a colour that appears in
// two places is a bug waiting to happen, so a test fails when a branded component stops using this file.
//
// Plain constants only (no imports), so Node can read this file too: `scripts/brand/build-brand-assets.mjs`
// generates every icon, splash screen and the brand guide from it.
// ============================================================================

export const BRAND = {
  name: 'Digital Target',
  wordmark: ['DIGITAL', 'TARGET'],
  product: 'DT POS Enterprise',
  poweredBy: 'Powered by Digital Target',
  tagline: 'Smarter Business with Digital Target',
  subtagline: 'Professional restaurant management, built for speed.',
  phones: ['+92 345 1873354', '+92 332 2373354'],
  phoneShort: '0345-1873354',
  email: 'digitaltarget.digital@gmail.com',
  web: 'www.digitaltarget.digital',
  facebook: '/digitaltargetpk',
  instagram: '@digitaltarget_pk',
  signatory: 'Hafiz Muhammad Taimoor Younas',
} as const;

/** The mark: four right triangles, one in each quarter of a 2 × 2 square (right angle at each cell's top-right). */
export const MARK_TRIANGLES = ['0,0 1,0 1,1', '1,0 2,0 2,1', '0,1 1,1 1,2', '1,1 2,1 2,2'] as const;

/** Proportions of the app icon (the master artwork is 1024 × 1024). */
export const ICON_GEOMETRY = {
  size: 1024,
  cornerRadius: 232,          // the squircle
  markSize: 500,              // the mark spans 500 of 1024 (49 %)
  markOrigin: 262,
  adaptiveMarkRatio: 0.40,    // on an Android adaptive foreground: 40 % of the canvas, inside the 61 % safe zone
} as const;

export const PALETTE = {
  purpleDeep: '#3c096c',
  purple: '#5b21b6',
  lavender: '#f3effc',
  ink: '#1a1523',
  muted: '#6b6478',
  white: '#ffffff',
} as const;

/** One icon colour per app, all in the same artwork: a three-stop gradient with a white mark on it. */
export interface BrandApp {
  id: 'pos' | 'customer' | 'rider' | 'ordertaker' | 'owner';
  /** What the app is called under its icon and on its splash screen. */
  label: string;
  /** Android folder in dtpos.apk, when the app is an Android app. */
  androidFolder?: 'Customer' | 'Rider' | 'OrderTaker' | 'Owner';
  packageId?: string;
  /** What the app is for, in the guide. */
  role?: string;
  /** The Lucide icon in the badge at the icon's lower right: the app's job, readable at launcher size. The POS has none — it is the brand itself. */
  glyph?: 'ShoppingBag' | 'Motorbike' | 'ClipboardList' | 'Crown';
  /** light → mid → dark gradient; `mid` is also the Android adaptive-icon background and the theme colour. */
  accent: { light: string; mid: string; dark: string; tint: string; shadow: string };
}

export const BRAND_APPS: readonly BrandApp[] = [
  { id: 'pos', label: 'DT POS', role: 'Billing, kitchen, owner portal, Super Admin',
    accent: { light: '#7c3aed', mid: '#4c1d95', dark: '#2e0a57', tint: '#ede9fe', shadow: '#1e0338' } },
  { id: 'customer', label: 'DT Customer', androidFolder: 'Customer', packageId: 'com.digitaltarget.dtcustomer', role: 'Customers order from a restaurant', glyph: 'ShoppingBag',
    accent: { light: '#dc2626', mid: '#b91c1c', dark: '#7f1d1d', tint: '#fee2e2', shadow: '#450a0a' } },
  { id: 'rider', label: 'DT Rider', androidFolder: 'Rider', packageId: 'com.digitaltarget.dtrider', role: 'Riders deliver orders', glyph: 'Motorbike',
    accent: { light: '#ea580c', mid: '#c2410c', dark: '#7c2d12', tint: '#ffedd5', shadow: '#431407' } },
  { id: 'ordertaker', label: 'DT Order Taker', androidFolder: 'OrderTaker', packageId: 'com.digitaltarget.dtordertaker', role: 'Waiters and order takers take orders at the table', glyph: 'ClipboardList',
    accent: { light: '#0d9488', mid: '#0f766e', dark: '#134e4a', tint: '#ccfbf1', shadow: '#042f2e' } },
  // v1.86.0 — the owner's phone app (design package OWN-01: DT purple with a crown badge).
  { id: 'owner', label: 'DT Owner', androidFolder: 'Owner', packageId: 'com.digitaltarget.dtowner', role: 'Owners and managers watch every branch from anywhere', glyph: 'Crown',
    accent: { light: '#6d28d9', mid: '#5b21b6', dark: '#3c096c', tint: '#ede9fe', shadow: '#1e0338' } },
];

/** Android launcher densities: legacy icon, adaptive foreground, portrait and landscape splash. */
export const ANDROID_DENSITIES = [
  { d: 'mdpi',    icon: 48,  fg: 108, port: [320, 480],   land: [480, 320] },
  { d: 'hdpi',    icon: 72,  fg: 162, port: [480, 800],   land: [800, 480] },
  { d: 'xhdpi',   icon: 96,  fg: 216, port: [720, 1280],  land: [1280, 720] },
  { d: 'xxhdpi',  icon: 144, fg: 324, port: [960, 1600],  land: [1600, 960] },
  { d: 'xxxhdpi', icon: 192, fg: 432, port: [1280, 1920], land: [1920, 1280] },
] as const;
