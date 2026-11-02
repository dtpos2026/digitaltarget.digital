// ============================================================
// PUBLIC STOREFRONT (v1.95.0) — what a customer who is not signed in may know about a restaurant, and the rules the
// owner's website switches turn into.
//
// FOUND: the owner's settings live in `tenant_settings`, which an anonymous visitor cannot read (no policy for the anon
// role). The customer website reads its settings from the local store, so for a real customer they were always the
// defaults: the Online ordering switch (Settings, Online Portal, the Owner app), Delivery, Pickup and Guest checkout
// were never seen by the page, and `public_place_order` does not look at them either. They only worked on a machine where
// the owner happened to be signed in. The same goes for the delivery fee, the minimum order and the pickup slots.
//
// This module is the allow-list of what is safe to say publicly, plus the rules. It is pure; the server function in
// publicStorefront.functions.ts reads the row with the server's own key and applies it, and the order submission uses
// the same rules as a backstop. Nothing here changes the database.
// ============================================================

export interface PublicStorefront {
  name: string;
  phone?: string;
  currencySymbol?: string;
  tagline?: string;
  banner?: string;
  onlineOrderEnabled: boolean;
  onlineDeliveryEnabled: boolean;
  onlinePickupEnabled: boolean;
  allowGuestCheckout: boolean;
  selfPickupEnabled: boolean;
  deliveryCharge: number;
  freeDeliveryThreshold: number;
  minOnlineOrder: number;
  pickupTimeSlots?: number[];
  restaurantLat?: number;
  restaurantLng?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const coord = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The allow-list. Everything a customer needs to order, and nothing else: no staff, no PINs, no payment accounts, no
 * receipt text, no personal numbers (`ownerWhatsApp` is deliberately NOT here — the restaurant's public WhatsApp number
 * comes from the customer-app config). A missing switch means "on", the software's own default for each.
 */
export function pickStorefront(settings: unknown, tenantName = ''): PublicStorefront {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const slots = Array.isArray(s.pickupTimeSlots)
    ? s.pickupTimeSlots.map(Number).filter(n => Number.isFinite(n) && n > 0 && n <= 24 * 60)
    : [];
  return {
    name: str(s.name) || tenantName,
    phone: str(s.phone) || str(s.phone1),
    currencySymbol: str(s.currencySymbol),
    tagline: str(s.onlineTagline),
    banner: str(s.onlineBanner),
    onlineOrderEnabled: s.onlineOrderEnabled !== false,
    onlineDeliveryEnabled: s.onlineDeliveryEnabled !== false,
    onlinePickupEnabled: s.onlinePickupEnabled !== false,
    allowGuestCheckout: s.allowGuestCheckout !== false,
    selfPickupEnabled: s.selfPickupEnabled === true,
    deliveryCharge: num(s.deliveryCharge),
    freeDeliveryThreshold: num(s.freeDeliveryThreshold),
    minOnlineOrder: num(s.minOnlineOrder),
    ...(slots.length ? { pickupTimeSlots: slots } : {}),
    restaurantLat: coord(s.restaurantLat),
    restaurantLng: coord(s.restaurantLng),
  };
}

/** The same fields in the shape the website page already reads (`settings.deliveryCharge` …). */
export function storefrontAsSettings(sf: PublicStorefront | null): Record<string, unknown> {
  if (!sf) return {};
  const out: Record<string, unknown> = { ...sf, onlineTagline: sf.tagline, onlineBanner: sf.banner };
  delete out.tagline; delete out.banner;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// ------------------------------------------------------------------ the owner's switches

export interface FulfilmentOptions { delivery: boolean; pickup: boolean }

/**
 * Which ways of getting the food the customer is offered.
 *   • Delivery: unless the Delivery switch is off.
 *   • Pickup: only when the restaurant opted in to self-pickup (Settings → Enable Self-Pickup, off by default, as it has
 *     always been) AND the Pickup switch is not off. The switch can only take pickup away, never force it on.
 */
export function fulfilmentOptions(s: Pick<PublicStorefront, 'onlineDeliveryEnabled' | 'onlinePickupEnabled' | 'selfPickupEnabled'>): FulfilmentOptions {
  return { delivery: s.onlineDeliveryEnabled !== false, pickup: s.selfPickupEnabled === true && s.onlinePickupEnabled !== false };
}

/** Keep the customer's choice if it is offered, else the one that is; null when neither is. */
export function resolveFulfilment(wanted: 'delivery' | 'pickup', opts: FulfilmentOptions): 'delivery' | 'pickup' | null {
  if (opts[wanted]) return wanted;
  if (opts.delivery) return 'delivery';
  if (opts.pickup) return 'pickup';
  return null;
}

/**
 * Why an order must not be taken right now, in the customer's words — or null. Used by the page before it submits and
 * by the server as a backstop, so a stale page or a hand-made request cannot get around a switch.
 *   • Online ordering off closes everything a customer can do (website, QR codes) — staff (order taker) orders are
 *     not customers and are never blocked here.
 *   • A delivery order needs the Delivery switch; a takeaway (pickup) order needs the Pickup switch. Dine-in QR orders
 *     are neither.
 */
export function orderingBlockedReason(
  s: Pick<PublicStorefront, 'onlineOrderEnabled' | 'onlineDeliveryEnabled' | 'onlinePickupEnabled'>,
  order: { orderType?: unknown; source?: unknown },
): string | null {
  if (order?.source === 'order_taker') return null;
  if (s.onlineOrderEnabled === false) return 'Online ordering is closed right now. Please call the restaurant.';
  const type = typeof order?.orderType === 'string' ? order.orderType : '';
  if (type === 'delivery' && s.onlineDeliveryEnabled === false) return 'Delivery is switched off right now. Please choose pickup or call the restaurant.';
  if (type === 'takeaway' && s.onlinePickupEnabled === false) return 'Pickup is switched off right now.';
  return null;
}

/** Guest checkout: with the switch off a customer must sign in first. */
export const guestCheckoutAllowed = (s: Pick<PublicStorefront, 'allowGuestCheckout'>): boolean => s.allowGuestCheckout !== false;

// ------------------------------------------------------------------ reading the row (server side; the client is injected)

export const ALL_BRANCHES_ID = '00000000-0000-0000-0000-000000000000';

/** Minimal shape of the supabase client the server functions use — enough to test without one. */
export interface StorefrontDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }> };
        maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
}

/** The storefront of one restaurant; null when it does not exist or is switched off at the platform level. Throws on a read error. */
export async function readStorefront(db: StorefrontDb, tenantId: string): Promise<PublicStorefront | null> {
  const t = await db.from('tenants').select('id, name, is_active').eq('id', tenantId).maybeSingle();
  if (t.error) throw new Error(t.error.message);
  if (!t.data || t.data.is_active === false) return null;
  const row = await db.from('tenant_settings').select('settings').eq('tenant_id', tenantId).eq('branch_id', ALL_BRANCHES_ID).maybeSingle();
  if (row.error) throw new Error(row.error.message);
  return pickStorefront(row.data?.settings, String(t.data.name ?? ''));
}
