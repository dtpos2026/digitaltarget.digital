// v1.115.0 — what the customer is told when the server says no to a promo code, or to the order that carried one.
// The server (public_check_promo / public_place_order) answers a short reason; the words live here so the website, its Urdu, and the
// tests all use the same ones.
export type PromoReason = 'empty' | 'not_found' | 'inactive' | 'not_started' | 'expired' | 'limit_reached' | 'account_required' | 'min_order';

const WORDS: Record<PromoReason, string> = {
  empty: 'Enter a promo code',
  not_found: 'Invalid promo code',
  inactive: 'Promo code inactive',
  not_started: 'Promo not started yet',
  expired: 'Promo expired',
  limit_reached: 'Promo usage limit reached',
  account_required: 'Sign in to your account to use this code',
  min_order: 'Minimum order for this code',
};

export function promoMessage(reason: string | undefined, extra?: { minOrder?: number | null }, money?: (n: number) => string): string {
  const key = (reason && reason in WORDS ? reason : 'not_found') as PromoReason;
  if (key === 'min_order' && extra?.minOrder) return `Minimum order ${money ? money(extra.minOrder) : `Rs ${extra.minOrder}`} for this code`;
  return WORDS[key];
}

/** The server's refusal of an ORDER ("promo code not valid: expired", "minimum order is Rs 800") in the customer's words; null for anything else. */
export function orderRefusalMessage(serverMessage: string, money?: (n: number) => string): { text: string; clearPromo: boolean } | null {
  const promo = /promo code not valid:\s*([a-z_]+)/i.exec(serverMessage);
  if (promo) return { text: `${promoMessage(promo[1].toLowerCase())}. Remove it or change it, then place the order again.`, clearPromo: true };
  const min = /minimum order is Rs\s*([\d.]+)/i.exec(serverMessage);
  if (min) {
    const n = Number(min[1]);
    return { text: `Minimum order ${money ? money(n) : `Rs ${n}`}. Add a little more to your cart.`, clearPromo: false };
  }
  return null;
}
