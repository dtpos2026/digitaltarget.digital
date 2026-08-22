import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// Support messaging — owner ↔ Super Admin (Digital Target)
// Stored at: tenants/{tid}/support/{id}
//   { from: 'owner'|'admin', body, createdAt, read, category?, status?,
//     imageUrl?, meta?, intent?, aiGenerated?, authorEmail? }
// Internal notes: tenants/{tid}/internalNotes/{id}  (Super Admin only via rules)
import { fbDb, fbStorage } from '@/lib/firebase';
import {
  collection, addDoc, onSnapshot, query, orderBy, serverTimestamp,
  doc, updateDoc, getDocs, where, writeBatch, getDoc, collectionGroup,
} from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';

export type SupportFrom = 'owner' | 'admin';
export type SupportStatus = 'new' | 'in_progress' | 'replied' | 'fixed' | 'closed';
export type SupportCategory =
  | 'printer' | 'order' | 'report' | 'payment'
  | 'inventory' | 'feature' | 'bug' | 'general';

export interface SupportMeta {
  restaurantName?: string;
  branchName?: string;
  userName?: string;
  deviceName?: string;
  appVersion?: string;
}

export interface SupportMessage {
  id: string;
  from: SupportFrom;
  body: string;
  createdAt: any;
  read?: boolean;
  authorEmail?: string;
  category?: SupportCategory;
  status?: SupportStatus;
  imageUrl?: string;
  meta?: SupportMeta;
  intent?: 'bug' | 'feature' | 'improvement' | 'urgent' | 'question';
  aiGenerated?: boolean;
  /** Tenant ID — populated only when retrieved via collectionGroup query. */
  _tenantId?: string;
}

export interface InternalNote {
  id: string;
  body: string;
  authorEmail: string;
  assignedTo?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  expectedFixDate?: string;
  fixVersion?: string;
  createdAt: any;
}


// ===========================================================================
// v1.23.0 — Supabase support chat
//
// The Messages tab had NO Supabase path: every function went straight to
// Firestore, so on a Supabase session the tab was permanently empty. The
// table existed; nothing read or wrote it.
//
// Mapping note: Firestore used `from: 'owner' | 'admin'`; the table uses
// `direction: 'restaurant' | 'support'`. Converting here keeps every caller
// and the whole UI unchanged.
// ===========================================================================

/**
 * ===== v1.26.7 — this comment used to be wrong, and that was the bug =====
 *
 * It claimed the CHECK constraint allowed 'in' | 'out' | 'owner' | 'support'.
 * The constraint actually live on the database allowed only
 * ('in','out','inbound','outbound'), so EVERY message this function produced
 * was rejected with 23514 — both directions, text and images alike. The table
 * held zero rows: no support message had ever been stored.
 *
 * The constraint is widened in migration 20260822170000 to accept what this
 * sends. sideFromDir() below already reads both vocabularies, so historic
 * 'in'/'out' rows keep working.
 */
function dirFromSide(from: SupportFrom): 'owner' | 'support' {
  return from === 'owner' ? 'owner' : 'support';
}

function sideFromDir(direction: string): SupportFrom {
  return direction === 'support' || direction === 'out' ? 'admin' : 'owner';
}

function msgFromDb(r: any): SupportMessage {
  return {
    id: r.id,
    from: sideFromDir(r.direction),
    body: r.body,
    createdAt: r.created_at,
    // A message is "read" from the perspective of whoever did NOT send it.
    read: sideFromDir(r.direction) === 'owner' ? !!r.read_by_admin : !!r.read_by_owner,
    authorEmail: r.author_email ?? undefined,
    category: r.category ?? undefined,
    status: r.status ?? undefined,
    imageUrl: r.attachment_path ?? undefined,
    meta: r.meta ?? undefined,
    intent: r.intent ?? undefined,
    aiGenerated: !!r.ai_generated,
    _tenantId: r.tenant_id,
  };
}

export function listenSupport(tenantId: string, cb: (msgs: SupportMessage[]) => void) {
  if (firestoreUnavailable()) {
    let channel: any = null;
    let cancelled = false;
    const pull = async () => {
      try {
        const { sb } = await import('./supabase');
        const { data, error } = await sb().from('admin_support_messages')
          .select('*').eq('tenant_id', tenantId).eq('is_internal', false)
          .order('created_at', { ascending: true });
        if (error) throw error;
        cb((data ?? []).map(msgFromDb));
      } catch (e) { console.warn('[support] load failed', e); cb([]); }
    };
    void (async () => {
      await pull();
      if (cancelled) return;
      // Fetch first, then subscribe — a row-event stream cannot express the
      // messages that already exist.
      const { sb } = await import('./supabase');
      const nextChannel = sb().channel(`support:${tenantId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'admin_support_messages',
            filter: `tenant_id=eq.${tenantId}` },
          () => { void pull(); })
        .subscribe();
      if (cancelled) {
        try { sb().removeChannel(nextChannel); } catch { /* ignore */ }
        return;
      }
      channel = nextChannel;
    })();
    return () => {
      cancelled = true;
      if (!channel) return;
      void import('./supabase').then(({ sb }) => { try { sb().removeChannel(channel); } catch { /* ignore */ } });
    };
  }
  const q = query(collection(fbDb(), 'tenants', tenantId, 'support'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
  }, err => console.warn('support listen', err));
}

export async function sendSupportMessage(
  tenantId: string,
  from: SupportFrom,
  body: string,
  authorEmail?: string,
  extra?: Partial<Pick<SupportMessage, 'category' | 'imageUrl' | 'meta' | 'intent' | 'aiGenerated' | 'status'>>,
): Promise<string> {
  if (firestoreUnavailable()) {
    const { sb } = await import('./supabase');
    const { data, error } = await sb().from('admin_support_messages').insert({
      tenant_id: tenantId,
      direction: dirFromSide(from),
      body: body.trim(),
      author_email: authorEmail || null,
      status: extra?.status || (from === 'owner' ? 'new' : 'replied'),
      category: extra?.category ?? null,
      attachment_path: extra?.imageUrl ?? null,
      meta: extra?.meta ?? {},
      intent: extra?.intent ?? null,
      ai_generated: !!extra?.aiGenerated,
      is_internal: false,
    }).select('id').single();
    if (error) throw error;
    return (data as any).id;
  }
  const ref = await addDoc(collection(fbDb(), 'tenants', tenantId, 'support'), {
    from, body: body.trim(), authorEmail: authorEmail || '',
    createdAt: serverTimestamp(), read: false,
    status: extra?.status || (from === 'owner' ? 'new' : 'replied'),
    ...(extra?.category   ? { category: extra.category } : {}),
    ...(extra?.imageUrl   ? { imageUrl: extra.imageUrl } : {}),
    ...(extra?.meta       ? { meta: extra.meta } : {}),
    ...(extra?.intent     ? { intent: extra.intent } : {}),
    ...(extra?.aiGenerated? { aiGenerated: true } : {}),
  });
  return ref.id;
}

export async function setMessageStatus(
  tenantId: string, messageId: string, status: SupportStatus,
) {
  if (firestoreUnavailable()) {
    const { sb } = await import('./supabase');
    const { error } = await sb().from('admin_support_messages')
      .update({ status }).eq('id', messageId).eq('tenant_id', tenantId);
    if (error) throw error;
    return;
  }
  await updateDoc(doc(fbDb(), 'tenants', tenantId, 'support', messageId), { status });
}

export async function markRead(tenantId: string, side: SupportFrom) {
  if (firestoreUnavailable()) {
    try {
      const { sb } = await import('./supabase');
      await sb().rpc('support_mark_read', {
        p_tenant: tenantId, p_side: side === 'admin' ? 'admin' : 'owner',
      });
    } catch (e) { console.warn('[support] markRead failed', e); }
    return;
  }
  const other: SupportFrom = side === 'admin' ? 'owner' : 'admin';
  try {
    const snap = await getDocs(query(
      collection(fbDb(), 'tenants', tenantId, 'support'),
      where('from', '==', other), where('read', '==', false),
    ));
    if (snap.empty) return;
    const batch = writeBatch(fbDb());
    snap.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
  } catch (e) { console.warn('markRead', e); }
}

export async function fetchUnreadCounts(tenantIds: string[]): Promise<Record<string, number>> {
  if (firestoreUnavailable()) {
    try {
      const { sb } = await import('./supabase');
      const { data, error } = await sb().rpc('support_unread_counts');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of ((data ?? []) as any[])) counts[r.tenant_id] = r.unread;
      return counts;
    } catch (e) { console.warn('[support] unread counts failed', e); return {}; }
  }
  const out: Record<string, number> = {};
  await Promise.all(tenantIds.map(async tid => {
    try {
      const snap = await getDocs(query(
        collection(fbDb(), 'tenants', tid, 'support'),
        where('from', '==', 'owner'), where('read', '==', false),
      ));
      if (!snap.empty) out[tid] = snap.size;
    } catch {}
  }));
  return out;
}

/* -------------------- Image upload -------------------- */

// Phones produce 5-12MB photos; sending those raw over a flaky restaurant
// connection is what produced "Image upload failed: Failed to fetch".
async function shrinkForChat(file: File, maxDim = 1280, quality = 0.8): Promise<Blob> {
  if (!/^image\//.test(file.type)) return file;
  try {
    const bitmapUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('bad image'));
      i.src = bitmapUrl;
    });
    let { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    width = Math.round(width * scale); height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(bitmapUrl);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}

export async function uploadSupportImage(tenantId: string, file: File): Promise<string> {
  if (firestoreUnavailable()) {
    const { sb } = await import('./supabase');
    const safe = file.name.replace(/[^\w.\-]/g, '_').replace(/\.[^.]+$/, '') || 'image';
    const body = await shrinkForChat(file);
    const path = `${tenantId}/support/${Date.now()}-${safe}.jpg`;

    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { error } = await sb().storage.from('support-attachments')
          .upload(path, body, { upsert: true, contentType: 'image/jpeg' });
        if (!error) return path; // store the PATH; signed URLs expire
        lastErr = error;
      } catch (e) {
        lastErr = e; // network hiccup → "Failed to fetch"
      }
      await new Promise(r => setTimeout(r, 800));
    }

    // Last resort: keep the screenshot inline so the operator never loses it.
    const small = await shrinkForChat(file, 900, 0.6);
    if (small.size <= 700_000) return blobToDataUrl(small);
    throw new Error(lastErr?.message || 'Upload failed — check your connection');
  }
  const path = `support/${tenantId}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, '_')}`;
  const ref = sRef(fbStorage(), path);
  await uploadBytes(ref, file);
  return getDownloadURL(ref);
}


/**
 * Turn a stored attachment reference into something an <img> can load.
 * Legacy rows hold a full URL; new rows hold a private-bucket path.
 */
export async function resolveAttachmentUrl(ref: string): Promise<string> {
  if (!ref) return '';
  if (/^https?:\/\//i.test(ref) || ref.startsWith('data:')) return ref;
  try {
    const { sb } = await import('./supabase');
    const { data, error } = await sb().storage
      .from('support-attachments').createSignedUrl(ref, 3600);
    if (error) throw error;
    return data?.signedUrl || '';
  } catch (e) {
    console.warn('[support] attachment url failed', e);
    return '';
  }
}


/* -------------------- Internal notes (Super Admin only) -------------------- */
// Stored at /supportInternalNotes/{tid}/items/{id} (outside tenants/) so that
// tenant owners cannot read them via the owner-wide rule on tenants/{tid}/**.

export function listenInternalNotes(
  tenantId: string, cb: (notes: InternalNote[]) => void,
) {
  if (firestoreUnavailable()) {
    void (async () => {
      try {
        const { sb } = await import('./supabase');
        const { data, error } = await sb().from('admin_support_messages')
          .select('*').eq('tenant_id', tenantId).eq('is_internal', true)
          .order('created_at', { ascending: true });
        if (error) throw error;
        cb((data ?? []).map((r: any) => ({
          id: r.id, body: r.body, authorEmail: r.author_email ?? '',
          createdAt: r.created_at,
        })) as any);
      } catch (e) { console.warn('[support] notes failed', e); cb([] as any); }
    })();
    return () => {};
  }
  const q = query(
    collection(fbDb(), 'supportInternalNotes', tenantId, 'items'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
  }, err => console.warn('internalNotes', err));
}

export async function addInternalNote(
  tenantId: string,
  note: Omit<InternalNote, 'id' | 'createdAt'>,
) {
  if (firestoreUnavailable()) {
    const { sb } = await import('./supabase');
    // is_internal = true: the restaurant's own RLS policy filters these out,
    // so a support note can never be shown to the customer.
    const { error } = await sb().from('admin_support_messages').insert({
      tenant_id: tenantId, direction: 'support',
      body: String((note as any).body ?? '').trim(),
      author_email: (note as any).authorEmail || null, is_internal: true,
    });
    if (error) throw error;
    return;
  }
  await addDoc(collection(fbDb(), 'supportInternalNotes', tenantId, 'items'), {
    ...note, createdAt: serverTimestamp(),
  });
}

/* -------------------- Global inbox (collectionGroup) -------------------- */

export function listenGlobalSupportInbox(cb: (msgs: SupportMessage[]) => void) {
  if (firestoreUnavailable()) {
    let channel: any = null;
    const pull = async () => {
      try {
        const { sb } = await import('./supabase');
        // RLS gives a super admin every tenant; a restaurant gets only its own.
        const { data, error } = await sb().from('admin_support_messages')
          .select('*').order('created_at', { ascending: false }).limit(300);
        if (error) throw error;
        cb((data ?? []).map(msgFromDb));
      } catch (e) { console.warn('[support] inbox failed', e); cb([]); }
    };
    void (async () => {
      await pull();
      const { sb } = await import('./supabase');
      channel = sb().channel('support:inbox')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'admin_support_messages' },
          () => { void pull(); })
        .subscribe();
    })();
    return () => {
      if (!channel) return;
      void import('./supabase').then(({ sb }) => { try { sb().removeChannel(channel); } catch { /* ignore */ } });
    };
  }
  // Super Admin only — gets all support messages across tenants.
  const q = query(
    collectionGroup(fbDb(), 'support'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => {
      const tid = d.ref.parent.parent?.id;
      return { id: d.id, _tenantId: tid, ...(d.data() as any) };
    }));
  }, err => console.warn('globalInbox', err));
}

/* -------------------- WhatsApp helpers -------------------- */

export function waLink(phone: string, message: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '');
  let p = digits;
  if (p.startsWith('0')) p = '92' + p.slice(1);
  else if (!p.startsWith('92') && p.length === 10) p = '92' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

export async function fetchTenantPhone(tenantId: string): Promise<string> {
  if (firestoreUnavailable()) {
    try {
      const { sb } = await import('./supabase');
      const { data } = await sb().from('branches')
        .select('phone').eq('tenant_id', tenantId).not('phone','is',null).limit(1).maybeSingle();
      return (data as any)?.phone || '';
    } catch { return ''; }
  }
  if (firestoreUnavailable()) return legacyRead([] as any, 'support');
  try {
    const s = await getDoc(doc(fbDb(), 'tenants', tenantId, 'meta', 'settings'));
    if (s.exists()) {
      const d: any = s.data();
      return d.phone1 || d.phone || d.contactPhone || '';
    }
  } catch {}
  return '';
}
