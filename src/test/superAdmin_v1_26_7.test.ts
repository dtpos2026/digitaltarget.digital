// ============================================================================
// v1.26.7 / v1.26.8 — support messaging and device identity
//
// Both were verified against the live database by impersonating real users
// under real RLS (see the commit message). These pin the contracts.
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getDeviceFingerprint } from '@/lib/deviceIdentity';

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8');
const migrations = fs.readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
  .map(f => read('supabase', 'migrations', f)).join('\n');

// ---------------------------------------------------------------------------
describe('support messages can actually be inserted', () => {
  // THE BUG: the live CHECK allowed ('in','out','inbound','outbound') while
  // dirFromSide() sends 'owner' | 'support'. Every insert failed with 23514,
  // both directions, text and images alike — the table held zero rows.
  it('the constraint accepts the vocabulary the client sends', () => {
    const c = migrations.slice(migrations.indexOf('admin_support_messages_direction_check'));
    expect(c).toContain("'owner'::text, 'support'::text");
  });

  it('and still accepts any historic row', () => {
    const c = migrations.slice(migrations.indexOf('add constraint admin_support_messages_direction_check'));
    expect(c).toContain("'in'::text, 'out'::text, 'inbound'::text, 'outbound'::text");
  });

  it('the code no longer documents a contract that was never true', () => {
    const s = read('src', 'lib', 'support.ts');
    expect(s).not.toContain("// The table's CHECK constraint allows only 'in' | 'out' | 'owner' | 'support'.");
    expect(s).toContain('this comment used to be wrong, and that was the bug');
  });

  it('reads both vocabularies, so old rows still render', () => {
    const s = read('src', 'lib', 'support.ts');
    expect(s).toContain("direction === 'support' || direction === 'out'");
  });
});

describe('the Super Admin can handle support attachments', () => {
  // The only policy on the bucket was
  //   (storage.foldername(name))[1] = auth_tenant_id()::text
  // and a Super Admin has no user_profiles row, so auth_tenant_id() is NULL
  // and the predicate is NULL — never true. That is why sending an image
  // "failed" and why images from restaurants rendered blank.
  it('has a policy of their own on that bucket', () => {
    expect(migrations).toContain('create policy "support-attachments_super_admin" on storage.objects');
    expect(migrations).toContain("bucket_id = 'support-attachments' and public.is_super_admin()");
  });

  it('scoped to that bucket only, not to storage at large', () => {
    const pol = migrations.slice(migrations.indexOf('"support-attachments_super_admin"'));
    expect(pol.slice(0, 400)).toContain("bucket_id = 'support-attachments'");
  });

  it('attachments are stored as a path and resolved to a signed URL', () => {
    // Signed URLs expire; a stored URL would break later.
    const s = read('src', 'lib', 'support.ts');
    expect(s).toContain('return path; // store the PATH; signed URLs expire');
    expect(s).toContain('createSignedUrl(ref, 3600)');
  });
});

// ---------------------------------------------------------------------------
describe('one physical machine is one approved device', () => {
  const fn = migrations.slice(migrations.indexOf('create or replace function public.register_device'));

  it('merges another browser on the same machine into the existing device', () => {
    expect(fn).toContain('and d.fingerprint = v_fp');
    expect(fn).toContain("'merged',        v_merged");
  });

  it('a returning browser keeps its own row rather than being re-merged', () => {
    expect(fn).toContain('and d.hardware_id is distinct from p_hardware_id');
  });

  it('a merged device inherits BLOCKED, so a block cannot be shed', () => {
    // Without this, blocking a machine would be undone by opening a different
    // browser — which is worse than not having the feature.
    expect(fn).toContain('returning d.approved, d.blocked, d.auto_approved');
    expect(fn).toContain("'blocked',       coalesce(v_blk, false)");
  });

  it('re-registering still never silently re-approves a revoked device', () => {
    expect(fn).toContain('approved is deliberately NOT touched here');
  });

  it('still refuses a branch the caller cannot access', () => {
    expect(fn).toContain('branch not permitted');
  });

  it('the fingerprint is documented as a hint, not an identity', () => {
    expect(migrations).toContain('Never an identity or an authorisation input.');
  });
});

describe('the fingerprint describes the machine, not the browser', () => {
  it('is stable across calls', () => {
    // A value that drifted would split one machine into a new device every
    // time a browser updated.
    expect(getDeviceFingerprint()).toBe(getDeviceFingerprint());
  });

  it('excludes the user agent and the IP address', () => {
    const s = read('src', 'lib', 'deviceIdentity.ts');
    const traits = s.slice(s.indexOf('function collectTraits'), s.indexOf('export function getDeviceFingerprint'));
    expect(traits).not.toContain('userAgent');
    expect(traits).not.toContain('appVersion');
    // IP is ruled out by the brief and changes with wifi, hotspots and VPNs.
    expect(traits).not.toMatch(/\bip\b/i);
  });

  it('prefers a real Electron installation id when the shell offers one', () => {
    const s = read('src', 'lib', 'deviceIdentity.ts');
    expect(s).toContain('getNativeMachineId');
    expect(s).toContain('electronAPI');
  });

  it('degrades to an empty hint rather than throwing', () => {
    const s = read('src', 'lib', 'deviceIdentity.ts');
    expect(s).toContain("if (!traits) return '';");
  });

  it('the client sends the fingerprint on registration', () => {
    const s = read('src', 'lib', 'supabaseSync.ts');
    expect(s).toContain('p_fingerprint: ident.fingerprint || null');
  });
});
