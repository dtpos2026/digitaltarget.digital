// ============================================================================
// v1.29.5 — the customer app knows which restaurant it belongs to.
//
// REPORTED: "customer APK par restaurant ka naam nahi aata (web order link par
// aata hai). App ko pata hona chahiye ke wo kis restaurant ka hai."
//
// Two halves:
//   1. A packaged build binds to its restaurant even when the route carries no
//      id — but never at the cost of a staff session that is already signed in.
//   2. The build script actually stamps the id the binding reads.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyPublicTenantFromUrl, packagedTenantId, parsePublicTenantId } from '@/lib/publicTenant';
import { getTenantId, setTenant, clearTenant } from '@/lib/tenant';

const PACKAGED = 'fd3ead3d-af9a-4ff2-b78d-5f93d1e6e3fb';
const OTHER    = '98cd0a35-a01f-4c12-83b2-8c36b8f87bd3';

function setHash(h: string) {
  window.location.hash = h;
}

beforeEach(() => {
  clearTenant();
  setHash('');
  delete (globalThis as Record<string, unknown>).__DT_APP_TENANT__;
});

afterEach(() => {
  clearTenant();
  setHash('');
  delete (globalThis as Record<string, unknown>).__DT_APP_TENANT__;
});

describe('a packaged app binds to the restaurant it was built for', () => {
  it('reports no packaged tenant in a browser', () => {
    expect(packagedTenantId()).toBeNull();
  });

  it('ignores a stamp that is not a usable id', () => {
    for (const junk of [null, 42, '', 'ab', {}, []] as unknown[]) {
      (globalThis as Record<string, unknown>).__DT_APP_TENANT__ = junk;
      expect(packagedTenantId()).toBeNull();
    }
  });

  it('gives a fresh install its restaurant even off a public route', () => {
    (globalThis as Record<string, unknown>).__DT_APP_TENANT__ = PACKAGED;
    setHash('#/');
    expect(getTenantId()).toBeNull();

    applyPublicTenantFromUrl();

    expect(getTenantId()).toBe(PACKAGED);
  });

  it('does NOT overwrite a tenant a staff sign-in already set', () => {
    // A rider signs in to one restaurant inside a build stamped for another.
    // applyPublicTenantFromUrl() runs on every App render, so forcing the
    // stamp here would fight that session on the next paint.
    (globalThis as Record<string, unknown>).__DT_APP_TENANT__ = PACKAGED;
    setTenant(OTHER, 'Signed-in restaurant');
    setHash('#/');

    applyPublicTenantFromUrl();
    applyPublicTenantFromUrl();

    expect(getTenantId()).toBe(OTHER);
  });

  it('lets an explicit link win over the stamp', () => {
    (globalThis as Record<string, unknown>).__DT_APP_TENANT__ = PACKAGED;
    setHash(`#/order/${OTHER}`);

    applyPublicTenantFromUrl();

    expect(parsePublicTenantId()).toBe(OTHER);
    expect(getTenantId()).toBe(OTHER);
  });

  it('falls back to the stamp on a public route with no id in it', () => {
    (globalThis as Record<string, unknown>).__DT_APP_TENANT__ = PACKAGED;
    setHash('#/order');

    applyPublicTenantFromUrl();

    expect(parsePublicTenantId()).toBeNull();
    expect(getTenantId()).toBe(PACKAGED);
  });

  it('leaves the website alone: no stamp, no id in the link, no tenant', () => {
    setHash('#/order');
    applyPublicTenantFromUrl();
    expect(getTenantId()).toBeNull();
  });
});

describe('the build script publishes the id the binding reads', () => {
  // Assert on the emitted CODE, not on the comment explaining it: strip the
  // comments first so prose cannot satisfy any of this.
  const src = readFileSync(resolve(process.cwd(), 'scripts/build-app.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  it('stamps the global publicTenant.ts looks for', () => {
    expect(src).toContain('window.__DT_APP_TENANT__=');
    // JSON.stringify, so a stray quote in an id cannot break out of the script.
    expect(src).toContain('JSON.stringify(tenant)');
  });

  it('still sets the opening route', () => {
    expect(src).toContain("location.hash='#/order/${tenant}'");
  });

  it('writes both into the same <head> boot block', () => {
    const at = src.indexOf('const boot =');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf('writeFileSync(indexPath', at));
    expect(block).toContain('__DT_APP_TENANT__');
    expect(block).toContain('location.hash');
    expect(src).toContain("html.replace('</head>'");
  });

  it('refuses a tenant id that is not a uuid before any of this runs', () => {
    expect(src).toContain('/^[0-9a-f-]{36}$/i.test(tenant)');
  });
});

describe('the customer header reads the anon-visible config, not RLS-locked settings', () => {
  // settings.* comes from tenant_settings, which anon reads 0 rows from. The
  // header must prefer the config the RPC hands an anonymous customer.
  // Comments are stripped so the explanation above cannot satisfy the check.
  const page = readFileSync(resolve(process.cwd(), 'src/pages/OnlineOrderPage.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('titles the page from the config first', () => {
    expect(page).toContain("{appConfig?.appName || settings.name || 'Restaurant'}");
  });

  it('takes the logo from the config first', () => {
    expect(page).toContain('appConfig?.logoUrl || appConfig?.iconUrl || settings.webPortalLogo || settings.logo');
  });

  it('no longer renders the old settings-only header', () => {
    expect(page).not.toContain("<h1 className=\"text-base font-extrabold leading-tight truncate\">{settings.name || 'Restaurant'}</h1>");
  });
});
