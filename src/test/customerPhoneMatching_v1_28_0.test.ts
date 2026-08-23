// ============================================================================
// v1.28.0 — one customer, however they type their number
//
// FOUND BY: the end-to-end customer journey probe against the live database. A
// customer who signed up as 03211230001 and then typed +92 321 123 0001 was
// told "wrong number or PIN". Both are the same phone. Worse than the failed
// login: signing up again would have created a second, empty profile beside
// the one holding their address and order history.
//
// The lookups now compare on the last ten digits — the subscriber number, the
// part that does not change between 0321…, +92 321… and 0092 321…. Nothing
// about a country is hardcoded.
//
// The behaviour itself was verified against the live database in a rolled-back
// transaction: sign up as 0321-123-0001, then log in successfully as both
// "+92 321 123 0001" and "0092 321 1230001"; request an OTP as 03007778899 and
// verify it as "+92 300 777 8899". These assert the shipped SQL's contract, so
// a later edit cannot quietly put the raw-digit comparison back.
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'supabase', 'migrations');
const migration = fs.readFileSync(
  path.join(dir, '20260823180000_v1_28_0_phone_matching.sql'), 'utf8',
);

/** The body of one `create or replace function` in the migration. */
function body(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} is not in the migration`).toBeGreaterThan(-1);
  const end = migration.indexOf('$function$;', start);
  return migration.slice(start, end > start ? end : undefined);
}

describe('a phone number is matched on its subscriber digits', () => {
  it('defines the key as the last ten digits', () => {
    const key = migration.slice(
      migration.indexOf('create or replace function public.customer_phone_key'),
      migration.indexOf('create or replace function public.public_customer_login'),
    );
    expect(key).toContain('right(customer_phone_digits(p), 10)');
    // Anything shorter than ten is left alone, so a junk number cannot collide
    // with a real one by being padded into it.
    expect(key).toContain('>= 10');
    expect(key).toContain('else customer_phone_digits(p)');
    // It is used in an index, which Postgres only allows for an immutable
    // function.
    expect(key).toContain('immutable');
  });

  for (const fn of ['public_customer_login', 'public_customer_signup']) {
    it(`${fn} looks a customer up by the key, not the raw digits`, () => {
      const src = body(fn);
      expect(src).toContain('customer_phone_key(c.phone) = v_key');
      expect(src).not.toContain('customer_phone_digits(c.phone)');
    });
  }

  it('the OTP is issued and redeemed against the same key', () => {
    const request = body('public_customer_request_otp');
    const verify = body('public_customer_verify_otp');
    expect(request).toContain('v_key    text := customer_phone_key(p_phone)');
    expect(request).toContain('phone_digits = v_key');
    expect(verify).toContain('v_key    text := customer_phone_key(p_phone)');
    expect(verify).toContain('phone_digits = v_key');
  });

  it('still sends the SMS to a dialable number, not to the ten-digit key', () => {
    const request = body('public_customer_request_otp');
    // The destination has to keep the country code, or the message goes nowhere.
    expect(request).toContain("v_digits text := customer_phone_digits(p_phone)");
    expect(request).toContain("'sms', v_digits");
  });

  it('the order-to-profile trigger agrees with the login lookup', () => {
    // If these two disagreed, an order placed as +92 321… would build a second
    // profile beside the one the same diner signs in with.
    const src = migration.slice(migration.indexOf('create or replace function public.link_order_customer'));
    expect(src).toContain('v_key := customer_phone_key(v_phone)');
    expect(src).toContain('customer_phone_key(phone) = v_key');
    // And it still must never fail an order.
    expect(src).toContain('exception when others then');
  });

  it('never rewrites the number the customer typed', () => {
    const signup = body('public_customer_signup');
    // The stored phone is what they entered. The key is a lookup value only —
    // storing it would silently change every customer's number to ten digits.
    expect(signup).toContain('btrim(p_phone)');
    const insert = signup.slice(signup.indexOf('insert into customers'));
    expect(insert).not.toContain('v_key');
  });

  it('indexes the lookup it introduced', () => {
    expect(migration).toContain('customers_phone_key_idx');
    expect(migration).toContain('(tenant_id, public.customer_phone_key(phone))');
  });
});
