// ============================================================
// Regression tests — v1.2.5 new features
//  1. Paid-only receipts (admin toggle)
//  2. Manager password for item remove/void (admin toggle)
// Both MUST default to OFF so existing restaurants are unaffected.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { verifyManagerPassword } from '@/components/ManagerAuthDialog';

// Mirrors the guard inside enqueueReceipt (printQueue.ts, v1.2.5)
function shouldPrintReceipt(order: { status: string }, settings: { paidOnlyReceipts?: boolean }): boolean {
  if (!settings.paidOnlyReceipts) return true; // default: unchanged behaviour
  const s = order.status;
  return s === 'paid' || s === 'credit_received' || s === 'complimentary';
}

describe('Feature 1 — paid-only receipts', () => {
  it('DEFAULT OFF: every slip still prints (other restaurants unaffected)', () => {
    for (const status of ['paid', 'running', 'hold', 'credit_pending', 'partial']) {
      expect(shouldPrintReceipt({ status }, {})).toBe(true);
    }
  });

  it('ON: unpaid / running / hold slips are skipped', () => {
    const on = { paidOnlyReceipts: true };
    expect(shouldPrintReceipt({ status: 'running' }, on)).toBe(false);
    expect(shouldPrintReceipt({ status: 'hold' }, on)).toBe(false);
    expect(shouldPrintReceipt({ status: 'credit_pending' }, on)).toBe(false);
    expect(shouldPrintReceipt({ status: 'partial' }, on)).toBe(false);
  });

  it('ON: settled bills still print', () => {
    const on = { paidOnlyReceipts: true };
    expect(shouldPrintReceipt({ status: 'paid' }, on)).toBe(true);
    expect(shouldPrintReceipt({ status: 'credit_received' }, on)).toBe(true);
    expect(shouldPrintReceipt({ status: 'complimentary' }, on)).toBe(true);
  });
});

describe('Feature 2 — manager password for item remove', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('desi-pos-data', JSON.stringify({
      orders: [], settings: {}, categories: [], menuItems: [], tables: [],
      users: [
        { id: 'u1', name: 'Owner Sahab', username: 'admin', password: 'admin123', role: 'admin', isActive: true },
        { id: 'u2', name: 'Manager Ali', username: 'ali', password: 'mgr456', role: 'manager', isActive: true },
        { id: 'u3', name: 'Cashier Bilal', username: 'bilal', password: 'cash789', role: 'cashier', isActive: true },
        { id: 'u4', name: 'Old Manager', username: 'old', password: 'gone111', role: 'manager', isActive: false },
      ],
    }));
  });

  it('accepts an admin password and reports who authorized', () => {
    const r = verifyManagerPassword('admin123');
    expect(r.ok).toBe(true);
    expect(r.name).toBe('Owner Sahab');
  });

  it('accepts a manager password', () => {
    expect(verifyManagerPassword('mgr456')).toEqual({ ok: true, name: 'Manager Ali' });
  });

  it('REJECTS a cashier password — staff cannot self-authorize a removal', () => {
    expect(verifyManagerPassword('cash789').ok).toBe(false);
  });

  it('rejects a deactivated manager', () => {
    expect(verifyManagerPassword('gone111').ok).toBe(false);
  });

  it('rejects wrong and empty passwords', () => {
    expect(verifyManagerPassword('wrong').ok).toBe(false);
    expect(verifyManagerPassword('').ok).toBe(false);
    expect(verifyManagerPassword('   ').ok).toBe(false);
  });
});
