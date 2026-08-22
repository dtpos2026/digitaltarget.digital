// Smart Customer Database — intelligence + search helpers
import { CustomerProfile, CustomerGrade, Order } from './types';
import { getCustomers, getOrders } from './store';
import { normalizePhone } from './whatsapp';

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
      const addr = (c.fullAddress || c.addresses?.[0] || '').toLowerCase();
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
