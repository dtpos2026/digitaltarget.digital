// ============================================================================
// SUPABASE STORE — the data layer behind the flag
//
// Implements the same three operations store.ts already routes every cloud
// read and write through:
//
//     cloudLoadAll()          load every collection
//     cloudSaveItem(col,id,d) write one row
//     cloudDeleteItem(col,id) remove one row
//
// Because store.ts already funnels through that seam, routing these three by
// the `supabaseBackendEnabled` flag moves the whole application's data layer
// without touching the 214 individual call sites — and without changing a
// single POS workflow.
//
// Firebase remains the default. A restaurant that has not opted in sees no
// change whatsoever.
// ============================================================================

import { sb, isSupabaseConfigured } from './supabase';
import { authTenantId, authBranchId } from './authProvider';
import { isPublicTenantRoute, parsePublicTenantId } from './publicTenant';

import { allocateServerOrderNumber, isOrderNumberCollision, emitOrderRenumbered } from './orderNumbers';


// ---------------------------------------------------------------------------
// Collection mapping: the app's camelCase names -> Postgres tables
// ---------------------------------------------------------------------------

/**
 * ===== v1.22.0 — collections that must NOT be pushed by the generic writer =====
 *
 * Three shapes could never survive a generic upsert, and each one raised
 * "Cloud sync issue — data is saved locally and will retry" on every attempt.
 * The queue then retried forever, so the toast came back again and again while
 * nothing ever synced:
 *
 *   waiters / riders / users -> user_profiles
 *       user_profiles has no `id` column at all — its primary key is
 *       `user_id`. Every write failed with "column id does not exist".
 *       Staff are created through pos_create_user(), which hashes the
 *       password server-side; they must never come through here.
 *
 *   marketingContacts -> customers
 *       Sales leads carry restaurantName / source / linkedTenantId, none of
 *       which exist on `customers`. They belong to admin_marketing_contacts
 *       and are handled by marketingContacts.ts.
 *
 *
 * Skipping them here is correct rather than a workaround: each already has a
 * dedicated, safer path.
 */
const NOT_GENERICALLY_SYNCABLE = new Set([
  'users', 'waiters', 'riders',
  'marketingContacts',
]);

export const TABLE_FOR: Record<string, string> = {
  categories:        'categories',
  menuItems:         'menu_items',
  orders:            'orders',
  tables:            'dining_tables',
  floors:            'floors',
  kitchens:          'kitchens',
  waiters:           'user_profiles',      // waiters are staff rows
  riders:            'user_profiles',
  users:             'user_profiles',
  inventory:         'inventory_items',
  stockLogs:         'stock_logs',
  employees:         'employees',
  attendance:        'attendance',
  leaves:            'leaves',
  payslips:          'payslips',
  advances:          'advances',
  accountCategories: 'account_categories',
  transactions:      'transactions',
  parties:           'parties',
  ledger:            'ledger_entries',
  dailyCashCloses:   'day_closes',
  receivingEntries:  'receiving_entries',
  marketingContacts: 'customers',          // marketing list lives on customers
  recipes:           'recipes',
  wastages:          'wastages',
  customers:         'customers',
  branches:          'branches',
  creditPayments:    'credit_payments',
  promoCodes:        'promo_codes',
  paymentAccounts:   'payment_accounts',
  deals:             'deals',
  shifts:            'shifts',
  refunds:           'refunds',
};

/** Tables that carry branch_id and must be stamped on write. */
const BRANCH_SCOPED = new Set([
  'orders', 'dining_tables', 'floors', 'kitchens', 'inventory_items',
  'stock_logs', 'wastages', 'receiving_entries', 'credit_payments',
  'payment_accounts', 'shifts', 'refunds', 'transactions', 'day_closes',
  'attendance', 'ledger_entries', 'credit_payments',
]);

/**
 * Tables that store the whole app record in a `data` jsonb column.
 * These modules (HR, accounts, recipes, wastage, refunds, ...) carry rich,
 * evolving shapes; a document column keeps every field safe instead of
 * dropping (or rejecting) anything the schema has not caught up with.
 */
export const DOC_TABLES = new Set([
  'stock_logs', 'employees', 'attendance', 'leaves', 'payslips', 'advances',
  'account_categories', 'transactions', 'parties', 'ledger_entries', 'day_closes',
  'receiving_entries', 'recipes', 'wastages', 'credit_payments', 'refunds',
]);

/**
 * ===== Backend document store =====
 *
 * Waiters and riders are ordinary business records the restaurant edits from
 * the POS, but they have no table of their own: pushing them at user_profiles
 * always failed (no `id` column), so they were skipped and stayed device-bound
 * — a browser reset or a second till lost every waiter and rider.
 *
 * They now persist server-side in public.module_documents, keyed by kind, the
 * same durable path the other document modules already use. Staff *logins*
 * still go through the dedicated pos_set_staff_profile path; this only stores
 * the roster record.
 */
export const DOC_STORE_COLLECTIONS = new Set(['waiters', 'riders']);

export function isDocStoreCollection(col: string): boolean {
  return DOC_STORE_COLLECTIONS.has(col);
}

/**
 * ===== v1.26.0 — tables that carry a `deleted_at` tombstone =====
 *
 * A delete must be a FACT that replicates, not an absence that has to be
 * guessed at. Eleven of these tables used to be hard-DELETEd; a second device
 * then read the collection, saw the row simply missing, and could not tell
 * "deleted elsewhere" from "my copy has not been pushed yet". The union merge
 * assumed the second, re-added the row and pushed it back up — so a delete
 * made on one till undid itself within a minute.
 *
 * With a tombstone the server says *deleted*, and every device can apply it.
 *
 * This one set now drives all three places that used to disagree: the delete
 * verb (soft vs hard), the read filter, and the tombstone-aware merge read.
 */
export const SOFT_DELETE = new Set<string>([
  'categories', 'menu_items', ...DOC_TABLES,
  // Bills keep their row (admin history) but stop loading into the POS.
  'orders', 'order_items', 'order_payments',
  // v1.26.0 — previously hard-deleted, so their deletions never replicated.
  'dining_tables', 'floors', 'kitchens', 'inventory_items', 'inventory_categories',
  'customers', 'branches', 'deals', 'promo_codes', 'payment_accounts', 'shifts',
]);

export function tableFor(col: string): string | null {
  if (NOT_GENERICALLY_SYNCABLE.has(col)) return null;
  return TABLE_FOR[col] ?? null;
}

/** Exposed for tests: is this collection handled by a dedicated path? */
export function isGenericallySyncable(col: string): boolean {
  return !NOT_GENERICALLY_SYNCABLE.has(col) && !!TABLE_FOR[col];
}


// ---------------------------------------------------------------------------
// Field mapping
//
// The app uses camelCase; Postgres uses snake_case. Rather than rename fields
// across 346 source files — which would be a rewrite, not a migration — the
// row is translated at this boundary and nowhere else.
// ---------------------------------------------------------------------------

export function toSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Foreign-key columns are typed uuid in Postgres. Legacy local records can
 * carry a human label there (e.g. kitchenId: "Kitchen"), which Postgres
 * rejects with `invalid input syntax for type uuid`. Anything that is not a
 * uuid is sent as null so the row still syncs.
 */
export function uuidOrNull(v: any): string | null {
  return typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim() : null;
}

/**
 * Primary keys in Postgres are uuid, but older local records (and several
 * modules that still mint ids with Date.now()+random) carry short ids like
 * "mt26w16flh78". Sending those rejects the whole row with
 * `invalid input syntax for type uuid`. A deterministic uuid is derived from
 * the local id instead, so the same record always maps to the same cloud row
 * on every device, and the original id stays inside the document payload.
 */
export function stableUuid(localId: string): string {
  const s = String(localId);
  // 4 independent FNV-1a passes -> 128 deterministic bits.
  const words: number[] = [];
  for (let seed = 0; seed < 4; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b9);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    words.push(h >>> 0);
  }
  const hex = words.map(w => w.toString(16).padStart(8, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '5' + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** The cloud primary key for a local record id. */
export function cloudId(localId: string): string {
  return uuidOrNull(localId) ?? stableUuid(localId);
}

/**
 * The cloud value for a FOREIGN KEY column.
 *
 * ===== v1.25.19 — this used to be uuidOrNull(), and that silently broke =====
 * ===== every relationship in an existing restaurant.                    =====
 *
 * A record's own id already goes through cloudId(), so a category with the
 * legacy id "cat-deals" lands in Postgres under a derived uuid. But its menu
 * items sent category_id through uuidOrNull(), which returns NULL for anything
 * that is not already a uuid — so all 172 menu items arrived with NO CATEGORY.
 *
 * Nothing errored. The rows saved. The links did not. Then the next cloud load
 * overwrote the local copy that still had them, and the menu "disappeared on
 * refresh" — which is precisely the symptom that was reported.
 *
 * Because cloudId() is deterministic, "cat-deals" maps to the same uuid whether
 * it arrives as a category's own id or as a menu item's category_id, so the
 * relationship survives the move without any data migration.
 *
 * Empty / missing stays null: a row with no category should have no category.
 */
export function cloudFk(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return cloudId(s);
}


/**
 * Real Postgres columns for the tables written through the generic path.
 * Anything else the app carries stays local — the row still syncs instead of
 * being rejected wholesale by PostgREST.
 */
export const ALLOWED_COLUMNS: Record<string, Set<string>> = {
  dining_tables: new Set(['id', 'tenant_id', 'branch_id', 'floor_id', 'name', 'seats', 'shape',
    'status', 'current_order_id', 'seated_at', 'seated_guests', 'pos_x', 'pos_y', 'updated_at']),
  floors: new Set(['id', 'tenant_id', 'branch_id', 'name', 'sort_order']),
  kitchens: new Set(['id', 'tenant_id', 'branch_id', 'name', 'printer_role', 'is_active', 'updated_at']),
  customers: new Set(['id', 'tenant_id', 'name', 'phone', 'address', 'city', 'lat', 'lng',
    'loyalty_points', 'credit_balance', 'total_orders', 'total_spent', 'last_order_at',
    'is_blocked', 'pin_hash', 'created_at', 'updated_at',
    // v1.25.19 — these were being silently dropped. `addresses` is the
    // customer's saved delivery addresses; a delivery POS losing those is
    // not a cosmetic loss.
    'addresses', 'area', 'province', 'full_address', 'grade', 'avg_order_value',
    'order_frequency_days', 'first_order_at', 'favorite_item_id', 'favorite_item_name',
    'last_rider_id', 'preferred_branch_id', 'location_label', 'location_captured_at']),
  branches: new Set(['id', 'tenant_id', 'name', 'address', 'phone', 'city', 'lat', 'lng',
    'service_radius_km', 'is_active', 'sort_order', 'created_at', 'updated_at',
    'branch_code', 'email', 'registration_number', 'tax_number', 'invoice_prefix', 'invoice_footer']),

  payment_accounts: new Set(['id', 'tenant_id', 'branch_id', 'name', 'type', 'account_number',
    'is_active', 'sort_order']),
  deals: new Set(['id', 'tenant_id', 'name', 'price', 'items', 'image_path', 'is_active', 'updated_at', 'created_at']),
  promo_codes: new Set(['id', 'tenant_id', 'code', 'discount_type', 'discount_value',
    'max_uses', 'used_count', 'valid_from', 'valid_until', 'is_active',
    // The app tracks usageCount -> usage_count while the table had used_count.
    // Different names, so redemption counts never synced and a max-uses limit
    // could not be enforced across devices. A DB trigger keeps the pair in step.
    'usage_count', 'created_at']),
  shifts: new Set(['id', 'tenant_id', 'branch_id', 'device_id', 'opened_by', 'opened_by_name',
    'opened_at', 'starting_cash', 'closed_by', 'closed_by_name', 'closed_at', 'ending_cash',
    'expected_cash', 'variance', 'status']),
  inventory_categories: new Set(['id', 'tenant_id', 'name', 'sort_order']),
};

/**
 * v1.26.0 — every allow-listed table gained `updated_at` / `deleted_at`.
 * Leaving them out of the allow-list meant rowToDb() dropped them, so a
 * tombstone written locally could never be pushed.
 */
for (const cols of Object.values(ALLOWED_COLUMNS)) {
  cols.add('updated_at');
  cols.add('deleted_at');
}


/**
 * Columns that exist in Postgres for a given table. Anything the app carries
 * that has no column is preserved in `extra` (jsonb) rather than dropped —
 * silently losing a field is how "the note disappeared" bugs happen.
 */
export function rowToDb(col: string, data: Record<string, any>): Record<string, any> {
  if (col === 'orders') {
    // The orders table intentionally keeps the complete POS document in
    // `data`. Its typed columns are only the sync/query index. Sending every
    // app field as a top-level column caused PostgREST to reject fields such
    // as items, subtotal and paid_at, so paid bills never reached the cloud.
    return {
      branch_id: cloudFk(data.branchId),
      device_id: uuidOrNull(data.deviceId),
      order_number: Number.isFinite(Number(data.orderNumber)) ? Number(data.orderNumber) : null,
      status: data.status || 'running',
      total: Number(data.grandTotal) || 0,
      data: { ...data, id: data.id },
      client_seq: Number(data._updatedAt || data.clientSeq || Date.now()),
      deleted_at: data.deletedAt ? new Date(data.deletedAt).toISOString() : null,
    };
  }
  if (col === 'categories') {
    return {
      name: data.name,
      icon: data.icon || null,
      image_path: data.image || null,
      sort_order: Number(data.sortOrder) || 0,
      is_active: data.deleted !== true,
      deleted_at: data.deletedAt ? new Date(data.deletedAt).toISOString() : null,
    };
  }
  if (col === 'menuItems') {
    return {
      name: data.name,
      category_id: cloudFk(data.categoryId),
      kitchen_id: cloudFk(data.kitchenId),
      inventory_item_id: cloudFk(data.inventoryItemId),
      barcode: data.barcode || null,
      sku: data.sku || null,
      pricing_type: data.pricingType || 'fixed',
      price: Number(data.price) || 0,
      rate_per_kg: Number(data.ratePerKg) || 0,
      stock_per_unit: data.stockPerUnit == null ? null : Number(data.stockPerUnit),
      image_path: data.image || null,
      sub_category: data.subCategory || null,
      flavor_group: data.flavorGroup || null,
      flavors: Array.isArray(data.flavors) ? data.flavors : [],
      size_variants: Array.isArray(data.sizeVariants) ? data.sizeVariants : [],
      inch_variants: Array.isArray(data.inchVariants) ? data.inchVariants : [],
      is_token_item: data.isTokenItem === true,
      sort_order: Number(data.sortOrder) || 0,
      is_active: data.isActive !== false && data.deleted !== true,
      deleted_at: data.deletedAt ? new Date(data.deletedAt).toISOString() : null,
    };
  }
  if (col === 'inventory') {
    return {
      name: data.name,
      branch_id: cloudFk(data.branchId),
      category_id: cloudFk(data.categoryId),
      sku: data.sku || null,
      base_unit: data.baseUnit || data.unit || 'unit',
      unit: data.unit || data.baseUnit || 'unit',
      quantity: Number(data.quantity) || 0,
      cost_price: Number(data.costPrice) || 0,
      avg_cost_price: data.avgCostPrice == null ? null : Number(data.avgCostPrice),
      sale_price: Number(data.salePrice) || 0,
      low_stock_threshold: Number(data.lowStockThreshold) || 0,
      conversions: data.conversions && typeof data.conversions === 'object' ? data.conversions : {},
      image_path: data.image || null,
      is_active: data.isActive !== false,
    };
  }
  if (col === 'shifts') {
    // ===== v1.26.0 — a shift used to arrive at the cloud as a shell =====
    // ALLOWED_COLUMNS.shifts lists the fifteen columns the table has, and
    // rowToDb drops everything else. The app's Shift carries staffName,
    // staffEmail, payIns, payOuts, actualEndingCash and notes — NONE of which
    // are columns. So every cash pay-in and pay-out, the counted closing cash,
    // and the name of whoever ran the till were silently discarded at this
    // boundary. On a second device the shift existed but was empty, and the
    // cash-drawer report could not be reconstructed.
    //
    // The typed columns stay (the one-open-shift unique index and the reports
    // read them); the full record now rides alongside in `data`, the same way
    // an order does.
    const typed = allowListedRow('shifts', data);
    typed.data = { ...data, id: data.id };
    return typed;
  }
  const table = TABLE_FOR[col];
  if (table && DOC_TABLES.has(table)) {
    return {
      branch_id: cloudFk(data.branchId),
      data: { ...data, id: data.id },
      deleted_at: data.deletedAt ? new Date(data.deletedAt).toISOString() : null,
    };
  }
  return allowListedRow(table, data);
}

/** Map an app record onto the real columns of `table`, dropping the rest. */
function allowListedRow(table: string | undefined, data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const allowed = table ? ALLOWED_COLUMNS[table] : undefined;
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === undefined) continue;
    if (k.startsWith('_')) continue;            // local-only bookkeeping
    const column = toSnake(k);
    // Columns the table does not have (e.g. dining_tables.sessions) must never
    // be sent: PostgREST rejects the whole row with
    // "Could not find the 'x' column ... in the schema cache" and the op
    // retries forever.
    if (allowed && !allowed.has(column)) continue;
    // uuid FK columns must never receive a raw legacy id — Postgres rejects
    // the whole row with `invalid input syntax for type uuid`. Previously
    // these were nulled, which saved the row but DESTROYED the relationship.
    // cloudFk() derives the same uuid the referenced record itself will use,
    // so the link survives instead.
    if (k !== 'id' && /Id$/.test(k) && typeof v === 'string' && !UUID_RE.test(v.trim())) {
      out[column] = cloudFk(v);
      continue;
    }
    // A record's own id is the cloud primary key.
    if (k === 'id') { out[column] = cloudId(String(v)); continue; }
    out[column] = v;
  }
  return out;
}


/** The plain column-to-camelCase mapping, with no document overlay. */
function columnsFromDb(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    if (v === null) continue;
    if (k === 'data') continue;               // handled by the document overlay
    out[toCamel(k)] = v;
  }
  // store.ts sorts and merges on _updatedAt; derive it from updated_at so the
  // existing conflict logic keeps working unchanged.
  if (row.updated_at) out._updatedAt = new Date(row.updated_at).getTime();
  if ('image_path' in row) {
    out.image = row.image_path ?? undefined;
    delete out.imagePath;
  }
  if ('deleted_at' in row) {
    out.deleted = Boolean(row.deleted_at);
    out.deletedAt = row.deleted_at ? new Date(row.deleted_at).getTime() : undefined;
  }
  return out;
}

export function rowFromDb(row: Record<string, any>, table?: string): Record<string, any> {
  if (row && row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
    const payload = { ...row.data } as Record<string, any>;
    payload.id = payload.id || row.id;
    if (row.branch_id) payload.branchId = row.branch_id;
    payload.createdAt = payload.createdAt || row.created_at || new Date().toISOString();
    payload._updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Number(payload._updatedAt || 0);
    if (row.deleted_at) { payload.deleted = true; payload.deletedAt = new Date(row.deleted_at).getTime(); }
    if (table && DOC_TABLES.has(table)) return payload;
    // ===== v1.26.0 — a table can have BOTH typed columns and a document =====
    // `shifts` keeps its typed columns (the one-open-shift unique index and the
    // reports read them) AND the full record, because the allow-list was
    // dropping the staff name, both cash-movement lists, the counted closing
    // cash and the notes — everything a shift is actually for. The columns are
    // the index; the document is the record.
    if (table && table !== 'orders') return { ...columnsFromDb(row), ...payload };
    payload.orderNumber = row.order_number ?? payload.orderNumber;
    payload.status = row.status || payload.status || 'running';
    payload.grandTotal = Number(row.total ?? payload.grandTotal) || 0;
    payload.items = Array.isArray(payload.items) ? payload.items : [];
    payload.payments = Array.isArray(payload.payments) ? payload.payments : [];
    return payload;
  }
  const out = columnsFromDb(row);
  // Defensive defaults for legacy/partially migrated order rows. UI modules
  // can safely render them while newer writes repair their full payload.
  if ('order_number' in row || 'total' in row) {
    out.items = Array.isArray(out.items) ? out.items : [];
    out.payments = Array.isArray(out.payments) ? out.payments : [];
    out.grandTotal = Number(out.grandTotal ?? out.total) || 0;
    out.createdAt = out.createdAt || row.created_at || new Date().toISOString();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function supabaseReady(): boolean {
  return isSupabaseConfigured() && !!authTenantId();
}

/**
 * Tenant used for READS.
 *
 * A customer who scans a table QR is not signed in, so authTenantId() is null.
 * On the public tenant routes (#/order/:tenantId, #/track/:tenantId, ...) the
 * restaurant is in the URL, and RLS exposes only the public rows (active menu,
 * categories, deals, branches) to anon. Writes still require a real session.
 */
function readTenantId(): string | null {
  const t = authTenantId();
  if (t) return t;
  try {
    if (typeof window === 'undefined') return null;
    if (!isPublicTenantRoute()) return null;
    return parsePublicTenantId();
  } catch { return null; }
}

// ----- Document-store helpers (module_documents) ---------------------------

async function docStoreLoad(kind: string, includeDeleted = false): Promise<any[]> {
  const tenantId = readTenantId();
  if (!tenantId) return [];
  let request = sb()
    .from('module_documents')
    .select('doc_id, data, updated_at, deleted_at')
    .eq('tenant_id', tenantId)
    .eq('kind', kind);
  if (!includeDeleted) request = request.is('deleted_at', null);
  const { data, error } = await request;
  if (error) {
    console.error(`[supabase] load ${kind} (module_documents) failed`, error.message);
    throw error;
  }
  return (data ?? []).map((r: any) => ({
    ...(r.data && typeof r.data === 'object' ? r.data : {}),
    id: (r.data?.id as string) || r.doc_id,
    _updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
    ...(r.deleted_at ? { deleted: true, deletedAt: new Date(r.deleted_at).getTime() } : {}),
  }));
}

async function docStoreSave(kind: string, id: string, data: any): Promise<void> {
  const tenantId = authTenantId();
  if (!tenantId) throw new Error('Restaurant identity is not ready; cloud save will retry');
  const { error } = await sb().from('module_documents').upsert({
    tenant_id: tenantId,
    branch_id: authBranchId() || null,
    kind,
    doc_id: String(id),
    data: { ...(data || {}), id },
    deleted_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,kind,doc_id' });
  if (error) {
    console.error(`[supabase] save ${kind}/${id} failed`, error.message);
    throw error;
  }
}

async function docStoreDelete(kind: string, ids: string[]): Promise<string[]> {
  const tenantId = authTenantId();
  const unique = Array.from(new Set(ids.filter(Boolean).map(String)));
  if (!unique.length) return [];
  if (!tenantId) throw new Error('Restaurant identity is not ready; cloud delete will retry');
  const { error } = await sb().from('module_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('kind', kind).in('doc_id', unique);
  if (error) {
    console.error(`[supabase] delete ${kind} failed`, error.message);
    throw error;
  }
  return unique;
}

/**
 * Load one collection.
 *
 * RLS already restricts rows to this tenant and (for branch-scoped tables)
 * this branch, so no client-side filter is needed — and could not be trusted
 * anyway. The tenant filter below is belt-and-braces, not the control.
 */
export interface LoadOptions {
  /**
   * Return tombstoned rows too, flagged `deleted: true`.
   *
   * The merge path needs them. It compares the cloud against the local cache
   * and must be able to distinguish "deleted on another device" (drop it)
   * from "not in the cloud at all" (keep it — it may be an unsynced write).
   * Filtering tombstones out of the read collapses those two into one and is
   * exactly why deletions used to resurrect themselves.
   *
   * The plain UI read path leaves this off and never sees a deleted row.
   */
  includeDeleted?: boolean;
}

export async function sbLoadCollection(col: string, opts: LoadOptions = {}): Promise<any[]> {
  if (isDocStoreCollection(col)) return docStoreLoad(col, opts.includeDeleted);
  const table = tableFor(col);
  const tenantId = readTenantId();

  if (!table || !tenantId) return [];


  let request = sb().from(table).select('*').eq('tenant_id', tenantId);
  // Day Close soft-deletes bills so the admin keeps the history on the
  // server, but a closed day must never load back into the till.
  if (SOFT_DELETE.has(table) && !opts.includeDeleted) request = request.is('deleted_at', null);
  const { data, error } = await request;
  if (error) {
    console.error(`[supabase] load ${col} (${table}) failed`, error.message);
    // Throw rather than return []: an empty array here would look like a
    // legitimately empty collection and could overwrite good local data.
    // That exact confusion caused the "employee records disappeared" incident.
    throw error;
  }
  return (data ?? []).map((r: any) => rowFromDb(r, table));
}

/**
 * Load many collections in parallel. Returns a partial AppData shape: a
 * collection whose read FAILED is absent from the result, never present and
 * empty. The caller must treat an absent key as "unknown, keep what you have"
 * — an empty array here would look like a legitimately empty collection and
 * overwrite good local data.
 */
export async function sbLoadAll(
  cols: readonly string[], opts: LoadOptions = {},
): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {};
  await Promise.all(cols.map(async (col) => {
    try { out[col] = await sbLoadCollection(col, opts); }
    catch { /* leave the key absent so the caller keeps its local copy */ }
  }));
  return out;
}

/**
 * Tables whose UNIQUE constraint is a business identity rather than a
 * surrogate id. Two devices can legitimately produce the same one.
 */
const NATURAL_KEY: Record<string, string[]> = {
  customers:   ['tenant_id', 'phone'],
  promo_codes: ['tenant_id', 'code'],
};

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505'
    || /duplicate key value violates unique constraint/i.test(error?.message || '');
}

/**
 * Resolve a unique-constraint rejection by merging into the row that already
 * holds the key. Returns true when the write has been completed.
 */
async function mergeOnNaturalKey(
  table: string, row: Record<string, any>, error: any,
): Promise<boolean> {
  const key = NATURAL_KEY[table];
  if (!key || !isUniqueViolation(error)) return false;
  // Every key column must actually carry a value — merging on a NULL would
  // target an arbitrary row.
  if (key.some(k => row[k] === null || row[k] === undefined || row[k] === '')) return false;

  // The surviving row keeps its own primary key; ours would violate it.
  const patch = { ...row };
  delete patch.id;

  const { error: mergeError } = await sb()
    .from(table).upsert(patch, { onConflict: key.join(',') });
  if (mergeError) {
    console.error(`[supabase] natural-key merge on ${table} failed`, mergeError.message);
    return false;
  }
  console.warn(
    `[supabase] ${table}: a row with the same ${key.slice(1).join('+')} already existed ` +
    '(created on another device) — merged into it instead of creating a duplicate',
  );
  return true;
}

/** Write one row. Upsert on id, so a retry is idempotent. */
export async function sbSaveItem(col: string, id: string, data: any): Promise<void> {
  if (isDocStoreCollection(col)) return docStoreSave(col, id, data);
  const table = tableFor(col);

  const tenantId = authTenantId();
  if (!table) return;
  if (!tenantId) throw new Error('Restaurant identity is not ready; cloud save will retry');

  const row = rowToDb(col, data);
  row.id = cloudId(id);
  if (row.data && typeof row.data === 'object') (row.data as any).id = id;
  row.tenant_id = tenantId;
  if (BRANCH_SCOPED.has(table) && !row.branch_id) {
    const b = authBranchId();
    if (b) row.branch_id = b;
  }

  const { error } = await sb().from(table).upsert(row, { onConflict: 'id' });
  if (error) {
    // ===== v1.26.0 — two devices, one natural key =====
    // Some tables carry a UNIQUE constraint besides the primary key:
    // customers(tenant, phone), promo_codes(tenant, code). Two tills that
    // each create "the same" customer offline mint DIFFERENT local ids, so
    // the id-keyed upsert tries to INSERT a second row and Postgres rejects
    // it with 23505.
    //
    // That rejection used to be terminal in slow motion: the op retried six
    // times, then went to the dead-letter queue, and the record never reached
    // the cloud at all. The operator saw a customer on one till and nowhere
    // else, with no error.
    //
    // Re-aiming the upsert at the natural key merges into the row that is
    // already there instead of fighting it. One record, both devices, nothing
    // dropped — which is what the constraint was expressing in the first place.
    const merged = await mergeOnNaturalKey(table, row, error);
    if (merged) return;

    // ===== Two tills, one number =====
    // A bill created offline carries a number minted by its own device. If
    // another till already used it, the per-branch unique index rejects this
    // write. Losing the bill is not an option and keeping the clash is not
    // either, so the server hands out a fresh number and the local copy is
    // corrected to match — no gap, no duplicate, no lost revenue.
    if (table === 'orders' && isOrderNumberCollision(error)) {
      const fresh = await allocateServerOrderNumber();
      if (fresh) {
        const old = Number(row.order_number) || undefined;
        row.order_number = fresh;
        if (row.data && typeof row.data === 'object') {
          (row.data as any).orderNumber = fresh;
        }
        const retry = await sb().from(table).upsert(row, { onConflict: 'id' });
        if (retry.error) {
          console.error(`[supabase] save ${col}/${id} failed after renumber`, retry.error.message);
          throw retry.error;
        }
        emitOrderRenumbered(id, fresh, old);
        return;
      }
    }
    console.error(`[supabase] save ${col}/${id} failed`, error.message);
    throw error;
  }
}



export async function sbDeleteItem(col: string, id: string): Promise<void> {
  if (isDocStoreCollection(col)) { await docStoreDelete(col, [id]); return; }
  const table = tableFor(col);

  const tenantId = authTenantId();
  if (!table) return;
  if (!tenantId) throw new Error('Restaurant identity is not ready; cloud delete will retry');

  const q = sb().from(table);
  const { error } = SOFT_DELETE.has(table)
    ? await q.update({ deleted_at: new Date().toISOString() }).eq('id', cloudId(id)).eq('tenant_id', tenantId)
    : await q.delete().eq('id', cloudId(id)).eq('tenant_id', tenantId);

  if (error) {
    console.error(`[supabase] delete ${col}/${id} failed`, error.message);
    throw error;
  }
}

/**
 * Day Close — clear many rows of one collection on the SERVER in a few
 * round-trips instead of one request per record. Rows that carry history
 * (bills, module documents) are soft-deleted so an admin can still read the
 * closed day; everything else is removed outright.
 *
 * Returns the ids the server confirmed, so the caller only clears locally
 * what really went, and nothing can sync back down afterwards.
 */
export async function sbDeleteMany(col: string, ids: string[]): Promise<string[]> {
  if (isDocStoreCollection(col)) return docStoreDelete(col, ids);
  const table = tableFor(col);

  const tenantId = authTenantId();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!table || !unique.length) return [];
  if (!tenantId) throw new Error('Restaurant identity is not ready; cloud delete will retry');

  const done: string[] = [];
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const cloudIds = slice.map(cloudId);
    const q = sb().from(table);
    const { error } = SOFT_DELETE.has(table)
      ? await q.update({ deleted_at: new Date().toISOString() }).in('id', cloudIds).eq('tenant_id', tenantId)
      : await q.delete().in('id', cloudIds).eq('tenant_id', tenantId);
    if (error) {
      console.error(`[supabase] bulk delete ${col} failed`, error.message);
      throw error;
    }
    done.push(...slice);
  }
  return done;
}

/** Day Close — restart bill numbering on the server for this restaurant. */
export async function sbResetOrderCounter(startAt = 0): Promise<void> {
  const tenantId = authTenantId();
  if (!tenantId) throw new Error('Restaurant identity is not ready');
  const { error } = await sb().rpc('reset_order_counter' as any, {
    p_branch: authBranchId() || null,
    p_start: Math.max(0, Math.floor(startAt) || 0),
  });
  if (error) {
    console.error('[supabase] reset order counter failed', error.message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Settings — one jsonb row per tenant, replacing meta/settings
// ---------------------------------------------------------------------------

const ALL_BRANCHES = '00000000-0000-0000-0000-000000000000';

/**
 * ===== v1.26.0 — settings carry their server timestamp =====
 *
 * Settings were the one collection with NO version of any kind, so the merge
 * had nothing to compare and the cloud copy simply overwrote the local one on
 * every refresh. A branding change made while offline was therefore discarded
 * the moment the connection came back — the operator watched their restaurant
 * name and logo revert, with no error anywhere.
 *
 * `updated_at` already exists on the row and a trigger advances it. Returning
 * it as `_updatedAt` lets settings use the same last-write-wins rule as every
 * other collection.
 */
export async function sbLoadSettings(): Promise<Record<string, any> | null> {
  const tenantId = readTenantId();
  if (!tenantId) return null;
  const { data, error } = await sb()
    .from('tenant_settings').select('settings, updated_at')
    .eq('tenant_id', tenantId).eq('branch_id', ALL_BRANCHES).maybeSingle();
  if (error) { console.error('[supabase] load settings failed', error.message); return null; }
  const settings = (data?.settings as Record<string, any>) ?? null;
  if (!settings) return null;
  return {
    ...settings,
    _updatedAt: data?.updated_at ? new Date(data.updated_at as string).getTime() : 0,
  };
}

export async function sbSaveSettings(s: Record<string, any>): Promise<void> {
  const tenantId = authTenantId();
  if (!tenantId) throw new Error('Restaurant identity is not ready; settings were not uploaded');
  // `_updatedAt` is a local merge stamp, not restaurant data — never store it.
  // The column is the authority; keeping a copy inside the jsonb would let a
  // stale device's clock decide the winner.
  const payload = { ...s };
  delete (payload as any)._updatedAt;
  const { error } = await sb().from('tenant_settings')
    .upsert({
      tenant_id: tenantId, branch_id: ALL_BRANCHES, settings: payload,
      // touch_updated_at only fires on UPDATE; stamp it so a first INSERT is
      // not left looking older than every subsequent edit.
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,branch_id' });
  if (error) { console.error('[supabase] save settings failed', error.message); throw error; }

  // Keep the platform's restaurant master record aligned with the owner-facing
  // profile. Super Admin and owner portals read this name from `tenants`.
  //
  // ===== v1.25.16 — this must NOT throw =====
  // The settings upsert above has ALREADY SUCCEEDED by this point. Throwing
  // here made the caller in store.ts treat the whole save as failed, so the UI
  // rolled back and the operator saw their restaurant name, logo and tagline
  // vanish on refresh — even though the branding was sitting in the database
  // the entire time.
  //
  // update_own_tenant_name is also the more fragile of the two calls: it
  // requires the caller to be the owner of the tenant, so a Super Admin
  // editing a restaurant's branding fails it by design while having every
  // right to save the settings.
  //
  // The master name is a convenience mirror. A stale mirror is a small
  // problem; discarding the operator's branding is a large one.
  const restaurantName = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (restaurantName) {
    const { error: tenantError } = await sb().rpc('update_own_tenant_name', {
      p_name: restaurantName,
    });
    if (tenantError) {
      console.warn(
        '[supabase] settings saved, but the tenants.name mirror was not updated:',
        tenantError.message,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Storage — images
// ---------------------------------------------------------------------------

export type ImageKind = 'menu' | 'branding' | 'employee' | 'support';

const BUCKET_FOR: Record<ImageKind, string> = {
  menu: 'menu-images',
  branding: 'branding',
  employee: 'employee-docs',
  support: 'support-attachments',
};

/** Upload and return the URL. Private buckets get a signed, short-lived URL. */
export async function sbUploadImage(
  kind: ImageKind, file: File | Blob, fileName?: string,
): Promise<string> {
  const tenantId = authTenantId();
  if (!tenantId) throw new Error('no tenant — cannot upload');

  const bucket = BUCKET_FOR[kind];
  const name = fileName || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // The storage policies match on this tenant prefix.
  const path = `${tenantId}/${kind}/${name}`;

  const { error } = await sb().storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;

  if (kind === 'menu' || kind === 'branding') {
    // These two buckets are public, and the URL is persisted on the record and
    // replicated to every device — so it must never expire. A signed URL with
    // a one-year lifetime would break every menu photo and logo at once, a
    // year after upload. See storage.ts for the same reasoning.
    const pub = sb().storage.from(bucket).getPublicUrl(path);
    if (!pub?.data?.publicUrl) throw new Error(`could not build a public URL for ${bucket}`);
    return pub.data.publicUrl;
  }
  // Employee CNIC photos and support attachments must never be publicly
  // addressable — signed, one hour.
  const { data, error: sErr } = await sb().storage.from(bucket).createSignedUrl(path, 3600);
  if (sErr) throw sErr;
  return data.signedUrl;
}

export async function sbDeleteImage(kind: ImageKind, path: string): Promise<void> {
  const { error } = await sb().storage.from(BUCKET_FOR[kind]).remove([path]);
  if (error) throw error;
}
