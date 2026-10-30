# References received 2026-10-30 (three images)

Noted at the user's request ("Note plz"). Nothing here is implemented yet; each section says what the reference shows, what the
product already has, and what is missing. Per the brief: *use as guidance, do not blindly copy*. Only reference A (the ER diagram) is
stored in the repo (`er-target-model.jpg`); B and C are third-party designs (bindolabs.com, dribbble.com) and are described, not copied.

---

## A. ER diagram — the target data model  (`er-target-model.jpg`)

What the diagram shows (crow's-foot notation; the relationship *labels* are blank in the image, only the entities and cardinalities are legible):

```
ORGANIZATIONS ─┬─< USERS
               ├─< BRANCHES ─┬─< ORDERS ─┬─< PAYMENTS
               │             │           ├─< ORDER_ITEMS >─ PRODUCTS
               │             │           └─< KITCHEN_TICKETS
               │             ├─< INVENTORY
               │             └─< STOCK_MOVEMENTS
               ├─< PRODUCTS ─< RECIPES ─< RECIPE_ITEMS
               ├─< SUBSCRIPTIONS
               └─< WEBSITES
CUSTOMERS ─< ORDERS
```

This is exactly the **Organization → Branch → Users** hierarchy of Phase 11, with menu (products), subscriptions and websites owned by the
organization — i.e. a centrally managed menu, one licence per organization, and one set of external websites per organization.

Where the live database stands against it (exact counts on 2026-10-30; names matched, **not** semantics):

| Entity in the diagram | Live table | State |
|---|---|---|
| ORGANIZATIONS | — | **Missing.** `tenants` is one restaurant account; nothing sits above it. This is the Phase 11 gap. |
| USERS | `user_profiles` (13) | Exists; belongs to a tenant, optional branch (`branch_id`, `all_branches`). |
| BRANCHES | `branches` (7) | Exists, tenant-scoped. |
| PRODUCTS | `menu_items` (314) | Exists, tenant-scoped. Per-branch overrides: `menu_item_branches` is described in `docs/DT-POS-ARCHITECTURE.md` §6 but **does not exist** in the live database (that document is out of date). |
| SUBSCRIPTIONS | `admin_invoices` (1), `admin_payments` (0) | **No subscriptions table.** Plan fields live on the tenant (`sa_set_plan`). |
| WEBSITES | — | **Missing** (Phase 8 proposes `integration_sites`). |
| CUSTOMERS | `customers` (2,254) | Exists, tenant-scoped. |
| ORDERS | `orders` (3,733) | Exists. The order is a `jsonb` document; flat columns mirror it. |
| ORDER_ITEMS | `order_items` (7,007, covering 3,724 of 3,733 orders) | **Populated** — by the `trg_sync_order_items_mirror` trigger (v1.34.0), a relational copy of the document. |
| PAYMENTS | `order_payments` (**0**) | Table exists and is **empty**; payments live only inside `orders.data`. The diagram wants them as rows. |
| KITCHEN_TICKETS | `kot_revisions` (0), `print_jobs` (0) | Tables exist, **empty**. |
| INVENTORY / STOCK_MOVEMENTS | `inventory_items` (2) / `stock_logs` (292) | Exist. |
| RECIPES / RECIPE_ITEMS | `recipes` (1) / — | `recipe_items` does not exist. |

Reading it: the diagram is a sound target. Closing the gap is additive work — an `organizations` layer above `tenants`, `subscriptions`,
`integration_sites`, and moving payments/kitchen tickets from the document into their (already existing) tables — and it belongs in the
multi-branch plan (Phase 11), each step with the usual backup, dry-run and rollback. Not started.

---

## B. Table management (bindolabs.com) — a floor-plan screen

Shows: zone tabs (Zone 1–4) with Dine-in / Pick-up counts; a floor plan of round, square and rectangular tables, each coloured by state and showing an
elapsed-time pill and the guest or server's name; a **Floor Plan Actions** side panel (*Move Table, Merge Table, Move Line Item, Split Checks*, then
*New Order → Dine-in / Take Away / Delivery*, then *Reservation Overview / Print Reservation*); and a **status legend bar** along the bottom with a count per
state (seated, ordered, kitchen-dropped, paid, unsent items, alert, over time, reserved, multiple, available, blocked, pax).

Already in the product: `dining_tables` has `shape`, `pos_x`, `pos_y`, `seated_at`, `seated_guests`, `status`, `floor_id`; `TablesPage.tsx` already has table merge,
move and split logic and seated timers.
Missing: a **status legend with live counts**, an elapsed-time pill on each table, a **Floor Plan Actions** panel gathering the actions in one place,
**Move Line Item**, and **reservations** (one mention in the whole page; no reservation table).

## C. Restaurant management dashboard (dribbble.com "SaaS – Restaurant Management Dashboard")

Shows: a light sidebar with an orange filled active item, a count badge on *Orders*, and a promo card at the bottom; four KPI cards (Menus, Orders, Customers, Income) each
with a **sparkline and "vs last month"**; a **service-area map** card with a delivery route; an **order-rate bar chart** with Weekly / Monthly / Yearly toggle and a tooltip;
a **gauge** for customer age bands; and a **recent-orders table** with a thumbnail, customer, price, date and a status chip.

Already in the product: `DashboardPage.tsx` uses recharts (bar and pie charts) and the repo has `leaflet` for maps; the v1.67–v1.69 themes already give the
sidebar pill, rounded cards and a hero banner.
Missing: **period-over-period comparison** ("vs last month") and sparklines on the KPI cards, a **Weekly / Monthly / Yearly** switch on the sales chart, a
**service-area map on the dashboard**, and thumbnails in the recent-orders table. These belong with the owner dashboard (Phase 17).

---

## Next, when the user says go
1. A → fold into the Phase 11 multi-branch architecture document as the target model; then a dry-run design for `organizations`.
2. B → a Tables-page pass: status legend with counts, elapsed pills, actions panel, then reservations (needs a small additive table).
3. C → KPI cards with comparison and sparklines, period switch, recent-orders thumbnails.
Figma is connected (verified); when a Figma link for any of these arrives, the design is read from it directly.
