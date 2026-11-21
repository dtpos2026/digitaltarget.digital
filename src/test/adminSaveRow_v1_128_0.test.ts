// v1.128.0 — "I change one thing in the admin panel and it will not save".
// Every admin save was an upsert. Postgres checks NOT NULL on the proposed row before it looks for the conflict, so an update that
// sent only what changed ({ id, is_published: false }) was refused with 23502 — measured on the live schema. A row with an id is now
// UPDATEd (given columns only); an id that matches nothing, or no id, is INSERTed with the whole row.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { op: string; table: string; payload?: unknown; id?: string };
const calls: Call[] = [];
let existing: Record<string, Record<string, unknown>> = {};

function builder(table: string) {
  let op = 'select'; let payload: unknown; let id: string | undefined;
  const b: any = {
    update(p: unknown) { op = 'update'; payload = p; return b; },
    insert(p: unknown) { op = 'insert'; payload = p; return b; },
    upsert(p: unknown) { op = 'upsert'; payload = p; return b; },
    select() { return b; },
    eq(_c: string, v: string) { id = v; return b; },
    maybeSingle() { calls.push({ op, table, payload, id }); const row = id ? existing[id] : undefined; return Promise.resolve({ data: row ? { ...row, ...(op === 'update' ? (payload as object) : {}) } : null, error: null }); },
    single() { calls.push({ op, table, payload, id }); return Promise.resolve({ data: { id: 'new-id', ...(payload as object) }, error: null }); },
  };
  return b;
}
vi.mock('@/lib/supabase', () => ({ sb: () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) }) }));

import { saveRelease, saveInvoice, savePackage, savePlan, saveServiceCall } from '@/lib/superAdminSupabase';

beforeEach(() => { calls.length = 0; existing = { 'r-1': { id: 'r-1', version: '1.0.0', is_published: true }, 'i-1': { id: 'i-1', number: 'INV-1', status: 'unpaid' } }; });

describe('admin saves never use a partial upsert', () => {
  it('unpublishing a release updates only that column', async () => {
    const row = await saveRelease({ id: 'r-1', is_published: false });
    expect(calls.some(c => c.op === 'upsert')).toBe(false);
    expect(calls[0]).toMatchObject({ op: 'update', table: 'admin_releases', id: 'r-1', payload: { is_published: false } });
    expect(row.version).toBe('1.0.0');
  });
  it('marking an invoice paid updates only the status and the paid total', async () => {
    await saveInvoice({ id: 'i-1', status: 'paid', paid_total: 500 });
    expect(calls[0]).toMatchObject({ op: 'update', table: 'admin_invoices', payload: { status: 'paid', paid_total: 500 } });
  });
  it('a new row (no id) is inserted whole', async () => {
    await savePackage({ name: 'Starter', setup_fee: 1, monthly_fee: 2, duration_months: 1, is_active: true, sort_order: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'insert', table: 'admin_packages', payload: { name: 'Starter' } });
  });
  it('an id that matches nothing falls back to an insert of the full row', async () => {
    await savePlan({ id: 'gone', code: 'pro', name: 'Pro', price: 10, features: {}, is_active: true, sort_order: 0 });
    expect(calls.map(c => c.op)).toEqual(['update', 'insert']);
  });
  it('service calls follow the same rule', async () => {
    await saveServiceCall({ title: 'Printer', tenant_id: 't' });
    expect(calls[0]).toMatchObject({ op: 'insert', table: 'admin_service_calls' });
  });
});
