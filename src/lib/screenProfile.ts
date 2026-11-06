// ============================================================
// SCREEN PROFILE (v1.109.0) — every page adjusts itself to the screen it is on (master plan WP-3).
//
// ONE decision, made once, in ONE place, and written on <html> so every stylesheet and component reads the same answer:
//
//   data-screen   phone | tablet | desktop | tv         from the window's width
//   data-density  compact | comfortable                  a till at 1366×768 is tight; a phone or tablet is not
//   data-pointer  fine | coarse                          mouse or finger — a finger needs 44 px, a mouse 32–40
//   --page-gutter 12 | 16 | 24 | 32 px                   the one gutter every page uses
//   --grid-min-card 150 | 168 | 200 | 240 px             the smallest a card in a grid may be
//   --tap-min     44px on a finger, 0 on a mouse
//
// The POS keeps its own layout engine (posLayout.ts) for its three-panel screen; this is the same idea for every other page.
// The profile is measured, not guessed, and an owner can override the two choices that are a matter of taste (Settings →
// Appearance → Screen). The override is kept per machine, like printers.
// ============================================================

export type ScreenKind = 'phone' | 'tablet' | 'desktop' | 'tv';
export type Density = 'compact' | 'comfortable';
export type Pointer = 'fine' | 'coarse';

export interface ScreenProfile {
  kind: ScreenKind;
  density: Density;
  pointer: Pointer;
  /** Window width in CSS pixels. */
  width: number;
  gutter: number;
  minCard: number;
  /** The smallest a tap target may be, in px (0 on a mouse). */
  tapMin: number;
}

export interface ScreenOverride { kind?: ScreenKind | 'auto'; density?: Density | 'auto' }

/** Width breakpoints, in CSS pixels: below 640 a phone, below 1024 a tablet, below 2200 a desktop window, else a TV / 4K wall. */
export const BREAKPOINTS = { tablet: 640, desktop: 1024, tv: 2200 } as const;

const GUTTER: Record<ScreenKind, number> = { phone: 12, tablet: 16, desktop: 24, tv: 32 };
const MIN_CARD: Record<ScreenKind, number> = { phone: 150, tablet: 168, desktop: 200, tv: 240 };

export function kindForWidth(width: number): ScreenKind {
  if (width < BREAKPOINTS.tablet) return 'phone';
  if (width < BREAKPOINTS.desktop) return 'tablet';
  if (width < BREAKPOINTS.tv) return 'desktop';
  return 'tv';
}

/** Pure: the profile for a window of this size, on this kind of pointer, with the owner's override (if any). */
export function computeProfile(
  input: { width: number; height: number; coarse: boolean },
  override: ScreenOverride = {},
): ScreenProfile {
  const width = Math.max(0, Math.round(input.width));
  const kind: ScreenKind = override.kind && override.kind !== 'auto' ? override.kind : kindForWidth(width);
  const pointer: Pointer = input.coarse ? 'coarse' : 'fine';
  // A finger-driven or phone-sized screen is comfortable; a mouse on a short desktop window (a 1366×768 till) is compact.
  const auto: Density = pointer === 'coarse' || kind === 'phone' || kind === 'tablet' || kind === 'tv'
    ? 'comfortable'
    : (input.height < 800 ? 'compact' : 'comfortable');
  const density: Density = override.density && override.density !== 'auto' ? override.density : auto;
  return {
    kind, density, pointer, width,
    gutter: GUTTER[kind],
    minCard: MIN_CARD[kind],
    tapMin: pointer === 'coarse' ? 44 : 0,
  };
}

// ---- the owner's override, per machine

const KEY = 'dt-screen-override';

export function readScreenOverride(): ScreenOverride {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as ScreenOverride;
    const kinds = ['auto', 'phone', 'tablet', 'desktop', 'tv'];
    const dens = ['auto', 'compact', 'comfortable'];
    return {
      kind: kinds.includes(String(v.kind)) ? v.kind : 'auto',
      density: dens.includes(String(v.density)) ? v.density : 'auto',
    };
  } catch { return {}; }
}

export function writeScreenOverride(o: ScreenOverride): void {
  try {
    const clean: ScreenOverride = { kind: o.kind ?? 'auto', density: o.density ?? 'auto' };
    if (clean.kind === 'auto' && clean.density === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(clean));
  } catch { /* private mode: the choice lasts until reload */ }
  try { window.dispatchEvent(new Event('dt-screen-override')); } catch { /* ignore */ }
}

// ---- writing it on <html>

export function applyProfile(root: HTMLElement, p: ScreenProfile): void {
  root.dataset.screen = p.kind;
  root.dataset.density = p.density;
  root.dataset.pointer = p.pointer;
  root.style.setProperty('--page-gutter', `${p.gutter}px`);
  root.style.setProperty('--grid-min-card', `${p.minCard}px`);
  root.style.setProperty('--tap-min', `${p.tapMin}px`);
}

export function measureProfile(): ScreenProfile {
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
  return computeProfile(
    { width: typeof window !== 'undefined' ? window.innerWidth : 1366, height: typeof window !== 'undefined' ? window.innerHeight : 768, coarse },
    readScreenOverride(),
  );
}

let installed: (() => void) | null = null;

/** Measure now, and again whenever the window, the orientation or the override changes. Safe to call twice. */
export function installScreenProfile(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (installed) return installed;
  let pending = false;
  let handle = 0;
  const update = () => { applyProfile(document.documentElement, measureProfile()); };
  // One measurement per frame, however many resize events arrive (a boolean, so it holds even if a frame callback runs at once).
  const schedule = () => {
    if (pending) return;
    pending = true;
    handle = window.requestAnimationFrame(() => { pending = false; update(); });
  };
  update();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('dt-screen-override', schedule);
  window.addEventListener('storage', schedule);
  installed = () => {
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('dt-screen-override', schedule);
    window.removeEventListener('storage', schedule);
    if (pending) window.cancelAnimationFrame(handle);
    installed = null;
  };
  return installed;
}
