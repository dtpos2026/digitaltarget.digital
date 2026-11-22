// ============================================================
// v1.142.0 — Tokens as the design draws it (SW-36): "Tokens · Counter service", Reset counter, the waiting tokens as large numbers with their state
// (Ready · Cooking · New), and a history table (Token · Bill · Time · Status · Reprints). Tap a number to Call, Complete, Reprint or Cancel it.
// Pinned: the rules in lib/tokenBoard.ts, every action against the saved token, the counter reset, the permissions, the old look and the scoped stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getOrders } from '@/lib/store';
import { nextTokenNumber, peekTokenNumber, resetTokenCounter } from '@/lib/tokens';
import { activeTokens, historyTokens, isActiveToken, statusWord, tokenState, tokenSubtitle } from '@/lib/tokenBoard';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/TokenSlip', () => ({ default: ({ order }: { order: { tokenLabel?: string } }) => <div data-testid="slip">{order.tokenLabel}</div> }));
const announce = vi.fn(async () => ({ spoken: 1, skipped: [], notes: [] }));
vi.mock('@/lib/kitchenDisplay', async (orig) => ({ ...(await orig<typeof import('@/lib/kitchenDisplay')>()), announceKitchenOrder: (...a: unknown[]) => (announce as any)(...a) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

const tok = (n: number, status: string, ks: string | undefined, age: number, extra: Record<string, unknown> = {}) => ({
  id: `t${n}`, orderNumber: 1000 + n, orderType: 'takeaway', status: status === 'cancelled' ? 'cancelled' : status === 'pending' ? 'running' : 'paid', source: 'pos', isTokenSale: true,
  tokenNumber: n, tokenLabel: String(n).padStart(3, '0'), tokenStatus: status, kitchenStatus: ks,
  items: [{ id: `i${n}`, menuItemId: 'm1', name: 'Zinger Burger', pricingType: 'fixed', price: 650, quantity: 1, lineTotal: 650, note: '' }],
  subtotal: 650, discount: 0, tax: 0, serviceCharge: 0, serviceChargePercent: 0, grandTotal: 650, notes: '', payments: [], amountPaid: 0, createdAt: ago(age), cashierName: 'Ayesha', ...extra,
});
const TOKENS = () => [
  tok(41, 'pending', 'ready', 9), tok(42, 'pending', 'ready', 8), tok(43, 'pending', 'preparing', 6), tok(45, 'pending', undefined, 2),
  tok(40, 'completed', 'delivered', 20), tok(39, 'completed', 'delivered', 26, { tokenReprintCount: 1, cashierName: 'Bilal' }), tok(38, 'cancelled', 'pending', 40),
  tok(30, 'completed', 'delivered', 60 * 30),                                   // yesterday-ish: only under "All time"
];

describe('the rules', () => {
  it('a token on the counter is one nobody has collected or cancelled; its state is the kitchen\'s', () => {
    expect(isActiveToken({ tokenStatus: undefined })).toBe(true);
    expect(isActiveToken({ tokenStatus: 'pending' })).toBe(true);
    expect(isActiveToken({ tokenStatus: 'completed' })).toBe(false);
    expect(isActiveToken({ tokenStatus: 'cancelled' })).toBe(false);
    expect(tokenState({ kitchenStatus: 'ready' })).toBe('ready');
    expect(tokenState({ kitchenStatus: 'preparing' })).toBe('cooking');
    expect(tokenState({ kitchenStatus: undefined })).toBe('new');
    expect(tokenState({ kitchenStatus: 'accepted' })).toBe('new');
  });

  it('the tiles: waiting tokens, the longest-waiting number first; the history: the rest, newest first, narrowed by day, search, dates and cashier', () => {
    const all = TOKENS() as any[];
    expect(activeTokens(all).map(o => o.tokenNumber)).toEqual([41, 42, 43, 45]);
    const f = { range: 'all' as const, q: '', from: '', to: '', cashier: '' };
    expect(historyTokens(all, f).map(o => o.tokenNumber)).toEqual([40, 39, 38, 30]);
    expect(historyTokens(all, { ...f, range: 'today' }).map(o => o.tokenNumber)).toEqual([40, 39, 38]);
    expect(historyTokens(all, { ...f, q: '1039' }).map(o => o.tokenNumber)).toEqual([39]);
    expect(historyTokens(all, { ...f, q: 'zinger' }).length).toBe(4);
    expect(historyTokens(all, { ...f, cashier: 'Bilal' }).map(o => o.tokenNumber)).toEqual([39]);
    expect(statusWord({ tokenStatus: 'completed' })).toBe('Collected');
    expect(statusWord({ tokenStatus: 'cancelled' })).toBe('Cancelled');
    expect(statusWord({ tokenStatus: undefined })).toBe('Waiting');
  });

  it('the subtitle; revenue only when revenue reporting is on', () => {
    const s = { total: 12, pending: 3, avgMinutes: 4, revenue: 7800 };
    expect(tokenSubtitle(s, true, n => `Rs ${n.toLocaleString('en-US')}`)).toBe('Counter service · 12 today · 3 waiting · avg 4 m · Rs 7,800');
    expect(tokenSubtitle({ ...s, avgMinutes: null }, false, n => String(n))).toBe('Counter service · 12 today · 3 waiting');
  });

  it('Reset counter: the next token is 1 again', () => {
    localStorage.clear();
    nextTokenNumber({} as any); nextTokenNumber({} as any); nextTokenNumber({} as any);
    expect(peekTokenNumber({} as any)).toBe(4);
    resetTokenCounter();
    expect(peekTokenNumber({} as any)).toBe(1);
    expect(nextTokenNumber({} as any)).toBe(1);
  });
});

function seed(role = 'admin') {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Chai Corner', currencySymbol: 'Rs ', tokenModuleEnabled: true },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role, isActive: true }],
    categories: [], menuItems: [], orders: TOKENS(),
    tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], transactions: [], inventory: [], orderCounter: 2000,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', role); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/TokensPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const tiles = () => [...document.querySelectorAll('[data-tk-tile]')].map(t => t.getAttribute('data-tk-tile'));
const rows = () => [...document.querySelectorAll('[data-tk-row]')].map(r => r.getAttribute('data-tk-row'));
const saved = (id: string) => getOrders().find(o => o.id === id)!;
const tile = (label: string) => document.querySelector(`[data-tk-tile="${label}"]`) as HTMLElement;

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/tokens'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); announce.mockClear(); });
  afterEach(() => cleanup());

  it('"Tokens", the counter line, and the waiting tokens as large numbers with their state', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tokens');
    expect(document.querySelector('[data-tk-subtitle]')!.textContent).toMatch(/^Counter service · 7 today · 4 waiting/);
    expect(tiles()).toEqual(['041', '042', '043', '045']);
    expect(tile('041').getAttribute('data-state')).toBe('ready');
    expect(tile('043').getAttribute('data-state')).toBe('cooking');
    expect(tile('045').getAttribute('data-state')).toBe('new');
    expect(tile('041').textContent).toContain('Ready');
    expect(tile('045').textContent).toContain('New');
  });

  it('the history table: token, bill, time, status, reprints — today first; All time adds the older ones', async () => {
    await mount();
    expect(rows()).toEqual(['040', '039', '038']);
    const r = document.querySelector('[data-tk-row="039"]') as HTMLElement;
    expect(r.textContent).toContain('#1039');
    expect(within(r).getByText('Collected')).toBeInTheDocument();
    expect(r.children[4].textContent).toBe('1');
    expect(within(document.querySelector('[data-tk-row="038"]') as HTMLElement).getByText('Cancelled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(rows()).toEqual(['040', '039', '038', '030']);
  });

  it('the search, and the filters (cashier)', async () => {
    await mount();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tokens' }), { target: { value: '1038' } });
    expect(rows()).toEqual(['038']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tokens' }), { target: { value: '' } });
    fireEvent.click(document.querySelector('[data-tk-filters]')!);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Cashier' }), { target: { value: 'Bilal' } });
    expect(rows()).toEqual(['039']);
  });

  it('Call token announces the number (and says so); it changes nothing', async () => {
    await mount();
    fireEvent.click(tile('041'));
    fireEvent.click(await screen.findByRole('button', { name: /Call token/ }));
    expect(announce).toHaveBeenCalledTimes(1);
    expect((announce.mock.calls[0] as unknown[])[0]).toBe('041');
    expect(saved('t41').tokenStatus).toBe('pending');
  });

  it('Complete marks it collected: the tile goes and the row joins the history', async () => {
    await mount();
    fireEvent.click(tile('042'));
    fireEvent.click(await screen.findByRole('button', { name: /Complete/ }));
    expect(saved('t42').tokenStatus).toBe('completed');
    expect(saved('t42').tokenCompletedAt).toBeTruthy();
    expect(tiles()).toEqual(['041', '043', '045']);
    expect(rows()).toContain('042');
  });

  it('Reprint counts the reprint and shows the slip', async () => {
    await mount();
    fireEvent.click(tile('043'));
    fireEvent.click(await screen.findByRole('button', { name: /Reprint/ }));
    expect(saved('t43').tokenReprintCount).toBe(1);
    expect(await screen.findByTestId('slip')).toHaveTextContent('043');
  });

  it('Cancel token asks for a reason, cancels it and voids the sale', async () => {
    const prompt = vi.fn(() => 'customer left');
    Object.defineProperty(window, 'prompt', { value: prompt, configurable: true, writable: true });
    await mount();
    fireEvent.click(tile('045'));
    fireEvent.click(await screen.findByRole('button', { name: /Cancel token/ }));
    expect(prompt).toHaveBeenCalled();
    expect(saved('t45').tokenStatus).toBe('cancelled');
    expect(saved('t45').status).toBe('cancelled');
    expect(tiles()).not.toContain('045');
  });

  it('a history row\'s ⋯ reprints too, but cannot complete a token that is already collected', async () => {
    await mount();
    fireEvent.click(within(document.querySelector('[data-tk-row="040"]') as HTMLElement).getByRole('button', { name: /More for token 040/ }));
    expect(await screen.findByRole('button', { name: /Reprint/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull();
  });

  it('Reset counter asks first, then the next token is 1', async () => {
    const ask = vi.fn(() => true);
    Object.defineProperty(window, 'confirm', { value: ask, configurable: true, writable: true });
    nextTokenNumber({} as any); nextTokenNumber({} as any);
    await mount();
    fireEvent.click(document.querySelector('[data-tk-reset]')!);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(peekTokenNumber({} as any)).toBe(1);
  });

  it('a Reset that is declined changes nothing', async () => {
    Object.defineProperty(window, 'confirm', { value: vi.fn(() => false), configurable: true, writable: true });
    nextTokenNumber({} as any); nextTokenNumber({} as any);
    await mount();
    fireEvent.click(document.querySelector('[data-tk-reset]')!);
    expect(peekTokenNumber({} as any)).toBe(3);
  });

  it('nothing waiting and no history: it says so', async () => {
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!); data.orders = [];
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    await mount();
    expect(document.querySelector('[data-tk-none]')!.textContent).toBe('No token is waiting.');
    expect(document.querySelector('[data-tk-empty]')!.textContent).toMatch(/No tokens yet/);
  });
});

describe('a cashier', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); window.location.hash = '#/tokens'; seed('cashier'); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());
  it('cannot reset the counter or cancel a token (the buttons are off)', async () => {
    await mount();
    expect(document.querySelector('[data-tk-reset]')).toBeDisabled();
    fireEvent.click(tile('041'));
    expect(await screen.findByRole('button', { name: /Cancel token/ })).toBeDisabled();
  });
});

describe('the module off, and every other look', () => {
  afterEach(() => cleanup());
  it('the module off: the page says so, under every look', async () => {
    cleanup(); localStorage.clear(); seed();
    const data = JSON.parse(localStorage.getItem('desi-pos-data')!); data.settings.tokenModuleEnabled = false;
    localStorage.setItem('desi-pos-data', JSON.stringify(data)); reload();
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    await mount();
    expect(screen.getByText('The Token module is off')).toBeInTheDocument();
  });
  it('another look keeps the page: the stat cards and the tabs', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-tk-page]')).toBeNull();
    expect(screen.getByText('Token Management')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'today' })).toBeInTheDocument();
  });
});

describe('the sidebar name and the stylesheet', () => {
  it('the module is called Tokens, as in the design', () => {
    expect(read('src/lib/i18nNav.ts')).toContain('"nav.tokens": "Tokens"');
  });
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-tokens.css');
    expect(read('src/styles.css')).toContain('ui-refined-tokens.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});
