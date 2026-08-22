import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// DT POS — Client billing helpers (Super Admin side)
// Invoices + payments stored per-tenant under tenants/{tid}/invoices and /payments.
// Plan expiry stored on userIndex/{tid}.planExpiryAt (Timestamp).

import { fbDb } from '@/lib/firebase';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp,
  query, orderBy, Timestamp, setDoc,
} from 'firebase/firestore';
import { getPlan } from '@/lib/plans';
import { BILLING_CACHE_TTL_MS } from '@/lib/featureFlags';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice {
  id: string;
  number: string;          // INV-2026-0001
  issuedAt: any;           // Timestamp
  dueAt?: any;             // Timestamp
  periodStart?: string;    // ISO date
  periodEnd?: string;      // ISO date
  planId: string;
  months: number;
  amount: number;
  discount?: number;
  tax?: number;
  total: number;
  status: InvoiceStatus;
  notes?: string;
  paidAmount?: number;
  paidAt?: any;
  // Package fields (optional — set when invoice generated from a package)
  packageId?: string;
  packageName?: string;
  setupFee?: number;
  monthlyFee?: number;
  includedFeatures?: string[];
  // Client snapshot (frozen at invoice time)
  clientPhone?: string;
  clientAddress?: string;
  approvedDevices?: number;
  // Owner / marketing contact snapshot (frozen at invoice time)
  contactId?: string;
  ownerName?: string;
  contactName?: string;
}

export interface Payment {
  id: string;
  paidAt: any;
  amount: number;
  method: 'cash' | 'bank' | 'jazzcash' | 'easypaisa' | 'card' | 'other';
  months: number;          // months added to plan
  invoiceId?: string;
  invoiceNumber?: string;
  notes?: string;
  receivedBy?: string;
}

// ---------- Plan expiry ----------
export function tsToDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts?.toDate === 'function') return ts.toDate();
  if (typeof ts === 'number') return new Date(ts);
  if (typeof ts === 'string') return new Date(ts);
  if (ts?.seconds) return new Date(ts.seconds * 1000);
  return null;
}

export function daysUntil(ts: any): number | null {
  const d = tsToDate(ts);
  if (!d) return null;
  const diff = d.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function isExpired(ts: any): boolean {
  const d = tsToDate(ts);
  if (!d) return false;
  return d.getTime() < Date.now();
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ---------- Fetch ----------
// ---------- Phase 1: 24h TTL cache (additive) ----------
// Cache keys are scoped by tenantId so a Super Admin switching between
// tenants never sees another tenant's data. Cache is a thin wrapper
// around localStorage; if anything fails we silently fall through to
// the original Firestore fetch below.
const INV_CACHE_KEY  = (tid: string) => `dtpos-billing-cache-invoices-${tid}`;
const PAY_CACHE_KEY  = (tid: string) => `dtpos-billing-cache-payments-${tid}`;
function readBillingCache<T>(key: string): T[] | null {
  if (!BILLING_CACHE_TTL_MS) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; data: T[] };
    if (!parsed || typeof parsed.t !== 'number' || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.t > BILLING_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch { return null; }
}
function writeBillingCache<T>(key: string, data: T[]) {
  if (!BILLING_CACHE_TTL_MS) return;
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
}
function invalidateBillingCache(tenantId: string) {
  try {
    localStorage.removeItem(INV_CACHE_KEY(tenantId));
    localStorage.removeItem(PAY_CACHE_KEY(tenantId));
  } catch {}
}

// ===== v1.20.0 — billing on Supabase =====
// This is the "Reports & Ledger / Revenue / Collection empty" report and the
// "Missing or insufficient permissions" on every save: these records lived in
// Firestore, where a Supabase-authenticated Super Admin is a stranger.
//
// The camelCase Invoice/Payment shapes below are what the panel renders, so
// the snake_case mapping stays inside this file.
function invFromDb(r: any): Invoice {
  return {
    id: r.id, tenantId: r.tenant_id, number: r.number,
    issuedAt: r.issued_at, dueAt: r.due_at,
    amount: Number(r.subtotal || 0), tax: Number(r.tax || 0),
    total: Number(r.total || 0), paidTotal: Number(r.paid_total || 0),
    status: r.status, notes: r.notes,
    // The original create payload is kept in line_items[0]; spreading it back
    // restores plan id, package name and the other panel-only fields without
    // needing a column for each.
    ...(r.line_items?.[0] ?? {}),
  } as unknown as Invoice;
}

function payFromDb(r: any): Payment {
  return {
    id: r.id, tenantId: r.tenant_id, invoiceId: r.invoice_id,
    amount: Number(r.amount || 0), method: r.method,
    reference: r.reference, paidAt: r.received_at, notes: r.notes,
    // `months` is required on Payment but has no column: it belongs to the
    // invoice's plan period, not to the money received. Default rather than
    // widen the type, so the panel keeps rendering.
    months: 0,
  } as unknown as Payment;
}

export async function fetchInvoices(tenantId: string): Promise<Invoice[]> {
  if (firestoreUnavailable()) {
    const { listInvoices } = await import('./superAdminSupabase');
    return (await listInvoices(tenantId)).map(invFromDb);
  }
  const cached = readBillingCache<Invoice>(INV_CACHE_KEY(tenantId));
  if (cached) return cached;
  const q = query(collection(fbDb(), 'tenants', tenantId, 'invoices'), orderBy('issuedAt', 'desc'));
  const snap = await getDocs(q);
  const out = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Invoice[];
  writeBillingCache(INV_CACHE_KEY(tenantId), out);
  return out;
}

export async function fetchPayments(tenantId: string): Promise<Payment[]> {
  if (firestoreUnavailable()) {
    const { listPayments } = await import('./superAdminSupabase');
    return (await listPayments(tenantId)).map(payFromDb);
  }
  const cached = readBillingCache<Payment>(PAY_CACHE_KEY(tenantId));
  if (cached) return cached;
  const q = query(collection(fbDb(), 'tenants', tenantId, 'payments'), orderBy('paidAt', 'desc'));
  const snap = await getDocs(q);
  const out = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Payment[];
  writeBillingCache(PAY_CACHE_KEY(tenantId), out);
  return out;
}

/**
 * Manually clear the billing cache for a tenant. Callers that need a
 * guaranteed-fresh read (e.g. Super Admin "Refresh" button) can invoke
 * this before calling fetchInvoices / fetchPayments. Safe to call
 * anywhere — never throws.
 */
export function clearBillingCache(tenantId: string) {
  invalidateBillingCache(tenantId);
}

// ---------- Create / update ----------
export async function createInvoiceSupabase(tenantId: string, data: any): Promise<string> {
  const { saveInvoice } = await import('./superAdminSupabase');

  // ===== v1.23.0 — apply the plan the invoice is FOR =====
  // Generating an invoice for Enterprise recorded the invoice and left
  // tenants.plan on 'trial'. The restaurant kept a Trial sidebar after being
  // billed for Enterprise, and the Super Admin saw no error — the invoice had
  // saved perfectly well. The plan is the thing the customer is paying for,
  // so it must move with the invoice.
  if (data?.planId) {
    try {
      const { setTenantPlan } = await import('./superAdminSupabase');
      await setTenantPlan(
        tenantId,
        String(data.planId),
        data.periodEnd ? new Date(data.periodEnd).toISOString() : undefined,
      );
    } catch (e) {
      console.error('[billing] plan update failed', e);
      // Surface it: silently billing for a plan that was never applied is
      // worse than failing loudly here.
      throw new Error(
        `Invoice not created: the plan could not be set to ${data.planId}. ${(e as any)?.message ?? ''}`,
      );
    }
  }
  const amount = Number(data.amount || 0);
  const tax = Number(data.tax || 0);
  const discount = Number(data.discount || 0);
  const saved = await saveInvoice({
    tenant_id: tenantId,
    number: data.number || `INV-${Date.now().toString().slice(-8)}`,
    due_at: data.dueAt ? new Date(data.dueAt).toISOString() : null,
    line_items: [data],
    subtotal: amount - discount,
    tax,
    total: amount - discount + tax,
    paid_total: 0,
    status: 'unpaid',
    notes: data.notes ?? null,
  } as any);
  return saved.id;
}

export async function createInvoice(tenantId: string, data: {
  planId: string; months: number; amount: number; discount?: number; tax?: number;
  periodStart?: string; periodEnd?: string; dueAt?: Date | null; notes?: string;
  packageId?: string; packageName?: string; setupFee?: number; monthlyFee?: number;
  includedFeatures?: string[];
  clientPhone?: string; clientAddress?: string; approvedDevices?: number;
  contactId?: string; ownerName?: string; contactName?: string;
}): Promise<string> {
  if (firestoreUnavailable()) return createInvoiceSupabase(tenantId, data);

  // Ensure invoice-number sequence uses fresh data, not cached list.
  invalidateBillingCache(tenantId);
  const all = await fetchInvoices(tenantId);
  const yr = new Date().getFullYear();
  const seq = all.filter(i => (i.number || '').includes(`INV-${yr}-`)).length + 1;
  const number = `INV-${yr}-${String(seq).padStart(4, '0')}`;
  const total = (data.amount - (data.discount || 0)) + (data.tax || 0);

  const payload: any = {
    number,
    issuedAt: serverTimestamp(),
    planId: data.planId,
    months: data.months,
    amount: data.amount,
    discount: data.discount || 0,
    tax: data.tax || 0,
    total,
    status: 'sent' as InvoiceStatus,
    notes: data.notes || '',
  };
  if (data.dueAt) payload.dueAt = Timestamp.fromDate(data.dueAt);
  if (data.periodStart) payload.periodStart = data.periodStart;
  if (data.periodEnd) payload.periodEnd = data.periodEnd;
  if (data.packageId) payload.packageId = data.packageId;
  if (data.packageName) payload.packageName = data.packageName;
  if (data.setupFee && data.setupFee > 0) payload.setupFee = data.setupFee;
  if (data.monthlyFee && data.monthlyFee > 0) payload.monthlyFee = data.monthlyFee;
  if (data.includedFeatures && data.includedFeatures.length) payload.includedFeatures = data.includedFeatures;
  if (data.clientPhone) payload.clientPhone = data.clientPhone;
  if (data.clientAddress) payload.clientAddress = data.clientAddress;
  if (data.contactId) payload.contactId = data.contactId;
  if (data.ownerName) payload.ownerName = data.ownerName;
  if (data.contactName) payload.contactName = data.contactName;
  if (typeof data.approvedDevices === 'number') payload.approvedDevices = data.approvedDevices;

  const ref = await addDoc(collection(fbDb(), 'tenants', tenantId, 'invoices'), payload);
  invalidateBillingCache(tenantId);
  return ref.id;
}

export async function deleteInvoice(tenantId: string, invoiceId: string) {
  if (firestoreUnavailable()) {
    const { deleteInvoice: del } = await import('./superAdminSupabase');
    await del(invoiceId);
    return;
  }

  await deleteDoc(doc(fbDb(), 'tenants', tenantId, 'invoices', invoiceId));
  invalidateBillingCache(tenantId);
}

export async function updateInvoice(tenantId: string, invoiceId: string, patch: Partial<Invoice>) {
  if (firestoreUnavailable()) {
    const { saveInvoice } = await import('./superAdminSupabase');
    await saveInvoice({ id: invoiceId, ...(patch as any) });
    return;
  }

  const clean: any = {};
  Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
  await updateDoc(doc(fbDb(), 'tenants', tenantId, 'invoices', invoiceId), clean);
  invalidateBillingCache(tenantId);
}

// Recompute invoice status + paidAmount from all linked payments (partial-pay aware)
async function reconcileInvoice(tenantId: string, invoiceId: string) {
  // Reconcile must see latest payments, not cached ones.
  invalidateBillingCache(tenantId);
  const allPay = await fetchPayments(tenantId);
  const paidSum = allPay
    .filter(p => p.invoiceId === invoiceId)
    .reduce((s, p) => s + (p.amount || 0), 0);
  const invDocs = await getDocs(collection(fbDb(), 'tenants', tenantId, 'invoices'));
  const inv = invDocs.docs.find(d => d.id === invoiceId);
  if (!inv) return;
  const data = inv.data() as any;
  const total = data.total || 0;
  let status: InvoiceStatus;
  if (total > 0 && paidSum >= total) status = 'paid';
  else if (paidSum > 0) status = 'sent'; // partial
  else status = data.status === 'paid' ? 'sent' : (data.status || 'sent');
  const patch: any = { paidAmount: paidSum, status };
  if (status === 'paid') patch.paidAt = serverTimestamp();
  await updateDoc(doc(fbDb(), 'tenants', tenantId, 'invoices', invoiceId), patch);
  invalidateBillingCache(tenantId);
}

export async function deletePayment(tenantId: string, paymentId: string, opts?: { invoiceId?: string }) {
  if (firestoreUnavailable()) {
    const { deletePayment: del } = await import('./superAdminSupabase');
    await del(paymentId);
    return;
  }

  await deleteDoc(doc(fbDb(), 'tenants', tenantId, 'payments', paymentId));
  invalidateBillingCache(tenantId);
  if (opts?.invoiceId) {
    try { await reconcileInvoice(tenantId, opts.invoiceId); } catch {}
  }
}

export async function recordPayment(tenantId: string, data: {
  amount: number; method: Payment['method']; months: number;
  invoice?: Invoice | null; notes?: string; receivedBy?: string;
  currentExpiry?: any; extendExpiry?: boolean;
}): Promise<void> {
  if (firestoreUnavailable()) {
    const { savePayment } = await import('./superAdminSupabase');
    // savePayment also recalculates the invoice's paid_total and status,
    // so a partial payment cannot leave the invoice showing unpaid.
    const saved = await savePayment({
      tenant_id: tenantId, invoice_id: (data as any).invoiceId ?? null,
      amount: Number((data as any).amount || 0),
      method: (data as any).method ?? null,
      reference: (data as any).reference ?? null,
      notes: (data as any).notes ?? null,
    } as any);
    void saved;   // recordPayment returns void; the id is not needed here
    return;
  }

  const payload: any = {
    paidAt: serverTimestamp(),
    amount: data.amount,
    method: data.method,
    months: data.months,
    notes: data.notes || '',
    receivedBy: data.receivedBy || '',
  };
  if (data.invoice) {
    payload.invoiceId = data.invoice.id;
    payload.invoiceNumber = data.invoice.number;
  }
  await addDoc(collection(fbDb(), 'tenants', tenantId, 'payments'), payload);
  invalidateBillingCache(tenantId);

  // Partial-payment aware status update
  if (data.invoice) {
    try { await reconcileInvoice(tenantId, data.invoice.id); } catch {}
  }

  // Extend plan expiry on userIndex
  if (data.extendExpiry !== false && data.months > 0) {
    const cur = tsToDate(data.currentExpiry);
    const base = (cur && cur.getTime() > Date.now()) ? cur : new Date();
    const newExpiry = addMonths(base, data.months);
    await updateDoc(doc(fbDb(), 'userIndex', tenantId), {
      planExpiryAt: Timestamp.fromDate(newExpiry),
      lastPaymentAt: serverTimestamp(),
    });
  }
}

export async function setPlanExpiry(tenantId: string, expiry: Date | null) {
  if (firestoreUnavailable()) {
    const { setTenantPlan } = await import('./superAdminSupabase');
    const { data: t } = await (await import('./supabase')).sb()
      .from('tenants').select('plan').eq('id', tenantId).maybeSingle();
    await setTenantPlan(tenantId, (t as any)?.plan ?? 'trial',
      expiry ? expiry.toISOString() : undefined);
    return;
  }

  await updateDoc(doc(fbDb(), 'userIndex', tenantId), {
    planExpiryAt: expiry ? Timestamp.fromDate(expiry) : null,
  });
}

// ---------- Client-side expiry cache (owner side) ----------
const EXPIRY_LS_KEY = 'pos-tenant-plan-expiry';
export function setCurrentTenantExpiry(ms: number | null | undefined) {
  try {
    if (ms && ms > 0) localStorage.setItem(EXPIRY_LS_KEY, String(ms));
    else localStorage.removeItem(EXPIRY_LS_KEY);
  } catch {}
}
export function getCurrentTenantExpiryMs(): number | null {
  try {
    const v = localStorage.getItem(EXPIRY_LS_KEY);
    return v ? parseInt(v, 10) : null;
  } catch { return null; }
}

export function formatRs(n: number): string {
  return 'Rs ' + (n || 0).toLocaleString('en-PK');
}

export function planPriceFor(planId: string, months: number): number {
  return getPlan(planId).monthlyPriceRs * months;
}
