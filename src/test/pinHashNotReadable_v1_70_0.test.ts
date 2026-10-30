// ============================================================================
// v1.70.0 — a cashier could read the admin's PIN hash
//
// Found with a rolled-back probe: signed in as a branch cashier,
// `select pin_hash from user_profiles` returned four colleagues' bcrypt hashes. A POS
// PIN is four digits, so a readable hash is a readable PIN. The fix is a column-level
// grant (supabase/migrations/20261030140000_...). The database cannot be reached from
// the unit suite, so these tests pin the two things that keep the fix safe:
//   1. the migration says what it must, and
//   2. nothing in the BROWSER bundle ever asks for pin_hash or `select *`s user_profiles —
//      which would now be refused, and is exactly how the fix could be undone by accident.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = 'supabase/migrations/20261030140000_v1_70_0_hide_pin_hashes_from_staff.sql';
const sql = readFileSync(MIGRATION, 'utf8');
const code = sql.replace(/--[^\n]*/g, '');          // statements only, not the explanation

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
// Browser code = everything in src/ except tests, generated types, and the *.functions.ts files,
// which are TanStack server functions that run on the server with the service-role key.
const browserFiles = walk('src').filter(f =>
  !f.startsWith('src/test') && !f.includes('integrations/supabase/types') && !/\.functions\.ts$/.test(f) &&
  !f.includes('client.server'));

describe('the migration', () => {
  it('takes table-level SELECT from authenticated and grants it back column by column', () => {
    expect(code).toMatch(/revoke select on public\.user_profiles from authenticated/);
    expect(code).toMatch(/grant select \(' \|\| cols \|\| '\) on public\.user_profiles to authenticated/);
  });
  it('builds the column list from every column EXCEPT pin_hash', () => {
    expect(code).toMatch(/column_name\s*<>\s*'pin_hash'/);
    expect(code).not.toMatch(/grant select[^;]*pin_hash/i);
  });
  it('touches nothing else: no policy, no data, no other role', () => {
    expect(code).not.toMatch(/\b(drop|delete|truncate|update|insert|alter)\b/i);
    expect(code).not.toMatch(/\b(anon|service_role|postgres)\b/);
    expect(code).not.toMatch(/create policy|drop policy/i);
  });
  it('is one transaction: a failed grant cannot leave the revoke applied alone', () => {
    expect(code).toMatch(/^\s*do\s*\$\$/m);
    expect(code).toMatch(/refusing to change grants/);   // empty column list aborts before any change
  });
  it('documents the rollback', () => {
    expect(sql).toContain('grant select on public.user_profiles to authenticated;');
  });
});

describe('the browser bundle', () => {
  it('never mentions pin_hash in a query', () => {
    const offenders = browserFiles.filter(f => {
      const t = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return /\.select\([^)]*pin_hash/.test(t);
    });
    expect(offenders).toEqual([]);
  });
  it('never selects * (or nothing) from user_profiles', () => {
    const offenders: string[] = [];
    for (const f of browserFiles) {
      const t = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of t.matchAll(/from\(\s*['"]user_profiles['"]\s*\)([\s\S]{0,160})/g)) {
        const sel = /\.select\(\s*([^)]*)\)/.exec(m[1]);
        if (sel && (sel[1].trim() === '' || /^['"`]\*['"`]$/.test(sel[1].trim()))) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('the three reads it does make name their columns', () => {
    const named = (f: string) => /from\(\s*['"]user_profiles['"]\s*\)\s*\.select\(\s*['"][a-z_, ]+['"]/.test(readFileSync(f, 'utf8'));
    for (const f of ['src/lib/authProvider.ts', 'src/lib/supabase.ts', 'src/pages/LoginPage.tsx']) expect(named(f), f).toBe(true);
  });
});
