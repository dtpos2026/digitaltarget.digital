# The owner's reference pictures — analysis (2 Nov 2026)

Eight Dribbble screenshots the owner sent (phone screenshots, so only the preview is visible). They are the
**look the owner wants** for the whole software. Where they differ from the earlier DT purple design package, the
pictures win. Pictures are not copied; their *patterns* are.

| # | Shot | What it shows |
|---|---|---|
| 1 | GoFood — "Restaurant Dashboard POS System" (pink) | Menu / POS: running orders strip (T6 active), category tiles, "Special menu" photo cards, right panel: Table 6, Dine In / Take Away, lines with photo, subtotal / tax / discount / total, payment method pills, one wide **Pay Bills** button |
| 2 | GoFood — "Restaurant food ordering dashboard" | Dashboard with a big promo banner (voucher, photo), category tiles, "Popular food" photo cards with a small pill **Order** and the old price struck through, right panel: balance card, My Order list, promo code, **Checkout** |
| 3 | GoFood — "Restaurant Dashboard Design" | Analytics: four KPI cards with a pink sparkline, Sales bar/line chart, Popular food donut, Daily target ring (72 %), Most favourite items (photos), Recent order request, Daily trending menus |
| 4 | Sweetco — "Point of Sale Dashboard" (orange) | Left sidebar with sections (Main / Operations), text category tabs, 4-column photo grid with **− 0 +** stepper and **Add to cart**, right "Order Summary": customer name, table, order type, items with photo + add-ons, total payment, promo, **Placed an Order** |
| 5 | TastyIgniter — "Restaurant POS Dashboard" (orange / yellow) | **Top pill navigation** (Dashboard · Menu · Order · Tables · VIP Rooms · Sales; the active one a black pill), three KPI cards + "Today order complete 70/136" progress, **Active Order cards**: status badge, table / guests / time, a circular timer ring, items with amounts, total, colour-coded buttons (yellow Mark Ready, black Mark Complete, orange Accept) + View details |
| 6 | "Food." — Restaurant Dashboard POS (coral) | Dashboard: promo hero with illustration, category tiles, popular food cards, balance + order panel |
| 7 | Tst Food — "Restaurant Dashboard POS System" (coral) | Menu: hero banner with photo, category tiles, photo cards with **Add** pill; right "Customer Information" (name, number of persons), lines with − + and Remove, tax / discount / total, **payment method tiles** (Cash · Debit Card · E-Wallet) and **Continue to Payment** |
| 8 | TastyIgniter — "Restaurant Management Dashboard" | Operational snapshot: KPI cards, sales analytics, time-status gauge (avg wait), Live Activity Feed (photo, request, **Handle** button), Quick Insights (kitchen, table overview, sales ring) |

## What they all share (the rules to build to)

1. **Food photography is the hero.** Every product is a big rounded photo; text is small and quiet around it.
2. **One accent colour** (pink, orange, coral) used only for the *active* thing and the *one primary button*; everything else white on a very light page. No second brand colour, no borders heavier than a hairline.
3. **Big rounded shapes**: cards radius ≈ 16–20 px, photos ≈ 12–14 px inside a padded card, buttons pill or 12 px, soft shadow instead of outlines.
4. **Three-zone POS**: slim left navigation · centre (search → category tiles → photo grid) · right order panel (white, full height).
5. **Category tiles**: a row of square tiles, an icon or photo above a one-word label, the selected tile filled with the accent.
6. **The order panel reads top to bottom**: who / where (table, order type switch) → lines (photo, name, − n +, amount) → money (subtotal, tax, discount, total) → payment method as tiles/pills → ONE wide coloured button.
7. **Dashboards start with a hero** (promo / today's goal), then KPI cards with a tinted sparkline, a chart in the accent, a ring for the target, "most favourite" photos, a recent-orders list.
8. **Live operations use cards, not tables** (TastyIgniter): one card per order with status badge, a timer ring, the items, the total, and the next action as a colour-coded button.
9. **Generous whitespace**, ~16–24 px gutters, text 12–14 px with one bold price in the accent.
10. **Themes are only colour**: the same layout exists in pink (GoFood), orange (Sweetco, TastyIgniter), coral (Tst Food) — which is exactly the owner's rule.

## Colours measured from the pictures (dimmed screenshots, so approximate)
GoFood raspberry `#cc1f6e` · Sweetco orange `#fd9d61 → #f97316` · TastyIgniter orange-red `#fe6841`, soft yellow `#f4df87`, near-black `#4c4c4c`, mint page `#f2f8f4` · Tst Food coral `#e1877f → #f4605a`.
Ready-made schemes now in Settings → Appearance (DT Refined): **Berry** (raspberry), **Sunrise** (orange), Rose, Sunset, plus DT Purple, Ocean, Emerald, Graphite, Night.

## Where DT stood against that (before v1.101.0), honestly

| Pattern | DT before | Gap |
|---|---|---|
| Photo-first cards | small 130 px tiles; a photo when one exists, else an icon tile | **Large** — too small, text-heavy, a round "+" only |
| Category tiles | pills | **Large** |
| Order panel | v1.99.0 header, order-type switch, lines, totals, Pay | medium — no line photos; payment method is a separate dialog |
| Navigation | grouped accordion with counts | medium — references use a short flat list (or a top pill bar) |
| Dashboard | KPI cards + lists, no hero, no sparklines, no rings | **Large** |
| Orders / Kitchen | tables and boards | **Large** — references use order cards with a timer ring |
| Whole-site rules (one accent, radius, whitespace, hairlines) | in tokens since v1.85 / v1.100 | small |

## Built in v1.101.0 (the POS screen, DT Refined only)
Photo-first cards (padded 4:3 photo, name, category, price in the accent, pill **Add**; fewer, larger columns — never narrower than 176 px; an item without a photo gets a tinted tile with one outline icon at the same size), category **icon tiles** with the selected one filled, and **cart lines that lead with the item's photo**. Every other theme is unchanged.

## Next, in this order (the same language everywhere)
1. **Order panel**: payment-method tiles (Cash · Card · Wallet · Credit) and the single wide **Pay** (payment dialog = SW-04).
2. **Dashboard**: promo / today's-goal hero, KPI cards with sparklines, sales chart, target ring, most-favourite photos, recent orders.
3. **Orders · Kitchen · Delivery · Tables**: order cards with status badge + timer ring + one colour-coded action (TastyIgniter pattern).
4. **Navigation**: short flat list (Dashboard, Menu, Orders, Customers, Analytics, Settings…) with the rest under "More"; optional top pill bar for small screens.
5. **Remaining screens, apps and the website** on the same cards, tiles and buttons — colour is the only thing a theme changes.

Everything not drawn in these pictures (reports, inventory tables, settings forms, printing) keeps the component language from v1.100.0: same buttons, fields, cards and tables, light page, one accent.
