// ============================================================
// Blocked Customers & Blocked Locations — local store backed by
// localStorage (device-local for now; cloud sync can be added later).
// Used to prevent repeat fake / abusive orders.
// ============================================================
export interface BlockedCustomer {
  id: string;
  name: string;
  phone: string;            // normalized: digits only
  reason: string;
  blockedBy?: string;
  blockedByName?: string;
  blockedAt: string;        // ISO
  unblockAt?: string;       // ISO — when unblocked
  status: 'active' | 'unblocked';
  history?: Array<{ at: string; action: 'block' | 'unblock'; by?: string; reason?: string }>;
}

export interface BlockedLocation {
  id: string;
  areaName: string;
  lat?: number;
  lng?: number;
  radiusM?: number;          // meters
  reason: string;
  action: 'reject' | 'review'; // auto-reject OR send to approval queue
  blockedBy?: string;
  blockedByName?: string;
  blockedAt: string;
  unblockAt?: string;
  status: 'active' | 'unblocked';
  history?: Array<{ at: string; action: 'block' | 'unblock'; by?: string; reason?: string }>;
}

const KEY_C = 'pos-blocked-customers';
const KEY_L = 'pos-blocked-locations';
const EVT = 'dt-blocklist-changed';

function normalizePhone(p: string): string {
  return (p || '').replace(/\D/g, '');
}

function readList<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function writeList<T>(key: string, arr: T[]) {
  try { localStorage.setItem(key, JSON.stringify(arr)); } catch {}
  // Fraud controls must not be device-bound: mirror every change to the cloud.
  try { void import('./cloudDocs').then(m => m.mirrorList(key, arr as any[])); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch {}
}

export function onBlocklistChange(handler: () => void): () => void {
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

// ---------------- Customers ----------------
export function getBlockedCustomers(): BlockedCustomer[] { return readList<BlockedCustomer>(KEY_C); }

export function isCustomerBlocked(phone: string): BlockedCustomer | null {
  const p = normalizePhone(phone);
  if (!p) return null;
  return getBlockedCustomers().find(c => c.status === 'active' && c.phone === p) || null;
}

export function blockCustomer(input: { name: string; phone: string; reason: string; by?: string; byName?: string }): BlockedCustomer {
  const phone = normalizePhone(input.phone);
  const list = getBlockedCustomers();
  const existing = list.find(c => c.phone === phone);
  const now = new Date().toISOString();
  if (existing) {
    existing.status = 'active';
    existing.reason = input.reason;
    existing.blockedAt = now;
    existing.blockedBy = input.by;
    existing.blockedByName = input.byName;
    existing.name = input.name || existing.name;
    existing.history = [...(existing.history || []), { at: now, action: 'block', by: input.byName, reason: input.reason }];
    writeList(KEY_C, list);
    return existing;
  }
  const rec: BlockedCustomer = {
    id: `bc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name, phone, reason: input.reason,
    blockedBy: input.by, blockedByName: input.byName,
    blockedAt: now, status: 'active',
    history: [{ at: now, action: 'block', by: input.byName, reason: input.reason }],
  };
  list.push(rec);
  writeList(KEY_C, list);
  return rec;
}

export function unblockCustomer(id: string, by?: string): void {
  const list = getBlockedCustomers();
  const c = list.find(x => x.id === id);
  if (!c) return;
  const now = new Date().toISOString();
  c.status = 'unblocked';
  c.unblockAt = now;
  c.history = [...(c.history || []), { at: now, action: 'unblock', by }];
  writeList(KEY_C, list);
}

// ---------------- Locations ----------------
const EARTH_R = 6371000;
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

export function getBlockedLocations(): BlockedLocation[] { return readList<BlockedLocation>(KEY_L); }

/** Returns the matching blocked location (if any) for a given address/GPS pair. */
export function findBlockingLocation(opts: { address?: string; lat?: number; lng?: number }): BlockedLocation | null {
  const list = getBlockedLocations().filter(l => l.status === 'active');
  const addr = (opts.address || '').toLowerCase().trim();
  for (const l of list) {
    // GPS match
    if (typeof l.lat === 'number' && typeof l.lng === 'number' && typeof opts.lat === 'number' && typeof opts.lng === 'number') {
      const r = l.radiusM || 500;
      if (haversineM(l.lat, l.lng, opts.lat, opts.lng) <= r) return l;
    }
    // Area-name fuzzy match
    if (addr && l.areaName && addr.includes(l.areaName.toLowerCase().trim())) return l;
  }
  return null;
}

export function blockLocation(input: Omit<BlockedLocation, 'id' | 'blockedAt' | 'status' | 'history'> & { by?: string }): BlockedLocation {
  const list = getBlockedLocations();
  const now = new Date().toISOString();
  const rec: BlockedLocation = {
    id: `bl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    areaName: input.areaName, lat: input.lat, lng: input.lng, radiusM: input.radiusM,
    reason: input.reason, action: input.action || 'reject',
    blockedBy: input.blockedBy, blockedByName: input.blockedByName,
    blockedAt: now, status: 'active',
    history: [{ at: now, action: 'block', by: input.blockedByName, reason: input.reason }],
  };
  list.push(rec);
  writeList(KEY_L, list);
  return rec;
}

export function unblockLocation(id: string, by?: string): void {
  const list = getBlockedLocations();
  const l = list.find(x => x.id === id);
  if (!l) return;
  const now = new Date().toISOString();
  l.status = 'unblocked';
  l.unblockAt = now;
  l.history = [...(l.history || []), { at: now, action: 'unblock', by }];
  writeList(KEY_L, list);
}
