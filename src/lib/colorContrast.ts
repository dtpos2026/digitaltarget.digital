// ============================================================================
// Colour maths for the theme engine — WCAG contrast, HSL <-> RGB, hex -> HSL.
//
// Themes are written as "h s% l%" triplets (the form CSS variables hold them in
// here), so everything below takes and returns that shape. Pure and dependency
// free: the theme builder uses it to keep text readable, and the tests use it to
// prove every theme is.
// ============================================================================

export type HSL = readonly [number, number, number];

/** Parse "263 70% 50%" (or "263 70 50") into [263, 70, 50]. */
export function parseHsl(s: string): HSL {
  const m = s.trim().match(/^(-?[\d.]+)[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/);
  if (!m) throw new Error(`not an HSL triplet: "${s}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** [263, 70, 50] -> "263 70% 50%". */
export function fmtHsl([h, s, l]: HSL): string {
  return `${r1(((h % 360) + 360) % 360)} ${r1(s)}% ${r1(l)}%`;
}

export function hslToRgb([h, s, l]: HSL): [number, number, number] {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function hexToHsl(hex: string): HSL {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) throw new Error(`not a 6-digit hex colour: "${hex}"`);
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

/** WCAG relative luminance of an HSL colour. */
export function luminance(c: HSL): number {
  const [R, G, B] = hslToRgb(c).map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio, 1 (none) to 21 (black on white). Accepts triplet strings or tuples. */
export function contrast(a: string | HSL, b: string | HSL): number {
  const la = luminance(typeof a === 'string' ? parseHsl(a) : a);
  const lb = luminance(typeof b === 'string' ? parseHsl(b) : b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const WHITE: HSL = [0, 0, 100];

/**
 * Move an accent until the text that sits ON it is readable (>= `min`).
 *
 * `light` text (white): the accent is darkened a point at a time. `dark` text:
 * it is lightened instead. The hue and saturation are never touched, so a brand
 * colour stays recognisably itself — it just stops failing contrast.
 */
export function safeAccent(accent: HSL, textOn: 'light' | 'dark', min = 4.5): HSL {
  const [h, s] = accent;
  let l = accent[2];
  const text: HSL = textOn === 'light' ? WHITE : [h, 45, 9];
  for (let i = 0; i < 90 && contrast([h, s, l], text) < min; i++) {
    l += textOn === 'light' ? -1 : 1;
    if (l < 5 || l > 95) break;
  }
  return [h, s, l];
}
