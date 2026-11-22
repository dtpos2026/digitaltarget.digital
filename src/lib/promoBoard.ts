// v1.144.0 — Promo codes as the design draws it (SW-34): a table of Code · Discount · Valid · Used (with a bar) · Active (a switch), All · Active · Expired over it.
// Pure: codes in, words and groups out.
import type { PromoCode } from './types';

export type PromoState = 'active' | 'off' | 'scheduled' | 'expired' | 'used_up';
export type PromoFilter = 'all' | 'active' | 'expired';
export const PROMO_FILTERS: { key: PromoFilter; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'expired', label: 'Expired' }];

const day = (iso?: string): number | null => {
  if (!iso) return null;
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
  return Number.isFinite(d.getTime()) ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null;
};
const today = (now: number) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/** Whether the code can be used today, and if not, why. Expired and used-up come before "off": a code that has run its course says so. */
export function promoState(p: Pick<PromoCode, 'isActive' | 'startDate' | 'endDate' | 'usageCount' | 'usageLimit'>, now = Date.now()): PromoState {
  const end = day(p.endDate), start = day(p.startDate), t = today(now);
  if (end !== null && end < t) return 'expired';
  if (p.usageLimit && (p.usageCount || 0) >= p.usageLimit) return 'used_up';
  if (!p.isActive) return 'off';
  if (start !== null && start > t) return 'scheduled';
  return 'active';
}

export const isRunOut = (s: PromoState): boolean => s === 'expired' || s === 'used_up';

export function matchesPromoFilter(p: PromoCode, f: PromoFilter, now = Date.now()): boolean {
  const s = promoState(p, now);
  if (f === 'active') return s === 'active';
  if (f === 'expired') return isRunOut(s);
  return true;
}

export const matchesPromoQuery = (p: PromoCode, q: string): boolean => {
  const s = q.trim().toLowerCase();
  return !s || p.code.toLowerCase().includes(s);
};

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (t: number) => { const d = new Date(t); return `${d.getDate()} ${MONTH[d.getMonth()]}`; };

/** "1 Oct – 31 Dec", "until 31 Dec", "from 1 Oct", "Always" — and "expired" / "used up" once it has run out. */
export function validLabel(p: Pick<PromoCode, 'isActive' | 'startDate' | 'endDate' | 'usageCount' | 'usageLimit'>, now = Date.now()): string {
  const s = promoState(p, now);
  if (s === 'expired') return 'expired';
  if (s === 'used_up') return 'used up';
  const a = day(p.startDate), b = day(p.endDate);
  if (a !== null && b !== null) return `${dm(a)} – ${dm(b)}`;
  if (b !== null) return `until ${dm(b)}`;
  if (a !== null) return `from ${dm(a)}`;
  return 'Always';
}

/** "10 %" or "Rs 200", with the smallest order it applies to when there is one. */
export function discountLabel(p: Pick<PromoCode, 'discountType' | 'discountValue' | 'minOrderAmount'>, fmt: (n: number) => string): string {
  const v = p.discountType === 'percent' ? `${p.discountValue} %` : fmt(p.discountValue);
  return p.minOrderAmount ? `${v} · min ${fmt(p.minOrderAmount)}` : v;
}

/** "34 / 100"; with no limit just the count. */
export const usedLabel = (p: Pick<PromoCode, 'usageCount' | 'usageLimit'>): string => `${p.usageCount || 0}${p.usageLimit ? ` / ${p.usageLimit}` : ''}`;
/** 0–1 of the limit used, null when unlimited. */
export const usedRatio = (p: Pick<PromoCode, 'usageCount' | 'usageLimit'>): number | null => (p.usageLimit ? Math.min(1, (p.usageCount || 0) / p.usageLimit) : null);

export const promoSubtitle = (n: number): string => `${n} ${n === 1 ? 'code' : 'codes'}`;

/** Newest first; the active ones before the ones that have run out. */
export function sortPromos(list: PromoCode[], now = Date.now()): PromoCode[] {
  const t = (p: PromoCode) => new Date(p.createdAt || 0).getTime() || 0;
  return list.slice().sort((a, b) => Number(isRunOut(promoState(a, now))) - Number(isRunOut(promoState(b, now))) || t(b) - t(a) || a.code.localeCompare(b.code));
}
