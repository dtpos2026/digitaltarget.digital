// v1.95.0 — the browser's side of the public storefront: ask the server once per visit, remember the answer on this
// device so the page opens with the right switches even with a slow connection, and never let a failed read stop the
// page (it then behaves exactly as it did before: the local settings).
import type { PublicStorefront } from './publicStorefront';

const CACHE_PREFIX = 'dt-public-storefront:';

export function getCachedStorefront(tenantId: string): PublicStorefront | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + tenantId);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && typeof v.name === 'string' ? (v as PublicStorefront) : null;
  } catch { return null; }
}

function cacheStorefront(tenantId: string, sf: PublicStorefront | null): void {
  try {
    if (sf) localStorage.setItem(CACHE_PREFIX + tenantId, JSON.stringify(sf));
    else localStorage.removeItem(CACHE_PREFIX + tenantId);
  } catch { /* storage blocked: the answer simply is not remembered */ }
}

/** The fresh answer, or the remembered one when the server cannot be reached, or null. */
export async function loadPublicStorefront(
  tenantId: string,
  fetcher?: (tenantId: string) => Promise<PublicStorefront | null>,
): Promise<PublicStorefront | null> {
  try {
    const ask = fetcher ?? (async (id: string) => {
      const { getPublicStorefront } = await import('@/lib/publicStorefront.functions');
      return (await getPublicStorefront({ data: { tenantId: id } })) as PublicStorefront | null;
    });
    const sf = await ask(tenantId);
    cacheStorefront(tenantId, sf);
    return sf;
  } catch (e) {
    console.warn('[storefront] could not be read; using the last answer on this device', e);
    return getCachedStorefront(tenantId);
  }
}
