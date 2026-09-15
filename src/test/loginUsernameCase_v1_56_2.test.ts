// ============================================================================
// v1.56.2 — "Wrong username or password" for a password that was correct
//
// REPORTED: "ksi ka user login he nhi krta koi bug ha shid jis wja sy ksi
// resturant ka user login nhi ho rha" — no restaurant's staff can sign in.
//
// The POS has TWO sign-in paths and they did not agree:
//
//     staff_login_global()   lower(u.username) = lower(btrim(p_username))
//     verify_staff_pin()     username = p_username
//
// LoginPage takes the second whenever the owner's Supabase session is live and
// the first otherwise, so the SAME credentials worked or failed depending on
// which path ran. On a phone or tablet the keyboard capitalises the first
// letter by itself, so "Admin" is exactly what a cashier types.
//
// Measured against the live database as the owner, BEFORE the fix:
//     verify_staff_pin(tenant,'admin','00003354')   -> ok: true
//     verify_staff_pin(tenant,'Admin','00003354')   -> ok: false
//     verify_staff_pin(tenant,'ADMIN','00003354')   -> ok: false
//     verify_staff_pin(tenant,' admin ','00003354') -> ok: false
// AFTER: all four true, and a wrong password still false.
//
// The second half is the panel that caused three live accounts to be locked
// out: it showed the new password in React state only, so a refresh lost the
// one copy that existed and the accounts had to be reset from the database.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
// Assertions must never match this file's own prose, or the migration's.
const stripSql = (s: string) => s.replace(/--[^\n]*/g, '');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const sql = stripSql(read('supabase/migrations/20260915130000_v1_56_2_login_username_case.sql'));
const panel = stripTs(read('src/components/StaffPasswordResetPanel.tsx'));

describe('both sign-in paths match a username the same way', () => {
  it('verify_staff_pin matches case- and space-insensitively', () => {
    expect(sql).toContain('lower(username) = lower(btrim(p_username))');
  });

  it('the exact-match comparison that caused it is gone', () => {
    // `username = p_username` must not survive anywhere in the function.
    const body = sql.slice(sql.indexOf('function public.verify_staff_pin'));
    expect(body).not.toMatch(/\band username = p_username\b/);
  });

  it('the PASSWORD is still compared verbatim — not trimmed, not lowered', () => {
    // Loosening the password would be a security regression dressed up as a
    // bug fix. Only the username is normalised.
    expect(sql).toContain('pin_hash = crypt(p_pin, pin_hash)');
    expect(sql).not.toContain('btrim(p_pin)');
    expect(sql).not.toContain('lower(p_pin)');
  });

  it('still refuses a disabled account and one with no password', () => {
    expect(sql).toContain('and is_active');
    expect(sql).toContain('pin_hash is not null');
  });

  it('still refuses a caller who is neither this tenant nor a super admin', () => {
    expect(sql).toContain('p_tenant = auth_tenant_id()');
    expect(sql).toContain('is_super_admin()');
    expect(sql).toContain("errcode = '42501'");
  });
});

describe('a reset that loses its own password is worse than no reset', () => {
  it('the new password survives a page refresh', () => {
    expect(panel).toContain('sessionStorage.getItem(DONE_KEY)');
    expect(panel).toContain('sessionStorage.setItem(DONE_KEY');
  });

  it('it is scoped per restaurant, so it cannot show the wrong one', () => {
    expect(panel).toContain('`dt-sa-last-reset:${tenantId}`');
  });

  it('dismissing it is confirmed, because it is the only copy', () => {
    expect(panel).toContain('window.confirm(');
    expect(panel).toContain('sessionStorage.removeItem(DONE_KEY)');
  });

  it('it is session-scoped, never written to localStorage', () => {
    expect(panel).not.toContain('localStorage.setItem(DONE_KEY');
  });
});
