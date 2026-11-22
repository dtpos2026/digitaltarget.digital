// ============================================================
// v1.149.0 — Accounts & expenses as the design draws it (SW-25): the month under the title, Daily wages · Add expense, three figure cards (Expenses this month
// "▲ 20% vs Sept" · Cash on hand · Bank), a search with the categories as chips and one table (Date · Category · Account · Note · Amount). Pinned: the sums and
// words in lib/accountsBoard.ts, the page under DT Refined (cards, filters, add, delete, the other tabs, the PDF reports), the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getTransactions } from '@/lib/store';
import {
  accountWord, bankBalance, cashOnHand, categoryChips, dayLabel, deltaCaption, deltaTone, matchesTxn, monthFigure, monthLabel, previousMonthShort, salesThisMonth, txnRows,
} from '@/lib/accountsBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
// the reports are built for real, but "save" writes nothing — a test must not leave a PDF in the repository
vi.mock('jspdf', async (orig) => {
  const mod: any = await orig();
  const Real = mod.default;
  class NoSave extends Real { constructor(...a: any[]) { super(...a); (this as any).save = () => this; } }
  return { ...mod, default: NoSave, jsPDF: NoSave };
});
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

// dates that are always in this month / last month, whatever day the suite runs on
const NOW = new Date();
const ym = (back: number) => { const d = new Date(NOW.getFullYear(), NOW.getMonth() - back, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const thisMonth = (day: number) => `${ym(0)}-${String(day).padStart(2, '0')}`;
const lastMonth = (day: number) => `${ym(1)}-${String(day).padStart(2, '0')}`;

const tx = (id: string, date: string, type: 'income' | 'expense', ci: number, cat: string, method: string, desc: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ id, date, type, categoryId: `c${ci}`, categoryName: cat, amount, paymentMethod: method, description: desc, ...extra }) as any;
const TXNS = () => [
  tx('x1', thisMonth(5), 'expense', 3, 'Supplies', 'cash', 'Al-Noor Poultry', 10000, { partyName: 'Al-Noor Poultry' }),
  tx('x2', thisMonth(4), 'expense', 1, 'Utilities', 'online', 'Electricity bill', 86200, { reference: 'LESCO-8841' }),
  tx('x3', lastMonth(12), 'expense', 3, 'Supplies', 'card', 'Vegetables', 80000),
  tx('i1', thisMonth(2), 'income', 9, 'Catering', 'online', 'Wedding tray order', 45000),
];
const CATS = [
  { id: 'c0', name: 'Rent', type: 'expense' }, { id: 'c1', name: 'Utilities', type: 'expense' }, { id: 'c3', name: 'Supplies', type: 'expense' }, { id: 'c9', name: 'Catering', type: 'income' },
] as any[];
const ORDERS = () => [
  { id: 'o1', orderNumber: 1, status: 'paid', paymentMethod: 'cash', grandTotal: 5000, paidAt: `${thisMonth(3)}T10:00:00.000Z` },
  { id: 'o2', orderNumber: 2, status: 'paid', paymentMethod: 'card', grandTotal: 3000, paidAt: `${thisMonth(3)}T11:00:00.000Z` },
  { id: 'o3', orderNumber: 3, status: 'running', paymentMethod: 'cash', grandTotal: 9999, paidAt: undefined },
] as any[];
const ACCOUNTS = [
  { id: 'a1', name: 'Cash drawer', type: 'cash', isActive: true, openingBalance: 20000 },
  { id: 'a2', name: 'Meezan', type: 'bank', isActive: true, openingBalance: 300000 },
  { id: 'a3', name: 'Old wallet', type: 'wallet', isActive: false, openingBalance: 999999 },
] as any[];

describe('the words', () => {
  it('monthLabel, previousMonthShort ("Sept" the way the design writes it), dayLabel', () => {
    expect(monthLabel(new Date(2026, 9, 15))).toBe('October 2026');
    expect(previousMonthShort(new Date(2026, 9, 15))).toBe('Sept');
    expect(previousMonthShort(new Date(2026, 0, 3))).toBe('Dec');
    expect(previousMonthShort(new Date(2026, 3, 3))).toBe('Mar');
    expect(dayLabel('2026-10-30')).toBe('30 Oct'); expect(dayLabel('2026-03-05T08:00:00.000Z')).toBe('05 Mar');
    expect(dayLabel('')).toBe('—'); expect(dayLabel(undefined)).toBe('—'); expect(dayLabel('2026-13-01')).toBe('—'); expect(dayLabel('junk')).toBe('—');
  });
  it('accountWord: Cash · Card · Online · On credit, anything else as typed', () => {
    expect(accountWord('cash')).toBe('Cash'); expect(accountWord('card')).toBe('Card'); expect(accountWord('online')).toBe('Online'); expect(accountWord('credit')).toBe('On credit');
    expect(accountWord('JazzCash')).toBe('JazzCash'); expect(accountWord(undefined)).toBe('—');
  });
  it('deltaCaption and tone: more spending is bad, more income is good, nothing to compare to says nothing', () => {
    const now = new Date(2026, 9, 15);
    expect(deltaCaption(4, now)).toBe('▲ 4% vs Sept'); expect(deltaCaption(-12, now)).toBe('▼ 12% vs Sept'); expect(deltaCaption(0, now)).toBe('Same as Sept'); expect(deltaCaption(null, now)).toBe('');
    expect(deltaTone(4, 'expense')).toBe('bad'); expect(deltaTone(-12, 'expense')).toBe('ok');
    expect(deltaTone(4, 'income')).toBe('ok'); expect(deltaTone(-12, 'income')).toBe('bad');
    expect(deltaTone(0, 'expense')).toBeUndefined(); expect(deltaTone(null, 'income')).toBeUndefined();
  });
});

describe('the sums', () => {
  it('monthFigure: this month, last month and the whole-percent change; no change figure when last month was empty', () => {
    const f = monthFigure(TXNS(), 'expense', NOW);
    expect(f.total).toBe(96200); expect(f.previous).toBe(80000); expect(f.deltaPct).toBe(20);         // 16,200 / 80,000 = 20.25 %
    expect(monthFigure(TXNS(), 'income', NOW)).toEqual({ total: 45000, previous: 0, deltaPct: null });
    expect(monthFigure([], 'expense', NOW)).toEqual({ total: 0, previous: 0, deltaPct: null });
    expect(monthFigure([tx('z', thisMonth(1), 'expense', 1, 'x', 'cash', '', 'nope' as any)], 'expense', NOW).total).toBe(0);   // junk amounts are zero, not NaN
  });
  it('salesThisMonth counts paid orders of the month only', () => { expect(salesThisMonth(ORDERS(), NOW)).toBe(8000); });
  it('cashOnHand: before any close, the cash drawers\' opening plus cash sales and cash transactions; after a close, what was counted plus what moved since', () => {
    expect(cashOnHand(ORDERS(), TXNS(), [], ACCOUNTS)).toBe(15000);              // 20,000 + 5,000 cash sale − 10,000 cash expense
    const closes = [{ date: thisMonth(4), countedCash: 40000 }, { date: lastMonth(1), countedCash: 1 }] as any[];
    expect(cashOnHand(ORDERS(), TXNS(), closes, ACCOUNTS)).toBe(40000 - 10000);  // the last close is the 4th; the cash expense on the 5th is after it, the sale on the 3rd is before it
  });
  it('bankBalance: the bank-type accounts\' opening plus card and online takings and transactions, less card and online spending; inactive accounts do not count', () => {
    expect(bankBalance(ORDERS(), TXNS(), ACCOUNTS)).toBe(300000 + 3000 + 45000 - 86200 - 80000);
  });
});

describe('the rows', () => {
  it('categoryChips: All, then the categories of that kind in the order they were made', () => {
    expect(categoryChips(CATS, 'expense').map(c => c.label)).toEqual(['All', 'Rent', 'Utilities', 'Supplies']);
    expect(categoryChips(CATS, 'income').map(c => c.label)).toEqual(['All', 'Catering']);
  });
  it('txnRows: one kind, newest first, in the category and search chosen; the search reads category, note, party, reference, account and amount', () => {
    expect(txnRows(TXNS(), 'expense').map(t => t.id)).toEqual(['x1', 'x2', 'x3']);
    expect(txnRows(TXNS(), 'expense', 'c3').map(t => t.id)).toEqual(['x1', 'x3']);
    expect(txnRows(TXNS(), 'expense', 'all', 'lesco').map(t => t.id)).toEqual(['x2']);
    expect(txnRows(TXNS(), 'expense', 'all', 'noor').map(t => t.id)).toEqual(['x1']);
    expect(txnRows(TXNS(), 'expense', 'all', 'online').map(t => t.id)).toEqual(['x2']);
    expect(txnRows(TXNS(), 'income').map(t => t.id)).toEqual(['i1']);
    expect(matchesTxn(TXNS()[0], '10000')).toBe(true); expect(matchesTxn(TXNS()[0], 'zzz')).toBe(false); expect(matchesTxn(TXNS()[0], '  ')).toBe(true);
  });
});

function seed(over: Record<string, unknown> = {}) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: ORDERS(), tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], inventory: [],
    transactions: TXNS(), accountCategories: CATS, paymentAccounts: ACCOUNTS, dailyCashCloses: [], parties: [], ledger: [], orderCounter: 100, ...over,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/AccountsPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const goTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
const kpi = (label: string) => document.querySelector(`[data-kpi="${label}"]`) as HTMLElement;
const rows = () => [...document.querySelectorAll('[data-ac-row]')] as HTMLElement[];

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); window.location.hash = '#/accounts'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, the month, Daily wages and Add expense; the tabs with Expenses first and picked', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Accounts & expenses');
    expect(document.querySelector('[data-ac-subtitle]')!.textContent).toBe(monthLabel());
    expect(screen.getByRole('button', { name: /Daily wages/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add expense/ })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Expenses', 'Income', 'Overview', 'Payment A/Cs', 'Parties', 'Ledger', 'Cash Close']);
    expect(screen.getByRole('tab', { name: 'Expenses' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-slot="tabs-list"]')!.getAttribute('data-tabs')).toBe('underline');
  });

  it('the three cards: Expenses this month with the change against last month, Cash on hand, Bank', async () => {
    await mount();
    expect(kpi('Expenses this month').textContent).toContain('Rs 96,200');
    expect(kpi('Expenses this month').textContent).toContain(`▲ 20% vs ${previousMonthShort()}`);
    expect(kpi('Cash on hand').textContent).toContain('Rs 15,000');
    expect(kpi('Bank').textContent).toContain('Rs 181,800');
  });

  it('the table: Date · Category · Account · Note · Amount, newest first, expenses only', async () => {
    await mount();
    expect([...document.querySelectorAll('[data-ac-table] thead th')].map(t => t.textContent)).toEqual(['Date', 'Category', 'Account', 'Note', 'Amount', '']);
    expect(rows().map(r => r.getAttribute('data-ac-row'))).toEqual(['x1', 'x2', 'x3']);
    const first = rows()[0].textContent!;
    expect(first).toContain(dayLabel(thisMonth(5))); expect(first).toContain('Supplies'); expect(first).toContain('Cash'); expect(first).toContain('Al-Noor Poultry'); expect(first).toContain('Rs 10,000');
    expect(rows()[1].textContent).toContain('LESCO-8841');                       // the reference sits under the note
    expect(screen.queryByText('Wedding tray order')).toBeNull();                // income is on its own tab
  });

  it('the chips are All and the expense categories; one filters the table, the search narrows it, and "Nothing matches" says so', async () => {
    await mount();
    expect([...document.querySelectorAll('[data-ac-chip]')].map(c => c.textContent)).toEqual(['All', 'Rent', 'Utilities', 'Supplies']);
    fireEvent.click(document.querySelector('[data-ac-chip="c3"]')!);
    expect(rows().map(r => r.getAttribute('data-ac-row'))).toEqual(['x1', 'x3']);
    expect(document.querySelector('[data-ac-chip="c3"]')!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('searchbox', { name: /Search expenses/ }), { target: { value: 'vegetables' } });
    expect(rows().map(r => r.getAttribute('data-ac-row'))).toEqual(['x3']);
    fireEvent.change(screen.getByRole('searchbox', { name: /Search expenses/ }), { target: { value: 'zzz' } });
    expect(document.querySelector('[data-ac-empty]')!.textContent).toBe('Nothing matches.');
  });

  it('Add expense opens the form; saving with nothing filled in is refused, and a filled one is saved and shows in the table and the cards', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Add expense/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Add expense')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(toast.error).toHaveBeenCalled();
    expect(getTransactions().length).toBe(4);
    // fill it: amount, a category from the dropdown, a note
    fireEvent.change(within(dlg).getAllByRole('spinbutton')[0], { target: { value: '2500' } });
    fireEvent.keyDown(within(dlg).getAllByRole('combobox')[0], { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Rent' }), { key: 'Enter' });
    fireEvent.change(within(dlg).getByText('Description').parentElement!.querySelector('input')!, { target: { value: 'Mop and bucket' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(getTransactions().length).toBe(5));
    const saved = getTransactions().find(t => t.description === 'Mop and bucket')!;
    expect(saved).toMatchObject({ type: 'expense', amount: 2500, categoryName: 'Rent', paymentMethod: 'cash' });
    expect(rows().some(r => r.textContent!.includes('Mop and bucket') && r.textContent!.includes('Rs 2,500'))).toBe(true);
    expect(kpi('Expenses this month').textContent).toContain('Rs 98,700');
  });

  it('Delete asks first: No keeps the entry, Yes removes it and the card follows', async () => {
    await mount();
    Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => false) });
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Delete' }));
    expect(getTransactions().length).toBe(4);
    (window.confirm as any) = vi.fn(() => true);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Delete' }));
    expect(getTransactions().some(t => t.id === 'x1')).toBe(false);
    expect(rows().map(r => r.getAttribute('data-ac-row'))).toEqual(['x2', 'x3']);
    expect(kpi('Expenses this month').textContent).toContain('Rs 86,200');
  });

  it('Daily wages goes to the wages page', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Daily wages/ }));
    expect(window.location.hash).toBe('#/daily-wages');
  });

  it('the PDF reports are behind ⋯: both are there and each makes its report (or says why not)', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('button', { name: /Full report \(A4\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /POS 80 mm report/ }));
    expect((toast.success as any).mock.calls.length + (toast.error as any).mock.calls.length).toBe(1);
  });

  it('Income is its own tab: the income entries, its own cards and "Add income"; Add expense is not offered on the tabs that are not entries', async () => {
    await mount();
    goTab(/^Income$/);
    expect(await screen.findByRole('tab', { name: 'Income', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add income/ })).toBeInTheDocument();
    expect(rows().map(r => r.getAttribute('data-ac-row'))).toEqual(['i1']);
    expect(kpi('Income this month').textContent).toContain('Rs 45,000');
    expect(kpi('Income this month').textContent).not.toContain('vs');             // nothing last month: no change to show
    expect(kpi('Sales this month').textContent).toContain('Rs 8,000');
    expect(kpi('Expenses this month').textContent).toContain('Rs 96,200');
    expect([...document.querySelectorAll('[data-ac-chip]')].map(c => c.textContent)).toEqual(['All', 'Catering']);
    goTab(/^Overview$/);
    expect(await screen.findByText('Today Income')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add (income|expense)/ })).toBeNull();
    goTab(/^Payment A\/Cs$/); expect(await screen.findByText('Payment Accounts')).toBeInTheDocument();
    goTab(/^Parties$/); expect(await screen.findByRole('tab', { name: 'Parties', selected: true })).toBeInTheDocument();
    goTab(/^Ledger$/); expect(await screen.findByRole('tab', { name: 'Ledger', selected: true })).toBeInTheDocument();
    goTab(/^Cash Close$/); expect(await screen.findByRole('heading', { name: 'Close Day' })).toBeInTheDocument();
  });

  it('coming back to Expenses from another tab does not pop the Add form open again', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Add expense/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    goTab(/^Overview$/);
    expect(await screen.findByText('Today Income')).toBeInTheDocument();
    goTab(/^Expenses$/);
    expect(await screen.findByRole('tab', { name: 'Expenses', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with no expenses: the empty line tells how to add the first one; the cards read zero', async () => {
    cleanup(); localStorage.clear(); seed({ transactions: [] }); setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(document.querySelector('[data-ac-empty]')!.textContent).toContain('Add expense');
    expect(kpi('Expenses this month').textContent).toContain('Rs 0');
    expect(kpi('Expenses this month').textContent).not.toContain('vs');
  });

  it('more than a hundred entries show a hundred, and "Show more" brings the rest', async () => {
    cleanup(); localStorage.clear();
    seed({ transactions: Array.from({ length: 130 }, (_, i) => tx(`m${i}`, thisMonth(1 + (i % 27)), 'expense', 3, 'Supplies', 'cash', `Entry ${i}`, 100)) });
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(rows().length).toBe(100);
    fireEvent.click(document.querySelector('[data-ac-more]')!);
    expect(rows().length).toBe(130);
    expect(document.querySelector('[data-ac-more]')).toBeNull();
  });

  it('another look keeps the old page: "Accounts", Overview first and the segmented tabs', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-ac-page]')).toBeNull();
    expect(screen.getByText('Today Income')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Full Report \(A4\)/ })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="tabs-list"]')!.getAttribute('data-tabs')).toBeNull();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-accounts.css');
    expect(read('src/styles.css')).toContain('ui-refined-accounts.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
