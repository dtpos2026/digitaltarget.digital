// ============================================================
// PRODUCT TILE LOOK — initials and a stable colour for a menu item that has no
// photo. Used by the POS tiles under the DT Retail look, where a tile without
// a picture is a coloured gradient square carrying the item's initials.
//
// Pure and presentational: nothing here reads or writes the menu.
// ============================================================

/** Orange, yellow, red, purple, blue, green — the guide's category colours. */
const HUES = [25, 45, 356, 275, 200, 145];

/** "Zinger Burger" → "ZB", "Fries" → "FR", "چکن بریانی" → "چب". */
export function tileInitials(name: string | undefined | null): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '•';
  const letters = words
    .map(w => Array.from(w).find(ch => /[\p{L}\p{N}]/u.test(ch)) || '')
    .filter(Boolean);
  if (letters.length >= 2) return (letters[0] + letters[1]).toLocaleUpperCase();
  const chars = Array.from(words[0]).filter(ch => /[\p{L}\p{N}]/u.test(ch));
  return (chars.slice(0, 2).join('') || '•').toLocaleUpperCase();
}

/** The same category always gets the same colour, on every screen and every run. */
export function tileHue(categoryId: string | undefined | null): number {
  const key = String(categoryId || '');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

// v1.130.0 — the Design Package's POS tile (SW-03): a photo-less tile is a gradient in one of FIVE colours — amber, red, green, violet, cyan —
// by what the item is, not by one accent for every tile. A category named like the design's (Pizza, Burgers, Wraps, Drinks, Desserts, Deals …)
// takes the design's colour; any other category gets a stable one, so the same category is the same colour on every screen and every run.
export type TileTone = 1 | 2 | 3 | 4 | 5;   // 1 amber · 2 red · 3 green · 4 violet · 5 cyan

const TONE_WORDS: Array<[TileTone, RegExp]> = [
  [5, /drink|beverage|juice|coffee|tea\b|shake|mocktail|margarita|soda|water|lassi|cold/i],
  [4, /dessert|cake|sweet|ice ?cream|brownie|pastry|bakery|cookie|mithai|kheer/i],
  [3, /wrap|roll|salad|veg|health|paratha|bread|pasta|sandwich|sub\b/i],
  [2, /burger|karahi|bbq|grill|steak|deal|combo|platter|biryani|chicken|beef|mutton|tikka|kabab|kebab/i],
  [1, /pizza|fries|side|snack|starter|appetizer|nugget|wings|soup/i],
];

export function tileTone(categoryName: string | undefined | null, categoryId?: string | null): TileTone {
  const name = String(categoryName || '');
  for (const [tone, re] of TONE_WORDS) if (re.test(name)) return tone;
  const key = String(categoryId || name);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ((h % 5) + 1) as TileTone;
}
