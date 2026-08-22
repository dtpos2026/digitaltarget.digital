import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// DT POS — Subscription Packages (Super Admin defined)
// Stored at top-level Firestore collection: adminPackages/{id}
// Owner sees these implicitly through invoices; only Super Admin manages them.

import { fbDb } from '@/lib/firebase';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
  query, orderBy,
} from 'firebase/firestore';

export interface AdminPackage {
  id: string;
  name: string;             // e.g. "Starter 6 Months"
  setupFeeRs: number;       // one-time setup fee
  monthlyRs: number;        // per-month recurring fee
  durationMonths: number;   // package length (e.g. 6)
  description?: string;
  includedFeatures?: string[]; // bullet list shown on invoice
  active: boolean;
  createdAt?: any;
}

export function packageTotal(p: { setupFeeRs: number; monthlyRs: number; durationMonths: number }): number {
  return (p.setupFeeRs || 0) + (p.monthlyRs || 0) * (p.durationMonths || 0);
}

/**
 * v1.20.0 — packages live in Supabase when the session does.
 *
 * The camelCase shape below is what the panel already renders, so the mapping
 * happens HERE rather than by renaming fields across the UI. Postgres columns
 * are snake_case; the UI keeps its own vocabulary.
 */
async function fetchPackagesSupabase(): Promise<AdminPackage[]> {
  const { listPackages } = await import('./superAdminSupabase');
  const rows = await listPackages();
  return rows.map(r => ({
    id: r.id, name: r.name,
    setupFeeRs: Number(r.setup_fee || 0),
    monthlyRs: Number(r.monthly_fee || 0),
    durationMonths: r.duration_months || 1,
    description: r.description ?? undefined,
    active: r.is_active !== false,
  }));
}

function toDbPackage(d: Partial<AdminPackage>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.id !== undefined) out.id = d.id;
  if (d.name !== undefined) out.name = d.name;
  if (d.setupFeeRs !== undefined) out.setup_fee = d.setupFeeRs;
  if (d.monthlyRs !== undefined) out.monthly_fee = d.monthlyRs;
  if (d.durationMonths !== undefined) out.duration_months = d.durationMonths;
  if (d.description !== undefined) out.description = d.description;
  if (d.active !== undefined) out.is_active = d.active;
  return out;
}

export async function fetchPackages(): Promise<AdminPackage[]> {
  if (firestoreUnavailable()) return fetchPackagesSupabase();
  const q = query(collection(fbDb(), 'adminPackages'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

export async function createPackage(data: Omit<AdminPackage, 'id' | 'createdAt'>): Promise<string> {
  if (firestoreUnavailable()) {
    const { savePackage } = await import('./superAdminSupabase');
    const saved = await savePackage(toDbPackage(data) as any);
    return saved.id;
  }
  const ref = await addDoc(collection(fbDb(), 'adminPackages'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updatePackage(id: string, data: Partial<AdminPackage>): Promise<void> {
  if (firestoreUnavailable()) {
    const { savePackage } = await import('./superAdminSupabase');
    await savePackage({ ...toDbPackage(data), id } as any);
    return;
  }
  await updateDoc(doc(fbDb(), 'adminPackages', id), data as any);
}

export async function deletePackage(id: string): Promise<void> {
  if (firestoreUnavailable()) {
    const { deletePackage: del } = await import('./superAdminSupabase');
    await del(id);
    return;
  }
  await deleteDoc(doc(fbDb(), 'adminPackages', id));
}
