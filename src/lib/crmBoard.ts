// v1.151.0 — "CRM insights" as the design draws it (SW-20): "Last 90 days", four figure cards (Active customers ▲ 8% · Repeat rate ▲ 3 pts · At risk "No order in
// 30 d" · Birthdays this month), the bars of "Orders per customer" (1 · 2 · 3 · 4 · 5 · 6–9 · 10+) and the list "At risk — send an offer" (a name and "34 d").
// Everything is worked out from the paid bills of the last 90 days — and the 90 days before them, for the arrows — with one person = one phone number (the last ten
// digits, so 0300… and +92300… are the same person), else the customer record, else the name. Pure: bills and customers in, numbers and words out.
import type { CustomerProfile, Order } from './types';

/** A customer on record; the date of birth (YYYY-MM-DD) is there when the customer's own app collected it. */
export type Customer = CustomerProfile & { dateOfBirth?: string };

export const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 90;
export const AT_RISK_DAYS = 30;

const digits = (s?: string) => String(s || '').replace(/\D/g, '');
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** One person: their phone's last ten digits, else the customer record, else the name; null for a bill with nobody on it. */
export function personKey(o: Pick<Order, 'customer' | 'creditCustomerName' | 'creditCustomerPhone'>): string | null {
  const phone = digits(o.customer?.phone || o.creditCustomerPhone);
  if (phone.length >= 7) return `p:${phone.slice(-10)}`;
  if (o.customer?.id) return `i:${o.customer.id}`;
  const name = String(o.customer?.name || o.creditCustomerName || '').trim().toLowerCase();
  return name ? `n:${name}` : null;
}

const at = (o: Pick<Order, 'paidAt' | 'createdAt'>) => { const t = new Date(o.paidAt || o.createdAt || '').getTime(); return Number.isFinite(t) ? t : 0; };

export interface CrmPerson {
  key: string;
  name: string;
  phone: string;
  /** paid bills in the window */
  orders: number;
  spent: number;
  /** the last bill, ms */
  lastAt: number;
  /** whole days since the last bill */
  daysSince: number;
}

/** The people who paid a bill in [from, to) — newest details win for the name and the phone. */
export function peopleIn(orders: Order[], from: number, to: number, now: number): CrmPerson[] {
  const map = new Map<string, CrmPerson>();
  for (const o of orders) {
    const t = at(o);
    if (!(t >= from && t < to)) continue;
    const key = personKey(o);
    if (!key) continue;
    const cur = map.get(key) || { key, name: '', phone: '', orders: 0, spent: 0, lastAt: 0, daysSince: 0 };
    cur.orders += 1; cur.spent += num(o.grandTotal);
    if (t >= cur.lastAt) { cur.lastAt = t; cur.name = String(o.customer?.name || o.creditCustomerName || cur.name || '').trim() || cur.name; }
    cur.phone = cur.phone || String(o.customer?.phone || o.creditCustomerPhone || '');
    map.set(key, cur);
  }
  const out = [...map.values()];
  for (const p of out) { p.name = p.name || 'Customer'; p.daysSince = Math.max(0, Math.floor((now - p.lastAt) / DAY_MS)); p.spent = Math.round(p.spent * 100) / 100; }
  return out;
}

export interface CrmFigures {
  active: number;
  /** whole percent against the 90 days before; null when there is nothing to compare to */
  activeDelta: number | null;
  /** of the customers who ordered, the share who ordered twice or more, whole percent */
  repeatPct: number;
  /** percentage points against the 90 days before; null when there is nothing to compare to */
  repeatDeltaPts: number | null;
  atRisk: number;
  birthdays: number;
}

const repeatShare = (people: CrmPerson[]) => (people.length ? Math.round((people.filter(p => p.orders >= 2).length / people.length) * 100) : 0);

/** The four cards. */
export function crmFigures(orders: Order[], customers: object[], now: number): CrmFigures {
  const cur = peopleIn(orders, now - WINDOW_DAYS * DAY_MS, now + 1, now);
  const prev = peopleIn(orders, now - 2 * WINDOW_DAYS * DAY_MS, now - WINDOW_DAYS * DAY_MS, now);
  return {
    active: cur.length,
    activeDelta: prev.length ? Math.round(((cur.length - prev.length) / prev.length) * 100) : null,
    repeatPct: repeatShare(cur),
    repeatDeltaPts: prev.length ? repeatShare(cur) - repeatShare(prev) : null,
    atRisk: atRiskList(cur).length,
    birthdays: birthdayCustomers(customers, new Date(now)).length,
  };
}

/** Ordered in the last 90 days, but not in the last 30: the ones worth a message. Biggest spenders first, then the longest quiet. */
export function atRiskList(people: CrmPerson[]): CrmPerson[] {
  return people.filter(p => p.daysSince >= AT_RISK_DAYS).sort((a, b) => b.spent - a.spent || b.daysSince - a.daysSince || a.name.localeCompare(b.name));
}

export interface Bar { label: string; count: number }
const BUCKETS: { label: string; has: (n: number) => boolean }[] = [
  { label: '1', has: n => n === 1 }, { label: '2', has: n => n === 2 }, { label: '3', has: n => n === 3 }, { label: '4', has: n => n === 4 },
  { label: '5', has: n => n === 5 }, { label: '6–9', has: n => n >= 6 && n <= 9 }, { label: '10+', has: n => n >= 10 },
];

/** How many customers ordered once, twice … ten times or more. */
export function ordersPerCustomer(people: Pick<CrmPerson, 'orders'>[]): Bar[] {
  return BUCKETS.map(b => ({ label: b.label, count: people.filter(p => b.has(p.orders)).length }));
}

/** Customers whose birthday is in this month (a date of birth is kept as YYYY-MM-DD). Earliest day first. */
export function birthdayCustomers<T extends object>(customers: T[], now: Date): T[] {
  const m = now.getMonth() + 1;
  const dob = (c: T) => String((c as { dateOfBirth?: string }).dateOfBirth || '');
  const dayOf = (c: T) => +dob(c).slice(8, 10) || 0;
  return customers
    .filter(c => { const mm = dob(c).match(/^\d{4}-(\d{2})-\d{2}/); return !!mm && +mm[1] === m; })
    .sort((a, b) => dayOf(a) - dayOf(b));
}

/** New customers by month, the last six months that have any. */
export function signupsByMonth(customers: { createdAt?: string }[]): { month: string; count: number }[] {
  const map: Record<string, number> = {};
  for (const c of customers) { const m = String(c.createdAt || '').slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) map[m] = (map[m] || 0) + 1; }
  return Object.entries(map).sort().slice(-6).map(([month, count]) => ({ month, count }));
}

/** "▲ 8%" · "▼ 5%" · "Same as before" — nothing when there is nothing to compare to. */
export function deltaWord(pct: number | null, unit: '%' | ' pts'): string {
  if (pct == null) return '';
  if (pct === 0) return 'Same as before';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}${unit}`;
}

/** The first word of a name for "Hi Sara,". */
export const firstName = (name: string): string => String(name || '').trim().split(/\s+/)[0] || 'there';

export type OfferAudience = 'atRisk' | 'birthdays' | 'active';

/** The message to start from, for each audience; {name} becomes each person's first name when it is sent. */
export function offerTemplate(audience: OfferAudience, restaurant: string, promoCode?: string): string {
  const who = restaurant || 'us';
  const base = audience === 'birthdays' ? `Happy birthday {name}! Wishing you a wonderful year from all of us at ${who}.`
    : audience === 'atRisk' ? `Hi {name}, we miss you at ${who}! Come back this week — we have something for you.`
      : `Hi {name}, thank you for being our customer at ${who}!`;
  return promoCode ? `${base} Use code ${promoCode}.` : base;
}

/** One message for one person. */
export const personalise = (template: string, name: string): string => template.replace(/\{name\}/g, firstName(name));
