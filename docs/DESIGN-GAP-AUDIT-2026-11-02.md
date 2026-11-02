# Design package vs. what is built — an honest audit (2026-11-02, v1.96.0)

Prompted by the owner's review of v1.93.0: the POS cart panel and its buttons (CLR, Hold, Kitchen, Customer Receipt, Running, Credit, Void), the Tables screen, the delivery screens and most others look as they did before DT Refined, and "the whole ecosystem was not built as designed".

**The owner is right.** This is what was actually delivered, and what was not.

## 1. What DT Refined (v1.85.0) was
Build-order step 1 was scoped as the **shell**: the white grouped sidebar, the top bar, the colour tokens, and the **one** screen SW-02 (Dashboard). Cards on the Dashboard, Branch Management and Owner Management use the package's card, KPI tile and radius. Nothing else was re-laid-out. Every other screen inside the shell kept its older layout and only picks up the new colours through the shared tokens. The package's component rules (button sizes 32/40/52, inputs 40, cards radius 16 / padding 16, tables with 44 px rows and right-aligned numbers, badges, banners, empty states, skeletons) were **not** applied across the software.

Evidence (code): the package's components are used by `DashboardPage`, `BranchManagementPage` and `OwnerManagementPage` and nowhere else; the POS screen, Tables, Retrieve, Delivery, Pickup, Kitchen, the management screens and Settings contain none of them.

## 2. Side by side — the POS (SW-03)
| The package (`design-project/02-restaurant-software/previews/sw-03.png`) | As built in v1.93 (`docs/audit/2026-11-02-pos-as-built-v1.93.png`) |
|---|---|
| Icon rail; search + Dining / Takeaway / Delivery in one row; category pills; large item cards with a gradient and one outline icon | Items in small cards, a category strip with emoji (📋), a grid button |
| Cart: order number and status, table and guests, "Add customer" row, lines with − / + steppers, totals, **three** actions (Hold, Discount, Kitchen) and **one** large "Pay Rs 4,453" | Cart with a discount and promo form, a full numeric calculator, and eight large buttons (CLR, Hold, PAY, Kitchen, Customer Receipt, Running, Credit, Void) |
| One icon family (outline), one currency format ("Rs 1,450") | Emoji mixed with icons (💰 🧾 🍳 🔢), two currency formats ("Rs.1,450" and "PKR 0"), "Customer Receipt" clipped at the right edge |

## 3. Screen by screen — the restaurant software (SW-01 … SW-40)
"Status" is the package's own label for the screen (Exists in the software = a redesign of an existing screen). "Now" is what is built.

| ID | Screen | Route | Package status | Now |
|---|---|---|---|---|
| SW-01 | Sign-in | / (signed out) | Exists in the software | Own redesign (v1.71.0), not the package's layout |
| SW-02 | Dashboard | /dashboard | Exists in the software | **Built to the package (v1.85.0)** |
| SW-03 | POS — billing | / | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-04 | Payment dialog | POS → Pay | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-05 | Weight panel (by kg) | POS → weighed item | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-06 | Orders (Retrieve) | /bills | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-07 | Online order approval | /online-approval | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-08 | Delivery board | /delivery | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-09 | Pickup orders | /pickup | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-10 | Tables (floor plan) | /tables | Exists in the software | Older layout; plus the Advanced Floor View (own design) |
| SW-11 | Kitchen display (KDS) | /kitchen | Exists in the software | Offline POS's template board (v1.93.0) — not the package's layout |
| SW-12 | KOT & kitchen slips | Kitchen / Printing Center | Exists in the software | Offline POS's KOT designer (identical code) — not the package's layout |
| SW-13 | Menu management | /menu | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-14 | Categories & subcategories | /menu (categories) | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-15 | Deals & combos | /variations | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-16 | Inventory | /inventory | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-17 | Stock — receiving, wastage, recipes | /receiving · /wastage · /recipes | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-18 | Suppliers & parties | /parties | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-19 | Customers | /customers | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-20 | CRM insights | /crm | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-21 | Riders management | /riders · /live-riders | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-22 | Staff & users | /users | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-23 | HR — employees & payroll | /hr | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-24 | Shift & cash drawer · Day close | /shifts · Day Close | Exists in the software | New focused page (v1.96.0), offline POS's structure — not the package's layout |
| SW-25 | Accounts & expenses | /accounts · /daily-wages | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-26 | Sales reports | /reports-center · /reports | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-27 | Financial reports | /profitability · /costing | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-28 | Business settings | /settings | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-29 | Printing center | /printing-center | Exists in the software | Offline POS's Printing Center — not the package's layout |
| SW-30 | Receipt & invoice design | Printing center → Templates | Exists in the software | Offline POS's receipt designer — not the package's layout |
| SW-31 | User permissions | /module-management · Users | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-32 | System configuration | /branches · /devices · /backup · /data-integrity · /version | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-33 | Credits / Udhaar | /credits · /credit-customers | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-34 | Promo codes | /promo-codes | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-35 | Customer website & app settings | /online-portal | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-36 | Tokens | /tokens | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-37 | PRA EIMS (fiscal invoicing) | /pra-eims | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-38 | Foodpanda orders | /foodpanda-orders | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-39 | Staff audit log | /staff-audit | Exists in the software | Older layout; colours follow the chosen scheme |
| SW-40 | Void, complimentary & cancel | /void-bills | Exists in the software | Older layout; colours follow the chosen scheme |

**Result: 1 of 40 screens is built to the package's layout (SW-02).** The shell around all 40 is.

## 4. The other surfaces
| Surface | Built to the package |
|---|---|
| Phone apps — Rider, Order Taker, Owner | All screens that run on existing data (v1.86 – v1.92). Not built: those that need new backend (RID-03, RID-06 when closed, RID-14, RID-20, OWN-18). |
| Customer website WEB-01 … WEB-21 | **None yet.** v1.95.0 made the website honour the owner's switches (a prerequisite); the redesign is next. |
| Brand identity for the software company (logo, splash, sign-in, receipts' "Powered by") | Partly: mark and splash exist; no single identity guide applied everywhere yet. |

## 5. Plan — in the owner's order: first the whole system, then one identity and the polish
1. **Customer website (WEB-01 … 21)** on the existing data (home, header, hero, categories, items, cart, checkout, tracking …). Opening hours, several banners and social links as fields in the existing settings document, served through the v1.95.0 allow-list (no new table).
2. **Component pass** — apply `COMPONENTS.md` to the shared primitives under DT Refined (button sizes, inputs, cards, tables with 44 px rows and right-aligned numbers, badges, banners, empty states, skeletons, dialogs), one icon family (outline; no emoji in controls), one currency format, an 8-point spacing and type scale. This is the lever that makes all 40 screens consistent at once.
3. **POS, payment and weight panel (SW-03, 04, 05)** — rebuild the item grid and the cart panel to the package, including where each of the eight right-hand buttons goes.
4. **Tables, Orders, Online approval, Delivery, Pickup, Kitchen (SW-06 … 12)**.
5. **Management screens (SW-13 … 28)** in groups: menu, inventory, people, money, reports.
6. **Settings, printing, permissions, system (SW-29 … 40)**.
7. **One brand identity** across web, Windows and the three phone apps; an alignment and typography sweep.
Exit test for each step: the built screen is screenshotted next to its package preview and the differences listed.

## 6. Done in v1.96.0 in response to the same review
- **Day Close** has its own page (sidebar → Day Close): shift report, "what Day Close clears" (bills, tables, order number, backup, the modules reset to 00), and a confirmation that lists exactly how many bills leave the live lists. The cloud's safety rules are unchanged.
- **DT Refined colour schemes** (Settings → Appearance → DT Refined → Colour scheme): seven ready-made schemes (DT Purple, Ocean, Emerald, Sunset, Rose, Graphite, Night), five page colours (lavender, clean grey, warm cream, cool mist, night) and the owner's own accent colour. Presentation only.
