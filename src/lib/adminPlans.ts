import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// DT POS — Subscription Plans (Super Admin defined)
// Different from Packages: Plans = device-tier monthly/yearly tiers.
// Stored at top-level Firestore collection: adminPlans/{id}

import { fbDb } from '@/lib/firebase';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
  query, orderBy,
} from 'firebase/firestore';

export interface AdminPlan {
  id: string;
  name: string;             // e.g. "Basic" / "Starter" / "Pro" / "Enterprise"
  maxDevices: number;       // 0 = unlimited
  monthlyRs: number;
  yearlyRs: number;
  features?: string[];
  active: boolean;
  createdAt?: any;
}

// v1.20.0 — Supabase mapping. The panel's camelCase shape is preserved so no
// UI code changes; snake_case stays inside this boundary.
async function fetchPlansSupabase(): Promise<AdminPlan[]> {
  const { listPlans } = await import('./superAdminSupabase');
  const rows = await listPlans();
  return rows.map(r => ({
    id: r.id, name: r.name,
    maxDevices: r.device_limit ?? 0,
    monthlyRs: Number(r.price || 0),
    yearlyRs: Number((r.features as any)?.yearlyRs ?? 0),
    features: ((r.features as any)?.list as string[]) ?? [],
    active: r.is_active !== false,
  }));
}

function toDbPlan(d: Partial<AdminPlan>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.id !== undefined) out.id = d.id;
  if (d.name !== undefined) {
    out.name = d.name;
    // `code` is unique and required; derive it from the name when absent.
    out.code = String(d.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  if (d.maxDevices !== undefined) out.device_limit = d.maxDevices;
  if (d.monthlyRs !== undefined) out.price = d.monthlyRs;
  if (d.active !== undefined) out.is_active = d.active;
  if (d.yearlyRs !== undefined || d.features !== undefined) {
    out.features = { yearlyRs: d.yearlyRs ?? 0, list: d.features ?? [] };
  }
  return out;
}

export async function fetchAdminPlans(): Promise<AdminPlan[]> {
  if (firestoreUnavailable()) return fetchPlansSupabase();
  const q = query(collection(fbDb(), 'adminPlans'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

export async function createAdminPlan(data: Omit<AdminPlan, 'id' | 'createdAt'>): Promise<string> {
  if (firestoreUnavailable()) {
    const { savePlan } = await import('./superAdminSupabase');
    const saved = await savePlan(toDbPlan(data) as any);
    return saved.id;
  }
  const ref = await addDoc(collection(fbDb(), 'adminPlans'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateAdminPlan(id: string, data: Partial<AdminPlan>): Promise<void> {
  if (firestoreUnavailable()) {
    const { savePlan } = await import('./superAdminSupabase');
    await savePlan({ ...toDbPlan(data), id } as any);
    return;
  }
  await updateDoc(doc(fbDb(), 'adminPlans', id), data as any);
}

export async function deleteAdminPlan(id: string): Promise<void> {
  if (firestoreUnavailable()) {
    const { deletePlan } = await import('./superAdminSupabase');
    await deletePlan(id);
    return;
  }
  await deleteDoc(doc(fbDb(), 'adminPlans', id));
}
