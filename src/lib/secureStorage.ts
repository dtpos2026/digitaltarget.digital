// Tenant-namespaced + encrypted localStorage wrapper.
//
// - Every key is automatically prefixed with `enc::<tenantId>::` so two
//   restaurants logged in on the same device (e.g. demo/test) NEVER read
//   each other's data — keys don't even collide.
// - Values are AES-GCM encrypted with a tenant-derived key, so even a
//   raw localStorage dump leaks nothing usable.
// - On tenant switch, all `enc::*` keys NOT belonging to the new tenant
//   are wiped from this device. (See wipeOtherTenants below.)

import { encryptForTenant, decryptForTenant, clearTenantCryptoCache } from './tenantCrypto';
import { getTenantId } from './tenant';

const PREFIX = 'enc::';

function nsKey(tenantId: string, key: string) {
  return `${PREFIX}${tenantId}::${key}`;
}

export async function secureSet(key: string, value: unknown): Promise<void> {
  const tid = getTenantId();
  if (!tid) throw new Error('secureSet: no active tenant');
  const blob = await encryptForTenant(tid, JSON.stringify(value));
  localStorage.setItem(nsKey(tid, key), blob);
}

export async function secureGet<T = unknown>(key: string): Promise<T | null> {
  const tid = getTenantId();
  if (!tid) return null;
  const raw = localStorage.getItem(nsKey(tid, key));
  if (!raw) return null;
  try {
    const pt = await decryptForTenant(tid, raw);
    return JSON.parse(pt) as T;
  } catch {
    // Corrupted or cross-tenant — drop silently to avoid leaks.
    localStorage.removeItem(nsKey(tid, key));
    return null;
  }
}

export function secureRemove(key: string): void {
  const tid = getTenantId();
  if (!tid) return;
  localStorage.removeItem(nsKey(tid, key));
}

/** Wipe every encrypted entry that does NOT belong to the given tenant. */
export function wipeOtherTenants(currentTenantId: string | null): number {
  let removed = 0;
  const keepPrefix = currentTenantId ? `${PREFIX}${currentTenantId}::` : null;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    if (!keepPrefix || !k.startsWith(keepPrefix)) {
      localStorage.removeItem(k);
      removed++;
    }
  }
  clearTenantCryptoCache();
  return removed;
}

/** Auto-wipe other tenants whenever the active tenant changes. */
if (typeof window !== 'undefined') {
  window.addEventListener('pos-tenant-change', (e: Event) => {
    const detail = (e as CustomEvent).detail as { to: string | null };
    wipeOtherTenants(detail?.to ?? null);
  });
  // Also clean on first load — be paranoid.
  try { wipeOtherTenants(getTenantId()); } catch { /* ignore */ }
}
