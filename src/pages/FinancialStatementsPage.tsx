// ============================================================================
// FINANCIAL STATEMENTS — profit and loss, cash movement, payables and receivables ageing (v1.79.0).
//
// A screen over lib/financials.ts. It computes nothing itself; every figure comes from the tested engine, and the engine's own
// "notes" (what is and is not included) are shown beside the numbers, not hidden in a tooltip.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, Scale, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import DateTimeRangeFilter, { type DateTimeRange } from '@/components/DateTimeRangeFilter';
import { PageHeader, SectionCard, StatCard, EmptyState } from '@/components/ui-kit';
import { money } from '@/lib/currency';
import { getCurrentBusinessDay } from '@/lib/businessDay';
import {
  getOrders, getTransactions, getWastages, getPayslips, getRecipes, getInventory, getCreditPayments,
  getParties, getLedger, getBranches, getAccountCategories, onDataChange,
} from '@/lib/store';
import { filterAllowedBranches } from '@/lib/branchAccess';
import {
  buildProfitAndLoss, buildCashMovement, ageParties, ageCreditCustomers, sumAge, defaultExcludedCategories,
  type AgeRow, type AgeBuckets, type PnLLine,
} from '@/lib/financials';
import { cn } from '@/lib/utils';

/** "Rs 12,520", and a loss as "−Rs 12,520" (a minus sign inside the currency prefix reads as a typo). */
const rs = (n: number) => (n < 0 ? '−' : '') + money(Math.round(Math.abs(n)).toLocaleString('en-PK'));
const pct = (n: number) => `${n.toFixed(1)}%`;

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(name: string, rows: (string | number)[][]) {
  const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Row({ label, value, strong, indent, muted, tone }: { label: string; value: string; strong?: boolean; indent?: boolean; muted?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <TableRow className={cn(strong && 'bg-muted/40')}>
      <TableCell className={cn(indent && 'pl-8', strong && 'font-extrabold', muted && 'text-muted-foreground')}>{label}</TableCell>
      <TableCell className={cn('text-right tabular-nums', strong && 'font-extrabold', muted && 'text-muted-foreground', tone === 'good' && 'text-[hsl(var(--status-success))]', tone === 'bad' && 'text-destructive')}>{value}</TableCell>
    </TableRow>
  );
}

function AgeTable({ rows, empty }: { rows: AgeRow[]; empty: string }) {
  const total = useMemo(() => sumAge(rows), [rows]);
  if (!rows.length) return <EmptyState title="Nothing outstanding" description={empty} />;
  const cols: [string, keyof AgeBuckets][] = [['0–30 days', 'd0_30'], ['31–60', 'd31_60'], ['61–90', 'd61_90'], ['90+', 'd90plus']];
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead>Name</TableHead>{cols.map(([l]) => <TableHead key={l} className="text-right">{l}</TableHead>)}
        <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Oldest</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {rows.map(r => (
          <TableRow key={r.id}>
            <TableCell className="font-semibold">{r.name}</TableCell>
            {cols.map(([l, k]) => <TableCell key={l} className={cn('text-right tabular-nums', k === 'd90plus' && r.buckets[k] > 0 && 'font-bold text-destructive')}>{r.buckets[k] ? rs(r.buckets[k]) : '—'}</TableCell>)}
            <TableCell className="text-right font-bold tabular-nums">{rs(r.buckets.total)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{r.oldestDays > 90 ? '90+ d' : `${r.oldestDays} d`}</TableCell>
          </TableRow>
        ))}
        <TableRow className="bg-muted/40 font-extrabold">
          <TableCell>Total</TableCell>
          {cols.map(([l, k]) => <TableCell key={l} className="text-right tabular-nums">{rs(total[k])}</TableCell>)}
          <TableCell className="text-right tabular-nums">{rs(total.total)}</TableCell><TableCell />
        </TableRow>
      </TableBody>
    </Table>
  );
}

export default function FinancialStatementsPage() {
  const [tick, setTick] = useState(0);
  useEffect(() => onDataChange(() => setTick(t => t + 1)), []);

  const [range, setRange] = useState<DateTimeRange>(() => {
    // Default: the current calendar month (business-day aware at its edges).
    const now = new Date(getCurrentBusinessDay().startMs);
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    return { startMs: from, endMs: to, preset: 'month' };
  });
  const [branchId, setBranchId] = useState<string>('all');

  const data = useMemo(() => ({
    orders: getOrders(), transactions: getTransactions(), wastages: getWastages(), payslips: getPayslips(), recipes: getRecipes(),
    inventory: getInventory(), creditPayments: getCreditPayments(), parties: getParties(), ledger: getLedger(),
    categories: getAccountCategories(), branches: filterAllowedBranches(getBranches()),
  }), [tick]);

  // Which expense categories to leave out of operating expenses. Defaults come from the engine; the owner can change them.
  const defaults = useMemo(() => defaultExcludedCategories(data.categories, data.payslips.length > 0), [data.categories, data.payslips.length]);
  const [excluded, setExcluded] = useState<string[] | null>(null);
  const excludedIds = excluded ?? defaults;
  const expenseCats = data.categories.filter(c => c.type === 'expense');

  const period = { fromMs: range.startMs, toMs: range.endMs };
  const branch = branchId === 'all' ? null : branchId;
  const pnl = useMemo(() => buildProfitAndLoss(data, period, { branchId: branch, excludeExpenseCategoryIds: excludedIds }), [data, range, branch, excludedIds]);
  const cash = useMemo(() => buildCashMovement(data, period, branch), [data, range, branch]);
  const asOf = Math.min(Date.now(), range.endMs);
  const payables = useMemo(() => ageParties('payable', data.parties, data.ledger, asOf), [data, asOf]);
  const receivables = useMemo(() => ageParties('receivable', data.parties, data.ledger, asOf), [data, asOf]);
  const udhaar = useMemo(() => ageCreditCustomers(data.orders, data.creditPayments, asOf), [data, asOf]);

  const label = `${new Date(range.startMs).toLocaleDateString()} – ${new Date(range.endMs - 1).toLocaleDateString()}`;
  const branchName = branch ? data.branches.find(b => b.id === branch)?.name || branch : 'All branches';

  const exportPnl = () => {
    const rows: (string | number)[][] = [['Profit and loss', label, branchName], [], ['Line', 'Amount']];
    const add = (l: string, v: number) => rows.push([l, v]);
    add('Gross item sales', pnl.grossItemSales); add('Discounts', -pnl.discounts); add('Net item sales', pnl.netItemSales);
    add('Service charge', pnl.serviceCharge); add('Delivery charges', pnl.deliveryCharges); add('Rounding', pnl.rounding);
    if (Math.abs(pnl.unreconciled) >= 0.5) add('Unreconciled', pnl.unreconciled);
    add('NET REVENUE (excludes sales tax)', pnl.netRevenue); add('Sales tax collected (liability)', pnl.salesTaxCollected);
    add('Food cost (recipes × average cost)', -pnl.foodCost); add('Wastage', -pnl.wastage); add('GROSS PROFIT', pnl.grossProfit);
    pnl.otherIncome.forEach(l => add(`Income: ${l.label}`, l.amount));
    pnl.expenses.forEach(l => add(`Expense: ${l.label}`, -l.amount)); add('Payroll', -pnl.payroll); add('NET PROFIT', pnl.netProfit);
    rows.push([], ['Notes']); pnl.notes.forEach(n => rows.push([n]));
    download(`profit-and-loss-${new Date(range.startMs).toISOString().slice(0, 10)}.csv`, rows);
    toast.success('Exported');
  };

  const lineRows = (lines: PnLLine[], sign: 1 | -1) => lines.map(l => <Row key={l.label} indent label={l.label} value={rs(sign * l.amount)} />);

  return (
    <div className="space-y-4 p-4 lg:p-6" data-testid="financial-statements">
      <PageHeader
        title="Financial Statements"
        description="Profit and loss, cash movement, and what is owed to suppliers and by customers — from the records you already keep."
        actions={<>
          <Button variant="outline" size="sm" onClick={exportPnl}><Download className="mr-1 h-4 w-4" /> Export P&amp;L (CSV)</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print</Button>
        </>}
      />

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <DateTimeRangeFilter value={range} onChange={setRange} />
        <label className="text-xs font-semibold text-muted-foreground">
          Branch
          <select className="mt-1 block h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="all">All branches</option>
            {data.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net revenue" value={rs(pnl.netRevenue)} hint={`${pnl.billCount} bills · ${label}`} />
        <StatCard label="Gross profit" value={rs(pnl.grossProfit)} hint={`${pct(pnl.grossMarginPct)} margin`} />
        <StatCard label="Net profit" value={rs(pnl.netProfit)} hint={`${pct(pnl.netMarginPct)} margin`} />
        <StatCard label="Cash movement" value={rs(cash.net)} hint={`in ${rs(cash.totalIn)} · out ${rs(cash.totalOut)}`} />
      </div>

      <Tabs defaultValue="pnl">
        <TabsList className="print:hidden">
          <TabsTrigger value="pnl">Profit &amp; loss</TabsTrigger>
          <TabsTrigger value="cash">Cash movement</TabsTrigger>
          <TabsTrigger value="payables">Payables</TabsTrigger>
          <TabsTrigger value="receivables">Receivables</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl" className="space-y-4">
          <SectionCard title={`Profit & loss — ${branchName}`} description={label}>
            <Table>
              <TableBody>
                <Row label="Gross item sales" value={rs(pnl.grossItemSales)} />
                <Row indent label="Less discounts" value={rs(-pnl.discounts)} />
                <Row label="Net item sales" value={rs(pnl.netItemSales)} />
                {pnl.serviceCharge !== 0 && <Row indent label="Service charge" value={rs(pnl.serviceCharge)} />}
                {pnl.deliveryCharges !== 0 && <Row indent label="Delivery charges" value={rs(pnl.deliveryCharges)} />}
                {pnl.rounding !== 0 && <Row indent label="Rounding" value={rs(pnl.rounding)} />}
                {Math.abs(pnl.unreconciled) >= 0.5 && <Row indent muted label="Not explained by the lines above (older or edited bills)" value={rs(pnl.unreconciled)} />}
                <Row strong label="Net revenue (excludes sales tax)" value={rs(pnl.netRevenue)} />
                <Row indent muted label="Sales tax collected — a liability, not revenue" value={rs(pnl.salesTaxCollected)} />
                <Row indent label="Food cost (recipes × average cost)" value={rs(-pnl.foodCost)} />
                <Row indent label="Wastage" value={rs(-pnl.wastage)} />
                <Row strong label="Gross profit" value={rs(pnl.grossProfit)} tone={pnl.grossProfit >= 0 ? 'good' : 'bad'} />
                {lineRows(pnl.otherIncome, 1).length > 0 && <TableRow><TableCell colSpan={2} className="pt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">Other income</TableCell></TableRow>}
                {lineRows(pnl.otherIncome, 1)}
                <TableRow><TableCell colSpan={2} className="pt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">Operating expenses</TableCell></TableRow>
                {lineRows(pnl.expenses, -1)}
                <Row indent label={`Payroll${pnl.payrollMonths ? ` (${pnl.payrollMonths} month${pnl.payrollMonths > 1 ? 's' : ''})` : ''}`} value={rs(-pnl.payroll)} />
                <Row strong label="Net profit" value={rs(pnl.netProfit)} tone={pnl.netProfit >= 0 ? 'good' : 'bad'} />
              </TableBody>
            </Table>
          </SectionCard>

          <SectionCard title="Read this with the figures" description="What is and is not in the statement.">
            <ul className="space-y-2 text-[13px]">
              {pnl.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  {/covers \d+% of sales|Not a double|not a double/.test(n) ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-warning))]" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Expense categories" description="Untick a category to count it as an expense; tick it to leave it out because its cost is already counted elsewhere.">
            {expenseCats.length === 0 ? <p className="text-sm text-muted-foreground">No expense categories yet (Accounts).</p> : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {expenseCats.map(c => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={excludedIds.includes(c.id)} onCheckedChange={v => setExcluded(prev => {
                      const cur = prev ?? defaults;
                      return v ? [...new Set([...cur, c.id])] : cur.filter(x => x !== c.id);
                    })} />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="cash">
          <SectionCard title={`Cash movement — ${branchName}`} description={`${label}. What came in and went out; not a balance.`}>
            <Table>
              <TableBody>
                <TableRow><TableCell colSpan={2} className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Money in</TableCell></TableRow>
                {lineRows(cash.receipts, 1)}
                {cash.creditRecoveries > 0 && <Row indent label="Credit (udhaar) recovered" value={rs(cash.creditRecoveries)} />}
                {cash.otherIncome > 0 && <Row indent label="Other income" value={rs(cash.otherIncome)} />}
                <Row strong label="Total in" value={rs(cash.totalIn)} />
                <TableRow><TableCell colSpan={2} className="pt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">Money out</TableCell></TableRow>
                {lineRows(cash.expenses, -1)}
                {cash.payrollPaid > 0 && <Row indent label="Salaries paid" value={rs(-cash.payrollPaid)} />}
                <Row strong label="Total out" value={rs(-cash.totalOut)} />
                <Row strong label="Net movement" value={rs(cash.net)} tone={cash.net >= 0 ? 'good' : 'bad'} />
              </TableBody>
            </Table>
          </SectionCard>
        </TabsContent>

        <TabsContent value="payables">
          <SectionCard title="Payables — what we owe suppliers" description={`As of ${new Date(asOf).toLocaleDateString()}. Aged from the newest purchases back.`}>
            <AgeTable rows={payables} empty="No supplier balance is owed. Suppliers live in Party Master; purchases on credit are ledger credits." />
          </SectionCard>
        </TabsContent>

        <TabsContent value="receivables" className="space-y-4">
          <SectionCard title="Receivables — credit (udhaar) customers" description="Credit bills minus payments recorded against them.">
            <AgeTable rows={udhaar} empty="No credit bills are outstanding." />
          </SectionCard>
          <SectionCard title="Receivables — customer accounts (Party Master)" description="Customers kept as parties with a ledger.">
            <AgeTable rows={receivables} empty="No customer account balance is owed." />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <p className="flex items-center gap-2 text-xs text-muted-foreground print:hidden"><Scale className="h-3.5 w-3.5" /> Not a double-entry ledger: no chart of accounts, journal or balance sheet.</p>
    </div>
  );
}
