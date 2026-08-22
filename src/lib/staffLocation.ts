// ============================================================
// Consent-based Staff GPS Location History
// ------------------------------------------------------------
// Order Takers and Riders can switch location sharing ON. While it is
// on, a point is recorded every INTERVAL_MS into public.staff_locations
// so admins can see the CURRENT position and the VISITED ROUTE on a map.
// Nothing is recorded until the staff member gives consent, and consent
// can be withdrawn at any time.
// ============================================================
import { getDeviceMeta } from './tenant';

const CONSENT_KEY = 'pos-location-consent-v1';
const INTERVAL_MS = 60_000;         // one point per minute
const MIN_MOVE_M = 25;              // skip near-duplicate points

export interface StaffPoint {
  id: string;
  staffKey: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  lat: number;
  lng: number;
  accuracyM?: number;
  deviceName?: string;
  recordedAt: string;
}

export function hasLocationConsent(): boolean {
  try { return localStorage.getItem(CONSENT_KEY) === 'granted'; } catch { return false; }
}

export function setLocationConsent(granted: boolean) {
  try { localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied'); } catch { /* ignore */ }
  if (!granted) stopLocationTracking();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null) { return v && UUID_RE.test(v) ? v : null; }

function actor() {
  let name: string | undefined;
  try { name = localStorage.getItem('pos-user-name') || JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null')?.name; } catch { /* ignore */ }
  const id = localStorage.getItem('pos-user-id') || undefined;
  const role = localStorage.getItem('pos-user-role') || undefined;
  return { id, name, role, key: id || name || 'unknown' };
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

let timer: ReturnType<typeof setInterval> | null = null;
let last: { lat: number; lng: number } | null = null;

/** Start recording location points. No-op without consent. */
export function startLocationTracking(): boolean {
  if (!hasLocationConsent()) return false;
  if (timer) return true;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  void captureOnce();
  timer = setInterval(() => { void captureOnce(); }, INTERVAL_MS);
  return true;
}

export function stopLocationTracking() {
  if (timer) { clearInterval(timer); timer = null; }
  last = null;
}

export function isLocationTracking(): boolean { return timer !== null; }

/** Capture and store a single point (also used by "share now" buttons). */
export function captureOnce(): Promise<StaffPoint | null> {
  return new Promise((resolve) => {
    if (!hasLocationConsent() || typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (last && distanceM(last, p) < MIN_MOVE_M) { resolve(null); return; }
        last = p;
        const a = actor();
        let deviceName: string | undefined;
        try { deviceName = getDeviceMeta().deviceName; } catch { /* ignore */ }
        const point: StaffPoint = {
          id: `loc-${Date.now()}`,
          staffKey: a.key,
          userId: a.id,
          userName: a.name,
          userRole: a.role,
          lat: p.lat,
          lng: p.lng,
          accuracyM: pos.coords.accuracy,
          deviceName,
          recordedAt: new Date().toISOString(),
        };
        await pushPoint(point);
        resolve(point);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

async function pushPoint(point: StaffPoint) {
  try {
    const { usingSupabaseAuth, authTenantId } = await import('./authProvider');
    if (!usingSupabaseAuth()) return;
    const tenantId = authTenantId();
    if (!tenantId) return;
    const { getCurrentBranchId } = await import('./store');
    const { sb } = await import('./supabase');
    await sb().from('staff_locations').insert({
      tenant_id: tenantId,
      branch_id: uuidOrNull(getCurrentBranchId()),
      user_id: uuidOrNull(point.userId),
      staff_key: point.staffKey,
      user_name: point.userName ?? null,
      user_role: point.userRole ?? null,
      lat: point.lat,
      lng: point.lng,
      accuracy_m: point.accuracyM ?? null,
      device_name: point.deviceName ?? null,
      consent: true,
      recorded_at: point.recordedAt,
    });
  } catch { /* offline — next tick retries */ }
}

export interface LocationQuery { from?: string; to?: string; staffKey?: string; limit?: number }

/** Location history for the admin screen, newest first. */
export async function fetchLocationHistory(q: LocationQuery = {}): Promise<StaffPoint[]> {
  try {
    const { usingSupabaseAuth, authTenantId } = await import('./authProvider');
    const tenantId = usingSupabaseAuth() ? authTenantId() : null;
    if (!tenantId) return [];
    const { sb } = await import('./supabase');
    let req = sb().from('staff_locations').select('*')
      .eq('tenant_id', tenantId)
      .order('recorded_at', { ascending: false })
      .limit(q.limit || 2000);
    if (q.from) req = req.gte('recorded_at', q.from);
    if (q.to) req = req.lte('recorded_at', q.to);
    if (q.staffKey) req = req.eq('staff_key', q.staffKey);
    const { data, error } = await req;
    if (error) throw error;
    return (data || []).map((r: Record<string, unknown>): StaffPoint => ({
      id: String(r['id']),
      staffKey: String(r['staff_key']),
      userId: (r['user_id'] as string) || undefined,
      userName: (r['user_name'] as string) || undefined,
      userRole: (r['user_role'] as string) || undefined,
      lat: Number(r['lat']),
      lng: Number(r['lng']),
      accuracyM: (r['accuracy_m'] as number) ?? undefined,
      deviceName: (r['device_name'] as string) || undefined,
      recordedAt: String(r['recorded_at']),
    }));
  } catch {
    return [];
  }
}
