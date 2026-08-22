// ============================================================
// Tests — v1.21.2 tenant resolution must not depend on a dashboard toggle
//
// REPORTED: "Signed in, but this account is not linked to a restaurant."
//
// CAUSE: tenant_id was read ONLY from the JWT, where custom_access_token_hook
// puts it. That hook has to be enabled by hand in the Supabase dashboard. When
// it is not, the token carries no tenant, and a user who authenticated
// perfectly well is told their ACCOUNT is wrong — blaming the data for a
// configuration gap the app never checked.
//
// The JWT stays the fast path; user_profiles is the fallback.
// ============================================================
import { describe, it, expect } from 'vitest';

interface Claims { tenant_id?: string | null; branch_id?: string | null; role?: string | null }
interface Profile { tenant_id: string; branch_id: string | null; role: string }

/** Mirrors publishSupabaseSession(). */
function resolve(claims: Claims, profile: Profile | null) {
  const fromJwt = {
    tenantId: claims.tenant_id ?? null,
    branchId: claims.branch_id ?? null,
    role: claims.role ?? null,
  };
  if (fromJwt.tenantId) return { ...fromJwt, source: 'jwt' as const };
  if (profile) {
    return {
      tenantId: profile.tenant_id,
      branchId: profile.branch_id,
      role: profile.role,
      source: 'db' as const,
    };
  }
  return { ...fromJwt, source: 'none' as const };
}

const profile: Profile = { tenant_id: 'tenant-1', branch_id: 'branch-1', role: 'owner' };

describe('the JWT is used when the hook IS registered', () => {
  it('takes tenant, branch and role straight from the claims', () => {
    const r = resolve({ tenant_id: 'tenant-1', branch_id: 'b1', role: 'owner' }, profile);
    expect(r.source).toBe('jwt');
    expect(r.tenantId).toBe('tenant-1');
  });

  it('does not query the database when the claim is present', () => {
    // The point of the hook is to avoid a round-trip on every session read.
    expect(resolve({ tenant_id: 'tenant-1' }, null).source).toBe('jwt');
  });
});

describe('the database fills in when the hook is NOT registered', () => {
  it('THE REGRESSION: an empty claim still resolves the tenant', () => {
    const r = resolve({}, profile);
    expect(r.source).toBe('db');
    expect(r.tenantId).toBe('tenant-1');
    expect(r.role).toBe('owner');
  });

  it('handles an explicitly null claim the same way', () => {
    expect(resolve({ tenant_id: null }, profile).tenantId).toBe('tenant-1');
  });

  it('carries branch and role across too, not just the tenant', () => {
    const r = resolve({}, profile);
    expect(r.branchId).toBe('branch-1');
    expect(r.role).toBe('owner');
  });
});

describe('a genuinely unlinked account is still reported', () => {
  it('returns no tenant when there is no profile either', () => {
    // This is the ONLY case where "not linked to a restaurant" is true.
    const r = resolve({}, null);
    expect(r.tenantId).toBeNull();
    expect(r.source).toBe('none');
  });

  it('a signed-in user with no profile is not mistaken for signed out', () => {
    expect(resolve({}, null).source).not.toBe('jwt');
  });
});
