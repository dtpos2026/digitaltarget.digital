// v1.128.0 — the 403s that never stopped. Live logs, 21 Nov 2026: 86 `POST /customers -> 403` from one restaurant in seven hours.
// A customer who is also a customer of ANOTHER restaurant derives the same cloud id (it is made from the phone number), and the other
// restaurant's row refuses the update. v1.110.0 set such records aside, but only the per-record save paths asked the list; the batch
// path of the sync queue did not, so every flush sent them again.
import { describe, it, expect, beforeEach } from 'vitest';
import { isSetAside, partitionSetAside, releaseSetAside, setAside, settleBatchFailures } from '@/lib/setAside';

const FOREIGN = 'new row violates row-level security policy (USING expression) for table "customers"';

beforeEach(() => { releaseSetAside(); });

describe('the batch queue leaves set-aside records out', () => {
  it('splits a queue into what to send and what is already known not to belong here', () => {
    setAside('customers', '03451873354', 'x');
    const r = partitionSetAside('customers', ['03001112222', '03451873354', '03009998888']);
    expect(r.send).toEqual(['03001112222', '03009998888']);
    expect(r.skipped).toEqual(['03451873354']);
  });
  it('a record set aside in one collection is still sent in another', () => {
    setAside('customers', 'abc', 'x');
    expect(partitionSetAside('menuItems', ['abc']).send).toEqual(['abc']);
  });
});

describe('a refused batch settles the foreign records and keeps real failures', () => {
  it('sets aside the other restaurant\'s records and returns them as settled', () => {
    const r = settleBatchFailures('customers', [{ id: 'c1', error: FOREIGN }, { id: 'c2', error: 'Failed to fetch' }, { id: 'c3', error: FOREIGN }]);
    expect(r.settled).toEqual(['c1', 'c3']);
    expect(r.failed).toEqual([{ id: 'c2', error: 'Failed to fetch' }]);
    expect(isSetAside('customers', 'c1')).toBe(true);
    expect(isSetAside('customers', 'c3')).toBe(true);
    expect(isSetAside('customers', 'c2')).toBe(false);   // a network error is never set aside: it keeps retrying
  });
  it('after that the same record is no longer sent', () => {
    settleBatchFailures('customers', [{ id: 'c1', error: FOREIGN }]);
    expect(partitionSetAside('customers', ['c1', 'c9']).send).toEqual(['c9']);
  });
  it('an empty failure list changes nothing', () => {
    expect(settleBatchFailures('customers', [])).toEqual({ settled: [], failed: [] });
  });
});
