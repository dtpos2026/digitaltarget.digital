// ============================================================
// DT POS — Sync Repair & Database Integrity Inspector (v1.0.7)
// One-Click Inspection: scans local data, finds duplicates,
// validates referential integrity, and reports back.
// ============================================================
import { exportData, importData } from './store';

function loadData(): any {
  try { return JSON.parse(exportData() || '{}'); } catch { return {}; }
}
import { stampInspection, setSyncHealth, type SyncHealth } from './updateSafety';

export interface InspectionIssue {
  collection: string;
  type: 'duplicate' | 'missing-id' | 'orphan-ref' | 'corrupt';
  count: number;
  detail?: string;
}

export interface InspectionResult {
  ranAt: number;
  health: SyncHealth;
  totalRecords: number;
  issues: InspectionIssue[];
  repaired: InspectionIssue[];
  durationMs: number;
}

/** Inspect (read-only) — finds duplicates, missing IDs, broken refs. */
export function inspectDatabase(): InspectionResult {
  const t0 = Date.now();
  const data: any = loadData();
  const issues: InspectionIssue[] = [];
  let totalRecords = 0;

  const arrayKeys = Object.keys(data || {}).filter(k => Array.isArray(data[k]));
  for (const key of arrayKeys) {
    const arr = data[key] as any[];
    totalRecords += arr.length;

    // duplicate IDs
    const seen = new Set<string>();
    let dupes = 0;
    let missingIds = 0;
    let corrupt = 0;
    for (const row of arr) {
      if (!row || typeof row !== 'object') { corrupt++; continue; }
      const id = row.id;
      if (id === undefined || id === null || id === '') { missingIds++; continue; }
      if (seen.has(String(id))) dupes++;
      else seen.add(String(id));
    }
    if (dupes > 0) issues.push({ collection: key, type: 'duplicate', count: dupes });
    if (missingIds > 0) issues.push({ collection: key, type: 'missing-id', count: missingIds });
    if (corrupt > 0) issues.push({ collection: key, type: 'corrupt', count: corrupt });
  }

  // Cross-collection orphan check: orderItems → menuItems
  const menuIds = new Set((data.menuItems || []).map((m: any) => String(m.id)));
  let orphans = 0;
  for (const o of (data.orders || [])) {
    for (const it of (o.items || [])) {
      if (it.itemId && !menuIds.has(String(it.itemId))) orphans++;
    }
  }
  if (orphans > 0) issues.push({ collection: 'orders.items', type: 'orphan-ref', count: orphans, detail: 'menuItem missing' });

  let health: SyncHealth = 'healthy';
  if (issues.length > 0) health = issues.some(i => i.type === 'corrupt' || i.type === 'duplicate') ? 'error' : 'warning';

  const result: InspectionResult = {
    ranAt: Date.now(),
    health,
    totalRecords,
    issues,
    repaired: [],
    durationMs: Date.now() - t0,
  };

  setSyncHealth(health);
  stampInspection();
  return result;
}

/** Repair — removes duplicate rows (keeps first occurrence) and drops corrupt entries. */
export function repairDatabase(): InspectionResult {
  const t0 = Date.now();
  const raw = exportData();
  if (!raw) {
    const empty: InspectionResult = { ranAt: Date.now(), health: 'healthy', totalRecords: 0, issues: [], repaired: [], durationMs: 0 };
    return empty;
  }
  const data: any = JSON.parse(raw);
  const repaired: InspectionIssue[] = [];
  let totalRecords = 0;

  const arrayKeys = Object.keys(data).filter(k => Array.isArray(data[k]));
  for (const key of arrayKeys) {
    const arr = data[key] as any[];
    const seen = new Set<string>();
    const kept: any[] = [];
    let dupes = 0;
    let corrupt = 0;
    let missingIds = 0;
    for (const row of arr) {
      if (!row || typeof row !== 'object') { corrupt++; continue; }
      const id = row.id;
      if (id === undefined || id === null || id === '') {
        // assign a synthetic id
        row.id = `auto_${key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        missingIds++;
        kept.push(row);
        seen.add(String(row.id));
        continue;
      }
      if (seen.has(String(id))) { dupes++; continue; }
      seen.add(String(id));
      kept.push(row);
    }
    data[key] = kept;
    totalRecords += kept.length;
    if (dupes) repaired.push({ collection: key, type: 'duplicate', count: dupes });
    if (corrupt) repaired.push({ collection: key, type: 'corrupt', count: corrupt });
    if (missingIds) repaired.push({ collection: key, type: 'missing-id', count: missingIds, detail: 'auto-assigned ids' });
  }

  // Push repaired tenant-scoped data through the real store layer so it updates
  // the active cache and cloud collections. Old code wrote to dt_pos_data,
  // which this app no longer reads.
  importData(JSON.stringify(data));
  // After repair, re-inspect to compute remaining issues
  const after = inspectDatabase();
  return {
    ranAt: Date.now(),
    health: after.health,
    totalRecords,
    issues: after.issues,
    repaired,
    durationMs: Date.now() - t0,
  };
}
