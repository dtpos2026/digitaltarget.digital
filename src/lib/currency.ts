// ============================================================
// v1.4.0 — CURRENCY & COUNTRY (international support)
//
// Cloud version had NO currency layer at all — "Rs." was hardcoded in
// hundreds of places, so the software could only be sold in Pakistan.
// This module makes currency a per-restaurant setting, exactly like the
// offline build has.
//
// DESIGN NOTES
// • Default stays PKR so every existing restaurant is untouched by the
//   upgrade (multi-tenant rule: nothing changes unless the owner changes it).
// • Symbol POSITION and DECIMALS matter: "Rs.1,200" (prefix, 0 decimals)
//   vs "1.200,50 kr" (suffix, 2 decimals, comma decimal separator). Getting
//   this wrong prints wrong prices, so each currency carries its own rules.
// • formatMoney() is the ONLY place money is rendered. Never concatenate a
//   symbol by hand again.
// ============================================================

export interface CurrencyDef {
  /** ISO 4217 code — stored in settings, never shown unless useful. */
  code: string;
  /** Symbol shown on screen and on printed slips. */
  symbol: string;
  /** English name for the picker. */
  name: string;
  /** Country the picker groups this under. */
  country: string;
  /** Flag emoji for the picker. */
  flag: string;
  /** Where the symbol sits relative to the number. */
  position: 'prefix' | 'suffix';
  /** Decimal places used for this currency in retail. */
  decimals: number;
  /** BCP-47 locale used for digit grouping/separators. */
  locale: string;
  /** Space between symbol and number. */
  space?: boolean;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'PKR', symbol: 'Rs.', name: 'Pakistani Rupee', country: 'Pakistan', flag: '🇵🇰', position: 'prefix', decimals: 0, locale: 'en-PK' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', country: 'Singapore', flag: '🇸🇬', position: 'prefix', decimals: 2, locale: 'en-SG' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham', country: 'United Arab Emirates', flag: '🇦🇪', position: 'prefix', decimals: 2, locale: 'en-AE', space: true },
  { code: 'SAR', symbol: 'SAR', name: 'Saudi Riyal', country: 'Saudi Arabia', flag: '🇸🇦', position: 'prefix', decimals: 2, locale: 'en-SA', space: true },
  { code: 'USD', symbol: '$', name: 'US Dollar', country: 'United States', flag: '🇺🇸', position: 'prefix', decimals: 2, locale: 'en-US' },
  { code: 'GBP', symbol: '£', name: 'British Pound', country: 'United Kingdom', flag: '🇬🇧', position: 'prefix', decimals: 2, locale: 'en-GB' },
  { code: 'EUR', symbol: '€', name: 'Euro', country: 'European Union', flag: '🇪🇺', position: 'prefix', decimals: 2, locale: 'en-IE' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', country: 'India', flag: '🇮🇳', position: 'prefix', decimals: 2, locale: 'en-IN' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka', country: 'Bangladesh', flag: '🇧🇩', position: 'prefix', decimals: 2, locale: 'en-BD' },
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', country: 'Sri Lanka', flag: '🇱🇰', position: 'prefix', decimals: 2, locale: 'en-LK' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', country: 'Malaysia', flag: '🇲🇾', position: 'prefix', decimals: 2, locale: 'en-MY' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah', country: 'Indonesia', flag: '🇮🇩', position: 'prefix', decimals: 0, locale: 'id-ID' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht', country: 'Thailand', flag: '🇹🇭', position: 'prefix', decimals: 2, locale: 'th-TH' },
  { code: 'QAR', symbol: 'QAR', name: 'Qatari Riyal', country: 'Qatar', flag: '🇶🇦', position: 'prefix', decimals: 2, locale: 'en-QA', space: true },
  { code: 'KWD', symbol: 'KD', name: 'Kuwaiti Dinar', country: 'Kuwait', flag: '🇰🇼', position: 'prefix', decimals: 3, locale: 'en-KW', space: true },
  { code: 'BHD', symbol: 'BD', name: 'Bahraini Dinar', country: 'Bahrain', flag: '🇧🇭', position: 'prefix', decimals: 3, locale: 'en-BH', space: true },
  { code: 'OMR', symbol: 'OMR', name: 'Omani Rial', country: 'Oman', flag: '🇴🇲', position: 'prefix', decimals: 3, locale: 'en-OM', space: true },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira', country: 'Türkiye', flag: '🇹🇷', position: 'prefix', decimals: 2, locale: 'tr-TR' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', country: 'Canada', flag: '🇨🇦', position: 'prefix', decimals: 2, locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', country: 'Australia', flag: '🇦🇺', position: 'prefix', decimals: 2, locale: 'en-AU' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar', country: 'New Zealand', flag: '🇳🇿', position: 'prefix', decimals: 2, locale: 'en-NZ' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', country: 'South Africa', flag: '🇿🇦', position: 'prefix', decimals: 2, locale: 'en-ZA' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', country: 'Nigeria', flag: '🇳🇬', position: 'prefix', decimals: 2, locale: 'en-NG' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', country: 'Kenya', flag: '🇰🇪', position: 'prefix', decimals: 2, locale: 'en-KE' },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound', country: 'Egypt', flag: '🇪🇬', position: 'prefix', decimals: 2, locale: 'en-EG' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', country: 'Philippines', flag: '🇵🇭', position: 'prefix', decimals: 2, locale: 'en-PH' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', country: 'China', flag: '🇨🇳', position: 'prefix', decimals: 2, locale: 'zh-CN' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', country: 'Japan', flag: '🇯🇵', position: 'prefix', decimals: 0, locale: 'ja-JP' },
];

/** Existing installs stay on PKR — upgrades must never change prices. */
export const DEFAULT_CURRENCY = 'PKR';

export function getCurrencyDef(code?: string | null): CurrencyDef {
  const found = CURRENCIES.find(c => c.code === (code || '').toUpperCase());
  return found || CURRENCIES[0];
}

// ---------- Active currency (read without importing the store everywhere) ----------

let activeCode: string = DEFAULT_CURRENCY;

/** Called by the store whenever settings load/change. */
export function setActiveCurrency(code?: string | null) {
  activeCode = getCurrencyDef(code).code;
  try { localStorage.setItem('dt-pos-currency', activeCode); } catch {}
}

export function getActiveCurrency(): CurrencyDef {
  try {
    const stored = localStorage.getItem('dt-pos-currency');
    if (stored) return getCurrencyDef(stored);
  } catch {}
  return getCurrencyDef(activeCode);
}

// ---------- Formatting ----------

export interface MoneyOptions {
  /** Override the currency (e.g. rendering a historical bill). */
  code?: string;
  /** Force decimal places (defaults to the currency's own rule). */
  decimals?: number;
  /** Render the number only, without the symbol. */
  noSymbol?: boolean;
}

/**
 * THE single money formatter. Handles symbol position, spacing, decimals
 * and locale digit grouping.
 *
 *   formatMoney(1200)            -> "Rs.1,200"    (PKR)
 *   formatMoney(1200)            -> "S$1,200.00"  (SGD)
 *   formatMoney(1200, {noSymbol:true}) -> "1,200.00"
 */
export function formatMoney(amount: number | string | null | undefined, opts: MoneyOptions = {}): string {
  const def = opts.code ? getCurrencyDef(opts.code) : getActiveCurrency();
  // Accept strings too: many call sites pass `x.toFixed(2)` or a value that
  // arrived from an input field. Strip grouping/symbols before parsing so a
  // pre-formatted value can never render as NaN on a customer's bill.
  let value: number;
  if (typeof amount === 'string') {
    const cleaned = amount.replace(/[^0-9.\-]/g, '');
    value = parseFloat(cleaned);
  } else {
    value = Number(amount);
  }
  const safe = Number.isFinite(value) ? value : 0;
  const decimals = opts.decimals ?? def.decimals;

  let num: string;
  try {
    num = safe.toLocaleString(def.locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    num = safe.toFixed(decimals);
  }

  if (opts.noSymbol) return num;
  const gap = def.space ? ' ' : '';
  return def.position === 'prefix' ? `${def.symbol}${gap}${num}` : `${num}${gap}${def.symbol}`;
}

/** Short alias used across the UI. */
export const money = formatMoney;

/** Just the symbol — for input adornments and column headers. */
export function currencySymbol(code?: string): string {
  return (code ? getCurrencyDef(code) : getActiveCurrency()).symbol;
}

/** Currencies grouped by country for the settings picker. */
export function currencyOptions(): CurrencyDef[] {
  return CURRENCIES.slice().sort((a, b) => a.country.localeCompare(b.country));
}
