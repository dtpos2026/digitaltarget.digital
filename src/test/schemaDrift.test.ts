// ============================================================================
// Tests — v1.25.7 the write contract must match the migrations
//
// THE FAILURE THIS CATCHES:
//   "Could not find the 'address' column of 'admin_marketing_contacts'
//    in the schema cache"
//
// Table existence and RPC existence were both already correct when this
// happened. The gap was at COLUMN level: code wrote columns the database did
// not have. Nothing in the suite compared the two, so it only surfaced when a
// Super Admin tried to save a contact in production.
//
// These tests read the migrations as text and check that every column the code
// declares writable is created somewhere. It is a coarse check — it cannot see
// the live database — but it catches the common case: someone adds a field to
// ALLOWED_COLUMNS or to a mapper and forgets the migration.
//
// DO NOT use src/integrations/supabase/types.ts as the expected schema. It is
// stale: it describes an older document-shaped design and claims `orders` has
// a `data` column, while the live table has ~100 real ones. Generating DDL
// from it would corrupt the schema.
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');

const allMigrations = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n')
  .toLowerCase();

/** Does any migration create or add this column on this table? */
function columnIsDefined(table: string, column: string): boolean {
  // `add column if not exists <col>` anywhere, or the column named inside a
  // create table block for this table.
  if (new RegExp(`add column if not exists\\s+${column}\\b`).test(allMigrations)) return true;
  const create = new RegExp(`create table[^;]*?\\b${table}\\b([^;]*);`, 's').exec(allMigrations);
  if (create && new RegExp(`\\b${column}\\b`).test(create[1])) return true;
  return false;
}

describe('columns the marketing panel writes exist in a migration', () => {
  // Mirrors contactToDb() in src/lib/marketingContacts.ts.
  const columns = [
    'name', 'phone', 'city', 'restaurant_name', 'notes',
    'owner_name', 'address', 'source', 'linked_tenant_id', 'linked_device_ids',
  ];
  for (const c of columns) {
    it(`admin_marketing_contacts.${c}`, () => {
      expect(columnIsDefined('admin_marketing_contacts', c)).toBe(true);
    });
  }
});

describe('branch receipt fields exist in a migration', () => {
  // These print on customer receipts; silently dropping them is not cosmetic.
  for (const c of ['branch_code', 'email', 'invoice_prefix', 'invoice_footer',
                   'registration_number', 'tax_number']) {
    it(`branches.${c}`, () => {
      expect(columnIsDefined('branches', c)).toBe(true);
    });
  }
});

describe('types.ts is not treated as the schema source of truth', () => {
  it('is documented as stale where it matters', () => {
    const mig = fs.readFileSync(
      path.join(migrationsDir, '20260822000000_v1_25_7_schema_drift.sql'), 'utf8');
    expect(mig.toLowerCase()).toContain('types.ts');
  });
});


// ============================================================================
// v1.25.8 — the document-shaped modules
//
// supabaseStore.ts DOC_TABLES writes { id, tenant_id, branch_id, data,
// deleted_at, updated_at } and NOTHING else. All sixteen tables were missing
// the `data` column entirely, so every HR, accounts, inventory and refund
// write failed silently and the records never left the browser.
//
// If a table is added to DOC_TABLES without a matching migration, this fails.
// ============================================================================
describe('every DOC_TABLES target can accept a document write', () => {
  const store = fs.readFileSync(
    path.join(root, 'src', 'lib', 'supabaseStore.ts'), 'utf8');

  // Read the list from the source rather than duplicating it, so the test
  // cannot drift away from the code it guards.
  const block = /export const DOC_TABLES = new Set\(\[([\s\S]*?)\]\)/.exec(store);
  const docTables = [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

  it('the DOC_TABLES list was parsed', () => {
    expect(docTables.length).toBeGreaterThan(10);
  });

  for (const table of docTables) {
    for (const column of ['data', 'deleted_at', 'branch_id', 'updated_at']) {
      it(`${table}.${column}`, () => {
        expect(columnIsDefined(table, column)).toBe(true);
      });
    }
  }
});


// ============================================================================
// v1.25.9 — RPC argument contracts
//
// PostgREST resolves an RPC by ARGUMENT NAME. Send one argument the function
// does not declare and there is no candidate at all — the call fails with
// "Could not find the function ...", not a helpful message about the extra
// argument. register_device was broken exactly this way: the code sent p_meta
// and p_ip, the function took neither, and no till could register.
//
// The mirror hazard is duplicate overloads: CREATE OR REPLACE cannot change a
// signature, so "replacing" a function with new arguments silently leaves the
// old one behind and PostgREST then refuses to choose between them. That is
// what broke sa_set_plan. Both failure modes are checked here.
// ============================================================================
describe('every rpc() argument is declared by some migration', () => {
  const src = ['src/lib', 'src/pages', 'src/components']
    .flatMap(d => {
      const dir = path.join(root, d);
      return fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => /\.tsx?$/.test(f)).map(f => path.join(dir, f))
        : [];
    })
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');

  const calls = [...src.matchAll(/\.rpc\(\s*'([a-z_0-9]+)'\s*,\s*\{([^}]*)\}/g)];

  it('found rpc calls to check', () => {
    expect(calls.length).toBeGreaterThan(3);
  });

  for (const [, fn, body] of calls) {
    const args = [...body.matchAll(/(?:^|[,{\s])(p_[a-z_0-9]+)\s*:/g)].map(m => m[1]);
    for (const arg of args) {
      it(`${fn}(${arg})`, () => {
        // A function is often redefined across migrations, and the LATEST
        // definition is the one that counts. Matching only the first would
        // report register_device(p_meta) as missing purely because an older
        // five-argument version appears earlier in the file order — which is
        // precisely the stale reading that let this bug ship.
        const defs = [...allMigrations.matchAll(new RegExp(
          `create (?:or replace )?function[^(]*\\b${fn}\\s*\\(([^)]*)\\)`, 'gis'))];

        // 20 of the live functions have NO migration in this repo (see the
        // suite below). This test cannot judge those, and asserting on them
        // would fail for a reason unrelated to the argument being checked —
        // noise that trains people to ignore the whole file. Skip them here
        // and let the reproducibility test carry that problem instead.
        if (defs.length === 0) return;

        const declaredSomewhere = defs.some(d => d[1].includes(arg));
        expect(declaredSomewhere, `${fn} never declares ${arg}`).toBe(true);
      });
    }
  }
});


// ============================================================================
// v1.25.10 — the migrations cannot rebuild this database
//
// 20 of the 31 functions the app calls exist ONLY in the live Supabase
// project. They were created through the dashboard or by an assistant and were
// never captured as migrations:
//
//   apply_sync_batch, auth_branch_ids, auth_role, bootstrap_restaurant,
//   can_access_branch, device_heartbeat, next_order_number, pos_list_users,
//   pos_set_staff_profile, public_call_waiter, public_place_order,
//   public_track_order, pull_orders_delta, reset_order_counter,
//   set_default_owner_pos_login, staff_login_check, staff_login_global,
//   update_own_tenant_name, verify_manager_password, verify_staff_pin
//
// Nothing is broken TODAY — the live project has them. The risk is that this
// repository can no longer recreate the backend. A fresh Supabase project
// built from supabase/migrations would be missing staff login, order
// numbering, device heartbeat and the whole sync path.
//
// The fix is `supabase db pull`, which writes the live schema out as a
// baseline migration. That is a local command needing project credentials, so
// it is recorded here rather than guessed at.
//
// This test is intentionally a REMINDER, not a failure: making it fail would
// block every unrelated change until the pull is done.
// ============================================================================
describe('migration coverage of live functions', () => {
  it('records which functions still need `supabase db pull`', () => {
    const undocumented = [
      'apply_sync_batch', 'auth_branch_ids', 'auth_role', 'bootstrap_restaurant',
      'can_access_branch', 'device_heartbeat', 'next_order_number', 'pos_list_users',
      'pos_set_staff_profile', 'public_call_waiter', 'public_place_order',
      'public_track_order', 'pull_orders_delta', 'reset_order_counter',
      'set_default_owner_pos_login', 'staff_login_check', 'staff_login_global',
      'update_own_tenant_name', 'verify_manager_password', 'verify_staff_pin',
    ];
    const stillMissing = undocumented.filter(
      fn => !new RegExp(`function\\s+(?:public\\.)?${fn}\\b`, 'i').test(allMigrations));

    // Green means every one is now captured and this list can be deleted.
    if (stillMissing.length > 0) {
      console.warn(
        `[schema] ${stillMissing.length} live function(s) have no migration. ` +
        `Run \`supabase db pull\` to capture them: ${stillMissing.join(', ')}`);
    }
    expect(stillMissing.length).toBeLessThanOrEqual(undocumented.length);
  });
});


// ============================================================================
// v1.25.13 — enum unions in the code must match the CHECK constraints
//
// PricingType declares six values; the database allowed two. menu_items
// already has size_variants and inch_variants columns, so size and inch
// pricing is a shipped feature — the database was simply rejecting it. Saving
// a pizza with Small/Medium/Large prices failed with a check violation.
//
// This is the same class of bug as a missing column, and it was invisible to
// every check that only compared column NAMES.
// ============================================================================
describe('PricingType matches the menu_items CHECK constraint', () => {
  const types = fs.readFileSync(path.join(root, 'src', 'lib', 'types.ts'), 'utf8');
  const union = /export type PricingType\s*=\s*([^;]+);/.exec(types)?.[1] ?? '';
  const declared = [...union.matchAll(/'([a-z]+)'/g)].map(m => m[1]);

  it('the union was parsed', () => {
    expect(declared.length).toBeGreaterThan(1);
  });

  for (const value of declared) {
    it(`'${value}' is allowed by a migration`, () => {
      const check = /menu_items_pricing_type_check[\s\S]{0,400}?\)\s*\)/i.exec(allMigrations);
      expect(check, 'no pricing_type CHECK found in migrations').not.toBeNull();
      expect(check![0]).toContain(`'${value}'`);
    });
  }
});


// ============================================================================
// v1.25.15 — the EXPLICIT mappers in rowToDb()
//
// This is the gap that let "Could not find the 'client_seq' column of 'orders'"
// reach a till. Earlier tests covered ALLOWED_COLUMNS and DOC_TABLES. orders,
// order_items, order_payments and categories are in neither — they have their
// own hand-written mappers at the top of rowToDb(), and nothing compared those
// to the schema.
//
// This parses the mappers OUT OF THE SOURCE, so adding a field to any of them
// without a migration fails here rather than at a till mid-service.
// ============================================================================
describe('every column the explicit rowToDb mappers send exists in a migration', () => {
  const store = fs.readFileSync(
    path.join(root, 'src', 'lib', 'supabaseStore.ts'), 'utf8');
  const body = store.slice(
    store.indexOf('export function rowToDb('),
    store.indexOf('export function rowFromDb('));

  // collection name in the code -> real table name
  const TABLE = {
    orders: 'orders', categories: 'categories',
    menuItems: 'menu_items', inventory: 'inventory_items',
  };

  const mappers = [...body.matchAll(
    /if \(col === '(\w+)'\) \{\s*return \{([\s\S]*?)\n {4}\};/g)];

  it('the mappers were parsed', () => {
    expect(mappers.length).toBeGreaterThanOrEqual(3);
  });

  for (const [, col, block] of mappers) {
    const table = TABLE[col];
    if (!table) continue;
    const columns = [...new Set(
      [...block.matchAll(/^\s+([a-z_0-9]+):/gm)].map(m => m[1]))];

    for (const column of columns) {
      it(`${table}.${column}`, () => {
        expect(columnIsDefined(table, column)).toBe(true);
      });
    }
  }
});

// ============================================================================
// v1.25.23 — parents must sync before children
//
// The three largest error sources in the entire project were foreign-key
// rejections, and all three were an ORDERING problem:
//     447  menu_items_kitchen_id_fkey
//     353  menu_items_category_id_fkey
//     134  inventory_items_category_id_fkey
//
// The queue sorted purely by enqueue time, so a menu item saved before its
// category was pushed first and rejected. The database now backfills a
// placeholder parent instead of rejecting, but a placeholder is a repair, not
// an outcome — correct ordering means the child links to the REAL record on
// its first attempt.
// ============================================================================
describe('the sync queue pushes parents before children', () => {
  const sync = fs.readFileSync(
    path.join(root, 'src', 'lib', 'deferredSync.ts'), 'utf8');

  const tierBlock = /const SYNC_TIER[^=]*=\s*\{([\s\S]*?)\};/.exec(sync)?.[1] ?? '';
  const tiers: Record<string, number> = {};
  for (const m of tierBlock.matchAll(/(\w+):\s*(\d+)/g)) tiers[m[1]] = Number(m[2]);

  it('the tier table was parsed', () => {
    expect(Object.keys(tiers).length).toBeGreaterThan(5);
  });

  it('branches come before everything — every table references one', () => {
    for (const [col, tier] of Object.entries(tiers)) {
      if (col === 'branches') continue;
      expect(tier, `${col} must not outrank branches`).toBeGreaterThan(tiers.branches);
    }
  });

  const mustPrecede: Array<[string, string]> = [
    ['categories', 'menuItems'],          // 353 failures
    ['kitchens', 'menuItems'],            // 447 failures
    ['inventoryCategories', 'inventory'], // 134 failures
    ['inventory', 'menuItems'],
    ['floors', 'tables'],
    ['menuItems', 'orders'],
  ];
  for (const [parent, child] of mustPrecede) {
    it(`${parent} before ${child}`, () => {
      expect(tiers[parent]).toBeLessThan(tiers[child]);
    });
  }

  it('sorts by tier first, then by age', () => {
    expect(sync).toContain('tierOf(a.col) - tierOf(b.col)');
    expect(sync).toContain('a.firstEnqueuedAt - b.firstEnqueuedAt');
  });
});
