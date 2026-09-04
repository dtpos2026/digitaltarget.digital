// ============================================================================
// "her fountion ko pta ho mera resrurant ye ha" + "worpace code dasbord me nzr ay"
//
// One resolver, four session kinds, and a header chip that is on screen for
// every function. These assertions hold that shape in place.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const src = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) =>
  src(f).replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('the identity has exactly one resolver', () => {
  it('the header chip, the card and the portal badge all use it', () => {
    for (const f of [
      'src/components/RestaurantIdentityChip.tsx',
      'src/components/PortalRestaurantBadge.tsx',
    ]) {
      expect(code(f), f).toContain('useRestaurantIdentity');
    }
    expect(code('src/components/WorkspaceCodeCard.tsx')).toContain('resolveRestaurantIdentity');
  });

  it('none of them reads the tenants table on its own any more', () => {
    // Three screens doing three different reads is how the header could know
    // the code while the card said it did not exist.
    for (const f of [
      'src/components/WorkspaceCodeCard.tsx',
      'src/components/PortalRestaurantBadge.tsx',
      'src/components/RestaurantIdentityChip.tsx',
    ]) {
      expect(code(f), f).not.toContain("from('tenants')");
      expect(code(f), f).not.toContain('get_workspace_code');
    }
  });

  it('is on screen for every page, not just the two cards', () => {
    const layout = code('src/components/AppLayout.tsx');
    expect(layout).toContain('<RestaurantIdentityChip />');
  });
});

describe('the resolver covers every kind of session', () => {
  const lib = code('src/lib/restaurantIdentity.ts');

  it('portal token — rider and order taker have no auth.uid()', () => {
    expect(lib).toContain('hasPortalSession');
    expect(lib).toContain('portalRestaurant');
  });

  it('cloud session — the row, then the SECURITY DEFINER route', () => {
    expect(lib).toContain("from('tenants')");
    expect(lib).toContain('get_workspace_code');
  });

  it('staff PIN — the code staff_login_check handed back at sign-in', () => {
    expect(lib).toContain('getSavedWorkspaceCode');
  });

  it('offline — the cache paints before any of them', () => {
    expect(lib).toContain('export function cachedIdentity');
  });

  it('a portal device does not fall through to the cloud reads', () => {
    // Those reads need auth.uid(); on a portal device they fail for a reason
    // that has nothing to do with the real problem, and the wrong message is
    // worse than none.
    const at = lib.indexOf('if (hasPortalSession())');
    const seg = lib.slice(at, lib.indexOf('const tid = getTenantId();', at));
    expect(seg).toContain('return id;');
  });
});

describe('one restaurant\'s name can never appear inside another', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('drops a cache written for a different tenant', async () => {
    const { setTenant } = await import('@/lib/tenant');
    setTenant('11111111-1111-1111-1111-111111111111');
    localStorage.setItem('dt-restaurant-identity', JSON.stringify({
      tenantId: '22222222-2222-2222-2222-222222222222',
      name: 'Someone Else Restaurant', workspaceCode: 'ZZZZZZ',
    }));
    const { cachedIdentity } = await import('@/lib/restaurantIdentity');
    const id = cachedIdentity();
    expect(id.name).toBe('');
    expect(id.workspaceCode).toBe('');
  });

  it('keeps a cache written for this tenant', async () => {
    const { setTenant } = await import('@/lib/tenant');
    setTenant('11111111-1111-1111-1111-111111111111');
    localStorage.setItem('dt-restaurant-identity', JSON.stringify({
      tenantId: '11111111-1111-1111-1111-111111111111',
      name: 'My Own Restaurant', workspaceCode: '6fc459', branchName: 'Main Branch',
    }));
    const { cachedIdentity } = await import('@/lib/restaurantIdentity');
    const id = cachedIdentity();
    expect(id.name).toBe('My Own Restaurant');
    expect(id.workspaceCode).toBe('6FC459');
    expect(id.branchName).toBe('Main Branch');
  });

  it('is wiped when the tenant is cleared and when a portal signs out', () => {
    expect(code('src/lib/tenant.ts')).toContain("removeItem('dt-restaurant-identity')");
    expect(code('src/lib/portalData.ts')).toContain("removeItem('dt-restaurant-identity')");
  });
});

describe('the portals name the restaurant the way the owner does', () => {
  const M = src('supabase/migrations/20260904130000_v1_45_0_one_restaurant_identity.sql')
    .replace(/^\s*--.*$/gm, '');

  it('prefers the owner\'s Settings name over the created-with name', () => {
    expect(M).toContain("ts.settings->>'name'");
    expect(M).toContain('coalesce(v_name, t.name)');
  });

  it('prefers the branch row over the tenant-wide row', () => {
    expect(M).toContain('order by (ts.branch_id = s.branch_id) desc');
  });

  it('still refuses a token that resolves to nothing', () => {
    expect(M).toContain('if s.user_id is null then');
    expect(M).toContain("'reason', 'no_session'");
  });

  it('takes no tenant from the caller — only the token decides', () => {
    expect(M).toContain('portal_restaurant(p_token text)');
    expect(M).toContain('s.tenant_id');
    expect(M).not.toMatch(/portal_restaurant\(p_tenant/);
  });
});
