// v1.113.0 — promo codes: the conditions reach the cloud (and come back), and a code can be for account holders only.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rowFromDb, rowToDb } from '@/lib/supabaseStore';
import { savePromoCode, validatePromoCode, getPromoCodes } from '@/lib/store';
import type { PromoCode } from '@/lib/types';

const code = (over: Partial<PromoCode> = {}): PromoCode => ({
  id: 'p1', code: 'EID25', discountType: 'percent', discountValue: 25, usageCount: 3, isActive: true, createdAt: '2026-11-01T00:00:00.000Z', ...over,
});

describe('to the cloud', () => {
  it('maps the app\'s words onto the table\'s columns, so nothing is dropped and a flat code is no longer refused', () => {
    const r = rowToDb('promoCodes', code({ discountType: 'pkr', discountValue: 300, usageLimit: 50, startDate: '2026-11-10', endDate: '2026-11-30', minOrderAmount: 1500, accountsOnly: true, notes: 'Eid week' }));
    expect(r.discount_type).toBe('fixed');                         // the table's check allows 'fixed' / 'percent', not 'pkr'
    expect(r.discount_value).toBe(300);
    expect(r.max_uses).toBe(50);
    expect(String(r.valid_from).startsWith('2026-11-10')).toBe(true);
    expect(String(r.valid_until).startsWith('2026-11-30')).toBe(true);
    expect(r.min_order_amount).toBe(1500);
    expect(r.accounts_only).toBe(true);
    expect(r.notes).toBe('Eid week');
    expect(r.code).toBe('EID25');
    expect(r.usage_count).toBe(3);
    expect(r.is_active).toBe(true);
  });
  it('a code with no conditions sends nulls and a plain false, never a missing column', () => {
    const r = rowToDb('promoCodes', code());
    expect(r.discount_type).toBe('percent');
    expect(r.max_uses).toBeNull();
    expect(r.valid_from).toBeNull();
    expect(r.valid_until).toBeNull();
    expect(r.min_order_amount).toBeNull();
    expect(r.accounts_only).toBe(false);
    expect(Object.keys(r).every(k => !/[A-Z]/.test(k))).toBe(true);   // snake_case only
  });
});

describe('from the cloud', () => {
  it('turns the table\'s names back into the app\'s: fixed -> pkr, max_uses -> usageLimit, dates, minimum, accounts only', () => {
    const c = rowFromDb({ id: 'p1', code: 'EID25', discount_type: 'fixed', discount_value: '300.00', max_uses: 50, used_count: 4, usage_count: 4,
      valid_from: '2026-11-10T00:00:00+00:00', valid_until: '2026-11-30T00:00:00+00:00', min_order_amount: '1500.00', accounts_only: true, notes: 'x', is_active: true, updated_at: '2026-11-07T10:00:00Z' }, 'promo_codes');
    expect(c).toMatchObject({ code: 'EID25', discountType: 'pkr', discountValue: 300, usageLimit: 50, usageCount: 4, startDate: '2026-11-10', endDate: '2026-11-30', minOrderAmount: 1500, accountsOnly: true, isActive: true });
  });
  it('a plain percent code comes back plain', () => {
    const c = rowFromDb({ id: 'p2', code: 'HALF', discount_type: 'percent', discount_value: 10, max_uses: null, usage_count: 0, valid_from: null, valid_until: null, min_order_amount: null, accounts_only: false, is_active: false }, 'promo_codes');
    expect(c).toMatchObject({ discountType: 'percent', discountValue: 10, accountsOnly: false, isActive: false });
    expect(c.usageLimit).toBeUndefined();
    expect(c.startDate).toBeUndefined();
    expect(c.minOrderAmount).toBeUndefined();
  });
  it('round trip: what the till saves is what the website reads', () => {
    const original = code({ discountType: 'pkr', discountValue: 200, usageLimit: 10, startDate: '2026-12-01', endDate: '2026-12-31', minOrderAmount: 1000, accountsOnly: true });
    const back = rowFromDb({ ...rowToDb('promoCodes', original), id: 'p1', updated_at: '2026-11-07T10:00:00Z' }, 'promo_codes');
    expect(back).toMatchObject({ code: 'EID25', discountType: 'pkr', discountValue: 200, usageLimit: 10, startDate: '2026-12-01', endDate: '2026-12-31', minOrderAmount: 1000, accountsOnly: true });
  });
});

describe('validatePromoCode', () => {
  beforeEach(() => { localStorage.clear(); for (const p of getPromoCodes()) savePromoCode({ ...p, isActive: false }); });
  it('a code for account holders is refused on the ordering site until the customer signs in, and never refused at the till', () => {
    savePromoCode(code({ id: 'a1', code: 'MEMBER10', discountType: 'percent', discountValue: 10, accountsOnly: true }));
    const guest = validatePromoCode('member10', 2000, { signedIn: false });
    expect('error' in guest && guest.error).toBe('Sign in to your account to use this code');
    const signed = validatePromoCode('member10', 2000, { signedIn: true });
    expect('discount' in signed && signed.discount).toBe(200);
    const till = validatePromoCode('member10', 2000);                      // no context: the till
    expect('discount' in till && till.discount).toBe(200);
  });
  it('an ordinary code is not touched by the new rule', () => {
    savePromoCode(code({ id: 'b1', code: 'OPEN5', discountType: 'percent', discountValue: 5 }));
    const r = validatePromoCode('OPEN5', 1000, { signedIn: false });
    expect('discount' in r && r.discount).toBe(50);
  });
  it('the other rules still hold with the account rule present', () => {
    savePromoCode(code({ id: 'c1', code: 'BIGONLY', discountType: 'pkr', discountValue: 100, minOrderAmount: 1500, accountsOnly: true }));
    const r = validatePromoCode('BIGONLY', 1000, { signedIn: true });
    expect('error' in r && r.error).toMatch(/Minimum order/);
  });
});

describe('the screens and the database', () => {
  it('the ordering page tells the rule whether the customer is signed in; the form has the switch', () => {
    expect(readFileSync('src/pages/OnlineOrderPage.tsx', 'utf8')).toContain('validatePromoCode(promoInput.trim(), subtotal, { signedIn: !!account })');
    const form = readFileSync('src/pages/PromoCodesPage.tsx', 'utf8');
    expect(form).toContain('data-promo-accounts-only');
    expect(form).toContain('accountsOnly: v');
  });
  it('the migration is additive (three columns, nothing dropped) and has a rollback file', () => {
    const m = readFileSync('supabase/migrations/20261107150000_v1_113_0_promo_code_fields.sql', 'utf8');
    expect(m).toMatch(/add column if not exists min_order_amount numeric\(12,2\)/);
    expect(m).toMatch(/add column if not exists accounts_only\s+boolean not null default false/);
    expect(m).toMatch(/add column if not exists notes\s+text/);
    expect(m).not.toMatch(/drop\s+(table|column|constraint)/i);
    expect(readFileSync('docs/rollback/2026-11-07-v1_113_0-promo-code-fields.sql', 'utf8')).toMatch(/drop column if exists accounts_only/);
  });
});
