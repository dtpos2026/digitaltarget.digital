// v1.120.1 — layout polish: the new screens fit a phone (one card per row instead of a table that is cut off), the desktop lists do not
// break order numbers and amounts across lines, Inventory makes room for its panel, and every page has its own icon in the sidebar.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PAGES } from '@/lib/permissions';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('every list has a phone version next to its table', () => {
  const pins: [string, string, string][] = [
    ['src/pages/CakeOrdersPage.tsx', 'data-cake-cards', 'data-cake-table'], ['src/pages/ExpiryPage.tsx', 'data-expiry-cards', 'data-expiry-table'],
    ['src/components/production/PrepPanel.tsx', 'data-prep-cards', 'data-prep-table'], ['src/components/production/PrepPanel.tsx', 'data-history-cards', 'data-prep-history'],
    ['src/components/rights/RulesPanel.tsx', 'data-rules-cards', 'data-rules-table'], ['src/pages/RecipeCostingPage.tsx', 'data-cost-cards', 'data-cost-table'],
  ];
  for (const [file, cards, table] of pins) {
    it(`${file}: ${cards} is shown below 640 px, ${table} from 640 px up`, () => {
      const src = read(file);
      expect(src).toMatch(new RegExp(`className="[^"]*sm:hidden"[^>]*${cards}`));
      const at = src.indexOf(`<Table ${table}`);
      expect(at).toBeGreaterThan(0);
      expect(src.slice(Math.max(0, at - 80), at)).toContain('hidden sm:block');
    });
  }
});

describe('the desktop lists keep an order number and an amount on one line', () => {
  it('Cake Orders and Expiry cells are no-wrap', () => {
    const cake = read('src/pages/CakeOrdersPage.tsx');
    expect(cake).toMatch(/whitespace-nowrap font-semibold">\{o\.number\}/);
    expect(cake).toMatch(/whitespace-nowrap text-right tabular-nums"><b>\{money\(balanceOf\(o\)\)\}/);
    expect(read('src/pages/ExpiryPage.tsx')).toMatch(/whitespace-nowrap">\{lot\.expiryDate/);
  });
  it('the make-a-batch table keeps "7.2 kg" and "Rs 864.00" whole', () => {
    expect((read('src/components/production/PrepPanel.tsx').match(/whitespace-nowrap text-right tabular-nums/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the sidebar', () => {
  it('every page has its own icon — none is left on the shopping trolley by default', () => {
    const src = read('src/components/AppLayout.tsx');
    const block = /const ICON_BY_KEY[^{]*\{([\s\S]*?)\n\};/.exec(src)![1];
    const have = new Set([...block.matchAll(/'?([\w-]+)'?\s*:/g)].map(m => m[1]));
    expect(PAGES.map(p => p.key).filter(k => !have.has(k))).toEqual([]);
  });
});

// ---------------------------------------------------------------- real pages, seeded store
const STORE_KEY = 'desi-pos-data';
const ymd = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const seed = () => {
  localStorage.clear();
  const inv = (id: string, name: string, q: number) => ({ id, name, sku: id.toUpperCase(), categoryId: 'c1', unit: 'kg', baseUnit: 'kg', quantity: q, costPrice: 100, avgCostPrice: 100, salePrice: 0, lowStockThreshold: 5, isActive: true });
  localStorage.setItem(STORE_KEY, JSON.stringify({
    settings: { name: 'Butt Bakers', currencySymbol: 'Rs ' },
    users: [{ id: 'u-admin', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    branches: [], categories: [{ id: 'c1', name: 'Bakery', icon: '🥐' }], inventory: [inv('cr', 'Fresh cream', 9), inv('fl', 'Flour', 42)],
    stockLots: [{ id: 'l1', inventoryItemId: 'cr', itemName: 'Fresh cream', receivedAt: ymd(-9), expiryDate: ymd(-2), qty: 2, remaining: 2, unitCost: 100, source: 'receiving' }, { id: 'l2', inventoryItemId: 'cr', itemName: 'Fresh cream', receivedAt: ymd(-3), expiryDate: ymd(2), qty: 4, remaining: 4, unitCost: 100, source: 'receiving' }],
    cakeOrders: [{ id: 'c1', number: 'CK-0001', createdAt: '2026-11-10T10:00:00Z', customerName: 'Sana Malik', phone: '0300', description: 'Black forest', quantity: 1, dueDate: ymd(1), handover: 'pickup', total: 3600, payments: [{ id: 'p', kind: 'advance', amount: 1800, method: 'cash', at: '2026-11-11T10:00:00Z' }], status: 'new', updatedAt: '2026-11-10T10:00:00Z' }],
    prepRecipes: [], productionBatches: [], recipes: [], menuItems: [], stockLogs: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], transactions: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', 'u-admin'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-tenant-plan', 'enterprise');
  window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
};

describe('the phone cards show the same rows as the table', () => {
  beforeEach(() => { cleanup(); seed(); });
  it('Expiry: one card per lot, with the item, the date, the days left and the value', async () => {
    const { default: Page } = await import('@/pages/ExpiryPage');
    render(<Page />);
    const cards = [...document.querySelectorAll('[data-lot-card]')];
    expect(cards.length).toBe(document.querySelectorAll('[data-lot-row]').length);
    expect(cards.map(c => c.getAttribute('data-lot-card'))).toEqual(['l1', 'l2']);
    expect(cards[0].textContent).toContain('Fresh cream');
    expect(cards[0].textContent).toContain('Expired 2 days ago');
    expect(cards[0].textContent).toContain(ymd(-2));
    expect(cards[0].textContent).toContain('200');                         // 2 kg × 100
  });
  it('Cake Orders: tapping a card opens the same panel as the row', async () => {
    const { default: Page } = await import('@/pages/CakeOrdersPage');
    render(<Page />);
    const card = document.querySelector('[data-cake-card="c1"]') as HTMLElement;
    expect(card.textContent).toContain('CK-0001 · Sana Malik');
    expect(card.textContent).toContain('1,800');                           // the balance
    fireEvent.click(card);
    expect(document.querySelector('[data-cake-panel="c1"]')).not.toBeNull();
  });
});

describe('Inventory makes room for its panel', () => {
  beforeEach(() => { cleanup(); seed(); });
  it('on a wide window, with the panel open, the row drops SKU, Sale, Unit and the buttons — the panel has them', async () => {
    const mq = vi.fn().mockImplementation((q: string) => ({ matches: /min-width/.test(q), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
    vi.stubGlobal('matchMedia', mq); window.matchMedia = mq as unknown as typeof window.matchMedia;
    const { default: Page } = await import('@/pages/InventoryPage');
    render(<Page />);
    const heads = () => [...document.querySelectorAll('thead th')].map(t => t.textContent);
    expect(heads()).toEqual(expect.arrayContaining(['SKU', 'Unit', 'Actions']));          // nothing open: the full table
    fireEvent.click(document.querySelector('[data-inventory-row="fl"]')!);
    expect(heads()).not.toContain('SKU');
    expect(heads()).not.toContain('Actions');
    expect(heads()).toEqual(expect.arrayContaining(['Item', 'Category', 'Stock', 'Status']));
    expect(document.querySelector('[data-panel-in]')).not.toBeNull();                      // and the actions are in the panel
    vi.unstubAllGlobals();
  });
});
