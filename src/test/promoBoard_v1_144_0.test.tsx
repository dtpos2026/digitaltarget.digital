// ============================================================
// v1.144.0 — Promo codes as the design draws it (SW-34): "N codes", New code, a search with All · Active · Expired, and a table — Code · Discount · Valid ·
// Used (with a bar) · Active (a switch). Pinned: the rules in lib/promoBoard.ts, the switch / copy / delete / editor against the saved codes, the old look and the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getPromoCodes } from '@/lib/store';
import { discountLabel, matchesPromoFilter, promoState, promoSubtitle, sortPromos, usedLabel, usedRatio, validLabel } from '@/lib/promoBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const NOW = new Date(2026, 10, 22, 12, 0, 0).getTime();
const dstr = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const rs = (n: number) => `Rs ${n.toLocaleString('en-US')}`;

describe('the rules', () => {
  const base = { isActive: true, usageCount: 0, usageLimit: undefined as number | undefined, startDate: undefined as string | undefined, endDate: undefined as string | undefined };
  it('what a code can do today: active, off, not yet, expired, used up (the ones that have run out say so even when the switch is off)', () => {
    expect(promoState(base, NOW)).toBe('active');
    expect(promoState({ ...base, isActive: false }, NOW)).toBe('off');
    expect(promoState({ ...base, startDate: dstr(2026, 12, 1) }, NOW)).toBe('scheduled');
    expect(promoState({ ...base, endDate: dstr(2026, 11, 21) }, NOW)).toBe('expired');
    expect(promoState({ ...base, endDate: dstr(2026, 11, 22) }, NOW)).toBe('active');           // the last day still counts
    expect(promoState({ ...base, usageLimit: 100, usageCount: 100 }, NOW)).toBe('used_up');
    expect(promoState({ ...base, isActive: false, endDate: dstr(2026, 1, 5) }, NOW)).toBe('expired');
  });

  it('the words: the dates, the discount, the use', () => {
    expect(validLabel({ ...base, startDate: dstr(2026, 10, 1), endDate: dstr(2026, 12, 31) }, NOW)).toBe('1 Oct – 31 Dec');
    expect(validLabel({ ...base, endDate: dstr(2026, 12, 31) }, NOW)).toBe('until 31 Dec');
    expect(validLabel({ ...base, startDate: dstr(2026, 12, 3) }, NOW)).toBe('from 3 Dec');
    expect(validLabel(base, NOW)).toBe('Always');
    expect(validLabel({ ...base, endDate: dstr(2026, 1, 5) }, NOW)).toBe('expired');
    expect(validLabel({ ...base, usageLimit: 5, usageCount: 5 }, NOW)).toBe('used up');
    expect(discountLabel({ discountType: 'percent', discountValue: 10 } as any, rs)).toBe('10 %');
    expect(discountLabel({ discountType: 'pkr', discountValue: 200, minOrderAmount: 1500 } as any, rs)).toBe('Rs 200 · min Rs 1,500');
    expect(usedLabel({ usageCount: 34, usageLimit: 100 })).toBe('34 / 100'); expect(usedLabel({ usageCount: undefined, usageLimit: undefined })).toBe('0');
    expect(usedRatio({ usageCount: 50, usageLimit: 100 })).toBe(0.5); expect(usedRatio({ usageCount: 500, usageLimit: 100 })).toBe(1); expect(usedRatio({ usageCount: 5, usageLimit: undefined })).toBeNull();
    expect(promoSubtitle(1)).toBe('1 code'); expect(promoSubtitle(5)).toBe('5 codes');
  });

  it('the chips, and the order: live codes first (newest first), the ones that have run out last', () => {
    const mk = (code: string, over: Record<string, unknown> = {}) => ({ id: code, code, discountType: 'percent', discountValue: 10, isActive: true, usageCount: 0, createdAt: new Date(NOW - Number(over.age || 0) * 86_400_000).toISOString(), ...over }) as any;
    const list = [mk('OLD', { age: 30 }), mk('GONE', { age: 1, endDate: dstr(2026, 1, 1) }), mk('NEW', { age: 2 }), mk('OFF', { age: 3, isActive: false })];
    expect(sortPromos(list, NOW).map(p => p.code)).toEqual(['NEW', 'OFF', 'OLD', 'GONE']);
    expect(list.filter(p => matchesPromoFilter(p, 'active', NOW)).map(p => p.code)).toEqual(['OLD', 'NEW']);
    expect(list.filter(p => matchesPromoFilter(p, 'expired', NOW)).map(p => p.code)).toEqual(['GONE']);
    expect(list.filter(p => matchesPromoFilter(p, 'all', NOW)).length).toBe(4);
  });
});

function seed() {
  const y = new Date().getFullYear();
  const day = (m: number, d: number) => dstr(y, m, d);
  const mk = (code: string, over: Record<string, unknown>) => ({ id: `id-${code}`, code, discountType: 'percent', discountValue: 10, isActive: true, usageCount: 0, createdAt: new Date(Date.now() - (over.age as number || 0) * 86_400_000).toISOString(), ...over });
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: [],
    promoCodes: [
      mk('WELCOME10', { age: 1, usageCount: 34, usageLimit: 100, showOnWebsite: true }),
      mk('FLAT200', { age: 2, discountType: 'pkr', discountValue: 200, minOrderAmount: 1500, accountsOnly: true }),
      mk('EID25', { age: 9, discountValue: 25, isActive: false, usageCount: 200, usageLimit: 200, endDate: day(1, 5) }),
    ],
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/PromoCodesPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const codes = () => [...document.querySelectorAll('[data-pm-row]')].map(r => r.getAttribute('data-pm-row'));
const row = (c: string) => document.querySelector(`[data-pm-row="${c}"]`) as HTMLElement;
const saved = (c: string) => getPromoCodes().find(p => p.code === c)!;

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/promo-codes'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, "3 codes", New code, and the table — live codes first', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Promo codes');
    expect(document.querySelector('[data-pm-subtitle]')!.textContent).toBe('3 codes');
    expect(codes()).toEqual(['WELCOME10', 'FLAT200', 'EID25']);
    expect(row('WELCOME10').textContent).toContain('10 %'); expect(row('WELCOME10').textContent).toContain('34 / 100');
    expect(row('FLAT200').textContent).toContain('Rs 200 · min Rs 1,500');
    expect(row('EID25').querySelector('[data-pm-valid]')!.textContent).toBe('expired');
    expect(row('WELCOME10').querySelector('[data-promo-badge-public]')).not.toBeNull();     // the website badges of the old page are kept
    expect(row('FLAT200').querySelector('[data-promo-badge-accounts]')).not.toBeNull();
    expect(row('WELCOME10').querySelector('.pm-bar i')!.getAttribute('style')).toContain('34%');
    expect(row('FLAT200').querySelector('.pm-bar')).toBeNull();                              // no limit, no bar
  });

  it('the chips and the search narrow the table', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-pm-filter="expired"]')!);
    expect(codes()).toEqual(['EID25']);
    fireEvent.click(document.querySelector('[data-pm-filter="active"]')!);
    expect(codes()).toEqual(['WELCOME10', 'FLAT200']);
    fireEvent.click(document.querySelector('[data-pm-filter="all"]')!);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search promo codes' }), { target: { value: 'flat' } });
    expect(codes()).toEqual(['FLAT200']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search promo codes' }), { target: { value: 'zzz' } });
    expect(document.querySelector('[data-pm-empty]')!.textContent).toBe('No codes match.');
  });

  it('the switch turns a code off and on and saves at once', async () => {
    await mount();
    fireEvent.click(within(row('WELCOME10')).getByRole('switch', { name: 'WELCOME10 active' }));
    expect(saved('WELCOME10').isActive).toBe(false);
    fireEvent.click(within(row('WELCOME10')).getByRole('switch', { name: 'WELCOME10 active' }));
    expect(saved('WELCOME10').isActive).toBe(true);
  });

  it('a row opens the editor with the code in it; saving changes the saved code', async () => {
    await mount();
    fireEvent.click(row('FLAT200'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('heading', { name: /Edit Promo Code/ })).toBeInTheDocument();
    expect((within(dlg).getByDisplayValue('FLAT200') as HTMLInputElement).value).toBe('FLAT200');
    fireEvent.change(within(dlg).getByDisplayValue('200'), { target: { value: '300' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(saved('FLAT200').discountValue).toBe(300);
  });

  it('New code opens an empty editor and saves a new code', async () => {
    await mount();
    fireEvent.click(document.querySelector('[data-pm-new]')!);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('heading', { name: /New Promo Code/ })).toBeInTheDocument();
    fireEvent.change(within(dlg).getAllByRole('textbox')[0], { target: { value: 'summer5' } });                // the first box is the code
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(saved('SUMMER5')).toBeTruthy();
    expect(codes()).toContain('SUMMER5');
  });

  it('the ⋯ menu copies the code and deletes it (after a question)', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const ask = vi.fn(() => true);
    Object.defineProperty(window, 'confirm', { value: ask, configurable: true, writable: true });
    await mount();
    fireEvent.click(within(row('EID25')).getByRole('button', { name: /More for EID25/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Copy code/ }));
    expect(write).toHaveBeenCalledWith('EID25');
    cleanup(); await mount();                                                         // a fresh page: the first menu is closed
    fireEvent.click(within(row('EID25')).getByRole('button', { name: /More for EID25/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    expect(ask).toHaveBeenCalled();
    expect(getPromoCodes().some(p => p.code === 'EID25')).toBe(false);
    expect(codes()).not.toContain('EID25');
  });

  it('no codes yet: it says how to start', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!); data.promoCodes = [];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(document.querySelector('[data-pm-empty]')!.textContent).toMatch(/No promo codes yet/);
  });
});

describe('every other look', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/promo-codes'; seed(); });
  afterEach(() => cleanup());
  it('keeps the page: Type / Value / Used-Limit columns and New Promo', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-pm-page]')).toBeNull();
    expect(screen.getByRole('button', { name: /New Promo/ })).toBeInTheDocument();
    expect(screen.getByText('Used / Limit')).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-promos.css');
    expect(read('src/styles.css')).toContain('ui-refined-promos.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
