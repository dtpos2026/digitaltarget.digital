// v1.107.0 — Custom Website: signing, order shape, the owner's switches and the intake's order of checks.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES, RATE_LIMIT_PER_MINUTE, SAMPLE_ORDER, generateSecret, intakeBlockedReason, intakeOrderSchema,
  internalOrderType, normalizeSiteUrl, ownSiteActive, secretHint, signRequest, timingSafeEqual, toPlaceOrderPayload,
  verifyRequest, type IntakeOrder,
} from '@/lib/customSite';
import { processIntake, type IntakeDb } from '@/lib/customSiteIntake.server';
import { pickStorefront } from '@/lib/publicStorefront';

const TENANT = '64434fd6-3ea7-4ae2-9c05-6da25a41ad41';
const SECRET = 'dtcs_test_secret_value_1234';

describe('site address', () => {
  it('accepts a clean https address and adds the scheme when it is missing', () => {
    expect(normalizeSiteUrl('https://myrestaurant.com')).toBe('https://myrestaurant.com');
    expect(normalizeSiteUrl('  myrestaurant.com/menu ')).toBe('https://myrestaurant.com/menu');
    expect(normalizeSiteUrl('https://myrestaurant.com/wp-admin')).toBe('https://myrestaurant.com/wp-admin');
  });
  it('refuses http, credentials, bare words and junk', () => {
    expect(normalizeSiteUrl('http://myrestaurant.com')).toBeNull();
    expect(normalizeSiteUrl('https://user:pass@myrestaurant.com')).toBeNull();
    expect(normalizeSiteUrl('localhost')).toBeNull();
    expect(normalizeSiteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSiteUrl('')).toBeNull();
    expect(normalizeSiteUrl(42)).toBeNull();
  });
});

describe('secret and signature', () => {
  it('makes a long unique url-safe secret and shows only the last four characters afterwards', () => {
    const a = generateSecret(); const b = generateSecret();
    expect(a).toMatch(/^dtcs_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(secretHint('dtcs_abcdefgh')).toBe('…efgh');
  });
  it('signs "<timestamp>.<body>" with HMAC-SHA256 (matches the reference implementation)', async () => {
    const body = JSON.stringify(SAMPLE_ORDER);
    const expected = createHmac('sha256', SECRET).update(`1700000000.${body}`).digest('hex');
    expect(await signRequest(SECRET, '1700000000', body)).toBe(expected);
  });
  it('accepts a good request, with or without the sha256= prefix', async () => {
    const body = '{"a":1}'; const ts = '1700000000'; const sig = await signRequest(SECRET, ts, body);
    const nowMs = 1700000000_000 + 60_000;
    expect(await verifyRequest({ secret: SECRET, timestamp: ts, signature: sig, body, nowMs })).toEqual({ ok: true });
    expect(await verifyRequest({ secret: SECRET, timestamp: ts, signature: `sha256=${sig.toUpperCase()}`, body, nowMs })).toEqual({ ok: true });
  });
  it('refuses a changed body, a wrong key, a stale or future timestamp and missing headers', async () => {
    const body = '{"a":1}'; const ts = '1700000000'; const sig = await signRequest(SECRET, ts, body);
    const nowMs = 1700000000_000;
    expect(await verifyRequest({ secret: SECRET, timestamp: ts, signature: sig, body: '{"a":2}', nowMs })).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyRequest({ secret: 'other', timestamp: ts, signature: sig, body, nowMs })).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyRequest({ secret: SECRET, timestamp: ts, signature: sig, body, nowMs: nowMs + 301_000 })).toEqual({ ok: false, reason: 'timestamp' });
    expect(await verifyRequest({ secret: SECRET, timestamp: ts, signature: sig, body, nowMs: nowMs - 301_000 })).toEqual({ ok: false, reason: 'timestamp' });
    expect(await verifyRequest({ secret: SECRET, timestamp: 'abc', signature: sig, body, nowMs })).toEqual({ ok: false, reason: 'timestamp' });
    expect(await verifyRequest({ secret: SECRET, timestamp: null, signature: sig, body, nowMs })).toEqual({ ok: false, reason: 'missing' });
    expect(await verifyRequest({ secret: SECRET, timestamp: ts, signature: null, body, nowMs })).toEqual({ ok: false, reason: 'missing' });
  });
  it('a timestamp that is swapped after signing no longer verifies (the timestamp is signed too)', async () => {
    const body = '{"a":1}'; const sig = await signRequest(SECRET, '1700000000', body);
    expect((await verifyRequest({ secret: SECRET, timestamp: '1700000100', signature: sig, body, nowMs: 1700000100_000 })).ok).toBe(false);
  });
  it('compares without stopping at the first difference', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('the order a site sends', () => {
  it('the sample order is valid', () => {
    expect(intakeOrderSchema.safeParse(SAMPLE_ORDER).success).toBe(true);
  });
  it('names the exact field that is wrong', () => {
    const bad = { ...SAMPLE_ORDER, customer: { name: 'A', phone: '1' }, items: [{ quantity: 1 }] };
    const r = intakeOrderSchema.safeParse(bad);
    expect(r.success).toBe(false);
    const fields = (r.success ? [] : r.error.issues.map(i => i.path.join('.')));
    expect(fields).toContain('customer.phone');
    expect(fields.some(f => f.startsWith('items.0'))).toBe(true);
  });
  it('limits the number of lines, quantities and prices', () => {
    const line = { name: 'x', quantity: 1, price: 1 };
    expect(intakeOrderSchema.safeParse({ ...SAMPLE_ORDER, items: Array(101).fill(line) }).success).toBe(false);
    expect(intakeOrderSchema.safeParse({ ...SAMPLE_ORDER, items: [{ ...line, quantity: 1000 }] }).success).toBe(false);
    expect(intakeOrderSchema.safeParse({ ...SAMPLE_ORDER, items: [{ ...line, price: -1 }] }).success).toBe(false);
    expect(intakeOrderSchema.safeParse({ ...SAMPLE_ORDER, items: [] }).success).toBe(false);
  });
  it('maps order types to the ones the software stores', () => {
    expect(internalOrderType('delivery')).toBe('delivery');
    expect(internalOrderType('pickup')).toBe('takeaway');
    expect(internalOrderType('takeaway')).toBe('takeaway');
    expect(internalOrderType('dine_in')).toBe('dining');
  });
  it('builds the payload custom_site_place_order() takes', () => {
    const p = toPlaceOrderPayload(SAMPLE_ORDER) as Record<string, any>;
    expect(p.orderType).toBe('delivery');
    expect(p.externalRef).toBe('TEST-1001');
    expect(p.deliveryFee).toBe(100);
    expect(p.customer.address).toBe('House 1, Street 2, Lahore');
    expect(p.items[0]).toMatchObject({ sku: 'SAMPLE-1', quantity: 2, price: 500 });
    const pickup = toPlaceOrderPayload({ ...SAMPLE_ORDER, orderType: 'pickup' }) as Record<string, any>;
    expect(pickup.orderType).toBe('takeaway');
    expect(pickup.customer.address).toBe('Self-Pickup');
  });
});

describe("the owner's switches", () => {
  const sf = (s: Record<string, unknown>) => pickStorefront(s, 'R');
  const order = (o: Partial<IntakeOrder> = {}): IntakeOrder => ({ ...SAMPLE_ORDER, ...o });
  it('Online ordering off closes everything', () => {
    expect(intakeBlockedReason(sf({ onlineOrderEnabled: false }), order())).toMatch(/closed/i);
  });
  it('Delivery off refuses delivery but not pickup; Pickup off refuses pickup', () => {
    expect(intakeBlockedReason(sf({ onlineDeliveryEnabled: false }), order())).toMatch(/Delivery is switched off/);
    expect(intakeBlockedReason(sf({ onlineDeliveryEnabled: false }), order({ orderType: 'pickup' }))).toBeNull();
    expect(intakeBlockedReason(sf({ onlinePickupEnabled: false }), order({ orderType: 'pickup' }))).toMatch(/Pickup is switched off/);
  });
  it('checks the delivery minimum only when every line has a price', () => {
    expect(intakeBlockedReason(sf({ minOnlineOrder: 5000 }), order())).toMatch(/minimum/i);
    expect(intakeBlockedReason(sf({ minOnlineOrder: 500 }), order())).toBeNull();
    expect(intakeBlockedReason(sf({ minOnlineOrder: 5000 }), order({ items: [{ name: 'Menu item', quantity: 1 }] }))).toBeNull();
    expect(intakeBlockedReason(sf({ minOnlineOrder: 5000 }), order({ orderType: 'pickup' }))).toBeNull();
  });
  it('a restaurant that is not available refuses', () => {
    expect(intakeBlockedReason(null, order())).toMatch(/not available/);
  });
  it('only "own" and "both" take orders from the own site', () => {
    expect(ownSiteActive('builtin')).toBe(false);
    expect(ownSiteActive('own')).toBe(true);
    expect(ownSiteActive('both')).toBe(true);
  });
});

// ---------------------------------------------------------------- the intake, with an in-memory database

interface World {
  intake: { mode: string; secret: string | null; last_error_at: string | null } | null;
  ledger: { tenant_id: string; idempotency_key: string; order_id?: string; order_number?: number; unmatched?: unknown[] }[];
  recent: number;
  settings: Record<string, unknown>;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  rpcResult: { data: unknown; error: { message: string } | null };
  intakeUpdates: Record<string, unknown>[];
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    intake: { mode: 'own', secret: SECRET, last_error_at: null },
    ledger: [], recent: 0, settings: {}, rpcCalls: [], intakeUpdates: [],
    rpcResult: { data: { id: 'o-1', order_number: 7001, total: 1100, unmatched: [] }, error: null },
    ...over,
  };
}

function fakeDb(w: World): IntakeDb {
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> = {};
    let opts: { head?: boolean } | undefined;
    const f: Record<string, unknown> = {};
    const run = (single: boolean): { data?: unknown; error?: { code?: string; message: string } | null; count?: number } => {
      if (table === 'custom_site_intake') {
        if (op === 'update') { w.intakeUpdates.push(payload); return { error: null }; }
        return { data: w.intake, error: null };
      }
      if (table === 'custom_site_orders') {
        if (op === 'insert') {
          const dup = w.ledger.find(l => l.idempotency_key === payload.idempotency_key);
          if (dup) return { error: { code: '23505', message: 'duplicate' } };
          w.ledger.push(payload as World['ledger'][number]); return { error: null };
        }
        if (op === 'update') { Object.assign(w.ledger[w.ledger.length - 1] ?? {}, payload); return { error: null }; }
        if (op === 'delete') { w.ledger.pop(); return { error: null }; }
        if (opts?.head) return { count: w.recent, error: null };
        return { data: single ? w.ledger[0] ?? null : w.ledger, error: null };
      }
      if (table === 'tenants') return { data: { id: TENANT, name: 'R', is_active: true }, error: null };
      if (table === 'tenant_settings') return { data: { settings: w.settings }, error: null };
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: (_c: string, o?: { head?: boolean }) => { opts = o; return chain; },
      insert: (p: Record<string, unknown>) => { op = 'insert'; payload = p; return Promise.resolve(run(false)); },
      update: (p: Record<string, unknown>) => { op = 'update'; payload = p; return chain; },
      delete: () => { op = 'delete'; return chain; },
      eq: () => chain, gte: () => chain,
      maybeSingle: () => Promise.resolve(run(true)),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run(false)).then(res, rej),
    };
    void f;
    return chain;
  };
  return {
    from,
    rpc: (fn, args) => { w.rpcCalls.push({ fn, args }); return Promise.resolve(w.rpcResult); },
  } as unknown as IntakeDb;
}

async function signed(order: unknown = SAMPLE_ORDER, over: Record<string, unknown> = {}) {
  const rawBody = JSON.stringify(order);
  const nowMs = 1700000000_000;
  const timestamp = '1700000000';
  return {
    tenantId: TENANT, rawBody, timestamp, signature: await signRequest(SECRET, timestamp, rawBody),
    idempotencyKey: 'order-1001', nowMs, ...over,
  };
}

describe('the intake, in order', () => {
  it('answers the same 403 when the restaurant has no own site, the mode is off or there is no key', async () => {
    for (const intake of [null, { mode: 'builtin', secret: SECRET, last_error_at: null }, { mode: 'own', secret: null, last_error_at: null }]) {
      const w = makeWorld({ intake });
      const r = await processIntake(fakeDb(w), await signed());
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('not_enabled');
      expect(w.rpcCalls).toHaveLength(0);
    }
  });

  it('refuses a body over the size cap before anything else', async () => {
    const w = makeWorld();
    const r = await processIntake(fakeDb(w), { ...(await signed()), rawBody: 'x'.repeat(MAX_BODY_BYTES + 1) });
    expect(r.status).toBe(413);
    expect(w.rpcCalls).toHaveLength(0);
  });

  it('401 for a wrong signature or a stale timestamp, and the reason is recorded for the owner', async () => {
    const w = makeWorld();
    const bad = await processIntake(fakeDb(w), { ...(await signed()), signature: 'deadbeef' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('bad_signature');
    expect(w.intakeUpdates[0]?.last_error).toMatch(/signature/i);
    const stale = await processIntake(fakeDb(makeWorld()), { ...(await signed()), nowMs: 1700000000_000 + 600_000 });
    expect(stale.status).toBe(401);
    expect(stale.body.error).toBe('stale_timestamp');
    expect(w.rpcCalls).toHaveLength(0);
  });

  it('writes an error note at most once a minute', async () => {
    const w = makeWorld({ intake: { mode: 'own', secret: SECRET, last_error_at: new Date(1700000000_000 - 10_000).toISOString() } });
    await processIntake(fakeDb(w), { ...(await signed()), signature: 'deadbeef' });
    expect(w.intakeUpdates).toHaveLength(0);
  });

  it('429 after the per-minute limit', async () => {
    const w = makeWorld({ recent: RATE_LIMIT_PER_MINUTE });
    const r = await processIntake(fakeDb(w), await signed());
    expect(r.status).toBe(429);
    expect(w.rpcCalls).toHaveLength(0);
  });

  it('400 for broken JSON and 422 with field names for a wrong order', async () => {
    const body = 'not json';
    const timestamp = '1700000000';
    const common = { tenantId: TENANT, timestamp, idempotencyKey: 'k', nowMs: 1700000000_000 };
    const broken = await processIntake(fakeDb(makeWorld()), { ...common, rawBody: body, signature: await signRequest(SECRET, timestamp, body) });
    expect(broken.status).toBe(400);
    const wrong = await processIntake(fakeDb(makeWorld()), await signed({ ...SAMPLE_ORDER, items: [] }));
    expect(wrong.status).toBe(422);
    expect(JSON.stringify(wrong.body.issues)).toContain('items');
  });

  it("409 when the owner's switch is off — and the order is not placed", async () => {
    const w = makeWorld({ settings: { onlineDeliveryEnabled: false } });
    const r = await processIntake(fakeDb(w), await signed());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('closed');
    expect(w.rpcCalls).toHaveLength(0);
  });

  it('a dry run checks everything and places nothing', async () => {
    const w = makeWorld();
    const r = await processIntake(fakeDb(w), { ...(await signed()), idempotencyKey: null, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(w.rpcCalls).toHaveLength(0);
    expect(w.ledger).toHaveLength(0);
  });

  it('needs an idempotency key', async () => {
    const r = await processIntake(fakeDb(makeWorld()), { ...(await signed()), idempotencyKey: null });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bad_idempotency_key');
    const odd = await processIntake(fakeDb(makeWorld()), { ...(await signed()), idempotencyKey: 'has space' });
    expect(odd.status).toBe(400);
  });

  it('places a good order once: 201, the number, the custom lines reported, health updated', async () => {
    const w = makeWorld({ rpcResult: { data: { id: 'o-9', order_number: 7002, total: 1100, unmatched: [{ name: 'Sample item', quantity: 2, price: 500 }] }, error: null } });
    const r = await processIntake(fakeDb(w), await signed());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, orderId: 'o-9', orderNumber: 7002, total: 1100 });
    expect(r.body.unmatched).toHaveLength(1);
    expect(w.rpcCalls).toHaveLength(1);
    expect(w.rpcCalls[0].fn).toBe('custom_site_place_order');
    expect(w.rpcCalls[0].args.p_tenant).toBe(TENANT);
    expect((w.rpcCalls[0].args.p_order as Record<string, unknown>).orderType).toBe('delivery');
    expect(w.ledger[0]).toMatchObject({ order_id: 'o-9', order_number: 7002 });
    expect(w.intakeUpdates.some(u => 'last_order_at' in u && u.last_error === null)).toBe(true);
  });

  it('a repeated order is accepted once: the second call returns the first result and places nothing', async () => {
    const w = makeWorld();
    const db = fakeDb(w);
    const first = await processIntake(db, await signed());
    const second = await processIntake(db, await signed());
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, duplicate: true, orderId: 'o-1', orderNumber: 7001 });
    expect(w.rpcCalls).toHaveLength(1);
  });

  it('a duplicate that is still being processed asks the site to retry', async () => {
    const w = makeWorld({ ledger: [{ tenant_id: TENANT, idempotency_key: 'order-1001' }] });
    const r = await processIntake(fakeDb(w), await signed());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('in_progress');
  });

  it('when the database rejects the order the key is released so the site can retry, and the reason is saved', async () => {
    const w = makeWorld({ rpcResult: { data: null, error: { message: 'line "X" is not on the menu, so it needs a price' } } });
    const r = await processIntake(fakeDb(w), await signed());
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('rejected');
    expect(w.ledger).toHaveLength(0);
    expect(w.intakeUpdates[0]?.last_error).toMatch(/needs a price/);
  });
});
