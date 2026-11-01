// v1.83.0 — online invoice verification: the link/QR on the invoice, the public page, and what the database may reveal.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { HashRouter, Route, Routes } from '@/lib/hash-router';
import {
  looksLikeInvoiceId, verifyUrl, invoiceIdFrom, parseVerification, verdictFor, verifyInvoice, VERIFY_PATH, type Rpc,
} from '@/lib/invoiceVerify';
import { PUBLIC_PREFIXES, isPublicTenantRoute } from '@/lib/publicRoutes';
import InvoiceVerifyBadge from '@/components/InvoiceVerifyBadge';
import VerifyInvoicePage from '@/pages/VerifyInvoicePage';

const ID = 'a80fdffb-3a8e-441c-9e90-2dc3e4afa94f';
const row = (o: Record<string, unknown> = {}) => ({ number: 'INV-2026-0002', issued_at: '2026-10-21T13:47:19Z', due_at: '2026-11-05T00:00:00Z', total: 12000, paid_total: 0, status: 'unpaid', customer: 'Gold Kitchen', issuer: 'Digital Target', ...o });

afterEach(() => cleanup());

describe('the address on the invoice', () => {
  it('is <site>/#/verify/<invoice id>', () => {
    expect(verifyUrl(ID, 'https://digitaltarget.digital')).toBe(`https://digitaltarget.digital/${VERIFY_PATH}${ID}`);
    expect(verifyUrl(ID, 'https://x.example/')).toBe(`https://x.example/#/verify/${ID}`);
  });
  it('only a real uuid is accepted; sequential numbers, short codes and junk are not', () => {
    expect(looksLikeInvoiceId(ID)).toBe(true);
    for (const bad of ['', '1', 'INV-2026-0002', '12345678', 'a80fdffb-3a8e-441c-9e90', `${ID}x`, "'; drop table x;--", undefined, 42]) expect(looksLikeInvoiceId(bad as any)).toBe(false);
  });
  it('the id comes back out of a full address or a bare id', () => {
    expect(invoiceIdFrom(`https://digitaltarget.digital/#/verify/${ID}`)).toBe(ID);
    expect(invoiceIdFrom(ID.toUpperCase())).toBe(ID);
    expect(invoiceIdFrom('https://digitaltarget.digital/#/verify/nope')).toBeNull();
  });
  it('/verify is a public route: no sign-in, no restaurant', () => {
    expect(PUBLIC_PREFIXES).toContain('#/verify');
    expect(isPublicTenantRoute(`#/verify/${ID}`)).toBe(true);
    expect(isPublicTenantRoute('#/dashboard')).toBe(false);
  });
});

describe('reading the database answer', () => {
  it('a good answer becomes a verified invoice with its balance', () => {
    expect(parseVerification(row({ paid_total: 5000, status: 'partial' }))).toMatchObject({ number: 'INV-2026-0002', total: 12000, paidTotal: 5000, balance: 7000, status: 'partial', customer: 'Gold Kitchen' });
  });
  it('a cancelled invoice owes nothing', () => { expect(parseVerification(row({ status: 'void', paid_total: 0 }))!.balance).toBe(0); });
  it('payments above the total never make a negative balance', () => { expect(parseVerification(row({ paid_total: 99999, status: 'paid' }))!.balance).toBe(0); });
  it('junk is not an invoice', () => {
    for (const bad of [null, undefined, 5, 'x', {}, { number: '' }, row({ status: 'weird' }), row({ number: 12 })]) expect(parseVerification(bad as any)).toBeNull();
  });
  it('wording for each state, and an overdue one says so', () => {
    const v = (o: any) => parseVerification(row(o))!;
    expect(verdictFor(v({ status: 'paid', paid_total: 12000 })).headline).toMatch(/paid in full/);
    expect(verdictFor(v({ status: 'void' })).tone).toBe('danger');
    expect(verdictFor(v({ status: 'unpaid', due_at: '2030-01-01T00:00:00Z' }), Date.UTC(2026, 10, 1)).tone).toBe('warning');
    expect(verdictFor(v({ status: 'unpaid', due_at: '2026-01-01T00:00:00Z' }), Date.UTC(2026, 10, 1)).tone).toBe('danger');
    expect(verdictFor(v({ status: 'partial', due_at: '2026-01-01T00:00:00Z' }), Date.UTC(2026, 10, 1)).detail).toMatch(/due date has passed/);
  });
});

describe('asking the database', () => {
  const ok = (data: unknown): Rpc => async () => ({ data, error: null });
  it('calls verify_invoice with the lower-cased id', async () => {
    const spy = vi.fn(ok(row()));
    await verifyInvoice(ID.toUpperCase(), spy as Rpc);
    expect(spy).toHaveBeenCalledWith('verify_invoice', { p_id: ID });
  });
  it('found / not found / invalid / error are four different answers', async () => {
    expect((await verifyInvoice(ID, ok(row()))).state).toBe('ok');
    expect((await verifyInvoice(ID, ok(null))).state).toBe('not-found');
    expect((await verifyInvoice('not-an-id', ok(row()))).state).toBe('invalid');
    expect((await verifyInvoice(ID, async () => ({ data: null, error: { message: 'boom' } }))).state).toBe('error');
    expect((await verifyInvoice(ID, async () => { throw new Error('offline'); })).state).toBe('error');
  });
  it('an invalid id never reaches the database', async () => {
    const spy = vi.fn(ok(row()));
    await verifyInvoice('1 or 1=1', spy as Rpc);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the QR block on the invoice', () => {
  it('draws a QR for the verification address and prints the address', async () => {
    render(<InvoiceVerifyBadge invoiceId={ID} />);
    await waitFor(() => expect(document.querySelector('[data-invoice-qr] svg')).not.toBeNull());
    expect(screen.getByText(/Verify this invoice online/)).toBeInTheDocument();
    expect(document.querySelector('[data-invoice-verify-url]')!.textContent).toContain(`#/verify/${ID}`);
  });
  it('is on the A4 invoice and the 80 mm invoice, and the preview offers the link', () => {
    expect(readFileSync('src/components/A4Invoice.tsx', 'utf8')).toMatch(/InvoiceVerifyBadge invoiceId=\{invoice\.id\}/);
    const d = readFileSync('src/components/InvoicePreviewDialog.tsx', 'utf8');
    expect(d).toMatch(/InvoiceVerifyBadge invoiceId=\{invoice\.id\} size=\{110\} compact/);
    expect(d).toContain('copy-verify-link');
  });
});

describe('the public page', () => {
  it('is registered as a public route with the invoice id in the path', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/path="\/verify\/:invoiceId" element=\{<VerifyInvoicePage \/>\}/);
  });
  it('shows a not-valid message for a malformed link without asking anyone', async () => {
    window.location.hash = '#/verify/garbage';
    render(<HashRouter><Routes><Route path="/verify/:invoiceId" element={<VerifyInvoicePage />} /></Routes></HashRouter>);
    await waitFor(() => expect(screen.getByTestId('verify-message')).toHaveTextContent(/not a valid invoice link/i));
  });
});

describe('what the database function may reveal (migration 20261101180000_v1_83_0_verify_invoice.sql)', () => {
  const sql = readFileSync('supabase/migrations/20261101180000_v1_83_0_verify_invoice.sql', 'utf8');
  const body = sql.slice(sql.indexOf('jsonb_build_object'), sql.indexOf('from public.admin_invoices'));
  it('returns exactly the invoice header and payment state', () => {
    const keys = [...body.matchAll(/'([a-z_]+)',/g)].map(m => m[1]);
    expect(keys.sort()).toEqual(['customer', 'due_at', 'issued_at', 'issuer', 'number', 'paid_total', 'status', 'total']);
  });
  it('never touches line items, notes or contact details', () => {
    expect(body).not.toMatch(/line_items|notes|email|phone|created_by/i);
  });
  it('is a definer function with a fixed search path, closed to the public role and opened only to the two API roles', () => {
    expect(sql).toMatch(/security definer\s+set search_path = public/i);
    expect(sql).toMatch(/revoke all on function public\.verify_invoice\(uuid\) from public/i);
    expect(sql).toMatch(/grant execute on function public\.verify_invoice\(uuid\) to anon, authenticated/i);
  });
  it('is additive: it creates a function and changes no table, column or policy', () => {
    expect(sql).not.toMatch(/\b(alter table|drop |create table|create policy|alter policy|delete from|update )/i);
  });
});
