// ============================================================
// v1.14.0 — BARCODE & QR (retail / minimart)
//
// Three separate jobs, deliberately kept apart:
//
//   1. GENERATE  — make a barcode image for an item, for shelf labels
//   2. VALIDATE  — check a scanned/typed code is well-formed
//   3. ASSIGN    — attach a code to an item so scanning finds it
//
// Format notes that matter in a real shop:
//   • EAN-13  — the 13-digit retail standard, last digit is a checksum.
//               Packaged goods already carry one; do not invent them.
//   • CODE128 — variable length, encodes letters and digits. Correct choice
//               for shop-generated codes (loose vegetables, own packing).
//   Using CODE128 for internal codes avoids colliding with a real product's
//   EAN, which would make one item scan as another.
//
// Pure module: no DOM, no React — the maths is testable on its own.
// ============================================================

export type BarcodeFormat = 'CODE128' | 'EAN13' | 'EAN8' | 'CODE39' | 'UPC';

export interface BarcodeConfig {
  format: BarcodeFormat;
  /** Print the human-readable digits under the bars. */
  displayValue: boolean;
  width: number;    // bar thickness
  height: number;   // bar height in px
  fontSize: number;
}

export const BARCODE_DEFAULT: BarcodeConfig = {
  format: 'CODE128',
  displayValue: true,
  width: 2,
  height: 60,
  fontSize: 14,
};

/**
 * EAN-13 checksum (the 13th digit).
 * Weights alternate 1 and 3 from the left across the first 12 digits.
 */
export function ean13CheckDigit(first12: string): number | null {
  const digits = (first12 || '').replace(/\D/g, '');
  if (digits.length !== 12) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  const digits = (code || '').replace(/\D/g, '');
  if (digits.length !== 13) return false;
  const expected = ean13CheckDigit(digits.slice(0, 12));
  return expected !== null && expected === Number(digits[12]);
}

export function isValidEan8(code: string): boolean {
  const d = (code || '').replace(/\D/g, '');
  if (d.length !== 8) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(d[i]) * (i % 2 === 0 ? 3 : 1);
  return ((10 - (sum % 10)) % 10) === Number(d[7]);
}

export interface CodeValidation {
  ok: boolean;
  format?: BarcodeFormat;
  normalized: string;
  error?: string;
}

/**
 * Work out what a code is and whether it is usable.
 * Length and checksum decide the format, so a cashier can scan any product
 * without first telling the system which symbology it is.
 */
export function validateCode(raw: string): CodeValidation {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { ok: false, normalized: '', error: 'Code khali hai' };

  const digitsOnly = /^\d+$/.test(trimmed);

  if (digitsOnly && trimmed.length === 13) {
    return isValidEan13(trimmed)
      ? { ok: true, format: 'EAN13', normalized: trimmed }
      : { ok: false, format: 'EAN13', normalized: trimmed, error: 'Invalid EAN-13 checksum' };
  }
  if (digitsOnly && trimmed.length === 8) {
    return isValidEan8(trimmed)
      ? { ok: true, format: 'EAN8', normalized: trimmed }
      : { ok: false, format: 'EAN8', normalized: trimmed, error: 'Invalid EAN-8 checksum' };
  }
  if (digitsOnly && trimmed.length === 12) {
    return { ok: true, format: 'UPC', normalized: trimmed };
  }
  if (trimmed.length > 48) {
    return { ok: false, normalized: trimmed, error: 'Code is too long (over 48)' };
  }
  // Anything else is a shop-generated CODE128 value.
  return { ok: true, format: 'CODE128', normalized: trimmed };
}

/**
 * Generate an internal code for an item that has no manufacturer barcode
 * (loose vegetables, in-house packing).
 *
 * Prefixed so shop codes are visually distinct from real EANs and can
 * never be confused with a packaged product's code.
 */
/**
 * Monotonic counter guaranteeing uniqueness WITHIN a millisecond.
 *
 * Date.now() does not advance between rapid calls, so a timestamp plus a
 * small random suffix collides far more often than it looks: with 3
 * base-36 characters there are only 46,656 possibilities, giving roughly
 * a 10% chance of a duplicate among 200 codes generated in the same
 * millisecond (birthday problem). For a minimart that means two loose
 * items — say two bags of vegetables weighed seconds apart — can end up
 * sharing a barcode, and scanning then pulls up the wrong product.
 */
let internalCodeSeq = 0;

export function generateInternalCode(prefix = 'DT'): string {
  const stamp = Date.now().toString(36).toUpperCase();
  // Sequence makes same-millisecond collisions impossible by construction.
  const seq = (internalCodeSeq = (internalCodeSeq + 1) % 1296).toString(36).toUpperCase().padStart(2, '0');
  // Cryptographic randomness (not Math.random) guards against collisions
  // across devices and across app restarts, where the counter resets.
  let rand: string;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      rand = buf[0].toString(36).toUpperCase().slice(0, 4).padStart(4, '0');
    } else {
      rand = Math.floor(Math.random() * 1679616).toString(36).toUpperCase().padStart(4, '0');
    }
  } catch {
    rand = Math.floor(Math.random() * 1679616).toString(36).toUpperCase().padStart(4, '0');
  }
  return `${prefix}${stamp}${seq}${rand}`;
}

/**
 * Weight-embedded barcode, as used by supermarket scales.
 *
 * Layout: PP IIIII WWWWW C
 *   PP    = prefix that marks it as a weighted item (commonly 20-29)
 *   IIIII = item code
 *   WWWWW = weight in grams
 *   C     = EAN-13 check digit
 *
 * This lets a scale print a label the POS can read price-by-weight from,
 * which is the normal way minimarts sell loose produce.
 */
export function buildWeightBarcode(itemCode: string, grams: number, prefix = '20'): string {
  const item = (itemCode || '').replace(/\D/g, '').padStart(5, '0').slice(-5);
  const w = Math.max(0, Math.round(grams)).toString().padStart(5, '0').slice(-5);
  const first12 = `${prefix}${item}${w}`.slice(0, 12).padEnd(12, '0');
  const check = ean13CheckDigit(first12);
  return `${first12}${check ?? 0}`;
}

export interface WeightBarcodeParts {
  isWeightBarcode: boolean;
  itemCode?: string;
  grams?: number;
}

/** Read back a weight-embedded barcode produced by a scale. */
export function parseWeightBarcode(code: string, prefixes = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29']): WeightBarcodeParts {
  const d = (code || '').replace(/\D/g, '');
  if (d.length !== 13) return { isWeightBarcode: false };
  const prefix = d.slice(0, 2);
  if (!prefixes.includes(prefix)) return { isWeightBarcode: false };
  return {
    isWeightBarcode: true,
    itemCode: d.slice(2, 7),
    grams: Number(d.slice(7, 12)),
  };
}

// ---------- label layout ----------

export interface LabelItem {
  name: string;
  code: string;
  price?: number;
  /** How many copies of this label to print. */
  copies: number;
}

export interface LabelSheetConfig {
  /** Labels across the sheet. */
  columns: number;
  labelWidthMm: number;
  labelHeightMm: number;
  showPrice: boolean;
  showName: boolean;
}

export const LABEL_SHEET_DEFAULT: LabelSheetConfig = {
  columns: 3,
  labelWidthMm: 60,
  labelHeightMm: 30,
  showPrice: true,
  showName: true,
};

/** Expand each item into its requested number of copies, in print order. */
export function expandLabels(items: LabelItem[]): LabelItem[] {
  const out: LabelItem[] = [];
  for (const it of items || []) {
    const n = Math.max(0, Math.floor(it.copies || 0));
    for (let i = 0; i < n; i++) out.push(it);
  }
  return out;
}

/** Sheets needed for a print run — shown before printing so nobody wastes a roll. */
export function labelPageCount(totalLabels: number, cfg: LabelSheetConfig, rowsPerPage = 8): number {
  const perPage = Math.max(1, cfg.columns * rowsPerPage);
  return Math.ceil(Math.max(0, totalLabels) / perPage);
}
