// Offline session cache — allows a previously-online user to log back in
// when the internet is off. Password is NEVER stored. Only a lightweight
// profile snapshot is cached in localStorage (per-tenant, per-email).
//
// Called from OwnerLoginPage.tsx / LoginPage.tsx after a successful online
// login, and from the offline-login button when navigator.onLine === false.

export interface OfflineSessionProfile {
  tenantId: string;
  tenantName?: string;
  userId: string;
  email: string;
  displayName?: string;
  role?: string;
  permissions?: string[];
  deviceId?: string;
  restaurantId?: string;
  branchId?: string;
  cachedAt: number; // ms
}

const KEY_PREFIX = 'pos-offline-session::';
const INDEX_KEY = 'pos-offline-session-index'; // list of email keys we've cached

function keyFor(email: string): string {
  return KEY_PREFIX + email.trim().toLowerCase();
}

/** Store a session snapshot after a SUCCESSFUL online login. */
export function cacheOnlineSession(p: Omit<OfflineSessionProfile, 'cachedAt'>): void {
  try {
    const payload: OfflineSessionProfile = { ...p, cachedAt: Date.now() };
    localStorage.setItem(keyFor(p.email), JSON.stringify(payload));
    // Maintain index of emails we know about (used by "cached user" dropdown).
    const idx = getCachedEmails();
    if (!idx.includes(p.email.toLowerCase())) {
      idx.push(p.email.toLowerCase());
      localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
    }
  } catch { /* ignore quota errors */ }
}

/** Read the cached profile for an email — null if never cached. */
export function readCachedSession(email: string): OfflineSessionProfile | null {
  try {
    const raw = localStorage.getItem(keyFor(email));
    if (!raw) return null;
    return JSON.parse(raw) as OfflineSessionProfile;
  } catch { return null; }
}

/** Emails we have offline-login data for (used to build a dropdown). */
export function getCachedEmails(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

/** Remove ONE cached email (e.g. from a "forget me" button). */
export function forgetCachedEmail(email: string): void {
  try {
    localStorage.removeItem(keyFor(email));
    const idx = getCachedEmails().filter((e) => e !== email.trim().toLowerCase());
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  } catch { /* ignore */ }
}

/** True if browser reports offline. Best-effort only. */
export function isBrowserOffline(): boolean {
  try { return typeof navigator !== 'undefined' && navigator.onLine === false; } catch { return false; }
}

/** Should we attempt offline login for this email? */
export function canOfflineLogin(email: string): boolean {
  const p = readCachedSession(email);
  if (!p) return false;
  // 30-day max — force periodic online re-auth.
  const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  return Date.now() - p.cachedAt < MAX_AGE;
}
