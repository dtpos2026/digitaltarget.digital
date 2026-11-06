// ============================================================
// ERASE ON EVERY DEVICE (v1.110.0) — an erase made on one till must reach the others.
//
// The cloud copy of an order is overwritten by normal sync, but each browser also keeps a day-close archive and a local copy. So
// an erase leaves a small marker in the shared settings: a ONE-WAY HASH of the person's phone key (never the number itself) and the
// time. Every device, when it next opens or its settings change, hashes the phone keys it holds, and removes the people whose hash
// is on the list — but only what existed up to that time (a customer who ordered again afterwards is a new customer).
// ============================================================
import { getAllCustomerKeysForPrivacy, getSettings, redactLocalByKey, saveSettings, eraseCustomerPrivacyData } from '@/lib/store';
import { getTenantId } from '@/lib/tenant';
import { phoneKey } from '@/lib/privacy';

/** SHA-256 of the phone key, as the first 32 hex characters. */
export async function hashPhoneKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`dt-erase:${key}`));
  return Array.from(new Uint8Array(buf)).slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

const appliedKey = () => `dt-erasures-applied::${getTenantId() || 'local'}`;
const readApplied = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(appliedKey()) || '[]')); } catch { return new Set(); } };
const writeApplied = (s: Set<string>) => { try { localStorage.setItem(appliedKey(), JSON.stringify(Array.from(s).slice(-2000))); } catch { /* private mode */ } };

/** Erase here and leave the marker for every other device. */
export async function eraseEverywhere(phone: string) {
  const key = phoneKey(phone);
  const result = eraseCustomerPrivacyData(phone);
  if (!key) return { ...result, marked: false };
  const h = await hashPhoneKey(key);
  const s = getSettings();
  const list = (s.privacyErasures || []).filter(e => e.h !== h);
  saveSettings({ ...s, privacyErasures: [...list, { h, at: new Date().toISOString() }].slice(-1000) });
  const applied = readApplied(); applied.add(h); writeApplied(applied);   // this device has just done it
  return { ...result, marked: true };
}

/** Apply erase requests made elsewhere. Returns how many people were removed from this device. */
export async function applyPendingErasures(): Promise<number> {
  const pending = (getSettings().privacyErasures || []).filter(e => e && typeof e.h === 'string');
  const applied = readApplied();
  const todo = pending.filter(e => !applied.has(e.h));
  if (todo.length === 0) return 0;
  const byHash = new Map(todo.map(e => [e.h, e.at] as const));
  let removed = 0;
  for (const key of getAllCustomerKeysForPrivacy()) {
    const h = await hashPhoneKey(key);
    const at = byHash.get(h);
    if (at === undefined) continue;
    const r = redactLocalByKey(key, at);
    if (r.profileDeleted || r.liveOrders || r.archivedOrders) removed++;
  }
  todo.forEach(e => applied.add(e.h));
  writeApplied(applied);
  return removed;
}
