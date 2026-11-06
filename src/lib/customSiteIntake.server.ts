// ============================================================
// CUSTOM WEBSITE — the intake (v1.107.0). SERVER ONLY: it reads the intake secret, which a browser must never see.
//
// One request in, one decision out. The order of the checks is the security design (docs/MASTER-PLAN §5):
//   1. size cap        → 413   (before anything is parsed)
//   2. is this restaurant using its own site? → 403 (the same answer for "unknown" and "off": nothing to learn)
//   3. signature + timestamp (±5 min)         → 401
//   4. rate limit per restaurant              → 429
//   5. JSON + shape                           → 400 / 422 with the exact fields that are wrong
//   6. the owner's switches (Online ordering, Delivery, Pickup, minimum) → 409
//   7. idempotency key: a repeated order is accepted once → 200 duplicate
//   8. custom_site_place_order(): prices, lines, totals decided in ONE place (the database)
// Nothing here logs the body or the secret.
// ============================================================
import {
  MAX_BODY_BYTES, RATE_LIMIT_PER_MINUTE, intakeBlockedReason, intakeOrderSchema, ownSiteActive,
  toPlaceOrderPayload, verifyRequest, type CustomSiteMode,
} from '@/lib/customSite';
import { readStorefront, type StorefrontDb } from '@/lib/publicStorefront';

/** The part of the supabase-js client the intake uses (loose on purpose: the new tables are not in the generated types). */
export interface IntakeDb {
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface IntakeInput {
  tenantId: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  idempotencyKey: string | null;
  /** Check everything, place nothing. Used by "Send a test order". */
  dryRun?: boolean;
  nowMs?: number;
}

export interface IntakeResult { status: number; body: Record<string, unknown> }

const KEY_PATTERN = /^[A-Za-z0-9._:\-]{1,128}$/;
const ERROR_WRITE_EVERY_MS = 60_000;

const reply = (status: number, body: Record<string, unknown>): IntakeResult => ({ status, body });

export async function processIntake(db: IntakeDb, input: IntakeInput): Promise<IntakeResult> {
  const now = input.nowMs ?? Date.now();
  if (new TextEncoder().encode(input.rawBody).length > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: 'too_large', message: `The request is larger than ${MAX_BODY_BYTES / 1024} KB.` });
  }

  const intake = await db.from('custom_site_intake')
    .select('mode, secret, last_error_at').eq('tenant_id', input.tenantId).maybeSingle();
  const row = intake.data as { mode: CustomSiteMode; secret: string | null; last_error_at: string | null } | null;
  if (intake.error || !row || !row.secret || !ownSiteActive(row.mode)) {
    return reply(403, { ok: false, error: 'not_enabled', message: 'Orders from an own website are not switched on for this restaurant.' });
  }

  // Keep only the newest problem, and write it at most once a minute so a flood cannot become a write flood.
  const recordError = async (message: string) => {
    const last = row.last_error_at ? Date.parse(row.last_error_at) : 0;
    if (now - last < ERROR_WRITE_EVERY_MS) return;
    await db.from('custom_site_intake')
      .update({ last_error: message.slice(0, 300), last_error_at: new Date(now).toISOString() })
      .eq('tenant_id', input.tenantId);
  };

  const verdict = await verifyRequest({
    secret: row.secret, timestamp: input.timestamp, signature: input.signature, body: input.rawBody, nowMs: now,
  });
  if (!verdict.ok) {
    const message = verdict.reason === 'timestamp'
      ? 'The request time is more than 5 minutes away from the server time.'
      : verdict.reason === 'missing'
        ? 'The timestamp or signature header is missing.'
        : 'The signature does not match. Check the secret key on the website.';
    await recordError(message);
    return reply(401, { ok: false, error: verdict.reason === 'timestamp' ? 'stale_timestamp' : verdict.reason === 'missing' ? 'missing_headers' : 'bad_signature', message });
  }

  if (!input.dryRun) {
    const since = new Date(now - 60_000).toISOString();
    const recent = await db.from('custom_site_orders')
      .select('idempotency_key', { count: 'exact', head: true }).eq('tenant_id', input.tenantId).gte('created_at', since);
    if ((recent.count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      return reply(429, { ok: false, error: 'rate_limited', message: `More than ${RATE_LIMIT_PER_MINUTE} orders in a minute. Try again shortly.` });
    }
  }

  let json: unknown;
  try { json = JSON.parse(input.rawBody); } catch {
    await recordError('The request body is not valid JSON.');
    return reply(400, { ok: false, error: 'bad_json', message: 'The request body is not valid JSON.' });
  }
  const parsed = intakeOrderSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 10).map(i => ({ field: i.path.join('.') || '(body)', message: i.message }));
    await recordError(`Order rejected: ${issues[0]?.field} — ${issues[0]?.message}`);
    return reply(422, { ok: false, error: 'invalid_order', issues });
  }
  const order = parsed.data;

  // A settings read that fails must not stop an order (same as the built-in website): only a clear "closed" blocks.
  let blocked: string | null = null;
  try {
    const storefront = await readStorefront(db as unknown as StorefrontDb, input.tenantId);
    blocked = intakeBlockedReason(storefront, order);
  } catch { /* fail open */ }
  if (blocked) {
    await recordError(`Order refused: ${blocked}`);
    return reply(409, { ok: false, error: 'closed', message: blocked });
  }

  if (input.dryRun) return reply(200, { ok: true, dryRun: true, message: 'The key, the signature and the order shape are all valid. Nothing was placed.' });

  const key = input.idempotencyKey ?? '';
  if (!KEY_PATTERN.test(key)) {
    return reply(400, { ok: false, error: 'bad_idempotency_key', message: 'Send an X-DT-Idempotency-Key header (1–128 letters, digits . _ : -), one per order.' });
  }
  const claim = await db.from('custom_site_orders').insert({ tenant_id: input.tenantId, idempotency_key: key });
  if (claim.error) {
    if (claim.error.code === '23505') {
      const prev = await db.from('custom_site_orders')
        .select('order_id, order_number, unmatched').eq('tenant_id', input.tenantId).eq('idempotency_key', key).maybeSingle();
      if (prev.data?.order_id) {
        return reply(200, { ok: true, duplicate: true, orderId: prev.data.order_id, orderNumber: prev.data.order_number, unmatched: prev.data.unmatched ?? [] });
      }
      return reply(409, { ok: false, error: 'in_progress', message: 'The same order is still being processed. Retry in a few seconds.' });
    }
    return reply(500, { ok: false, error: 'server_error', message: 'The order could not be recorded. Retry.' });
  }

  const placed = await db.rpc('custom_site_place_order', {
    p_tenant: input.tenantId,
    p_branch: order.branchId ?? null,
    p_order: toPlaceOrderPayload(order),
  });
  if (placed.error || !placed.data) {
    // Let the site retry the same key once the problem is fixed.
    await db.from('custom_site_orders').delete().eq('tenant_id', input.tenantId).eq('idempotency_key', key);
    const message = placed.error?.message ?? 'The order was not accepted.';
    await recordError(`Order rejected: ${message}`);
    return reply(422, { ok: false, error: 'rejected', message });
  }

  const result = placed.data as { id: string; order_number: number; total: number; unmatched: unknown[] };
  await db.from('custom_site_orders')
    .update({ order_id: result.id, order_number: result.order_number, unmatched: result.unmatched ?? [] })
    .eq('tenant_id', input.tenantId).eq('idempotency_key', key);
  await db.from('custom_site_intake')
    .update({ last_order_at: new Date(now).toISOString(), last_error: null, last_error_at: null })
    .eq('tenant_id', input.tenantId);

  return reply(201, {
    ok: true, orderId: result.id, orderNumber: result.order_number, total: result.total, unmatched: result.unmatched ?? [],
  });
}
