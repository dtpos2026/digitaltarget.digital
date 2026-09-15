// ============================================================================
// v1.55.1 — the Order Taker showed no riders and no waiters
//
// REPORTED: "order taker me big ha ky rider or waiter show nhi hoty".
//
// TWO faults, found by comparing what the portal reads against what the POS
// actually stores. Settings -> Staff -> Riders/Waiters writes to
// module_documents (kind 'riders' / 'waiters'); portal_riders was reading
// user_profiles WHERE role = 'rider', and portal_waiters did not exist at all.
// For the live restaurant the two disagree completely:
//
//     module_documents kind='riders'   11 rows  (tami, Waqas, Umair, Usama, ...)
//     module_documents kind='waiters'   4 rows  (Hamza, ...)
//     user_profiles    role='rider'     1 row
//     user_profiles    role='waiter'    0 rows
//
// So the picker showed one rider nobody recognised and no waiters — and the id
// it returned was user_profiles.user_id, which matches no existing order's
// riderId, so assigning from the portal could not line up with POS history.
//
// Verified live with `set local role anon` and a real portal token:
//     before   riders 1   waiters 0 (no function)
//     after    riders 11  waiters 4, no PIN in the payload
// and a token for the other restaurant still sees only its own roster.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// Assertions must never match this file's own explanatory prose, so every
// SQL `--` comment and TS comment is stripped before anything is asserted.
const stripSql = (s: string) => s.replace(/--[^\n]*/g, '');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const sql = stripSql(read('supabase/migrations/20260915110000_v1_55_1_portal_waiters.sql'));
const portalData = stripTs(read('src/lib/portalData.ts'));
const store = stripTs(read('src/lib/store.ts'));
const pos = stripTs(read('src/pages/POSScreen.tsx'));

const fn = (name: string) => {
  const start = sql.indexOf(`function public.${name}(`);
  expect(start, `${name} is missing from the migration`).toBeGreaterThan(-1);
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end === -1 ? undefined : end);
};

describe('the portal reads the roster the POS actually keeps', () => {
  it('reads riders from module_documents, not only from user_profiles', () => {
    const riders = fn('portal_riders');
    expect(riders).toContain('public.module_documents');
    expect(riders).toContain("m.kind = 'riders'");
    expect(riders).toContain('m.deleted_at is null');
  });

  it('reads waiters from module_documents too, and portal_waiters exists', () => {
    const waiters = fn('portal_waiters');
    expect(waiters).toContain('public.module_documents');
    expect(waiters).toContain("m.kind = 'waiters'");
    expect(waiters).toContain('m.deleted_at is null');
  });

  it('still includes staff who were given a login account instead', () => {
    expect(fn('portal_riders')).toContain("u.role = 'rider'");
    expect(fn('portal_waiters')).toContain("u.role = 'waiter'");
  });

  it('returns the id an order already points at, so assignment lines up', () => {
    // riderId/waiterId on an order are the module_documents doc ids.
    for (const name of ['portal_riders', 'portal_waiters']) {
      expect(fn(name)).toContain("m.data->>'id'");
      expect(fn(name)).toContain("'id', id");
    }
  });
});

describe('what the roster must never give away', () => {
  it('never returns a rider PIN, password or hash', () => {
    for (const name of ['portal_riders', 'portal_waiters']) {
      const body = fn(name);
      // The POS roster document carries `pin`. Fields are listed explicitly
      // rather than splatted, so it cannot ride along.
      expect(body).not.toMatch(/'pin'/);
      expect(body).not.toContain('pin_hash');
      expect(body).not.toContain('password');
      expect(body).not.toMatch(/\bm\.data\b(?!\s*->)/); // no whole-document splat
    }
  });

  it('scopes every read to the tenant the token resolves to', () => {
    for (const name of ['portal_riders', 'portal_waiters']) {
      const body = fn(name);
      expect(body).toContain('s public.staff_portal_sessions := portal_identity(p_token)');
      expect(body).toContain("return jsonb_build_object('ok', false, 'reason', 'no_session')");
      // The tenant is never a parameter — it is carried by the token.
      expect(body).toContain('m.tenant_id = s.tenant_id');
      expect(body).toContain('u.tenant_id = s.tenant_id');
      expect(body).not.toContain('p_tenant');
    }
  });

  it('keeps a branch-pinned staff member on their own branch', () => {
    for (const name of ['portal_riders', 'portal_waiters']) {
      expect(fn(name)).toContain('s.all_branches or s.branch_id is null');
    }
  });

  it('is executable by anon — a portal device holds no Supabase session', () => {
    expect(sql).toContain('grant execute on function public.portal_waiters(text) to anon');
    expect(sql).toContain('grant execute on function public.portal_riders(text)  to anon');
    expect(sql).toContain('revoke all on function public.portal_waiters(text) from public');
  });

  it('pins search_path, so the function cannot be pointed at another schema', () => {
    for (const name of ['portal_riders', 'portal_waiters']) {
      expect(fn(name)).toContain("set search_path to 'public', 'extensions'");
    }
  });
});

describe('two people with one name, and four people with the same name', () => {
  it('drops only the duplicate account row, never a roster row', () => {
    for (const name of ['portal_riders', 'portal_waiters']) {
      const body = fn(name);
      // The union keeps every POS roster row verbatim, and filters the
      // user_profiles side — so four distinct riders all called "New Rider"
      // still come back as four, while one person held in both places
      // comes back once, under the id the POS knows.
      expect(body).toMatch(/select \* from pos\s*\n\s*union all\s*\n\s*select a\.\* from accts a/);
      expect(body).toContain('where not exists (');
      expect(body).toContain('lower(btrim(p.name)) = lower(btrim(coalesce(a.name');
    }
  });
});

describe('the client half', () => {
  it('bootstrap carries the waiters alongside the riders', () => {
    expect(fn('portal_bootstrap')).toContain("'waiters', portal_waiters(p_token)->'waiters'");
    expect(portalData).toContain('waiters: PortalRider[]');
    expect(portalData).toContain('waiters: Array.isArray(r.waiters) ? r.waiters : []');
  });

  it('there is a standalone portal_waiters() for a refresh', () => {
    expect(portalData).toContain("call('portal_waiters'");
  });

  it('the store adopts the waiters, and does not wipe a cache on an old payload', () => {
    expect(store).toContain('waiters?: any[] | null;');
    expect(store).toContain("if (Array.isArray(input.waiters)) adopt('waiters', input.waiters);");
  });

  it('an empty picker says which of the two reasons it is', () => {
    // A blank dropdown that explains nothing is what was reported. Both the
    // "none created" and the "all switched off" case must be distinguishable.
    expect(pos).toContain('waiters.filter(w => w.isActive).length === 0');
    expect(pos).toContain('getRiders().filter(r => r.isActive).length === 0');
    expect(pos).toContain('waiters.length === 0');
    expect(pos).toContain('getRiders().length === 0');
  });
});
