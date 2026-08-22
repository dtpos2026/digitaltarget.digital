// ============================================================================
// CLOUD SYNC ENGINE
//
// This is the production backend path. The old per-restaurant backend toggle
// was removed because authentication and data must never point at different
// backends.
//
// What is KEPT from the existing offline architecture (deliberately):
//   • localDb.ts        — IndexedDB row storage. Untouched.
//   • deferredSync.ts   — the queue, backoff schedule, dead-letter handling.
//                         Untouched; we only register a different flusher.
//   • Offline-first billing — a bill saves and prints locally, never awaiting
//                         the network. Unchanged.
//
// What CHANGES: the write target, and three guarantees that Firestore could
// not give us and that caused real incidents in the field.
// ============================================================================

import { localDb } from './localDb';
import {
  registerDeferredFlusher, getDeferredOps, type DeferredOp,
} from './deferredSync';
import {
  sb, isSupabaseConfigured, currentTenantId, currentBranchId,
  pushSyncBatch, type SyncOp, type SyncResult,
} from './supabase';

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

const DEVICE_KEY = 'dtpos-supabase-device-id';

/** The registered device row id. apply_sync_batch reads the BRANCH from it. */
export function getSyncDeviceId(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

export function setSyncDeviceId(id: string): void {
  try { localStorage.setItem(DEVICE_KEY, id); } catch { /* ignore */ }
}

/**
 * Register this machine against a branch. The branch is fixed HERE, and the
 * server reads it from the device row on every sync — which is what makes
 * cross-branch writes structurally impossible rather than merely discouraged.
 */
export interface DeviceRegistration {
  deviceId: string;
  approved: boolean;
  blocked: boolean;
  autoApproved: boolean;
  deviceLimit: number | null;
  activeDevices: number | null;
  reason?: string;
}

export async function registerThisDevice(
  hardwareId: string, label: string, branchId: string,
  platform?: string, appVersion?: string,
  meta?: Record<string, unknown>, ip?: string | null,
): Promise<DeviceRegistration> {
  const { data, error } = await sb().rpc('register_device', {
    p_hardware_id: hardwareId, p_label: label, p_branch_id: branchId,
    p_platform: platform ?? null, p_app_version: appVersion ?? null,
    p_meta: (meta ?? {}) as any, p_ip: ip ?? null,
  });
  if (error) throw error;
  const d = data as any;
  setSyncDeviceId(d.device_id);
  return {
    deviceId: d.device_id,
    approved: !!d.approved,
    blocked: !!d.blocked,
    autoApproved: !!d.auto_approved,
    deviceLimit: d.device_limit ?? null,
    activeDevices: d.active_devices ?? null,
    reason: d.reason ?? undefined,
  };
}

/** Live-watch a device row until Super Admin approves (or blocks) it. */
export function watchDeviceApproval(
  deviceId: string,
  cb: (state: { approved: boolean; blocked: boolean }) => void,
): () => void {
  let stopped = false;
  const check = async () => {
    if (stopped) return;
    const { data } = await sb().from('devices')
      .select('approved,blocked').eq('id', deviceId).maybeSingle();
    if (data && !stopped) cb({ approved: !!(data as any).approved, blocked: !!(data as any).blocked });
  };
  const channel = sb()
    .channel(`device-approval-${deviceId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'devices', filter: `id=eq.${deviceId}` },
      (p: any) => cb({ approved: !!p.new?.approved, blocked: !!p.new?.blocked }))
    .subscribe();
  const timer = window.setInterval(check, 6000);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    try { sb().removeChannel(channel); } catch { /* ignore */ }
  };
}


// ---------------------------------------------------------------------------
// Which local collections map to which server entities
// ---------------------------------------------------------------------------

const SYNCABLE: Record<string, SyncOp['entity']> = {
  orders: 'orders',
  orderItems: 'order_items',
  orderPayments: 'order_payments',
};

export function isSyncable(col: string): boolean {
  return col in SYNCABLE;
}

// ---------------------------------------------------------------------------
// PUSH — device → server
// ---------------------------------------------------------------------------

/** How many ops go up in one transaction. Whole batch applies or none does. */
export const BATCH_SIZE = 100;

/**
 * Build the op envelope.
 *
 * `op_id` is DETERMINISTIC per (collection, entity, revision). That is the
 * idempotency key: if the connection drops after the server committed but
 * before we saw the response, the retry carries the SAME op_id, the server
 * recognises it, and returns `duplicate` instead of writing a second order.
 * This is the fix for "one order created, two showing in Retrieve".
 */
export function buildSyncOp(op: DeferredOp, row: Record<string, unknown>): SyncOp | null {
  const entity = SYNCABLE[op.col];
  if (!entity) return null;
  return {
    op_id: opIdFor(op),
    entity,
    entity_id: op.entityId,
    operation: op.op === 'delete' ? 'delete' : (row ? 'update' : 'insert'),
    client_seq: op.at,
    client_time: new Date(op.at).toISOString(),
    data: row ?? {},
  };
}

/**
 * A stable UUIDv5-style id derived from the op's own identity. Not random:
 * a random id on every retry would defeat the whole replay guard.
 */
export function opIdFor(op: Pick<DeferredOp, 'col' | 'entityId' | 'at'>): string {
  const seed = `${op.col}:${op.entityId}:${op.at}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2246822519) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  // >>> 0 on every value: a bare XOR in JS yields a SIGNED 32-bit int, and a
  // negative one renders as '-1a2b3c4d', producing a 13-character group and an
  // invalid UUID that Postgres would reject at sync time.
  const a = hex(h1 >>> 0), b = hex(h2 >>> 0),
        c = hex((h1 ^ h2) >>> 0), d = hex((h1 + h2) >>> 0);
  // Shape it as a valid v4-looking UUID so Postgres accepts it as uuid.
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

export interface PushOutcome {
  sent: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  /** Server-assigned order numbers, keyed by order id. */
  orderNumbers: Record<string, number>;
  error?: string;
}

/**
 * Push everything currently queued.
 *
 * Order numbers come back FROM the server. A bill created offline carries a
 * provisional local label until this point; it is never guessed on the device,
 * because that is exactly how two tills both minted #42.
 */
export async function pushPending(): Promise<PushOutcome> {
  const out: PushOutcome = {
    sent: 0, applied: 0, duplicates: 0, conflicts: 0, rejected: 0, orderNumbers: {},
  };
  if (!isSupabaseConfigured()) { out.error = 'supabase not configured'; return out; }

  const deviceId = getSyncDeviceId();
  if (!deviceId) { out.error = 'device not registered'; return out; }

  const queued = getDeferredOps().filter(o => isSyncable(o.col));
  if (!queued.length) return out;

  // Order matters: an order_item cannot be inserted before its order exists.
  const rank = (c: string) => (c === 'orders' ? 0 : c === 'orderItems' ? 1 : 2);
  queued.sort((a, b) => rank(a.col) - rank(b.col) || a.at - b.at);

  for (let i = 0; i < queued.length; i += BATCH_SIZE) {
    const slice = queued.slice(i, i + BATCH_SIZE);
    const ops: SyncOp[] = [];

    for (const q of slice) {
      const rows = await localDb.getRows(q.col as any);
      const row = rows.find((r: any) => r.id === q.entityId);
      if (!row && q.op !== 'delete') continue;   // row vanished locally; skip
      const built = buildSyncOp(q, row as any);
      if (built) ops.push(built);
    }
    if (!ops.length) continue;

    try {
      const results: SyncResult[] = await pushSyncBatch(deviceId, ops);
      out.sent += ops.length;
      applyResults(results, out);
    } catch (e: any) {
      // The batch is one transaction: nothing was written. Leave the ops in
      // the queue and let the existing backoff schedule retry them.
      out.error = e?.message ?? String(e);
      break;
    }
  }
  return out;
}

export function applyResults(results: SyncResult[], out: PushOutcome): void {
  for (const r of results) {
    if (r.result === 'applied') {
      out.applied++;
      if (r.entity_id && typeof r.order_number === 'number') {
        out.orderNumbers[r.entity_id] = r.order_number;
      }
    } else if (r.result === 'duplicate') {
      // Already on the server. Success from the device's point of view.
      out.duplicates++;
    } else if (r.result === 'conflict') {
      // A stale copy tried to undo a settled bill. The server refused; the
      // device must accept the server's version rather than retrying.
      out.conflicts++;
    } else {
      out.rejected++;
    }
  }
}

/** Hook the existing deferred queue up to Supabase. */
export function installSupabaseFlusher(): void {
  registerDeferredFlusher(async (col, id, op) => {
    const deviceId = getSyncDeviceId();
    if (!deviceId) throw new Error('device not registered');
    const rows = await localDb.getRows(col as any);
    const row = rows.find((r: any) => r.id === id);
    const built = buildSyncOp(
      { id, col, entityId: id, op, at: Date.now(), firstEnqueuedAt: Date.now(),
        deviceId, attempts: 0 },
      row as any,
    );
    if (!built) return;   // not a syncable collection — nothing to do
    const results = await pushSyncBatch(deviceId, [built]);
    const r = results[0];
    if (r && (r.result === 'rejected')) {
      throw new Error(r.reason || 'rejected by server');
    }
    // 'duplicate' and 'conflict' are terminal, not retryable: throwing would
    // spin the op through the backoff schedule to no purpose.
  });
}

// ---------------------------------------------------------------------------
// PULL — server → device (cursor delta, never a full-collection read)
// ---------------------------------------------------------------------------

const CURSOR_PREFIX = 'dtpos-sync-cursor::';

export function getCursor(table: string): string {
  try {
    return localStorage.getItem(CURSOR_PREFIX + table) || '1970-01-01T00:00:00Z';
  } catch { return '1970-01-01T00:00:00Z'; }
}

export function setCursor(table: string, iso: string): void {
  try { localStorage.setItem(CURSOR_PREFIX + table, iso); } catch { /* ignore */ }
}

/**
 * Pull orders changed since the cursor.
 *
 * This is the piece that removes the read-quota pressure behind the tablet
 * latency and "data disappeared" reports: the device asks for what changed,
 * not for the whole collection on every listener attach.
 */
export async function pullOrders(limit = 500): Promise<{ rows: any[]; cursor: string }> {
  const branchId = currentBranchId();
  if (!branchId) return { rows: [], cursor: getCursor('orders') };

  const since = getCursor('orders');
  const { data, error } = await sb().rpc('pull_orders_delta', {
    p_branch: branchId, p_since: since, p_limit: limit,
  });
  if (error) throw error;

  const rows = (data ?? []) as any[];
  let cursor = since;
  for (const r of rows) {
    if (r.updated_at && r.updated_at > cursor) cursor = r.updated_at;
  }
  if (rows.length) setCursor('orders', cursor);
  return { rows, cursor };
}

// ---------------------------------------------------------------------------
// REALTIME — the rewritten merge logic
// ---------------------------------------------------------------------------

/**
 * ⚠️ THE MOST IMPORTANT DIFFERENCE IN THIS WHOLE MIGRATION.
 *
 * Firestore's onSnapshot delivered the COMPLETE result set on every change,
 * and the old merge treated that set as authoritative: any local row absent
 * from it was deleted. That behaviour caused two separate data-loss incidents
 * — printed bills vanishing from reports, and rows without an `_updatedAt`
 * stamp being dropped permanently.
 *
 * Supabase Realtime delivers ONE ROW EVENT. There is no "complete set", so
 * the applier below can only ever ADD or UPDATE a row from an event. It has
 * no code path that removes a local row for being absent, because absence is
 * not something an event stream can express.
 *
 * A DELETE is applied only when the server explicitly says DELETE.
 */
export type RowEvent =
  | { type: 'INSERT' | 'UPDATE'; row: Record<string, any> }
  | { type: 'DELETE'; row: Record<string, any> };

export function applyRowEvent(
  local: Record<string, any>[],
  ev: RowEvent,
): Record<string, any>[] {
  const id = ev.row?.id;
  if (!id) return local;                       // malformed: change nothing

  if (ev.type === 'DELETE') {
    return local.filter(r => r.id !== id);     // explicit only
  }

  const idx = local.findIndex(r => r.id === id);
  if (idx === -1) return [...local, ev.row];

  // Do not let an older event overwrite a newer local row. Events can arrive
  // out of order after a reconnect.
  const incoming = Date.parse(ev.row.updated_at ?? '') || 0;
  const existing = Date.parse(local[idx].updated_at ?? '') || 0;
  if (incoming && existing && incoming < existing) return local;

  const next = local.slice();
  next[idx] = { ...local[idx], ...ev.row };
  return next;
}

/**
 * Subscribe to a branch's orders.
 *
 * Contract, in this order and no other:
 *   1. fetch the current set once (cursor pull)
 *   2. apply row events incrementally
 *   3. on reconnect, re-fetch by cursor — never assume events survived the gap
 */
export function subscribeOrders(
  branchId: string,
  onEvent: (ev: RowEvent) => void,
  onResync: () => void,
): () => void {
  const tenantId = currentTenantId();
  if (!tenantId) return () => {};

  const channel = sb()
    .channel(`orders:${branchId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
      (payload: any) => {
        const type = payload.eventType as RowEvent['type'];
        const row = type === 'DELETE' ? payload.old : payload.new;
        onEvent({ type, row } as RowEvent);
      })
    .subscribe((status: string) => {
      // A gap in the stream means events were missed. Re-fetch by cursor
      // rather than trusting that the local set is still complete.
      if (status === 'SUBSCRIBED') onResync();
    });

  return () => { try { sb().removeChannel(channel); } catch { /* ignore */ } };
}

// ---------------------------------------------------------------------------
// Device presence — heartbeat + location
//
// The Live Map plots a pin per device from devices.lat/lng, and the Devices
// screen shows "last seen". Neither has a source unless the till reports it,
// which is why both surfaces used to render empty even with tills online.
// ---------------------------------------------------------------------------

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function sendHeartbeat(deviceId: string): Promise<void> {
  const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 300000 },
    );
  });
  const { error } = await sb().rpc('device_heartbeat', {
    p_device_id: deviceId,
    p_lat: coords?.lat ?? null,
    p_lng: coords?.lng ?? null,
    p_app_version: null,
  });
  if (error) throw error;
}

/** Report presence now, then every two minutes while the app is open. */
export function startDeviceHeartbeat(deviceId?: string | null): void {
  const id = deviceId ?? getSyncDeviceId();
  if (!id || !isSupabaseConfigured()) return;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  void sendHeartbeat(id).catch((e) => console.warn('[sync] heartbeat failed', e?.message ?? e));
  heartbeatTimer = setInterval(() => {
    void sendHeartbeat(id).catch(() => { /* transient — the next tick retries */ });
  }, 120000);
}

export function stopDeviceHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// ---------------------------------------------------------------------------
// End-to-end self test
//
// Proves the whole chain on the real backend: device registered → order
// pushed → server-assigned number → readable back through the delta pull.
// The probe order is marked void and carries `selfTest`, so it never counts
// as trade.
// ---------------------------------------------------------------------------

export interface SyncSelfTest {
  ok: boolean;
  steps: { label: string; ok: boolean; detail?: string }[];
  orderNumber?: number;
}

export async function runSyncSelfTest(): Promise<SyncSelfTest> {
  const steps: SyncSelfTest['steps'] = [];
  const add = (label: string, ok: boolean, detail?: string) => { steps.push({ label, ok, detail }); return ok; };

  if (!isSupabaseConfigured()) {
    add('Backend configured', false, 'Supabase not configured');
    return { ok: false, steps };
  }
  add('Backend configured', true);

  const deviceId = getSyncDeviceId();
  if (!add('Device registered', !!deviceId, deviceId ? undefined : 'Sign in on the POS to register this device')) {
    return { ok: false, steps };
  }

  const orderId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`) as string;
  let branchId = currentBranchId();
  let tenantId = currentTenantId();
  if (!tenantId || !branchId) {
    // Claims can be missing when the access-token hook is off; resolve from the
    // profile row before declaring the restaurant link broken.
    const { hydrateIdentityFromProfile, initSupabaseAuth } = await import('./supabase');
    await initSupabaseAuth();
    await hydrateIdentityFromProfile(true);
    branchId = currentBranchId();
    tenantId = currentTenantId();
  }

  if (!tenantId || !branchId) {
    add('Restaurant and branch resolved', false,
      !tenantId
        ? 'Restaurant link is missing — sign in as the restaurant owner on this device'
        : 'No branch found for this restaurant — create a branch first');
    return { ok: false, steps };
  }
  add('Restaurant and branch resolved', true);

  const now = Date.now();
  const before = new Date(now - 60000).toISOString();
  let orderNumber: number | undefined;

  try {
    const results = await pushSyncBatch(deviceId!, [{
      op_id: opIdFor({ col: 'orders', entityId: orderId, at: now }),
      entity: 'orders',
      entity_id: orderId,
      operation: 'insert',
      client_seq: now,
      client_time: new Date(now).toISOString(),
      data: { status: 'void', total: 0, selfTest: true },
    }]);
    const r = results[0];
    orderNumber = r?.order_number;
    if (!add('Order pushed to server', r?.result === 'applied' || r?.result === 'duplicate', r?.reason)) {
      return { ok: false, steps };
    }
    add('Server order number assigned', typeof orderNumber === 'number', orderNumber ? `#${orderNumber}` : 'none');
  } catch (e: any) {
    add('Order pushed to server', false, e?.message ?? String(e));
    return { ok: false, steps };
  }

  try {
    const { pullOrdersDelta } = await import('./supabase');
    const rows = await pullOrdersDelta(branchId, before, 200) as any[];
    add('Order read back from server', rows.some((r) => r?.id === orderId));
  } catch (e: any) {
    add('Order read back from server', false, e?.message ?? String(e));
  }

  try {
    const { count, error } = await sb().from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);
    if (error) throw error;
    add('Menu sync reachable', true, `${count ?? 0} items on server`);
  } catch (e: any) {
    add('Menu sync reachable', false, e?.message ?? String(e));
  }

  return { ok: steps.every((s) => s.ok), steps, ...(orderNumber !== undefined ? { orderNumber } : {}) };
}
