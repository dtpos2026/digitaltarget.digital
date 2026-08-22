// Standalone localStorage-backed modules (Blink-inspired feature pack)
// Kept separate from main store.ts to avoid touching Firestore migration logic.
import { mirrorList } from './cloudDocs';

const read = <T>(key: string, fallback: T): T => {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : fallback; }
  catch { return fallback; }
};
const write = (key: string, val: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  // Local-first, then mirrored to the cloud so this data is not device-bound.
  try { if (Array.isArray(val)) mirrorList(key, val); } catch {}
};
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ============= DISCOUNTS / PROMOTIONS =============
export interface Discount {
  id: string;
  name: string;
  percentOff: number;
  appliesTo: 'all' | 'category' | 'item';
  targetIds: string[];        // category IDs or menu item IDs
  startDate: string;          // YYYY-MM-DD
  endDate: string;
  startTime: string;          // HH:MM
  endTime: string;
  isActive: boolean;
  createdAt: string;
}
const K_DISC = 'dt-promotions';
export const getDiscounts = (): Discount[] => read(K_DISC, []);
export const saveDiscount = (d: Discount) => {
  const all = getDiscounts(); const i = all.findIndex(x => x.id === d.id);
  if (i >= 0) all[i] = d; else all.push(d); write(K_DISC, all);
};
export const deleteDiscount = (id: string) => write(K_DISC, getDiscounts().filter(x => x.id !== id));

// ============= ITEM VARIATIONS =============
export interface Variation {
  id: string;
  menuItemId: string;          // parent menu item
  name: string;                // "Large", "Spicy", "1x Add-on: 7up"
  priceDelta: number;          // added on top of base price (can be negative)
  isActive: boolean;
}
const K_VAR = 'dt-variations';
export const getVariations = (): Variation[] => read(K_VAR, []);
export const saveVariation = (v: Variation) => {
  const all = getVariations(); const i = all.findIndex(x => x.id === v.id);
  if (i >= 0) all[i] = v; else all.push(v); write(K_VAR, all);
};
export const deleteVariation = (id: string) => write(K_VAR, getVariations().filter(x => x.id !== id));

// ============= DEALS / COMBOS =============
// Deals are now per-tenant + Firestore-synced. Re-exported from store.ts so
// existing imports (`@/lib/blink-modules`) continue to work.
export type { Deal, DealItem } from './types';
export { getDeals, saveDeal, deleteDeal } from './store';

// ============= CUSTOMER WALLET =============
export interface WalletEntry {
  id: string;
  customerId: string;          // = normalized phone (matches CustomerProfile.id)
  type: 'topup' | 'deduct' | 'refund';
  amount: number;
  note?: string;
  date: string;
}
const K_WAL = 'dt-wallet-entries';
export const getWalletEntries = (): WalletEntry[] => read(K_WAL, []);
export const addWalletEntry = (e: Omit<WalletEntry, 'id' | 'date'>): WalletEntry => {
  const full: WalletEntry = { id: genId(), date: new Date().toISOString(), ...e };
  const all = getWalletEntries(); all.push(full); write(K_WAL, all);
  return full;
};
export const getWalletBalance = (customerId: string): number => {
  return getWalletEntries()
    .filter(e => e.customerId === customerId)
    .reduce((sum, e) => sum + (e.type === 'topup' ? e.amount : -e.amount), 0);
};

// ============= CAMPAIGNS =============
export type CampaignChannel = 'push' | 'sms' | 'email';
export type CampaignStatus = 'draft' | 'scheduled' | 'sent';
export interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  subject: string;
  message: string;
  audience: 'all' | 'vip' | 'recent' | 'inactive';
  scheduledAt?: string;
  status: CampaignStatus;
  createdAt: string;
}
const K_CAMP = 'dt-campaigns';
export const getCampaigns = (): Campaign[] => read(K_CAMP, []);
export const saveCampaign = (c: Campaign) => {
  const all = getCampaigns(); const i = all.findIndex(x => x.id === c.id);
  if (i >= 0) all[i] = c; else all.push(c); write(K_CAMP, all);
};
export const deleteCampaign = (id: string) => write(K_CAMP, getCampaigns().filter(x => x.id !== id));

// ============= DELIVERY ZONES =============
export interface DeliveryZone {
  id: string;
  name: string;                // e.g. "Block A, Burewala"
  areas: string[];             // comma-separated area tags
  minOrderValue: number;
  deliveryCharge: number;
  deliveryTimeMinutes: number;
  isActive: boolean;
}
const K_ZONE = 'dt-zones';
export const getZones = (): DeliveryZone[] => read(K_ZONE, []);
export const saveZone = (z: DeliveryZone) => {
  const all = getZones(); const i = all.findIndex(x => x.id === z.id);
  if (i >= 0) all[i] = z; else all.push(z); write(K_ZONE, all);
};
export const deleteZone = (id: string) => write(K_ZONE, getZones().filter(x => x.id !== id));

export { genId };
