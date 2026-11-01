// ============================================================================
// FINANCIAL STATEMENTS — profit and loss, cash movement, payables and receivables ageing.
//
// WHY THIS EXISTS (v1.79.0): the benchmark analysis (docs/COMPETITIVE-ANALYSIS-TECHNOSYS.md) found no financial statements in
// the product at all — income and expense transactions, a party ledger and a cash close, but no profit and loss, no
// ageing. A restaurant owner could see sales and could see expenses and had to subtract them by hand.
//
// WHAT THIS IS NOT: a double-entry general ledger. There is no chart of accounts, no journal and no balance sheet here, and
// the screen says so. These statements are computed from the records the product already keeps, with the definitions below,
// so every figure can be traced to those records.
//
// PURE: no store, no network, no clock — everything arrives as arguments, so every number is reproducible in a test.
// ============================================================================
import type { Order, Transaction, Wastage, Payslip, Recipe, InventoryItem, CreditPayment, Party, LedgerEntry } from './types';
import { bucketize } from './sales';
import { toBaseQty } from './units';

export interface Period { fromMs: number; toMs: number }          // [from, to)

export interface FinancialInput {
  orders: Order[];
  transactions: Transaction[];
  wastages: Wastage[];
  payslips: Payslip[];
  recipes: Recipe[];
  inventory: InventoryItem[];
  creditPayments: CreditPayment[];
}

export interface PnLOptions {
  /** Only this branch's bills. Costs that carry no branch are included only when this is null/undefined ("all branches"). */
  branchId?: string | null;
  /** Expense categories left out of operating expenses (stock purchases are already in food cost; see defaultExcludedCategories). */
  excludeExpenseCategoryIds?: string[];
}

export interface PnLLine { label: string; amount: number; note?: string }

export interface ProfitAndLoss {
  period: Period;
  branchId: string | null;
  billCount: number;
  // ---- revenue (accrual: bills raised in the period, whether or not paid yet)
  grossItemSales: number;
  discounts: number;
  netItemSales: number;
  serviceCharge: number;
  deliveryCharges: number;
  rounding: number;
  /** Bill money that is not explained by the lines above (older bills, manual edits). Shown, never hidden. */
  unreconciled: number;
  netRevenue: number;                 // excludes sales tax
  salesTaxCollected: number;          // a liability, not revenue
  // ---- cost of goods
  foodCost: number;                   // theoretical, from recipes at average cost
  foodCostCoverage: number;           // 0..1 of net item sales whose items have a recipe
  linesWithoutRecipe: number;
  wastage: number;
  grossProfit: number;
  grossMarginPct: number;
  // ---- operating
  otherIncome: PnLLine[];
  expenses: PnLLine[];
  payroll: number;
  payrollMonths: number;
  totalExpenses: number;
  netProfit: number;
  netMarginPct: number;
  /** Plain-language limits of this statement, to be shown with it. */
  notes: string[];
}

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const inPeriod = (iso: string | undefined, p: Period) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && t >= p.fromMs && t < p.toMs;
};
const monthStartMs = (ym: string) => { const [y, m] = ym.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, 1); };

/** A recipe for this bill line: the variant's own, else the item's default. */
function recipeFor(recipes: Map<string, Recipe>, line: { menuItemId: string; variantType?: string; variantName?: string }): Recipe | undefined {
  const vk = line.variantType && line.variantName ? `${line.variantType}:${line.variantName}` : '';
  return (vk && recipes.get(`${line.menuItemId}|${vk}`)) || recipes.get(`${line.menuItemId}|`);
}

/** Cost of ONE unit of a menu item from its recipe, at the inventory's average cost. */
export function recipeUnitCost(recipe: Recipe, inventory: Map<string, InventoryItem>): number {
  let cost = 0;
  for (const c of recipe.components) {
    const item = inventory.get(c.inventoryItemId);
    if (!item) continue;
    cost += toBaseQty(item, c.quantity, c.unit) * (item.avgCostPrice ?? item.costPrice ?? 0);
  }
  return cost;
}

/** Categories that should not also be charged as an expense: stock purchases are already inside food cost. */
export function defaultExcludedCategories(categories: { id: string; name: string; type: string }[], hasPayslips: boolean): string[] {
  return categories
    .filter(c => c.type === 'expense')
    .filter(c => /purchase|stock|raw material|inventory|ingredient/i.test(c.name) || (hasPayslips && /salar|payroll/i.test(c.name)))
    .map(c => c.id);
}

export function buildProfitAndLoss(input: FinancialInput, period: Period, opts: PnLOptions = {}): ProfitAndLoss {
  const branch = opts.branchId ?? null;
  const exclude = new Set(opts.excludeExpenseCategoryIds || []);
  const notes: string[] = [];

  // ---- bills of the period: raised, not void / complimentary / cancelled / still open
  const bills = input.orders.filter(o => {
    const b = bucketize(o);
    if (b !== 'paid' && b !== 'partial' && b !== 'credit') return false;
    if (!inPeriod(o.createdAt, period)) return false;
    return !branch || o.branchId === branch;
  });

  let grossItemSales = 0, discounts = 0, netItemSales = 0, serviceCharge = 0, deliveryCharges = 0, rounding = 0, tax = 0, grand = 0;
  for (const o of bills) {
    const sub = Number(o.subtotal) || 0, disc = Number(o.discount) || 0, t = Number(o.tax) || 0;
    grossItemSales += sub;
    discounts += disc;
    netItemSales += sub - disc - (o.taxMode === 'inclusive' ? t : 0);
    serviceCharge += Number(o.serviceCharge) || 0;
    deliveryCharges += Number(o.deliveryChargeAmount) || 0;
    rounding += Number(o.roundingAdjust) || 0;
    tax += t;
    grand += Number(o.grandTotal) || 0;
  }
  const netRevenue = grand - tax;
  const unreconciled = netRevenue - (netItemSales + serviceCharge + deliveryCharges + rounding);

  // ---- food cost from recipes
  const inv = new Map(input.inventory.map(i => [i.id, i]));
  const recipes = new Map(input.recipes.map(r => [`${r.menuItemId}|${r.variantKey || ''}`, r]));
  const unitCost = new Map<string, number>();
  let foodCost = 0, coveredSales = 0, allLineSales = 0, linesWithoutRecipe = 0;
  for (const o of bills) {
    for (const line of o.items || []) {
      const lineSales = Number(line.lineTotal) || 0;
      allLineSales += lineSales;
      const rec = recipeFor(recipes, line);
      if (!rec) { linesWithoutRecipe++; continue; }
      let uc = unitCost.get(rec.id);
      if (uc === undefined) { uc = recipeUnitCost(rec, inv); unitCost.set(rec.id, uc); }
      // A weight item's recipe is "per 1 kg"; every other item's is per unit.
      const qty = line.pricingType === 'weight' && line.weightGrams ? line.weightGrams / 1000 : Number(line.quantity) || 0;
      foodCost += uc * qty;
      coveredSales += lineSales;
    }
  }
  const foodCostCoverage = allLineSales > 0 ? coveredSales / allLineSales : 1;

  const wastage = input.wastages
    .filter(w => inPeriod(w.date, period) && (!branch || (w as any).branchId === branch))
    .reduce((s, w) => s + (Number(w.costValue) || 0), 0);

  const grossProfit = netRevenue - foodCost - wastage;

  // ---- operating
  const txns = input.transactions.filter(t => inPeriod(t.date, period) && (!branch || (t as any).branchId === branch));
  const sumBy = (type: 'income' | 'expense', skip: (t: Transaction) => boolean) => {
    const m = new Map<string, number>();
    for (const t of txns) if (t.type === type && !skip(t)) m.set(t.categoryName || 'Uncategorised', (m.get(t.categoryName || 'Uncategorised') || 0) + (Number(t.amount) || 0));
    return [...m.entries()].map(([label, amount]) => ({ label, amount: r2(amount) })).sort((a, b) => b.amount - a.amount);
  };
  const expenses = sumBy('expense', t => exclude.has(t.categoryId));
  const otherIncome = sumBy('income', () => false);
  const excludedTotal = txns.filter(t => t.type === 'expense' && exclude.has(t.categoryId)).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  if (excludedTotal > 0) notes.push(`Expense categories left out because their cost is already counted (stock purchases are inside food cost; salaries are inside payroll): Rs ${Math.round(excludedTotal).toLocaleString()}.`);

  const months = new Set<string>();
  let payroll = 0;
  if (!branch) {
    for (const p of input.payslips) {
      if (!p.month || !inPeriod(new Date(monthStartMs(p.month)).toISOString(), period)) continue;
      months.add(p.month);
      payroll += (Number(p.basicSalary) || 0) + (Number(p.allowances) || 0) + (Number(p.overtime) || 0) + (Number(p.bonus) || 0);
    }
  }

  const expenseTotal = expenses.reduce((s, l) => s + l.amount, 0);
  const incomeTotal = otherIncome.reduce((s, l) => s + l.amount, 0);
  const totalExpenses = expenseTotal + payroll;
  const netProfit = grossProfit + incomeTotal - totalExpenses;

  // ---- the limits, stated
  if (foodCostCoverage < 0.999) notes.push(`Food cost covers ${(foodCostCoverage * 100).toFixed(0)}% of sales: ${linesWithoutRecipe} bill line(s) have no recipe, so their cost is not included and profit is overstated by that much.`);
  notes.push('Revenue is accrual: bills raised in the period, including credit (udhaar) not yet collected. Sales tax is shown separately and is not revenue.');
  notes.push('Food cost is theoretical (recipes × average cost), not a stock count. Wastage is added on top.');
  if (branch) notes.push('Payroll is not split by branch, and expenses/wastage count only when they carry a branch. Choose "All branches" for the full picture.');
  if (!branch && months.size === 0 && input.payslips.length === 0) notes.push('No payslips recorded: payroll is Rs 0 unless salaries are entered as expenses.');
  notes.push('This is not a double-entry ledger: there is no chart of accounts, no journal and no balance sheet.');

  const pct = (n: number) => (netRevenue > 0 ? (n / netRevenue) * 100 : 0);
  return {
    period, branchId: branch, billCount: bills.length,
    grossItemSales: r2(grossItemSales), discounts: r2(discounts), netItemSales: r2(netItemSales), serviceCharge: r2(serviceCharge),
    deliveryCharges: r2(deliveryCharges), rounding: r2(rounding), unreconciled: r2(unreconciled), netRevenue: r2(netRevenue),
    salesTaxCollected: r2(tax),
    foodCost: r2(foodCost), foodCostCoverage, linesWithoutRecipe, wastage: r2(wastage),
    grossProfit: r2(grossProfit), grossMarginPct: r2(pct(grossProfit)),
    otherIncome, expenses, payroll: r2(payroll), payrollMonths: months.size, totalExpenses: r2(totalExpenses),
    netProfit: r2(netProfit), netMarginPct: r2(pct(netProfit)),
    notes,
  };
}

// ============================================================================
// CASH MOVEMENT — what came in and went out in the period, by how it was paid. Not a balance: the product keeps no
// opening cash balance outside the day close.
// ============================================================================
export interface CashMovement {
  receipts: PnLLine[];                 // by payment method, from bills collected in the period
  creditRecoveries: number;            // udhaar collected
  otherIncome: number;
  totalIn: number;
  expenses: PnLLine[];                 // by payment method
  payrollPaid: number;
  totalOut: number;
  net: number;
}

export function buildCashMovement(input: FinancialInput, period: Period, branchId?: string | null): CashMovement {
  const branch = branchId ?? null;
  const by = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) || 0) + v);

  for (const o of input.orders) {
    if (branch && o.branchId !== branch) continue;
    const b = bucketize(o);
    if (b !== 'paid' && b !== 'partial') continue;
    const pays = o.payments && o.payments.length ? o.payments : [{ method: o.paymentMethod || 'cash', amount: Number(o.amountPaid ?? o.grandTotal) || 0, at: o.paidAt || o.createdAt } as any];
    for (const p of pays) {
      const when = p.at || p.date || o.paidAt || o.createdAt;
      if (inPeriod(when, period)) add(by, String(p.method || 'cash'), Number(p.amount) || 0);
    }
  }
  const credit = input.creditPayments.filter(p => inPeriod(p.date, period)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const txns = input.transactions.filter(t => inPeriod(t.date, period) && (!branch || (t as any).branchId === branch));
  const exp = new Map<string, number>();
  let income = 0;
  for (const t of txns) {
    if (t.type === 'income') income += Number(t.amount) || 0;
    else add(exp, String(t.paymentMethod || 'cash'), Number(t.amount) || 0);
  }
  const payrollPaid = branch ? 0 : input.payslips
    .filter(p => p.paidAt && inPeriod(p.paidAt, period))
    .reduce((s, p) => s + (Number(p.netSalary) || 0), 0);

  const lines = (m: Map<string, number>) => [...m.entries()].map(([label, amount]) => ({ label, amount: r2(amount) })).sort((a, b) => b.amount - a.amount);
  const receipts = lines(by);
  const expenses = lines(exp);
  const totalIn = receipts.reduce((s, l) => s + l.amount, 0) + credit + income;
  const totalOut = expenses.reduce((s, l) => s + l.amount, 0) + payrollPaid;
  return { receipts, creditRecoveries: r2(credit), otherIncome: r2(income), totalIn: r2(totalIn), expenses, payrollPaid: r2(payrollPaid), totalOut: r2(totalOut), net: r2(totalIn - totalOut) };
}

// ============================================================================
// AGEING — how old is what is owed. Amounts owed are matched to the NEWEST charges first (the oldest charges are the ones
// that were paid off), which is the usual way to age a running balance.
// ============================================================================
export interface AgeBuckets { d0_30: number; d31_60: number; d61_90: number; d90plus: number; total: number }
export interface AgeRow { id: string; name: string; buckets: AgeBuckets; oldestDays: number }

const DAY = 86_400_000;
const emptyBuckets = (): AgeBuckets => ({ d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 });
function bucketOf(days: number): keyof Omit<AgeBuckets, 'total'> {
  return days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';
}

/** Allocate `outstanding` to dated charges, newest first; whatever is left is older than every charge (90+). */
export function ageOutstanding(outstanding: number, charges: { at: number; amount: number }[], asOfMs: number): { buckets: AgeBuckets; oldestDays: number } {
  const b = emptyBuckets();
  let left = Math.max(0, outstanding);
  let oldest = 0;
  for (const c of [...charges].sort((x, y) => y.at - x.at)) {
    if (left <= 0.005) break;
    const take = Math.min(left, Math.max(0, c.amount));
    if (take <= 0) continue;
    const days = Math.max(0, Math.floor((asOfMs - c.at) / DAY));
    b[bucketOf(days)] += take;
    oldest = Math.max(oldest, days);
    left -= take;
  }
  if (left > 0.005) { b.d90plus += left; oldest = Math.max(oldest, 91); }
  b.total = b.d0_30 + b.d31_60 + b.d61_90 + b.d90plus;
  return { buckets: { d0_30: r2(b.d0_30), d31_60: r2(b.d31_60), d61_90: r2(b.d61_90), d90plus: r2(b.d90plus), total: r2(b.total) }, oldestDays: oldest };
}

/**
 * Party ledger convention (types.ts): balance = opening + Σdebit − Σcredit, positive = they owe us.
 * Suppliers: a credit entry is a purchase we owe for, a debit is a payment to them.
 * Customers: a debit entry is a sale on account, a credit is a receipt.
 */
export function ageParties(kind: 'payable' | 'receivable', parties: Party[], ledger: LedgerEntry[], asOfMs: number): AgeRow[] {
  const type = kind === 'payable' ? 'supplier' : 'customer';
  const rows: AgeRow[] = [];
  for (const p of parties) {
    if (p.type !== type || p.isActive === false) continue;
    const entries = ledger.filter(l => l.partyId === p.id && Date.parse(l.date) <= asOfMs);
    const balance = (Number(p.openingBalance) || 0) + entries.reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    const owed = kind === 'payable' ? -balance : balance;
    if (owed <= 0.005) continue;
    const charges = entries
      .map(l => ({ at: Date.parse(l.date), amount: kind === 'payable' ? Number(l.credit) || 0 : Number(l.debit) || 0 }))
      .filter(c => c.amount > 0 && Number.isFinite(c.at));
    const { buckets, oldestDays } = ageOutstanding(owed, charges, asOfMs);
    rows.push({ id: p.id, name: p.name, buckets, oldestDays });
  }
  return rows.sort((a, b) => b.buckets.total - a.buckets.total);
}

/** Credit (udhaar) bills: outstanding = bill total − payments recorded against it, exactly as the Credit screens compute it. */
export function ageCreditCustomers(orders: Order[], payments: CreditPayment[], asOfMs: number): AgeRow[] {
  const byCustomer = new Map<string, { name: string; charges: { at: number; amount: number }[]; owed: number }>();
  for (const o of orders) {
    if (o.paymentMethod !== 'credit' || o.status === 'void' || o.status === 'cancelled') continue;
    const at = Date.parse(o.createdAt);
    if (!Number.isFinite(at) || at > asOfMs) continue;
    const paid = payments.filter(p => p.orderId === o.id && Date.parse(p.date) <= asOfMs).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const balance = Math.max(0, (Number(o.grandTotal) || 0) - paid);
    if (balance <= 0.005) continue;
    const name = o.creditCustomerName || o.customer?.name || 'Unnamed customer';
    const key = (o.creditCustomerPhone || o.customer?.phone || name).trim().toLowerCase();
    const row = byCustomer.get(key) || { name, charges: [], owed: 0 };
    row.charges.push({ at, amount: balance });          // already net of its own payments
    row.owed += balance;
    byCustomer.set(key, row);
  }
  return [...byCustomer.entries()].map(([id, r]) => {
    const { buckets, oldestDays } = ageOutstanding(r.owed, r.charges, asOfMs);
    return { id, name: r.name, buckets, oldestDays };
  }).sort((a, b) => b.buckets.total - a.buckets.total);
}

export function sumAge(rows: AgeRow[]): AgeBuckets {
  const t = emptyBuckets();
  for (const r of rows) { t.d0_30 += r.buckets.d0_30; t.d31_60 += r.buckets.d31_60; t.d61_90 += r.buckets.d61_90; t.d90plus += r.buckets.d90plus; t.total += r.buckets.total; }
  return { d0_30: r2(t.d0_30), d31_60: r2(t.d31_60), d61_90: r2(t.d61_90), d90plus: r2(t.d90plus), total: r2(t.total) };
}
