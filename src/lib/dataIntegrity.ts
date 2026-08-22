// ============================================================
// v1.13.0 — DATA INTEGRITY
//
// Root-cause fixes for two field-reported bugs that turned out to be
// one chain:
//
//   "menu list shuffles when I click an item"
//   "the same menu number appears 3-4 times"
//
// CAUSE 1 — non-deterministic ordering.
//   getMenuItems()/getCategories() sorted by (sortOrder, name). When two
//   rows share both, the comparator returns 0 and Array.sort leaves them
//   in SOURCE order. The source array is rebuilt on every Firestore
//   snapshot flush, so that source order changes underneath the UI —
//   producing a visible reshuffle at seemingly random moments (e.g. right
//   after a tap, because a tap writes an order and a flush follows).
//   Fix: make the comparator total by adding `id` as the final tiebreak.
//   Equal keys can then never reorder, whatever the source order is.
//
// CAUSE 2 — rows that can never be deduplicated.
//   The snapshot merge pushed any remote row lacking an `id` straight
//   into the merged array without recording it as seen, and the read
//   layer never deduplicated. A row written without an embedded id (older
//   builds, imports, console edits) therefore renders as a separate card
//   every time, and several such rows look like "the same item 3-4 times".
//   Fix: deduplicate by id at the read layer so bad data can never render
//   twice, and give id-less rows a stable synthetic key.
//
// These helpers are pure so the exact ordering/dedupe rules are testable
// without a store, a browser, or Firestore.
// ============================================================

/** Anything the store persists in an array collection. */
export interface Identified {
  id?: string;
  name?: string;
  sortOrder?: number;
  _updatedAt?: number;
}

/**
 * Stable key for a row, including rows that never got an `id`.
 * Falling back to the name keeps such rows collapsed into ONE entry
 * rather than multiplying on every snapshot.
 */
export function stableKey(row: Identified, index: number): string {
  if (row?.id) return String(row.id);
  if (row?.name) return `name:${String(row.name).trim().toLowerCase()}`;
  return `idx:${index}`;
}

/**
 * Collapse duplicate rows, newest wins.
 *
 * "Newest" is decided by `_updatedAt` so a stale copy can never overwrite
 * a fresher one — the same rule the sync merge uses, applied at read time
 * as a second line of defence.
 */
export function dedupeById<T extends Identified>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  const order: string[] = [];
  rows.forEach((row, i) => {
    const key = stableKey(row, i);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      order.push(key);
      return;
    }
    const prevT = Number(prev._updatedAt || 0);
    const curT = Number(row._updatedAt || 0);
    if (curT >= prevT) byKey.set(key, row);   // keep the fresher copy
  });
  return order.map(k => byKey.get(k)!);
}

/**
 * TOTAL ordering comparator: (sortOrder, name, id).
 *
 * The `id` tiebreak is what makes this deterministic. Without it, rows
 * sharing a sortOrder and a name are left in source order, and the source
 * order is not stable across snapshot merges.
 */
export function compareForDisplay(a: Identified, b: Identified): number {
  const ao = Number.isFinite(a?.sortOrder as number) ? (a.sortOrder as number) : 9999;
  const bo = Number.isFinite(b?.sortOrder as number) ? (b.sortOrder as number) : 9999;
  if (ao !== bo) return ao - bo;
  const an = String(a?.name ?? '');
  const bn = String(b?.name ?? '');
  const byName = an.localeCompare(bn);
  if (byName !== 0) return byName;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

/** Deduplicate then order — the exact pipeline every list read uses. */
export function normalizeForDisplay<T extends Identified>(rows: T[]): T[] {
  return dedupeById(rows).sort(compareForDisplay);
}

// ---------- diagnostics ----------

export interface DuplicateGroup {
  key: string;
  count: number;
  ids: string[];
  name?: string;
}

export interface IntegrityReport {
  collection: string;
  total: number;
  /** Rows sharing an id — the serious case. */
  duplicateIds: DuplicateGroup[];
  /** Rows with no id at all — they cannot sync or be edited reliably. */
  missingIds: number;
  /** Distinct rows sharing a name; usually intentional, shown for review. */
  duplicateNames: DuplicateGroup[];
  ok: boolean;
}

/**
 * Inspect one collection for the conditions that produce phantom
 * duplicates. Used by the Data Integrity panel so a restaurant can see
 * its OWN data rather than trusting a claim that everything is fine.
 */
export function inspectCollection(collection: string, rows: Identified[]): IntegrityReport {
  const idGroups = new Map<string, Identified[]>();
  const nameGroups = new Map<string, Identified[]>();
  let missingIds = 0;

  for (const row of rows || []) {
    if (!row?.id) missingIds++;
    else {
      const g = idGroups.get(row.id) || [];
      g.push(row);
      idGroups.set(row.id, g);
    }
    const nm = String(row?.name ?? '').trim().toLowerCase();
    if (nm) {
      const g = nameGroups.get(nm) || [];
      g.push(row);
      nameGroups.set(nm, g);
    }
  }

  const duplicateIds: DuplicateGroup[] = [];
  for (const [id, group] of idGroups) {
    if (group.length > 1) {
      duplicateIds.push({ key: id, count: group.length, ids: group.map(g => String(g.id)), name: group[0]?.name });
    }
  }

  const duplicateNames: DuplicateGroup[] = [];
  for (const [nm, group] of nameGroups) {
    const distinctIds = Array.from(new Set(group.map(g => String(g.id ?? ''))));
    if (distinctIds.length > 1) {
      duplicateNames.push({ key: nm, count: distinctIds.length, ids: distinctIds, name: group[0]?.name });
    }
  }

  return {
    collection,
    total: (rows || []).length,
    duplicateIds,
    missingIds,
    duplicateNames,
    ok: duplicateIds.length === 0 && missingIds === 0,
  };
}
