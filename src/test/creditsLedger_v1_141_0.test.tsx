// ============================================================
// v1.141.0 — Credits (Udhaar) as the design draws it (SW-33): "Rs 148,600 outstanding · 11 customers", a search with All · Over 30 days · Over 60 days,
// the customers who owe (biggest first, how long their oldest bill has waited, Receive), and the selected customer's ledger beside it
// ("Bill #1002 — credit + Rs 18,000", "Payment — cash − Rs 5,000"). The software keeps credit per bill; a payment typed for a customer is spread over their bills,
// oldest first. Pinned: the rules in lib/creditLedger.ts, every button against the saved payments, the filters, the ledger, the old look, the scoped stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getCreditPayments } from '@/lib/store';
import { getBlockedCustomers } from '@/lib/blocklist';
import { allocatePayment, creditCustomers, creditKey, creditLedger, creditSubtitle, daysSince, matchesFilter, matchesSearch, oldestLabel } from '@/lib/creditLedger';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/ReceiptPreview', () => ({ default: ({ order }: { order: { orderNumber: number } }) => <div data-testid="parchi">{order.orderNumber}</div> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const dago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const wideWindow = () => { (window as any).matchMedia = (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }); };

const bill = (id: string, no: number, name: string, phone: string, total: number, age: number, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: no, orderType: 'dining', status: 'paid', paymentMethod: 'credit', source: 'pos',
  items: [{ id: `i${id}`, menuItemId: 'm1', name: 'Karahi', pricingType: 'fixed', price: total, quantity: 1, lineTotal: total, note: '' }],
  subtotal: total, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: total, notes: '', payments: [], amountPaid: 0, createdAt: dago(age),
  creditCustomerName: name, creditCustomerPhone: phone, ...extra,
});
const ORDERS = () => [
  bill('c1', 988, 'Ahmed Raza', '0300 0000000', 29000, 12),
  bill('c2', 1002, 'Ahmed Raza', '+92 300 0000000', 18000, 5),          // the same phone written another way
  bill('c3', 1010, 'Sara Khan', '0300 0000010', 33800, 21),
  bill('c4', 1011, 'Bilal Hussain', '0300 0000020', 25600, 70),
  bill('c5', 1012, 'Usman Ali', '', 9200, 3),                           // no phone: by name
  bill('c6', 1013, 'Hina Malik', '0300 0000050', 4000, 40),             // fully paid below
];
const PAYMENTS = () => [
  { id: 'p1', orderId: 'c2', amount: 5000, method: 'cash', date: dago(4), receivedBy: 'Ayesha' },
  { id: 'p2', orderId: 'c6', amount: 4000, method: 'card', date: dago(2) },
];

describe('the rules', () => {
  it('one customer = one phone (the last ten digits), else one name', () => {
    expect(creditKey({ creditCustomerPhone: '0300 0000000' } as any)).toBe(creditKey({ creditCustomerPhone: '+92 300 0000000' } as any));
    expect(creditKey({ creditCustomerPhone: '', creditCustomerName: ' Usman Ali ' } as any)).toBe('n:usman ali');
    expect(creditKey({ customer: { phone: '0321 5551234' } } as any)).toBe('p:3215551234');
    expect(creditKey({} as any)).toBe('walk-in');
  });

  it('customers, biggest debt first, settled ones last; the oldest bill that is STILL owed sets the age', () => {
    const now = Date.now();
    const list = creditCustomers(ORDERS() as any, PAYMENTS() as any, now);
    expect(list.map(c => [c.name, c.owes])).toEqual([['Bilal Hussain', 25600], ['Ahmed Raza', 42000], ['Sara Khan', 33800], ['Usman Ali', 9200], ['Hina Malik', 0]].sort((a, b) => (b[1] as number) - (a[1] as number)));
    const ahmed = list.find(c => c.name === 'Ahmed Raza')!;
    expect(ahmed.bills.map(b => b.order.orderNumber)).toEqual([988, 1002]);      // oldest first
    expect(ahmed.billed).toBe(47000); expect(ahmed.paid).toBe(5000); expect(ahmed.owes).toBe(42000);
    expect(ahmed.oldestDays).toBe(12);
    const hina = list.find(c => c.name === 'Hina Malik')!;
    expect(hina.owes).toBe(0); expect(hina.oldestDays).toBeNull();
    expect(list[list.length - 1].name).toBe('Hina Malik');
  });

  it('the words and the filters', () => {
    expect(oldestLabel(null)).toBe('—'); expect(oldestLabel(0)).toBe('today'); expect(oldestLabel(1)).toBe('1 day'); expect(oldestLabel(39)).toBe('39 days');
    expect(daysSince(dago(3))).toBe(3);
    const list = creditCustomers(ORDERS() as any, PAYMENTS() as any);
    const names = (f: any) => list.filter(c => matchesFilter(c, f)).map(c => c.name).sort();
    expect(names('all')).toEqual(['Ahmed Raza', 'Bilal Hussain', 'Sara Khan', 'Usman Ali']);
    expect(names('over30')).toEqual(['Bilal Hussain']);
    expect(names('over60')).toEqual(['Bilal Hussain']);
    expect(names('settled')).toEqual(['Hina Malik']);
    const sara = list.find(c => c.name === 'Sara Khan')!;
    expect(matchesSearch(sara, 'sara')).toBe(true); expect(matchesSearch(sara, '0000010')).toBe(true); expect(matchesSearch(sara, '#1010')).toBe(true); expect(matchesSearch(sara, 'zzz')).toBe(false);
    expect(creditSubtitle(list, n => `Rs ${n.toLocaleString('en-US')}`)).toBe('Rs 110,600 outstanding · 4 customers');
  });

  it('the ledger: bills add, payments take away, newest first', () => {
    const c = creditCustomers(ORDERS() as any, PAYMENTS() as any).find(x => x.name === 'Ahmed Raza')!;
    const l = creditLedger(c, PAYMENTS() as any);
    expect(l.map(e => [e.label, e.amount])).toEqual([['Payment — cash', -5000], ['Bill #1002 — credit', 18000], ['Bill #988 — credit', 29000]]);
    expect(l[0].note).toBe('on #1002 · by Ayesha');
    expect(l[1].note).toBe('partly paid');
  });

  it('a payment is spread over the bills oldest first, never over a bill\'s balance, and what does not fit is left', () => {
    const c = creditCustomers(ORDERS() as any, PAYMENTS() as any).find(x => x.name === 'Ahmed Raza')!;
    expect(allocatePayment(c.bills, 20000)).toEqual({ parts: [{ orderId: 'c1', orderNumber: 988, amount: 20000 }], left: 0 });
    expect(allocatePayment(c.bills, 35000)).toEqual({ parts: [{ orderId: 'c1', orderNumber: 988, amount: 29000 }, { orderId: 'c2', orderNumber: 1002, amount: 6000 }], left: 0 });
    expect(allocatePayment(c.bills, 50000)).toEqual({ parts: [{ orderId: 'c1', orderNumber: 988, amount: 29000 }, { orderId: 'c2', orderNumber: 1002, amount: 13000 }], left: 8000 });
    expect(allocatePayment(c.bills, 0).parts).toEqual([]);
  });
});

function seed() {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: ORDERS(), creditPayments: PAYMENTS(),
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/CreditsPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const rows = () => [...document.querySelectorAll('[data-cr-row]')] as HTMLElement[];
const names = () => rows().map(r => r.querySelector('.cr-cell-name')!.textContent);
const rowOf = (name: string) => rows().find(r => r.querySelector('.cr-cell-name')!.textContent === name)!;
const paidOn = (orderId: string) => getCreditPayments().filter(p => p.orderId === orderId).reduce((s, p) => s + p.amount, 0);

describe('the page under DT Refined (a wide window)', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/credits'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); wideWindow(); });
  afterEach(() => { cleanup(); delete (window as any).matchMedia; });

  it('the title, the sum and the customers who owe, biggest first, each with how long their oldest bill has waited', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Credits (Udhaar)');
    expect(document.querySelector('[data-cr-subtitle]')!.textContent).toBe('Rs 110,600 outstanding · 4 customers');
    expect(names()).toEqual(['Ahmed Raza', 'Sara Khan', 'Bilal Hussain', 'Usman Ali']);
    const r = rowOf('Ahmed Raza');
    expect(r.textContent).toContain('Rs 42,000'); expect(r.textContent).toContain('12 days'); expect(r.textContent).toContain('0300 0000000');
    expect(rowOf('Bilal Hussain').textContent).toContain('70 days');
  });

  it('the biggest debtor is open in the panel with the ledger; picking another row changes it', async () => {
    await mount();
    const panel = document.querySelector('[data-cr-panel]') as HTMLElement;
    expect(panel.querySelector('[data-cr-owes]')!.textContent).toBe('Owes Rs 42,000');
    expect([...panel.querySelectorAll('[data-cr-entry]')].map(e => e.querySelector('.cr-entry-label')!.textContent)).toEqual(['Payment — cash', 'Bill #1002 — credit', 'Bill #988 — credit']);
    expect(panel.querySelector('[data-sign="minus"]')!.textContent).toBe('− Rs 5,000');
    expect(panel.querySelector('[data-sign="plus"]')!.textContent).toBe('+ Rs 18,000');
    fireEvent.click(rowOf('Sara Khan'));
    expect((document.querySelector('[data-cr-panel]') as HTMLElement).querySelector('[data-cr-owes]')!.textContent).toBe('Owes Rs 33,800');
  });

  it('the age filters and Settled narrow the table; the search finds by name, phone or bill number', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-cr-filter="over30"]')!);
    expect(names()).toEqual(['Bilal Hussain']);
    fireEvent.click(document.querySelector('[data-cr-filter="settled"]')!);
    expect(names()).toEqual(['Hina Malik']);
    expect(rowOf('Hina Malik').querySelector('[data-cr-receive-row]')).toBeDisabled();
    fireEvent.click(document.querySelector('[data-cr-filter="all"]')!);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search credits' }), { target: { value: '#1010' } });
    expect(names()).toEqual(['Sara Khan']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search credits' }), { target: { value: 'nobody' } });
    expect(document.querySelector('[data-cr-empty]')!.textContent).toBe('No customers match.');
  });

  it('Receive for a customer: the money is spread over the oldest bills first and saved as payments', async () => {
    await mount();
    fireEvent.click(within(rowOf('Ahmed Raza')).getByRole('button', { name: 'Receive' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByLabelText('Amount received')).toHaveValue(42000);        // the whole debt to start with
    fireEvent.change(within(dlg).getByLabelText('Amount received'), { target: { value: '35000' } });
    expect(within(dlg).getByText(/Goes to the oldest bills first: #988 Rs 29,000, #1002 Rs 6,000/)).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText('Note (optional)'), { target: { value: 'cash at the counter' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm receive' }));
    expect(paidOn('c1')).toBe(29000);
    expect(paidOn('c2')).toBe(5000 + 6000);
    expect(getCreditPayments().filter(p => p.note === 'cash at the counter').length).toBe(2);
    expect(rowOf('Ahmed Raza').textContent).toContain('Rs 7,000');
  });

  it('more than the customer owes is refused and nothing is saved', async () => {
    await mount();
    const before = getCreditPayments().length;
    fireEvent.click(within(rowOf('Usman Ali')).getByRole('button', { name: 'Receive' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Amount received'), { target: { value: '9300' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm receive' }));
    expect(getCreditPayments().length).toBe(before);
  });

  it('the header\'s Receive payment takes the customer in the panel', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-cr-receive]')!);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Ahmed Raza')).toBeInTheDocument();
  });

  it('a ledger entry\'s ⋯: print a bill\'s credit parchi, delete a payment (after a question)', async () => {
    const ask = vi.fn(() => true);
    Object.defineProperty(window, 'confirm', { value: ask, configurable: true, writable: true });
    await mount();
    const panel = () => document.querySelector('[data-cr-panel]') as HTMLElement;
    const entry = (label: string) => [...panel().querySelectorAll('[data-cr-entry]')].find(e => e.textContent!.includes(label)) as HTMLElement;
    fireEvent.click(within(entry('Bill #1002')).getByRole('button', { name: /More for Bill #1002/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Print credit parchi/ }));
    expect(screen.getByTestId('parchi')).toHaveTextContent('1002');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });                  // close the parchi before the next click (a modal hides the page behind it)
    await vi.waitFor(() => expect(screen.queryByTestId('parchi')).toBeNull());
    fireEvent.click(within(entry('Payment — cash')).getByRole('button', { name: /More for Payment — cash/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete this payment/ }));
    expect(ask).toHaveBeenCalled();
    expect(getCreditPayments().some(p => p.id === 'p1')).toBe(false);
    expect((document.querySelector('[data-cr-panel]') as HTMLElement).querySelector('[data-cr-owes]')!.textContent).toBe('Owes Rs 47,000');
  });

  it('the customer\'s ⋯: block the customer', async () => {
    const prompt = vi.fn(() => 'Does not pay back');
    Object.defineProperty(window, 'prompt', { value: prompt, configurable: true, writable: true });
    await mount();
    fireEvent.click(document.querySelector('[data-cr-customer-more]')!);
    fireEvent.click(await screen.findByRole('button', { name: /Block customer/ }));
    expect(prompt).toHaveBeenCalled();
    expect(getBlockedCustomers().some(c => /3000000000|0000000/.test(c.phone) && c.reason === 'Does not pay back')).toBe(true);
  });

  it('nothing on credit yet: it says how to start', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!); data.orders = []; data.creditPayments = [];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(document.querySelector('[data-cr-empty]')!.textContent).toMatch(/No credit \(udhaar\) yet/);
    expect(document.querySelector('[data-cr-subtitle]')!.textContent).toBe('Rs 0 outstanding · 0 customers');
  });
});

describe('a narrow window', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/credits'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());
  it('the ledger opens in a dialog on a row; the header button asks who is paying', async () => {
    await mount();
    fireEvent.click(rowOf('Sara Khan'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Owes Rs 33,800')).toBeInTheDocument();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    cleanup(); await mount();
    fireEvent.click(document.querySelector('[data-cr-pick]')!);
    fireEvent.click(await screen.findByRole('button', { name: /Bilal Hussain/ }));
    expect(await screen.findByLabelText('Amount received')).toHaveValue(25600);
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/credits'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: a card per credit bill, Receive per bill', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-cr-page]')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Receive/ }).length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText('Credits / Udhaar')).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-credits.css');
    expect(read('src/styles.css')).toContain('ui-refined-credits.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
