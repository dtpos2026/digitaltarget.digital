// v1.84.0 — the numbers behind the Super Admin dashboard.
import { describe, it, expect } from 'vitest';
import { buildKpis, renewalsDue, waitingForApproval, toMs, daysToExpiry, ONLINE_WINDOW_MS, type AdminOverviewInput } from '@/lib/superAdminOverview';

const NOW = new Date(2026, 10, 15, 12).getTime();
const day = (n: number) => new Date(NOW + n * 86400000).toISOString();
const T = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Rest ${id}`, approved: true, ...over }) as any;
const input = (o: Partial<AdminOverviewInput> = {}): AdminOverviewInput => ({ tenants: [], devices: [], invoices: [], payments: [], nowMs: NOW, ...o });

describe('time helpers', () => {
  it('reads an ISO string, a Date, a number, a timestamp-like object; junk is null', () => {
    expect(toMs('2026-11-15T12:00:00Z')).toBe(Date.parse('2026-11-15T12:00:00Z'));
    expect(toMs(new Date(5000))).toBe(5000);
    expect(toMs(7)).toBe(7);
    expect(toMs({ seconds: 10 })).toBe(10000);
    expect(toMs({ toMillis: () => 42 })).toBe(42);
    for (const bad of [null, undefined, '', 'not a date', NaN, {}]) expect(toMs(bad)).toBeNull();
  });
  it('whole days to expiry; none when there is no expiry', () => {
    expect(daysToExpiry(day(10), NOW)).toBe(10);
    expect(daysToExpiry(day(-3), NOW)).toBe(-3);
    expect(daysToExpiry(undefined, NOW)).toBeNull();
  });
});

describe('the cards', () => {
  const k = buildKpis(input({
    tenants: [
      T('a', { planExpiryAt: day(40) }), T('b', { planExpiryAt: day(3) }), T('c', { planExpiryAt: day(-5) }),
      T('d', { approved: false }), T('e'),
    ],
    devices: [
      { tenantId: 'a', approved: true, blocked: false, lastSeenMs: NOW - 60_000 },
      { tenantId: 'a', approved: true, blocked: false, lastSeenMs: NOW - ONLINE_WINDOW_MS - 1 },
      { tenantId: 'b', approved: false, blocked: false, lastSeenMs: null },
      { tenantId: 'b', approved: false, blocked: true, lastSeenMs: null },
      { tenantId: 'c', approved: true, blocked: true, lastSeenMs: NOW - 1000 },
    ],
    invoices: [
      { tenantId: 'a', total: 12000, paidTotal: 5000, status: 'partial' },
      { tenantId: 'a', total: 3000, paidTotal: 0, status: 'unpaid' },
      { tenantId: 'b', total: 9000, paidTotal: 9000, status: 'paid' },
      { tenantId: 'c', total: 7000, paidTotal: 0, status: 'void' },
      { tenantId: 'e', total: 4000, paidTotal: 0, status: 'unpaid' },
    ],
    payments: [
      { amount: 5000, receivedAt: new Date(2026, 10, 2).toISOString() },
      { amount: 9000, receivedAt: new Date(2026, 10, 14).toISOString() },
      { amount: 7000, receivedAt: new Date(2026, 9, 28).toISOString() },     // last month
    ],
  }));
  it('restaurants, waiting for approval, active (approved and not expired)', () => {
    expect(k.restaurants).toBe(5);
    expect(k.waiting).toBe(1);
    expect(k.active).toBe(3);                // a, b, e — c is expired, d is waiting
  });
  it('expired and expiring in seven days are separate; a restaurant with no expiry is neither', () => {
    expect(k.expired).toBe(1);
    expect(k.expiring7).toBe(1);
  });
  it('device requests are unapproved and not blocked; blocked devices counted apart', () => {
    expect(k.newDeviceRequests).toBe(1);
    expect(k.blockedDevices).toBe(2);
  });
  it('online means approved, not blocked, seen in the last five minutes', () => {
    expect(k.devicesOnline).toBe(1);
  });
  it('outstanding is what open invoices still owe; cancelled and paid owe nothing; payment pending counts restaurants', () => {
    expect(k.outstanding).toBe(7000 + 3000 + 4000);
    expect(k.paymentPending).toBe(2);        // a and e
  });
  it('collected this month counts only this month\'s payments', () => {
    expect(k.collectedThisMonth).toBe(14000);
  });
  it('an empty console is all zeros, not NaN', () => {
    expect(buildKpis(input())).toEqual({ restaurants: 0, waiting: 0, newDeviceRequests: 0, active: 0, paymentPending: 0, expired: 0, expiring7: 0, blockedDevices: 0, devicesOnline: 0, collectedThisMonth: 0, outstanding: 0 });
  });
  it('an expiry exactly now counts as expired, not as expiring', () => {
    const r = buildKpis(input({ tenants: [T('x', { planExpiryAt: new Date(NOW - 1).toISOString() })] }));
    expect(r.expired).toBe(1);
    expect(r.expiring7).toBe(0);
  });
  it('overpaid invoices never make a negative balance', () => {
    expect(buildKpis(input({ invoices: [{ tenantId: 'a', total: 1000, paidTotal: 5000, status: 'partial' }] })).outstanding).toBe(0);
  });
});

describe('renewals due', () => {
  const tenants = [T('a', { planExpiryAt: day(-9) }), T('b', { planExpiryAt: day(2) }), T('c', { planExpiryAt: day(12) }), T('d', { planExpiryAt: day(60) }), T('e')];
  it('lists expired and soon-to-expire, most overdue first, with the right badge', () => {
    const r = renewalsDue(tenants, NOW);
    expect(r.rows.map(x => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.rows.map(x => x.badge)).toEqual(['expired', 'soon', 'active']);
    expect(r.total).toBe(3);
  });
  it('a limit shortens the list but not the total', () => {
    const r = renewalsDue(tenants, NOW, 14, 2);
    expect(r.rows).toHaveLength(2);
    expect(r.total).toBe(3);
  });
  it('the horizon is the owner\'s to change', () => {
    expect(renewalsDue(tenants, NOW, 90).rows.map(x => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('waiting for approval', () => {
  it('the restaurant that has waited longest is on top; one with no date goes last', () => {
    const r = waitingForApproval([
      T('n', { approved: false, createdAt: day(-1) }), T('o', { approved: false, createdAt: day(-20) }), T('u', { approved: false }), T('ok'),
    ]);
    expect(r.rows.map(x => x.id)).toEqual(['o', 'n', 'u']);
    expect(r.total).toBe(3);
  });
});
