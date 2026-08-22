import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// DT POS — Marketing Contacts (manually added by Super Admin)
// For Digital Target marketing campaigns — separate from approved restaurants.
// Stored at top-level Firestore collection: marketingContacts/{id}

import { fbDb } from '@/lib/firebase';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
  query, orderBy,
} from 'firebase/firestore';

export interface MarketingContact {
  id: string;
  name: string;             // contact person / sales lead name
  ownerName?: string;       // restaurant owner (purchaser) — appears on invoice
  phone: string;
  city: string;
  restaurantName: string;
  address?: string;
  notes?: string;
  source?: string;          // "Facebook Ads" | "Walk-in" | "Referral" | …
  linkedTenantId?: string;  // approved restaurant tenant linked to this contact
  linkedDeviceIds?: string[]; // approved device ids selected for this contact
  createdAt?: any;
}

// v1.20.0 — the panel keeps its camelCase shape; snake_case stays in here.
// The column names below are the ones admin_marketing_contacts actually has:
// an earlier mapping invented `business` and `stage`, which is why saving a
// contact failed with "Could not find the 'business' column".
function contactFromDb(r: any): MarketingContact {
  return {
    id: r.id, name: r.name ?? '', phone: r.phone ?? '', city: r.city ?? '',
    restaurantName: r.restaurant_name ?? '', notes: r.notes ?? '',
    ownerName: r.owner_name ?? undefined, address: r.address ?? undefined,
    linkedDeviceIds: Array.isArray(r.linked_device_ids) ? r.linked_device_ids : undefined,
    source: r.source ?? undefined, linkedTenantId: r.linked_tenant_id ?? undefined,
  };
}
function contactToDb(d: Partial<MarketingContact>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: d.name ?? null, phone: d.phone ?? null, city: d.city ?? null,
    restaurant_name: d.restaurantName ?? null, notes: d.notes ?? null,
    owner_name: d.ownerName ?? null, address: d.address ?? null,
    source: d.source ?? null,
  };
  if (d.linkedTenantId) row['linked_tenant_id'] = d.linkedTenantId;
  if (Array.isArray(d.linkedDeviceIds)) row['linked_device_ids'] = d.linkedDeviceIds;
  return row;
}



export async function fetchContacts(): Promise<MarketingContact[]> {
  if (firestoreUnavailable()) {
    const { listMarketingContacts } = await import('./superAdminSupabase');
    return (await listMarketingContacts()).map(contactFromDb);
  }
  const q = query(collection(fbDb(), 'marketingContacts'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}

export async function createContact(data: Omit<MarketingContact, 'id' | 'createdAt'>): Promise<string> {
  // This write is what reported "Missing or insufficient permissions" when a
  // client was added: a Supabase session has no Firebase identity at all.
  if (firestoreUnavailable()) {
    const { saveMarketingContact } = await import('./superAdminSupabase');
    const saved: any = await saveMarketingContact(contactToDb(data));
    return saved?.id ?? '';
  }
  const ref = await addDoc(collection(fbDb(), 'marketingContacts'), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateContact(id: string, data: Partial<MarketingContact>): Promise<void> {
  if (firestoreUnavailable()) {
    const { saveMarketingContact } = await import('./superAdminSupabase');
    await saveMarketingContact({ id, ...contactToDb(data) });
    return;
  }
  await updateDoc(doc(fbDb(), 'marketingContacts', id), data as any);
}

export async function deleteContact(id: string): Promise<void> {
  if (firestoreUnavailable()) {
    const { deleteMarketingContact } = await import('./superAdminSupabase');
    await deleteMarketingContact(id);
    return;
  }
  await deleteDoc(doc(fbDb(), 'marketingContacts', id));
}

export const CONTACT_SOURCES = [
  'Facebook Ads', 'Instagram', 'WhatsApp', 'Walk-in', 'Referral', 'Cold Call', 'Other',
] as const;
