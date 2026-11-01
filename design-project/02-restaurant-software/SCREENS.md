# Restaurant software (Windows + web) — screen inventory
40 screens. Preview PNGs: `previews/<id>.png`; full-size HTML: `screens/<id>.html`. Sample content only — no figure on any screen is real data.
| Status | Meaning |
|---|---|
| Exists in the software | the module / feature is in the code today; this is a redesign of it |
| New UI on existing data | a new screen, but every field comes from tables/RPCs that exist |
| Needs backend work | the design is ready, the backend cannot do it yet (named in the screen) |

## SW-01 — Sign-in
![Sign-in](previews/sw-01.png)
- **Purpose:** Staff and owners sign in to their workspace. The brand panel carries the active theme.
- **Route / entry:** / (signed out)
- **Roles:** all staff
- **Status:** Exists in the software — evidence: `src/pages/LoginPage.tsx, OwnerLoginPage.tsx`
- **Data shown:** user_profiles (username, role, branch), workspace
- **Layout:** Two columns 44 / 56: brand panel (theme colour) and a sign-in card; footer with version and contacts.
- **Components:** Brand lockup · Feature chips · Username / password fields · Remember me · Primary button
- **Buttons and actions:** Sign in · Forgot password · Contact Digital Target · Back to owner login
- **Navigation:** → Splash → POS (cashier) or Dashboard (admin/manager)
- **Empty state:** Fields show placeholders; required fields are marked; Save is disabled until valid.
- **Loading state:** Save shows a spinner and locks the form; fields keep their values.
- **Error state:** Field errors under the field (red border + message); a summary banner if the save itself failed.
- **Responsive:** Below 1024 the brand panel is hidden and the card is centred.

## SW-02 — Dashboard
![Dashboard](previews/sw-02.png)
- **Purpose:** The owner's morning view: how today is going, against the week, per branch.
- **Route / entry:** /dashboard
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/DashboardPage.tsx`
- **Data shown:** orders (grand_total, status, payment_method, order_type), order_items, branches, inventory_items.low_stock_threshold, day_closes
- **Layout:** 4 KPI cards · sales trend (2/3) + payment mix (1/3) · top items + hourly orders · recent orders table + alerts.
- **Components:** KPI card ×4 · Line chart · Donut · Bar chart · Orders table · Alert list
- **Buttons and actions:** Change period · Open an order · Open Reports Center · Open low-stock item
- **Navigation:** → Retrieve, Reports Center, Inventory
- **Empty state:** Each card shows "No data for this period" with the period selector still usable.
- **Loading state:** Skeleton cards and chart placeholders, same layout (no jump).
- **Error state:** The failing card shows an inline Retry; the others stay.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-03 — POS — billing
![POS — billing](previews/sw-03.png)
- **Purpose:** Take a bill fast: pick items, set the order type, send to the kitchen, take payment.
- **Route / entry:** /
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/POSScreen.tsx`
- **Data shown:** categories, menu_items (price, size_variants, inch_variants, flavors, kitchen_id), dining_tables, customers, orders (order_type, table_id, discount, tax, service_charge, notes)
- **Layout:** Left: category rail. Centre: search + item grid. Right: cart (order type, table, customer, lines, totals, actions).
- **Components:** Category pills · Item card (image, name, price) · Cart line with qty stepper · Order-type segmented control · Totals · Kitchen / Hold / Pay buttons
- **Buttons and actions:** Add item · Change quantity · Discount · Service charge · Kitchen (KOT) · Hold · Pay
- **Navigation:** Pay → Payment dialog (SW-04); item with size → variant sheet; weight item → kg panel (SW-05)
- **Empty state:** Select-something state in the empty pane.
- **Loading state:** Skeleton blocks in the pane.
- **Error state:** Banner with Retry inside the pane.
- **Responsive:** At 1024 the cart narrows to 340; below 900 the cart becomes a bottom drawer (tablet portrait).

## SW-04 — Payment dialog
![Payment dialog](previews/sw-04.png)
- **Purpose:** Complete a bill: method, amount received, change or balance.
- **Route / entry:** POS → Pay
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/components/PaymentDialog.tsx`
- **Data shown:** orders (payment_method, cash_received, change_returned, amount_paid, payment_account_id), payment_accounts
- **Layout:** Modal 920 wide: hero total on the left with method tiles; amount received with quick amounts and keypad on the right; footer actions.
- **Components:** Hero total · Method tiles (Cash, Card, Online, Credit, custom) · Amount field · Quick amounts · Keypad · Change / Due cards
- **Buttons and actions:** Choose method · Type amount · Exact · Complete sale (Enter) · Back to cart
- **Navigation:** → Receipt print → new bill
- **Empty state:** Fields show placeholders; required fields are marked; Save is disabled until valid.
- **Loading state:** Save shows a spinner and locks the form; fields keep their values.
- **Error state:** Amount below total with a method that needs full payment: Complete is disabled and the Due card explains.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-05 — Weight panel (by kg)
![Weight panel (by kg)](previews/sw-05.png)
- **Purpose:** Sell by weight or by amount: type kg / g / pao, or the amount, and the line is priced from the rate per kg.
- **Route / entry:** POS → weighed item
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/components/WeightPanel.tsx, src/lib/weightPricing.ts`
- **Data shown:** menu_items (pricing_type = weight, rate_per_kg)
- **Layout:** Right drawer over the POS: mode switch, big readout, keypad, Quantity / Price summary.
- **Components:** Mode switch (By weight / By amount) · Unit chips kg · g · pao · Readout · Keypad · Summary
- **Buttons and actions:** Choose mode · Type value · Add to cart
- **Navigation:** → back to POS with the line added
- **Empty state:** Fields show placeholders; required fields are marked; Save is disabled until valid.
- **Loading state:** Save shows a spinner and locks the form; fields keep their values.
- **Error state:** Field errors under the field (red border + message); a summary banner if the save itself failed.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-06 — Orders (Retrieve)
![Orders (Retrieve)](previews/sw-06.png)
- **Purpose:** Find, reopen, pay, reprint or void a bill.
- **Route / entry:** /bills
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/BillReprintPage.tsx, RunningBillsPage.tsx`
- **Data shown:** orders (order_number, order_type, table_label, customer_snapshot, grand_total, status, created_at, paid_at, kot_printed)
- **Layout:** Toolbar (search, date, type, status chips) · table (left) · selected-bill panel (right).
- **Components:** Search · Status chips · Orders table · Bill detail panel · Status badges
- **Buttons and actions:** Open bill · Reprint · Take payment · Void (manager) · Export
- **Navigation:** Open → POS; Void → Void/Comp/Cancel (reason required)
- **Empty state:** Illustration, "No orders (retrieve) yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-07 — Online order approval
![Online order approval](previews/sw-07.png)
- **Purpose:** Orders from the website, QR and Order Taker wait here until someone accepts or rejects them.
- **Route / entry:** /online-approval
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderApprovalPage.tsx`
- **Data shown:** orders (status = pending_approval, source = website / qr / order_taker, approval_required, approved_by, rejected_reason)
- **Layout:** Queue of order cards with source badge, items, total, distance and age; accept / reject on each.
- **Components:** Order card · Source badge · Age timer · Accept / Reject buttons · Reject-reason sheet
- **Buttons and actions:** Accept · Reject with reason · Open details
- **Navigation:** Accept → Delivery board / Kitchen; Reject → customer sees the reason in tracking
- **Empty state:** Illustration, "No online order approval yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-08 — Delivery board
![Delivery board](previews/sw-08.png)
- **Purpose:** Run deliveries: see every stage, assign a rider, follow progress.
- **Route / entry:** /delivery
- **Roles:** admin, manager, cashier, rider
- **Status:** Exists in the software — evidence: `src/pages/DeliveryBoardPage.tsx, src/lib/delivery.ts`
- **Data shown:** orders (order_type = delivery, delivery_status, rider_id, rider_name, delivery.distanceKm, delivery.etaMinutes)
- **Layout:** Kanban columns by delivery_status: Pending · Accepted · Cooking · Ready · Rider assigned · On the way · Delivered; rider strip on top.
- **Components:** Column header with count · Delivery card · Rider chip list · Assign-rider menu · Map toggle
- **Buttons and actions:** Assign rider · Advance stage · Call customer · Open map · Cancel
- **Navigation:** → Live riders map; assignment notifies the rider portal
- **Empty state:** Illustration, "No delivery board yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-09 — Pickup orders
![Pickup orders](previews/sw-09.png)
- **Purpose:** Takeaway and website pickup orders by readiness, so the counter hands them over on time.
- **Route / entry:** /pickup
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/PickupOrdersPage.tsx`
- **Data shown:** orders (order_type = takeaway, source, kitchen_status, customer_snapshot)
- **Layout:** Three lanes: Preparing · Ready to hand over · Collected today; large order number and customer name.
- **Components:** Lane header · Pickup card · Ready button · Handed over button
- **Buttons and actions:** Mark ready · Handed over · Call customer
- **Navigation:** → Retrieve for payment if unpaid
- **Empty state:** Illustration, "No pickup orders yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-10 — Tables (floor plan)
![Tables (floor plan)](previews/sw-10.png)
- **Purpose:** See the floor at a glance and open, move or merge a table.
- **Route / entry:** /tables
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/TablesPage.tsx`
- **Data shown:** dining_tables (name, seats, shape, status, current_order_id, seated_at, seated_guests, pos_x, pos_y, floor_id)
- **Layout:** Floor tabs · plan canvas with tables by status colour · legend · selected-table panel.
- **Components:** Floor tabs · Table shape (round / square / long) · Status colours · Legend · Table panel
- **Buttons and actions:** Open table · Move / merge · Split bill · Request bill · Free table
- **Navigation:** Open → POS with the table selected
- **Empty state:** No floors yet: "Add your first floor" with a short tour of the editor.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-11 — Kitchen display (KDS)
![Kitchen display (KDS)](previews/sw-11.png)
- **Purpose:** The kitchen sees every ticket, how long it has waited, and bumps it when ready. Dark by default: readable at a distance.
- **Route / entry:** /kitchen
- **Roles:** admin, manager, cashier (kitchen device)
- **Status:** Exists in the software — evidence: `src/pages/KitchenDisplayPage.tsx, KdsTvPage.tsx`
- **Data shown:** orders (kitchen_status, kitchen_status_at, kot_printed), order_items, kitchens (printer_role), devices (is_kds, kds_kitchen_id)
- **Layout:** Full-screen columns New · Cooking · Ready; ticket header shows order, type, table, age (green → amber → red).
- **Components:** Ticket · Age timer · Item list with notes · Bump button · Station filter
- **Buttons and actions:** Start cooking · Bump to ready · Recall · Filter by station
- **Navigation:** Ready → pickup / delivery board
- **Empty state:** Illustration, "No kitchen display (kds) yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Designed for a 1080p TV and a 10" tablet; ticket width flexes from 4 to 2 columns.

## SW-12 — KOT & kitchen slips
![KOT & kitchen slips](previews/sw-12.png)
- **Purpose:** Check what reached which kitchen printer and reprint on purpose — never by accident.
- **Route / entry:** Kitchen / Printing Center
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/KitchenDisplayPage.tsx, PrintingCenterPage.tsx`
- **Data shown:** orders (kot_printed, kot_print_count, kot_first_printed_at, kot_last_printed_at, print_status), kitchens (printer_role)
- **Layout:** Table of KOTs with printer, copies, first/last print, status; slip preview on the right.
- **Components:** KOT table · Printer role badge · Slip preview (80 mm) · Reprint button
- **Buttons and actions:** Reprint KOT · Change kitchen printer · Test slip
- **Navigation:** → Printer settings (SW-27)
- **Empty state:** Illustration, "No kot & kitchen slips yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-13 — Menu management
![Menu management](previews/sw-13.png)
- **Purpose:** Create and maintain every item: price, variants, kitchen, image, availability.
- **Route / entry:** /menu
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/MenuManagerPage.tsx`
- **Data shown:** menu_items (name, category_id, kitchen_id, pricing_type, price, rate_per_kg, size_variants, inch_variants, flavors, sub_category, image_path, is_active, barcode, sku, inventory_item_id)
- **Layout:** Filters + table of items; right drawer edits the selected item (basics, pricing type, variants, kitchen, stock link).
- **Components:** Items table · Availability toggle · Edit drawer · Variant editor (size / inch / flavours) · Image uploader
- **Buttons and actions:** Add item · Import Excel · Edit · Toggle availability · Delete (to recycle bin)
- **Navigation:** → Categories, Deals, Inventory link
- **Empty state:** Illustration, "No menu management yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Availability switch is what the website and apps read — an item switched off here disappears from every channel.

## SW-14 — Categories & subcategories
![Categories & subcategories](previews/sw-14.png)
- **Purpose:** Order the menu the way customers and cashiers see it.
- **Route / entry:** /menu (categories)
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/MenuManagerPage.tsx`
- **Data shown:** categories (name, icon, image_path, sort_order, is_active); menu_items.sub_category, flavor_group
- **Layout:** Left: sortable category list with item counts. Right: subcategories / flavour groups of the selected category.
- **Components:** Sortable list · Icon picker · Visibility toggle · Subcategory chips
- **Buttons and actions:** Add category · Reorder (drag) · Hide · Rename
- **Navigation:** → Menu items of the category
- **Empty state:** Illustration, "No categories & subcategories yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-15 — Deals & combos
![Deals & combos](previews/sw-15.png)
- **Purpose:** Bundle items into a deal with one price; the POS and the website sell it as one line.
- **Route / entry:** /variations
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/MenuManagerPage.tsx (Deals / Combos), src/lib/deals.ts`
- **Data shown:** menu_items (deal items), deals (components)
- **Layout:** Deal cards · editor with the included items and the saving shown.
- **Components:** Deal card · Item picker · Price vs sum-of-parts
- **Buttons and actions:** New deal · Edit · Enable / disable
- **Navigation:** → Menu
- **Empty state:** Illustration, "No deals & combos yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-16 — Inventory
![Inventory](previews/sw-16.png)
- **Purpose:** Know what is in stock, what it costs, and what is about to run out.
- **Route / entry:** /inventory
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/InventoryPage.tsx`
- **Data shown:** inventory_items (name, sku, base_unit, quantity, cost_price, avg_cost_price, sale_price, low_stock_threshold, category_id), inventory_categories
- **Layout:** KPI strip (items, stock value, low stock) · table with stock bars · item panel with recent movements.
- **Components:** KPI cards · Stock table with level bar · Low-stock badge · Item panel
- **Buttons and actions:** Add item · Adjust stock · Receive stock · Export
- **Navigation:** → Receiving, Wastage, Recipes
- **Empty state:** Illustration, "No inventory yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-17 — Stock — receiving, wastage, recipes
![Stock — receiving, wastage, recipes](previews/sw-17.png)
- **Purpose:** Record what comes in, what is wasted, and what each dish consumes, so stock deducts correctly on every sale.
- **Route / entry:** /receiving · /wastage · /recipes
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/ReceivingPage.tsx, WastagePage.tsx, RecipesPage.tsx`
- **Data shown:** stock_logs (type, quantity, note, order_id), receiving_entries, wastages, recipes, recipe_components, inventory_items
- **Layout:** Tabs: Receiving · Wastage · Recipes · Movements. Receiving form with supplier and lines; running total.
- **Components:** Tabs · Line editor · Supplier select · Recipe cost card · Movements table
- **Buttons and actions:** Add line · Save receiving · Record wastage · Edit recipe
- **Navigation:** → Suppliers (Party Master), Inventory
- **Empty state:** Illustration, "No stock — receiving, wastage, recipes yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-18 — Suppliers & parties
![Suppliers & parties](previews/sw-18.png)
- **Purpose:** Suppliers and other parties with a running ledger: what we owe, what we paid.
- **Route / entry:** /parties
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/PartyMasterPage.tsx`
- **Data shown:** parties (name, kind, phone, address, opening_balance), ledger_entries (direction, amount, reference, occurred_at)
- **Layout:** Party list with balance · ledger of the selected party.
- **Components:** Party table · Balance badge · Ledger · Add entry
- **Buttons and actions:** Add party · Add ledger entry · Print statement
- **Navigation:** → Receiving
- **Empty state:** Illustration, "No suppliers & parties yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-19 — Customers
![Customers](previews/sw-19.png)
- **Purpose:** Everyone who has ordered, with what they spend and what they owe.
- **Route / entry:** /customers
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/CustomersPage.tsx`
- **Data shown:** customers (name, phone, addresses, loyalty_points, credit_balance, is_blocked, total_orders, total_spent, last_order_at, grade, favorite_item_name, customer_code)
- **Layout:** Table with search and filters · customer panel: stats, addresses, recent orders, credit, block.
- **Components:** Customers table · Grade badge · Customer panel · Address list · Block toggle
- **Buttons and actions:** Add customer · Call / WhatsApp · Block · View orders · Export
- **Navigation:** → Retrieve (their bills), WhatsApp
- **Empty state:** Illustration, "No customers yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-20 — CRM insights
![CRM insights](previews/sw-20.png)
- **Purpose:** Who is slipping away, who is your best, what to send them.
- **Route / entry:** /crm
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/CrmInsightsPage.tsx`
- **Data shown:** customers (grade, order_frequency_days, avg_order_value, last_order_at, favorite_item_name), orders
- **Layout:** Segments row · retention chart · lists: top customers, at risk, birthdays.
- **Components:** Segment cards · Retention chart · Customer lists · Message action
- **Buttons and actions:** Open segment · Send WhatsApp offer · Export list
- **Navigation:** → Promo codes, WhatsApp
- **Empty state:** Illustration, "No crm insights yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-21 — Riders management
![Riders management](previews/sw-21.png)
- **Purpose:** Know who is on shift, where they are, and how they perform.
- **Route / entry:** /riders · /live-riders
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/RidersListPage.tsx, LiveRidersMapPage.tsx`
- **Data shown:** user_profiles (role = rider), orders (rider_id, delivery_status), staff_locations (lat, lng, recorded_at), portal_my_history (delivered, earnings)
- **Layout:** Rider list with status, deliveries, earnings · live map with the selected rider and their order.
- **Components:** Rider table · Online dot · Live map · Performance numbers
- **Buttons and actions:** Add rider · Assign order · Call · See history
- **Navigation:** → Delivery board
- **Empty state:** Illustration, "No riders management yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Location shows only while the rider has the app open and has allowed it; a stale location is labelled with its age.

## SW-22 — Staff & users
![Staff & users](previews/sw-22.png)
- **Purpose:** Create staff accounts and decide what each can open and do.
- **Route / entry:** /users
- **Roles:** admin
- **Status:** Exists in the software — evidence: `src/pages/StaffManagementPage.tsx (Users)`
- **Data shown:** user_profiles (username, display_name, role, permissions, feature_permissions, branch_id, all_branches, is_active, must_change_password)
- **Layout:** Users table with role and branch · panel: details, role, module permissions summary, PIN reset.
- **Components:** Users table · Role badge · Branch select · Permission summary · Reset PIN / password
- **Buttons and actions:** Add user · Change role · Deactivate · Reset password
- **Navigation:** → Permissions (SW-31)
- **Empty state:** Illustration, "No staff & users yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Roles in the software: admin, manager, cashier, rider, order taker.

## SW-23 — HR — employees & payroll
![HR — employees & payroll](previews/sw-23.png)
- **Purpose:** Employee records, attendance, advances and payslips in one place.
- **Route / entry:** /hr
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/HRPage.tsx`
- **Data shown:** employees (emp_code, name, designation, department, joining_date, basic_salary, allowances, status, photo_path), attendance, leaves, advances, payslips
- **Layout:** Tabs Employees · Attendance · Advances · Payslips · employee table with salary.
- **Components:** Tabs · Employee table · Attendance grid · Payslip preview
- **Buttons and actions:** Add employee · Mark attendance · Give advance · Generate payslip
- **Navigation:** → Daily wages
- **Empty state:** Illustration, "No hr — employees & payroll yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Salary figures are visible to admin and manager only; the permission review in the audit (S2) recommends restricting HR data by role in the database too.

## SW-24 — Shift & cash drawer · Day close
![Shift & cash drawer · Day close](previews/sw-24.png)
- **Purpose:** Open a shift with float, count the drawer at the end, see the variance; close the business day without losing history (archive, never delete).
- **Route / entry:** /shifts · Day Close
- **Roles:** admin, manager, cashier (close: admin)
- **Status:** Exists in the software — evidence: `src/pages/ShiftPage.tsx, DayClosePage`
- **Data shown:** shifts (opened_by, starting_cash, expected_cash, ending_cash, variance, status), cash_movements, day_closes (business_date, totals, backup_path)
- **Layout:** Current shift card with expected vs counted · cash movements · day-close checklist with totals.
- **Components:** Shift card · Denomination counter · Variance badge · Cash in/out list · Day-close checklist
- **Buttons and actions:** Open shift · Cash in / out · Close shift · Close day · Print Z report
- **Navigation:** → Reports
- **Empty state:** Illustration, "No shift & cash drawer · day close yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** If bills are still running or unpaid the Close-day button explains what blocks it and links to those bills.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-25 — Accounts & expenses
![Accounts & expenses](previews/sw-25.png)
- **Purpose:** Record money going out (expenses, wages) and money moving between accounts; see where it went.
- **Route / entry:** /accounts · /daily-wages
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/AccountsPage.tsx, DailyWagesPage.tsx`
- **Data shown:** account_categories, payment_accounts (name, type, account_number), ledger_entries, daily wages
- **Layout:** KPI strip · expense table with category · spend-by-category donut · add-expense drawer.
- **Components:** KPI cards · Expenses table · Category donut · Add expense form
- **Buttons and actions:** Add expense · Add category · Pay wages · Export
- **Navigation:** → Financial reports
- **Empty state:** Illustration, "No accounts & expenses yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-26 — Sales reports
![Sales reports](previews/sw-26.png)
- **Purpose:** Answer "how did we do?" for any period, and export it.
- **Route / entry:** /reports-center · /reports
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/ReportsCenterPage.tsx, ReportsPage.tsx, ItemSalesReportPage.tsx`
- **Data shown:** orders, order_items (by day, hour, item, category, payment method, order type, branch, staff)
- **Layout:** Left: report list by group. Right: filters (period, branch, type) · summary KPIs · chart · detail table · export.
- **Components:** Report list · Filter bar · KPI row · Chart · Detail table · Export menu
- **Buttons and actions:** Change filters · Switch report · Export CSV / PDF · Print
- **Navigation:** → Item sales, advanced variants, bill / KOT edit history
- **Empty state:** Illustration, "No sales reports yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-27 — Financial reports
![Financial reports](previews/sw-27.png)
- **Purpose:** Profit, not just sales: revenue minus food cost minus expenses, per item and per period.
- **Route / entry:** /profitability · /costing
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/ProfitabilityPage.tsx, CostingReportsPage.tsx`
- **Data shown:** orders (net_of_tax, tax, discount), order_items cost via recipes + inventory_items.avg_cost_price, ledger_entries / expenses
- **Layout:** P&L summary · margin by item table · cost-vs-price chart.
- **Components:** P&L card · Margin table · Cost chart · Period selector
- **Buttons and actions:** Change period · Open item costing · Export
- **Navigation:** → Recipes, Accounts
- **Empty state:** Illustration, "No financial reports yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Food cost needs recipes: an item without a recipe shows "no cost data" rather than a made-up margin.

## SW-28 — Business settings
![Business settings](previews/sw-28.png)
- **Purpose:** Everything the business configures once: identity, tax, service charge, receipts, ordering channels, appearance.
- **Route / entry:** /settings
- **Roles:** admin
- **Status:** Exists in the software — evidence: `src/pages/SettingsPage.tsx`
- **Data shown:** tenant_settings (name, address, currency, tax mode / percent / label, service charge, receipt options, order-source modes, discount rules), branches (invoice_prefix, invoice_footer, tax_number)
- **Layout:** Left: settings groups. Right: the selected group as cards of fields and switches; sticky Save bar.
- **Components:** Group list · Field rows · Switches · Theme picker · Sticky save bar
- **Buttons and actions:** Edit · Save · Reset to default
- **Navigation:** → Printing Center, Branches, Theme
- **Empty state:** Fields show placeholders; required fields are marked; Save is disabled until valid.
- **Loading state:** Save shows a spinner and locks the form; fields keep their values.
- **Error state:** Field errors under the field (red border + message); a summary banner if the save itself failed.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-29 — Printing center
![Printing center](previews/sw-29.png)
- **Purpose:** Assign printers to roles, set paper and quality, and prove they work before the rush.
- **Route / entry:** /printing-center
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/PrintingCenterPage.tsx, PrinterSettingsPage.tsx (offline edition)`
- **Data shown:** printer settings per role (cashier receipt, each kitchen printer_role), paper 58 / 80 mm, copies, quality, margins; print_jobs
- **Layout:** Printer roles on the left with status; selected printer settings and a live test-slip preview on the right.
- **Components:** Printer role cards · Status dot · Paper switch · Copies stepper · Test print · Slip preview
- **Buttons and actions:** Choose printer · Test print · Set copies · Save
- **Navigation:** → KOT history, Receipt design
- **Empty state:** Illustration, "No printing center yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Printer offline: red status with the last error and a Retry; bills still save and queue the print.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-30 — Receipt & invoice design
![Receipt & invoice design](previews/sw-30.png)
- **Purpose:** One consistent look for the customer receipt (58 / 80 mm) and the A4 invoice, in the restaurant's identity.
- **Route / entry:** Printing center → Templates
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/components/premiumReceiptTemplates, BranchInvoicePreview.tsx`
- **Data shown:** order, branch (invoice_prefix, invoice_footer, tax_number, registration_number), tenant branding; PRA invoice number when enabled
- **Layout:** Template picker · editable fields · live previews side by side: 80 mm receipt and A4 invoice.
- **Components:** Template cards · Field toggles · 80 mm preview · A4 preview
- **Buttons and actions:** Pick template · Toggle fields · Upload logo · Print test
- **Navigation:** → Printing Center
- **Empty state:** Illustration, "No receipt & invoice design yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-31 — User permissions
![User permissions](previews/sw-31.png)
- **Purpose:** Decide, per role and per person, which modules and which sensitive actions are allowed.
- **Route / entry:** /module-management · Users
- **Roles:** admin
- **Status:** Exists in the software — evidence: `src/lib/permissions.ts, src/pages/ModuleManagementPage.tsx`
- **Data shown:** user_profiles.permissions (module keys), feature_permissions; role defaults in src/lib/permissions.ts
- **Layout:** Role × module matrix with switches; a column per role; feature permissions (discount, void, price edit, reprint) below.
- **Components:** Matrix · Switches · Role headers · Feature permissions list · Override badge
- **Buttons and actions:** Toggle · Reset to role default · Save
- **Navigation:** → Users
- **Empty state:** Fields show placeholders; required fields are marked; Save is disabled until valid.
- **Loading state:** Save shows a spinner and locks the form; fields keep their values.
- **Error state:** Field errors under the field (red border + message); a summary banner if the save itself failed.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** The matrix shows the defaults in the code (admin, manager, cashier, rider, order taker). A per-user override is marked with a dot.

## SW-32 — System configuration
![System configuration](previews/sw-32.png)
- **Purpose:** Branches, the devices signed in to the workspace, backups, integrity checks and the installed version.
- **Route / entry:** /branches · /devices · /backup · /data-integrity · /version
- **Roles:** admin
- **Status:** Exists in the software — evidence: `src/pages/BranchesPage.tsx, DevicesPage.tsx, BackupRestorePage.tsx, DataIntegrityPage.tsx, version`
- **Data shown:** branches (name, address, lat/lng, service_radius_km, is_active, invoice_prefix), devices (hardware_id, approved, blocked, last_seen_at, is_kds), backups, data-integrity checks, app version
- **Layout:** Tabs Branches · Devices · Backup · Data integrity · Version; each tab a table or status cards.
- **Components:** Tabs · Branches table · Devices table with approve / block · Backup status · Integrity checks list · Version card
- **Buttons and actions:** Add branch · Approve / block device · Back up now · Run integrity check · Check for update
- **Navigation:** → Super Admin (device limits)
- **Empty state:** Illustration, "No system configuration yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-33 — Credits / Udhaar
![Credits / Udhaar](previews/sw-33.png)
- **Purpose:** Sell on credit and collect later, with a clear ledger per customer.
- **Route / entry:** /credits · /credit-customers
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/CreditsPage.tsx, CreditCustomersPage.tsx`
- **Data shown:** orders (status credit_pending / credit_received), customers.credit_balance, credit_payments (amount, method, received_at)
- **Layout:** Customers who owe, sorted by amount · ledger and a Receive payment action.
- **Components:** Owing table · Ledger · Receive payment dialog
- **Buttons and actions:** Receive payment · Print statement · Block customer
- **Navigation:** → Retrieve
- **Empty state:** Illustration, "No credits / udhaar yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-34 — Promo codes
![Promo codes](previews/sw-34.png)
- **Purpose:** Create and track discount codes that work at the till and on the website / app.
- **Route / entry:** /promo-codes
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/PromoCodesPage.tsx`
- **Data shown:** promo_codes (code, discount_type, discount_value, max_uses, used_count, valid_from, valid_until, is_active)
- **Layout:** Codes table with usage bars · create-code drawer.
- **Components:** Codes table · Usage bar · Validity chips · Create drawer
- **Buttons and actions:** New code · Enable / disable · Copy code
- **Navigation:** → Website offers
- **Empty state:** Illustration, "No promo codes yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-35 — Customer website & app settings
![Customer website & app settings](previews/sw-35.png)
- **Purpose:** Switch the website and the customer app on, brand them, and choose how orders arrive (auto-accept or approval).
- **Route / entry:** /online-portal
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/OnlinePortalPage.tsx, src/components/CustomerAppsManager.tsx`
- **Data shown:** customer_apps (enabled, app_name, logo_url, theme, whatsapp_number, features, min_supported_version), tenant_settings (order-source modes, delivery fee, minimum order), branches (service_radius_km)
- **Layout:** Channel cards (Website, Customer app, QR, Order taker) · branding · delivery rules · link and QR to share.
- **Components:** Channel cards · Logo / colour fields · Delivery fee + minimum order · Share link + QR
- **Buttons and actions:** Enable channel · Upload logo · Set delivery rules · Copy link
- **Navigation:** → Online order approval; the website itself (03)
- **Empty state:** Fields show placeholders; required fields are marked; Save is disabled until valid.
- **Loading state:** Save shows a spinner and locks the form; fields keep their values.
- **Error state:** Field errors under the field (red border + message); a summary banner if the save itself failed.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Hero banners, opening hours and social links are NOT in the data model today — they are the first additions in the website plan (see 09-handoff).

## SW-36 — Tokens
![Tokens](previews/sw-36.png)
- **Purpose:** Counter-service restaurants: token number per sale and a call-out board.
- **Route / entry:** /tokens
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/TokensPage.tsx`
- **Data shown:** orders (is_token_sale, token_number, token_label, token_status, token_completed_at, token_reprint_count), token_counters
- **Layout:** Active tokens as large numbers by status · history table.
- **Components:** Token tile · Status chips · Call button
- **Buttons and actions:** Call token · Complete · Reprint
- **Navigation:** → POS
- **Empty state:** Illustration, "No tokens yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-37 — PRA EIMS (fiscal invoicing)
![PRA EIMS (fiscal invoicing)](previews/sw-37.png)
- **Purpose:** For restaurants registered with PRA: enable fiscal invoicing, see each bill's status and fix failures.
- **Route / entry:** /pra-eims
- **Roles:** admin
- **Status:** Exists in the software — evidence: `src/pages/PraEimsSettingsPage.tsx`
- **Data shown:** orders (pra_status, pra_invoice_number, pra_submitted_at, pra_error), PRA settings
- **Layout:** Status cards (submitted, pending, failed) · settings · failures table with Retry.
- **Components:** Status cards · Settings form · Failures table
- **Buttons and actions:** Enable · Retry submission · View error
- **Navigation:** → Retrieve
- **Empty state:** Illustration, "No pra eims (fiscal invoicing) yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Off by default. The submission contract has not been verified against the official specification and needs the restaurant's own credentials — see the audit (PRA section).

## SW-38 — Foodpanda orders
![Foodpanda orders](previews/sw-38.png)
- **Purpose:** Orders keyed in from the Foodpanda tablet, tracked through New · Preparing · Ready · Picked · Cancelled.
- **Route / entry:** /foodpanda-orders
- **Roles:** admin, manager, cashier
- **Status:** Exists in the software — evidence: `src/pages/FoodpandaOrdersPage.tsx`
- **Data shown:** orders (order_type = foodpanda, foodpanda_status, foodpanda_ref, foodpanda_status_at)
- **Layout:** Status columns with reference numbers.
- **Components:** Status columns · Reference chip · Advance button
- **Buttons and actions:** New order · Advance status
- **Navigation:** → Kitchen
- **Empty state:** Illustration, "No foodpanda orders yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.

## SW-39 — Staff audit log
![Staff audit log](previews/sw-39.png)
- **Purpose:** Who did what, when, on which bill — especially voids, discounts and price changes.
- **Route / entry:** /staff-audit
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/StaffAuditLogPage.tsx`
- **Data shown:** staff_audit_logs (user_name, user_role, action, order_number, amount, reason, approved_by, device_name, created_at)
- **Layout:** Timeline table with filters by user, action and date; reason shown inline.
- **Components:** Filters · Audit table · Action badges
- **Buttons and actions:** Filter · Export
- **Navigation:** → Retrieve (the bill)
- **Empty state:** Illustration, "No staff audit log yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
- **Note:** Branch isolation of audit logs is an open item in the security findings (S4).

## SW-40 — Void, complimentary & cancel
![Void, complimentary & cancel](previews/sw-40.png)
- **Purpose:** Controlled exits from a bill, always with a reason and a name.
- **Route / entry:** /void-bills
- **Roles:** admin, manager
- **Status:** Exists in the software — evidence: `src/pages/ (Void / Comp / Cancel)`
- **Data shown:** orders (status void / complimentary / cancelled, void_reason, void_by, voided_at, complimentary_reason, cancel_reason)
- **Layout:** List of voided / comped / cancelled bills with reason · action dialog that requires a reason.
- **Components:** Bills table · Reason select · Manager approval
- **Buttons and actions:** Void · Mark complimentary · Cancel
- **Navigation:** → Audit log
- **Empty state:** Illustration, "No void, complimentary & cancel yet" and the primary action; filters stay visible.
- **Loading state:** Skeleton rows (6) in the table; toolbar and filters are interactive.
- **Error state:** Inline banner above the table with the reason and Retry; the last loaded rows stay visible.
- **Responsive:** Desktop 1440 as drawn; at 1024 the sidebar collapses to icons; below 900 the toolbar wraps and tables scroll horizontally.
