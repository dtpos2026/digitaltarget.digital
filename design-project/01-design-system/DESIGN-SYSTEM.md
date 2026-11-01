# DT design system

One system for five products. Open `design-system.html` for the visual version (colour, measured contrast, type, spacing, shape, icons, statuses, components in light and dark, per-product accents).

| File | What |
|---|---|
| `tokens.css` | CSS custom properties — drop-in for web; same names used by every mock-up |
| `tokens.json` | The same tokens as data (for Android resources / Figma variables) |
| `design-system.html` | The visual reference |

## How it maps to the code that exists
- The web/Windows app already themes through CSS variables (`hsl(var(--primary))` … in `tailwind.config.ts`, 32 themes in `src/lib/themes.ts`). These tokens are **not** a second theme engine: `--accent` ↔ `--primary`, `--surface` ↔ `--card`, `--bg` ↔ `--background`, `--text` ↔ `--foreground`. The redesign ships as one more theme plus component changes, so existing themes keep working.
- The brand mark and colours come from `src/lib/brand.ts` (single source). The Android apps take the same values in `res/values`.
- Per-product accent: software and owner = DT purple `#5b21b6`, customer = `#b91c1c`, rider = `#c2410c`, order taker = `#0f766e` (these are the mid colours of the icons already built in v1.73.0).

## Contrast
Computed in `design-system.html` §02 from the hex values. Summary of what it found is printed there, including the pairs that do **not** reach 4.5 : 1 and the rule that follows from them (faint grey never carries required text).
