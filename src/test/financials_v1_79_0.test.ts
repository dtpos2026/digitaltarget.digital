// ============================================================================
// v1.79.0 — financial statements. Every expected number below was worked out by hand from the fixture, so a wrong
// definition fails here instead of reaching an owner's P&L.
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  buildProfitAndLoss, buildCashMovement, ageOutstanding, ageParties, ageCreditCustomers, sumAge,
  defaultExcludedCategories, recipeUnitCost, type FinancialInput,
} from '@/lib/financials';
import type { Order, InventoryItem, Recipe, Transaction, Wastage, Payslip, Party, LedgerEntry, CreditPayment } from '@/lib/types';

const T = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;
const PERIOD = { fromMs: T('2026-10-01T00:00:00Z'), toMs: T('2026-11-01T00:00:00Z') };

const inv = (id: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  id, name: id, sku: id, categoryId: 'c', costPrice: 0, salePrice: 0, quantity: 100, unit: 'kg', baseUnit: 'kg', lowStockThreshold: 5, isActive: true, ...over,
} as InventoryItem);

// Chicken costs Rs 800/kg on average; rice Rs 200/kg.
const INVENTORY: InventoryItem[] = [inv('chicken', { avgCostPrice: 800, costPrice: 700 }), inv('rice', { costPrice: 200 })];
// Biryani: 250 g chicken + 150 g rice  -> 0.25*800 + 0.15*200 = 200 + 30 = Rs 230.  Large: 500 g chicken + 300 g rice = Rs 460.
const RECIPES: Recipe[] = [
  { id: 'r1', menuItemId: 'biryani', components: [{ inventoryItemId: 'chicken', quantity: 250, unit: 'g' }, { inventoryItemId: 'rice', quantity: 150, unit: 'g' }] },
  { id: 'r2', menuItemId: 'biryani', variantKey: 'size:Large', components: [{ inventoryItemId: 'chicken', quantity: 500, unit: 'g' }, { inventoryItemId: 'rice', quantity: 300, unit: 'g' }] },
  { id: 'r3', menuItemId: 'karahi', components: [{ inventoryItemId: 'chicken', quantity: 1, unit: 'kg' }] },     // per 1 kg when sold by weight
];

let seq = 0;
function bill(over: Partial<Order> & { lines?: any[] }): Order {
  const lines = over.lines || [{ menuItemId: 'biryani', name: 'Biryani', pricingType: 'fixed', price: 500, quantity: 1, lineTotal: 500, note: '' }];
  const { lines: _l, ...rest } = over;
  return {
    id: `o${++seq}`, orderNumber: seq, orderType: 'dining', status: 'paid', paymentMethod: 'cash',
    items: lines, subtotal: lines.reduce((s, l) => s + l.lineTotal, 0), discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0,
    grandTotal: lines.reduce((s, l) => s + l.lineTotal, 0), createdAt: '2026-10-10T12:00:00Z', ...rest,
  } as unknown as Order;
}

const base = (over: Partial<FinancialInput> = {}): FinancialInput => ({
  orders: [], transactions: [], wastages: [], payslips: [], recipes: RECIPES, inventory: INVENTORY, creditPayments: [], ...over,
});

describe('recipeUnitCost', () => {
  const m = new Map(INVENTORY.map(i => [i.id, i]));
  it('converts units and prefers the average cost over the last cost', () => {
    expect(recipeUnitCost(RECIPES[0], m)).toBeCloseTo(230, 6);       // chicken uses avg 800, not last 700
    expect(recipeUnitCost(RECIPES[1], m)).toBeCloseTo(460, 6);
  });
  it('ignores a component whose inventory item is gone, instead of throwing', () => {
    expect(recipeUnitCost({ id: 'x', menuItemId: 'm', components: [{ inventoryItemId: 'missing', quantity: 1, unit: 'kg' }] }, m)).toBe(0);
  });
});

describe('profit and loss — revenue', () => {
  it('counts paid, partial and credit bills; leaves out void, complimentary, cancelled and open ones', () => {
    const orders = [
      bill({ grandTotal: 500 }),
      bill({ status: 'partial', amountPaid: 100, grandTotal: 500 }),
      bill({ paymentMethod: 'credit', grandTotal: 500 }),
      bill({ status: 'void' }), bill({ status: 'complimentary' }), bill({ status: 'cancelled' }), bill({ status: 'running' }),
    ];
    const p = buildProfitAndLoss(base({ orders }), PERIOD);
    expect(p.billCount).toBe(3);
    expect(p.netRevenue).toBe(1500);
  });

  it('only counts bills raised inside the period', () => {
    const orders = [bill({ createdAt: '2026-09-30T23:59:59Z' }), bill({ createdAt: '2026-10-01T00:00:00Z' }), bill({ createdAt: '2026-11-01T00:00:00Z' })];
    expect(buildProfitAndLoss(base({ orders }), PERIOD).billCount).toBe(1);
  });

  it('exclusive tax: net revenue drops the tax, which is shown as a liability', () => {
    // 1000 of items, 10% discount (100), 16% tax on the net 900 = 144, service 50, grand = 900 + 144 + 50 = 1094
    const o = bill({ lines: [{ menuItemId: 'x', name: 'X', pricingType: 'fixed', price: 1000, quantity: 1, lineTotal: 1000, note: '' }], subtotal: 1000, discount: 100, tax: 144, taxMode: 'exclusive', serviceCharge: 50, grandTotal: 1094 } as any);
    const p = buildProfitAndLoss(base({ orders: [o] }), PERIOD);
    expect(p.grossItemSales).toBe(1000);
    expect(p.discounts).toBe(100);
    expect(p.netItemSales).toBe(900);
    expect(p.serviceCharge).toBe(50);
    expect(p.salesTaxCollected).toBe(144);
    expect(p.netRevenue).toBe(950);             // 1094 − 144
    expect(p.unreconciled).toBe(0);             // 900 + 50 explains it exactly
  });

  it('inclusive tax: the tax inside the total is taken out of item sales', () => {
    // items 1160 tax-inclusive (16% => tax 160), no discount
    const o = bill({ lines: [{ menuItemId: 'x', name: 'X', pricingType: 'fixed', price: 1160, quantity: 1, lineTotal: 1160, note: '' }], subtotal: 1160, tax: 160, taxMode: 'inclusive', grandTotal: 1160 } as any);
    const p = buildProfitAndLoss(base({ orders: [o] }), PERIOD);
    expect(p.netItemSales).toBe(1000);
    expect(p.netRevenue).toBe(1000);
    expect(p.unreconciled).toBe(0);
  });

  it('shows money it cannot explain instead of hiding it', () => {
    const o = bill({ grandTotal: 700 });            // lines say 500, total says 700 (a manual edit)
    const p = buildProfitAndLoss(base({ orders: [o] }), PERIOD);
    expect(p.unreconciled).toBe(200);
  });

  it('can be limited to one branch', () => {
    const orders = [bill({ branchId: 'A' }), bill({ branchId: 'A' }), bill({ branchId: 'B' })];
    expect(buildProfitAndLoss(base({ orders }), PERIOD, { branchId: 'A' }).billCount).toBe(2);
    expect(buildProfitAndLoss(base({ orders }), PERIOD).billCount).toBe(3);
  });
});

describe('profit and loss — food cost', () => {
  it('costs a bill line from its recipe, at average cost, times quantity', () => {
    const o = bill({ lines: [{ menuItemId: 'biryani', name: 'Biryani', pricingType: 'fixed', price: 500, quantity: 3, lineTotal: 1500, note: '' }] });
    const p = buildProfitAndLoss(base({ orders: [o] }), PERIOD);
    expect(p.foodCost).toBe(690);                    // 3 × 230
    expect(p.foodCostCoverage).toBe(1);
  });

  it('uses the variant\'s own recipe when there is one, the default otherwise', () => {
    const o = bill({ lines: [
      { menuItemId: 'biryani', name: 'Biryani Large', pricingType: 'size', variantType: 'size', variantName: 'Large', price: 800, quantity: 1, lineTotal: 800, note: '' },
      { menuItemId: 'biryani', name: 'Biryani Small', pricingType: 'size', variantType: 'size', variantName: 'Small', price: 400, quantity: 1, lineTotal: 400, note: '' },
    ] });
    expect(buildProfitAndLoss(base({ orders: [o] }), PERIOD).foodCost).toBe(460 + 230);
  });

  it('a weight item\'s recipe is per kilogram', () => {
    const o = bill({ lines: [{ menuItemId: 'karahi', name: 'Karahi', pricingType: 'weight', weightGrams: 1500, price: 2000, quantity: 1, lineTotal: 3000, note: '' }] });
    expect(buildProfitAndLoss(base({ orders: [o] }), PERIOD).foodCost).toBe(1200);   // 1.5 kg × 800
  });

  it('says how much of the sales had no recipe, and does not pretend those lines cost nothing', () => {
    const o = bill({ lines: [
      { menuItemId: 'biryani', name: 'Biryani', pricingType: 'fixed', price: 500, quantity: 1, lineTotal: 500, note: '' },
      { menuItemId: 'cola', name: 'Cola', pricingType: 'fixed', price: 500, quantity: 1, lineTotal: 500, note: '' },
    ] });
    const p = buildProfitAndLoss(base({ orders: [o] }), PERIOD);
    expect(p.linesWithoutRecipe).toBe(1);
    expect(p.foodCostCoverage).toBe(0.5);
    expect(p.notes.some(n => /covers 50% of sales/.test(n))).toBe(true);
  });

  it('subtracts wastage from gross profit', () => {
    const o = bill({});
    const w: Wastage[] = [{ id: 'w1', date: '2026-10-12', inventoryItemId: 'chicken', inventoryItemName: 'Chicken', quantity: 1, unit: 'kg', costValue: 150, reason: 'expired' }];
    const p = buildProfitAndLoss(base({ orders: [o], wastages: w }), PERIOD);
    expect(p.wastage).toBe(150);
    expect(p.grossProfit).toBe(500 - 230 - 150);
  });
});

describe('profit and loss — operating costs and net profit', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({ id: `t${++seq}`, date: '2026-10-15', type: 'expense', categoryId: 'rent', categoryName: 'Rent', amount: 0, paymentMethod: 'cash', description: '', ...over });

  it('groups expenses by category and subtracts them, with payroll, from gross profit', () => {
    const o = bill({});
    const payslips: Payslip[] = [{ id: 'p1', employeeId: 'e', month: '2026-10', workingDays: 26, presentDays: 26, absentDays: 0, leaveDays: 0, basicSalary: 30000, allowances: 2000, overtime: 1000, bonus: 500, advance: 3000, loanDeduction: 0, otherDeductions: 0, netSalary: 30500 }];
    const transactions = [tx({ amount: 10000 }), tx({ amount: 2000, categoryId: 'util', categoryName: 'Utilities' }), tx({ type: 'income', categoryId: 'misc', categoryName: 'Scrap sale', amount: 300 })];
    const p = buildProfitAndLoss(base({ orders: [o], transactions, payslips }), PERIOD);
    expect(p.expenses.map(e => [e.label, e.amount])).toEqual([['Rent', 10000], ['Utilities', 2000]]);
    expect(p.payroll).toBe(33500);                  // gross pay: basic + allowances + overtime + bonus (the advance is a recovery, not a cost)
    expect(p.totalExpenses).toBe(45500);
    expect(p.grossProfit).toBe(270);
    expect(p.netProfit).toBe(270 + 300 - 45500);
  });

  it('leaves out excluded categories and says how much', () => {
    const transactions = [tx({ amount: 5000, categoryId: 'stock', categoryName: 'Stock Purchases' }), tx({ amount: 1000 })];
    const p = buildProfitAndLoss(base({ orders: [bill({})], transactions }), PERIOD, { excludeExpenseCategoryIds: ['stock'] });
    expect(p.expenses.map(e => e.label)).toEqual(['Rent']);
    expect(p.notes.some(n => /Rs 5,000/.test(n))).toBe(true);
  });

  it('suggests excluding stock purchases always, and salaries only when payslips exist', () => {
    const cats = [{ id: 'a', name: 'Stock Purchases', type: 'expense' }, { id: 'b', name: 'Salaries', type: 'expense' }, { id: 'c', name: 'Rent', type: 'expense' }, { id: 'd', name: 'Raw Material', type: 'income' }];
    expect(defaultExcludedCategories(cats, false)).toEqual(['a']);
    expect(defaultExcludedCategories(cats, true)).toEqual(['a', 'b']);
  });

  it('counts payroll for the months inside the period only, and not at all in a single-branch view', () => {
    const slip = (month: string): Payslip => ({ id: month, employeeId: 'e', month, workingDays: 26, presentDays: 26, absentDays: 0, leaveDays: 0, basicSalary: 1000, allowances: 0, overtime: 0, bonus: 0, advance: 0, loanDeduction: 0, otherDeductions: 0, netSalary: 1000 });
    const input = base({ payslips: [slip('2026-09'), slip('2026-10'), slip('2026-11')] });
    expect(buildProfitAndLoss(input, PERIOD).payroll).toBe(1000);
    expect(buildProfitAndLoss(input, PERIOD, { branchId: 'A' }).payroll).toBe(0);
  });

  it('margins are percentages of net revenue, and zero (not NaN) when there is none', () => {
    expect(buildProfitAndLoss(base(), PERIOD).netMarginPct).toBe(0);
    const p = buildProfitAndLoss(base({ orders: [bill({ grandTotal: 1000, lines: [{ menuItemId: 'x', name: 'X', pricingType: 'fixed', price: 1000, quantity: 1, lineTotal: 1000, note: '' }] })] }), PERIOD);
    expect(p.grossMarginPct).toBe(100);             // no recipe => no cost, and the coverage note says so
    expect(p.notes.some(n => /covers 0% of sales/.test(n))).toBe(true);
  });

  it('always states what it is not', () => {
    expect(buildProfitAndLoss(base(), PERIOD).notes.some(n => /not a double-entry ledger/.test(n))).toBe(true);
  });
});

describe('cash movement', () => {
  it('sums receipts by how they were paid, including split payments, inside the period', () => {
    const split = bill({ payments: [{ id: 'a', method: 'cash', amount: 300, at: '2026-10-10T12:00:00Z' }, { id: 'b', method: 'card', amount: 200, at: '2026-10-10T12:00:00Z' }] } as any);
    const cash = bill({ paidAt: '2026-10-11T12:00:00Z', grandTotal: 400, lines: [{ menuItemId: 'x', name: 'X', pricingType: 'fixed', price: 400, quantity: 1, lineTotal: 400, note: '' }] });
    const outside = bill({ paidAt: '2026-09-11T12:00:00Z' });
    const c = buildCashMovement(base({ orders: [split, cash, outside] }), PERIOD);
    expect(Object.fromEntries(c.receipts.map(r => [r.label, r.amount]))).toEqual({ cash: 700, card: 200 });
  });

  it('adds credit recoveries and other income, subtracts expenses and salaries actually paid', () => {
    const creditPayments: CreditPayment[] = [{ id: 'c1', orderId: 'x', amount: 1000, method: 'cash', date: '2026-10-20' }];
    const transactions: Transaction[] = [
      { id: 'i', date: '2026-10-05', type: 'income', categoryId: 'm', categoryName: 'Misc', amount: 500, paymentMethod: 'cash', description: '' },
      { id: 'e', date: '2026-10-06', type: 'expense', categoryId: 'r', categoryName: 'Rent', amount: 2000, paymentMethod: 'online', description: '' },
    ];
    const payslips: Payslip[] = [{ id: 'p', employeeId: 'e', month: '2026-10', workingDays: 26, presentDays: 26, absentDays: 0, leaveDays: 0, basicSalary: 1000, allowances: 0, overtime: 0, bonus: 0, advance: 0, loanDeduction: 0, otherDeductions: 0, netSalary: 900, paidAt: '2026-10-30' }];
    const c = buildCashMovement(base({ creditPayments, transactions, payslips }), PERIOD);
    expect(c.totalIn).toBe(1500);
    expect(c.totalOut).toBe(2900);
    expect(c.net).toBe(-1400);
  });
});

describe('ageing', () => {
  const asOf = T('2026-11-01T00:00:00Z');
  const d = (daysAgo: number) => asOf - daysAgo * DAY;

  it('matches what is owed to the NEWEST charges first', () => {
    // charges: 1000 (100 days ago), 500 (50 days ago), 200 (10 days ago); 1200 still owed => 200 (10d) + 500 (50d) + 500 of the 100-day charge
    const r = ageOutstanding(1200, [{ at: d(100), amount: 1000 }, { at: d(50), amount: 500 }, { at: d(10), amount: 200 }], asOf);
    expect(r.buckets).toEqual({ d0_30: 200, d31_60: 500, d61_90: 0, d90plus: 500, total: 1200 });
    expect(r.oldestDays).toBe(100);
  });

  it('puts an old opening balance, with no dated charge behind it, in 90+', () => {
    const r = ageOutstanding(800, [{ at: d(5), amount: 300 }], asOf);
    expect(r.buckets).toEqual({ d0_30: 300, d31_60: 0, d61_90: 0, d90plus: 500, total: 800 });
  });

  it('nothing owed → nothing aged', () => {
    expect(ageOutstanding(0, [{ at: d(5), amount: 300 }], asOf).buckets.total).toBe(0);
    expect(ageOutstanding(-50, [], asOf).buckets.total).toBe(0);
  });

  it('suppliers: credit entries are purchases we owe for, debit entries are payments; only suppliers we owe appear', () => {
    const parties: Party[] = [
      { id: 's1', type: 'supplier', name: 'Meat Co', openingBalance: 0, isActive: true },
      { id: 's2', type: 'supplier', name: 'Paid Up', openingBalance: 0, isActive: true },
      { id: 'c1', type: 'customer', name: 'Not a supplier', openingBalance: 0, isActive: true },
    ];
    const iso = (daysAgo: number) => new Date(d(daysAgo)).toISOString();
    const ledger: LedgerEntry[] = [
      { id: 'l1', partyId: 's1', date: iso(70), description: 'Chicken', debit: 0, credit: 3000 },
      { id: 'l2', partyId: 's1', date: iso(20), description: 'Chicken', debit: 0, credit: 2000 },
      { id: 'l3', partyId: 's1', date: iso(15), description: 'Payment', debit: 3500, credit: 0 },
      { id: 'l4', partyId: 's2', date: iso(40), description: 'Rice', debit: 0, credit: 1000 },
      { id: 'l5', partyId: 's2', date: iso(10), description: 'Payment', debit: 1000, credit: 0 },
    ];
    const rows = ageParties('payable', parties, ledger, asOf);
    expect(rows.map(r => r.name)).toEqual(['Meat Co']);
    // owed 5000 − 3500 = 1500: newest charge 2000 (20d) takes all 1500 → 0–30 bucket
    expect(rows[0].buckets).toEqual({ d0_30: 1500, d31_60: 0, d61_90: 0, d90plus: 0, total: 1500 });
  });

  it('customers on account: debit entries are sales, credit entries are receipts', () => {
    const parties: Party[] = [{ id: 'c1', type: 'customer', name: 'Corporate', openingBalance: 400, isActive: true }];
    const iso = (daysAgo: number) => new Date(d(daysAgo)).toISOString();
    const ledger: LedgerEntry[] = [{ id: 'l1', partyId: 'c1', date: iso(45), description: 'Catering', debit: 1000, credit: 0 }, { id: 'l2', partyId: 'c1', date: iso(5), description: 'Receipt', debit: 0, credit: 600 }];
    const rows = ageParties('receivable', parties, ledger, asOf);
    // owed 400 + 1000 − 600 = 800; the only dated charge is 1000 (45d) → 800 sits in 31–60
    expect(rows[0].buckets.d31_60).toBe(800);
    expect(rows[0].buckets.total).toBe(800);
  });

  it('ignores ledger entries after the as-of date', () => {
    const parties: Party[] = [{ id: 's', type: 'supplier', name: 'S', openingBalance: 0, isActive: true }];
    const ledger: LedgerEntry[] = [{ id: 'l', partyId: 's', date: new Date(asOf + DAY).toISOString(), description: 'future', debit: 0, credit: 999 }];
    expect(ageParties('payable', parties, ledger, asOf)).toEqual([]);
  });

  it('credit (udhaar) bills: outstanding is the bill minus payments recorded against it, grouped by customer', () => {
    const orders = [
      bill({ id: 'u1', paymentMethod: 'credit', grandTotal: 1000, createdAt: new Date(d(80)).toISOString(), creditCustomerName: 'Ali', creditCustomerPhone: '0300' } as any),
      bill({ id: 'u2', paymentMethod: 'credit', grandTotal: 500, createdAt: new Date(d(5)).toISOString(), creditCustomerName: 'Ali', creditCustomerPhone: '0300' } as any),
      bill({ id: 'u3', paymentMethod: 'credit', grandTotal: 700, createdAt: new Date(d(20)).toISOString(), creditCustomerName: 'Sara', creditCustomerPhone: '0311' } as any),
      bill({ id: 'u4', paymentMethod: 'credit', status: 'void', grandTotal: 9999, creditCustomerName: 'Void' } as any),
    ];
    const payments: CreditPayment[] = [{ id: 'p1', orderId: 'u1', amount: 400, method: 'cash', date: new Date(d(30)).toISOString() }, { id: 'p2', orderId: 'u3', amount: 700, method: 'cash', date: new Date(d(1)).toISOString() }];
    const rows = ageCreditCustomers(orders, payments, asOf);
    expect(rows.map(r => [r.name, r.buckets.total])).toEqual([['Ali', 1100]]);    // u1 balance 600 + u2 500; Sara paid in full; void ignored
    expect(rows[0].buckets).toEqual({ d0_30: 500, d31_60: 0, d61_90: 600, d90plus: 0, total: 1100 });
  });

  it('sumAge adds the rows', () => {
    const a = { d0_30: 1, d31_60: 2, d61_90: 3, d90plus: 4, total: 10 };
    expect(sumAge([{ id: 'a', name: 'a', buckets: a, oldestDays: 1 }, { id: 'b', name: 'b', buckets: a, oldestDays: 2 }])).toEqual({ d0_30: 2, d31_60: 4, d61_90: 6, d90plus: 8, total: 20 });
  });
});
