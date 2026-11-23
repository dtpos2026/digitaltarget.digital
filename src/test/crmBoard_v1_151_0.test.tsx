// ============================================================
// v1.151.0 — CRM insights as the design draws it (SW-20): "Last 90 days", four figure cards (Active customers ▲ · Repeat rate ▲ pts · At risk "No order in 30 d" ·
// Birthdays this month), the bars of "Orders per customer" (1 · 2 · 3 · 4 · 5 · 6–9 · 10+), the list "At risk — send an offer" with "Message all N", and Send offer
// (messages go to the WhatsApp queue). Pinned: the rules in lib/crmBoard.ts, the page under DT Refined against seeded bills, the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getPendingQueue } from '@/lib/whatsapp';
import {
  AT_RISK_DAYS, DAY_MS, atRiskList, birthdayCustomers, crmFigures, deltaWord, firstName, offerTemplate, ordersPerCustomer, peopleIn, personKey, personalise, signupsByMonth,
} from '@/lib/crmBoard';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));

const PHONE = { A: '0300-1111111', B: '0300 2222222', D: '0300-4444444', E: '+92 300 5555555', F: '03006666666' };
const bill = (id: string, now: number, ago: number, who: { id?: string; name?: string; phone?: string } | null, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: 1, orderType: 'takeaway', status: 'paid', items: [], grandTotal: 1450,
  createdAt: new Date(now - ago * DAY_MS).toISOString(), paidAt: new Date(now - ago * DAY_MS).toISOString(),
  customer: who ? { id: who.id || '', name: who.name || '', phone: who.phone || '', address: '' } : undefined, ...extra,
}) as any;
// A (two bills, quiet for 40 days) · B (one, 10 days ago) · C (one, 45 days ago, no phone) · D (three, last 1 day ago) · E (one, 120 days ago: the 90 days before) · F (200 days ago: neither)
const BILLS = (now: number) => [
  bill('a1', now, 40, { id: 'a', name: 'Ahmed Raza', phone: PHONE.A }), bill('a2', now, 50, { id: 'a', name: 'Ahmed Raza', phone: PHONE.A }),
  bill('b1', now, 10, { id: 'b', name: 'Sara Khan', phone: PHONE.B }),
  bill('c1', now, 45, { id: 'c', name: 'Bilal Hussain' }),
  bill('d1', now, 1, { id: 'd', name: 'Zainab Ali', phone: PHONE.D }), bill('d2', now, 2, { id: 'd', name: 'Zainab Ali', phone: PHONE.D }), bill('d3', now, 3, { id: 'd', name: 'Zainab Ali', phone: PHONE.D }),
  bill('e1', now, 120, { id: 'e', name: 'Old Timer', phone: PHONE.E }),
  bill('f1', now, 200, { id: 'f', name: 'Lost', phone: PHONE.F }),
  bill('x1', now, 5, null),                                                        // nobody on it
  bill('u1', now, 5, { id: 'u', name: 'Unpaid', phone: '03007777777' }, { status: 'running', paidAt: undefined }),
];

describe('the rules', () => {
  it('personKey: one phone number is one person however it is written; else the customer record; else the name; else nobody', () => {
    expect(personKey({ customer: { phone: '0300-1111111' } } as any)).toBe(personKey({ customer: { phone: '+92 300 1111111' } } as any));
    expect(personKey({ customer: { phone: '0300-1111111' } } as any)).toBe('p:3001111111');
    expect(personKey({ customer: { id: 'c9', name: 'X' } } as any)).toBe('i:c9');
    expect(personKey({ creditCustomerName: ' Sara ' } as any)).toBe('n:sara');
    expect(personKey({} as any)).toBeNull();
  });

  it('peopleIn: bills inside the window only, one row per person with the bills, the spend and the days since the last one', () => {
    const now = new Date('2026-11-23T12:00:00').getTime();
    const p = peopleIn(BILLS(now).filter(o => o.status === 'paid'), now - 90 * DAY_MS, now + 1, now);      // the page hands over paid bills only
    expect(p.map(x => x.name).sort()).toEqual(['Ahmed Raza', 'Bilal Hussain', 'Sara Khan', 'Zainab Ali']);          // not Old Timer or Lost (outside the window), nor the bill with nobody on it
    const a = p.find(x => x.name === 'Ahmed Raza')!;
    expect(a).toMatchObject({ orders: 2, spent: 2900, daysSince: 40, phone: PHONE.A });
  });

  it('crmFigures: active, repeat rate and the arrows against the 90 days before; at risk; birthdays', () => {
    const now = new Date('2026-11-23T12:00:00').getTime();
    const paid = BILLS(now).filter(o => o.status === 'paid');
    const f = crmFigures(paid, [{ dateOfBirth: '1990-11-10' }, { dateOfBirth: '1990-03-02' }, {}], now);
    expect(f).toEqual({ active: 4, activeDelta: 300, repeatPct: 50, repeatDeltaPts: 50, atRisk: 2, birthdays: 1 });   // 4 vs 1 before; 2 of 4 ordered twice, 0 of 1 before
    expect(crmFigures([], [], now)).toEqual({ active: 0, activeDelta: null, repeatPct: 0, repeatDeltaPts: null, atRisk: 0, birthdays: 0 });
  });

  it('atRiskList: ordered in the window, quiet for 30 days or more; the biggest spenders first', () => {
    const now = new Date('2026-11-23T12:00:00').getTime();
    const list = atRiskList(peopleIn(BILLS(now).filter(o => o.status === 'paid'), now - 90 * DAY_MS, now + 1, now));
    expect(list.map(x => x.name)).toEqual(['Ahmed Raza', 'Bilal Hussain']);
    expect(list.every(x => x.daysSince >= AT_RISK_DAYS)).toBe(true);
  });

  it('ordersPerCustomer: 1 · 2 · 3 · 4 · 5 · 6–9 · 10+', () => {
    const bars = ordersPerCustomer([1, 2, 2, 3, 4, 5, 6, 9, 10, 15].map(orders => ({ orders })));
    expect(bars.map(b => b.label)).toEqual(['1', '2', '3', '4', '5', '6–9', '10+']);
    expect(bars.map(b => b.count)).toEqual([1, 2, 1, 1, 1, 2, 2]);
  });

  it('birthdayCustomers: this month only, earliest day first; signupsByMonth: the last six months that have any', () => {
    const c = [{ id: '1', dateOfBirth: '1990-11-20' }, { id: '2', dateOfBirth: '1985-11-02' }, { id: '3', dateOfBirth: '1990-12-05' }, { id: '4' }, { id: '5', dateOfBirth: 'junk' }];
    expect(birthdayCustomers(c, new Date(2026, 10, 15)).map(x => x.id)).toEqual(['2', '1']);
    const s = signupsByMonth(['2026-01', '2026-02', '2026-03', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', 'junk'].map(m => ({ createdAt: `${m}-10T00:00:00Z` })));
    expect(s.map(x => x.month)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
    expect(s[1].count).toBe(2);
  });

  it('the words: arrows, first names, the offer text', () => {
    expect(deltaWord(8, '%')).toBe('▲ 8%'); expect(deltaWord(-3, ' pts')).toBe('▼ 3 pts'); expect(deltaWord(0, '%')).toBe('Same as before'); expect(deltaWord(null, '%')).toBe('');
    expect(firstName('Sara Khan')).toBe('Sara'); expect(firstName('')).toBe('there');
    expect(offerTemplate('atRisk', 'Chai Corner')).toBe('Hi {name}, we miss you at Chai Corner! Come back this week — we have something for you.');
    expect(offerTemplate('birthdays', 'Chai Corner')).toContain('Happy birthday {name}');
    expect(offerTemplate('active', 'Chai Corner', 'WELCOME10')).toContain('Use code WELCOME10.');
    expect(personalise('Hi {name}, {name}!', 'Sara Khan')).toBe('Hi Sara, Sara!');
  });
});

const NOW = Date.now();
const profile = (id: string, name: string, phone: string, orders: number, spent: number, extra: Record<string, unknown> = {}) => ({ id, name, phone, addresses: [], totalOrders: orders, totalSpent: spent, createdAt: new Date(NOW - 30 * DAY_MS).toISOString(), ...extra });
const month = String(new Date().getMonth() + 1).padStart(2, '0');
const PROFILES = [
  profile('a', 'Ahmed Raza', PHONE.A, 2, 2900, { dateOfBirth: '1990-01-05' }),
  profile('b', 'Sara Khan', PHONE.B, 1, 1450, { dateOfBirth: `1990-${month}-10` }),
  profile('c', 'Bilal Hussain', '', 1, 1450),
  profile('d', 'Zainab Ali', PHONE.D, 3, 4350, { dateOfBirth: `1992-${month}-02` }),
  profile('e', 'Old Timer', PHONE.E, 1, 1450), profile('f', 'Lost', PHONE.F, 1, 1450),
];

function seed(over: Record<string, unknown> = {}) {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], inventory: [], transactions: [], orderCounter: 100,
    customers: PROFILES, orders: BILLS(NOW), promoCodes: [{ id: 'p1', code: 'COMEBACK10', discountType: 'percent', discountValue: 10, usageCount: 0, isActive: true }], ...over,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/CrmInsightsPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const kpi = (label: string) => document.querySelector(`[data-kpi="${label}"]`) as HTMLElement;
const bar = (label: string) => document.querySelector(`[data-crm-chart] [data-crm-bar="${label}"]`) as HTMLElement;

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); window.location.hash = '#/crm'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, "Last 90 days" and Send offer', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('CRM insights');
    expect(document.querySelector('[data-crm-subtitle]')!.textContent).toBe('Last 90 days');
    expect(screen.getByRole('button', { name: /Send offer/ })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Branch' })).toBeNull();                 // no branches: no picker
  });

  it('the four cards against the seeded bills', async () => {
    await mount();
    expect(kpi('Active customers').textContent).toContain('4');
    expect(kpi('Active customers').textContent).toContain('▲ 300%');
    expect(kpi('Repeat rate').textContent).toContain('50%');
    expect(kpi('Repeat rate').textContent).toContain('▲ 50 pts');
    expect(kpi('At risk').textContent).toContain('2');
    expect(kpi('At risk').textContent).toContain('No order in 30 d');
    expect(kpi('Birthdays this month').textContent).toContain('2');                         // Sara and Zainab; Ahmed's is in January
  });

  it('Orders per customer: seven bars, the 10+ one dark, empty ones still there', async () => {
    await mount();
    expect([...document.querySelectorAll('[data-crm-chart] [data-crm-bar]')].map(b => b.getAttribute('data-crm-bar'))).toEqual(['1', '2', '3', '4', '5', '6–9', '10+']);
    expect([...document.querySelectorAll('[data-crm-chart] [data-crm-bar]')].map(b => b.getAttribute('data-count'))).toEqual(['2', '1', '1', '0', '0', '0', '0']);      // B and C once; A twice; D three times
    expect(bar('10+').querySelector('.crm-bar')!.hasAttribute('data-last')).toBe(true);
    expect(bar('1').querySelector('.crm-bar')!.hasAttribute('data-last')).toBe(false);
  });

  it('At risk: the quiet customers with their days, the one without a phone cannot be messaged, and "Message all N"', async () => {
    await mount();
    const rows = [...document.querySelectorAll('[data-crm-person]')] as HTMLButtonElement[];
    expect(rows.map(r => r.textContent)).toEqual(['AAhmed Raza40 d', 'BBilal Hussain45 d']);
    expect(rows[0].disabled).toBe(false); expect(rows[1].disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Message all 2/ })).toBeInTheDocument();
  });

  it('a name opens WhatsApp on that person with the message written', async () => {
    await mount();
    fireEvent.click(document.querySelectorAll('[data-crm-person]')[0]);
    expect(window.location.hash).toMatch(/^#\/whatsapp\?phone=/);
    const q = new URLSearchParams(window.location.hash.split('?')[1]);
    expect(q.get('phone')).toBe(PHONE.A);
    expect(q.get('message')).toBe('Hi Ahmed, we miss you at Chai Corner! Come back this week — we have something for you.');
  });

  it('Send offer: choose who, edit the message, mention a promo code, and the messages are queued for each customer who has a phone', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Send offer/ }));
    const dlg = await screen.findByRole('dialog');
    expect(document.querySelector('[data-crm-aud="atRisk"]')!.getAttribute('aria-pressed')).toBe('true');
    expect([...dlg.querySelectorAll('[data-crm-aud]')].map(b => b.textContent)).toEqual(['At risk · 2', 'Birthdays this month · 2', 'All active · 4']);
    expect(dlg.querySelector('[data-crm-count]')!.textContent).toBe('1 customer will get it · 1 without a phone number are left out.');
    expect((within(dlg).getByLabelText('Message') as HTMLTextAreaElement).value).toContain('Hi {name}, we miss you at Chai Corner');
    fireEvent.change(within(dlg).getByLabelText('Promo code'), { target: { value: 'COMEBACK10' } });
    expect((within(dlg).getByLabelText('Message') as HTMLTextAreaElement).value).toContain('Use code COMEBACK10.');
    fireEvent.click(dlg.querySelector('[data-crm-queue]')!);
    const q = getPendingQueue();
    expect(q.length).toBe(1);
    expect(q[0].phone).toBe('923001111111');
    expect(q[0].customerName).toBe('Ahmed Raza');
    expect(q[0].message).toBe('Hi Ahmed, we miss you at Chai Corner! Come back this week — we have something for you. Use code COMEBACK10.');
    expect((toast.success as any).mock.calls[0][0]).toBe('1 message added to the WhatsApp queue');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Send offer to the birthdays and to everyone active changes who and what', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Send offer/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(dlg.querySelector('[data-crm-aud="birthdays"]')!);
    expect((within(dlg).getByLabelText('Message') as HTMLTextAreaElement).value).toContain('Happy birthday {name}');
    expect(dlg.querySelector('[data-crm-count]')!.textContent).toBe('2 customers will get it.');
    fireEvent.click(dlg.querySelector('[data-crm-aud="active"]')!);
    expect(dlg.querySelector('[data-crm-count]')!.textContent).toBe('3 customers will get it · 1 without a phone number are left out.');
    fireEvent.click(dlg.querySelector('[data-crm-queue]')!);
    expect(getPendingQueue().length).toBe(3);
  });

  it('Message all opens the same form on the at-risk list; Cancel queues nothing', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Message all 2/ }));
    const dlg = await screen.findByRole('dialog');
    expect(dlg.querySelector('[data-crm-aud="atRisk"]')!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(getPendingQueue().length).toBe(0);
  });

  it('what the old page had is still there: the totals, the top customers by spend and the sign-ups', async () => {
    await mount();
    const t = document.querySelector('[data-crm-totals]')!.textContent!;
    expect(t).toContain('6 customers on record'); expect(t).toContain('10 paid bills'); expect(t).toContain('Rs 14,500 sales'); expect(t).toContain('Average basket Rs 1,450');   // the unpaid bill is not in it; the bill with nobody on it is
    const top = [...document.querySelectorAll('[data-crm-top-row]')].map(r => r.getAttribute('data-crm-top-row'));
    expect(top.slice(0, 2)).toEqual(['d', 'a']);                                            // 4,350 and 2,900
    expect(document.querySelector('[data-crm-signups]')).not.toBeNull();
  });

  it('with branches a picker narrows everything to that branch', async () => {
    cleanup(); localStorage.clear();
    const orders = BILLS(NOW).map(o => ({ ...o, branchId: String(o.id).startsWith('d') ? 'b2' : 'b1' }));
    seed({ orders, branches: [{ id: 'b1', name: 'Main', isActive: true, sortOrder: 1 }, { id: 'b2', name: 'DHA', isActive: true, sortOrder: 2 }] });
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Branch' }), { target: { value: 'b2' } });
    expect(kpi('Active customers').textContent).toContain('1');                             // only Zainab ordered at DHA
    expect(kpi('At risk').textContent).toContain('0');
    expect(document.querySelector('[data-crm-risk-empty]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Message all/ })).toBeNull();
  });

  it('with no bills: zeros, no arrows, and the empty lines say what would fill them', async () => {
    cleanup(); localStorage.clear(); seed({ orders: [], customers: [] }); setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(kpi('Active customers').textContent).toContain('0'); expect(kpi('Active customers').textContent).not.toContain('▲');
    expect(document.querySelector('[data-crm-empty]')!.textContent).toContain('No paid bills');
    expect(document.querySelector('[data-crm-risk-empty]')!.textContent).toContain('Nobody has gone quiet');
    expect(screen.queryByRole('button', { name: /Message all/ })).toBeNull();
  });

  it('another look keeps the old page: "CRM Insights", Total Customers and the charts', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-crm-page]')).toBeNull();
    expect(screen.getByText('Total Customers')).toBeInTheDocument();
    expect(screen.getByText('Order Frequency')).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-crm.css');
    expect(read('src/styles.css')).toContain('ui-refined-crm.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
