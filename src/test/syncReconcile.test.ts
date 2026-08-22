// v1.26.0 — reconciliation reports differences, never rewrites data.
import { describe, it, expect } from 'vitest';
import { compareOrders, syncStateLabel } from '@/lib/syncReconcile';

const L = (id: string, n: number, total: number, status = 'paid') =>
  ({ id, orderNumber: n, total, status });

describe('local vs cloud order reconciliation', () => {
  it('clean books report nothing', () => {
    expect(compareOrders([L('a', 1, 100)], [L('a', 1, 100)])).toEqual([]);
  });

  it('an offline bill that never reached the cloud is reported', () => {
    const r = compareOrders([L('a', 1, 100)], []);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('missing_in_cloud');
  });

  it('a cloud bill this till has not pulled yet is reported', () => {
    const r = compareOrders([], [L('b', 2, 50)]);
    expect(r[0].kind).toBe('missing_locally');
  });

  it('total mismatch beats status mismatch (money first)', () => {
    const r = compareOrders([L('a', 1, 100, 'paid')], [L('a', 1, 90, 'running')]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('total_mismatch');
  });

  it('sub-cent rounding is not treated as a mismatch', () => {
    expect(compareOrders([L('a', 1, 100.001)], [L('a', 1, 100)])).toEqual([]);
  });

  it('status drift alone is reported', () => {
    const r = compareOrders([L('a', 1, 100, 'running')], [L('a', 1, 100, 'paid')]);
    expect(r[0].kind).toBe('status_mismatch');
  });

  it('two different bills sharing one printed number are flagged', () => {
    const r = compareOrders([L('a', 7, 100)], [L('a', 7, 100), L('z', 7, 40)]);
    const dup = r.filter(x => x.kind === 'duplicate_number');
    expect(dup.length).toBeGreaterThanOrEqual(2);
  });

  it('is read-only — inputs are not mutated', () => {
    const local = [L('a', 1, 100)];
    const snapshot = JSON.stringify(local);
    compareOrders(local, []);
    expect(JSON.stringify(local)).toBe(snapshot);
  });
});

describe('labels', () => {
  it('maps every state to a human string', () => {
    for (const s of ['synced', 'pending', 'syncing', 'failed', 'conflict', 'needsReview'] as const) {
      expect(syncStateLabel(s).length).toBeGreaterThan(0);
    }
  });
});
