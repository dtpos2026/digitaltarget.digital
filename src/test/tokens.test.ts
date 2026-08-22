// ============================================================
// Tests — Token Printing Module (v1.3.0)
// Verifies the core design promise: a token sale is a NORMAL sale
// (same orders collection, revenue, reporting) — not a parallel system.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MenuItem, Order } from '@/lib/types';

// The store keeps an in-memory cache, so each test needs a FRESH module
// instance — otherwise orders/counters leak between tests.
let getOrders: typeof import('@/lib/store')['getOrders'];
let nextTokenNumber: typeof import('@/lib/tokens')['nextTokenNumber'];
let peekTokenNumber: typeof import('@/lib/tokens')['peekTokenNumber'];
let formatTokenLabel: typeof import('@/lib/tokens')['formatTokenLabel'];
let createTokenSale: typeof import('@/lib/tokens')['createTokenSale'];
let completeToken: typeof import('@/lib/tokens')['completeToken'];
let cancelToken: typeof import('@/lib/tokens')['cancelToken'];
let markTokenReprinted: typeof import('@/lib/tokens')['markTokenReprinted'];
let getTokenOrders: typeof import('@/lib/tokens')['getTokenOrders'];
let computeTokenStats: typeof import('@/lib/tokens')['computeTokenStats'];
let tokenRevenueVisible: typeof import('@/lib/tokens')['tokenRevenueVisible'];
let tokenModuleEnabled: typeof import('@/lib/tokens')['tokenModuleEnabled'];

const chai: MenuItem = {
  id: 'm-chai', name: 'Chai', categoryId: 'c1', pricingType: 'fixed',
  price: 80, ratePerKg: 0, isActive: true, isTokenItem: true,
} as MenuItem;

const samosa: MenuItem = {
  id: 'm-samosa', name: 'Samosa', categoryId: 'c1', pricingType: 'fixed',
  price: 50, ratePerKg: 0, isActive: true, isTokenItem: true,
} as MenuItem;

function seed(settings: Record<string, unknown> = {}) {
  localStorage.clear();
  localStorage.setItem('desi-pos-data', JSON.stringify({
    orders: [], settings, categories: [], menuItems: [chai, samosa],
    tables: [], users: [], orderCounter: 100,
  }));
}

beforeEach(async () => {
  seed();
  vi.resetModules();
  const store = await import('@/lib/store');
  const tokens = await import('@/lib/tokens');
  getOrders = store.getOrders;
  ({
    nextTokenNumber, peekTokenNumber, formatTokenLabel, createTokenSale,
    completeToken, cancelToken, markTokenReprinted, getTokenOrders,
    computeTokenStats, tokenRevenueVisible, tokenModuleEnabled,
  } = tokens);
});

describe('token numbering', () => {
  it('increments sequentially', async () => {
    expect(nextTokenNumber()).toBe(1);
    expect(nextTokenNumber()).toBe(2);
    expect(nextTokenNumber()).toBe(3);
  });

  it('peek does not consume a number', async () => {
    nextTokenNumber();          // 1
    expect(peekTokenNumber()).toBe(2);
    expect(peekTokenNumber()).toBe(2);
    expect(nextTokenNumber()).toBe(2);
  });

  it('formats with zero padding and optional prefix', async () => {
    expect(formatTokenLabel(7)).toBe('007');
    expect(formatTokenLabel(42, { tokenPrefix: 'T' } as any)).toBe('T-042');
    expect(formatTokenLabel(123, { tokenPrefix: 'A' } as any)).toBe('A-123');
  });
});

describe('createTokenSale — behaves exactly like a normal sale', () => {
  it('saves into the SAME orders collection as a paid sale', async () => {
    const order = await createTokenSale([{ item: chai, quantity: 2, unitPrice: 80 }]);
    const stored = getOrders();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(order.id);
    // paid => flows into revenue, reports, analytics, inventory
    expect(order.status).toBe('paid');
    expect(order.grandTotal).toBe(160);
    expect(order.amountPaid).toBe(160);
  });

  it('stamps token metadata and a real order number', async () => {
    const order = await createTokenSale([{ item: chai, quantity: 1, unitPrice: 80 }]);
    expect(order.isTokenSale).toBe(true);
    expect(order.tokenNumber).toBe(1);
    expect(order.tokenLabel).toBe('001');
    expect(order.tokenStatus).toBe('pending');
    expect(order.orderNumber).toBe(101); // continues the normal counter
  });

  it('supports multiple lines and totals them correctly', async () => {
    const order = await createTokenSale([
      { item: chai, quantity: 2, unitPrice: 80 },
      { item: samosa, quantity: 3, unitPrice: 50 },
    ]);
    expect(order.items).toHaveLength(2);
    expect(order.grandTotal).toBe(160 + 150);
  });

  it('marks items as already printed so no KOT diff is ever produced', async () => {
    const order = await createTokenSale([{ item: chai, quantity: 2, unitPrice: 80 }]);
    expect(order.items[0].printedQty).toBe(2);
  });

  it('rejects an empty sale', async () => {
    await expect(createTokenSale([])).rejects.toThrow();
  });
});

describe('token status transitions', () => {
  it('completes a token and records the time', async () => {
    const o = await createTokenSale([{ item: chai, quantity: 1, unitPrice: 80 }]);
    const done = completeToken(o.id)!;
    expect(done.tokenStatus).toBe('completed');
    expect(done.tokenCompletedAt).toBeTruthy();
  });

  it('cancelling a token ALSO voids the sale so revenue stays correct', async () => {
    const o = await createTokenSale([{ item: chai, quantity: 1, unitPrice: 80 }]);
    const cancelled = cancelToken(o.id, 'customer left')!;
    expect(cancelled.tokenStatus).toBe('cancelled');
    expect(cancelled.status).toBe('cancelled'); // not counted as income
  });

  it('counts reprints for the audit trail', async () => {
    const o = await createTokenSale([{ item: chai, quantity: 1, unitPrice: 80 }]);
    markTokenReprinted(o.id);
    markTokenReprinted(o.id);
    expect(getOrders().find(x => x.id === o.id)!.tokenReprintCount).toBe(2);
  });

  it('ignores transitions on non-token orders', async () => {
    expect(completeToken('does-not-exist')).toBeNull();
    expect(cancelToken('does-not-exist')).toBeNull();
  });
});

describe('token stats / dashboard', () => {
  it('aggregates counts, revenue and top item; excludes cancelled from revenue', async () => {
    const a = await createTokenSale([{ item: chai, quantity: 3, unitPrice: 80 }]);   // 240
    const b = await createTokenSale([{ item: samosa, quantity: 1, unitPrice: 50 }]); // 50
    const c = await createTokenSale([{ item: chai, quantity: 5, unitPrice: 80 }]);   // 400 -> cancelled
    completeToken(a.id);
    cancelToken(c.id);

    const stats = computeTokenStats(getTokenOrders());
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.revenue).toBe(290);   // cancelled 400 excluded
    expect(stats.quantity).toBe(4);    // cancelled qty excluded
    expect(stats.topItem?.name).toBe('Chai');
    expect(stats.lastToken).toBe(3);
    // unused ref keeps the intent clear
    expect(b.isTokenSale).toBe(true);
  });

  it('only counts token orders, never normal sales', async () => {
    await createTokenSale([{ item: chai, quantity: 1, unitPrice: 80 }]);
    const raw = JSON.parse(localStorage.getItem('desi-pos-data')!);
    raw.orders.push({ id: 'normal-1', orderNumber: 999, status: 'paid', items: [], grandTotal: 5000, createdAt: new Date().toISOString() } as Order);
    localStorage.setItem('desi-pos-data', JSON.stringify(raw));
    expect(getTokenOrders()).toHaveLength(1);
  });
});

describe('settings gates default to safe values', () => {
  it('module is OFF unless explicitly enabled (no impact on other restaurants)', async () => {
    expect(tokenModuleEnabled({} as any)).toBe(false);
    expect(tokenModuleEnabled({ tokenModuleEnabled: true } as any)).toBe(true);
  });

  it('revenue reporting defaults ON once the module is enabled, and can be switched OFF', async () => {
    // v1.3.1: sub-options only apply while the parent module is ON — that is
    // what stops a disabled module leaking anything into other restaurants.
    expect(tokenRevenueVisible({ tokenModuleEnabled: true } as any)).toBe(true);
    expect(tokenRevenueVisible({ tokenModuleEnabled: true, tokenIncludeRevenueInReports: false } as any)).toBe(false);
    // module OFF => nothing token-related is active at all
    expect(tokenRevenueVisible({} as any)).toBe(false);
  });
});
