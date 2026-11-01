// v1.83.0 — the public verification page, rendered with the database answer faked at the Supabase client.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ sb: () => ({ rpc }) }));

import { HashRouter, Route, Routes } from '@/lib/hash-router';
import VerifyInvoicePage from '@/pages/VerifyInvoicePage';

const ID = 'a80fdffb-3a8e-441c-9e90-2dc3e4afa94f';
const answer = (o: Record<string, unknown> = {}) => ({ number: 'INV-2026-0002', issued_at: '2026-10-21T13:47:19Z', due_at: '2030-11-05T00:00:00Z', total: 12000, paid_total: 0, status: 'unpaid', customer: 'Gold Kitchen', issuer: 'Digital Target', ...o });
const open = (id = ID) => { window.location.hash = `#/verify/${id}`; return render(<HashRouter><Routes><Route path="/verify/:invoiceId" element={<VerifyInvoicePage />} /></Routes></HashRouter>); };

beforeEach(() => rpc.mockReset());
afterEach(() => cleanup());

describe('a genuine invoice', () => {
  it('shows the invoice number, customer, amounts and the payment state', async () => {
    rpc.mockResolvedValue({ data: answer({ paid_total: 5000, status: 'partial' }), error: null });
    open();
    await waitFor(() => expect(screen.getByTestId('verdict')).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith('verify_invoice', { p_id: ID });
    expect(screen.getByTestId('verdict')).toHaveTextContent(/partly paid/i);
    const d = screen.getByTestId('verify-details');
    expect(within(d).getByText('INV-2026-0002')).toBeInTheDocument();
    expect(within(d).getByText('Gold Kitchen')).toBeInTheDocument();
    expect(within(d).getByText('Rs 12,000')).toBeInTheDocument();
    expect(within(d).getByText('Rs 5,000')).toBeInTheDocument();
    expect(within(d).getByText('Rs 7,000')).toBeInTheDocument();
  });
  it('paid in full is green; cancelled is red and owes nothing', async () => {
    rpc.mockResolvedValue({ data: answer({ paid_total: 12000, status: 'paid' }), error: null });
    const a = open();
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveAttribute('data-tone', 'success'));
    a.unmount();
    rpc.mockResolvedValue({ data: answer({ status: 'void' }), error: null });
    open();
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveAttribute('data-tone', 'danger'));
    expect(within(screen.getByTestId('verify-details')).getAllByText('Rs 0').length).toBeGreaterThan(0);
  });
  it('tells the reader to compare the number and total with the copy they hold', async () => {
    rpc.mockResolvedValue({ data: answer(), error: null });
    open();
    await waitFor(() => expect(screen.getByTestId('verdict')).toBeInTheDocument());
    expect(screen.getByText(/Compare the invoice number and total/)).toBeInTheDocument();
  });
  it('never shows anything the function does not return (no line items, notes or contacts)', async () => {
    rpc.mockResolvedValue({ data: answer({ line_items: [{ name: 'SECRET PLAN' }], notes: 'PRIVATE NOTE', email: 'owner@x.com' }), error: null });
    open();
    await waitFor(() => expect(screen.getByTestId('verdict')).toBeInTheDocument());
    const text = document.body.textContent || '';
    expect(text).not.toMatch(/SECRET PLAN|PRIVATE NOTE|owner@x\.com/);
  });
});

describe('an invoice that cannot be confirmed', () => {
  it('unknown id: "No invoice found", with advice not to pay', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    open();
    await waitFor(() => expect(screen.getByTestId('verify-message')).toHaveTextContent(/No invoice found/));
    expect(screen.getByTestId('verify-message')).toHaveTextContent(/before paying/);
    expect(screen.queryByTestId('verify-details')).toBeNull();
  });
  it('a service error is not reported as "not genuine"', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network down' } });
    open();
    await waitFor(() => expect(screen.getByTestId('verify-message')).toHaveTextContent(/Could not check right now/));
    expect(screen.getByTestId('verify-message')).toHaveAttribute('data-tone', 'warning');
  });
  it('a malformed link is rejected without a database call', async () => {
    open('not-an-id');
    await waitFor(() => expect(screen.getByTestId('verify-message')).toHaveTextContent(/not a valid invoice link/i));
    expect(rpc).not.toHaveBeenCalled();
  });
});
