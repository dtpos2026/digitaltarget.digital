# DT POS — one brand across the product

**The system itself exists now (v1.73.0):** `src/lib/brand.ts` (the single source), `DtMark` / `DtAppIcon` / `BrandLockup` (components), `branding/` (vector icons, marks, the brand guide), `scripts/brand/build-brand-assets.mjs` (regenerates every icon, splash screen and the guide), and the Android drop-in kit. Open `branding/brand-guide.html`.

Requested 2026-10-31: "everything should have equal branding, professional — APK apps, web order site, software, owner portal, everything."
This page is the rule set and an honest status per surface. What is not done is marked so.

## The rules

1. **One mark.** `src/components/DtMark.tsx` — four triangles in a square, an SVG that takes `currentColor`. It is never replaced by a raster "logo" tile. White on a brand colour, the brand purple on white.
2. **One app icon.** `DtAppIcon`: the mark at 56 % of a squircle (corner radius 26 %) in the theme's primary colour, in the theme's primary-foreground. Used in headers; the OS/PWA/installer icon (`branding/dt-pos-icon.svg`) is the same mark on the fixed brand purple.
3. **One lockup.** Mark + `DIGITAL / TARGET` in two lines, semi-bold, directly on the colour (no tile behind it on a brand panel). Under the product name: *Powered by Digital Target*.
4. **A restaurant's own logo** replaces the app icon only on screens a restaurant's customers or staff see, always with *Powered by Digital Target* beside it.
5. **Theme tokens only.** No hard-coded colour in a branded component (`primary`, `primary-foreground`, `background`, `card`, `border`, `muted-foreground`). A test fails if one appears.
6. **Readable in every theme.** Text on a brand colour uses the theme's own foreground, and that pair is checked ≥ 4.5 : 1 for all 32 themes (the one older theme below it, `teal-restaurant`, is named in the test).
7. **Shapes are borders, not lighter fills,** on a brand panel — so contrast stays exactly that of the pair.

## Status per surface

| Surface | Status |
|---|---|
| Brand source, components, icons, marks, guide, generator | **Done** v1.73.0 (21 tests) |
| Staff sign-in (web + Windows) | **Done** v1.71.0 / v1.72.0 |
| **Welcome splash** (web + Windows): the mark pops in triangle by triangle, name rises, progress bar; once per session; any key/click skips; stops for reduced-motion | **Done** v1.74.0 |
| **Boot screen** before the app loads, in the restaurant's colour (saved by `applyTheme`, restored by a head script before first paint) | **Done** v1.74.0 |
| Owner portal sign-in (incl. device-approval wait screen) | **Done** v1.72.0 |
| Super Admin invoice (A4) | **Done** v1.72.0 |
| **Rider app** icon + splash (orange, motorbike badge) | **Done** — `dtpos.apk`, branch `claude/brand-system`; **not built in Android Studio** |
| **Order Taker app** icon + splash (teal, order-pad badge) | **Done** — same branch; **not built** |
| **Customer app** | kit provided (red, shopping-bag badge) but **not applied**: that app is built per restaurant (`tools/brand.mjs` writes the restaurant's own icon and name), so its icon stays the restaurant's. Its splash is still Capacitor's default — next slice: write the splash from the restaurant's logo in `brand.mjs` |
| Super Admin invoice, POS 80 mm slip | not restyled (works as before) |
| Windows POS shell, sidebar, top bar | theme only; logo placement **not yet reviewed** |
| Owner portal pages, Super Admin pages | theme only; **not yet reviewed** |
| Receipts / KOT / tokens | not reviewed |
| Customer web-order site | **not started** — data model first (see `design-references/2026-10-31-web-order-site-reference.md`) |
| Windows installer / favicon / PWA icon | the purple squircle icon from v1.69.0 (same artwork as `branding/icons/pos.svg`) |

## Next slices
Windows POS shell → owner portal pages → Super Admin shell → web-order site (header, drawer, hero) → the phone apps' in-app screens (UI/UX) → Customer-app splash → receipt/KOT headers.

---

## Brand kit — the one-page sheet (v1.109.0)

**The mark.** Four triangles in a square (`DtMark`). One colour at a time: white on a brand colour, the brand purple on white. Never outlined, never recoloured per screen, never inside a raster tile.

| | Rule |
|---|---|
| Clear space | Half the mark's height on every side (the height of one triangle). Nothing else — text, edge, another logo — enters it. |
| Minimum size | Mark alone 16 px on screen / 6 mm in print. Lockup (mark + DIGITAL / TARGET) 96 px wide / 25 mm. Below that, use the mark alone. |
| Backgrounds | Brand purple, white, or any theme's primary colour whose pair is ≥ 4.5 : 1 (tested for all 9 Refined schemes). Never on a photograph without a solid panel. |
| Don't | stretch · rotate · add a shadow or outline · use two colours · put the mark on a red/green pair · replace the mark by the restaurant's logo on a Digital Target screen. |
| Language | The product is "DT POS Enterprise"; the company is "Digital Target". The footer line is always *Powered by Digital Target*. |
| Amounts | `Rs 1,450` — a space after the symbol, no full stop. The currency symbol follows the restaurant's currency (29 supported). |

**App icons (one squircle, one mark, a colour per app).**

| App / surface | Colour | Source |
|---|---|---|
| Web + Windows POS, installer, PWA | brand purple | `branding/dt-pos-icon.svg`, `public/pwa-icon-*.png` |
| Owner app | brand purple, owner badge | `dtpos.apk` → `Owner/` (built by the CI workflow) |
| Rider app | orange, motorbike badge | `dtpos.apk` → `Rider/` |
| Order Taker app | teal, order-pad badge | `dtpos.apk` → `OrderTaker/` |
| Customer app | the **restaurant's** own icon and name (built per restaurant by `tools/brand.mjs`) | — |

**Store listing checklist (Google Play).** App icon 512 × 512 PNG (no transparency) · feature graphic 1024 × 500 · 2–8 phone screenshots (16:9 or 9:16, min 320 px) · short description ≤ 80 characters · full description ≤ 4000 · privacy-policy URL (customer-data export / erase is in Settings → General → Privacy) · content rating questionnaire · release signing key (the four `ANDROID_*` secrets in the `dtpos.apk` repository). **Not done:** the store-listing artwork itself (feature graphic, screenshots) and the privacy-policy page — they need the owner's wording and the final release build.
