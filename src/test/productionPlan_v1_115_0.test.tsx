// v1.115.0 — Production Plan for a bakery / café / restaurant chain: what to make tomorrow, per branch, from the same weekday's sales.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Order } from '@/lib/types';
import { buildPlan, localDay, planAsCsv, planAsText, roundUpTo, sameWeekdays } from '@/lib/productionPlan';
import { PAGES } from '@/lib/permissions';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const TARGET = new Date(2026, 10, 18);                     // Wednesday 18 Nov 2026 (local)
const items = [
  { id: 'cr', name: 'Croissant', categoryId: 'bk', pricingType: 'fixed' },
  { id: 'br', name: 'Sourdough', categoryId: 'bk', pricingType: 'fixed' },
  { id: 'kg', name: 'Cheese by kg', categoryId: 'dl', pricingType: 'weight' },
  { id: 'cf', name: 'Latte', categoryId: 'cf', pricingType: 'fixed' },
];
let n = 0;
const order = (day: string, branchId: string, lines: [string, number][], status = 'paid'): Order => ({
  id: `o${++n}`, orderNumber: n, branchId, status, createdAt: `${day}T12:00:00`, items: lines.map(([menuItemId, quantity]) => ({ id: `l${n}${menuItemId}`, menuItemId, name: menuItemId, quantity })),
} as unknown as Order);

describe('the same weekdays', () => {
  it('goes back in whole weeks from the day planned, as local dates', () => {
    expect(sameWeekdays(TARGET, 3)).toEqual(['2026-11-11', '2026-11-04', '2026-10-28']);
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('the plan', () => {
  const history = [
    order('2026-11-11', 'b1', [['cr', 20], ['br', 4], ['kg', 2]]),
    order('2026-11-04', 'b1', [['cr', 30], ['br', 6]]),
    order('2026-10-28', 'b1', [['cr', 10]]),
  ];
  it('is the average of the trading days plus the buffer, rounded up', () => {
    const p = buildPlan({ orders: history, items, target: TARGET, weeks: 3, bufferPct: 10 });
    const cr = p.rows.find(r => r.itemId === 'cr')!;
    expect(cr.history.all).toEqual([20, 30, 10]);
    expect(cr.average.all).toBe(20);
    expect(cr.forecast.all).toBe(22);                              // 20 + 10%
    expect(p.rows.map(r => r.name)).toEqual(['Croissant', 'Sourdough']);   // biggest first, weighed item left out
    expect(p.rows.find(r => r.itemId === 'br')!.forecast.all).toBe(4);    // (4+6+0)/3 = 3.33 → ... a day with no Sourdough still traded, so it is a zero
  });
  it('a day the branch did not trade at all is skipped, not averaged in as zero', () => {
    const h = [order('2026-11-11', 'b1', [['cr', 20]]), order('2026-10-28', 'b1', [['cr', 20]])];   // 4 Nov: closed
    const p = buildPlan({ orders: h, items, target: TARGET, weeks: 3, bufferPct: 0 });
    expect(p.rows[0].average.all).toBe(20);
    expect(p.rows[0].tradingDays).toBe(2);
  });
  it('void, cancelled, held and rejected bills never count; a complimentary one does (it was baked)', () => {
    const h = [
      order('2026-11-11', 'b1', [['cr', 10]]), order('2026-11-11', 'b1', [['cr', 99]], 'void'), order('2026-11-11', 'b1', [['cr', 99]], 'cancelled'),
      order('2026-11-11', 'b1', [['cr', 99]], 'hold'), order('2026-11-11', 'b1', [['cr', 99]], 'rejected'), order('2026-11-11', 'b1', [['cr', 5]], 'complimentary'),
    ];
    expect(buildPlan({ orders: h, items, target: TARGET, weeks: 1, bufferPct: 0 }).rows[0].history.all).toEqual([15]);
  });
  it('one column per branch for the central bakery, each from its own days', () => {
    const h = [
      order('2026-11-11', 'b1', [['cr', 20]]), order('2026-11-11', 'b2', [['cr', 8]]), order('2026-11-04', 'b2', [['cr', 12]]),
      order('2026-11-04', 'b3', [['cr', 6]]),                                    // b3 outside the chosen branches
    ];
    const p = buildPlan({ orders: h, items, target: TARGET, weeks: 2, bufferPct: 0, branchIds: ['b1', 'b2'] });
    expect(p.columns).toEqual(['b1', 'b2']);
    expect(p.rows[0].forecast).toEqual({ b1: 20, b2: 10 });
  });
  it('can be limited to some categories, and rounded up to trays', () => {
    const h = [order('2026-11-11', 'b1', [['cr', 14], ['cf', 40]])];
    const p = buildPlan({ orders: h, items, target: TARGET, weeks: 1, bufferPct: 0, categoryIds: ['bk'], batch: 12 });
    expect(p.rows.map(r => r.name)).toEqual(['Croissant']);
    expect(p.rows[0].forecast.all).toBe(24);
    expect(roundUpTo(0, 6)).toBe(0);
    expect(roundUpTo(7, 6)).toBe(12);
    expect(roundUpTo(7, 0)).toBe(7);
  });
  it('no history gives an empty plan, not a made-up one', () => {
    expect(buildPlan({ orders: [], items, target: TARGET }).rows).toEqual([]);
    expect(buildPlan({ orders: [order('2026-11-18', 'b1', [['cr', 5]])], items, target: TARGET }).rows).toEqual([]);   // today's own sales are not history
  });
  it('an order with no readable date is ignored', () => {
    const bad = { ...order('2026-11-11', 'b1', [['cr', 5]]), createdAt: 'not a date' } as Order;
    expect(buildPlan({ orders: [bad], items, target: TARGET }).rows).toEqual([]);
  });
});

describe('sharing it', () => {
  it('text for WhatsApp: one line per item with the branch split; items with nothing to make are left out', () => {
    const t = planAsText('Production plan — Wed', [
      { name: 'Croissant', perColumn: [{ label: 'Main', qty: 20 }, { label: 'DHA', qty: 0 }, { label: 'Gulberg', qty: 12 }], total: 32 },
      { name: 'Rye', perColumn: [{ label: 'Main', qty: 0 }, { label: 'DHA', qty: 0 }, { label: 'Gulberg', qty: 0 }], total: 0 },
    ]);
    expect(t).toBe('Production plan — Wed\n\nCroissant — 32 (Main 20 · Gulberg 12)');
  });
  it('CSV: header with a column per branch and a Total, names with commas quoted', () => {
    expect(planAsCsv(['Main', 'DHA'], [{ name: 'Rolls, sesame', perColumn: [10, 5], total: 15 }])).toBe('Item,Main,DHA,Total\n"Rolls, sesame",10,5,15');
    expect(planAsCsv(['All'], [{ name: 'Bun', perColumn: [7], total: 7 }])).toBe('Item,All\nBun,7');
  });
});

describe('where it lives', () => {
  it('is a page in the Inventory group for admins and managers, routed, with an icon and a name in every language', () => {
    const page = PAGES.find(p => p.key === 'production-plan')!;
    expect(page).toMatchObject({ path: '/production-plan', group: 'Inventory', defaultRoles: ['admin', 'manager'] });
    expect(read('src/App.tsx')).toContain('<Route path="/production-plan" element={<ProductionPlanPage />} />');
    expect(read('src/components/shell/navIcons.ts')).toContain("'production-plan': Wheat");
    expect(read('src/lib/i18nNav.ts').match(/"nav\.production-plan"/g)).toHaveLength(3);
    expect(read('src/lib/orgStructure.ts')).toContain("'wastage', 'production-plan'");
  });
});
