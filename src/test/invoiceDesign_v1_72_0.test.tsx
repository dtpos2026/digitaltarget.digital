// ============================================================================
// v1.72.0 — the A4 invoice takes the reference layout
//
// REQUESTED: the Super Admin panel's invoice "like this" (the Digital Target invoice: purple header with the brand
// lockup, From / Bill to / details, a table, payment details beside the totals with Paid and Balance due, terms,
// signature, footer band).
//
// Pinned: the new money lines (Paid, Balance due) are arithmetic on figures the invoice already holds and are right
// in every state; sections with nothing to say are absent, not empty; bank details are never hard-coded (they are the
// owner's to enter); the footer is part of the layout, so a long invoice can never hide its terms and signature;
// and the preview dialog uses this one component.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mount, q } from './_dom';
import A4Invoice from '@/components/A4Invoice';
import {
  invoiceAmounts, invoiceBadge, sanitizeInvoiceProfile, getInvoiceProfile, saveInvoiceProfile,
  hasPaymentDetails, INVOICE_PROFILE_KEY, DEFAULT_INVOICE_PROFILE,
} from '@/lib/invoiceProfile';

const base: any = {
  id: 'i1', number: 'DT-INV-2026-0002', issuedAt: new Date('2026-09-29'), planId: 'pro', months: 1, amount: 4000, discount: 0,
  tax: 0, total: 4000, status: 'sent', ownerName: 'Owner', clientPhone: '0300', clientAddress: 'Street 1',
};
const noPay = { accountTitle: '', bank: '', accountNo: '', terms: [] as string[] };
const pay = { accountTitle: 'ACC TITLE', bank: 'Some Bank', accountNo: '1234 5678', terms: ['Pay in 7 days.', 'Work starts after advance.'] };
let m: ReturnType<typeof mount> | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => { m?.unmount(); m = null; });
const render = (inv: any, profile = pay) => {
  m = mount(<A4Invoice invoice={inv} restaurantName="QSR Restaurant" email="o@x.com" tenantId="64434fd6-aaaa" planName="Pro" issued="29/09/2026" profile={profile} />);
  return document.body.textContent || '';
};

describe('Paid and Balance due', () => {
  it('unpaid: nothing paid, the whole total is due', () => {
    expect(invoiceAmounts({ total: 4000, status: 'sent' } as any)).toEqual({ total: 4000, paid: 0, balance: 4000 });
  });
  it('partial: the recorded amount is paid, the rest is due', () => {
    expect(invoiceAmounts({ total: 5000, status: 'sent', paidAmount: 1500 } as any)).toEqual({ total: 5000, paid: 1500, balance: 3500 });
  });
  it('paid with no recorded amount counts as paid in full', () => {
    expect(invoiceAmounts({ total: 4000, status: 'paid' } as any)).toEqual({ total: 4000, paid: 4000, balance: 0 });
  });
  it('an overpayment never shows a negative balance', () => {
    expect(invoiceAmounts({ total: 4000, status: 'paid', paidAmount: 4500 } as any).balance).toBe(0);
  });
  it('rubbish amounts do not become NaN on the page', () => {
    const a = invoiceAmounts({ total: undefined, status: 'sent', paidAmount: 'x' } as any);
    expect(a).toEqual({ total: 0, paid: 0, balance: 0 });
  });
});

describe('the status pill', () => {
  const b = (o: any) => invoiceBadge({ total: 4000, ...o }).label;
  it('names each state the way a customer would', () => {
    expect(b({ status: 'sent' })).toBe('Unpaid');
    expect(b({ status: 'sent', paidAmount: 1000 })).toBe('Partial');
    expect(b({ status: 'paid' })).toBe('Paid');
    expect(b({ status: 'overdue' })).toBe('Overdue');
    expect(b({ status: 'draft' })).toBe('Draft');
    expect(b({ status: 'cancelled' })).toBe('Cancelled');
  });
});

describe('the invoice page', () => {
  it('has the header, the parties, the table and the money lines', () => {
    const t = render(base);
    for (const s of ['DIGITAL', 'TARGET', 'INVOICE', 'DT-INV-2026-0002', 'Unpaid', 'From', 'Bill to', 'QSR Restaurant',
      'Invoice date', 'Due date', 'On receipt', 'Description', 'Qty', 'Rate', 'Amount', 'Subtotal', 'Total', 'Paid', 'Balance due',
      'Thank you for your business!']) expect(t, s).toContain(s);
    expect(q('[data-dt-mark]')).toBeTruthy();                       // the brand mark in the header, not a raster
  });
  it('shows the amounts it computes: partial with a discount and a setup fee', () => {
    const inv = { ...base, status: 'sent', setupFee: 1500, amount: 5500, discount: 500, total: 5000, paidAmount: 1500, monthlyFee: 4000 };
    const t = render(inv);
    expect(t).toContain('Rs 5,500');   // subtotal
    expect(t).toContain('Rs 500');     // discount
    expect(t).toContain('Rs 5,000');   // total
    expect(t).toContain('Rs 1,500');   // paid
    expect(t).toContain('Rs 3,500');   // balance due
    expect(t).toContain('One-time setup fee');
    expect(q('[data-invoice-status]')!.textContent).toBe('Partial');
  });
  it('leaves out what it has nothing to say about', () => {
    const t = render(base, noPay);
    expect(t).not.toContain('Discount');
    expect(t).not.toContain('One-time setup fee');
    expect(t).not.toContain('Terms');
    expect(q('[data-invoice-payment]')).toBeNull();
    expect(q('[data-invoice-paid-stamp]')).toBeNull();
  });
  it('prints the payment details and numbered terms it is given', () => {
    const t = render(base, pay);
    expect(q('[data-invoice-payment]')).toBeTruthy();
    for (const s of ['ACC TITLE', 'Some Bank', '1234 5678', '1. Pay in 7 days.', '2. Work starts after advance.']) expect(t, s).toContain(s);
  });
  it('a paid invoice carries the stamp, and its balance is zero', () => {
    const t = render({ ...base, status: 'paid' });
    expect(q('[data-invoice-paid-stamp]')).toBeTruthy();
    expect(t).toContain('Balance due');
    expect(q('[data-invoice-status]')!.textContent).toBe('Paid');
  });
  it('shows a due date when the invoice has one', () => {
    const t = render({ ...base, dueAt: new Date('2026-10-06') });
    expect(t).not.toContain('On receipt');
  });
  it('numbers the rows 1, 2 when there is a setup fee', () => {
    render({ ...base, setupFee: 1000, amount: 5000, total: 5000 });
    const rows = Array.from(q('[data-invoice-items]')!.querySelectorAll('tbody tr')).map(r => r.querySelector('td')!.textContent);
    expect(rows).toEqual(['1', '2']);
  });
});

describe('the profile (payment details and terms)', () => {
  it('has no bank details by default, and one sensible term', () => {
    expect(hasPaymentDetails(DEFAULT_INVOICE_PROFILE)).toBe(false);
    expect(DEFAULT_INVOICE_PROFILE.terms.length).toBe(1);
    expect(getInvoiceProfile()).toEqual(DEFAULT_INVOICE_PROFILE);
  });
  it('is sanitised: trimmed, capped, empty terms dropped, junk ignored', () => {
    const p = sanitizeInvoiceProfile({ accountTitle: '  A  ', bank: 'x'.repeat(500), accountNo: 5, terms: ['  one ', '', 7, 'two'] });
    expect(p.accountTitle).toBe('A');
    expect(p.bank.length).toBe(120);
    expect(p.accountNo).toBe('');
    expect(p.terms).toEqual(['one', 'two']);
    expect(sanitizeInvoiceProfile('nope')).toEqual({ accountTitle: '', bank: '', accountNo: '', terms: DEFAULT_INVOICE_PROFILE.terms });
    expect(sanitizeInvoiceProfile({ terms: new Array(20).fill('t') }).terms.length).toBe(8);
  });
  it('is saved, read back, and survives corrupt storage', () => {
    saveInvoiceProfile({ accountTitle: 'T', bank: 'B', accountNo: '9', terms: ['x', ''] });
    expect(getInvoiceProfile()).toEqual({ accountTitle: 'T', bank: 'B', accountNo: '9', terms: ['x'] });
    localStorage.setItem(INVOICE_PROFILE_KEY, '{not json');
    expect(getInvoiceProfile()).toEqual(DEFAULT_INVOICE_PROFILE);
  });
});

describe('guards on the source', () => {
  const a4 = readFileSync('src/components/A4Invoice.tsx', 'utf8');
  const prof = readFileSync('src/lib/invoiceProfile.ts', 'utf8');
  const dialog = readFileSync('src/components/InvoicePreviewDialog.tsx', 'utf8');
  it('no bank name, account number or IBAN is written into the code', () => {
    for (const src of [a4, prof]) {
      expect(src).not.toMatch(/Meezan|HBL|Allied|UBL|PK\d{2}[A-Z]{4}/);
      expect(src).not.toMatch(/\b\d{10,}\b/);
    }
  });
  it('the footer is part of the layout (a long invoice cannot hide its terms behind it)', () => {
    expect(a4).not.toMatch(/position: 'absolute', left: 0, right: 0, bottom: 0/);
    expect(a4).toMatch(/flexDirection: 'column'/);
    expect(a4).toMatch(/flex: 1/);
  });
  it('the preview dialog uses this component and no longer carries its own A4 layout', () => {
    expect(dialog).toContain("import A4Invoice from '@/components/A4Invoice'");
    expect(dialog).not.toContain('const A4Invoice = (() =>');
  });
  it('the POS 80 mm slip and the exports are untouched', () => {
    expect(dialog).toContain('POSInvoice');
    expect(dialog).toContain('html2canvas');
    expect(dialog).toContain('A4_CSS');
  });
});
