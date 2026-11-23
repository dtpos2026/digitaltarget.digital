// v1.152.0 — "Customer website & app" as the design draws it (SW-35): four channel cards with a switch each, a Branding card (logo, site name, four colours, WhatsApp)
// and a Delivery-rules card (fee, minimum order, service radius, the share link). Pure words and the little rules the screen needs; the page owns the settings.
import type { ApprovalMode, RestaurantSettings } from './types';

/** The four colours the design offers; the colour picker next to them is for any other. */
export const BRAND_SWATCHES = ['#b91c1c', '#d9480f', '#0f766e', '#5b21b6'] as const;

export type ChannelKey = 'website' | 'delivery' | 'pickup' | 'guest';
export interface ChannelCard { key: ChannelKey; label: string; caption: string; on: boolean; /** a channel under a switched-off website cannot be on */ disabled: boolean }

/** "Approval required" / "Auto-accept" — how a new website order is handled. */
export const approvalCaption = (mode: ApprovalMode | undefined): string => (mode === 'manual' ? 'Approval required' : 'Auto-accept');

/** The four cards, from the settings: the website's own switch and what hangs under it. */
export function channelCards(s: Partial<RestaurantSettings>): ChannelCard[] {
  const master = s.onlineOrderEnabled !== false;
  const mode = (s.sourceApprovalMode?.website === 'manual' || s.sourceApprovalMode?.website === 'auto' ? s.sourceApprovalMode.website : s.onlineOrderApprovalMode) as ApprovalMode | undefined;
  return [
    { key: 'website', label: 'Website', caption: master ? approvalCaption(mode) : 'Switched off', on: master, disabled: false },
    { key: 'delivery', label: 'Delivery', caption: 'Home delivery', on: s.onlineDeliveryEnabled !== false, disabled: !master },
    { key: 'pickup', label: 'Pickup', caption: 'Self pickup', on: s.onlinePickupEnabled !== false, disabled: !master },
    { key: 'guest', label: 'Guest checkout', caption: 'No signup needed', on: s.allowGuestCheckout !== false, disabled: !master },
  ];
}

/** The settings key each card's switch writes. */
export const CHANNEL_KEY: Record<ChannelKey, keyof RestaurantSettings> = { website: 'onlineOrderEnabled', delivery: 'onlineDeliveryEnabled', pickup: 'onlinePickupEnabled', guest: 'allowGuestCheckout' };

/** A hex colour as typed, or null when it is not one. */
export function normalHex(v: string): string | null {
  const m = String(v || '').trim().toLowerCase().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return `#${h}`;
}

/** The number WhatsApp customers reach: the one set for customers, else the shop's phone. */
export const whatsappNumber = (s: Partial<RestaurantSettings>): string => String(s.supportWhatsappNumber || s.phone1 || '');

/** "digitaltarget.digital/#/order/…" for display; the whole link when it is short. */
export function shortLink(url: string, max = 38): string {
  const bare = String(url || '').replace(/^https?:\/\//, '');
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}
