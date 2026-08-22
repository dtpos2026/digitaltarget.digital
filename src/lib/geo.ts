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
export function getBrowserLocation(
  opts: { desiredAccuracyM?: number; timeoutMs?: number } = {}
): Promise<GeolocationPosition> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Browser geolocation not supported'));
    // Fast path: ask once with high accuracy, allow a recent cached fix (instant return)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => {
        // Fallback: try without high accuracy + larger cache window
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => reject(new Error(err?.message || 'Location denied')),
          { enableHighAccuracy: false, maximumAge: 300000, timeout: timeoutMs }
        );
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: timeoutMs }
    );
  });
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
