// ============================================================================
// Production audit, v1.31.x — the two CRITICAL findings and their fixes.
//
// Both were found by EXPLOITING them against the live database inside
// transactions that were rolled back, not by reading code.
//
//  1. Every restaurant shipped with the same known admin password. Verified:
//       select pin_hash = crypt('<the constant>', pin_hash) -> true, true
//     on both live restaurants' admin accounts. The string was the default
//     value of sa_create_restaurant's parameter, hardcoded again in
//     seed-data.ts, and printed in the Super Admin panel.
//
//  2. anon — a stranger with only the public API key — could INSERT rows into
//     orders and order_items for ANY restaurant. Verified: both succeeded.
//
// These assertions read the migrations and sources with comments stripped, so
// the prose explaining a fix can never satisfy the test for it.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();

function sql(name: string): string {
  return readFileSync(resolve(ROOT, 'supabase/migrations', name), 'utf8')
    .replace(/^\s*--.*$/gm, '');
}

function ts(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
}

/** Every shipped source file (tests excluded — fixtures may hold fake creds). */
function shipped(dir = resolve(ROOT, 'src'), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== 'test') shipped(full, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('CRITICAL 1 — no shared password ships anywhere', () => {
  it('no shipped source file contains a plaintext password field', () => {
    const offenders: string[] = [];
    for (const f of shipped()) {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      // a literal assigned to a password-ish key, e.g.  password: 'abc123'
      if (/\b(password|pin|passwd)\s*:\s*['"][^'"]{4,}['"]/i.test(src)) {
        offenders.push(f.replace(ROOT + '/', ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the seed data ships no users at all', () => {
    const seed = ts('src/lib/seed-data.ts');
    expect(seed).toContain('users: [],');
    expect(seed).not.toMatch(/u-default-admin/);
  });

  it('restaurant creation generates a password instead of defaulting to one', () => {
    const s = sql('20260831130000_v1_31_1_no_default_password.sql');
    // the parameter no longer carries a constant default
    expect(s).toContain('p_admin_password text default null');
    expect(s).toContain('generate_initial_password(12)');
    // and it is returned once so it can be handed over
    expect(s).toContain("'pos_password', v_password");
    // nothing anywhere in the migration bakes a literal into a hash
    expect(s).not.toMatch(/crypt\('[^']+'\s*,\s*(extensions\.)?gen_salt/);
  });

  it('the generator cannot be called from a browser', () => {
    const s = sql('20260831130000_v1_31_1_no_default_password.sql');
    expect(s).toContain('revoke all on function public.generate_initial_password(integer) from public, anon, authenticated');
    expect(s).toContain('grant execute on function public.generate_initial_password(integer) to service_role');
  });

  it('login surfaces must_change_password, which nothing used to read', () => {
    const s = sql('20260831130000_v1_31_1_no_default_password.sql');
    const at = s.indexOf('create or replace function public.verify_staff_pin');
    expect(at).toBeGreaterThan(-1);
    const body = s.slice(at, s.indexOf('$function$;', at));
    expect(body).toContain('must_change_password');

    // and the client carries it all the way to the screen
    expect(ts('src/lib/supabase.ts')).toContain('must_change_password?: boolean');
    expect(ts('src/lib/staffAuth.functions.ts')).toContain('mustChangePassword: boolean');
    expect(ts('src/lib/staffAuth.functions.ts')).toContain('mustChangePassword: r.must_change_password === true');
  });

  it('the POS is not entered until the shipped password is replaced', () => {
    const login = ts('src/pages/LoginPage.tsx');
    const at = login.indexOf('if (r0.mustChangePassword) {');
    expect(at).toBeGreaterThan(-1);
    // the interception returns BEFORE onLogin is ever reached
    const block = login.slice(at, at + 600);
    expect(block).toContain('setPendingChange({');
    expect(block).toContain('return;');
    expect(block).not.toContain('onLogin(');
    // and the only way out of the change screen is a successful change
    expect(login).toContain('pos_change_own_password');
  });

  it('changing your own password requires proving the current one', () => {
    const s = sql('20260831130000_v1_31_1_no_default_password.sql');
    const at = s.indexOf('create or replace function public.pos_change_own_password');
    const body = s.slice(at, s.indexOf('$function$;', at));
    expect(body).toContain("pin_hash = extensions.crypt(coalesce(p_current, ''), pin_hash)");
    expect(body).toContain("'bad_current_password'");
    expect(body).toContain("'too_short'");
    expect(body).toContain('must_change_password = false');
    // it is tenant-guarded, NULL-safely
    expect(body).toContain('coalesce(p_tenant = auth_tenant_id(), false)');
  });
});

describe('CRITICAL 2 — anonymous writes into any restaurant are closed', () => {
  const s = sql('20260831120000_v1_31_0_close_anon_write_hole.sql');

  it('drops both anon insert policies', () => {
    expect(s).toContain('drop policy if exists order_items_public_insert on public.order_items');
    expect(s).toContain('drop policy if exists orders_public_insert      on public.orders');
  });

  it('also revokes the grants that made them reachable', () => {
    expect(s).toContain('revoke insert, update, delete on public.orders      from anon');
    expect(s).toContain('revoke insert, update, delete on public.order_items from anon');
  });

  it('does not touch the legitimate ordering path', () => {
    // public_place_order is service_role and bypasses RLS; the migration must
    // not have altered it, nor the anon SELECT the public menu needs.
    expect(s).not.toContain('public_place_order');
    expect(s).not.toMatch(/revoke\s+select/i);
    expect(s).not.toContain('menu_items');
  });

  it('leaves no client code writing to those tables directly', () => {
    const offenders: string[] = [];
    for (const f of shipped()) {
      const src = readFileSync(f, 'utf8');
      if (/from\(['"](orders|order_items)['"]\)\s*[\s\S]{0,40}\.(insert|upsert|update|delete)\(/.test(src)) {
        offenders.push(f.replace(ROOT + '/', ''));
      }
    }
    expect(offenders).toEqual([]);
  });
});
