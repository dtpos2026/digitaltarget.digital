// What Digital Target prints on its own invoices besides the invoice itself: where to pay, and the terms.
// Stored the way the signature image already is (localStorage under a `dt-admin-` key, mirrored to the cloud
// by cloudDocs.mirrorValue), edited in Super Admin → Branding. Nothing here is hard-coded: bank details are
// the owner's to enter, and an invoice without them simply has no "Payment details" block.
import type { Invoice } from '@/lib/billing';

export const INVOICE_PROFILE_KEY = 'dt-admin-invoice-profile';

export interface InvoiceProfile {
  accountTitle: string;
  bank: string;
  accountNo: string;
  /** One term per entry, printed as a numbered list. Empty lines are dropped. */
  terms: string[];
}

export const DEFAULT_INVOICE_PROFILE: InvoiceProfile = {
  accountTitle: '', bank: '', accountNo: '',
  terms: ['Payment is due within 7 days of the invoice date.'],
};

const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function sanitizeInvoiceProfile(raw: unknown): InvoiceProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const terms = Array.isArray(r.terms) ? r.terms.map(t => str(t, 240)).filter(Boolean).slice(0, 8) : DEFAULT_INVOICE_PROFILE.terms;
  return { accountTitle: str(r.accountTitle), bank: str(r.bank), accountNo: str(r.accountNo, 60), terms };
}

export function getInvoiceProfile(): InvoiceProfile {
  try {
    const raw = localStorage.getItem(INVOICE_PROFILE_KEY);
    return raw ? sanitizeInvoiceProfile(JSON.parse(raw)) : DEFAULT_INVOICE_PROFILE;
  } catch { return DEFAULT_INVOICE_PROFILE; }
}

export function saveInvoiceProfile(p: InvoiceProfile): InvoiceProfile {
  const clean = sanitizeInvoiceProfile(p);
  const json = JSON.stringify(clean);
  localStorage.setItem(INVOICE_PROFILE_KEY, json);
  void import('@/lib/cloudDocs').then(m => m.mirrorValue(INVOICE_PROFILE_KEY, json)).catch(() => {});
  return clean;
}

export const hasPaymentDetails = (p: InvoiceProfile) => !!(p.accountTitle || p.bank || p.accountNo);

/**
 * Paid and balance as the invoice screen shows them. `paidAmount` is what was recorded; a paid invoice with no
 * recorded amount is treated as paid in full, an unpaid one as nothing paid. The balance never goes below zero.
 */
export function invoiceAmounts(inv: Pick<Invoice, 'total' | 'status' | 'paidAmount'>) {
  const total = Math.max(0, Number(inv.total) || 0);
  const recorded = Number(inv.paidAmount);
  const paid = Number.isFinite(recorded) && recorded > 0 ? recorded : inv.status === 'paid' ? total : 0;
  return { total, paid, balance: Math.max(0, total - paid) };
}

export type InvoiceBadge = { label: string; fg: string; bg: string };

/** The status pill. `sent` means sent but not paid, which is what a customer calls unpaid. */
export function invoiceBadge(inv: Pick<Invoice, 'total' | 'status' | 'paidAmount'>): InvoiceBadge {
  const { paid, balance } = invoiceAmounts(inv);
  if (inv.status === 'cancelled') return { label: 'Cancelled', fg: '#475569', bg: '#e2e8f0' };
  if (inv.status === 'draft') return { label: 'Draft', fg: '#475569', bg: '#e2e8f0' };
  if (balance === 0 && inv.status === 'paid') return { label: 'Paid', fg: '#15803d', bg: '#ffffff' };
  if (inv.status === 'overdue') return { label: 'Overdue', fg: '#b91c1c', bg: '#ffffff' };
  if (paid > 0 && balance > 0) return { label: 'Partial', fg: '#b45309', bg: '#ffffff' };
  return { label: 'Unpaid', fg: '#dc2626', bg: '#ffffff' };
}
