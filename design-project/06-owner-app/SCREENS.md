# Owner management mobile app — screen inventory
24 screens. Preview PNGs: `previews/<id>.png`; full-size HTML: `screens/<id>.html`. Sample content only — no figure on any screen is real data.
| Status | Meaning |
|---|---|
| Exists in the software | the module / feature is in the code today; this is a redesign of it |
| New UI on existing data | a new screen, but every field comes from tables/RPCs that exist |
| Needs backend work | the design is ready, the backend cannot do it yet (named in the screen) |

## OWN-01 — Splash
![Splash](previews/own-01.png)
- **Purpose:** Open on the Digital Target purple with the mark, then go straight to Overview if the owner is still signed in.
- **Route / entry:** app launch
- **Roles:** owner / admin
- **Status:** New UI on existing data — evidence: `branding/ (DT Owner icon), scripts/brand/build-brand-assets.mjs`
- **Data shown:** none (saved session read locally)
- **Layout:** Full-bleed purple · mark · "DT Owner" · powered-by line.
- **Components:** Animated DT mark · Title
- **Buttons and actions:** None
- **Navigation:** → Sign in or Overview
- **Empty state:** n/a
- **Loading state:** This screen is the loading state (max 2 s).
- **Error state:** Session rejected: Sign in with "Please sign in again".
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.

## OWN-02 — Sign in
![Sign in](previews/own-02.png)
- **Purpose:** Sign in with the owner account. Nothing about how sign-in works changes — only how it looks.
- **Route / entry:** owner login
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `src/pages/OwnerLoginPage.tsx`
- **Data shown:** Supabase Auth (email or username + password); workspace resolved from the account; "remember me"
- **Layout:** Logo (restaurant's own logo if set, otherwise the DT icon) · "Welcome back" · email/username · password with Forgot password · Remember me · Sign in.
- **Components:** Logo · Email field · Password field (show/hide) · Forgot password link · Remember me · Primary button
- **Buttons and actions:** Sign in · Forgot password (sends a reset link to the typed address)
- **Navigation:** → Overview, or Device approval
- **Empty state:** Placeholders "owner@restaurant.com".
- **Loading state:** Button "Signing in…", fields locked; after 10 s "Still working — slow connection".
- **Error state:** Wrong details: banner with the server message; "Enter an email and password" for empty fields.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** If the build is offline a cached session can be restored ("Offline login: cached session restored"). After 10 s of a slow sign-in a hint appears — both exist today.

## OWN-03 — Waiting for device approval
![Waiting for device approval](previews/own-03.png)
- **Purpose:** A new phone must be approved once from an already-trusted device; this screen says so and waits.
- **Route / entry:** after Sign in on a new device
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `OwnerLoginPage.tsx ("Waiting for Device Approval"), src/pages/DevicesPage.tsx`
- **Data shown:** devices (device id, status pending/approved), the approving admin on another device
- **Layout:** Shield icon · title · explanation · device name · Cancel / Sign in another account.
- **Components:** Icon disc · Device card · Secondary buttons
- **Buttons and actions:** Check again · Sign in with another account
- **Navigation:** → Overview (when approved)
- **Empty state:** n/a
- **Loading state:** Gentle pulse while waiting; polls automatically.
- **Error state:** Rejected: "This device was not approved. Contact your administrator."
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.

## OWN-04 — Overview
![Overview](previews/own-04.png)
![Overview — desktop](previews/own-04-d.png)
- **Purpose:** Answer the owner's first question: "which of my branches is doing what, right now?"
- **Route / entry:** tab: Overview
- **Roles:** owner / admin (manager: own branch)
- **Status:** New UI on existing data — evidence: `src/pages/OwnerManagementPage.tsx, OwnerLoginPage.tsx (the by-branch breakdown) — same figures, mobile layout`
- **Data shown:** orders (all branches): revenue by timestamp, bills, outstanding (unpaid part of partial/credit), running count, void/cancelled; branches
- **Layout:** Greeting + date presets · 5 KPIs (money taken, bills, still owed, open now, void/cancelled) · by-branch cards with share of the business · low-stock / approvals shortcuts.
- **Components:** Date presets · KPI tiles · Branch cards · Share bar · Shortcut rows
- **Buttons and actions:** Change period · Open a branch · Open approvals · Open low stock
- **Navigation:** → Branch detail, Orders, Approvals, Inventory
- **Empty state:** "No branches set up yet — add them in Settings → Branches."
- **Loading state:** Skeleton KPI tiles and cards.
- **Error state:** Retry banner; last loaded numbers stay with their time.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Same arithmetic as Owner Management today. A branch that took nothing still gets a card (an empty branch is information); orders with no branch recorded are shown under "No branch recorded", never silently added to one branch.

## OWN-05 — Branch detail
![Branch detail](previews/own-05.png)
- **Purpose:** Look inside one branch: how the day is going hour by hour and what is open.
- **Route / entry:** Overview → a branch
- **Roles:** owner / admin
- **Status:** New UI on existing data — evidence: `orders.branch_id, order totals/payments`
- **Data shown:** orders for one branch: hourly sales, payment split, order types, top items, open orders
- **Layout:** Branch header · period presets · sales line by hour · payment split donut · order types · open orders list.
- **Components:** Line chart · Donut · Type bars · Order rows
- **Buttons and actions:** Change period · Open an order · Switch branch
- **Navigation:** → Order detail
- **Empty state:** "No sales in this period".
- **Loading state:** Skeleton chart.
- **Error state:** Chart card shows its own Retry.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.

## OWN-06 — Orders
![Orders](previews/own-06.png)
- **Purpose:** Watch the floor from anywhere: what is running, what is paid, what was voided.
- **Route / entry:** tab: Orders
- **Roles:** owner / admin / manager
- **Status:** New UI on existing data — evidence: `orders table, OrdersPage`
- **Data shown:** orders (number, type, table, customer, total, status, time) by branch and date
- **Layout:** Branch + status filter chips · search · order rows with status badge · pull to refresh.
- **Components:** Filter chips · Search · Order row · Status badge
- **Buttons and actions:** Filter · Search · Open order
- **Navigation:** → Order detail
- **Empty state:** "No orders match" + Clear filters.
- **Loading state:** Row skeletons.
- **Error state:** Retry banner; last loaded rows stay.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.

## OWN-07 — Order detail
![Order detail](previews/own-07.png)
- **Purpose:** Everything about one bill, read-only, with who did what.
- **Route / entry:** Orders → order
- **Roles:** owner / admin / manager
- **Status:** New UI on existing data — evidence: `orders, order_items, payments, audit log`
- **Data shown:** order + items + payments + void/cancel reason + staff who took it; delivery status and rider
- **Layout:** Status + number · items · totals · payments · timeline (created → paid) · staff.
- **Components:** Item list · Totals · Payment rows · Timeline
- **Buttons and actions:** Call customer · Open rider · Share receipt (PDF)
- **Navigation:** —
- **Empty state:** n/a
- **Loading state:** Skeleton blocks.
- **Error state:** Banner with Retry.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Read-only on the phone: void, refund and edit stay in the POS where the permission checks and the audit trail live.

## OWN-08 — Online order approvals
![Online order approvals](previews/own-08.png)
- **Purpose:** Let an owner approve or reject a website order from the phone when no one is at the counter.
- **Route / entry:** Overview → Approvals
- **Roles:** owner / admin / manager
- **Status:** Exists in the software — evidence: `online approval flow (status pending_approval / rejected)`
- **Data shown:** orders with status pending_approval (website / app) → accepted or rejected
- **Layout:** List of pending orders with items, total, customer, address · Approve / Reject per card · reject reason sheet.
- **Components:** Order card · Approve button · Reject button · Reason sheet
- **Buttons and actions:** Approve · Reject (with reason) · Call customer
- **Navigation:** → Order detail
- **Empty state:** "Nothing waiting for approval".
- **Loading state:** Card skeletons.
- **Error state:** Approve fails: card stays, banner "Could not approve — try again".
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Uses the same status changes as the POS approval screen, so the kitchen and the customer tracking update. Needs the permission to approve online orders.

## OWN-09 — Kitchen status
![Kitchen status](previews/own-09.png)
- **Purpose:** See whether the kitchen is keeping up — the number of tickets and how long the oldest has waited.
- **Route / entry:** Orders → Kitchen
- **Roles:** owner / admin / manager
- **Status:** New UI on existing data — evidence: `KDS screen data (kot / kitchen status)`
- **Data shown:** kitchen tickets: items, age, status (new / cooking / ready), late threshold
- **Layout:** Counters (new / cooking / ready / late) · ticket list sorted by age · late tickets flagged.
- **Components:** Counters · Ticket card · Late flag
- **Buttons and actions:** Open ticket
- **Navigation:** → Order detail
- **Empty state:** "Kitchen is clear".
- **Loading state:** Skeleton tickets.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Read-only: bumping a ticket stays on the kitchen screen.

## OWN-10 — Delivery and riders
![Delivery and riders](previews/own-10.png)
- **Purpose:** Know where the riders are and which deliveries are stuck.
- **Route / entry:** Orders → Delivery
- **Roles:** owner / admin / manager
- **Status:** Exists in the software — evidence: `src/pages/LiveRidersMapPage.tsx, RidersListPage.tsx`
- **Data shown:** delivery orders by delivery_status; riders (active, current orders); live rider positions (GPS pings)
- **Layout:** Live map with rider pins · counters (waiting / on the way / delivered) · rider list with current order · unassigned orders.
- **Components:** Live map · Counters · Rider row · Unassigned list
- **Buttons and actions:** Open rider · Open order · Call rider
- **Navigation:** → Order detail
- **Empty state:** "No deliveries right now".
- **Loading state:** Map skeleton.
- **Error state:** Map fails: list still works.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Assigning a rider stays in the POS. A rider who is not "Live" has no pin; the row says "offline".

## OWN-11 — Sales report
![Sales report](previews/own-11.png)
- **Purpose:** The numbers an owner checks every night, readable on a phone.
- **Route / entry:** tab: Reports
- **Roles:** owner / admin
- **Status:** New UI on existing data — evidence: `src/lib/salesReport.ts (presetRange, revenueTimestamp), Reports Center`
- **Data shown:** orders aggregated: revenue per day, payment method split, top items, order type
- **Layout:** Presets · total + comparison with the previous period · daily bars · top items · export.
- **Components:** Presets · Total + delta · Bar chart · Top items list · Export button
- **Buttons and actions:** Change period · Pick branch · Export PDF / share
- **Navigation:** → Item list
- **Empty state:** "No sales in this period".
- **Loading state:** Skeleton chart + rows.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Uses the same revenue timestamp rule as the Windows reports so the two always agree. "Previous period" comparison is computed on the phone from the same data.

## OWN-12 — Profit and expenses
![Profit and expenses](previews/own-12.png)
- **Purpose:** Is the restaurant making money this month: revenue minus costs, at a glance.
- **Route / entry:** Reports → Profit
- **Roles:** owner / admin
- **Status:** New UI on existing data — evidence: `Profitability / Financial report modules`
- **Data shown:** revenue, cost of goods (recipes), expenses, daily wages → profit
- **Layout:** Revenue / costs / expenses / profit tiles · waterfall-style bars · biggest expense categories.
- **Components:** Summary tiles · Bars · Category list
- **Buttons and actions:** Change period · Open expenses
- **Navigation:** → Expenses
- **Empty state:** "No data for this period".
- **Loading state:** Skeleton tiles.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Cost of goods is only as good as the recipes entered; if a menu item has no recipe the card says "costs incomplete" instead of showing a flattering profit.

## OWN-13 — Menu and availability
![Menu and availability](previews/own-13.png)
- **Purpose:** Switch an item off the moment the kitchen runs out, from anywhere.
- **Route / entry:** tab: Menu
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `src/pages/MenuManagerPage.tsx`
- **Data shown:** menu_items (name, price, category, is_active), categories
- **Layout:** Search · category chips · item rows with availability switch and price · Edit.
- **Components:** Search · Category chips · Item row · Availability switch
- **Buttons and actions:** Toggle availability · Edit price · Open item
- **Navigation:** → Item edit
- **Empty state:** "No items in this category".
- **Loading state:** Row skeletons.
- **Error state:** Switch fails: it snaps back with "Could not save".
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Availability and price are the two edits worth doing on a phone; everything else (variants, recipes, images) stays on the full menu manager. Switching off takes effect on the POS, website and customer app (they read menu_items.is_active).

## OWN-14 — Inventory and low stock
![Inventory and low stock](previews/own-14.png)
- **Purpose:** See what is about to run out and who supplies it.
- **Route / entry:** More → Inventory / Overview shortcut
- **Roles:** owner / admin / manager
- **Status:** New UI on existing data — evidence: `Inventory / Stock modules`
- **Data shown:** inventory items (stock, unit, reorder level), suppliers
- **Layout:** Low-stock banner · item rows with stock vs reorder level bar · supplier phone.
- **Components:** Banner · Stock row · Level bar · Call supplier
- **Buttons and actions:** Call supplier · Open item
- **Navigation:** → Item detail
- **Empty state:** "Everything is above its reorder level".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Stock adjustments and purchasing stay in the full software (they need the cost and supplier fields).

## OWN-15 — Expenses
![Expenses](previews/own-15.png)
- **Purpose:** Record an expense on the spot and see where the month's money went.
- **Route / entry:** More → Expenses
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `Accounts / Expenses module`
- **Data shown:** expenses (date, category, amount, note, branch)
- **Layout:** Month total · list grouped by day · "Add expense" bottom sheet.
- **Components:** Total card · Expense row · Add sheet
- **Buttons and actions:** Add expense · Open expense
- **Navigation:** —
- **Empty state:** "No expenses this month".
- **Loading state:** Row skeletons.
- **Error state:** Save fails: sheet stays open with the values and a banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.

## OWN-16 — Staff
![Staff](previews/own-16.png)
- **Purpose:** Who works here, in what role, and who is on duty now.
- **Route / entry:** More → Staff
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `Users / HR modules`
- **Data shown:** user_profiles (name, role, branch, active), shifts (who is on duty)
- **Layout:** On-duty counter · staff rows with role badge and branch · filter by role.
- **Components:** Counter · Staff row · Role badge
- **Buttons and actions:** Open staff member · Call
- **Navigation:** → Staff detail (read-only)
- **Empty state:** "No staff yet".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Salaries and payroll are not shown here: HR data is owner/admin only and its access rules are still being tightened (see the security audit, finding S2). Creating users and changing roles stays in the full software.

## OWN-17 — Customers and credit
![Customers and credit](previews/own-17.png)
- **Purpose:** Know the regulars and who still owes money.
- **Route / entry:** More → Customers
- **Roles:** owner / admin / manager
- **Status:** Exists in the software — evidence: `Customers / Credits modules`
- **Data shown:** customers (name, phone, orders, total spent), credit balances (credit_pending, credit_received)
- **Layout:** Segment Customers / Credit · search · rows with spend and balance · call.
- **Components:** Segment · Customer row · Balance badge · Call button
- **Buttons and actions:** Call customer · Open customer
- **Navigation:** → Customer detail
- **Empty state:** "No customers yet".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Receiving a credit payment stays in the POS (it creates a payment record). Loyalty points exist in the data but are not used, so no points are shown.

## OWN-18 — Notifications and alerts
![Notifications and alerts](previews/own-18.png)
- **Purpose:** Tell the owner what needs attention without them opening the app.
- **Route / entry:** Overview → bell
- **Roles:** owner / admin
- **Status:** Needs backend work — evidence: `none — no push service or notifications table today`
- **Data shown:** notifications: new online order, low stock, void spike, shift closed, device request
- **Layout:** Today / earlier groups · icon, title, one line, time · settings link for which alerts to get.
- **Components:** Notification row · Unread dot · Alert settings
- **Buttons and actions:** Open the related screen · Mark all read · Choose alerts
- **Navigation:** → Approvals, Inventory, Orders, Devices
- **Empty state:** "You are all caught up".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** There is no push channel (FCM) and no notifications table. This is the one big gap for an owner app: today the owner must open the app to see anything. Designed so it can be switched on when the backend exists (see handoff §gaps).

## OWN-19 — More
![More](previews/own-19.png)
- **Purpose:** The rest of the modules the owner can reach from the phone — only those the account has permission for.
- **Route / entry:** tab: More
- **Roles:** owner / admin
- **Status:** New UI on existing data — evidence: `ModuleManagement / permission matrix`
- **Data shown:** role permissions decide which rows appear
- **Layout:** Profile card · grouped rows (Operations, People, Admin) · Log out.
- **Components:** Profile card · Group list · Log out
- **Buttons and actions:** Open a module · Log out
- **Navigation:** → Delivery, Kitchen, Expenses, Staff, Customers, Inventory, Settings, Devices
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** A row whose module the restaurant has switched off, or the role may not open, is not drawn at all (no greyed teasers).

## OWN-20 — Website and app switches
![Website and app switches](previews/own-20.png)
- **Purpose:** Stop or start online ordering in one tap — for example when the kitchen is overwhelmed.
- **Route / entry:** More → Website and app switches
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `src/pages/OnlinePortalPage.tsx (Master Switches)`
- **Data shown:** customer portal master switches (website on/off, takeaway, delivery, table QR, tracking), order approval mode
- **Layout:** Master switches with one-line explanations · links (open, copy, share QR) · opening-hours slot (reserved).
- **Components:** Switch rows · Link rows · Copy / QR buttons
- **Buttons and actions:** Toggle a switch · Copy link · Share QR
- **Navigation:** → Website branding (full software)
- **Empty state:** n/a
- **Loading state:** Switches disabled until loaded.
- **Error state:** Toggle fails: it snaps back with "Could not save".
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** Today there is no opening-hours or banner data; the "Opening hours" and "Banners" rows are drawn as reserved slots marked "coming" (needs-backend).

## OWN-21 — Devices
![Devices](previews/own-21.png)
- **Purpose:** Approve or block the phones and PCs that can open this restaurant.
- **Route / entry:** More → Devices
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `src/pages/DevicesPage.tsx`
- **Data shown:** devices (name, platform, last seen, status pending/approved/blocked)
- **Layout:** Pending requests on top (Approve / Reject) · approved devices with last seen · Block.
- **Components:** Pending card · Device row · Approve / Reject / Block buttons
- **Buttons and actions:** Approve · Reject · Block
- **Navigation:** —
- **Empty state:** "No other devices".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
- **Note:** This is the screen that releases OWN-03 (Waiting for device approval).

## OWN-22 — Profile and workspace
![Profile and workspace](previews/own-22.png)
- **Purpose:** The workspace code staff use to sign in on their phones, the plan status, and the owner's own details.
- **Route / entry:** More → profile card
- **Roles:** owner / admin
- **Status:** Exists in the software — evidence: `src/components/WorkspaceCodeCard.tsx, PlanStatusWidget.tsx`
- **Data shown:** user_profiles, workspace code (WorkspaceCodeCard), plan status
- **Layout:** Workspace code card with Copy / Share · plan card · account details · theme · Log out.
- **Components:** Workspace code card · Plan card · Form rows · Theme switch
- **Buttons and actions:** Copy code · Share code · Change password · Log out
- **Navigation:** —
- **Empty state:** n/a
- **Loading state:** Skeleton cards.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.

## OWN-23 — Empty, loading and error states
![Empty, loading and error states](previews/own-23.png)
- **Purpose:** What the owner sees with no data, while loading, offline or refused by permissions.
- **Route / entry:** all lists
- **Roles:** owner / admin
- **Status:** New UI on existing data — evidence: `src/pages/OwnerManagementPage.tsx, OwnerLoginPage.tsx`
- **Data shown:** —
- **Layout:** Offline cached banner · permission-denied · no branches · skeleton.
- **Components:** Banner · Empty illustration · Skeleton
- **Buttons and actions:** Retry · Contact administrator
- **Navigation:** —
- **Empty state:** This screen is the specification.
- **Loading state:** Skeleton shown.
- **Error state:** Banners as drawn.
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.

## OWN-24 — Overview (dark)
![Overview (dark)](previews/own-24.png)
- **Purpose:** Dark theme for evening checks.
- **Route / entry:** tab: Overview — dark
- **Roles:** owner / admin
- **Status:** New UI on existing data — evidence: `src/pages/OwnerManagementPage.tsx, OwnerLoginPage.tsx`
- **Data shown:** same as Overview
- **Layout:** Same as Overview.
- **Components:** Same as Overview
- **Buttons and actions:** Same as Overview
- **Navigation:** Same as Overview
- **Empty state:** Same as Overview
- **Loading state:** Same as Overview
- **Error state:** Same as Overview
- **Responsive:** Designed at 390 × 844 (Android). On a tablet (820+) the tab bar becomes a left rail and Overview shows the branch cards in two columns; the desktop version is the Owner Management module of the Windows / web software.
