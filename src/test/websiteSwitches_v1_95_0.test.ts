// ============================================================
// v1.95.0 — the customer website knows the owner's switches.
//
// FOUND: an anonymous visitor cannot read tenant_settings, so the website always ran on default settings. The Online
// ordering master switch, Delivery, Pickup and Guest checkout (Settings, Online Portal, the Owner app) were not seen by
// the page and not checked by `public_place_order`; the delivery fee, minimum order and pickup slots did not reach
// customers either. What is pinned here:
//   • the allow-list: only what a customer needs, never a secret, never a personal number;
//   • the rules the switches turn into (which ways of getting the food are offered, what blocks an order, staff orders
//     are never blocked);
//   • reading the row (the database is a stand-in), and the device-side memory of the last answer;
//   • the wiring: the order submission checks the same rules and fails open if the settings cannot be read; the page
//     overlays the storefront, honours the switches, and requires a real sign-in when guest checkout is off.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_BRANCHES_ID, fulfilmentOptions, guestCheckoutAllowed, orderingBlockedReason, pickStorefront, readStorefront,
  resolveFulfilment, storefrontAsSettings, type StorefrontDb,
} from '@/lib/publicStorefront';
import { getCachedStorefront, loadPublicStorefront } from '@/lib/storefrontClient';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const everything = {
  name: 'Sample Restaurant', phone: '042-35761234', currencySymbol: 'Rs ', onlineTagline: 'Fresh since 1999', onlineBanner: 'https://cdn/banner.jpg',
  onlineOrderEnabled: true, onlineDeliveryEnabled: false, onlinePickupEnabled: true, allowGuestCheckout: false, selfPickupEnabled: true,
  deliveryCharge: 150, freeDeliveryThreshold: 2000, minOnlineOrder: 500, pickupTimeSlots: [15, 30, 45], restaurantLat: 31.5, restaurantLng: 74.3,
  // none of these may ever reach a customer
  ownerWhatsApp: '03001234567', adminPin: '9999', managerPassword: 'hunter2', receiptFooter: 'secret footer', users: [{ name: 'Ali', password: 'x' }],
  paymentAccounts: [{ iban: 'PK00SECRET' }], taxNumber: 'NTN-123', supabaseKey: 'sk', cnic: '35202-1234567-1',
};

describe('the allow-list', () => {
  it('carries what a customer needs to order and nothing else', () => {
    const sf = pickStorefront(everything, 'Tenant Name');
    expect(Object.keys(sf).sort()).toEqual([
      'allowGuestCheckout', 'banner', 'currencySymbol', 'deliveryCharge', 'freeDeliveryThreshold', 'minOnlineOrder', 'name',
      'onlineDeliveryEnabled', 'onlineOrderEnabled', 'onlinePickupEnabled', 'phone', 'pickupTimeSlots', 'restaurantLat',
      'restaurantLng', 'selfPickupEnabled', 'tagline',
    ]);
    const json = JSON.stringify(sf);
    for (const secret of ['03001234567', '9999', 'hunter2', 'secret footer', 'PK00SECRET', 'NTN-123', '"sk"', '35202', 'Ali']) expect(json, secret).not.toContain(secret);
    expect(sf).toMatchObject({ name: 'Sample Restaurant', onlineDeliveryEnabled: false, allowGuestCheckout: false, deliveryCharge: 150, minOnlineOrder: 500, pickupTimeSlots: [15, 30, 45] });
  });

  it('a restaurant that configured nothing is open, the way the software defaults each switch', () => {
    for (const blank of [null, undefined, {}, 'nonsense', 42]) {
      expect(pickStorefront(blank, 'Cafe')).toEqual({
        name: 'Cafe', phone: undefined, currencySymbol: undefined, tagline: undefined, banner: undefined,
        onlineOrderEnabled: true, onlineDeliveryEnabled: true, onlinePickupEnabled: true, allowGuestCheckout: true, selfPickupEnabled: false,
        deliveryCharge: 0, freeDeliveryThreshold: 0, minOnlineOrder: 0, restaurantLat: undefined, restaurantLng: undefined,
      });
    }
  });

  it('coerces and filters: bad numbers become 0, bad slots are dropped, only an explicit false switches something off', () => {
    const sf = pickStorefront({ deliveryCharge: '120', minOnlineOrder: -5, freeDeliveryThreshold: 'abc', pickupTimeSlots: [10, 'x', -3, 99999, '25'], onlineOrderEnabled: 0, allowGuestCheckout: 'false', phone: '  ', phone1: '0300' }, '');
    expect(sf).toMatchObject({ deliveryCharge: 120, minOnlineOrder: 0, freeDeliveryThreshold: 0, pickupTimeSlots: [10, 25], onlineOrderEnabled: true, allowGuestCheckout: true, phone: '0300' });
  });

  it('is handed to the page in the shape it already reads, with undefined fields left out', () => {
    const s = storefrontAsSettings(pickStorefront(everything, 'T'));
    expect(s).toMatchObject({ onlineTagline: 'Fresh since 1999', onlineBanner: 'https://cdn/banner.jpg', deliveryCharge: 150, onlineDeliveryEnabled: false });
    expect(s).not.toHaveProperty('tagline');
    expect(storefrontAsSettings(null)).toEqual({});
    expect('currencySymbol' in storefrontAsSettings(pickStorefront({}, 'T'))).toBe(false);
  });
});

describe('what the switches mean', () => {
  const on = { onlineDeliveryEnabled: true, onlinePickupEnabled: true, selfPickupEnabled: true };
  it('which ways of getting the food are offered', () => {
    expect(fulfilmentOptions(on)).toEqual({ delivery: true, pickup: true });
    expect(fulfilmentOptions({ ...on, onlineDeliveryEnabled: false })).toEqual({ delivery: false, pickup: true });
    expect(fulfilmentOptions({ ...on, onlinePickupEnabled: false })).toEqual({ delivery: true, pickup: false });
    // the Pickup switch can only take pickup away: without Enable Self-Pickup it was never offered, and still is not
    expect(fulfilmentOptions({ ...on, selfPickupEnabled: false })).toEqual({ delivery: true, pickup: false });
    expect(fulfilmentOptions({ onlineDeliveryEnabled: false, onlinePickupEnabled: true, selfPickupEnabled: false })).toEqual({ delivery: false, pickup: false });
  });

  it('keeps the customer\'s choice when it is offered, else the one that is, else none', () => {
    expect(resolveFulfilment('delivery', { delivery: true, pickup: true })).toBe('delivery');
    expect(resolveFulfilment('pickup', { delivery: true, pickup: true })).toBe('pickup');
    expect(resolveFulfilment('pickup', { delivery: true, pickup: false })).toBe('delivery');
    expect(resolveFulfilment('delivery', { delivery: false, pickup: true })).toBe('pickup');
    expect(resolveFulfilment('delivery', { delivery: false, pickup: false })).toBeNull();
  });

  const open = { onlineOrderEnabled: true, onlineDeliveryEnabled: true, onlinePickupEnabled: true };
  it('what blocks an order, in the customer\'s words', () => {
    expect(orderingBlockedReason(open, { orderType: 'delivery', source: 'website' })).toBeNull();
    expect(orderingBlockedReason({ ...open, onlineOrderEnabled: false }, { orderType: 'delivery', source: 'website' })).toMatch(/closed/i);
    expect(orderingBlockedReason({ ...open, onlineOrderEnabled: false }, { orderType: 'dining', source: 'qr' })).toMatch(/closed/i);   // the QR codes too
    expect(orderingBlockedReason({ ...open, onlineDeliveryEnabled: false }, { orderType: 'delivery' })).toMatch(/Delivery is switched off/);
    expect(orderingBlockedReason({ ...open, onlineDeliveryEnabled: false }, { orderType: 'takeaway' })).toBeNull();
    expect(orderingBlockedReason({ ...open, onlinePickupEnabled: false }, { orderType: 'takeaway' })).toMatch(/Pickup is switched off/);
    expect(orderingBlockedReason({ ...open, onlinePickupEnabled: false }, { orderType: 'delivery' })).toBeNull();
    // dine-in is neither delivery nor pickup
    expect(orderingBlockedReason({ ...open, onlineDeliveryEnabled: false, onlinePickupEnabled: false }, { orderType: 'dining', source: 'qr' })).toBeNull();
  });

  it('never blocks the restaurant\'s own staff, and tolerates a hand-made request', () => {
    expect(orderingBlockedReason({ onlineOrderEnabled: false, onlineDeliveryEnabled: false, onlinePickupEnabled: false }, { orderType: 'delivery', source: 'order_taker' })).toBeNull();
    expect(orderingBlockedReason(open, {})).toBeNull();
    expect(orderingBlockedReason(open, { orderType: 42, source: {} })).toBeNull();
    expect(orderingBlockedReason({ ...open, onlineOrderEnabled: false }, undefined as never)).toMatch(/closed/i);
  });

  it('guest checkout is on unless the switch is off', () => {
    expect(guestCheckoutAllowed({ allowGuestCheckout: true })).toBe(true);
    expect(guestCheckoutAllowed({ allowGuestCheckout: false })).toBe(false);
  });
});

// ------------------------------------------------------------------ reading the row
type Row = Record<string, unknown> | null;
function fakeDb(tenant: Row, settings: Row, errors: { tenant?: string; settings?: string } = {}) {
  const asked: Array<{ table: string; filters: Array<[string, string]> }> = [];
  const db: StorefrontDb = {
    from(table) {
      const rec = { table, filters: [] as Array<[string, string]> };
      asked.push(rec);
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: string) => { rec.filters.push([c, v]); return chain; },
        maybeSingle: async () => table === 'tenants'
          ? { data: tenant, error: errors.tenant ? { message: errors.tenant } : null }
          : { data: settings, error: errors.settings ? { message: errors.settings } : null },
      };
      return chain;
    },
  };
  return { db, asked };
}

describe('readStorefront', () => {
  it('reads the restaurant-wide settings row with the tenant\'s own id and cuts it to the allow-list', async () => {
    const { db, asked } = fakeDb({ id: 't1', name: 'Tenant', is_active: true }, { settings: everything });
    const sf = await readStorefront(db, 't1');
    expect(sf?.name).toBe('Sample Restaurant');
    expect(sf?.onlineDeliveryEnabled).toBe(false);
    expect(JSON.stringify(sf)).not.toContain('hunter2');
    expect(asked.find(a => a.table === 'tenant_settings')?.filters).toEqual([['tenant_id', 't1'], ['branch_id', ALL_BRANCHES_ID]]);
    expect(ALL_BRANCHES_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('a restaurant that is unknown or switched off by the platform has no storefront; one with no settings row is open', async () => {
    expect(await readStorefront(fakeDb(null, null).db, 't1')).toBeNull();
    expect(await readStorefront(fakeDb({ id: 't1', name: 'T', is_active: false }, { settings: {} }).db, 't1')).toBeNull();
    const sf = await readStorefront(fakeDb({ id: 't1', name: 'Tenant', is_active: true }, null).db, 't1');
    expect(sf).toMatchObject({ name: 'Tenant', onlineOrderEnabled: true });
  });

  it('a read error is thrown, for the caller to decide (the server fails open, the page keeps its last answer)', async () => {
    await expect(readStorefront(fakeDb(null, null, { tenant: 'boom' }).db, 't1')).rejects.toThrow('boom');
    await expect(readStorefront(fakeDb({ id: 't1', name: 'T', is_active: true }, null, { settings: 'rls' }).db, 't1')).rejects.toThrow('rls');
  });
});

describe('the device remembers the last answer', () => {
  beforeEach(() => localStorage.clear());
  const sf = pickStorefront({ name: 'Sample', onlineOrderEnabled: false }, '');

  it('asks, remembers, and returns the fresh answer', async () => {
    const fetcher = vi.fn(async () => sf);
    expect(await loadPublicStorefront('t1', fetcher)).toEqual(sf);
    expect(fetcher).toHaveBeenCalledWith('t1');
    expect(getCachedStorefront('t1')).toEqual(sf);
    expect(getCachedStorefront('other')).toBeNull();
  });

  it('when the server cannot be reached the last answer is used — and nothing throws', async () => {
    await loadPublicStorefront('t1', async () => sf);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadPublicStorefront('t1', async () => { throw new Error('offline'); })).toEqual(sf);
    expect(await loadPublicStorefront('never-seen', async () => { throw new Error('offline'); })).toBeNull();
    warn.mockRestore();
  });

  it('a restaurant the server no longer knows is forgotten', async () => {
    await loadPublicStorefront('t1', async () => sf);
    expect(await loadPublicStorefront('t1', async () => null)).toBeNull();
    expect(getCachedStorefront('t1')).toBeNull();
  });

  it('ignores a damaged remembered answer', () => {
    localStorage.setItem('dt-public-storefront:t1', '{not json');
    expect(getCachedStorefront('t1')).toBeNull();
    localStorage.setItem('dt-public-storefront:t1', JSON.stringify({ nope: 1 }));
    expect(getCachedStorefront('t1')).toBeNull();
  });
});

// ------------------------------------------------------------------ the wiring
describe('the wiring', () => {
  it('the order submission checks the same rules before the database, and fails open when the settings cannot be read', () => {
    const fn = read('src/lib/publicPortal.functions.ts');
    const submit = fn.slice(fn.indexOf('export const submitPublicOrder'), fn.indexOf('export const trackPublicOrder'));
    const check = submit.indexOf('orderingBlockedReason(');
    const rpc = submit.indexOf("rpc('public_place_order'");
    expect(check, 'no switch check').toBeGreaterThan(-1);
    expect(check).toBeLessThan(rpc);
    // the read is inside a try with an empty catch (fail open); the throw is outside it
    const tryAt = submit.indexOf('try {');
    const catchAt = submit.indexOf('} catch');
    const throwAt = submit.indexOf('if (blocked) throw new Error(blocked)');
    expect(tryAt).toBeGreaterThan(-1);
    expect(tryAt).toBeLessThan(check);
    expect(catchAt).toBeGreaterThan(check);
    expect(throwAt).toBeGreaterThan(catchAt);
  });

  it('the storefront is read on the server with its own key, never with the visitor\'s', () => {
    const fn = read('src/lib/publicStorefront.functions.ts');
    expect(fn).toContain('getSupabaseAdmin');
    expect(fn).toContain('readStorefront');
    expect(fn).toMatch(/tenantId: z\.string\(\)\.uuid\(\)/);
  });

  it('the page overlays the storefront, honours the switches, and needs a real sign-in when guest checkout is off', () => {
    const page = read('src/pages/OnlineOrderPage.tsx');
    expect(page).toContain('...storefrontAsSettings(storefront)');
    expect(page).toMatch(/loadPublicStorefront\(id\)/);
    expect(page).toMatch(/const fulfilOpts = fulfilmentOptions\(/);
    expect(page).toMatch(/resolveFulfilment\(fulfillment, fulfilOpts\)/);
    // the choice of delivery or pickup is only shown when both are offered
    expect(page).toMatch(/\{fulfilOpts\.delivery && fulfilOpts\.pickup && \(/);
    // a name saved on this device is not an account: guest checkout off looks for the real session token
    expect(page).toMatch(/!guestCheckoutAllowed\(\{ allowGuestCheckout: settings\.allowGuestCheckout !== false \}\) && !getCustomerToken\(\)/);
    expect(page).not.toMatch(/guestCheckoutAllowed\([^)]*\)\s*&&\s*!account\b/);
    // and the place-order button is disabled when nothing is offered
    expect(page).toMatch(/placing\s*\|\|\s*nothingOffered/);
  });

  it('a staff order through the same function is exempt, a QR dine-in order is not delivery or pickup', () => {
    // pinned through the rules above; here that the page labels its orders the way those rules expect
    const page = read('src/pages/OnlineOrderPage.tsx');
    expect(page).toContain("orderType: dineIn ? 'dining' : (fulfillment === 'pickup' ? 'takeaway' : 'delivery')");
    expect(page).toContain("source: dineIn ? 'qr' : 'website'");
  });
});
