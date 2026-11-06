// v1.110.0 — "Cloud sync issue" for a record that belongs to another restaurant: set it aside, quietly, instead of retrying forever.
// Live logs showed ten `POST /customers → 403` every ~25 minutes, each burst ending in a toast. The cause is an upsert that lands on
// another restaurant's row and is refused by the UPDATE policy — it can never succeed here.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSetAside, isForeignRecordError, isSetAside, parseSaveLabel, releaseSetAside, setAside } from '@/lib/setAside';
import { isPermanentSyncError } from '@/lib/syncErrors';

const FOREIGN = { message: 'new row violates row-level security policy (USING expression) for table "customers"', code: '42501' };

describe('which errors are "another restaurant\'s record"', () => {
  it('is exactly the UPDATE-policy refusal of an upsert', () => {
    expect(isForeignRecordError(FOREIGN)).toBe(true);
    expect(isForeignRecordError(new Error('new row violates row-level security policy (USING expression) for table "branches"'))).toBe(true);
  });
  it('is not a network error, a plain insert refusal, a duplicate or a missing column', () => {
    expect(isForeignRecordError(new Error('Failed to fetch'))).toBe(false);
    expect(isForeignRecordError({ message: 'new row violates row-level security policy for table "orders"', code: '42501' })).toBe(false);
    expect(isForeignRecordError({ message: 'duplicate key value violates unique constraint "orders_tenant_id_branch_id_order_number_key"', code: '23505' })).toBe(false);
    expect(isForeignRecordError({ message: 'permission denied for function orders_waiting_by_branch', code: '42501' })).toBe(false);
    expect(isForeignRecordError(null)).toBe(false);
    expect(isForeignRecordError(undefined)).toBe(false);
  });
  it('still counts as a permanent error for everything that already reads it that way', () => {
    expect(isPermanentSyncError(FOREIGN)).toBe(true);
  });
});

describe('the set-aside list', () => {
  beforeEach(() => { releaseSetAside(); });

  it('remembers a record once, and says so only the first time', () => {
    expect(setAside('customers', 'c1', 'x')).toBe(true);
    expect(setAside('customers', 'c1', 'x')).toBe(false);
    expect(isSetAside('customers', 'c1')).toBe(true);
    expect(isSetAside('customers', 'c2')).toBe(false);
    expect(isSetAside('branches', 'c1')).toBe(false);
    expect(getSetAside()).toHaveLength(1);
  });
  it('lets the owner release one record, one collection or everything', () => {
    setAside('customers', 'a', 'x'); setAside('customers', 'b', 'x'); setAside('branches', 'z', 'x');
    expect(releaseSetAside('customers', 'a')).toBe(1);
    expect(isSetAside('customers', 'a')).toBe(false);
    expect(isSetAside('customers', 'b')).toBe(true);
    expect(releaseSetAside('customers')).toBe(1);
    expect(getSetAside().map(r => r.id)).toEqual(['z']);
    expect(releaseSetAside()).toBe(1);
    expect(getSetAside()).toEqual([]);
  });
  it('announces a change so Data Integrity can refresh', () => {
    let n = 0;
    const on = () => { n++; };
    window.addEventListener('dt-set-aside', on);
    setAside('customers', 'ev', 'x');
    releaseSetAside();
    window.removeEventListener('dt-set-aside', on);
    expect(n).toBe(2);
  });
  it('reads the record out of the label the sync layer uses', () => {
    expect(parseSaveLabel('save customers/9f3a-1')).toEqual({ col: 'customers', id: '9f3a-1' });
    expect(parseSaveLabel('save marketingContacts/abc')).toEqual({ col: 'marketingContacts', id: 'abc' });
    expect(parseSaveLabel('load orders')).toBeNull();
  });
  it('survives a corrupt stored value', () => {
    localStorage.setItem(Object.keys(localStorage).find(k => k.startsWith('dt-set-aside::')) || 'dt-set-aside::local', '{not json');
    expect(getSetAside()).toEqual([]);
  });
});

describe('the sync layer uses it', () => {
  const store = readFileSync('src/lib/store.ts', 'utf8');
  it('does not toast or queue a record that belongs to another restaurant', () => {
    expect(store).toMatch(/if \(isForeignRecordError\(e\)\) \{\s*const target = parseSaveLabel\(label\);/);
    expect(store).toContain("if (!isForeignRecordError(e)) enqueueDeferredOp(col, id, 'set');");
  });
  it('skips set-aside records on the live path and in the retry queue, and sets one aside when the queue meets it', () => {
    expect((store.match(/isSetAside\(col, id\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(store).toMatch(/if \(isForeignRecordError\(e\)\) \{ setAside\(col, id,/);
  });
  it('the waiting-orders poll stops asking after a permission refusal', () => {
    const c = readFileSync('src/components/OrdersWaitingElsewhere.tsx', 'utf8');
    expect(c).toContain('denied.current = true');
    expect(c).toContain('if (denied.current) return;');
  });
});
