// v1.108.0 — the sync defects found by reading the live logs and the phone-app functions.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '33333333-3333-3333-3333-333333333333';
const upserts: { table: string; rows: any[]; opts: any }[] = [];

vi.mock('@/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  sb: () => ({
    from: (table: string) => ({
      upsert: async (rows: any, opts: any) => { upserts.push({ table, rows: Array.isArray(rows) ? rows : [rows], opts }); return { error: null }; },
    }),
  }),
  isSupabaseConfigured: () => true,
}));
vi.mock('@/lib/authProvider', async (orig) => ({
  ...(await orig<any>()),
  authTenantId: () => TENANT,
  authBranchId: () => null,
}));
vi.mock('@/lib/portalData', async (orig) => ({ ...(await orig<any>()), hasPortalSession: () => false }));

const cloud = await import('@/lib/supabaseStore');

describe('bill numbers when the server counter cannot answer', () => {
  /** A store that has just read this device's data (the store keeps its data in memory after the first read). */
  const freshStore = async (orders: any[], orderCounter = 5100) => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('desi-pos-data', JSON.stringify({ orders, menuItems: [], categories: [], tables: [], settings: {}, orderCounter }));
    return import('@/lib/store');
  };
  const bill = (orderNumber: number, branchId?: string) => ({ id: `o${orderNumber}`, orderNumber, branchId, status: 'paid', items: [] });

  it("starts above another till's bills that sync already brought here (the local counter alone was behind)", async () => {
    const s = await freshStore([bill(5171), bill(5173), bill(5169)]);
    expect(s.highestKnownOrderNumber(null)).toBe(5173);
    expect(s.getNextOrderNumber()).toBe(5174);
    expect(s.getNextOrderNumber()).toBe(5175);
  });

  it('still counts on from its own counter when that is ahead', async () => {
    const s = await freshStore([bill(10)], 5100);
    expect(s.getNextOrderNumber()).toBe(5101);
  });

  it("only looks at the till's own branch", async () => {
    const s = await freshStore([bill(5171, 'A'), bill(9000, 'B'), bill(8000)]);
    expect(s.highestKnownOrderNumber('A')).toBe(8000);   // a bill without a branch counts for every branch
    expect(s.highestKnownOrderNumber('B')).toBe(9000);
    const t = await freshStore([bill(5171, 'A'), bill(9000, 'B')]);
    expect(t.highestKnownOrderNumber('A')).toBe(5171);
  });

  it('the preview agrees with the number that will be issued, and does not use it up', async () => {
    const s = await freshStore([bill(5171)]);
    expect(s.peekNextOrderNumber()).toBe(5172);
    expect(s.peekNextOrderNumber()).toBe(5172);
    expect(s.getNextOrderNumber()).toBe(5172);
  });

  it('ignores a bill whose number is not a number', async () => {
    const s = await freshStore([{ id: 'x', orderNumber: 'abc', status: 'paid', items: [] }, bill(7)], 3);
    expect(s.highestKnownOrderNumber(null)).toBe(7);
  });
});

describe('a null is "not known", never "store nothing"', () => {
  it('leaves out a NOT NULL column that has a database default when its value is null', () => {
    const row = cloud.rowToDb('customers', { id: 'c1', name: 'Ali', phone: '0300', loyaltyPoints: null, creditBalance: null, isBlocked: null, totalOrders: null });
    expect(row).not.toHaveProperty('loyalty_points');
    expect(row).not.toHaveProperty('credit_balance');
    expect(row).not.toHaveProperty('is_blocked');
    expect(row).not.toHaveProperty('total_orders');
    expect(row.name).toBe('Ali');
  });

  it('keeps a real value, including zero, and a null for a column that may be empty', () => {
    const row = cloud.rowToDb('customers', { id: 'c1', name: 'Ali', loyaltyPoints: 0, totalOrders: 3, email: null });
    expect(row.loyalty_points).toBe(0);
    expect(row.total_orders).toBe(3);
    expect(row).toHaveProperty('email', null);
  });

  it('covers every table written through the generic path, with the columns the live schema marks NOT NULL + default', () => {
    expect([...cloud.NOT_NULL_WITH_DEFAULT.customers].sort()).toEqual(
      ['addresses', 'created_at', 'credit_balance', 'is_blocked', 'loyalty_points', 'total_orders', 'total_spent', 'updated_at'].sort());
    for (const table of Object.keys(cloud.NOT_NULL_WITH_DEFAULT)) {
      expect(Object.keys(cloud.ALLOWED_COLUMNS), table).toContain(table);
      for (const col of cloud.NOT_NULL_WITH_DEFAULT[table]) expect(cloud.ALLOWED_COLUMNS[table].has(col), `${table}.${col}`).toBe(true);
    }
  });
});

describe('rows of one bulk write share the same keys', () => {
  it('groups rows by their exact key set', () => {
    const g = cloud.groupRowsByKeys([
      { id: 1, name: 'a', loyalty_points: 5 },
      { id: 2, name: 'b' },
      { name: 'c', id: 3, loyalty_points: 9 },
      { id: 4, name: 'd' },
    ]);
    expect(g).toHaveLength(2);
    expect(g.map(x => x.map(r => r.id).sort())).toEqual(expect.arrayContaining([[1, 3], [2, 4]]));
  });

  it('keeps an all-alike batch as one group (one request)', () => {
    expect(cloud.groupRowsByKeys([{ id: 1, a: 1 }, { id: 2, a: 2 }])).toHaveLength(1);
    expect(cloud.groupRowsByKeys([])).toEqual([]);
  });

  it('sbSaveMany sends one upsert per key set, so a missing column is never sent as null', async () => {
    upserts.length = 0;
    const res = await cloud.sbSaveMany('customers', [
      { id: 'c1', data: { id: 'c1', name: 'A', phone: '0300000001', loyaltyPoints: 12 } },
      { id: 'c2', data: { id: 'c2', name: 'B', phone: '0300000002' } },
      { id: 'c3', data: { id: 'c3', name: 'C', phone: '0300000003', loyaltyPoints: 4 } },
    ]);
    expect(res.failed).toEqual([]);
    expect(res.saved.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(upserts).toHaveLength(2);
    const withPoints = upserts.find(u => u.rows[0].loyalty_points !== undefined)!;
    const without = upserts.find(u => u.rows[0].loyalty_points === undefined)!;
    expect(withPoints.rows).toHaveLength(2);
    expect(without.rows).toHaveLength(1);
    for (const u of upserts) for (const r of u.rows) expect(Object.values(r)).not.toContain(null);
  });
});

describe('the phone-app functions (migration 20261106100000)', () => {
  const sql = readFileSync('supabase/migrations/20261106100000_v1_108_0_portal_sync_fixes.sql', 'utf8').replace(/^\s*--.*$/gm, '');

  it('Delivered records the payment, once, and never for credit or complimentary bills', () => {
    expect(sql).toContain("'by', 'rider'");
    expect(sql).toContain("v_method <> 'credit'");
    expect(sql).toContain("<> 'complimentary'");
    expect(sql).toContain('v_due    := greatest(v_total - v_paid, 0)');
    expect(sql).toMatch(/if v_due > 0 and/);
  });

  it('a claim is decided with the order row locked', () => {
    expect(sql.match(/for update/g)?.length).toBe(2);
    expect(sql).toMatch(/portal_order_delivery[\s\S]*?for update[\s\S]*?already_claimed/);
  });

  it('the typed columns the tracking page reads are set, and client_seq follows', () => {
    for (const c of ['dispatched_at', 'rider_phone', 'delivered_at', 'paid_at', 'client_seq']) expect(sql).toContain(c);
  });

  it('an Order Taker save keeps what other devices own and a paid bill stays paid', () => {
    for (const k of ['payments', 'kitchenStatus', 'deliveryStatus', 'riderId', 'paidAt', 'amountPaid']) expect(sql).toContain(`'${k}'`);
    expect(sql).toContain("in ('paid', 'void')");
    expect(sql).toContain('portal_merge_order_doc(v_existing.data, p_order)');
  });

  it('adds no table, column or policy and does not open any grant to the public', () => {
    expect(sql).not.toMatch(/\b(create table|alter table|drop|create policy)\b/i);
    expect(sql).toMatch(/revoke all on function public\.portal_merge_order_doc\(jsonb, jsonb\) from public, anon, authenticated/);
    expect(sql).not.toMatch(/grant execute on function[^;]*(anon|authenticated)/);
  });

  it('the previous bodies are saved for a rollback', () => {
    const rb = readFileSync('docs/rollback/2026-11-06-v1_108_0-portal-functions-before.sql', 'utf8');
    expect(rb).toContain('CREATE OR REPLACE FUNCTION public.portal_order_delivery');
    expect(rb).toContain('CREATE OR REPLACE FUNCTION public.portal_upsert_order');
  });
});
