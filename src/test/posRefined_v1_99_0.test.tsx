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

  // v1.130.0 — the design draws Hold · Discount · Kitchen and ONE Pay; Running, Credit, Void, Receipt, Calculator, Cash received, Note, Token
  // and Manual item are one tap away in the ⋯ menu (nothing was removed). Order type is the three pills on the search row, not a control in the cart.
  const openMore = () => { fireEvent.click(document.querySelector('[data-rf-btn="more"]')!); };
  const moreItems = () => [...document.querySelectorAll('[data-pos-more-item]')].map(b => b.getAttribute('data-pos-more-item'));

  it('DT Refined: the order header, the bar of three actions and one Pay, and the rest one tap away', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mountPos();
    expect(container.querySelector('[data-pos-order-head]')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^Order #\d+$/ })).toBeInTheDocument();
    expect(container.querySelector('[data-pos-order-status]')!.textContent).toBe('New');
    expect(screen.getByRole('button', { name: /Add customer \(phone or name\)/ })).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-pos-card]')!);                       // add the burger
    const bar = container.querySelector('[data-pos-refined-actions]') as HTMLElement;
    expect([...bar.querySelectorAll('[data-rf-btn]')].map(b => b.getAttribute('data-rf-btn'))).toEqual(['hold', 'discount', 'kitchen', 'more']);
    expect([...bar.querySelectorAll('[data-rf-btn]')].slice(0, 3).map(b => b.textContent?.trim())).toEqual(['Hold', 'Discount', 'Kitchen']);
    expect(bar.querySelector('[data-rf-pay]')!.textContent!.trim()).toMatch(/^Pay\s*.*650/);
    // the line reads "Rs 650 each" with a stepper and the line total
    expect(container.querySelector('[data-pos-line-unit]')!.textContent).toMatch(/each$/);
    // nothing else is drawn under Pay: no link row, no Running / Credit / Void row
    expect(container.querySelector('[data-rf-more]')).toBeNull();
    expect(container.querySelector('[data-pos-bottom]')).toBeNull();
    // ...they are all in the ⋯ menu
    openMore();
    expect(moreItems()).toEqual(['running', 'credit', 'void', 'receipt', 'calculator', 'cash', 'note', 'manual']);
    expect(within(document.querySelector('[data-pos-more]') as HTMLElement).getByRole('button', { name: /Void/ })).toBeInTheDocument();
  });

  it('DT Refined: order type is three pills on the search row (the design), not a control inside the cart', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mountPos();
    const chips = [...container.querySelectorAll('[data-pos-ordertype-chip]')];
    expect(chips.map(c => c.textContent)).toEqual(['Dining', 'Takeaway', 'Delivery']);
    expect(chips[0].getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[data-pos-topbar]')!.contains(chips[0])).toBe(true);
    expect(container.querySelector('[data-pos-cart] [data-pos-ordertypes]')).toBeNull();
    fireEvent.click(chips[1]);
    expect(container.querySelectorAll('[data-pos-ordertype-chip]')[1].getAttribute('aria-checked')).toBe('true');
    expect(container.querySelectorAll('[data-pos-ordertype-chip]')[0].getAttribute('aria-checked')).toBe('false');
    // Manual item has no button on the search row; it is in the ⋯ menu
    expect(screen.queryByRole('button', { name: /^Manual$/ })).toBeNull();
    expect(screen.getByPlaceholderText('Search items or scan a barcode')).toBeInTheDocument();
  });

  it('DT Refined: a photo-less tile is a gradient in one of the design\'s five colours and the total reads "Total"', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mountPos();
    const tile = container.querySelector('[data-pos-card-image][data-initials]') as HTMLElement;
    expect(['1', '2', '3', '4', '5']).toContain(tile.getAttribute('data-tile-tone'));
    expect(tile.getAttribute('data-tile-tone')).toBe('2');                                  // "Burgers" is the design's red
    fireEvent.click(container.querySelector('[data-pos-card]')!);
    expect(container.querySelector('[data-pos-grand]')!.textContent).toMatch(/^Total/);
    expect(container.textContent).not.toMatch(/GRAND TOTAL/);
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
    openMore(); fireEvent.click(document.querySelector('[data-pos-more-item="calculator"]')!);
    expect(has('[data-pos-keypad]')).toBe(true);
    expect(document.querySelector('[data-pos-more]')).toBeNull();                          // the menu closes after a choice
    openMore(); fireEvent.click(document.querySelector('[data-pos-more-item="cash"]')!);
    expect(has('[data-pos-payrow]')).toBe(true);
    openMore(); fireEvent.click(document.querySelector('[data-pos-more-item="note"]')!);
    expect(container.textContent).toMatch(/Special note/);
  });

  it('DT Refined: Void and Manual item in the ⋯ menu open the same dialogs the old buttons did', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID);
    const { container } = await mountPos();
    fireEvent.click(container.querySelector('[data-pos-card]')!);
    openMore(); fireEvent.click(document.querySelector('[data-pos-more-item="manual"]')!);
    expect(await screen.findByText('Manual Item')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    openMore(); fireEvent.click(document.querySelector('[data-pos-more-item="void"]')!);
    expect(await screen.findByText(/Void Bill/)).toBeInTheDocument();
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
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g)!.flatMap(s => s.split(/,(?![^(]*\))/)).map(s => s.trim()).filter(s => s && !s.startsWith('@media') && !s.startsWith('@container')); // a media / container wrapper only carries scoped rules
    expect(selectors.length).toBeGreaterThan(30);
    for (const s of selectors) expect(s.startsWith(':root[data-ui="modern"][data-ui-theme="dt-refined"]') || s.startsWith(':is(:root[data-ui="modern"][data-ui-theme="dt-refined"], :root[data-app="otk"])') || s.startsWith(':root[data-app="otk"]'), s).toBe(true);   // v1.104.0: the card and category blocks also serve the Order Taker app
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
