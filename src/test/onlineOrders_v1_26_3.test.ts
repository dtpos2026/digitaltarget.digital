// ============================================================================
// v1.26.3 — customer website orders never really arrived in the POS
//
// public_place_order() had three independent defects, any one of which made an
// online order useless to the restaurant:
//
//   1. Items went to `order_items`. The POS reads items from `orders.data`,
//      and nothing in the client reads order_items at all — so the till got an
//      order number, a total, and nothing to cook.
//   2. status 'pending' is not a member of the OrderStatus union, so the order
//      matched no screen's filter.
//   3. source was overwritten to 'online'. NewOrderNotifier only reacts to
//      website|qr|order_taker, so there was no alert, no approval gate and no
//      auto-KOT.
//
// The RPC is server-side SQL, so these assert the shipped migration's
// contract. The behaviour itself was verified against the live database in a
// rolled-back transaction: status=running, source=website, 2 document items,
// subtotal=grand_total=total=840, and a client-supplied price of 1 ignored in
// favour of the menu price.
// ============================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { rowToDb } from '@/lib/supabaseStore';

const migrations = fs.readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
  .map(f => fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', f), 'utf8'))
  .join('\n');

// Bounded at the function's own terminator. Slicing to end-of-file swept in
// every migration that sorts after this one, so an unrelated file mentioning
// 'pending' (the notification outbox has a status by that name) failed an
// assertion about public_place_order's INSERT.
const placeOrderStart = migrations.indexOf('create or replace function public.public_place_order');
const placeOrderEnd = migrations.indexOf('$$;', placeOrderStart);
const placeOrder = migrations.slice(
  placeOrderStart,
  placeOrderEnd > placeOrderStart ? placeOrderEnd + 3 : undefined,
);

describe('an online order reaches the till in a shape it can use', () => {
  it('writes the POS document, not just order_items rows', () => {
    expect(placeOrder).toContain("data = jsonb_build_object(");
    expect(placeOrder).toContain("'items',       v_lines");
  });

  it('builds each line in the shape types.ts CartItem describes', () => {
    for (const key of ['menuItemId', 'pricingType', 'lineTotal', 'quantity', 'price']) {
      expect(placeOrder).toContain(`'${key}'`);
    }
  });

  it('uses a status the application actually has', () => {
    expect(placeOrder).toContain("v_type, 'running', v_source,");
    expect(placeOrder).not.toContain("'pending',");
  });

  it('keeps the source the customer portal sent', () => {
    // Overwriting it with 'online' is what silenced the notifier.
    expect(placeOrder).toContain("when p_order->>'source' in ('website', 'qr', 'order_taker')");
  });

  it('still writes order_items, so nothing that reads them loses rows', () => {
    expect(placeOrder).toContain('insert into order_items');
  });

  it('still re-reads prices from the menu instead of trusting the request', () => {
    // The order arrives unauthenticated. A client-supplied price would let
    // anyone buy a PKR 5000 meal for PKR 1.
    expect(placeOrder).toContain('from menu_items m');
    expect(placeOrder).toContain('v_line     := v_menu.price * v_qty;');
  });

  it('still refuses a branch belonging to another restaurant', () => {
    expect(placeOrder).toContain('branch not valid for this restaurant');
  });
});

describe('the stranded orders are recovered rather than abandoned', () => {
  const repair = migrations.slice(migrations.indexOf('-- v1.26.3 — recover the customer orders'));

  it('rebuilds the document from the item rows that already exist', () => {
    expect(repair).toContain('from order_items oi');
    expect(repair).toContain("'items',       coalesce(l.items, '[]'::jsonb)");
  });

  it('routes them to approval rather than asserting they are live bills', () => {
    expect(repair).toContain("status = 'pending_approval'");
  });

  it('only touches rows carrying the broken writer signature', () => {
    expect(repair).toContain("where o.status = 'pending' and o.source = 'online'");
  });
});

describe('the POS writer fills the same columns the website writer does', () => {
  const order = {
    id: 'o1', orderNumber: 7, orderType: 'delivery', status: 'paid',
    items: [{ id: 'l1', name: 'Tea', quantity: 2, price: 50, lineTotal: 100 }],
    payments: [], subtotal: 100, discount: 10, tax: 5, grandTotal: 95,
    tableName: 'Table 3', createdAt: new Date().toISOString(), _updatedAt: 123,
  };

  it('writes every money column, not only `total`', () => {
    // Writing one and leaving the others at 0 is why the tracker showed 0 for
    // POS orders and the correct figure for website orders.
    const row = rowToDb('orders', order);
    expect(row.total).toBe(95);
    expect(row.grand_total).toBe(95);
    expect(row.subtotal).toBe(100);
    expect(row.discount).toBe(10);
    expect(row.tax).toBe(5);
  });

  it('indexes the type, source and table so reports can group by them', () => {
    const row = rowToDb('orders', order);
    expect(row.order_type).toBe('delivery');
    expect(row.source).toBe('pos');
    expect(row.table_label).toBe('Table 3');
  });

  it('still keeps the whole document as the source of truth', () => {
    const row = rowToDb('orders', order);
    expect(row.data.items).toHaveLength(1);
    expect(row.data.grandTotal).toBe(95);
  });

  it('a free order writes 0, not null', () => {
    const row = rowToDb('orders', { ...order, grandTotal: 0, subtotal: 0 });
    expect(row.grand_total).toBe(0);
    expect(row.subtotal).toBe(0);
  });
});

// ============================================================================
// v1.26.4 — a QR order used to be filed against the wrong branch
//
// A dine-in QR carries only ?table=…&floor=…. OnlineOrderPage's branch effect
// says "Default to first branch for dine-in QR (no prompt)", so a customer
// scanning Table 5 in Branch 2 had their order filed against Branch 1: wrong
// kitchen, wrong floor map, wrong branch sales. The table-name lookup was
// unscoped too, so "Table 5" could match another branch's Table 5 outright.
//
// dining_tables.branch_id is the authority — a table belongs to exactly one
// branch and the customer is standing at it. Verified against the live
// database in a rolled-back transaction: the caller claimed one branch, the
// table belonged to another, and the order was filed against the table's.
// ============================================================================
describe('a table order stays with its own branch', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src', 'pages', 'OnlineOrderPage.tsx'), 'utf8');

  it('takes the branch from the matched table, not the picker', () => {
    expect(page).toContain('const effectiveBranchId =');
    expect(page).toContain('matchedTable?.branchId');
  });

  it('sends that branch to the backend rather than the default one', () => {
    expect(page).toContain('branchId: effectiveBranchId,');
    expect(page).toContain('branchId: effectiveBranchId || undefined,');
  });

  it('prefers a table in the branch the QR names when names collide', () => {
    expect(page).toContain('byName(t) && inBranch(t)');
  });

  it('the QR may carry an explicit branch, and older QR codes still work', () => {
    expect(page).toContain("branch: qs.get('branch') || undefined");
  });

  it('the backend re-derives the branch instead of trusting the browser', () => {
    // The caller is an anonymous customer's browser.
    expect(placeOrder).toContain('from dining_tables dt');
    expect(placeOrder).toContain('dt.tenant_id = p_tenant');
  });

  it('an unknown or foreign table cannot smuggle a branch through', () => {
    // Whatever the lookup produces still passes the ownership check.
    const afterLookup = placeOrder.slice(placeOrder.indexOf('from dining_tables dt'));
    expect(afterLookup).toContain('branch not valid for this restaurant');
  });
});

describe('the model knows which branch a table is in', () => {
  const types = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'types.ts'), 'utf8');
  const diningTable = types.slice(types.indexOf('export interface DiningTable'),
                                  types.indexOf('export interface Floor'));

  it('DiningTable carries branchId', () => {
    // The column has always existed and is synced; the interface omitted it,
    // so nothing in the app could read it and tables looked restaurant-wide.
    expect(diningTable).toContain('branchId?: string;');
  });

  it('Floor carries branchId too', () => {
    const floor = types.slice(types.indexOf('export interface Floor'));
    expect(floor.slice(0, 400)).toContain('branchId?: string;');
  });
});

describe('the tracker recognises a dine-in order', () => {
  const tracker = fs.readFileSync(
    path.join(process.cwd(), 'src', 'pages', 'TrackOrderPage.tsx'), 'utf8');

  it("matches 'dining', which is what OrderType actually is", () => {
    // It compared against 'dine-in', which is not a member of the union, so
    // only the tableLabel fallback ever fired.
    expect(tracker).toContain("(order as any).orderType === 'dining'");
  });
});
