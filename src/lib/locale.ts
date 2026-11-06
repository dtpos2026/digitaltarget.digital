// ============================================================
// LOCALE (v1.109.0) — numbers, dates and times in the language of the screen.
//
// One definition for the whole app: which BCP-47 locale a language uses, and helpers that format with it.
//   • DIGITS: bills and kitchen tickets keep Latin digits (0-9) in every language — a printer, a rider and a tax officer
//     read the same numbers. A screen may opt in to the language's own digits (Arabic-Indic, Urdu) with digits:'native'.
//   • Dates: the language's own order and month names; 'short' for tables, 'long' for headings.
//   • Never throws: an unknown locale falls back to English, an invalid date prints an em dash.
// ============================================================
import type { LanguageCode } from '@/lib/i18n';

export type DigitStyle = 'latn' | 'native';

const LANGUAGE_LOCALE: Record<LanguageCode, string> = {
  en: 'en', ur: 'ur-PK', 'ur-roman': 'en-PK', ms: 'ms-MY', zh: 'zh-CN', ar: 'ar',
};

/** Arabic is spoken with different conventions per country; the restaurant's country picks the variant. */
const ARABIC_BY_COUNTRY: Record<string, string> = {
  SA: 'ar-SA', AE: 'ar-AE', QA: 'ar-QA', KW: 'ar-KW', BH: 'ar-BH', OM: 'ar-OM', EG: 'ar-EG', JO: 'ar-JO',
};

/** The locale for a language, refined by the restaurant's two-letter country when that matters (Arabic). */
export function localeFor(language: LanguageCode, countryIso2?: string | null): string {
  if (language === 'ar') return ARABIC_BY_COUNTRY[(countryIso2 || '').toUpperCase()] ?? LANGUAGE_LOCALE.ar;
  return LANGUAGE_LOCALE[language] ?? 'en';
}

/** The language's own digit set, where it has one that differs from 0-9. */
const NATIVE_NUMBERING: Partial<Record<LanguageCode, string>> = { ar: 'arab', ur: 'arabext' };

/** Add the Unicode extension that pins the digits: Latin by default, the language's own on request. */
function withDigits(locale: string, digits: DigitStyle, language: LanguageCode): string {
  const base = locale.split('-u-')[0];
  if (digits === 'native') {
    const nu = NATIVE_NUMBERING[language];
    return nu ? `${base}-u-nu-${nu}` : base;
  }
  return `${base}-u-nu-latn`;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export function formatNumber(
  n: number, o: { language?: LanguageCode; country?: string | null; digits?: DigitStyle; decimals?: number } = {},
): string {
  if (!Number.isFinite(n)) return '—';
  const loc = withDigits(localeFor(o.language ?? 'en', o.country), o.digits ?? 'latn', o.language ?? 'en');
  const opts: Intl.NumberFormatOptions = o.decimals === undefined ? {} : { minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals };
  return safe(() => new Intl.NumberFormat(loc, opts).format(n), String(n));
}

export type DateStyle = 'short' | 'long' | 'time' | 'datetime';

export function formatDate(
  value: Date | string | number | null | undefined,
  o: { language?: LanguageCode; country?: string | null; digits?: DigitStyle; style?: DateStyle; timeZone?: string } = {},
): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const loc = withDigits(localeFor(o.language ?? 'en', o.country), o.digits ?? 'latn', o.language ?? 'en');
  const style = o.style ?? 'short';
  const base: Intl.DateTimeFormatOptions =
    style === 'long' ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }
    : style === 'time' ? { hour: '2-digit', minute: '2-digit' }
    : style === 'datetime' ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  const opts = o.timeZone ? { ...base, timeZone: o.timeZone } : base;
  return safe(() => new Intl.DateTimeFormat(loc, opts).format(d), d.toISOString().slice(0, 10));
}

/** Does this locale read right-to-left? (Used to flip arrows and sliders in code, not in CSS.) */
export function isRtlLocale(locale: string): boolean {
  return /^(ar|ur|fa|he|ps|sd|ug|yi)(-|$)/i.test(locale);
}
