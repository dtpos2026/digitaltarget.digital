// ============================================================
// Tests — v1.13.0 Data integrity
//
// Locks the root-cause fixes for two field-reported bugs:
//   "menu list shuffles when I click an item"
//   "the same menu number appears 3-4 times"
//
// The critical property is that ordering must be a TOTAL order: given the
// same rows in ANY source order, the displayed order must be identical.
// That is what makes a snapshot flush unable to reshuffle the grid.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  dedupeById, compareForDisplay, normalizeForDisplay,
  inspectCollection, stableKey,
} from '@/lib/dataIntegrity';

const item = (id: string, name: string, sortOrder?: number, _updatedAt?: number) =>
  ({ id, name, sortOrder, _updatedAt });

describe('deterministic ordering — the "list shuffles" bug', () => {
  it('rows sharing sortOrder AND name still get a stable order', () => {
    // Before the id tiebreak these compared equal, so their order was
    // whatever the source array happened to be that render.
    const a = item('id-b', 'Coke', 1);
    const b = item('id-a', 'Coke', 1);
    expect(compareForDisplay(a, b)).toBeGreaterThan(0);
    expect(compareForDisplay(b, a)).toBeLessThan(0);
    expect(compareForDisplay(a, a)).toBe(0);
  });

  it('SOURCE ORDER CANNOT CHANGE THE RESULT — the core guarantee', () => {
    const rows = [
      item('i3', 'Coke', 1), item('i1', 'Coke', 1),
      item('i2', 'Pepsi', 1), item('i4', 'Water'),
    ];
    const forwards = normalizeForDisplay(rows).map(r => r.id);
    const backwards = normalizeForDisplay([...rows].reverse()).map(r => r.id);
    const shuffled = normalizeForDisplay([rows[2], rows[0], rows[3], rows[1]]).map(r => r.id);
    expect(backwards).toEqual(forwards);
    expect(shuffled).toEqual(forwards);
  });

  it('repeated snapshot merges never change the rendered order', () => {
    // Simulates the real failure: the array is rebuilt in a different
    // order on each flush, and the UI re-reads it after every tap.
    const rows = [item('a', 'Tea', 2), item('b', 'Tea', 2), item('c', 'Rice', 1)];
    const first = normalizeForDisplay(rows).map(r => r.id);
    for (let flush = 0; flush < 20; flush++) {
      const churned = [...rows].sort(() => Math.random() - 0.5);
      expect(normalizeForDisplay(churned).map(r => r.id)).toEqual(first);
    }
  });

  it('manual sortOrder still wins over the name', () => {
    const out = normalizeForDisplay([
      item('a', 'Apple', 3), item('b', 'Zebra', 1), item('c', 'Mango', 2),
    ]).map(r => r.name);
    expect(out).toEqual(['Zebra', 'Mango', 'Apple']);
  });

  it('rows never arranged fall to the end, alphabetically', () => {
    const out = normalizeForDisplay([
      item('a', 'Zebra'), item('b', 'Apple'), item('c', 'Ordered', 1),
    ]).map(r => r.name);
    expect(out).toEqual(['Ordered', 'Apple', 'Zebra']);
  });
});

describe('dedupe — the "same item appears 3-4 times" bug', () => {
  it('two rows with the same id collapse to one', () => {
    const out = dedupeById([item('x', 'Biryani'), item('x', 'Biryani')]);
    expect(out).toHaveLength(1);
  });

  it('the FRESHER copy survives, never the stale one', () => {
    const stale = item('x', 'Old Name', 1, 1000);
    const fresh = item('x', 'New Name', 1, 2000);
    expect(dedupeById([stale, fresh])[0].name).toBe('New Name');
    expect(dedupeById([fresh, stale])[0].name).toBe('New Name');   // order-independent
  });

  it('rows with NO id collapse on their name instead of multiplying', () => {
    const rows = [
      { name: 'Chicken Karahi' },
      { name: 'Chicken Karahi' },
      { name: 'chicken karahi' },     // casing must not create a third
    ];
    expect(dedupeById(rows as any)).toHaveLength(1);
  });

  it('genuinely different items are never merged away', () => {
    const out = dedupeById([item('a', 'Kopi'), item('b', 'Kopi O'), item('c', 'Teh')]);
    expect(out).toHaveLength(3);
  });

  it('an id-less row keeps a stable key across renders', () => {
    const row = { name: 'Roti' };
    expect(stableKey(row, 0)).toBe(stableKey(row, 5));
  });

  it('deduping is idempotent — running it twice changes nothing', () => {
    const rows = [item('x', 'A'), item('x', 'A'), item('y', 'B')];
    const once = dedupeById(rows);
    expect(dedupeById(once)).toEqual(once);
  });

  it('a clean list is returned untouched', () => {
    const rows = [item('a', 'A'), item('b', 'B'), item('c', 'C')];
    expect(dedupeById(rows)).toHaveLength(3);
  });
});

describe('integrity diagnostics — so a restaurant can see its OWN data', () => {
  it('reports duplicate ids as the serious case', () => {
    const r = inspectCollection('menuItems', [
      item('dup', 'Karahi'), item('dup', 'Karahi'), item('ok', 'Rice'),
    ]);
    expect(r.ok).toBe(false);
    expect(r.duplicateIds).toHaveLength(1);
    expect(r.duplicateIds[0].count).toBe(2);
  });

  it('counts rows that never got an id', () => {
    const r = inspectCollection('menuItems', [{ name: 'Orphan' } as any, item('ok', 'Rice')]);
    expect(r.missingIds).toBe(1);
    expect(r.ok).toBe(false);
  });

  it('flags same-name-different-id separately (often intentional)', () => {
    const r = inspectCollection('menuItems', [item('a', 'Coke'), item('b', 'Coke')]);
    expect(r.duplicateIds).toHaveLength(0);   // ids are fine
    expect(r.duplicateNames).toHaveLength(1); // but worth a human look
    expect(r.ok).toBe(true);                  // not a data corruption
  });

  it('a healthy collection reports ok', () => {
    const r = inspectCollection('menuItems', [item('a', 'A'), item('b', 'B')]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(2);
  });

  it('an empty collection is valid, not an error', () => {
    expect(inspectCollection('menuItems', []).ok).toBe(true);
  });
});

describe('stress — large menus stay correct and stable', () => {
  it('500 items with heavy name collisions order identically every time', () => {
    const rows = Array.from({ length: 500 }, (_, i) =>
      item(`id-${String(i).padStart(3, '0')}`, `Item ${i % 20}`, undefined),
    );
    const baseline = normalizeForDisplay(rows).map(r => r.id);
    for (let i = 0; i < 10; i++) {
      const churned = [...rows].sort(() => Math.random() - 0.5);
      expect(normalizeForDisplay(churned).map(r => r.id)).toEqual(baseline);
    }
    expect(new Set(baseline).size).toBe(500);   // nothing lost, nothing doubled
  });

  it('a menu that is half duplicates renders each item exactly once', () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, i) => item(`id-${i}`, `Dish ${i}`)),
      ...Array.from({ length: 50 }, (_, i) => item(`id-${i}`, `Dish ${i}`)),
    ];
    const out = normalizeForDisplay(rows);
    expect(out).toHaveLength(50);
    expect(new Set(out.map(r => r.id)).size).toBe(50);
  });
});
