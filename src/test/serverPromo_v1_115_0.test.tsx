// v1.115.0 — the server owns a website order's money: promo code (and its use count), minimum order, delivery charge, bill number.
// The SQL itself was proven in a rolled-back transaction against the live database (see docs/qa); these pin the contract the page relies on.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { orderRefusalMessage, promoMessage } from '@/lib/promoMessages';

const read = (f: string) => readFileSync(f, 'utf8');
const money = (n: number) => `Rs ${n.toLocaleString('en-US')}`;

describe('the words for the server\'s answers', () => {
  it('every reason has a sentence; an unknown reason is "Invalid promo code", never a blank', () => {
    for (const r of ['empty', 'not_found', 'inactive', 'not_started', 'expired', 'limit_reached', 'account_required', 'min_order']) expect(promoMessage(r).length, r).toBeGreaterThan(5);
    expect(promoMessage('something_new')).toBe('Invalid promo code');
    expect(promoMessage(undefined)).toBe('Invalid promo code');
    expect(promoMessage('account_required')).toBe('Sign in to your account to use this code');
  });
  it('a code\'s minimum says how much, in the restaurant\'s money', () => {
    expect(promoMessage('min_order', { minOrder: 1500 }, money)).toBe('Minimum order Rs 1,500 for this code');
  });
  it('an order the server refused is explained, and a refused code is taken off the cart', () => {
    const p = orderRefusalMessage('promo code not valid: expired', money)!;
    expect(p.clearPromo).toBe(true);
    expect(p.text).toContain('Promo expired');
    const m = orderRefusalMessage('minimum order is Rs 800', money)!;
    expect(m.clearPromo).toBe(false);
    expect(m.text).toContain('Rs 800');
    expect(orderRefusalMessage('item not available: Zinger', money)).toBeNull();
  });
});

describe('the page and the server function', () => {
  const page = read('src/pages/OnlineOrderPage.tsx');
  const fns = read('src/lib/publicPortal.functions.ts');
  it('the cart asks the server about a code, and falls back to local codes only when the server cannot be reached', () => {
    expect(page).toContain('await checkPublicPromo({ data: { tenantId, code, subtotal, customerToken: getCustomerToken() } })');
    expect(page).toContain('promoMessage(r.reason, { minOrder: r.minOrder }, money)');
    expect(page.indexOf('checkPublicPromo({')).toBeLessThan(page.indexOf('validatePromoCode(code, subtotal'));
  });
  it('the order carries the customer\'s session, shows the server\'s total, and no longer counts the code in the browser', () => {
    expect(page).toContain('customerToken: getCustomerToken(),');
    expect(page).toContain('order.grandTotal = submitted.grand_total;');
    expect(page).not.toContain('incrementPromoUsage(promoApplied.code)');
    expect(page).toContain('orderRefusalMessage(String(e?.message');
  });
  it('the server function passes the session on and exposes the check and the offers', () => {
    expect(fns).toContain('customerToken: z.string().min(32).max(200).nullable().optional()');
    expect(fns).toContain("{ ...data.order, customerToken: data.customerToken }");
    expect(fns).toContain("rpc('public_check_promo'");
    expect(fns).toContain("rpc('public_offers'");
  });
});

describe('the migration', () => {
  const m = read('supabase/migrations/20261117100000_v1_115_0_server_side_promo_and_offers.sql');
  it('is additive: one column off by default, internal helper not callable by the public, public ones granted, order function replaced in place', () => {
    expect(m).toMatch(/add column if not exists show_on_website boolean not null default false/);
    expect(m).toContain('revoke all on function public._promo_check(uuid, text, numeric, uuid, boolean) from public, anon, authenticated;');
    expect(m).toContain('grant execute on function public.public_check_promo(uuid, text, numeric, text) to anon, authenticated, service_role;');
    expect(m).toContain('grant execute on function public.public_offers(uuid) to anon, authenticated, service_role;');
    expect(m).toContain('create or replace function public.public_place_order(p_tenant uuid, p_branch uuid, p_order jsonb)');
    expect(m).not.toMatch(/drop\s+(table|column)/i);
  });
  it('the order function counts the code in the same step, re-checks the minimum, the delivery charge and the account rule, and never numbers behind the branch', () => {
    expect(m).toContain("v_promo := public._promo_check(p_tenant, v_pcode, v_subtotal, v_cust.id, true);");
    expect(m).toContain('update promo_codes set usage_count = coalesce(usage_count, 0) + 1');
    expect(m).toContain("raise exception 'minimum order is Rs %'");
    expect(m).toContain('v_dcharge := case when v_dfree > 0 and v_subtotal >= v_dfree then 0 else v_dbase end;');
    expect(m).toContain('greatest(');                                  // the bill number: never behind the highest issued
    expect(m).toContain("for update");                                  // the code's row is locked while it is counted
  });
  it('the rollback restores the previous function and removes what was added', () => {
    const r = read('docs/rollback/2026-11-17-v1_115_0-server-side-promo-before.sql');
    expect(r).toContain('drop function if exists public.public_check_promo');
    expect(r).toContain('alter table public.promo_codes drop column if exists show_on_website');
    expect(r).toContain("'discount',    0,");                          // the old order function: discount 0
  });
});

describe('the promo form', () => {
  it('has the switch that lists a code on the Offers page, off unless chosen', () => {
    const f = read('src/pages/PromoCodesPage.tsx');
    expect(f).toContain('data-promo-show-on-website');
    expect(f).toContain('showOnWebsite: v');
  });
});
