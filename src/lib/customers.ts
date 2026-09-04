// Smart Customer Database — intelligence + search helpers
import { CustomerProfile, CustomerGrade, Order } from './types';
import { getCustomers, getOrders } from './store';
import { normalizePhone } from './whatsapp';
import { primaryAddress } from '@/lib/customerAddress';

export const GRADE_THRESHOLDS = {
  platinum: 50000,
  gold: 20000,
  silver: 5000,
};

export function computeGrade(totalSpent: number): CustomerGrade {
  if (totalSpent >= GRADE_THRESHOLDS.platinum) return 'platinum';
  if (totalSpent >= GRADE_THRESHOLDS.gold) return 'gold';
  if (totalSpent >= GRADE_THRESHOLDS.silver) return 'silver';
  return 'regular';
}

export function gradeColor(g?: CustomerGrade): string {
  switch (g) {
    case 'platinum': return 'bg-violet-500/15 text-violet-700 border-violet-500/30';
    case 'gold':     return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
    case 'silver':   return 'bg-slate-400/15 text-slate-700 border-slate-400/30';
    default:         return 'bg-muted text-muted-foreground border-border';
  }
}

/** Search by name, phone, address — returns sorted by relevance/recency. */
export function searchCustomers(q: string, limit = 8): CustomerProfile[] {
  const all = getCustomers();
  const s = q.trim().toLowerCase();
  if (!s) return all.slice().sort((a, b) => (b.lastOrderAt || '').localeCompare(a.lastOrderAt || '')).slice(0, limit);
  const digits = s.replace(/\D/g, '');
  return all
    .filter(c => {
      if (c.name?.toLowerCase().includes(s)) return true;
      if (digits && (c.phone || '').replace(/\D/g, '').includes(digits)) return true;
      const addr = primaryAddress(c).toLowerCase();
      if (addr.includes(s)) return true;
      return false;
    })
    .sort((a, b) => (b.lastOrderAt || '').localeCompare(a.lastOrderAt || ''))
    .slice(0, limit);
}

export function getCustomerOrders(customerId: string): Order[] {
  const digits = (customerId || '').replace(/\D/g, '');
  return getOrders().filter(o => {
    const p = normalizePhone(o.customer?.phone || o.creditCustomerPhone || '') || (o.customer?.phone || '').replace(/\D/g, '');
    return p === customerId || p === digits;
  });
}

export interface CustomerStats {
  totalOrders: number;
  totalSpent: number;
  avgOrderValue: number;
  firstOrderAt?: string;
  lastOrderAt?: string;
  daysSinceLastOrder?: number;
  orderFrequencyDays?: number;
  favoriteItemId?: string;
  favoriteItemName?: string;
  favoriteCategoryId?: string;
  favoriteCategoryName?: string;
  grade: CustomerGrade;
}

export function computeCustomerStats(customerId: string): CustomerStats {
  const orders = getCustomerOrders(customerId).filter(o => o.status === 'paid' || o.status === 'credit_received');
  const totalOrders = orders.length;
  const totalSpent = orders.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const avgOrderValue = totalOrders ? Math.round(totalSpent / totalOrders) : 0;

  const dates = orders.map(o => o.paidAt || o.createdAt).filter(Boolean).sort();
  const firstOrderAt = dates[0];
  const lastOrderAt = dates[dates.length - 1];
  let daysSinceLastOrder: number | undefined;
  if (lastOrderAt) daysSinceLastOrder = Math.floor((Date.now() - new Date(lastOrderAt).getTime()) / 86400000);
  let orderFrequencyDays: number | undefined;
  if (dates.length >= 2) {
    const span = (new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / 86400000;
    orderFrequencyDays = Math.max(1, Math.round(span / (dates.length - 1)));
  }

  // Favourites
  const itemCount = new Map<string, { name: string; n: number }>();
  const catCount = new Map<string, { name: string; n: number }>();
  for (const o of orders) {
    for (const it of o.items || []) {
      const ik = it.menuItemId || it.name;
      const ie = itemCount.get(ik) || { name: it.name, n: 0 };
      ie.n += it.quantity || 1;
      itemCount.set(ik, ie);
      const ck = (it as any).categoryId || (it as any).category || '';
      if (ck) {
        const ce = catCount.get(ck) || { name: (it as any).category || ck, n: 0 };
        ce.n += it.quantity || 1;
        catCount.set(ck, ce);
      }
    }
  }
  const topItem = [...itemCount.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const topCat = [...catCount.entries()].sort((a, b) => b[1].n - a[1].n)[0];

  return {
    totalOrders, totalSpent, avgOrderValue,
    firstOrderAt, lastOrderAt, daysSinceLastOrder, orderFrequencyDays,
    favoriteItemId: topItem?.[0], favoriteItemName: topItem?.[1].name,
    favoriteCategoryId: topCat?.[0], favoriteCategoryName: topCat?.[1].name,
    grade: computeGrade(totalSpent),
  };
}

/** Merge address parts into a single human-readable line. */
export function composeFullAddress(c: Partial<CustomerProfile>): string {
  const parts = [
    c.houseNumber && `House ${c.houseNumber}`,
    c.streetNumber && `St ${c.streetNumber}`,
    c.street,
    c.society,
    c.area,
    c.city,
    c.district,
    c.province,
  ].filter(Boolean);
  return parts.join(', ');
}

// ============================================================================
// Birthdays — v1.27.0
//
// The customer app collects a date of birth, and the point of collecting it is
// that the restaurant can act on it. These live here, in the CRM module, rather
// than in the app: a birthday list is worth just as much to the counter and to
// a marketing campaign as it is to the app that gathered the date.
//
// Everything is month/day. A birthday is an anniversary, not a date, and the
// year is only ever useful for age.
// ============================================================================

/** Days until the next occurrence of this birthday. 0 means today. */
export function daysUntilBirthday(dateOfBirth?: string | null, from: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
  // 29 February in a common year is marked on the 1st of March.
  if (dob.getMonth() === 1 && dob.getDate() === 29 && next.getMonth() !== 1) {
    next = new Date(today.getFullYear(), 2, 1);
  }
  if (next < today) {
    next = new Date(today.getFullYear() + 1, next.getMonth(), next.getDate());
  }
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export function isBirthdayToday(dateOfBirth?: string | null, from: Date = new Date()): boolean {
  return daysUntilBirthday(dateOfBirth, from) === 0;
}

/** Age on their next birthday, or null when the year is unknown or implausible. */
export function ageOnNextBirthday(dateOfBirth?: string | null, from: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const days = daysUntilBirthday(dateOfBirth, from);
  if (days == null) return null;
  const year = from.getFullYear() + (days > 0 && new Date(from.getFullYear(), dob.getMonth(), dob.getDate()) < from ? 1 : 0);
  const age = year - dob.getFullYear();
  return age > 0 && age < 130 ? age : null;
}

export interface BirthdayCustomer<T> {
  customer: T;
  daysUntil: number;
  age: number | null;
}

/**
 * Everyone whose birthday falls within the next `days`, soonest first.
 *
 * `days = 0` is "today only", which is the campaign a restaurant actually
 * sends; a week's notice is what a manager plans with.
 */
export function birthdaysWithin<T extends { dateOfBirth?: string }>(
  customers: readonly T[],
  days = 7,
  from: Date = new Date(),
): Array<BirthdayCustomer<T>> {
  const out: Array<BirthdayCustomer<T>> = [];
  for (const c of customers) {
    const d = daysUntilBirthday(c.dateOfBirth, from);
    if (d == null || d > days) continue;
    out.push({ customer: c, daysUntil: d, age: ageOnNextBirthday(c.dateOfBirth, from) });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}
