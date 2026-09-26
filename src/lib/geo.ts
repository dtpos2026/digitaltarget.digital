// Geo helpers — uses OpenStreetMap Nominatim (free, no API key)
// and the browser Geolocation API. Designed for DT POS Location Intelligence.

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  city?: string;
  country?: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';

/** Forward geocode: address text -> coordinates. */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address || address.trim().length < 3) return null;
  try {
    const url = `${NOMINATIM}/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const arr = await res.json();
    const r = arr[0];
    if (!r) return null;
    return {
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      displayName: r.display_name,
      city: r.address?.city || r.address?.town || r.address?.village || r.address?.county,
      country: r.address?.country,
    };
  } catch { return null; }
}

/** Reverse geocode: coordinates -> address. */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  try {
    const url = `${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const r = await res.json();
    return {
      lat, lng,
      displayName: r.display_name || '',
      city: r.address?.city || r.address?.town || r.address?.village || r.address?.county,
      country: r.address?.country,
    };
  } catch { return null; }
}

/**
 * High-accuracy browser geolocation.
 * Uses watchPosition to wait for a GPS-quality fix instead of accepting
 * the first cached/wifi-based reading (which is often km off).
 *
 * - desiredAccuracyM: stop early once accuracy <= this many meters (default 50m)
 * - timeoutMs: max time to wait; returns best fix seen so far
 */
/**
 * ===== v1.62.0 — "accurate pin location q nhi btata ... on time location" =====
 *
 * Three things were wrong here, and the first one is the worst kind:
 *
 *  1. desiredAccuracyM WAS DOCUMENTED AND NEVER READ. The comment above this
 *     function promised "stop early once accuracy <= this many meters
 *     (default 50m)". The body did not mention opts.desiredAccuracyM once. It
 *     took the FIRST fix the browser offered and resolved, whatever its
 *     accuracy — so a 2000-metre network fix and a 5-metre GPS fix were
 *     treated identically. Every caller passing that option was passing it
 *     into nothing.
 *
 *  2. IT RETURNED STALE POSITIONS. maximumAge 60000 on the fast path and
 *     300000 on the fallback means the browser was explicitly allowed to hand
 *     back a cached fix up to one minute — or FIVE minutes — old. For a rider
 *     on the move that is the wrong place entirely, which is precisely the
 *     "on time location" complaint.
 *
 *  3. NOBODY COULD TELL. The accuracy never left this function, so no screen
 *     could say "this pin is roughly 1.2 km out" and no operator could know a
 *     delivery pin was worthless.
 *
 * The fix is to WAIT rather than to ask once. A GPS chip reports progressively
 * better fixes over a few seconds: watchPosition collects them, keeps the best
 * so far, and stops as soon as one is good enough — or when the deadline
 * passes, in which case the best seen is returned rather than nothing. That is
 * what the doc always claimed and is how a phone gets a real fix.
 *
 * getBestBrowserLocation() returns the accuracy alongside the position, so a
 * screen can show it and refuse to treat 1200m as a delivery pin.
 */
export interface LocationFix {
  position: GeolocationPosition;
  /** Radius of 68% confidence, in metres, as the browser reports it. */
  accuracyM: number;
  /** True when the fix never reached the accuracy that was asked for. */
  approximate: boolean;
}

export function getBestBrowserLocation(
  opts: { desiredAccuracyM?: number; timeoutMs?: number } = {},
): Promise<LocationFix> {
  const desired = opts.desiredAccuracyM ?? 50;
  const timeoutMs = opts.timeoutMs ?? 12000;

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('This device cannot report its location.'));
    }

    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId); } catch { /* already gone */ }
      }
      clearTimeout(timer);
      if (!best) {
        return reject(new Error('Could not get a location fix — check that location is switched on.'));
      }
      const accuracyM = best.coords.accuracy ?? Number.POSITIVE_INFINITY;
      resolve({ position: best, accuracyM, approximate: accuracyM > desired });
    };

    const timer = setTimeout(finish, timeoutMs);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Keep the tightest fix seen. Accuracy generally improves as the GPS
        // chip warms up, but it is not monotonic, so compare rather than
        // assume the newest is the best.
        if (!best || (pos.coords.accuracy ?? Infinity) < (best.coords.accuracy ?? Infinity)) {
          best = pos;
        }
        if ((best.coords.accuracy ?? Infinity) <= desired) finish();
      },
      (err) => {
        // A denial is final — waiting out the timeout would only make the
        // screen feel broken. Anything else may still improve, so keep going
        // and let the deadline decide.
        if (err?.code === err?.PERMISSION_DENIED) {
          if (done) return;
          done = true;
          if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch {} }
          clearTimeout(timer);
          reject(new Error('Location permission was refused — allow it in the browser to drop a pin.'));
        }
      },
      // No maximumAge: a cached fix is exactly what was wrong before.
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}

/** Backwards-compatible wrapper: same shape as before, now actually accurate. */
export function getBrowserLocation(
  opts: { desiredAccuracyM?: number; timeoutMs?: number } = {}
): Promise<GeolocationPosition> {
  return getBestBrowserLocation(opts).then(f => f.position);
}

/** How to describe a fix to somebody who has to trust it. */
export function describeAccuracy(accuracyM: number): string {
  if (!Number.isFinite(accuracyM)) return 'Accuracy unknown';
  if (accuracyM <= 20)  return `GPS pin · ±${Math.round(accuracyM)} m`;
  if (accuracyM <= 100) return `Good · ±${Math.round(accuracyM)} m`;
  if (accuracyM <= 500) return `Rough · ±${Math.round(accuracyM)} m — move outside for a better pin`;
  return `Approximate only · ±${(accuracyM / 1000).toFixed(1)} km — this is a network estimate, not GPS`;
}

/** Returns true if a device's lastActiveAt timestamp counts as "online". */
export function isOnline(lastActive: number | undefined | null, thresholdMs = 5 * 60 * 1000): boolean {
  if (!lastActive) return false;
  return Date.now() - lastActive < thresholdMs;
}

/** Convert a Firestore Timestamp / number / string into ms epoch. */
export function tsToMs(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
