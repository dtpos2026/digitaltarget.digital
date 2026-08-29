// ============================================================================
// v1.29.0 — staff login answered "Forbidden" on the Windows app
//
// REPORTED: the owner's email sign-in worked, and the staff username/password
// step that follows it answered "Forbidden".
//
// The two steps do not use the same transport, and that is the whole of it.
// The email sign-in talks to Supabase directly. The staff step called
// staffSignIn, a TanStack server function — and the Windows renderer is a
// file:// bundle with no backend of its own, so the shell proxies those calls
// over HTTP to DTPOS_API_ORIGIN. When that address is wrong, or the deployment
// behind it is older than the bundle calling it, the host answers 403, and the
// client surfaces the status text: the bare word "Forbidden".
//
// verify_staff_pin is granted to `authenticated` and guards itself on
// p_tenant = auth_tenant_id(). The owner's session is live at this point, so
// the check can be made against Supabase directly, exactly like the email
// sign-in, and the desktop stops depending on an HTTP origin to let staff in.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const login = readFileSync(join(process.cwd(), 'src/pages/LoginPage.tsx'), 'utf8');
const supa = readFileSync(join(process.cwd(), 'src/lib/supabase.ts'), 'utf8');

const block = login.slice(login.indexOf('if (usingSupabaseAuth())'),
                          login.indexOf('setLoading(false);\n        if (!r0.ok)'));

describe('the path that does not need an HTTP origin', () => {
  it('is tried first, when there is a session to make it with', () => {
    expect(block).toContain('currentAuthUser()');
    expect(block).toContain('verifyStaffPin(tenantId, username.trim(), password)');
    // Compare the CALL SITES, not the prose: the comment above them names
    // staffSignIn first, which an index search on the bare name would match.
    expect(block.indexOf('verifyStaffPin(tenantId'))
      .toBeLessThan(block.indexOf('await staffSignIn({'));
  });

  it('goes to Supabase directly, the same way the email sign-in does', () => {
    expect(supa).toContain("sb().rpc('verify_staff_pin'");
  });
});

describe('the service-role path is kept, not replaced', () => {
  it('still answers when there is no browser session', () => {
    // A device that knows its restaurant but whose session has lapsed can only
    // be served by the service-role path.
    expect(block).toContain('if (!r0) {');
    expect(block).toContain("await import('@/lib/staffAuth.functions')");
  });

  it('a refusal from the direct path falls through instead of failing the login', () => {
    // 42501 here means "this session has no tenant", which is not a wrong
    // password and must not be reported as one.
    expect(block).toContain('direct staff verification unavailable');
  });
});

describe('what the operator is told when the origin really is wrong', () => {
  const protocolTs = readFileSync(
    join(process.cwd(), '..', 'dtpos-desktop', 'src', 'main', 'protocol.ts'), 'utf8');

  it('the shell names the address it called, not just the status', () => {
    expect(protocolTs).toContain('refused this request (HTTP');
    expect(protocolTs).toContain('DTPOS_API_ORIGIN');
  });

  it('a path refusal says which path, so it cannot be confused with this', () => {
    expect(protocolTs).toContain('Forbidden: ${url.pathname}');
  });
});
