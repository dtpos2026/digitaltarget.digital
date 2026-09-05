// ============================================================================
// Which app is this install, and where must it open?
//
// REPORTED, about the Order Taker APK: "refresh krny py Rider Portal khul jata
// hai", and "logout pe main software ka email login aa jata hai". Both are the
// same fault seen twice.
//
// The Rider and Order Taker APKs are separate installs — separate package ids,
// separate names — but each is a WebView pointed at the website, and the ONLY
// thing that said which portal to show was the URL fragment:
//
//     https://digitaltarget.digital/#/rider-portal
//     https://digitaltarget.digital/#/order-taker
//
// A fragment is the most fragile part of a URL. Android drops it on a WebView
// restore after the process is killed, and any reload that does not carry it
// lands on "/" — where the app is the full POS and shows the owner's email
// login. Nothing was wrong with the Order Taker's own login screen; the app
// was never reaching it.
//
// So the app identity moves out of the fragment and into two places that
// survive:
//
//   1. A QUERY PARAMETER, which is part of the URL proper and is reloaded with
//      it: /?app=order-taker#/order-taker
//   2. localStorage, written the first time an install identifies itself, so
//      even a load that arrives with neither the query nor the fragment still
//      knows which app it is.
//
// The website is untouched: it is never opened with ?app=, and a plain browser
// visit is never redirected into a portal by the remembered value alone unless
// the person actually opened a portal here before AND asked for no page at
// all. See the guard in applyAppEntry().
// ============================================================================

export type PortalApp = 'rider' | 'order-taker' | 'customer';

const KEY = 'dt-portal-app';

/** Where each app belongs, and what counts as "already inside it". */
const HOME: Record<PortalApp, string> = {
  rider: '#/rider-portal',
  'order-taker': '#/order-taker',
  customer: '#/order',
};

function isPortalApp(v: unknown): v is PortalApp {
  return v === 'rider' || v === 'order-taker' || v === 'customer';
}

/** `?app=order-taker` — the marker the packaged app carries on every load. */
export function portalAppFromQuery(search?: string): PortalApp | null {
  const s = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (!s) return null;
  try {
    const v = new URLSearchParams(s).get('app');
    return isPortalApp(v) ? v : null;
  } catch { return null; }
}

/** What this install said it was, last time it told us. */
export function rememberedPortalApp(): PortalApp | null {
  try {
    const v = localStorage.getItem(KEY);
    return isPortalApp(v) ? v : null;
  } catch { return null; }
}

function remember(app: PortalApp) {
  try { localStorage.setItem(KEY, app); } catch { /* private mode */ }
}

/**
 * Put the app on its own route before anything reads the hash.
 *
 * Returns the app it decided this install is, or null for the website.
 * Pure URL work — no network, no store, safe to call before React mounts.
 */
export function applyAppEntry(): PortalApp | null {
  if (typeof window === 'undefined') return null;

  const declared = portalAppFromQuery();
  if (declared) {
    // The packaged app states its identity on every load, so this is the one
    // answer that cannot go stale.
    remember(declared);
    const hash = window.location.hash || '';
    // Already somewhere inside its own app — a deeper route like
    // #/order-taker/<tenant>/tables is kept, not reset to the first tab.
    if (!hash.startsWith(HOME[declared])) {
      window.location.hash = HOME[declared];
    }
    return declared;
  }

  // No marker. Only step in when the load carries NO route at all — that is
  // the restored-WebView case. A real page request, on the website or in the
  // app, is left exactly as it is.
  const hash = window.location.hash || '';
  if (hash !== '' && hash !== '#' && hash !== '#/') return rememberedPortalApp();

  const known = rememberedPortalApp();
  if (!known) return null;

  window.location.hash = HOME[known];
  return known;
}

/** Sign-out and app-reset paths use this so an install never forgets itself. */
export function clearPortalApp() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
