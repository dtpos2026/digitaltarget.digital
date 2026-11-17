// v1.115.1 — Stock Count: a physical stock-take, the difference valued at cost and posted once to the stock ledger.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { countLines, loadDraft, parseCounted, postCount, postingPlan, saveDraft, summarize } from '@/lib/stockCount';
import { PAGES } from '@/lib/permissions';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const items = [
  { id: 'fl', name: 'Flour', unit: 'kg', baseUnit: 'kg' as const, quantity: 50, avgCostPrice: 120, costPrice: 100 },
  { id: 'sg', name: 'Sugar', unit: 'kg', baseUnit: 'kg' as const, quantity: 20, costPrice: 150 },
  { id: 'bt', name: 'Butter', unit: 'kg', baseUnit: 'kg' as const, quantity: 8, costPrice: 900 },
  { id: 'eg', name: 'Eggs', unit: 'pcs', baseUnit: 'pcs' as const, quantity: 300, costPrice: 30 },
];

describe('the count', () => {
  it('reads what was typed: blank is not counted, zero is a real count, rubbish and negatives are not counts', () => {
    expect(parseCounted('')).toBeNull();
    expect(parseCounted(undefined)).toBeNull();
    expect(parseCounted('0')).toBe(0);
    expect(parseCounted('12.5')).toBe(12.5);
    expect(parseCounted('-3')).toBeNull();
    expect(parseCounted('abc')).toBeNull();
  });
  it('difference = counted − expected, valued at the moving-average cost (else the cost price)', () => {
    const l = countLines(items, { fl: '47', sg: '23', bt: '8', eg: '' });
    expect(l[0]).toMatchObject({ expected: 50, counted: 47, diff: -3, value: -360 });      // 3 × avg 120
    expect(l[1]).toMatchObject({ diff: 3, value: 450 });                                   // no avg → cost 150
    expect(l[2]).toMatchObject({ diff: 0, value: 0 });
    expect(l[3]).toMatchObject({ counted: null, diff: null, value: null });
  });
  it('summarizes counted items, differences, gains and losses apart, and the net', () => {
    const s = summarize(countLines(items, { fl: '47', sg: '23', bt: '8' }));
    expect(s).toEqual({ counted: 3, withDifference: 2, gains: 450, losses: -360, net: 90 });
  });
});

describe('posting', () => {
  it('plans one correction per counted item that differs — never the uncounted or the equal ones', () => {
    const plan = postingPlan(countLines(items, { fl: '47', sg: '23', bt: '8' }), 's1', '2026-11-17');
    expect(plan.map(p => [p.itemId, p.delta, p.movementId])).toEqual([['fl', -3, 'count:s1:fl'], ['sg', 3, 'count:s1:sg']]);
    expect(plan[0].note).toBe('Stock count 2026-11-17 — counted 47, expected 50');
  });
  it('sets the stock to the count, working from what the stock is NOW (a sale while counting does not leave it off)', () => {
    const adjust = vi.fn().mockReturnValue({ applied: true, duplicate: false });
    const now: Record<string, number> = { fl: 48, sg: 20, bt: 8, eg: 300 };          // 2 kg of flour were used since the sheet was opened
    const r = postCount(countLines(items, { fl: '47', sg: '23', bt: '8' }), 's2', '2026-11-17', id => now[id] ?? null, adjust);
    expect(adjust).toHaveBeenCalledTimes(2);
    expect(adjust).toHaveBeenCalledWith('fl', -1, 'adjustment', expect.stringContaining('counted 47, system 48'), { movementId: 'count:s2:fl', refType: 'adjustment', refId: 's2' });
    expect(adjust).toHaveBeenCalledWith('sg', 3, 'adjustment', expect.any(String), { movementId: 'count:s2:sg', refType: 'adjustment', refId: 's2' });
    expect(r).toEqual({ applied: 2, duplicates: 0, skipped: 2 });
  });
  it('a second post of the same session is refused by the ledger and counted as already posted', () => {
    const seen = new Set<string>();
    const adjust = (_i: string, _q: number, _t: 'adjustment', _n: string, o: { movementId: string }) => { const dup = seen.has(o.movementId); seen.add(o.movementId); return { applied: !dup, duplicate: dup }; };
    const lines = countLines(items, { fl: '47' });
    expect(postCount(lines, 's3', 'x', () => 50, adjust as never)).toEqual({ applied: 1, duplicates: 0, skipped: 3 });
    expect(postCount(lines, 's3', 'x', () => 50, adjust as never)).toEqual({ applied: 0, duplicates: 1, skipped: 3 });
  });
  it('an item that has gone from the stock list is skipped, not crashed on', () => {
    const adjust = vi.fn();
    expect(postCount(countLines(items, { fl: '47' }), 's4', 'x', () => null, adjust).skipped).toBe(4);
    expect(adjust).not.toHaveBeenCalled();
  });
});

describe('the draft', () => {
  beforeEach(() => localStorage.clear());
  it('is kept per restaurant and branch, and cleared when empty', () => {
    saveDraft('t1:all', { fl: '47' });
    expect(loadDraft('t1:all')).toEqual({ fl: '47' });
    expect(loadDraft('t1:b2')).toEqual({});
    saveDraft('t1:all', {});
    expect(localStorage.getItem('dt-stock-count-draft:t1:all')).toBeNull();
  });
});

// ---- the page, with the store replaced
const adjustStock = vi.fn().mockReturnValue({ applied: true, duplicate: false });
vi.mock('@/lib/store', () => ({
  getInventory: () => [
    { id: 'fl', name: 'Flour', sku: 'FL-1', categoryId: 'dry', unit: 'kg', baseUnit: 'kg', quantity: 50, costPrice: 100, avgCostPrice: 120, isActive: true },
    { id: 'sg', name: 'Sugar', sku: 'SG-1', categoryId: 'dry', unit: 'kg', baseUnit: 'kg', quantity: 20, costPrice: 150, isActive: true },
  ],
  getCategories: () => [{ id: 'dry', name: 'Dry goods' }],
  getBranches: () => [],
  adjustStock: (...a: unknown[]) => adjustStock(...a),
  genId: () => 'session-1',
  getCurrentUser: () => ({ name: 'Owner', role: 'admin' }),
}));
vi.mock('@/lib/tenant', () => ({ getTenantId: () => 't1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('Stock Count page', () => {
  beforeEach(() => { localStorage.clear(); adjustStock.mockClear(); });
  it('typing a count shows the difference and its value; the totals and the Post button follow', async () => {
    const { default: Page } = await import('@/pages/StockCountPage');
    render(<Page />);
    expect((document.querySelector('[data-count-post]') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(document.querySelector('[data-count-input="fl"]')!, { target: { value: '47' } });
    const row = within(document.querySelector('[data-count-row="fl"]') as HTMLElement);
    expect(row.getByText('-3')).toBeInTheDocument();
    expect(document.querySelector('[data-count-losses]')?.textContent).toContain('360');
    expect((document.querySelector('[data-count-post]') as HTMLButtonElement).textContent).toBe('Post to stock (1)');
  });
  it('the count is kept as a draft and comes back after a reload', async () => {
    const { default: Page } = await import('@/pages/StockCountPage');
    const first = render(<Page />);
    fireEvent.change(document.querySelector('[data-count-input="sg"]')!, { target: { value: '23' } });
    first.unmount();
    render(<Page />);
    expect((document.querySelector('[data-count-input="sg"]') as HTMLInputElement).value).toBe('23');
  });
  it('posting goes through the ledger once with the movement id, then the sheet is clear', async () => {
    const { default: Page } = await import('@/pages/StockCountPage');
    render(<Page />);
    fireEvent.change(document.querySelector('[data-count-input="fl"]')!, { target: { value: '47' } });
    fireEvent.click(document.querySelector('[data-count-post]')!);
    fireEvent.click(document.querySelector('[data-count-confirm-post]')!);
    expect(adjustStock).toHaveBeenCalledTimes(1);
    expect(adjustStock).toHaveBeenCalledWith('fl', -3, 'adjustment', expect.stringContaining('counted 47, system 50'), { movementId: 'count:session-1:fl', refType: 'adjustment', refId: 'session-1' });
    expect((document.querySelector('[data-count-input="fl"]') as HTMLInputElement).value).toBe('');
  });
  it('"differences" shows only the lines that differ', async () => {
    const { default: Page } = await import('@/pages/StockCountPage');
    render(<Page />);
    fireEvent.change(document.querySelector('[data-count-input="fl"]')!, { target: { value: '47' } });
    fireEvent.change(document.querySelector('[data-count-input="sg"]')!, { target: { value: '20' } });
    fireEvent.click(document.querySelector('[data-count-show="differences"]')!);
    expect(document.querySelector('[data-count-row="fl"]')).not.toBeNull();
    expect(document.querySelector('[data-count-row="sg"]')).toBeNull();
  });
});

describe('where it lives, and the look', () => {
  it('Inventory group, admin and manager, routed, iconed, named in every language', () => {
    expect(PAGES.find(p => p.key === 'stock-count')).toMatchObject({ path: '/stock-count', group: 'Inventory', defaultRoles: ['admin', 'manager'] });
    expect(read('src/App.tsx')).toContain('<Route path="/stock-count" element={<StockCountPage />} />');
    expect(read('src/lib/i18nNav.ts').match(/"nav\.stock-count"/g)).toHaveLength(3);
  });
  it('both new pages are built from the shared page frame and table, not their own markup', () => {
    for (const f of ['src/pages/StockCountPage.tsx', 'src/pages/ProductionPlanPage.tsx']) {
      const src = read(f);
      expect(src, f).toContain("from '@/components/layout/PageFrame'");
      expect(src, f).toContain('<PageHeader');
      expect(src, f).toContain('<FilterBar');
      expect(src, f).toContain('<EmptyState');
      expect(src, f).toContain("from '@/components/ui/table'");
      expect(src, f).toContain('<Table');
      expect(src, f).not.toContain('<table');
      expect(src, f).toContain('space-y-4 p-4 lg:p-6');
    }
  });
});
