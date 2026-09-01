// ============================================================================
// v1.33.0 — the recycle-bin purge must never destroy sales history.
//
// SELF-INFLICTED in v1.29.3. A `deleted_at` tombstone used to be permanent but
// HARMLESS — the row stayed for ever and admin history could still read it.
// Adding recycle_bin_purge turned every tombstone into an eventual HARD DELETE.
//
// Measured live: 23 orders tombstoned, all 23 older than the 7-day window. One
// call would have destroyed twenty-three real bills. pg_cron is not installed,
// so nothing had run it and no data was lost.
//
// A SECOND bug was found by RUNNING it: a tombstoned branch that a live order
// still referenced raised orders_branch_id_fkey and aborted the entire run, so
// every later table went uncleaned too.
//
// VERIFIED LIVE with an aggressive 1-day window:
//   orders 23 -> 23, day_closes 33 -> 33, customers 1499 -> 1499
//   purged: leaves 1, module_documents 1 | blocked: [] | service_role only
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260901120000_v1_33_0_purge_never_touches_the_books.sql'),
  'utf8',
).replace(/^\s*--.*$/gm, '');

/** The protected array, as the function will actually see it. */
const PROTECTED = (() => {
  const at = SQL.indexOf('protected constant text[] := array[');
  expect(at).toBeGreaterThan(-1);
  const body = SQL.slice(at, SQL.indexOf('];', at));
  return Array.from(body.matchAll(/'([a-z_]+)'/g), m => m[1]);
})();

describe('the books are never purged', () => {
  it('protects every financial and audit table', () => {
    for (const t of [
      'orders', 'order_items', 'order_payments', 'transactions', 'ledger_entries',
      'credit_payments', 'cash_movements', 'day_closes', 'shifts', 'refunds',
      'refund_lines', 'stock_logs', 'wastages', 'staff_audit_logs',
    ]) expect(PROTECTED, t).toContain(t);
  });

  it('also protects the rows the books POINT AT', () => {
    // Destroying one of these orphans a real bill — and raised the foreign key
    // that aborted the whole run before this was added.
    for (const t of ['customers', 'branches', 'payment_accounts', 'menu_items',
                     'inventory_items', 'user_profiles']) {
      expect(PROTECTED, t).toContain(t);
    }
  });

  it('still purges genuinely disposable operational rows', () => {
    // A recycle bin that never deletes anything is not a recycle bin either.
    for (const t of ['leaves', 'module_documents', 'dining_tables', 'floors', 'kitchens']) {
      expect(PROTECTED, t).not.toContain(t);
    }
  });

  it('reports what it retained instead of skipping in silence', () => {
    expect(SQL).toContain("'retained_forever', v_kept");
    expect(SQL).toContain("jsonb_build_object('table', r.tbl, 'retained', n)");
  });
});

describe('one blocked table cannot stop the whole run', () => {
  it('wraps each table in its own exception block', () => {
    const at = SQL.indexOf('exception');
    expect(at).toBeGreaterThan(-1);
    expect(SQL).toContain('when foreign_key_violation then');
    expect(SQL).toContain("'still referenced by a live record'");
    expect(SQL).toContain('when others then');
    expect(SQL).toContain("'blocked', v_blocked");
  });

  it('does not swallow the reason', () => {
    // The failure is reported per table, not logged into the void — this is
    // the silent-catch pattern the audit was looking for.
    expect(SQL).toContain("v_blocked := v_blocked || jsonb_build_object(");
    expect(SQL).toContain('left(sqlerrm, 200)');
  });
});

describe('who may run it', () => {
  it('is service_role only — a browser can never trigger it', () => {
    expect(SQL).toContain('revoke all on function public.recycle_bin_purge(integer) from public, anon, authenticated');
    expect(SQL).toContain('grant execute on function public.recycle_bin_purge(integer) to service_role');
  });

  it('keeps a floor under the retention window', () => {
    // greatest(..., 1): nobody can ask for "purge everything now" by passing 0.
    expect(SQL).toContain('greatest(coalesce(p_days, 7), 1)');
  });
});
