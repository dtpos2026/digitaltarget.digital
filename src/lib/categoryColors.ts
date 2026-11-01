// Category colours for the Espresso Orange POS: a small coloured dot before
// each category name, and the selected category filled in its own colour.
// Picked by position so a shop's categories keep their colour until they are
// re-ordered. Every colour carries white text at 3:1 or better (large/bold text).
export const CATEGORY_DOT_COLORS = [
  '24 95% 45%',  // orange
  '36 92% 38%',  // amber
  '0 72% 51%',   // red
  '271 76% 53%', // purple
  '199 89% 39%', // blue
  '142 71% 33%', // green
] as const;

export function categoryDotColor(index: number): string {
  const n = CATEGORY_DOT_COLORS.length;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  return CATEGORY_DOT_COLORS[((i % n) + n) % n];
}
