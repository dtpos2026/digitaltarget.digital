// ============================================================
// Tests — v1.18.0 Supabase sync engine (Phase 2)
//
// The three guarantees this engine exists to provide, each tied to a real
// incident from the field:
//   1. A replayed op never creates a second order.
//   2. A row event stream can never delete a local row by omission.
//   3. Order numbers are never guessed on the device.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  opIdFor, buildSyncOp, applyResults, applyRowEvent, isSyncable,
  type PushOutcome, type RowEvent,
} from '@/lib/supabaseSync';

const emptyOutcome = (): PushOutcome => ({
  sent: 0, applied: 0, duplicates: 0, conflicts: 0, rejected: 0, orderNumbers: {},
});

describe('op ids are deterministic — the replay guard', () => {
  const op = { col: 'orders', entityId: 'order-1', at: 1_700_000_000_000 };

  it('produces the SAME id for the same op every time', () => {
    // If this were random, a retry after a dropped response would look like a
    // brand new operation and the server would insert a second order — the
    // exact "one order created, two in Retrieve" complaint.
    expect(opIdFor(op)).toBe(opIdFor(op));
  });

  it('produces a DIFFERENT id for a genuinely different op', () => {
    expect(opIdFor(op)).not.toBe(opIdFor({ ...op, entityId: 'order-2' }));
    expect(opIdFor(op)).not.toBe(opIdFor({ ...op, at: op.at + 1 }));
    expect(opIdFor(op)).not.toBe(opIdFor({ ...op, col: 'orderItems' }));
  });

  it('is shaped as a valid UUID so Postgres accepts it', () => {
    expect(opIdFor(op)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[a-f][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('only the right collections sync', () => {
  it('recognises the order tables', () => {
    expect(isSyncable('orders')).toBe(true);
    expect(isSyncable('orderItems')).toBe(true);
    expect(isSyncable('orderPayments')).toBe(true);
  });

  it('ignores anything else, rather than pushing junk', () => {
    expect(isSyncable('settings')).toBe(false);
    expect(isSyncable('menuItems')).toBe(false);
  });

  it('builds nothing for an unsyncable collection', () => {
    const op = { id: 'x', col: 'settings', entityId: 'a', op: 'set' as const,
                 at: 1, firstEnqueuedAt: 1, deviceId: 'd', attempts: 0 };
    expect(buildSyncOp(op, {})).toBeNull();
  });

  it('maps a local collection to its server entity', () => {
    const op = { id: 'x', col: 'orderItems', entityId: 'oi-1', op: 'set' as const,
                 at: 5, firstEnqueuedAt: 5, deviceId: 'd', attempts: 0 };
    expect(buildSyncOp(op, { id: 'oi-1' })!.entity).toBe('order_items');
  });
});

describe('server results are interpreted correctly', () => {
  it('records the server-assigned order number', () => {
    const out = emptyOutcome();
    applyResults([{ op_id: 'a', result: 'applied', entity_id: 'o1', order_number: 42 }], out);
    expect(out.applied).toBe(1);
    expect(out.orderNumbers.o1).toBe(42);
  });

  it('treats a duplicate as SUCCESS, not failure', () => {
    // The row is already on the server. Retrying achieves nothing and the op
    // must leave the queue, or it would retry until it dead-letters.
    const out = emptyOutcome();
    applyResults([{ op_id: 'a', result: 'duplicate' }], out);
    expect(out.duplicates).toBe(1);
    expect(out.rejected).toBe(0);
  });

  it('counts a conflict separately from a rejection', () => {
    // conflict = a stale copy tried to undo a settled bill. The device must
    // accept the server's version rather than retry.
    const out = emptyOutcome();
    applyResults([{ op_id: 'a', result: 'conflict' }], out);
    expect(out.conflicts).toBe(1);
    expect(out.applied).toBe(0);
  });

  it('handles a mixed batch', () => {
    const out = emptyOutcome();
    applyResults([
      { op_id: '1', result: 'applied', entity_id: 'o1', order_number: 7 },
      { op_id: '2', result: 'duplicate' },
      { op_id: '3', result: 'conflict' },
      { op_id: '4', result: 'rejected', reason: 'unsupported entity' },
    ], out);
    expect(out).toMatchObject({ applied: 1, duplicates: 1, conflicts: 1, rejected: 1 });
  });
});

// ============================================================
// The most important tests in this file.
//
// The Firestore merge treated each snapshot as the complete truth and deleted
// any local row absent from it. That caused two data-loss incidents. The event
// applier below has NO code path that removes a row for being absent.
// ============================================================
describe('a row event stream can never delete by omission', () => {
  const local = [
    { id: 'a', order_number: 1, updated_at: '2026-08-01T10:00:00Z' },
    { id: 'b', order_number: 2, updated_at: '2026-08-01T11:00:00Z' },
  ];

  it('an INSERT for one row leaves the others alone', () => {
    const out = applyRowEvent(local, {
      type: 'INSERT', row: { id: 'c', order_number: 3, updated_at: '2026-08-01T12:00:00Z' },
    });
    expect(out.map(r => r.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('an UPDATE for one row does not touch the rest', () => {
    const out = applyRowEvent(local, {
      type: 'UPDATE', row: { id: 'a', status: 'paid', updated_at: '2026-08-01T13:00:00Z' },
    });
    expect(out).toHaveLength(2);
    expect(out.find(r => r.id === 'a')!.status).toBe('paid');
    expect(out.find(r => r.id === 'b')).toBeDefined();
  });

  it('removes a row ONLY on an explicit DELETE', () => {
    const out = applyRowEvent(local, { type: 'DELETE', row: { id: 'a' } });
    expect(out.map(r => r.id)).toEqual(['b']);
  });

  it('an out-of-order event cannot overwrite a newer local row', () => {
    // After a reconnect, events can arrive late. A stale event must not undo
    // work the device already knows about.
    const out = applyRowEvent(local, {
      type: 'UPDATE',
      row: { id: 'b', status: 'running', updated_at: '2026-08-01T09:00:00Z' },
    });
    expect(out.find(r => r.id === 'b')!.status).toBeUndefined();
  });

  it('a newer event does apply', () => {
    const out = applyRowEvent(local, {
      type: 'UPDATE',
      row: { id: 'b', status: 'paid', updated_at: '2026-08-01T23:00:00Z' },
    });
    expect(out.find(r => r.id === 'b')!.status).toBe('paid');
  });

  it('a malformed event changes nothing at all', () => {
    expect(applyRowEvent(local, { type: 'UPDATE', row: {} } as RowEvent)).toEqual(local);
  });

  it('merges fields rather than replacing the whole row', () => {
    // A partial event must not wipe columns it did not mention.
    const out = applyRowEvent(local, {
      type: 'UPDATE', row: { id: 'a', status: 'paid', updated_at: '2026-08-02T00:00:00Z' },
    });
    expect(out.find(r => r.id === 'a')!.order_number).toBe(1);
  });

  it('does not mutate the array it was given', () => {
    const before = local.map(r => r.id);
    applyRowEvent(local, { type: 'DELETE', row: { id: 'a' } });
    expect(local.map(r => r.id)).toEqual(before);
  });
});
