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
