// WCAG 2.2 contrast (v1.109.0) — one place that answers "can this text be read on this colour?" for the colour schemes, and the
// test that keeps every scheme at AA. Pure; works on #rrggbb or "H S% L%" (the way the design tokens are written).

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** "262 52% 47%" or "hsl(262 52% 47%)" -> rgb */
export function hslTokenToRgb(token: string): Rgb {
  const m = /(-?[\d.]+)\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%/.exec(token);
  if (!m) throw new Error(`not an hsl token: ${token}`);
  const h = ((Number(m[1]) % 360) + 360) % 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const ch = [r, g, b].map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG AA: 4.5:1 for normal text, 3:1 for large text and for the parts of a control. */
export const AA_TEXT = 4.5;
export const AA_LARGE = 3;
