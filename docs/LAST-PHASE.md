# What is left for the last phase (after v1.115.0, 17 Nov 2026)

Everything the owner asked to be done in “phase 1” was done or is listed here with the reason. Nothing else is open.

## Needs a person, not code
1. **Real-phone test** of the three apps and the website — `docs/qa/2026-11-17-phone-test-sheet-v1.115.0.md`.
2. **Signed release APKs** — the owner’s key and four secrets — `docs/RELEASE-SIGNING.md`.
3. **A native speaker reads the Urdu** (`docs/qa/urdu-proofread-sheet.html`); Roman Urdu follows by itself.
4. **Supabase dashboard switch**: Authentication → Policies → leaked-password protection.
5. **Set the delivery fee / minimum order / radius** in Settings → Online Portal (all live restaurants have none today).

## Code, in order
| # | Work | Why it is not in phase 1 |
|---|---|---|
| 1 | **Desktop screens in the design’s master-detail layout** — 32 of 38 remain (done: SW-06 Orders, SW-16 Inventory, SW-18 Parties, SW-19 Customers, SW-21 Riders, SW-02, SW-03). Suggested order by daily use: SW-22 Users, SW-13 Menu, SW-23 HR, SW-25 Accounts, SW-26/27 Reports, then the rest. The `MasterDetail` component and the page frame are ready; each screen is a re-arrangement of an existing 300–2,000-line page and needs its own check at 360 / 768 / 1366 px | Each screen is a separate change with its own risk to the till; they are done one at a time so a problem is one commit |
| 2 | **Customer app** (multi-restaurant, Foodpanda-style) | Parked by the owner on 1 Nov; design kept in `design-project/10-future-customer-app/` |
| 3 | **Product descriptions and extra add-on groups with prices** on the website | The menu has no such fields; needs new columns and screens in the menu manager |
| 4 | ~~Part-payment cash from a rider~~ — done in v1.123.0 (Cash taken field; only that is booked; the bill stays part-paid) | — |
| 5 | **Online card payment** on the website | Needs a payment provider chosen by the owner (and a merchant account) |
| 6 | **Bakery depth** — ~~sub-recipes / semi-finished items and production from raw materials into stock~~ done in v1.117.0 (prep recipes + batches); lots and expiry (FEFO) done in v1.117.1; cake orders with an advance done in v1.117.2 — the bakery depth is complete | They change how stock is consumed — a design decision, not a screen; the web search could not find Technosys's own module to copy from |
| 7 | **Master-detail for the remaining 32 desktop screens** (Inventory next) | one at a time, see 1 |
| 8 | ~~One cost engine everywhere~~ — done in v1.116.1 (branch comparison and the Owner app's purchasing figures value *stock*, not recipes, and are unchanged) | — |
| 9 | ~~Rights by branch and by hour~~ — done in v1.118.0 (limits, temporary grants, approval of risky rights; rules are checked in the app, not as database row permissions) | — |
