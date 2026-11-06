// ============================================================
// CUSTOM WEBSITE (v1.107.0) — a restaurant's OWN food-order website sends its orders into the software.
//
// This module is pure (no network, no database) so the browser, the server and the tests share one definition of:
//   • the three modes (built-in website · my own website · both),
//   • how a request is signed and checked (HMAC-SHA256 over "<timestamp>.<body>", ±5 minutes, one idempotency key),
//   • what an order from the site must look like, and how it becomes the shape public/custom_site_place_order accepts,
//   • which of the owner's switches can refuse it.
//
// The software stores NO password of the site. The owner signs in to that site (or its admin panel) in a new tab.
// ============================================================
import { z } from 'zod';
import { orderingBlockedReason, type PublicStorefront } from '@/lib/publicStorefront';

export type CustomSiteMode = 'builtin' | 'own' | 'both';

export const CUSTOM_SITE_MODES: { value: CustomSiteMode; label: string; hint: string }[] = [
  { value: 'builtin', label: 'Built-in website', hint: 'Customers order on the website that comes with the software.' },
  { value: 'own', label: 'My own website', hint: 'Orders come from your own site (WordPress, Shopify, custom code).' },
  { value: 'both', label: 'Both', hint: 'Use the built-in website and your own site together.' },
];

export const MAX_BODY_BYTES = 256 * 1024;
export const TIMESTAMP_TOLERANCE_SECONDS = 300;
export const RATE_LIMIT_PER_MINUTE = 60;

export const HEADER_TIMESTAMP = 'x-dt-timestamp';
export const HEADER_SIGNATURE = 'x-dt-signature';
export const HEADER_IDEMPOTENCY = 'x-dt-idempotency-key';

// ------------------------------------------------------------------ addresses

/** A site address the owner typed, as a clean https URL — or null. Credentials in the address are refused. */
export function normalizeSiteUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw || raw.length > 300) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.')) return null;
  u.hash = '';
  return u.toString().replace(/\/$/, u.pathname === '/' && !u.search ? '' : '/');
}

/** Where the site must POST orders. */
export const intakePath = (tenantId: string): string => `/api/custom-site/order/${tenantId}`;

// ------------------------------------------------------------------ secret + signature

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

/** A new intake secret: 32 random bytes, URL-safe, with a prefix so it is recognisable in a config file. */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `dtcs_${b64}`;
}

/** What the screen may show of a secret afterwards: only the last four characters. */
export const secretHint = (secret: string): string => `…${secret.slice(-4)}`;

/** HMAC-SHA256 (hex) of "<timestamp>.<body>" — the timestamp is signed too, so it cannot be swapped to replay a request. */
export async function signRequest(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

/** Compare two strings without stopping at the first difference. */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'timestamp' | 'signature' };

export async function verifyRequest(args: {
  secret: string; timestamp: string | null; signature: string | null; body: string; nowMs?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature, body } = args;
  if (!secret || !timestamp || !signature) return { ok: false, reason: 'missing' };
  const ts = Number(timestamp);
  const now = (args.nowMs ?? Date.now()) / 1000;
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp' };
  const expected = await signRequest(secret, timestamp, body);
  const given = signature.trim().toLowerCase().replace(/^sha256=/, '');
  return timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: 'signature' };
}

// ------------------------------------------------------------------ the order a site sends

const text = (max: number) => z.string().trim().max(max);
const money = z.number().finite().min(0).max(10_000_000);

export const intakeOrderSchema = z.object({
  /** The site's own order number — shown on the order and used to find it again. */
  externalId: text(120).optional(),
  orderType: z.enum(['delivery', 'pickup', 'takeaway', 'dine_in']),
  customer: z.object({
    name: text(120).min(1, 'customer.name is required'),
    phone: text(30).min(5, 'customer.phone is required'),
    address: text(300).optional(),
    city: text(80).optional(),
  }),
  items: z.array(z.object({
    menuItemId: z.string().uuid().optional(),
    sku: text(60).optional(),
    name: text(120).optional(),
    quantity: z.number().int().min(1).max(999).default(1),
    price: money.optional(),
    note: text(200).optional(),
  }).refine(i => !!(i.menuItemId || i.sku || i.name), { message: 'each item needs menuItemId, sku or name' }))
    .min(1, 'at least one item').max(100, 'at most 100 items'),
  paymentMethod: text(40).optional(),
  notes: text(500).optional(),
  deliveryFee: money.optional(),
  discount: money.optional(),
  tableLabel: text(100).optional(),
  branchId: z.string().uuid().optional(),
});

export type IntakeOrder = z.infer<typeof intakeOrderSchema>;

/** The order type the software stores. */
export const internalOrderType = (t: IntakeOrder['orderType']): 'delivery' | 'takeaway' | 'dining' =>
  t === 'delivery' ? 'delivery' : t === 'dine_in' ? 'dining' : 'takeaway';

/** The jsonb custom_site_place_order() takes. */
export function toPlaceOrderPayload(o: IntakeOrder): Record<string, unknown> {
  const type = internalOrderType(o.orderType);
  const address = [o.customer.address, o.customer.city].filter(Boolean).join(', ');
  return {
    orderType: type,
    externalRef: o.externalId,
    tableLabel: type === 'dining' ? o.tableLabel : undefined,
    paymentMethod: o.paymentMethod,
    notes: o.notes,
    deliveryFee: o.deliveryFee,
    discount: o.discount,
    customer: {
      id: `site-${(o.customer.phone || '').replace(/\D/g, '') || 'guest'}`,
      name: o.customer.name,
      phone: o.customer.phone,
      address: type === 'delivery' ? address : (type === 'dining' ? `Dine-In · ${o.tableLabel ?? ''}`.trim() : 'Self-Pickup'),
      city: o.customer.city ?? '',
    },
    delivery: type === 'delivery' ? { customerCity: o.customer.city } : {},
    items: o.items.map(i => ({
      menuItemId: i.menuItemId, sku: i.sku, name: i.name, quantity: i.quantity, price: i.price, note: i.note,
    })),
  };
}

/**
 * Why this order must be refused right now, or null — the owner's own switches, the same rules the built-in website
 * follows (Online ordering, Delivery, Pickup), plus the minimum order for delivery when every line carries a price.
 */
export function intakeBlockedReason(sf: PublicStorefront | null, o: IntakeOrder): string | null {
  if (!sf) return 'This restaurant is not available.';
  const type = internalOrderType(o.orderType);
  const why = orderingBlockedReason(sf, { orderType: type, source: 'website' });
  if (why) return why;
  if (type === 'delivery' && sf.minOnlineOrder > 0 && o.items.every(i => typeof i.price === 'number')) {
    const subtotal = o.items.reduce((s, i) => s + (i.price as number) * i.quantity, 0);
    if (subtotal < sf.minOnlineOrder) return `The minimum order is ${sf.minOnlineOrder}.`;
  }
  return null;
}

/** A small, valid order for the "Send a test order" check and for the developer's reference. */
export const SAMPLE_ORDER: IntakeOrder = {
  externalId: 'TEST-1001',
  orderType: 'delivery',
  customer: { name: 'Test Customer', phone: '03001234567', address: 'House 1, Street 2', city: 'Lahore' },
  items: [{ name: 'Sample item', sku: 'SAMPLE-1', quantity: 2, price: 500 }],
  paymentMethod: 'cash',
  notes: 'Test order from the connection check',
  deliveryFee: 100,
};

// ------------------------------------------------------------------ what the Settings card shows

export interface CustomSiteStatus {
  mode: CustomSiteMode;
  siteUrl: string | null;
  adminUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  keyCreatedAt: string | null;
  lastOrderAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  orders7d: number;
  unmatched7d: number;
  /** The newest lines that matched nothing on the menu ("Needs matching"). */
  recentUnmatched: { orderNumber: number | null; name: string; quantity: number; price: number; at: string }[];
}

export const EMPTY_STATUS: CustomSiteStatus = {
  mode: 'builtin', siteUrl: null, adminUrl: null, hasKey: false, keyHint: null, keyCreatedAt: null,
  lastOrderAt: null, lastError: null, lastErrorAt: null, orders7d: 0, unmatched7d: 0, recentUnmatched: [],
};

/** Does the own site take orders at all in this mode? */
export const ownSiteActive = (mode: CustomSiteMode): boolean => mode === 'own' || mode === 'both';
