// ============================================================
// Tests — v1.19.5 the build MUST carry Supabase configuration
//
// THE RECURRING FAILURE: every zip shipped so far excluded the env file, so
// every build made from it had no Supabase configuration. supabaseAvailable()
// answered false, auth fell back to Firebase, and a Supabase-only account was
// rejected with `Firebase: Error (auth/invalid-credential)`.
//
// The same symptom appeared three times and was diagnosed three times. This
// test makes the packaging mistake fail here instead of at a till.
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

describe('the repository ships a usable Supabase configuration', () => {
  it('an .env file exists and is committed', () => {
    // NOT .env.local — that is gitignored and never reaches the zip, which is
    // exactly how this bug kept coming back.
    expect(fs.existsSync(path.join(root, '.env'))).toBe(true);
  });

  it('.env defines both variables the client needs', () => {
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    expect(env).toMatch(/VITE_SUPABASE_URL=https:\/\/[a-z0-9]+\.supabase\.co/);
    expect(env).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY=\S+/);
  });

  it('.env carries NO secret or service-role key', () => {
    // The publishable key is public by design. The secret key bypasses RLS
    // entirely and would expose every tenant.
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const active = env.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).join('\n');
    expect(active).not.toMatch(/sb_secret_/);
    expect(active).not.toMatch(/service_role/);
    expect(active).not.toMatch(/VITE_\w*(SECRET|SERVICE_ROLE)/i);
  });

  it('gitignore keeps .env itself but excludes personal overrides', () => {
    const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    const lines = gi.split('\n').map(l => l.trim());
    expect(lines).toContain('.env.local');
    // A bare `.env` rule would strip the config from the package again.
    expect(lines.filter(l => l === '.env')).toHaveLength(0);
    expect(lines.filter(l => l === '.env*')).toHaveLength(0);
  });

  it('the resolved config would send auth to Supabase', () => {
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    const url = /VITE_SUPABASE_URL=(\S+)/.exec(env)?.[1];
    const key = /VITE_SUPABASE_PUBLISHABLE_KEY=(\S+)/.exec(env)?.[1];
    const supabaseAvailable = !!url && !!key;
    expect(supabaseAvailable).toBe(true);   // false here means Firebase login
  });
});
