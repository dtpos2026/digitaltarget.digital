// ============================================================
// MODULE VISIBILITY — which modules the Modern sidebar shows, where, and in
// what order (Settings → Modules).
//
// This is a NAVIGATION preference and nothing else. Hiding a module removes a
// button; it does not delete data, does not switch the feature off, does not
// change who is allowed to open it (src/lib/permissions.ts still decides that
// — a module the user may not open never appears here at all) and does not
// change any route: a hidden module still opens from its address, from a
// shortcut on another screen, or from Settings → Modules.
//
// Stored on this device only, under one new key, in its own shape. No existing
// setting or record is read, renamed or migrated.
// ============================================================
import { useSyncExternalStore } from 'react';
import type { PageDef } from './permissions';

export type NavPlacement = 'main' | 'more' | 'hidden';

export interface NavPrefs {
  v: 1;
  /** Explicit placement per module key. A module with no entry gets its default. */
  placement: Record<string, NavPlacement>;
  /** Sidebar order. Modules not listed follow, in their default order. */
  order: string[];
  /** Starred modules — shown in a Favorites group at the top of the sidebar. */
  favorites: string[];
}

export const NAV_PREFS_KEY = 'dtpos-nav-prefs-v1';
export const NAV_PREFS_EVENT = 'dtpos-nav-prefs-changed';

/**
 * What a restaurant sees in the sidebar until it chooses otherwise: the
 * everyday floor and back-office screens. Everything else is one click away
 * under "More". The order is the order shown.
 */
export const DEFAULT_MAIN_KEYS = [
  'pos', 'tables', 'bills', 'kitchen', 'delivery', 'pickup',
  'dashboard', 'reports', 'menu', 'inventory', 'customers',
];

/** Cannot be hidden or moved: it is how a hidden module is brought back. */
export const LOCKED_KEYS = ['settings'];

export const EMPTY_NAV_PREFS: NavPrefs = { v: 1, placement: {}, order: [], favorites: [] };

const PLACEMENTS: NavPlacement[] = ['main', 'more', 'hidden'];

/** Whatever is stored, as a well-formed NavPrefs. Never throws. */
export function readNavPrefs(): NavPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(NAV_PREFS_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return EMPTY_NAV_PREFS;
    const placement: Record<string, NavPlacement> = {};
    if (raw.placement && typeof raw.placement === 'object') {
      for (const [k, v] of Object.entries(raw.placement)) {
        if (typeof k === 'string' && PLACEMENTS.includes(v as NavPlacement) && !LOCKED_KEYS.includes(k)) placement[k] = v as NavPlacement;
      }
    }
    const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
    return {
      v: 1,
      placement,
      order: Array.from(new Set(strings(raw.order))),
      favorites: Array.from(new Set(strings(raw.favorites))),
    };
  } catch {
    return EMPTY_NAV_PREFS;
  }
}

// One cached snapshot, so React's external-store check sees a stable object.
let snapshot: NavPrefs = EMPTY_NAV_PREFS;
let snapshotRaw: string | null | undefined;
function currentSnapshot(): NavPrefs {
  let raw: string | null = null;
  try { raw = localStorage.getItem(NAV_PREFS_KEY); } catch { /* storage locked */ }
  if (raw !== snapshotRaw) { snapshotRaw = raw; snapshot = readNavPrefs(); }
  return snapshot;
}

export function writeNavPrefs(next: NavPrefs): void {
  try { localStorage.setItem(NAV_PREFS_KEY, JSON.stringify(next)); } catch { /* session only */ }
  snapshotRaw = undefined;
  try { window.dispatchEvent(new CustomEvent(NAV_PREFS_EVENT)); } catch { /* no window */ }
}

export function resetNavPrefs(): void {
  try { localStorage.removeItem(NAV_PREFS_KEY); } catch { /* nothing to remove */ }
  snapshotRaw = undefined;
  try { window.dispatchEvent(new CustomEvent(NAV_PREFS_EVENT)); } catch { /* no window */ }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(NAV_PREFS_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(NAV_PREFS_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useNavPrefs(): NavPrefs {
  return useSyncExternalStore(subscribe, currentSnapshot, () => EMPTY_NAV_PREFS);
}

// ------------------------------------------------------------ resolving
export function placementOf(key: string, prefs: NavPrefs): NavPlacement {
  if (LOCKED_KEYS.includes(key)) return 'main';
  return prefs.placement[key] ?? (DEFAULT_MAIN_KEYS.includes(key) ? 'main' : 'more');
}

export interface ResolvedNav {
  /** Starred modules, in sidebar order (whatever their placement, unless hidden). */
  favorites: PageDef[];
  /** The sidebar, without the favorites. */
  main: PageDef[];
  /** Behind "More". */
  more: PageDef[];
  /** Off the navigation entirely (still open by address). */
  hidden: PageDef[];
  /** The always-present footer entry, when the user may open it. */
  locked: PageDef[];
}

/**
 * Splits the modules a user may open into the four places they can appear.
 * `pages` must already be filtered by role, permission and plan
 * (visiblePagesForUser): this only decides placement.
 */
export function resolveNav(pages: PageDef[], prefs: NavPrefs): ResolvedNav {
  const locked = pages.filter(p => LOCKED_KEYS.includes(p.key));
  const rest = pages.filter(p => !LOCKED_KEYS.includes(p.key));
  const rank = new Map<string, number>();
  prefs.order.forEach((k, i) => rank.set(k, i));
  const base = new Map<string, number>();
  rest.forEach((p, i) => base.set(p.key, DEFAULT_MAIN_KEYS.includes(p.key) ? DEFAULT_MAIN_KEYS.indexOf(p.key) : 1000 + i));
  const order = (a: PageDef, b: PageDef) => {
    const ra = rank.has(a.key) ? rank.get(a.key)! : 10000 + (base.get(a.key) ?? 0);
    const rb = rank.has(b.key) ? rank.get(b.key)! : 10000 + (base.get(b.key) ?? 0);
    return ra - rb;
  };
  const sorted = [...rest].sort(order);
  const star = new Set(prefs.favorites);
  const shown = sorted.filter(p => placementOf(p.key, prefs) !== 'hidden');
  return {
    favorites: shown.filter(p => star.has(p.key)),
    main: shown.filter(p => placementOf(p.key, prefs) === 'main' && !star.has(p.key)),
    more: shown.filter(p => placementOf(p.key, prefs) === 'more' && !star.has(p.key)),
    hidden: sorted.filter(p => placementOf(p.key, prefs) === 'hidden'),
    locked,
  };
}

// ------------------------------------------------------------ edits
/** All keys in the order the settings screen shows them, so a move is relative to what is on screen. */
function fullOrder(pages: PageDef[], prefs: NavPrefs): string[] {
  const r = resolveNav(pages, prefs);
  return [...r.favorites, ...r.main, ...r.more, ...r.hidden].map(p => p.key);
}

export function setPlacement(pages: PageDef[], prefs: NavPrefs, key: string, placement: NavPlacement): NavPrefs {
  if (LOCKED_KEYS.includes(key)) return prefs;
  return { ...prefs, order: fullOrder(pages, prefs), placement: { ...prefs.placement, [key]: placement } };
}

export function toggleFavorite(prefs: NavPrefs, key: string): NavPrefs {
  if (LOCKED_KEYS.includes(key)) return prefs;
  const has = prefs.favorites.includes(key);
  return { ...prefs, favorites: has ? prefs.favorites.filter(k => k !== key) : [...prefs.favorites, key] };
}

/** Moves a module one step up or down among the modules that share its placement. */
export function moveModule(pages: PageDef[], prefs: NavPrefs, key: string, dir: -1 | 1): NavPrefs {
  if (LOCKED_KEYS.includes(key)) return prefs;
  const order = fullOrder(pages, prefs);
  const place = placementOf(key, prefs);
  const peers = order.filter(k => placementOf(k, prefs) === place);
  const at = peers.indexOf(key);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= peers.length) return prefs;
  const other = peers[to];
  const next = [...order];
  const i = next.indexOf(key);
  const j = next.indexOf(other);
  [next[i], next[j]] = [next[j], next[i]];
  return { ...prefs, order: next };
}
