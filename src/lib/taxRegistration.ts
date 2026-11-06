// ============================================================
// TAX REGISTRATION (v1.109.0) — what a tax invoice must carry, per country.
//
// A restaurant in Lahore prints "NTN / STRN", one in Dubai prints "TRN", one in Riyadh a 15-digit "VAT No", one in
// Mumbai a "GSTIN". This table gives Settings the right label, a format hint and a FORMAT CHECK (not a lookup at the
// tax authority — that needs the authority's own service and is not claimed here), and gives the receipt the title the
// law expects ("Tax Invoice" / "Simplified Tax Invoice").
//
// Pure: no network, no store. Unknown countries get a neutral "Tax registration no." with no format check.
// ============================================================

export interface TaxRegistrationRule {
  country: string;            // ISO 3166-1 alpha-2
  taxName: string;            // what the tax is called: "GST", "VAT", "Sales Tax"
  idLabel: string;            // the number's name on the bill: "NTN / STRN", "TRN", "GSTIN"
  invoiceTitle: string;       // the document title
  example: string;            // shown as the input placeholder
  pattern?: RegExp;           // format check; absent = free text
  hint: string;               // one line under the field
  /** Typical standard rate in percent — a starting suggestion, never applied silently. */
  suggestedRate?: number;
}

export const TAX_RULES: TaxRegistrationRule[] = [
  { country: 'PK', taxName: 'Sales Tax', idLabel: 'NTN / STRN', invoiceTitle: 'Sales Tax Invoice', example: '1234567-8',
    pattern: /^(\d{7}(-?\d)?|\d{13}|\d{2}-\d{2}-\d{4}-\d{3}-\d{2})$/, hint: 'NTN is 7 digits (+ check digit); STRN is 13 digits.', suggestedRate: 16 },
  { country: 'AE', taxName: 'VAT', idLabel: 'TRN', invoiceTitle: 'Tax Invoice', example: '100123456700003',
    pattern: /^\d{15}$/, hint: 'The Tax Registration Number is 15 digits.', suggestedRate: 5 },
  { country: 'SA', taxName: 'VAT', idLabel: 'VAT No', invoiceTitle: 'Simplified Tax Invoice', example: '300123456700003',
    pattern: /^3\d{13}3$/, hint: 'The VAT number is 15 digits, starting and ending with 3.', suggestedRate: 15 },
  { country: 'IN', taxName: 'GST', idLabel: 'GSTIN', invoiceTitle: 'Tax Invoice', example: '27ABCDE1234F1Z5',
    pattern: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, hint: 'GSTIN is 15 characters: state code, PAN, entity, Z, check.', suggestedRate: 5 },
  { country: 'SG', taxName: 'GST', idLabel: 'GST Reg No', invoiceTitle: 'Tax Invoice', example: '200012345M',
    pattern: /^(\d{9}[A-Z]|[A-Z]\d-\d{7}-\d|\d{8}[A-Z])$/, hint: 'A UEN (e.g. 200012345M) or an M-format number (M2-1234567-8).', suggestedRate: 9 },
  { country: 'MY', taxName: 'SST', idLabel: 'SST Reg No', invoiceTitle: 'Tax Invoice', example: 'W10-1234-12345678',
    pattern: /^[A-Z]\d{2}-\d{4}-\d{8}$/, hint: 'Format W10-1234-12345678.', suggestedRate: 6 },
  { country: 'GB', taxName: 'VAT', idLabel: 'VAT Reg No', invoiceTitle: 'VAT Invoice', example: 'GB123456789',
    pattern: /^(GB)?\d{9}(\d{3})?$/, hint: '9 digits (12 for branches), usually prefixed GB.', suggestedRate: 20 },
  { country: 'IE', taxName: 'VAT', idLabel: 'VAT No', invoiceTitle: 'VAT Invoice', example: 'IE1234567T',
    pattern: /^(IE)?\d{7}[A-Z]{1,2}$|^(IE)?\d[A-Z+*]\d{5}[A-Z]$/, hint: '7 digits and 1–2 letters, prefixed IE.', suggestedRate: 23 },
  { country: 'DE', taxName: 'MwSt', idLabel: 'USt-IdNr', invoiceTitle: 'Rechnung', example: 'DE123456789',
    pattern: /^(DE)?\d{9}$/, hint: 'DE followed by 9 digits.', suggestedRate: 19 },
  { country: 'FR', taxName: 'TVA', idLabel: 'N° TVA', invoiceTitle: 'Facture', example: 'FR12345678901',
    pattern: /^(FR)?[0-9A-Z]{2}\d{9}$/, hint: 'FR, 2 check characters and the 9-digit SIREN.', suggestedRate: 10 },
  { country: 'BD', taxName: 'VAT', idLabel: 'BIN', invoiceTitle: 'Tax Invoice (Mushak 6.3)', example: '000123456-0101',
    pattern: /^\d{9}-?\d{4}$/, hint: 'The Business Identification Number is 13 digits.', suggestedRate: 15 },
  { country: 'LK', taxName: 'VAT', idLabel: 'VAT No', invoiceTitle: 'Tax Invoice', example: '123456789-7000',
    pattern: /^\d{9}-?\d{4}$/, hint: '9 digits, a dash and 4 digits.', suggestedRate: 18 },
  { country: 'EG', taxName: 'VAT', idLabel: 'Tax Reg No', invoiceTitle: 'Tax Invoice', example: '123-456-789',
    pattern: /^\d{3}-?\d{3}-?\d{3}$/, hint: '9 digits.', suggestedRate: 14 },
  { country: 'ZA', taxName: 'VAT', idLabel: 'VAT No', invoiceTitle: 'Tax Invoice', example: '4123456789',
    pattern: /^4\d{9}$/, hint: '10 digits starting with 4.', suggestedRate: 15 },
  { country: 'AU', taxName: 'GST', idLabel: 'ABN', invoiceTitle: 'Tax Invoice', example: '51 824 753 556',
    pattern: /^\d{2}\s?\d{3}\s?\d{3}\s?\d{3}$/, hint: 'The ABN is 11 digits.', suggestedRate: 10 },
  { country: 'NZ', taxName: 'GST', idLabel: 'GST No', invoiceTitle: 'Tax Invoice', example: '49-091-850',
    pattern: /^\d{2,3}-?\d{3}-?\d{3}$/, hint: '8 or 9 digits.', suggestedRate: 15 },
  { country: 'CA', taxName: 'GST/HST', idLabel: 'GST/HST No', invoiceTitle: 'Invoice', example: '123456789RT0001',
    pattern: /^\d{9}\s?RT\s?\d{4}$/, hint: '9 digits, RT, 4 digits.', suggestedRate: 5 },
  { country: 'US', taxName: 'Sales Tax', idLabel: 'Tax ID (EIN)', invoiceTitle: 'Receipt', example: '12-3456789',
    pattern: /^\d{2}-?\d{7}$/, hint: 'Sales tax is set by state; the EIN is 9 digits.' },
];

const BY_COUNTRY = new Map(TAX_RULES.map(r => [r.country, r]));

const NEUTRAL: TaxRegistrationRule = {
  country: '', taxName: 'Tax', idLabel: 'Tax registration no.', invoiceTitle: 'Tax Invoice', example: '',
  hint: 'Type the number exactly as your tax office issued it.',
};

/** The rule for a country (two-letter code); a neutral rule when we have none. */
export function taxRuleFor(countryIso2?: string | null): TaxRegistrationRule {
  return BY_COUNTRY.get((countryIso2 || '').toUpperCase()) ?? NEUTRAL;
}

export type TaxIdCheck = { ok: true; value: string } | { ok: false; reason: string };

/** Format check only. An empty value is allowed (the field is optional); a non-empty one must fit the country's shape. */
export function checkTaxId(countryIso2: string | null | undefined, raw: string): TaxIdCheck {
  const value = (raw || '').trim().toUpperCase().replace(/\s{2,}/g, ' ');
  if (!value) return { ok: true, value: '' };
  const rule = taxRuleFor(countryIso2);
  if (!rule.pattern) return value.length <= 40 ? { ok: true, value } : { ok: false, reason: 'Too long (40 characters at most).' };
  return rule.pattern.test(value) ? { ok: true, value } : { ok: false, reason: `${rule.idLabel} looks wrong. ${rule.hint}` };
}

/** Which two-letter country a currency belongs to — Settings has the currency, the receipt needs the country. */
export const COUNTRY_BY_CURRENCY: Record<string, string> = {
  PKR: 'PK', AED: 'AE', SAR: 'SA', INR: 'IN', SGD: 'SG', MYR: 'MY', GBP: 'GB', BDT: 'BD', LKR: 'LK', EGP: 'EG',
  ZAR: 'ZA', AUD: 'AU', NZD: 'NZ', CAD: 'CA', USD: 'US',
};

export const countryForCurrency = (code?: string | null): string => COUNTRY_BY_CURRENCY[(code || '').toUpperCase()] ?? '';

/**
 * Several tax rates on one bill (food 5 %, service 15 %, …): split each tax-inclusive amount into base and tax at its
 * own rate. The tax is the amount minus the rounded base, so base + tax always equals the amount exactly.
 */
export function splitInclusive(lines: { amount: number; ratePercent: number }[], decimals = 2): { base: number; tax: number; ratePercent: number }[] {
  const f = 10 ** decimals;
  const r = (n: number) => Math.round(n * f) / f;
  return lines.map(l => {
    const base = r(l.amount / (1 + l.ratePercent / 100));
    return { base, tax: r(l.amount - base), ratePercent: l.ratePercent };
  });
}
