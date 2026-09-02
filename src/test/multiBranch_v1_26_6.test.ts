// ============================================================================
// v1.26.5 / v1.26.6 — Workspace Code, branch isolation, branch sales
//
// Behaviour was verified directly against the live database (see the commit
// message); these pin the contracts so they cannot quietly regress.
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const migrations = fs.readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
  .map(f => read('supabase', 'migrations', f)).join('\n');

/** One function's definition, from its header to its $function$ terminator. */
function fnBody(name: string): string {
  const at = migrations.lastIndexOf(`create or replace function public.${name}`);
  if (at < 0) return '';
  const end = migrations.indexOf('$function$', migrations.indexOf('$function$', at) + 1);
  return end < 0 ? migrations.slice(at) : migrations.slice(at, end);
}

// ---------------------------------------------------------------------------
describe('the Workspace Code is generated, not just declared', () => {
  // tenants.workspace_code and the unique index were live, but the generator
  // and trigger from migration 20260821013459 were never applied to this
  // project — so 0 of 2 tenants had a code, the Admin card showed nothing, and
  // any sign-in supplying a code compared against NULL and always failed.
  it('ships the generator', () => {
    expect(migrations).toContain('create or replace function public.gen_workspace_code()');
  });

  it('gives every future restaurant one automatically', () => {
    expect(migrations).toContain('create trigger tenants_workspace_code');
    expect(migrations).toContain('before insert or update of workspace_code on public.tenants');
  });

  it('backfills the restaurants that already exist', () => {
    expect(migrations).toContain('where workspace_code is null or btrim(workspace_code) = \'\'');
  });

  it('uses an alphabet that cannot be misread over a phone', () => {
    // md5 hex is 0-9A-F: no O/0 or I/1/L confusion.
    expect(migrations).toContain("upper(substr(md5(gen_random_uuid()::text), 1, 6))");
  });
});

describe('staff sign-in speaks the reason codes the client understands', () => {
  // The RPC returned 'ambiguous'; staffPortalAuth shows the Workspace Code
  // field only when the reason is exactly 'need_workspace_code'. So the one
  // case the field exists for showed "Invalid username or password" instead.
  const client = read('src', 'lib', 'staffAuth.functions.ts');
  const portal = read('src', 'lib', 'staffPortalAuth.ts');

  it('the client asks for need_workspace_code', () => {
    expect(portal).toContain("res.reason === 'need_workspace_code'");
    expect(client).toContain('need_workspace_code:');
  });

  it('and the function now returns exactly that', () => {
    expect(migrations).toContain("'reason', 'need_workspace_code'");
    expect(migrations).toContain("'reason', 'no_user_in_workspace'");
  });

  it('no longer returns a reason the client cannot render', () => {
    // Bounded to this function's OWN body. The slice used to run to the end
    // of every concatenated migration, so any later file mentioning one of
    // these words failed the test — v1.39.0's staff_login_check does, while
    // explaining nothing about staff_login_global.
    const fn = fnBody('staff_login_global');
    expect(fn).not.toContain("'ambiguous'");
    expect(fn).not.toContain("'no_password'");
  });

  it('does not reveal which usernames have no password set', () => {
    // Bounded to this function's OWN body. The slice used to run to the end
    // of every concatenated migration, so any later file mentioning one of
    // these words failed the test — v1.39.0's staff_login_check does, while
    // explaining nothing about staff_login_global.
    const fn = fnBody('staff_login_global');
    expect(fn).toContain("if p.pin_hash is null or p.pin_hash <> crypt(p_pin, p.pin_hash) then");
  });
});

// ---------------------------------------------------------------------------
describe('a branch cashier cannot reach another branch', () => {
  const fn = migrations.slice(migrations.indexOf('create or replace function public.can_access_branch'));

  it('a row with no branch is not visible to a branch-restricted user', () => {
    // `target is null or …` short-circuited before any of the user's own
    // attributes were read, so every NULL-branch row was readable and writable
    // by every cashier in the restaurant.
    expect(fn).toContain('or (target is not null and p.branch_id = target)');
    expect(fn).not.toContain('target is null or');
  });

  it('users who legitimately span branches still see everything', () => {
    expect(fn).toContain('p.all_branches');
    expect(fn).toContain("p.role in ('owner', 'admin')");
  });

  it('attendance and ledger entries are branch-scoped like the rest', () => {
    // Both carry branch_id and both were filtered by tenant alone, so one
    // branch's staff hours and accounting were visible to every other branch.
    expect(migrations).toContain('create policy attendance_branch_rw on public.attendance');
    expect(migrations).toContain('create policy ledger_entries_branch_rw on public.ledger_entries');
    expect(migrations).toContain('tenant_id = auth_tenant_id() and can_access_branch(branch_id)');
  });
});

// ---------------------------------------------------------------------------
describe('Admin Sales History can answer "what did each branch take?"', () => {
  const page = read('src', 'pages', 'AdminSalesHistoryPage.tsx');

  it('has a branch filter', () => {
    expect(page).toContain('const [branchFilter, setBranchFilter]');
    expect(page).toContain('All Branches');
  });

  it('actually filters the orders by it', () => {
    expect(page).toContain("branchFilter === 'all' ? true : (o.branchId || '') === branchFilter");
  });

  it('breaks the totals down per branch', () => {
    expect(page).toContain('branchRows');
    expect(page).toContain('By Branch');
  });

  it('reports gross, discounts, tax and net for each', () => {
    for (const col of ['Gross', 'Discounts', 'Tax', 'Net']) expect(page).toContain(`>${col}<`);
  });

  it('names the branch on every order row', () => {
    expect(page).toContain('<td>{branchName(o.branchId)}</td>');
  });

  it('hides the breakdown for a single-branch restaurant', () => {
    // Repeating the headline totals under a second heading is noise.
    expect(page).toContain('stats.branchRows.length > 1 &&');
  });

  it('the Dine-In filter matches the order type orders actually carry', () => {
    // It offered value "dine-in"; OrderType is 'dining', so choosing Dine-In
    // silently returned nothing.
    expect(page).toContain('<SelectItem value="dining">Dine-In</SelectItem>');
    expect(page).not.toContain('<SelectItem value="dine-in">');
  });
});
