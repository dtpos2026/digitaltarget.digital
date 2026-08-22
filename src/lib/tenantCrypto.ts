// Per-tenant AES-GCM encryption for any locally cached sensitive data.
// Key is derived from the tenantId using PBKDF2 — same tenant on same device
// always derives the same key, but a different tenant CANNOT decrypt another
// tenant's cached blob (wrong key → decryption throws).
//
// This is defense-in-depth on top of Firestore security rules. Server-side
// isolation already guarantees no cross-tenant reads on the wire; this layer
// protects data at rest on the local device (localStorage / IndexedDB).

const enc = new TextEncoder();
const dec = new TextDecoder();

const PEPPER = 'dt-pos-v1-tenant-isolation-pepper';
const keyCache = new Map<string, CryptoKey>();

async function deriveKey(tenantId: string): Promise<CryptoKey> {
  const cached = keyCache.get(tenantId);
  if (cached) return cached;

  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(tenantId + '::' + PEPPER),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('dt-pos-salt::' + tenantId),
      iterations: 50_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache.set(tenantId, key);
  return key;
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encryptForTenant(tenantId: string, plain: string): Promise<string> {
  if (!tenantId) throw new Error('encryptForTenant: tenantId missing');
  const key = await deriveKey(tenantId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  // Envelope: v1.<tenantHashPrefix>.<iv>.<ct>
  return `v1.${tenantId.slice(0, 6)}.${toB64(iv.buffer)}.${toB64(ct)}`;
}

export async function decryptForTenant(tenantId: string, blob: string): Promise<string> {
  if (!tenantId) throw new Error('decryptForTenant: tenantId missing');
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Bad envelope');
  if (parts[1] !== tenantId.slice(0, 6)) throw new Error('Tenant mismatch — refusing cross-tenant decrypt');
  const iv = fromB64(parts[2]);
  const ct = fromB64(parts[3]);
  const key = await deriveKey(tenantId);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return dec.decode(pt);
}

export function clearTenantCryptoCache() {
  keyCache.clear();
}
