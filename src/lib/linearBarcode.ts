// ============================================================
// LINEAR BARCODES — Code 128 and Code 39 for the receipt barcode.
//
// Encoded here rather than with a library so the POS stays dependency-free
// and fully offline, and so the output is exactly what the printer needs:
// a list of bar/space widths in modules, which the renderer draws at a whole
// number of printer dots per module (see ReceiptCodes.tsx). Whole dots are
// what keeps a thermal barcode scannable — a module of 2.4 dots prints as
// 2 or 3 at random and a scanner reads the wrong widths.
//
// Code 128 (recommended): any printable ASCII, and pairs of digits packed
// into one symbol, so a receipt reference like R2609241042 stays short.
// Code 39: for older scanners; A–Z, 0–9, space and - . $ / + %.
// ============================================================

export type BarcodeFormat = 'code128' | 'code39';

export interface LinearBarcode {
  format: BarcodeFormat;
  /** The text actually encoded (Code 39 upper-cases). */
  text: string;
  /** Alternating bar/space widths in modules, starting and ending with a bar. */
  widths: number[];
  /** Total width in modules, without quiet zones. */
  modules: number;
}

/** Width of the blank margin a scanner needs on each side, in modules. */
export const QUIET_ZONE_MODULES = 10;

// Code 128 symbols 0–106: bar, space, bar, space, bar, space widths.
// 103/104/105 are Start A/B/C, 106 is Stop (seven elements).
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const TO_C = 99;   // "Code C" from set B
const TO_B = 100;  // "Code B" from set C
const STOP = 106;

const isDigit = (c: number) => c >= 48 && c <= 57;

/** True when Code 128 (sets B/C) can carry the text: printable ASCII only. */
export function code128Encodable(text: string): boolean {
  if (!text) return false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

/**
 * Symbol values for `text`, start code to checksum (stop excluded).
 * Runs of four or more digits (or an all-digit text) go in set C, two digits
 * per symbol; everything else in set B. An odd digit run spends its first
 * digit in set B so set C ends exactly where the run does.
 */
export function code128Values(text: string): number[] {
  if (!code128Encodable(text)) throw new Error('Code 128: printable ASCII only');
  const n = text.length;
  const vals: number[] = [];
  let set: 'B' | 'C' | null = null;
  const digitRun = (k: number) => { let j = k; while (j < n && isDigit(text.charCodeAt(j))) j++; return j - k; };
  let i = 0;
  while (i < n) {
    const run = digitRun(i);
    const useC = run >= 4 || (i === 0 && run === n && run >= 2);
    if (useC) {
      if (run % 2 === 1) {
        if (set !== 'B') { vals.push(set === null ? START_B : TO_B); set = 'B'; }
        vals.push(text.charCodeAt(i) - 32);
        i++;
      }
      const pairs = Math.floor(run / 2);
      if (set !== 'C') { vals.push(set === null ? START_C : TO_C); set = 'C'; }
      for (let k = 0; k < pairs; k++) vals.push(Number(text.substr(i + k * 2, 2)));
      i += pairs * 2;
    } else {
      if (set !== 'B') { vals.push(set === null ? START_B : TO_B); set = 'B'; }
      vals.push(text.charCodeAt(i) - 32);
      i++;
    }
  }
  let sum = vals[0];
  for (let k = 1; k < vals.length; k++) sum += vals[k] * k;
  vals.push(sum % 103);
  return vals;
}

export function encodeCode128(text: string): LinearBarcode {
  const vals = [...code128Values(text), STOP];
  const widths: number[] = [];
  for (const v of vals) for (const ch of C128[v]) widths.push(Number(ch));
  return { format: 'code128', text, widths, modules: widths.reduce((a, b) => a + b, 0) };
}

// Code 39: nine elements per character (bar/space alternating), 1 = wide.
const C39: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001',
  '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100',
  A: '100001001', B: '001001001', C: '101001000', D: '000011001', E: '100011000',
  F: '001011000', G: '000001101', H: '100001100', I: '001001100', J: '000011100',
  K: '100000011', L: '001000011', M: '101000010', N: '000010011', O: '100010010',
  P: '001010010', Q: '000000111', R: '100000110', S: '001000110', T: '000010110',
  U: '110000001', V: '011000001', W: '111000000', X: '010010001', Y: '110010000',
  Z: '011010000', '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100',
};
/** Wide element width in modules: 3:1 is the most forgiving ratio on thermal paper. */
const C39_WIDE = 3;

export function code39Encodable(text: string): boolean {
  if (!text) return false;
  for (const ch of text.toUpperCase()) if (ch === '*' || !(ch in C39)) return false;
  return true;
}

export function encodeCode39(raw: string): LinearBarcode {
  const text = raw.toUpperCase();
  if (!code39Encodable(text)) throw new Error('Code 39: A-Z, 0-9, space and - . $ / + % only');
  const widths: number[] = [];
  const chars = `*${text}*`;
  for (let c = 0; c < chars.length; c++) {
    for (const bit of C39[chars[c]]) widths.push(bit === '1' ? C39_WIDE : 1);
    if (c < chars.length - 1) widths.push(1); // narrow gap between characters
  }
  return { format: 'code39', text, widths, modules: widths.reduce((a, b) => a + b, 0) };
}

export function encodeBarcode(format: BarcodeFormat, text: string): LinearBarcode {
  return format === 'code39' ? encodeCode39(text) : encodeCode128(text);
}

/** Keep only what the format can carry (used for the shop's custom text). */
export function sanitizeForFormat(format: BarcodeFormat, text: string, max = 40): string {
  const t = String(text || '');
  const kept = format === 'code39'
    ? Array.from(t.toUpperCase()).filter(ch => ch !== '*' && ch in C39).join('')
    : Array.from(t).filter(ch => { const c = ch.charCodeAt(0); return ch.length === 1 && c >= 32 && c <= 126; }).join('');
  return kept.slice(0, max);
}
