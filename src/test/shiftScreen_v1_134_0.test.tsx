// v1.134.0 — Shift & cash drawer is the design's (SW-24): four figures, Count the drawer (notes × how many), Close the business day.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getOpenShift, getShifts } from '@/lib/store';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { denominationsFor, countedTotal, hasCounted, lineTotal, varianceOf } from '@/lib/cashCount';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

describe('counting the drawer', () => {
  it('the notes follow the restaurant\'s currency, largest first', () => {
    expect(denominationsFor('PKR')).toEqual([5000, 1000, 500, 100, 50, 20, 10]);
    expect(denominationsFor(undefined)).toEqual([5000, 1000, 500, 100, 50, 20, 10]);      // the default currency
    expect(denominationsFor('usd')).toEqual([100, 50, 20, 10, 5, 1]);
    expect(denominationsFor('AED')[0]).toBe(500);
    expect(denominationsFor('XYZ')).toEqual([1000, 500, 100, 50, 20, 10, 5, 1]);         // an unknown currency still gets a run
    for (const c of ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'INR']) { const d = denominationsFor(c); expect([...d].sort((a, b) => b - a)).toEqual(d); }
  });
  it('a row is the note times a whole number; text, fractions and negatives count as nothing', () => {
    expect(lineTotal(500, '40')).toBe(20000);
    expect(lineTotal(500, 3.9)).toBe(1500);
    expect(lineTotal(500, -2)).toBe(0);
    expect(lineTotal(500, 'abc')).toBe(0);
    expect(lineTotal(500, '')).toBe(0);
  });
  it('the total is every row plus loose cash (the design\'s example adds to 93,900)', () => {
    expect(countedTotal({ '5000': '8', '1000': '31', '500': '40', '100': '52', '50': '24', '20': '10' })).toBe(40000 + 31000 + 20000 + 5200 + 1200 + 200);
    expect(countedTotal({ '100': 2 }, '35.5')).toBe(235.5);
    expect(countedTotal({}, 'x')).toBe(0);
  });
  it('knows when anything was typed, even a zero', () => {
    expect(hasCounted({})).toBe(false);
    expect(hasCounted({ '500': '' })).toBe(false);
    expect(hasCounted({ '500': '0' })).toBe(true);
    expect(hasCounted({}, '10')).toBe(true);
  });
  it('variance is counted minus expected, without float noise', () => {
    expect(varianceOf(93900, 94200)).toBe(-300);
    expect(varianceOf(94200.3, 94200.1)).toBe(0.2);
    expect(varianceOf(100, 100)).toBe(0);
  });
});

describe('the Shift screen, mounted', () => {
  const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
  const seed = (withShift: boolean) => {
    localStorage.setItem('pos-device-id', 'dev-1');
    localStorage.setItem('desi-pos-data', JSON.stringify({
      settings: { name: 'Sample', currencySymbol: 'Rs ' },
      users: [{ id: 'a1', name: 'Ali Raza', username: 'ali', password: 'x', role: 'admin', isActive: true }],
      categories: [], menuItems: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], inventory: [], orderCounter: 10,
      orders: [{ id: 'o1', orderNumber: 1, orderType: 'dining', status: 'running', items: [], subtotal: 500, grandTotal: 500, createdAt: new Date().toISOString(), payments: [] }],
      shifts: withShift ? [{ id: 's1', deviceId: 'dev-1', staffName: 'Ali Raza', openedAt: new Date(Date.now() - 3600000).toISOString(), startingCash: 10000, payIns: [], payOuts: [], status: 'open' }] : [],
    }));
    localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ali Raza');
    reload();
  };
  const mount = async () => {
    const { default: Page } = await import('@/pages/ShiftPage');
    window.location.hash = '#/shifts';
    return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>);
  };
  beforeEach(() => { cleanup(); localStorage.clear(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(cleanup);

  it('an open shift: the title, who and when, Cash in / out and Close shift, and the four figures', async () => {
    seed(true);
    const { container } = await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Shift & cash drawer');
    expect(container.textContent).toMatch(/Ali Raza · opened \d\d:\d\d/);
    expect(screen.getByRole('button', { name: /Cash in \/ out/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close shift/ })).toBeInTheDocument();
    expect([...container.querySelectorAll('[data-kpi]')].map(k => k.getAttribute('data-kpi'))).toEqual(['Starting cash', 'Cash sales', 'Expected in drawer', 'Variance so far']);
    expect((container.querySelector('[data-kpi="Starting cash"]') as HTMLElement).textContent).toMatch(/10,000/);
    expect((container.querySelector('[data-kpi="Variance so far"]') as HTMLElement).textContent).toMatch(/Count the drawer/);
  });

  it('typing the notes fills each row, the total, and the variance against what the drawer should hold', async () => {
    seed(true);
    const { container } = await mount();
    fireEvent.change(screen.getByLabelText(/5,000 notes/), { target: { value: '2' } });      // 10,000 = the starting cash
    expect((container.querySelector('[data-denom="5000"]') as HTMLElement).textContent).toMatch(/10,000/);
    expect((container.querySelector('[data-shift-counted]') as HTMLElement).textContent).toMatch(/10,000/);
    expect((container.querySelector('[data-kpi="Variance so far"]') as HTMLElement).textContent).toMatch(/The drawer balances/);
    fireEvent.change(screen.getByLabelText(/1,000 notes/), { target: { value: '1' } });
    expect((container.querySelector('[data-kpi="Variance so far"]') as HTMLElement).textContent).toMatch(/\+.*1,000/);
    expect((container.querySelector('[data-kpi="Variance so far"]') as HTMLElement).textContent).toMatch(/Over/);
  });

  it('the checklist says what is true: an open shift is not "closed", nothing counted is not "counted"', async () => {
    seed(true);
    const { container } = await mount();
    const ok = (k: string) => container.querySelector(`[data-check="${k}"]`)!.getAttribute('data-ok');
    expect(ok('shifts')).toBe('false');
    expect(ok('cash')).toBe('false');
    expect(ok('bills')).toBe('false');                                                      // one running bill
    expect(container.querySelector('[data-check="bills"]')!.textContent).toMatch(/1 open/);
    fireEvent.change(screen.getByLabelText(/Other loose cash/), { target: { value: '50' } });
    expect(ok('cash')).toBe('true');
  });

  it('Close shift refuses until the drawer is counted, then closes with the counted amount', async () => {
    seed(true);
    const { container } = await mount();
    fireEvent.click(screen.getByRole('button', { name: /Close shift/ }));
    expect(getOpenShift()).toBeTruthy();                                                    // nothing counted: still open
    fireEvent.change(screen.getByLabelText(/5,000 notes/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Close shift/ }));
    await waitFor(() => expect(getOpenShift()).toBeUndefined());
    expect(getShifts().find(s => s.id === 's1')).toMatchObject({ status: 'closed', actualEndingCash: 10000 });
    expect(container.querySelector('[data-shift-open-card]')).toBeTruthy();                 // the open form is back
  });

  it('or type the total by hand', async () => {
    seed(true);
    await mount();
    fireEvent.change(screen.getByLabelText('Or type the total'), { target: { value: '9800' } });
    fireEvent.click(screen.getByRole('button', { name: /Close shift/ }));
    await waitFor(() => expect(getShifts().find(s => s.id === 's1')!.actualEndingCash).toBe(9800));
  });

  it('Cash in / out opens a small dialog; Pay in records the movement on the shift', async () => {
    seed(true);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /Cash in \/ out/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Amount'), { target: { value: '2000' } });
    fireEvent.change(within(dlg).getByLabelText('Reason'), { target: { value: 'Float top-up' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Pay in/ }));
    await waitFor(() => expect(getOpenShift()!.payIns).toHaveLength(1));
    expect(getOpenShift()!.payIns[0]).toMatchObject({ amount: 2000, reason: 'Float top-up' });
  });

  it('Close day leads to the Day Close screen (the one that really archives)', async () => {
    seed(true);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close day' }));
    await waitFor(() => expect(window.location.hash).toBe('#/day-close'));
  });

  it('no shift open: the open form, in the design\'s look, still opens a shift', async () => {
    seed(false);
    const { container } = await mount();
    expect(container.textContent).toMatch(/No shift is open/);
    fireEvent.change(screen.getByLabelText(/Starting cash/), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    await waitFor(() => expect(getOpenShift()).toMatchObject({ startingCash: 5000 }));
  });

  it('another look keeps the old page', async () => {
    seed(true); setTheme('ember');
    const { container } = await mount();
    expect(container.querySelector('[data-shift-screen]')).toBeNull();
    expect(screen.getByText('Cash drawer report (live)')).toBeInTheDocument();
  });
});
