import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// Firestore-backed "Call Waiter" / service call events from QR portal → POS device.
// Falls back gracefully if Firebase not configured (no-op).
import { isFirebaseConfigured, fbDb } from './firebase';
import { getTenantId } from './tenant';
import { collection, doc, setDoc, getDocs, deleteDoc, query, orderBy } from 'firebase/firestore';
import { sb } from './supabase';
import { authTenantId } from './authProvider';
import { createPublicWaiterCall } from './publicPortal.functions';

export interface ServiceCall {
  id: string;
  tableLabel: string;   // e.g. "Table 5"
  floorName?: string;
  message?: string;     // optional ("Need water", default "Call Waiter")
  at: string;           // ISO
  acked?: boolean;
}

function colRef() {
  if (firestoreUnavailable()) return null;
  const tid = getTenantId();
  if (!isFirebaseConfigured() || !tid) return null;
  return collection(fbDb(), 'tenants', tid, 'serviceCalls');
}

export async function addServiceCall(input: Omit<ServiceCall, 'id' | 'at' | 'acked'>): Promise<ServiceCall | null> {
  if (firestoreUnavailable()) {
    const tenantId = getTenantId();
    if (!tenantId) return null;
    const result = await createPublicWaiterCall({ data: {
      tenantId, branchId: null, tableLabel: input.tableLabel,
      floorName: input.floorName || null, message: input.message || 'Call Waiter',
    } });
    return result as unknown as ServiceCall;
  }
  const c = colRef();
  const id = `sc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // Strip undefined — Firestore rejects undefined field values and throws.
  const clean: any = { id, at: new Date().toISOString(), acked: false };
  Object.entries(input).forEach(([k, v]) => { if (v !== undefined && v !== null) clean[k] = v; });
  const sc = clean as ServiceCall;
  if (!c) {
    // Local fallback (single-device demo)
    try {
      const arr = JSON.parse(localStorage.getItem('dt-service-calls') || '[]');
      arr.push(sc);
      localStorage.setItem('dt-service-calls', JSON.stringify(arr.slice(-50)));
      window.dispatchEvent(new CustomEvent('dt-service-call', { detail: sc }));
    } catch {}
    return sc;
  }
  try {
    await setDoc(doc(c, id), sc);
    return sc;
  } catch (e) {
    console.error('addServiceCall failed', e);
    return null;
  }
}

export async function fetchServiceCalls(): Promise<ServiceCall[]> {
  if (firestoreUnavailable()) {
    const tenantId = authTenantId() || getTenantId();
    if (!tenantId) return [];
    const { data, error } = await sb().from('service_calls').select('*')
      .eq('tenant_id', tenantId).is('acknowledged_at', null)
      .order('created_at', { ascending: false }).limit(50);
    if (error) { console.error('fetchServiceCalls failed', error.message); return []; }
    return (data || []).map((row: any) => ({
      id: row.id, tableLabel: row.table_label, floorName: row.floor_name || undefined,
      message: row.message, at: row.created_at, acked: Boolean(row.acknowledged_at),
    }));
  }
  const c = colRef();
  if (!c) {
    try { return JSON.parse(localStorage.getItem('dt-service-calls') || '[]'); } catch { return []; }
  }
  try {
    const snap = await getDocs(query(c, orderBy('at', 'desc')));
    return snap.docs.map(d => d.data() as ServiceCall);
  } catch { return []; }
}

export async function ackServiceCall(id: string) {
  if (firestoreUnavailable()) {
    const { error } = await sb().from('service_calls')
      .update({ acknowledged_at: new Date().toISOString() }).eq('id', id);
    if (error) console.error('ackServiceCall failed', error.message);
    return;
  }
  const c = colRef();
  if (!c) {
    try {
      const arr: ServiceCall[] = JSON.parse(localStorage.getItem('dt-service-calls') || '[]');
      localStorage.setItem('dt-service-calls', JSON.stringify(arr.filter(x => x.id !== id)));
    } catch {}
    return;
  }
  try { await deleteDoc(doc(c, id)); } catch {}
}
