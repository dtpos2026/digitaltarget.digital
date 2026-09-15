// ============================================================================
// v1.56.1 — the readable link broke every page that used it
//
// REPORTED: "phly is type ky auto link hoty thy website or order taker, ye usi
// restaurant py rhta tha, na ky koi error aty thy, lkn jb sy apny change kyi
// han ... who shi nhi han" — the auto-generated links used to keep the customer
// on that restaurant with no errors, and stopped once they carried the
// restaurant's name. And: "rider web order taker mean all portal py refresh ky
// data show ni krty".
//
// One fault, two symptoms. v1.42.0 started handing out `#/order/butt` instead
// of `#/order/<uuid>`, but applyPublicTenantFromUrl() calls setTenant() with
// whatever is in that URL segment — so the tenant id became the literal string
// "butt" and every read asked for `tenant_id = 'butt'`.
//
// Compounded twice over: applyPublicTenantFromUrl() runs on EVERY App render,
// so it put the slug back after the two pages that did resolve it; and
// `#/rider-portal/butt` and `#/order-taker/butt` were never resolved at all.
//
// Live: tenants.slug for this restaurant is 'butt' and its id is
// fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb; public_tenant_by_slug('butt') answers
// correctly for anon, so the server side was never the problem.
// ============================================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const UUID = 'fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb';
const SLUG = 'butt';

function atHash(h: string) {
  window.location.hash = h;
}

async function fresh() {
  vi.resetModules();
  return await import('@/lib/publicTenant');
}

beforeEach(() => {
  localStorage.clear();
  atHash('');
});

describe('a slug in the link is never installed as a tenant id', () => {
  for (const route of ['order', 'track', 'rider-portal', 'order-taker']) {
    it(`#/${route}/${SLUG} does not set the tenant to "${SLUG}"`, async () => {
      const { applyPublicTenantFromUrl } = await fresh();
      const { getTenantId } = await import('@/lib/tenant');
      atHash(`#/${route}/${SLUG}`);
      applyPublicTenantFromUrl();
      expect(getTenantId()).not.toBe(SLUG);
    });
  }

  it('a uuid link still sets the tenant exactly as it always did', async () => {
    const { applyPublicTenantFromUrl } = await fresh();
    const { getTenantId } = await import('@/lib/tenant');
    atHash(`#/order/${UUID}`);
    applyPublicTenantFromUrl();
    expect(getTenantId()).toBe(UUID);
  });

  it('every render agrees — the slug cannot overwrite a resolved uuid', async () => {
    // This is what made it unfixable from the page: App calls
    // applyPublicTenantFromUrl() on every render, so the resolved uuid was
    // replaced by the slug again on the very next one.
    const { applyPublicTenantFromUrl, cachedSlugTenant } = await fresh();
    const { setTenant, getTenantId } = await import('@/lib/tenant');
    localStorage.setItem('dt-slug-tenants', JSON.stringify({ [SLUG]: { id: UUID, name: 'My Restaurant' } }));
    atHash(`#/order/${SLUG}`);
    expect(cachedSlugTenant(SLUG)?.id).toBe(UUID);
    setTenant(UUID);
    for (let i = 0; i < 5; i++) applyPublicTenantFromUrl();
    expect(getTenantId()).toBe(UUID);
  });
});

describe('a refresh resolves the link without waiting for the network', () => {
  it('uses the remembered mapping, so the page is not empty while it waits', async () => {
    const { applyPublicTenantFromUrl } = await fresh();
    const { getTenantId } = await import('@/lib/tenant');
    localStorage.setItem('dt-slug-tenants', JSON.stringify({ [SLUG]: { id: UUID, name: 'My Restaurant' } }));
    atHash(`#/rider-portal/${SLUG}`);
    applyPublicTenantFromUrl();
    expect(getTenantId()).toBe(UUID);
  });

  it('matches the slug case-insensitively', async () => {
    const { cachedSlugTenant } = await fresh();
    localStorage.setItem('dt-slug-tenants', JSON.stringify({ [SLUG]: { id: UUID } }));
    expect(cachedSlugTenant('BUTT')?.id).toBe(UUID);
  });

  it('an unknown slug resolves to nothing rather than to itself', async () => {
    const { cachedSlugTenant } = await fresh();
    expect(cachedSlugTenant('never-seen-this')).toBeNull();
  });
});

describe('what counts as a slug', () => {
  it('a uuid is not one', async () => {
    const { looksLikeSlug } = await fresh();
    expect(looksLikeSlug(UUID)).toBe(false);
  });

  it('a readable name is', async () => {
    const { looksLikeSlug } = await fresh();
    expect(looksLikeSlug(SLUG)).toBe(true);
    expect(looksLikeSlug('butt-bbq')).toBe(true);
    expect(looksLikeSlug('butt-grilled-fish-restaurant')).toBe(true);
  });

  it('the legacy 28-character Firebase id is NOT treated as a slug', async () => {
    // The links the restaurant already has printed look like
    // #/order/wPVCIB1zx8fZtPrvVzcBLR0poM73. Those must keep routing straight
    // through, with no lookup and no gate. The first draft of looksLikeSlug
    // used a case-insensitive regex and claimed this one, which would have
    // broken every link already in circulation.
    const { looksLikeSlug } = await fresh();
    expect(looksLikeSlug('wPVCIB1zx8fZtPrvVzcBLR0poM73')).toBe(false);
  });

  it('an existing id link still sets the tenant straight from the URL', async () => {
    const { applyPublicTenantFromUrl } = await fresh();
    const { getTenantId } = await import('@/lib/tenant');
    atHash('#/order/wPVCIB1zx8fZtPrvVzcBLR0poM73');
    applyPublicTenantFromUrl();
    expect(getTenantId()).toBe('wPVCIB1zx8fZtPrvVzcBLR0poM73');
  });

  it('a mixed-case name is an id, not a slug — slugs are generated lowercase', async () => {
    const { looksLikeSlug } = await fresh();
    expect(looksLikeSlug('ButtBBQ')).toBe(false);
  });
});
