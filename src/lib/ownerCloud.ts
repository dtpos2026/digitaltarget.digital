// ============================================================
// OWNER APP — the one cloud write the phone makes itself: device approval (OWN-21), v1.91.0.
//
// The Devices page writes the same table the same way; the database's own rules decide who may (owners and admins), so
// a refusal comes back as an error and nothing is shown as done that was not.
// ============================================================
import { devicePatch, type DeviceAction } from './ownerAdmin';

export type CloudWrite = { ok: true } | { ok: false; error: string };

export async function actOnDevice(deviceId: string, action: DeviceAction): Promise<CloudWrite> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: 'You are offline — this needs a connection.' };
    const { sb } = await import('./supabase');
    const q = sb().from('devices');
    const patch = devicePatch(action);
    const { data, error } = patch
      ? await q.update(patch).eq('id', deviceId).select('id')
      : await q.delete().eq('id', deviceId).select('id');
    if (error) return { ok: false, error: error.message || 'Could not save.' };
    // An update the database's rules filter out matches no rows and raises no error (the same trap as v1.41.0).
    if (!data || data.length === 0) return { ok: false, error: 'Not allowed: only the owner or an admin can change devices.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as { message?: string })?.message || 'Could not reach the server.' };
  }
}
