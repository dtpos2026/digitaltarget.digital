// ============================================================================
// v1.26.0 — the sync contract, pinned
//
// Every rule here corresponds to a way this POS lost or duplicated data. They
// are written against the SHIPPED source, not against a restatement of it,
// because the failures were never in the idea — they were in one module
// quietly not doing what the others did.
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (...p: string[]) =>
  fs.readFileSync(path.join(process.cwd(), 'src', ...p), 'utf8');

const storeSrc = read('lib', 'store.ts');
const supabaseStoreSrc = read('lib', 'supabaseStore.ts');
const cloudDocsSrc = read('lib', 'cloudDocs.ts');
const storageSrc = read('lib', 'storage.ts');
const deferredSrc = read('lib', 'deferredSync.ts');

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const migrations = fs.readdirSync(migrationsDir)
  .map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8')).join('\n');

// ---------------------------------------------------------------------------
describe('realtime reaches every module, not just orders and tables', () => {
  // The publication held SEVEN tables while the client subscribed to ~28, so
  // menu, categories, customers, inventory, branches, deals, promos and shifts
  // produced no change events at all. A second till only saw new data by being
  // restarted, which is exactly the symptom that was reported.
  const mustPublish = [
    'categories', 'menu_items', 'orders', 'dining_tables', 'floors', 'kitchens',
    'inventory_items', 'inventory_categories', 'customers', 'branches', 'deals',
    'promo_codes', 'payment_accounts', 'shifts', 'recipes', 'stock_logs',
    'employees', 'transactions', 'ledger_entries', 'day_closes', 'refunds',
    'tenant_settings', 'module_documents',
  ];

  it.each(mustPublish)('%s is added to the supabase_realtime publication', (table) => {
    expect(migrations).toContain(`'${table}'`);
  });

  it('subscribes to tenant_settings — branding, logo and restaurant name', () => {
    // Without this, "Device A changes the logo, Device B sees it" cannot happen
    // at all: settings live in their own table that nothing was listening to.
    expect(storeSrc).toContain("table: 'tenant_settings'");
    expect(storeSrc).toContain('sbReloadSettings');
  });

  it('subscribes to module_documents — waiters, riders and 18 more modules', () => {
    // Includes the blocked-customer list, a fraud control that was effectively
    // per-device: a blocked number could simply order from the next till.
    expect(storeSrc).toContain("table: 'module_documents'");
    expect(storeSrc).toContain('hydrateCloudDocs');
  });
});

// ---------------------------------------------------------------------------
describe('a deletion is a fact, not an absence', () => {
  it('every previously hard-deleted table now carries deleted_at', () => {
    for (const table of [
      'dining_tables', 'floors', 'kitchens', 'inventory_items',
      'inventory_categories', 'customers', 'branches', 'deals',
      'promo_codes', 'payment_accounts', 'shifts',
    ]) {
      expect(migrations).toMatch(
        new RegExp(`alter table public\\.${table}\\s+add column if not exists deleted_at`));
    }
  });

  it('the soft-delete set drives the read filter as well as the delete verb', () => {
    // These were three separate hardcoded lists that disagreed: a table could
    // be soft-deleted while its reads still returned the tombstone, or the
    // reverse. One set now decides all of it.
    expect(supabaseStoreSrc).toContain("SOFT_DELETE.has(table) && !opts.includeDeleted");
    expect(supabaseStoreSrc).toContain('const { error } = SOFT_DELETE.has(table)');
  });

  it('the merge reads tombstones, or it cannot apply them', () => {
    expect(storeSrc).toContain('includeDeleted: true');
  });

  it('no tombstone ever reaches the UI', () => {
    expect(storeSrc).toContain('stripTombstones');
  });
});

// ---------------------------------------------------------------------------
describe('a failed read is never mistaken for an empty collection', () => {
  it('records which collections actually loaded', () => {
    // sbLoadAll omits a failed collection so the caller keeps its local copy,
    // but cloudLoadAll started from emptyRuntimeData() and refilled it with []
    // — which reads as a successful load of nothing. One timed-out request for
    // menuItems then presented as "this restaurant has no menu".
    expect(storeSrc).toContain('markLoadedCollections');
    expect(storeSrc).toContain('loadedCollections(remote)');
  });

  it('leaves an unloaded collection exactly as it was', () => {
    expect(storeSrc).toContain('if (loaded && !loaded.has(name))');
  });

  it('merges the history collections instead of overwriting them', () => {
    // HEAVY_COLLECTIONS is orders, ledger, transactions, day closes. Assigning
    // the cloud rows straight over the cache discarded every bill taken while
    // offline — in precisely the collections where losing one costs money.
    const heavy = storeSrc.slice(
      storeSrc.indexOf('async function loadHeavyCollectionsInBackground'),
      storeSrc.indexOf('function refreshCloudStoreInBackground'));
    expect(heavy).toContain('mergeCollection');
    expect(heavy).not.toContain('(cachedData as any)[name] = rows;');
  });
});

// ---------------------------------------------------------------------------
describe('settings are as durable as a bill', () => {
  it('a failed settings write goes on the durable queue', () => {
    expect(storeSrc).toContain("enqueueDeferredOp(SETTINGS_COL, SETTINGS_ID, 'set')");
  });

  it('the queue flusher knows how to replay one', () => {
    expect(storeSrc).toContain('if (col === SETTINGS_COL)');
  });

  it('offline settings edits are queued rather than attempted and dropped', () => {
    const save = storeSrc.slice(
      storeSrc.indexOf('export function saveSettings('),
      storeSrc.indexOf('export async function saveSettingsNow('));
    expect(save).toContain('shouldDeferCloudWrite()');
  });

  it('settings carry a version so the merge can compare them', () => {
    // The only collection with no version at all: the cloud copy overwrote the
    // local one unconditionally, so branding edited offline reverted the
    // moment the connection came back.
    expect(storeSrc).toContain('function stampSettings');
    expect(supabaseStoreSrc).toContain("select('settings, updated_at')");
  });

  it('the local merge stamp is never written into the stored settings', () => {
    expect(supabaseStoreSrc).toContain('delete (payload as any)._updatedAt');
  });
});

// ---------------------------------------------------------------------------
describe('the durable queue survives the crash it exists for', () => {
  it('persists the queue as one write, not clear-then-rebuild', () => {
    // clear() followed by n putRow() calls leaves the stored queue EMPTY for
    // the length of the loop. A refresh there took every pending order.
    expect(deferredSrc).toContain("localDb.writeAll('deferredOps'");
    expect(deferredSrc).not.toContain("localDb.clear('deferredOps')");
  });

  it('flushes before dropping the in-memory queue on tenant switch', () => {
    const stop = deferredSrc.slice(deferredSrc.indexOf('export function stopDeferredSyncTriggers'));
    expect(stop).toContain('waitForQueuePersist');
  });
});

// ---------------------------------------------------------------------------
describe('the module mirror cannot strand a record on one device', () => {
  it('does not empty the retry buffer before the push lands', () => {
    const flush = cloudDocsSrc.slice(
      cloudDocsSrc.indexOf('export async function flushCloudDocs'),
      cloudDocsSrc.indexOf('export async function hydrateCloudDocs'));
    expect(flush).not.toContain('writeJson(RETRY_KEY, []);');
    expect(flush).toContain('const ok = await pushRows(all);');
  });

  it('only marks a record synced once the SERVER confirmed it', () => {
    // The snapshot was rebuilt from the merged list, so a record whose push had
    // failed was recorded as in sync and never offered again — invisible, on
    // one device, forever.
    expect(cloudDocsSrc).toContain('fromCloud');
    expect(cloudDocsSrc).toContain('if (fromCloud.has(id))');
  });

  it('uploads anything the server has never seen', () => {
    expect(cloudDocsSrc).toContain('exist only on this device — uploading');
  });

  it('resolves conflicts by time rather than always taking the cloud copy', () => {
    expect(cloudDocsSrc).toContain('LOCALAT_KEY');
    expect(cloudDocsSrc).toContain('> cloudAt && merged.has(id)');
  });
});

// ---------------------------------------------------------------------------
describe('two devices creating the same record do not deadlock the queue', () => {
  it('resolves a unique-constraint rejection instead of retrying it forever', () => {
    // customers(tenant, phone) and promo_codes(tenant, code): two tills that
    // each create the same customer offline mint different ids, so the
    // id-keyed upsert tries to INSERT a second row and is rejected with 23505.
    // Six retries later the op was dead-lettered and the record never synced.
    expect(supabaseStoreSrc).toContain('mergeOnNaturalKey');
    expect(supabaseStoreSrc).toContain("customers:   ['tenant_id', 'phone']");
    expect(supabaseStoreSrc).toContain("promo_codes: ['tenant_id', 'code']");
  });

  it('never merges on a NULL key, which would target an arbitrary row', () => {
    expect(supabaseStoreSrc).toContain(
      "if (key.some(k => row[k] === null || row[k] === undefined || row[k] === '')) return false;");
  });
});

// ---------------------------------------------------------------------------
describe('a stored asset URL does not expire', () => {
  it('uses the permanent public URL for the public buckets', () => {
    // The URL is written onto the menu row and into the settings document and
    // replicated to every device. A one-year signed URL means every menu photo
    // and every logo breaks on the same day, on all tills at once.
    expect(storageSrc).toContain('getPublicUrl(path)');
    expect(storageSrc).not.toContain('createSignedUrl(path, 60 * 60 * 24 * 365)');
    expect(supabaseStoreSrc).not.toContain('createSignedUrl(path, 60 * 60 * 24 * 365)');
  });

  it('still signs the private buckets', () => {
    // Employee CNIC photos and support attachments are personal data.
    expect(storageSrc).toContain("createSignedUrl(path, 3600)");
  });
});
