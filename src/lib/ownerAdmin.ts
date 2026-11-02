// ============================================================
// OWNER APP — profit (OWN-12), website and app switches (OWN-20), devices (OWN-21) — v1.91.0.
// Pure functions; the screens are in src/components/owner/OwnerAdmin.tsx and the one cloud write (devices) in
// lib/ownerCloud.ts.
// ============================================================
import type { ProfitAndLoss } from './financials';
import type { RestaurantSettings } from './types';
import type { DeviceRow } from './branchHub';

// ------------------------------------------------------------------ OWN-12 profit
export type ProfitState = 'empty' | 'complete' | 'partial' | 'unknown';

export interface ProfitView {
  state: ProfitState;
  revenue: number;
  /** Food cost from recipes plus wastage. */
  costOfGoods: number;
  /** Operating expenses plus payroll. */
  expenses: number;
  /** null when the cost of goods cannot be trusted at all (see below). */
  profit: number | null;
  margin: number | null;
  /** How much of the period's item sales had a recipe, 0..100. */
  coverage: number;
  linesWithoutRecipe: number;
  bars: { key: 'revenue' | 'cost' | 'expenses' | 'profit'; label: string; value: number }[];
  topExpenses: { label: string; amount: number; share: number }[];
}

/**
 * The profit figure the owner sees, with the design's rule: a profit computed on food costs that are only partly
 * known is flattering, so the screen says so. Cost of goods comes from recipes at average cost (financials.ts); an item
 * without a recipe costs nothing in that sum.
 *   • no sales and no spending in the period → empty;
 *   • every sold line has a recipe → complete: the profit is shown as it is;
 *   • some do → partial: shown as "at most", with how much is covered;
 *   • sales but no recipe at all → unknown: no profit is shown, because the whole food cost is missing.
 */
export function profitView(p: ProfitAndLoss): ProfitView {
  const revenue = p.netRevenue;
  const costOfGoods = p.foodCost + p.wastage;
  const expenses = p.expenses.reduce((s, l) => s + l.amount, 0) + p.payroll;
  const coverage = Math.round(p.foodCostCoverage * 100);
  const hasActivity = p.billCount > 0 || expenses > 0 || p.wastage > 0;
  let state: ProfitState = 'complete';
  if (!hasActivity) state = 'empty';
  else if (revenue > 0 && p.foodCostCoverage <= 0) state = 'unknown';
  else if (p.linesWithoutRecipe > 0 || p.foodCostCoverage < 1) state = 'partial';
  const profit = state === 'unknown' || state === 'empty' ? null : p.netProfit;
  const topTotal = p.expenses.reduce((s, l) => s + l.amount, 0);
  return {
    state, revenue, costOfGoods, expenses, profit,
    margin: profit != null && revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
    coverage, linesWithoutRecipe: p.linesWithoutRecipe,
    bars: [
      { key: 'revenue', label: 'Revenue', value: revenue },
      { key: 'cost', label: 'Cost of goods', value: costOfGoods },
      { key: 'expenses', label: 'Expenses', value: expenses },
      ...(profit != null ? [{ key: 'profit' as const, label: 'Profit', value: profit }] : []),
    ],
    topExpenses: [...p.expenses].filter(l => l.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 6)
      .map(l => ({ label: l.label, amount: l.amount, share: topTotal > 0 ? Math.round((l.amount / topTotal) * 100) : 0 })),
  };
}

// ------------------------------------------------------------------ OWN-20 website and app switches
export type SwitchKey = 'onlineOrderEnabled' | 'onlineDeliveryEnabled' | 'onlinePickupEnabled' | 'allowGuestCheckout';

export interface SwitchDef { key: SwitchKey; label: string; help: string; master?: boolean }
export const SWITCHES: SwitchDef[] = [
  { key: 'onlineOrderEnabled', label: 'Online ordering', help: 'The customer website and its QR codes. Off: customers see "closed" and cannot order.', master: true },
  { key: 'onlineDeliveryEnabled', label: 'Home delivery', help: 'Customers can choose delivery. Turn off when the riders are overwhelmed.' },
  { key: 'onlinePickupEnabled', label: 'Pickup', help: 'Customers can choose to collect their order.' },
  { key: 'allowGuestCheckout', label: 'Guest checkout', help: 'Ordering without signing up.' },
];

/** On unless the restaurant turned it off: the software's own default for each of these (a missing setting is on). */
export function switchOn(s: Partial<RestaurantSettings>, key: SwitchKey): boolean {
  return s[key] !== false;
}

/** A switch under the master one cannot be changed while online ordering is off — the till's page does the same. */
export function switchDisabled(s: Partial<RestaurantSettings>, def: SwitchDef): boolean {
  return !def.master && !switchOn(s, 'onlineOrderEnabled');
}

export type ApprovalChoice = 'auto' | 'manual';
export function approvalMode(s: Partial<RestaurantSettings>): ApprovalChoice {
  return s.onlineOrderApprovalMode === 'manual' ? 'manual' : 'auto';
}

export interface PortalLink { key: string; label: string; url: string; note?: string }

/** The same links the till's Customer Portal page hands out (id form, v1.56.3). */
export function portalLinks(origin: string, tenantId: string | null | undefined): PortalLink[] {
  const seg = tenantId ? `/${tenantId}` : '';
  return [
    { key: 'order', label: 'Customer website', url: `${origin}/#/order${seg}` },
    { key: 'takeaway', label: 'Takeaway QR', url: `${origin}/#/order${seg}?mode=takeaway` },
    { key: 'delivery', label: 'Delivery QR', url: `${origin}/#/order${seg}?mode=delivery` },
    { key: 'table', label: 'Table QR (dine-in)', url: `${origin}/#/order${seg}?table=Table%201`, note: 'Per-table codes are printed from Tables.' },
    { key: 'track', label: 'Order tracking', url: `${origin}/#/track${seg}` },
  ];
}

// ------------------------------------------------------------------ OWN-21 devices
export interface DeviceGroups {
  pending: DeviceRow[];
  approved: (DeviceRow & { online: boolean })[];
  blocked: DeviceRow[];
}

/** A device is online when its last heartbeat is under five minutes old (the Devices page and Branch Management agree). */
export const DEVICE_ONLINE_MS = 5 * 60_000;

export function groupDevices(rows: DeviceRow[], now = Date.now()): DeviceGroups {
  const t = (d: DeviceRow) => Date.parse(d.lastSeenAt || '') || 0;
  const online = (d: DeviceRow) => t(d) > 0 && now - t(d) < DEVICE_ONLINE_MS;
  return {
    pending: rows.filter(d => !d.approved && !d.blocked).sort((a, b) => t(b) - t(a)),
    approved: rows.filter(d => d.approved && !d.blocked).map(d => ({ ...d, online: online(d) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || t(b) - t(a) || a.label.localeCompare(b.label)),
    blocked: rows.filter(d => d.blocked).sort((a, b) => t(b) - t(a)),
  };
}

/** What each action writes. Block also takes the device's sync rights away at once (the Devices page does the same). */
export type DeviceAction = 'approve' | 'block' | 'unblock' | 'reject';
export function devicePatch(action: DeviceAction, now = new Date()): Record<string, unknown> | null {
  switch (action) {
    case 'approve': return { approved: true, approved_at: now.toISOString(), blocked: false };
    case 'block': return { blocked: true, blocked_at: now.toISOString(), approved: false };
    case 'unblock': return { blocked: false, blocked_at: null };
    case 'reject': return null;   // a rejected request is removed
  }
}

/** The phone the owner is holding is never blocked or rejected from itself: that would lock the owner out. */
export function canActOn(d: { id: string }, thisDeviceId: string, action: DeviceAction): boolean {
  return !(d.id === thisDeviceId && (action === 'block' || action === 'reject'));
}
