// ============================================================================
// What this build is — as far as the bundle itself can know.
//
// Android's real version is `versionName` in app/build.gradle, and the web
// bundle cannot read it: doing so needs a native plugin, more native surface to
// vendor and keep in step, for one string.
//
// So the version is written INTO the bundle at build time, alongside the
// restaurant it opens into, in dt-app.json. scripts/build-app.mjs writes it,
// and the APK repository's tools/brand.mjs rewrites both that file and
// build.gradle together, so the two cannot drift apart.
//
// A browser has no dt-app.json and gets null, which is correct: a website is
// never behind itself.
// ============================================================================
export interface AppBuildInfo {
  tenantId: string | null;
  appVersion: string | null;
}

let cached: AppBuildInfo | null = null;
let inFlight: Promise<AppBuildInfo> | null = null;

const EMPTY: AppBuildInfo = { tenantId: null, appVersion: null };

/** Read dt-app.json once. A missing file is the normal case on the web. */
export async function loadAppBuildInfo(): Promise<AppBuildInfo> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      if (typeof fetch !== 'function' || typeof document === 'undefined') return EMPTY;
      const url = new URL('dt-app.json', document.baseURI).toString();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return EMPTY;
      const raw = await res.json();
      cached = {
        tenantId: typeof raw?.tenantId === 'string' ? raw.tenantId : null,
        appVersion: typeof raw?.appVersion === 'string' ? raw.appVersion : null,
      };
      return cached;
    } catch {
      // Absent, unparseable, or blocked — all of them mean "this is not a
      // packaged build", which is a state, not a failure.
      return EMPTY;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test seam: forget what was read. */
export function resetAppBuildInfo(): void { cached = null; inFlight = null; }
