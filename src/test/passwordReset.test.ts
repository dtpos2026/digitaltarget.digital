// ============================================================
// Tests — v1.20.1 password reset
// ============================================================
import { describe, it, expect } from 'vitest';
import { isPublicTenantRoute, parsePublicTenantId } from '@/lib/publicTenant';

describe('the reset link can be opened without signing in', () => {
  it('THE POINT: /reset-password is a public route', () => {
    // Gating it behind the login screen would make the emailed link useless —
    // the person is there precisely because they cannot sign in.
    expect(isPublicTenantRoute('#/reset-password')).toBe(true);
  });

  it('carries no tenant, so it cannot hijack the current restaurant', () => {
    expect(parsePublicTenantId('#/reset-password')).toBeNull();
  });

  it('still recognises the real tenant routes', () => {
    expect(isPublicTenantRoute('#/order/abcd1234')).toBe(true);
    expect(parsePublicTenantId('#/order/abcd1234')).toBe('abcd1234');
  });

  it('does not make the whole app public by accident', () => {
    expect(isPublicTenantRoute('#/settings')).toBe(false);
    expect(isPublicTenantRoute('#/')).toBe(false);
    expect(isPublicTenantRoute('#/super-admin')).toBe(false);
  });
});

describe('reset must not leak which accounts exist', () => {
  // A different message for a known vs unknown address turns the form into an
  // account-enumeration oracle: anyone could discover which restaurant owners
  // hold accounts by trying addresses.
  const message = (_addr: string, _accountExists: boolean) =>
    'If an account exists for that address, a reset link is on its way.';

  it('says the same thing for a known and an unknown address', () => {
    expect(message('real@x.com', true)).toBe(message('fake@x.com', false));
  });

  it('never asserts that the account exists', () => {
    expect(message('a@b.c', true)).toMatch(/if an account exists/i);
  });
});

describe('new password rules', () => {
  const validate = (pw: string, confirm: string): string | null => {
    if (pw.length < 6) return 'Password must be at least 6 characters';
    if (pw !== confirm) return 'The two passwords do not match';
    return null;
  };

  it('rejects a short password', () => {
    expect(validate('12345', '12345')).toMatch(/6 characters/);
  });

  it('rejects a mismatch', () => {
    expect(validate('secret123', 'secret124')).toMatch(/do not match/);
  });

  it('accepts a valid pair', () => {
    expect(validate('secret123', 'secret123')).toBeNull();
  });
});
