// ============================================================
// BRANCH MANAGEMENT — the two reads that live only in the cloud (v1.87.0)
//
// Devices (which tills belong to which branch and when each was last seen) and the staff list (who is assigned to which
// branch). Both are small, read once per screen and cached for a minute, so opening the branch screens does not
// become a stream of requests. Offline, they say so instead of showing an empty list as if nobody worked there.
// ============================================================
import type { DeviceRow, StaffRow } from './branchHub';

export type CloudList<T> = { ok: true; rows: T[]; at: number } | { ok: false; error: string };

const TTL = 60_000;
const cache = new Map<string, { at: number; value: CloudList<unknown> }>();

async function cached<T>(key: string, load: () => Promise<T[]>, force = false): Promise<CloudList<T>> {
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL && hit.value.ok) return hit.value as CloudList<T>;
  try {
    const rows = await load();
    const value: CloudList<T> = { ok: true, rows, at: Date.now() };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: 'Offline — this list needs a connection' };
    return { ok: false, error: (e as { message?: string })?.message || 'Could not load from the cloud' };
  }
}

/** The restaurant's devices with their branch and last heartbeat (the Devices page reads the same table). */
export function loadDevices(force = false): Promise<CloudList<DeviceRow>> {
  return cached('devices', async () => {
    const { sb } = await import('./supabase');
    const { getTenantId } = await import('./tenant');
    const tid = getTenantId();
    if (!tid) return [];
    const { data, error } = await sb().from('devices')
      .select('id,device_label,platform,branch_id,last_seen_at,approved,blocked')
      .eq('tenant_id', tid);
    if (error) throw error;
    return ((data ?? []) as { id: string; device_label: string | null; platform: string | null; branch_id: string | null; last_seen_at: string | null; approved: boolean; blocked: boolean }[])
      .map(d => ({ id: d.id, label: d.device_label || 'Device', platform: d.platform || undefined, branchId: d.branch_id, lastSeenAt: d.last_seen_at, approved: d.approved, blocked: d.blocked }));
  }, force);
}

/** Staff with their role and branch (the Users page reads the same list). Passwords never leave the database. */
export function loadStaff(force = false): Promise<CloudList<StaffRow>> {
  return cached('staff', async () => {
    const { usingSupabaseAuth } = await import('./authProvider');
    if (!usingSupabaseAuth()) {
      const { getUsers } = await import('./store');
      return getUsers().map(u => ({ id: u.id, name: u.name, role: u.role, branchId: u.branchId || null, active: u.isActive !== false }));
    }
    const { sb } = await import('./supabase');
    const { data, error } = await sb().rpc('pos_list_users');
    if (error) throw error;
    return ((data ?? []) as { user_id: string; display_name: string | null; username: string; role: string; branch_id: string | null; is_active: boolean | null }[])
      .map(r => ({ id: r.user_id, name: r.display_name || r.username, role: r.role, branchId: r.branch_id, active: r.is_active !== false }));
  }, force);
}

/** Forget what was read (sign-out, restaurant switch, tests). */
export function clearBranchCloudCache() { cache.clear(); }
