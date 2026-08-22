// Unified local persistent DB (offline-first).
//
// - In Electron: reads/writes the JSON file at AppData/Roaming/DT POS Enterprise
//   through the existing dbRead/dbWrite IPC bridge (see electron.ts).
// - In Web: uses IndexedDB via a small hand-rolled wrapper (no dep).
//
// Same API in both places:
//     await localDb.putRow('orders', row)
//     await localDb.getRows('orders')
//     await localDb.deleteRow('orders', id)
//     await localDb.enqueueSync({type,payload})
//     await localDb.readQueue() / clearQueue(ids)
//
// Every row/queue item is namespaced by the current tenant so different
// restaurants' data can never mix inside a single install.

import { isElectron, dbRead, dbWrite } from './electron';
import { getTenantId } from './tenant';

export type Collection =
  | 'orders' | 'runningBills' | 'retrieveBills'
  | 'syncQueue' | 'printQueue' | 'deferredOps' | 'deferredOpsDeadLetter'
  | 'praQueue' | 'praLogs'
  | 'products' | 'categories' | 'tables'
  | 'printers' | 'settings' | 'usersCache';

interface Row { id: string; [k: string]: any }

// ---------------- Electron JSON DB ----------------
async function electronRead(): Promise<Record<string, any>> {
  try {
    const raw = await dbRead();
    if (!raw) return {};
    const j = JSON.parse(raw);
    return (j && typeof j === 'object') ? j : {};
  } catch { return {}; }
}
async function electronWrite(obj: Record<string, any>): Promise<void> {
  try { await dbWrite(JSON.stringify(obj)); } catch { /* ignore */ }
}
function electronPath(tid: string, col: Collection): string { return `${tid}::${col}`; }

// ---------------- IndexedDB (web) ------------------
const IDB_NAME = 'dt-pos-local';
const IDB_STORE = 'kv';
let _idbPromise: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idbPromise;
}
async function idbGet<T = any>(k: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const rq = tx.objectStore(IDB_STORE).get(k);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbSet(k: string, v: any): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
function idbKey(tid: string, col: Collection): string { return `${tid}::${col}`; }

// ---------------- Public API ----------------
function tid(): string {
  const t = getTenantId();
  if (!t) throw new Error('localDb: tenant not set');
  return t;
}

async function readCol<T extends Row = Row>(col: Collection): Promise<T[]> {
  const t = tid();
  if (isElectron()) {
    const all = await electronRead();
    const arr = all[electronPath(t, col)];
    return Array.isArray(arr) ? arr as T[] : [];
  } else {
    const arr = await idbGet<T[]>(idbKey(t, col));
    return Array.isArray(arr) ? arr : [];
  }
}
async function writeCol<T extends Row = Row>(col: Collection, rows: T[]): Promise<void> {
  const t = tid();
  if (isElectron()) {
    const all = await electronRead();
    all[electronPath(t, col)] = rows;
    await electronWrite(all);
  } else {
    await idbSet(idbKey(t, col), rows);
  }
}

export const localDb = {
  async getRows<T extends Row = Row>(col: Collection): Promise<T[]> {
    try { return await readCol<T>(col); } catch { return []; }
  },
  async putRow<T extends Row = Row>(col: Collection, row: T): Promise<void> {
    if (!row?.id) row = { ...(row as any), id: `L-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const rows = await readCol<T>(col);
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row; else rows.push(row);
    await writeCol(col, rows);
  },
  async deleteRow(col: Collection, id: string): Promise<void> {
    const rows = await readCol(col);
    await writeCol(col, rows.filter((r) => r.id !== id));
  },
  async clear(col: Collection): Promise<void> {
    await writeCol(col, []);
  },
  async enqueueSync(item: { type: 'order'|'payment'|'table'|'printLog'; payload: any; localId?: string }): Promise<void> {
    const q = await readCol('syncQueue');
    q.push({
      id: `Q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      attempts: 0,
      ...item,
    } as any);
    await writeCol('syncQueue', q);
  },
  async enqueuePrint(item: { kind: 'kot'|'receipt'; orderId: string; printerName?: string; html?: string }): Promise<void> {
    const q = await readCol('printQueue');
    q.push({
      id: `P-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      attempts: 0,
      ...item,
    } as any);
    await writeCol('printQueue', q);
  },
  async readQueue(): Promise<any[]> { return readCol('syncQueue'); },
  async readPrintQueue(): Promise<any[]> { return readCol('printQueue'); },
  async removeQueueIds(ids: string[]): Promise<void> {
    const s = new Set(ids);
    await writeCol('syncQueue', (await readCol('syncQueue')).filter((r) => !s.has(r.id)));
  },
  async removePrintIds(ids: string[]): Promise<void> {
    const s = new Set(ids);
    await writeCol('printQueue', (await readCol('printQueue')).filter((r) => !s.has(r.id)));
  },
  /** Export ALL tenants (Electron: full file). Used by backup UI. */
  async exportAll(): Promise<string> {
    if (isElectron()) return JSON.stringify(await electronRead(), null, 2);
    // Web fallback: only current tenant.
    const t = getTenantId();
    if (!t) return '{}';
    const out: Record<string, any> = {};
    const cols: Collection[] = ['orders','runningBills','retrieveBills','syncQueue','printQueue','products','categories','tables','printers','settings','usersCache','deferredOps','deferredOpsDeadLetter','praQueue','praLogs'];
    for (const c of cols) out[`${t}::${c}`] = (await idbGet(idbKey(t, c))) || [];
    return JSON.stringify(out, null, 2);
  },
  async importAll(json: string): Promise<void> {
    const obj = JSON.parse(json);
    if (isElectron()) { await electronWrite(obj); return; }
    for (const k of Object.keys(obj)) await idbSet(k, obj[k]);
  },
};

// Local bill-number sequence (offline). Uses deviceId to avoid collisions.
export async function nextLocalBillNumber(deviceId: string): Promise<string> {
  const key: Collection = 'settings';
  const rows = await localDb.getRows(key);
  const seqRow = rows.find((r) => r.id === '__local_bill_seq__') || { id: '__local_bill_seq__', seq: 0, day: '' } as any;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (seqRow.day !== today) { seqRow.seq = 0; seqRow.day = today; }
  seqRow.seq = (seqRow.seq || 0) + 1;
  await localDb.putRow(key, seqRow);
  const short = (deviceId || 'DEV').slice(-4).toUpperCase();
  return `LOCAL-${short}-${today}-${String(seqRow.seq).padStart(4, '0')}`;
}
