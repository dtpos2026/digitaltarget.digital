// ============================================================================
// The website's Help and About words (v1.115.0) — design WEB-18 (contact & support) and WEB-02 (restaurant information).
// Pure: links the customer taps, and the "common questions" answered from the restaurant's own settings — so the answer to
// "Do you deliver to my area?" is what THIS restaurant set, not a generic sentence.
// ============================================================================
import { formatClock, weekLines, type OpeningHours } from '@/lib/openingHours';

/** Digits for a wa.me link; a local number starting with 0 gets the country code (Pakistan, as everywhere else in the software). */
export function waDigits(raw?: string | null, defaultCountry = '92'): string | null {
  if (!raw) return null;
  let p = raw.replace(/[^\d+]/g, '');
  if (!p) return null;
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0')) p = defaultCountry + p.slice(1);
  else if (p.length <= 10) p = defaultCountry + p;
  return p.length >= 8 && p.length <= 15 ? p : null;
}

export const waLink = (raw: string | null | undefined, text: string): string | null => {
  const d = waDigits(raw);
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null;
};

/** tel: links keep digits and a leading +; anything that is not a phone number gives null. */
export function telLink(raw?: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/[^\d+]/g, '');
  return t.replace(/\D/g, '').length >= 5 ? `tel:${t}` : null;
}

/** A map search for an address, or for the pin when the restaurant stored one. No key, no tracking — it opens the person's own maps app. */
export function mapsLink(o: { address?: string | null; city?: string | null; lat?: number | null; lng?: number | null }): string | null {
  if (typeof o.lat === 'number' && typeof o.lng === 'number' && Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`;
  }
  const q = [o.address, o.city].map(x => (x || '').trim()).filter(Boolean).join(', ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export interface FaqInput {
  restaurant: string;
  deliveryOn: boolean;
  pickupOn: boolean;
  /** delivery fee, free-delivery threshold and minimum order, already formatted as money text, or '' when not set */
  deliveryFee: string;
  freeAbove: string;
  minOrder: string;
  radiusKm?: number;
  hours?: OpeningHours | null;
  hour12?: boolean;
  phone?: string | null;
  hasWhatsApp: boolean;
  guestCheckout: boolean;
}

export interface FaqItem { q: string; a: string }

/** The common questions with this restaurant's own answers. Only answers it can truly give; nothing is promised that the settings do not say. */
export function buildFaq(f: FaqInput): FaqItem[] {
  const out: FaqItem[] = [];
  const reach = f.hasWhatsApp && f.phone ? 'WhatsApp or call us' : f.hasWhatsApp ? 'message us on WhatsApp' : f.phone ? 'call us' : 'contact the restaurant';

  out.push({
    q: 'Where is my order?',
    a: `Open “My orders” (sign in first) or the tracking link we sent you after you ordered — it shows the live status and, for delivery, where the rider is. If something looks wrong, ${reach}.`,
  });

  if (f.deliveryOn || f.pickupOn) {
    const parts: string[] = [];
    if (f.deliveryOn && f.pickupOn) parts.push('We deliver and you can also pick up your order.');
    else if (f.deliveryOn) parts.push('We deliver to your door.');
    else parts.push('Orders are for pickup.');
    if (f.deliveryOn && f.deliveryFee) parts.push(`Delivery costs ${f.deliveryFee}${f.freeAbove ? `, and it is free on orders of ${f.freeAbove} or more` : ''}.`);
    else if (f.deliveryOn && f.freeAbove) parts.push(`Delivery is free on orders of ${f.freeAbove} or more.`);
    if (f.minOrder) parts.push(`The minimum order is ${f.minOrder}.`);
    out.push({ q: 'How much is delivery, and is there a minimum order?', a: parts.join(' ') });
  }

  if (f.deliveryOn) {
    out.push({
      q: 'Do you deliver to my area?',
      a: `${f.radiusKm && f.radiusKm > 0 ? `We deliver within about ${f.radiusKm} km of the restaurant. ` : ''}Enter your address at checkout — if it is outside our area we tell you before you pay anything.`,
    });
  }

  out.push({
    q: 'Can I change my address or my order?',
    a: `Once an order is sent to the kitchen it cannot be changed on the website. As soon as you notice a mistake, ${reach} — the sooner the better.`,
  });
  out.push({
    q: 'How do I cancel?',
    a: `${f.hasWhatsApp || f.phone ? `Please ${reach} before the food is prepared. ` : 'Please contact the restaurant before the food is prepared. '}An order that is already cooking cannot be cancelled.`,
  });
  out.push({
    q: 'How do I pay?',
    a: 'You pay when your order arrives — to the rider for delivery, or at the counter for pickup. Nothing is charged on the website.',
  });
  if (!f.guestCheckout) {
    out.push({ q: 'Do I need an account?', a: 'Yes. Create an account once with your phone number; it keeps your details and addresses and shows your offers and past orders.' });
  } else {
    out.push({ q: 'Do I need an account?', a: 'No — you can order as a guest. An account keeps your details and addresses, and unlocks offers meant for signed-in customers.' });
  }
  if (f.hours && f.hours.enabled) {
    const lines = weekLines(f.hours, f.hour12 !== false).map(l => `${l.label}: ${l.hours}`).join(' · ');
    out.push({ q: 'When are you open?', a: `${lines}.` });
  }
  return out;
}

/** "11:00 PM" for the closing time of a schedule line — used by the About page's one-line summary. */
export const clockText = formatClock;
