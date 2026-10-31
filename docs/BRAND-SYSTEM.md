# DT POS — one brand across the product

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
| Staff sign-in (web + Windows) | **Done** v1.71.0 / v1.72.0 — shared `LoginShell`, mark, app icon, forced-password screen |
| Owner portal sign-in (incl. device-approval wait screen) | **Done** v1.72.0 — same `LoginShell`; handlers proven unchanged (13 / 13) |
| Super Admin invoice (A4) | **Done** v1.72.0 — reference layout; payment details and terms edited in Super Admin → Branding |
| Super Admin invoice, POS 80 mm slip | not restyled (works as before) |
| Windows POS shell, sidebar, top bar | theme only; logo placement **not yet reviewed** |
| Owner portal pages, Super Admin pages | theme only; **not yet reviewed** |
| Receipts / KOT / tokens | not reviewed |
| Customer web-order site | **not started** — data model first (see `design-references/2026-10-31-web-order-site-reference.md`) |
| Android apps (Customer / Rider / Order Taker) | **not started** — icons, splash screens; each with its own accent in this one family; cannot be built or verified in this environment |
| Windows installer / favicon / PWA icon | the purple squircle icon from v1.69.0 |

## Next slices
Windows POS shell → owner portal pages → Super Admin shell → web-order site (header, drawer, hero) → Android icons and splash screens → receipt/KOT headers.
