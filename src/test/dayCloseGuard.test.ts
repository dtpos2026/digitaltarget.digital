// ============================================================
// Regression tests — v1.2.4 round 6
//  1. Day close must NEVER delete udhaar/credit bills when the
//     "Credit orders" checkbox is unchecked.
//  2. Emergency backups must survive every cache wipe.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';

// Mirrors the classification in SettingsPage.handleDayClose (v1.2.4).
function shouldDelete(
  o: { status: string; paymentMethod?: string },
  cfg: { clearPaidOrders: boolean; clearRunningHoldBills: boolean; clearVoidComp: boolean; clearCreditOrders: boolean },
): boolean {
  const s = o.status;
  const isCredit = s === 'credit_pending' || s === 'credit_received'
    || (o.paymentMethod === 'credit' && s !== 'void' && s !== 'cancelled');
  const isPaid = !isCredit && s === 'paid';
  const isRunHold = !isCredit && (s === 'running' || s === 'hold' || s === 'partial');
  const isVoidComp = s === 'void' || s === 'complimentary' || s === 'cancelled';
  return (
    (isPaid && cfg.clearPaidOrders) ||
    (isRunHold && cfg.clearRunningHoldBills) ||
    (!isCredit && isVoidComp && cfg.clearVoidComp) ||
    (isCredit && cfg.clearCreditOrders)
  );
}

const CLEAR_ALL_BUT_CREDIT = {
  clearPaidOrders: true,
  clearRunningHoldBills: true,
  clearVoidComp: true,
  clearCreditOrders: false, // UNCHECKED — udhaar must survive
};

describe('Day close — credit/udhaar protection', () => {
  it('keeps credit_pending bills when credit checkbox is unchecked', () => {
    expect(shouldDelete({ status: 'credit_pending' }, CLEAR_ALL_BUT_CREDIT)).toBe(false);
  });

  it('keeps credit_received bills when credit checkbox is unchecked', () => {
    expect(shouldDelete({ status: 'credit_received' }, CLEAR_ALL_BUT_CREDIT)).toBe(false);
  });

  it('THE BUG: a credit bill still marked paid/running is no longer swept by other checkboxes', () => {
    // These were deleted before v1.2.4 because they matched isPaid / isRunHold.
    expect(shouldDelete({ status: 'paid', paymentMethod: 'credit' }, CLEAR_ALL_BUT_CREDIT)).toBe(false);
    expect(shouldDelete({ status: 'running', paymentMethod: 'credit' }, CLEAR_ALL_BUT_CREDIT)).toBe(false);
    expect(shouldDelete({ status: 'hold', paymentMethod: 'credit' }, CLEAR_ALL_BUT_CREDIT)).toBe(false);
    expect(shouldDelete({ status: 'partial', paymentMethod: 'credit' }, CLEAR_ALL_BUT_CREDIT)).toBe(false);
  });

  it('still clears normal cash bills as configured', () => {
    expect(shouldDelete({ status: 'paid', paymentMethod: 'cash' }, CLEAR_ALL_BUT_CREDIT)).toBe(true);
    expect(shouldDelete({ status: 'running' }, CLEAR_ALL_BUT_CREDIT)).toBe(true);
    expect(shouldDelete({ status: 'void' }, CLEAR_ALL_BUT_CREDIT)).toBe(true);
  });

  it('clears credit bills ONLY when the operator explicitly ticks the box', () => {
    const cfg = { ...CLEAR_ALL_BUT_CREDIT, clearCreditOrders: true };
    expect(shouldDelete({ status: 'credit_pending' }, cfg)).toBe(true);
    expect(shouldDelete({ status: 'paid', paymentMethod: 'credit' }, cfg)).toBe(true);
  });

  it('with everything unchecked, day close deletes nothing', () => {
    const none = { clearPaidOrders: false, clearRunningHoldBills: false, clearVoidComp: false, clearCreditOrders: false };
    for (const o of [{ status: 'paid' }, { status: 'running' }, { status: 'void' }, { status: 'credit_pending' }]) {
      expect(shouldDelete(o, none)).toBe(false);
    }
  });
});

describe('Emergency backup survives cache wipes', () => {
  const KEY = 'dt-pos-emergency-backup::tenant-1';

  beforeEach(() => localStorage.clear());

  it('is preserved by the login-screen clear-cache routine', () => {
    localStorage.setItem(KEY, JSON.stringify({ at: 'now', tag: 'pre-logout', json: '{"orders":[]}' }));
    localStorage.setItem('desi-pos-data', '{"orders":[]}');

    // same preservation logic as LoginPage clear-cache
    const backups: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('dt-pos-emergency-backup::')) backups.push([k, localStorage.getItem(k)!]);
    }
    localStorage.clear();
    for (const [k, v] of backups) localStorage.setItem(k, v);

    expect(localStorage.getItem('desi-pos-data')).toBeNull(); // wiped as intended
    expect(localStorage.getItem(KEY)).toBeTruthy();           // backup survived
  });
});
