// ============================================================
// v1.99.0 — the POS in DT Refined (design package SW-03).
//
// Under DT Refined the cart panel is the package's: the order and its status at the top, "Add customer", lines with a stepper,
// the totals, three actions (Hold, Discount, Kitchen) and ONE big Pay; Receipt, Calculator, Cash received, Note and Token are one tap
// away, and Running / Credit / Void stay. Every function is still there and runs the same code as the classic buttons.
// Under every other theme nothing changes.
//
// Pinned: the panel really mounts and works in both modes (add, discount toggle, calculator toggle); the Refined bar and the
// classic buttons share their handlers; the classic path is untouched; the stylesheet is scoped and hides only what the bar replaces.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HashRouter } from '@/lib/hash-router';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';

vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: async () => {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
function seed() {
  localStorage.setItem('desi-pos-data', JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ' },
    users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
    categories: [{ id: 'burgers', name: 'Burgers', icon: '', sortOrder: 1 }],
    menuItems: [{ id: 'm1', name: 'Zinger Burger', price: 650, categoryId: 'burgers', pricingType: 'fixed', isActive: true }],
    orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], orderCounter: 40,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Owner');
  reload();
}
async function mountPos() {
  const { default: POSScreen } = await import('@/pages/POSScreen');
  window.location.hash = '#/';
  return render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><HashRouter><POSScreen /></HashRouter></TooltipProvider></QueryClientProvider>);
}

describe('the POS panel, mounted', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); });
  afterEach(() => cleanup());

  it('DT Refined: the order header, the bar of three actions and one Pay, and the rest one tap away', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mountPos();
    expect(container.querySelector('[data-pos-order-head]')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Order #\d+$/ })).toBeInTheDocument();
    expect(container.querySelector('[data-pos-order-status]')!.textContent).toBe('New');
    expect(screen.getByRole('button', { name: /Add customer \(phone or name\)/ })).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-pos-card]')!);                       // add the burger
    const bar = container.querySelector('[data-pos-refined-actions]') as HTMLElement;
    expect([...bar.querySelectorAll('[data-rf-btn]')].map(b => b.textContent?.trim())).toEqual(['Hold', 'Discount', 'Kitchen']);
    expect(bar.querySelector('[data-rf-pay]')!.textContent!.trim()).toMatch(/^Pay\s*.*650/);
    expect([...bar.querySelectorAll('[data-rf-more] button')].map(b => b.textContent?.trim().replace(/\s*•$/, ''))).toEqual(['Receipt', 'Calculator', 'Cash received', 'Note']);
    // the line reads "Rs 650 each" with a stepper and the line total
    expect(container.querySelector('[data-pos-line-unit]')!.textContent).toMatch(/each$/);
    // Running, Credit and Void are still on the panel
    const bottom = container.querySelector('[data-pos-bottom]') as HTMLElement;
    expect(within(bottom).getByRole('button', { name: /Running/ })).toBeInTheDocument();
    expect(within(bottom).getByRole('button', { name: /Credit/ })).toBeInTheDocument();
    expect(within(bottom).getByRole('button', { name: /Void/ })).toBeInTheDocument();
  });

  it('DT Refined: Discount, Calculator, Cash received and Note open their controls and close them again; they are not on screen until asked for', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mountPos();
    fireEvent.click(container.querySelector('[data-pos-card]')!);
    const has = (sel: string) => !!container.querySelector(sel);
    expect(has('[data-pos-keypad]')).toBe(false);
    expect(has('[data-pos-payrow]')).toBe(false);
    expect(container.textContent).not.toMatch(/Promo/);
    fireEvent.click(container.querySelector('[data-rf-btn="discount"]')!);
    expect(container.textContent).toMatch(/Discount/);
    expect(container.textContent).toMatch(/Promo/);
    fireEvent.click(container.querySelector('[data-rf-btn="discount"]')!);
    expect(container.textContent).not.toMatch(/Promo/);
    fireEvent.click(screen.getByRole('button', { name: /Calculator/ }));
    expect(has('[data-pos-keypad]')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Cash received/ }));
    expect(has('[data-pos-payrow]')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Note/ }));
    expect(container.textContent).toMatch(/Special note/);
  });

  it('every other theme: the classic panel exactly — no Refined bar, the keypad, discount, payment and note all in place', async () => {
    setUiStyle('modern'); setTheme('ember');
    const { container } = await mountPos();
    fireEvent.click(container.querySelector('[data-pos-card]')!);
    expect(container.querySelector('[data-pos-refined-actions]')).toBeNull();
    expect(container.querySelector('[data-pos-order-head]')).toBeNull();
    for (const sel of ['[data-pos-keypad]', '[data-pos-payrow]', '[data-pos-clr]', '[data-pos-actions-main]', '[data-pos-actions-secondary]', '[data-pos-hold]', '[data-pos-pay]']) {
      expect(container.querySelector(sel), sel).toBeTruthy();
    }
    expect(container.textContent).toMatch(/Promo/);
    expect(container.textContent).toMatch(/Special note/);
  });
});

describe('the wiring and the stylesheet', () => {
  const pos = read('src/pages/POSScreen.tsx');
  const css = read('src/styles/ui-refined-pos.css');

  it('is Refined only, and the Refined bar and the classic buttons run the same functions', () => {
    expect(pos).toContain('const refined = modern && isRefinedTheme(useThemeId());');
    // Kitchen and Receipt are named once and used by both
    expect(pos).toMatch(/const handleKitchenClick = async \(\) => \{/);
    expect(pos).toMatch(/const handleReceiptClick = \(\) => \{/);
    expect((pos.match(/onClick=\{handleKitchenClick\}/g) || []).length).toBe(2);
    expect((pos.match(/onClick=\{handleReceiptClick\}/g) || []).length).toBe(2);
    // Hold and Pay call what they always called
    expect(pos).toMatch(/data-rf-btn="hold" onClick=\{\(\) => processOrder\('hold'\)\}/);
    expect(pos).toMatch(/else handleDirectPay\(\);/);
    expect(pos).toContain("setReviewOpen(true); } else handleDirectPay()");   // an order taker's Pay is Send, to the review sheet
    // an order taker gets no discount, receipt or cash box in the bar
    expect(pos).toMatch(/data-rf-btn="discount"[^>]*disabled=\{isOrderTaker\}/);
    expect(pos).toMatch(/\{!isOrderTaker && <button type="button" onClick=\{handleReceiptClick\}>/);
  });

  it('the classic controls are only hidden behind a Refined toggle, never removed', () => {
    for (const k of ['!refined || showDisc', '!refined || showCash', '!refined || showNote', '!refined || showKeypad || !!numpadItem']) expect(pos, k).toContain(k);
    expect(pos).toContain('data-pos-hold');
  });

  it('the stylesheet is scoped to DT Refined and hides only what the bar replaces', () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g)!.flatMap(s => s.split(/,(?![^(]*\))/)).map(s => s.trim()).filter(s => s && !s.startsWith('@media')); // a media wrapper only carries scoped rules
    expect(selectors.length).toBeGreaterThan(30);
    for (const s of selectors) expect(s.startsWith(':root[data-ui="modern"][data-ui-theme="dt-refined"]'), s).toBe(true);
    const hidden = css.match(/\[data-pos-hold\][\s\S]*?\{ display: none; \}/)![0];
    for (const k of ['[data-pos-hold]', '[data-pos-pay]', '[data-pos-actions-secondary]', '[data-pos-keypad] > button']) expect(hidden).toContain(k);
    expect(hidden).not.toContain('[data-pos-clr]');                      // CLR and Apply belong to the calculator and stay
    expect(css).toContain('height: 52px');                                 // the big Pay
    expect(read('src/styles.css')).toContain('@import "./styles/ui-refined-pos.css";');
  });

  it('no emoji in the Refined bar', () => {
    const bar = pos.slice(pos.indexOf('data-pos-refined-actions'), pos.indexOf('{/* Action Buttons - always visible at bottom */}'));
    expect(bar).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
