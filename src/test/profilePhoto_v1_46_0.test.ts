// ============================================================================
// v1.46.0 — a face on the profile: customer, rider, order taker.
//
// The customer upload existed and worked on the website; it went to a TanStack
// server function on the WEBSITE'S origin, which the packaged app is not
// serving, so inside the APK it never arrived. These assertions hold the
// replacement in place: one Edge Function on the Supabase origin, reachable
// from the website, Windows and all three APKs.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const raw = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) =>
  raw(f).replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const FN = code('supabase/functions/profile-photo/index.ts');
const LIB = code('src/lib/profilePhoto.ts');
const SQL = raw('supabase/migrations/20260904140000_v1_46_0_profile_photos.sql')
  .replace(/^\s*--.*$/gm, '');

describe('the upload reaches an origin the app can actually talk to', () => {
  it('the client calls the Edge Function first', () => {
    expect(LIB).toContain("functions.invoke('profile-photo'");
  });

  it('keeps the website server function only as a fallback', () => {
    const edgeAt = LIB.indexOf("functions.invoke('profile-photo'");
    const fnAt = LIB.indexOf('customerPhoto.functions');
    expect(edgeAt).toBeGreaterThan(-1);
    expect(fnAt).toBeGreaterThan(edgeAt);
  });

  it('never falls back for a staff photo — there is no second route', () => {
    // Falling through would report a website error to a rider, which describes
    // a different problem from the one they have.
    expect(LIB).toContain("if (kind === 'staff') return { ok: false, reason: 'upload_failed' }");
  });

  it('the customer panel no longer calls the server function directly', () => {
    const panel = code('src/components/CustomerProfilePanel.tsx');
    expect(panel).toContain('uploadProfilePhoto');
    expect(panel).not.toContain('uploadCustomerPhoto');
  });
});

describe('the function decides who you are; the request body never does', () => {
  it('resolves a customer token through Postgres', () => {
    expect(FN).toContain('public_customer_me');
  });

  it('resolves a staff token through Postgres', () => {
    expect(FN).toContain('portal_me');
  });

  it('refuses an unknown token before writing a byte', () => {
    const at = FN.indexOf('let path: string;');
    const before = FN.slice(0, at);
    const upload = FN.indexOf('storage/v1/object/customer-photos/');
    expect(before).toContain('no_session');
    expect(FN.indexOf('no_session')).toBeLessThan(upload);
  });

  it('builds the path from the resolved identity, not from the caller', () => {
    expect(FN).toContain('`${r.customer.id}/profile.${EXT[contentType]}`');
    expect(FN).toContain('`staff/${r.userId}/profile.${EXT[contentType]}`');
    // no path, filename or folder may arrive in the body
    expect(FN).not.toMatch(/body\.(path|filename|folder|key)/);
  });

  it('refuses a file that is not the image it claims to be', () => {
    // The bucket checks the Content-Type header we send, not the bytes.
    expect(FN).toContain('looksLikeImage');
    expect(FN).toContain('not_an_image');
  });

  it('caps the payload before decoding it', () => {
    const capAt = FN.indexOf('base64.length > Math.ceil(MAX_BYTES');
    const decodeAt = FN.indexOf('atob(base64)');
    expect(capAt).toBeGreaterThan(-1);
    expect(capAt).toBeLessThan(decodeAt);
  });

  it('never returns the token back to the caller', () => {
    expect(FN).not.toMatch(/json\(\{[^}]*token/);
  });
});

describe('a staff photo has to be a file we put there ourselves', () => {
  it('portal_update_me requires our own public bucket, like the customer one', () => {
    expect(SQL).toContain('storage/v1/object/public/customer-photos/');
    expect(SQL).toContain("'bad_photo_url'");
  });

  it("still lets a person remove their photo", () => {
    expect(SQL).toContain("when p_photo = ''    then null");
  });

  it('portal_me returns the photo, so a saved one can be shown', () => {
    expect(SQL).toContain("'photo', p.photo_url");
    expect(SQL).toContain("'phone', p.phone");
  });
});

describe('the staff profile screen exists in both portals', () => {
  it('the rider has it', () => {
    expect(code('src/pages/RiderAppPage.tsx')).toContain('<StaffProfileCard');
  });

  it('the order taker has its own tab for it', () => {
    const ot = code('src/pages/OrderTakerPortalPage.tsx');
    expect(ot).toContain('<StaffProfileCard');
    expect(ot).toContain("path=\"/me\"");
    expect(ot).toContain("key: 'me'");
  });

  it('a save that changes no rows is reported, not swallowed', () => {
    // A portal app has no Supabase session; a write that matches zero rows
    // returns success. That silence is the bug this whole area exists to stop.
    const card = code('src/components/StaffProfileCard.tsx');
    expect(card).toContain('res.data?.ok === false');
    expect(card).toContain('toast.error');
  });
});
