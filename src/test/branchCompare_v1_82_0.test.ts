// v1.82.0 — Branch Performance: the figures behind the branch comparison.
import { describe, it, expect } from 'vitest';
import { compareBranches, branchWindows, extremes, toCsv, UNASSIGNED, type BranchInput } from '@/lib/branchCompare';
import type { InventoryItem, Order, Transaction, User, Wastage } from '@/lib/types';

// Wednesday 4 Nov 2026, 15:30 local
const NOW = new Date(2026, 10, 4, 15, 30).getTime();
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
const win = branchWindows('7d', NOW);

const order = (o: Partial<Order> & { grand?: number } = {}): Order => {
  const { grand = 1000, ...rest } = o;
  return {
    id: Math.random().toString(36).slice(2), orderNumber: 1, orderType: 'dining', status: 'paid', paymentMethod: 'cash',
    items: [{ id: 'i', menuItemId: 'm', name: 'Karahi', quantity: 1, lineTotal: grand } as any],
    subtotal: grand, discount: 0, tax: 0, serviceCharge: 0, grandTotal: grand, createdAt: at(4), paidAt: at(4), ...rest,
  } as Order;
};
const expense = (amount: number, branchId: string | undefined, day = 4): Transaction => ({ id: `${branchId}${amount}${day}`, date: at(day, 9), type: 'expense', categoryId: 'c', categoryName: 'Gas', amount, paymentMethod: 'cash', description: '', branchId } as Transaction);
const stock = (name: string, branchId: string | undefined, quantity: number, cost: number, min = 0): InventoryItem => ({ id: name + branchId, name, quantity, costPrice: cost, avgCostPrice: cost, lowStockThreshold: min, isActive: true, branchId } as any);
const user = (id: string, branchId?: string, isActive = true): User => ({ id, name: id, role: 'cashier', branchId, isActive } as any);

const BR = [{ id: 'A', name: 'Gulberg' }, { id: 'B', name: 'DHA' }, { id: 'C', name: 'Johar Town' }];
const input = (over: Partial<BranchInput> = {}): BranchInput => ({
  orders: [], transactions: [], wastages: [], inventory: [], users: [], branches: BR, ...over,
});

describe('one row per branch and a group that is their sum', () => {
  const orders = [
    order({ branchId: 'A', grand: 3000 }), order({ branchId: 'A', grand: 1000, paymentMethod: 'card' }),
    order({ branchId: 'B', grand: 2000 }),
    order({ branchId: 'A', grand: 700, status: 'void' as any }),
    order({ grand: 500 }),                                   // never stamped with a branch
  ];
  const r = compareBranches(input({ orders, transactions: [expense(1500, 'A'), expense(400, 'B'), expense(100, undefined)] }), win);

  it('every branch gets a row, including one that sold nothing', () => {
    expect(r.rows.map(x => x.name)).toEqual(['Gulberg', 'DHA', 'Johar Town', 'No branch recorded']);
    const c = r.rows.find(x => x.id === 'C')!;
    expect(c.cur.sales).toBe(0);
    expect(c.cur.orders).toBe(0);
    expect(c.cur.avg).toBe(0);
  });
  it('sales, orders, average, expenses and profit per branch', () => {
    const a = r.rows.find(x => x.id === 'A')!;
    expect(a.cur).toMatchObject({ sales: 4000, orders: 2, avg: 2000, expenses: 1500, profit: 2500 });
    const b = r.rows.find(x => x.id === 'B')!;
    expect(b.cur).toMatchObject({ sales: 2000, orders: 1, expenses: 400, profit: 1600 });
  });
  it('the group is exactly the sum of the rows that are shown', () => {
    const sum = (f: (x: typeof r.rows[number]) => number) => r.rows.reduce((s, x) => s + f(x), 0);
    expect(r.group.cur.sales).toBe(sum(x => x.cur.sales));
    expect(r.group.cur.sales).toBe(6500);
    expect(r.group.cur.orders).toBe(sum(x => x.cur.orders));
    expect(r.group.cur.expenses).toBe(2000);
    expect(r.group.cur.profit).toBe(4500);
  });
  it('rows without a branch are shown under their own heading, never added to a branch', () => {
    const u = r.rows.find(x => x.unassigned)!;
    expect(u.id).toBe(UNASSIGNED);
    expect(u.cur.sales).toBe(500);
    expect(r.rows.find(x => x.id === 'A')!.cur.sales).toBe(4000);
  });
  it('a user limited to some branches does not get the "no branch recorded" row, and the group follows what they see', () => {
    const limited = compareBranches(input({ orders, transactions: [expense(1500, 'A')] }), win, { includeUnassigned: false });
    expect(limited.rows.some(x => x.unassigned)).toBe(false);
    expect(limited.group.cur.sales).toBe(6000);
  });
  it('voided bills are not sales, and show up as a share of the bills raised', () => {
    const a = r.rows.find(x => x.id === 'A')!;
    expect(a.cur.voidPct).toBe(33.3);        // 1 of 3 bills raised at Gulberg
    expect(a.cur.sales).toBe(4000);
  });
  it('a branch id the branch list does not know is still shown, as an unknown branch', () => {
    const x = compareBranches(input({ orders: [order({ branchId: 'ZZ', grand: 900 })] }), win);
    expect(x.rows.some(row => row.id === 'ZZ' && row.name === 'Unknown branch' && row.cur.sales === 900)).toBe(true);
  });
});

describe('shares, ranking and growth', () => {
  const orders = [order({ branchId: 'A', grand: 6000 }), order({ branchId: 'B', grand: 3000 }), order({ branchId: 'C', grand: 3000 }),
    order({ branchId: 'A', grand: 1000, createdAt: at(-2), paidAt: at(-2) })];
  // 7-day windows: current 29 Oct–4 Nov, previous 22–28 Oct; (-2) = 2 Oct is outside both, so use Oct 25 for "previous"
  const prevOrder = order({ branchId: 'B', grand: 1500, createdAt: new Date(2026, 9, 25, 12).toISOString(), paidAt: new Date(2026, 9, 25, 12).toISOString() });
  const r = compareBranches(input({ orders: [...orders.slice(0, 3), prevOrder] }), win);
  it('share of the group adds to 100', () => {
    expect(r.rows.map(x => x.sharePct)).toEqual([50, 25, 25]);
    expect(r.rows.reduce((s, x) => s + x.sharePct, 0)).toBe(100);
  });
  it('rank 1 is the highest sales; ties share a rank', () => {
    expect(r.rows.map(x => x.rank)).toEqual([1, 2, 2]);
  });
  it('change against the period before; no comparison when there was nothing before', () => {
    expect(r.rows.find(x => x.id === 'B')!.salesChangePct).toBe(100);   // 3000 vs 1500
    expect(r.rows.find(x => x.id === 'A')!.salesChangePct).toBeNull();  // nothing the week before
  });
  it('an empty period is zero shares, not NaN', () => {
    const e = compareBranches(input(), win);
    expect(e.rows.every(x => x.sharePct === 0 && x.rank >= 1)).toBe(true);
    expect(e.group.cur.sales).toBe(0);
  });
});

describe('quality figures', () => {
  it('discount % is of what the bills were worth before discount; cash % of sales', () => {
    const r = compareBranches(input({ orders: [
      order({ branchId: 'A', grand: 900, discount: 100 }), order({ branchId: 'A', grand: 1000, paymentMethod: 'card' }),
    ] }), win);
    const a = r.rows[0].cur;
    expect(a.discountPct).toBe(5);        // 100 of 2000
    expect(a.cashPct).toBe(47.4);         // 900 of 1900
  });
  it('customers are counted once per branch, and once across the group', () => {
    const cust = (phone: string) => ({ name: 'x', phone } as any);
    const r = compareBranches(input({ orders: [
      order({ branchId: 'A', customer: cust('0300-111') }), order({ branchId: 'A', customer: cust('0300111') }),
      order({ branchId: 'B', customer: cust('0300111') }), order({ branchId: 'B', customer: cust('0300222') }),
      order({ branchId: 'B' }),
    ] }), win);
    expect(r.rows.find(x => x.id === 'A')!.cur.customers).toBe(1);
    expect(r.rows.find(x => x.id === 'B')!.cur.customers).toBe(2);
    expect(r.group.cur.customers).toBe(2);   // the same guest at two branches is one guest
  });
  it('wastage is summed per branch and in the group', () => {
    const w = (b: string | undefined, v: number) => ({ id: b + String(v), date: at(3), inventoryItemId: 'i', inventoryItemName: 'x', quantity: 1, unit: 'kg', costValue: v, reason: 'expired', branchId: b } as unknown as Wastage);
    const r = compareBranches(input({ wastages: [w('A', 200), w('A', 50), w('B', 70)] }), win);
    expect(r.rows.find(x => x.id === 'A')!.cur.wastage).toBe(250);
    expect(r.group.cur.wastage).toBe(320);
  });
  it('top three items per branch by sales', () => {
    const line = (name: string, total: number) => ({ id: name, menuItemId: name, name, quantity: 2, lineTotal: total } as any);
    const r = compareBranches(input({ orders: [
      order({ branchId: 'A', items: [line('Karahi', 3000), line('Naan', 200), line('Cola', 100), line('Fries', 400)] }),
      order({ branchId: 'A', items: [line('Karahi', 1000)] }),
    ] }), win);
    expect(r.rows[0].topItems.map(i => i.name)).toEqual(['Karahi', 'Fries', 'Naan']);
    expect(r.rows[0].topItems[0]).toMatchObject({ sales: 4000, qty: 4 });
  });
});

describe('state today: open bills, stock, staff', () => {
  it('open bills and the balance on part-paid bills — not on bills that are simply unpaid', () => {
    const r = compareBranches(input({ orders: [
      order({ branchId: 'A', status: 'running' as any, grand: 800 }), order({ branchId: 'A', status: 'hold' as any, grand: 300 }),
      order({ branchId: 'A', status: 'partial' as any, grand: 1000, amountPaid: 400 }),
      order({ branchId: 'A', status: 'paid' as any, grand: 500 }),    // paid, amountPaid never recorded: owes nothing
    ] }), win);
    const a = r.rows[0];
    expect(a.openBills).toBe(2);
    expect(a.amountDue).toBe(600);
  });
  it('inventory value (at average cost) and low-stock items, by branch', () => {
    const r = compareBranches(input({ inventory: [stock('Chicken', 'A', 10, 500, 5), stock('Oil', 'A', 2, 300, 4), stock('Rice', 'B', 50, 100, 10), { ...stock('Old', 'B', 99, 99), isActive: false } as any] }), win);
    expect(r.rows[0]).toMatchObject({ inventoryValue: 5600, lowStock: 1 });
    expect(r.rows[1]).toMatchObject({ inventoryValue: 5000, lowStock: 0 });
    expect(r.group.inventoryValue).toBe(10600);
  });
  it('a threshold of zero never counts as low stock', () => {
    const r = compareBranches(input({ inventory: [stock('Salt', 'A', 0, 10, 0)] }), win);
    expect(r.rows[0].lowStock).toBe(0);
  });
  it('staff are the active sign-in users of the branch; an owner login with no branch belongs to none and creates no row', () => {
    const r = compareBranches(input({ users: [user('a1', 'A'), user('a2', 'A'), user('a3', 'A', false), user('b1', 'B'), user('boss')] }), win);
    expect(r.rows.map(x => x.staff)).toEqual([2, 1, 0]);
  });
});

describe('periods', () => {
  it('this month runs from the 1st to now, against the same span of last month', () => {
    const w = branchWindows('month', NOW);
    expect(new Date(w.cur.start).getDate()).toBe(1);
    expect(w.cur.end).toBe(NOW);
    expect(new Date(w.prev.start).getMonth()).toBe(9);
    expect(w.prev.end - w.prev.start).toBe(w.cur.end - w.cur.start);
  });
  it('the first day of a month compares against a tiny slice of the month before without breaking', () => {
    const w = branchWindows('month', new Date(2026, 10, 1, 8).getTime());
    expect(w.prev.end).toBeGreaterThanOrEqual(w.prev.start);
  });
  it('today / 7 days / 30 days follow the dashboard', () => {
    expect(branchWindows('today', NOW).cur.end).toBe(NOW);
    expect(Math.round((branchWindows('30d', NOW).cur.end - branchWindows('30d', NOW).cur.start) / 86400000)).toBe(30);
  });
});

describe('what to highlight', () => {
  const rows = compareBranches(input({ orders: [order({ branchId: 'A', grand: 5000 }), order({ branchId: 'B', grand: 2000 }), order({ grand: 99999 })],
    transactions: [expense(100, 'A'), expense(900, 'B')] }), win).rows;
  it('best and weakest ignore the "no branch recorded" row', () => {
    expect(extremes(rows, 'sales')).toEqual({ best: 'A', weakest: 'B' });
  });
  it('for expenses lower is better', () => {
    expect(extremes(rows, 'expenses')).toEqual({ best: 'A', weakest: 'B' });
    expect(extremes(rows, 'discountPct')).toEqual({ best: null, weakest: null });   // equal (all 0) → nothing to flag
  });
  it('nothing is flagged with fewer than two active branches', () => {
    const one = compareBranches(input({ orders: [order({ branchId: 'A' })] }), win).rows;
    expect(extremes(one, 'sales')).toEqual({ best: null, weakest: null });
  });
});

describe('export', () => {
  it('has a title, a header, one line per row and the group line', () => {
    const r = compareBranches(input({ orders: [order({ branchId: 'A', grand: 100 })] }), win);
    const csv = toCsv(r, 'Last 7 days');
    expect(csv[0][0]).toContain('Last 7 days');
    expect(csv[1][0]).toBe('Branch');
    expect(csv).toHaveLength(2 + r.rows.length + 1);
    expect(csv[csv.length - 1][0]).toBe('All branches');
  });
});
