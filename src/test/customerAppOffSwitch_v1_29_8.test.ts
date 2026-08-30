// ============================================================================
// v1.29.8 — switching the customer app off actually switches it off.
//
// REPORTED: "agar app module off kar dein to app chalni nahi chahiye."
//
// customer_apps.enabled gated sign-in, sign-up and OTP, so nobody NEW could get
// in. Everyone already signed in carried on indefinitely, because me / orders /
// order_track only ever checked the token. And the client could not tell "off"
// from "never configured", because the config answered null to both — and the
// second has to keep working, since it is how plain online ordering behaves.
//
// The gate is the server. This holds the client to the same distinction.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260830140000_v1_29_8_customer_app_off_switch.sql'),
  'utf8',
).replace(/^\s*--.*$/gm, '');

const PAGE = readFileSync(resolve(process.cwd(), 'src/pages/OnlineOrderPage.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('the server refuses once the module is off', () => {
  it('guards every session-scoped customer function', () => {
    for (const fn of [
      'public.public_customer_me(',
      'public.public_customer_orders(',
      'public.public_customer_order_track(',
    ]) {
      const at = MIGRATION.indexOf(`create or replace function ${fn}`);
      expect(at, fn).toBeGreaterThan(-1);
      const body = MIGRATION.slice(at, MIGRATION.indexOf('$function$;', at));
      expect(body, fn).toContain('customer_app_blocked(v_row.tenant_id)');
      expect(body, fn).toContain("'app_disabled'");
    }
  });

  it('leaves website ordering alone', () => {
    // public_place_order and public_track_order serve the restaurant's public
    // site, not only the app. Gating them here would take a restaurant's
    // website down whenever the app module was switched off.
    expect(MIGRATION).not.toContain('public_place_order');
    expect(MIGRATION).not.toContain('public_track_order');
  });

  it('blocks an explicit off, never a restaurant that simply never configured one', () => {
    const at = MIGRATION.indexOf('create or replace function public.customer_app_blocked');
    expect(at).toBeGreaterThan(-1);
    const body = MIGRATION.slice(at, MIGRATION.indexOf('$$;', at));
    // `enabled is not true` on an EXISTING row — not "no row means blocked".
    expect(body).toContain('c.enabled is not true');
    expect(body).toContain('exists (');
    expect(body).not.toContain('not exists');
    // a deactivated restaurant is blocked too
    expect(body).toContain('t.is_active is not true');
  });

  it('tells the client which state it is in instead of answering null to both', () => {
    const at = MIGRATION.indexOf('create or replace function public.public_customer_app_config');
    const body = MIGRATION.slice(at, MIGRATION.indexOf('$function$;', at));
    expect(body).toContain("'enabled',         true");
    expect(body).toContain("'enabled',  false");
    // no row at all still means "never configured"
    expect(body).toContain('where c.tenant_id = p_tenant;');
  });

  it('hands a disabled app a name and nothing else', () => {
    const at = MIGRATION.indexOf('create or replace function public.public_customer_app_config');
    const body = MIGRATION.slice(at, MIGRATION.indexOf('$function$;', at));
    const off = body.slice(body.indexOf('else'));
    expect(off).toContain("'appName'");
    expect(off).not.toContain("'theme'");
    expect(off).not.toContain("'features'");
    expect(off).not.toContain("'updateUrl'");
  });
});

describe('the client shows a sentence instead of an empty list', () => {
  it('blocks only on an explicit false', () => {
    expect(PAGE).toContain('if (appConfig?.enabled === false) {');
    // never on null — that is a restaurant with plain online ordering
    expect(PAGE).not.toContain('if (!appConfig) {');
  });

  it('names the restaurant on the block screen', () => {
    const at = PAGE.indexOf('if (appConfig?.enabled === false) {');
    const block = PAGE.slice(at, at + 1200);
    expect(block).toContain('appConfig.appName');
  });

  it('checks it before the page renders anything orderable', () => {
    const block = PAGE.indexOf('if (appConfig?.enabled === false) {');
    const online = PAGE.indexOf('if (settings.onlineOrderEnabled === false) {');
    expect(block).toBeGreaterThan(-1);
    expect(online).toBeGreaterThan(-1);
    expect(block).toBeLessThan(online);
  });
});
