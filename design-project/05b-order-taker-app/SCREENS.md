# Order Taker mobile app (Android) — screen inventory
14 screens. Preview PNGs: `previews/<id>.png`; full-size HTML: `screens/<id>.html`. Sample content only — no figure on any screen is real data.
| Status | Meaning |
|---|---|
| Exists in the software | the module / feature is in the code today; this is a redesign of it |
| New UI on existing data | a new screen, but every field comes from tables/RPCs that exist |
| Needs backend work | the design is ready, the backend cannot do it yet (named in the screen) |

## OTK-01 — Splash
![Splash](previews/otk-01.png)
- **Purpose:** Open on the Order Taker teal with the DT mark and clipboard badge, then go straight to the POS if the session is still valid.
- **Route / entry:** app launch
- **Roles:** order_taker
- **Status:** New UI on existing data — evidence: `branding/ (Order Taker icon: DT mark + clipboard badge)`
- **Data shown:** none (saved portal session read locally)
- **Layout:** Full-bleed teal · mark with role badge · "DT Order Taker" · powered-by line.
- **Components:** Animated DT mark · Role badge
- **Buttons and actions:** None
- **Navigation:** → Sign in or POS
- **Empty state:** n/a
- **Loading state:** This screen is the loading state (max 2 s).
- **Error state:** Session rejected: Sign in with "Please sign in again".
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.

## OTK-02 — Sign in
![Sign in](previews/otk-02.png)
- **Purpose:** Sign in with the account the restaurant created; one app serves every restaurant — the workspace code says which when needed.
- **Route / entry:** #/order-taker (public)
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/pages/OrderTakerPortalPage.tsx`
- **Data shown:** username or phone + PIN/password + workspace code → portalSignIn(expectedRole: order_taker)
- **Layout:** Icon · title · username/phone · PIN · workspace code · Sign in.
- **Components:** Text fields · PIN field · Workspace code field · Primary button
- **Buttons and actions:** Sign in
- **Navigation:** → POS
- **Empty state:** Placeholders "03xx-xxxxxxx", "••••", "ABC123".
- **Loading state:** "Signing in…", fields locked.
- **Error state:** Wrong details: banner with the server's message; lock-out messages come from the server unchanged.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** Same behaviour as the Rider sign-in: the workspace code is required only when the username exists in more than one restaurant.

## OTK-03 — POS — take an order
![POS — take an order](previews/otk-03.png)
- **Purpose:** Add items fast with one thumb: a category ribbon with a 4-box button for all categories, big item cards, a cart bar at the foot.
- **Route / entry:** tab: POS
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/pages/OrderTakerPortalPage.tsx (renders POSScreen)`
- **Data shown:** menu_items, categories (same data and component as the cashier POS)
- **Layout:** Top bar (restaurant, location sharing, exit) · search · category ribbon with the 4-box button · item grid · cart bar · tab bar.
- **Components:** Top bar · Search · Category ribbon + grid button · Item card · Cart bar · Tab bar
- **Buttons and actions:** Search · Pick category · Open all categories · Add item · Open cart
- **Navigation:** → Item options, Cart, Tables, Bills, Me
- **Empty state:** "No items in this category".
- **Loading state:** Item skeletons.
- **Error state:** Offline banner; the menu stays from the last load.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** The POS is the same screen as the cashier's, so a change to it (the category grid, v1.75.0) reaches this app too. Location sharing tells the manager where the order taker is (existing toggle).

## OTK-04 — All categories
![All categories](previews/otk-04.png)
- **Purpose:** Every category at once — no sideways scrolling — with its picture or icon and how many items it holds.
- **Route / entry:** POS → 4-box button
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/components/pos/CategoryGridDialog.tsx (v1.75.0, ported from the offline POS v1.21.0)`
- **Data shown:** categories with active-item counts
- **Layout:** Dialog · "All items" + one box per category · the current one marked · picking one closes the dialog and shows its items.
- **Components:** Dialog · Category box (icon / picture, full name, count)
- **Buttons and actions:** Pick a category · Close
- **Navigation:** Back to the POS filtered to that category
- **Empty state:** "No categories yet".
- **Loading state:** n/a (local)
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** Long names wrap, never truncate. Uses the shop's category font (Urdu fonts included).

## OTK-05 — Item options
![Item options](previews/otk-05.png)
- **Purpose:** Pick the size or flavour without leaving the list, then add.
- **Route / entry:** POS → item with sizes / flavours
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `POSScreen variant picker, weight panel`
- **Data shown:** menu_items size_variants / inch_variants / flavors; kg items use the weight panel
- **Layout:** Bottom sheet · item name · size radios · flavour chips · note · quantity + Add.
- **Components:** Bottom sheet · Radios · Flavour chips · Note field · Stepper · Add button
- **Buttons and actions:** Pick size · Pick flavour · Add note · Add
- **Navigation:** Back to the POS
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** n/a
- **Error state:** A variant that became unavailable is greyed with "Sold out".
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.

## OTK-06 — Tables
![Tables](previews/otk-06.png)
- **Purpose:** Pick the table to take an order for, and see at a glance which are free.
- **Route / entry:** tab: Tables
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/pages/OrderTakerPortalPage.tsx (TablesPage)`
- **Data shown:** dining tables and floors (portal_tables): free / occupied / needs bill, running order per table
- **Layout:** Floor tabs · table grid with state colour and amount · legend.
- **Components:** Floor tabs · Table tile · Legend
- **Buttons and actions:** Pick floor · Open table · Start order on a free table
- **Navigation:** → POS for that table
- **Empty state:** "No tables set up — ask your manager".
- **Loading state:** Tile skeletons.
- **Error state:** Retry banner; last state stays.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** A table legend with reservations is not in the system (reservations do not exist).

## OTK-07 — Order review and send
![Order review and send](previews/otk-07.png)
- **Purpose:** Check the order once, then send it to the kitchen.
- **Route / entry:** POS → View order
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `portal_upsert_order (taker/rider write path), AutoKotPrinter`
- **Data shown:** cart lines, table, notes → order saved through portal_upsert_order, KOT to the kitchen
- **Layout:** Table badge · item lines with steppers and notes · totals · sticky "Send to kitchen".
- **Components:** Table badge · Cart line · Totals · Send button
- **Buttons and actions:** Change quantity · Add note · Change table · Send to kitchen
- **Navigation:** → Bills
- **Empty state:** "Nothing added yet".
- **Loading state:** Send shows a spinner.
- **Error state:** Send fails: "Not sent — it is saved on this phone and will go when you are back online", never lost.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** Whether an order taker may also take payment is decided by the role permissions (NOT VERIFIED for this role); this screen shows only "Send to kitchen".

## OTK-08 — Running bills
![Running bills](previews/otk-08.png)
- **Purpose:** See the open bills — which table, how much, how long — and add to one.
- **Route / entry:** tab: Bills
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/pages/OrderTakerPortalPage.tsx (RunningBillsPage)`
- **Data shown:** running orders for this restaurant / branch (RunningBillsPage)
- **Layout:** Search · bill rows with table, items count, amount, age · tap to open.
- **Components:** Search · Bill row · Status badge
- **Buttons and actions:** Open a bill · Add items
- **Navigation:** → Bill detail / POS
- **Empty state:** "No open bills".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.

## OTK-09 — Bill detail
![Bill detail](previews/otk-09.png)
- **Purpose:** Check what a table has ordered and whether the kitchen has it.
- **Route / entry:** Bills → bill
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `RunningBillsPage`
- **Data shown:** order, items, status, kitchen status
- **Layout:** Table + status · item lines with kitchen state · totals · Add items.
- **Components:** Item line with kitchen badge · Totals · Add items button
- **Buttons and actions:** Add items · Call cashier (WhatsApp / phone)
- **Navigation:** → POS
- **Empty state:** n/a
- **Loading state:** Skeleton lines.
- **Error state:** Banner with Retry.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** Void, discount and payment stay with the cashier and manager (permission-checked).

## OTK-10 — Order ready alert
![Order ready alert](previews/otk-10.png)
- **Purpose:** Tell the order taker which table's food is ready: sound, vibration, banner.
- **Route / entry:** in-app, any screen
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/pages/OrderTakerPortalPage.tsx (ReadyNotificationBus, ReadyOrderPoller types=[dine-in])`
- **Data shown:** kitchen status = ready for dine-in orders (ReadyOrderPoller, ReadyNotificationBus)
- **Layout:** Top banner: table, order number, items ready · Got it.
- **Components:** Alert banner · Got it button
- **Buttons and actions:** Got it · Open bill
- **Navigation:** → Bill detail
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** Works only while the app is open — there is no push service (see HANDOFF gaps).

## OTK-11 — Customer calls the waiter
![Customer calls the waiter](previews/otk-11.png)
- **Purpose:** A customer at a table asked for service: show which table and what they wrote.
- **Route / entry:** in-app, any screen
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/pages/OrderTakerPortalPage.tsx (ServiceCallNotifier), publicPortal.functions.ts (createPublicWaiterCall)`
- **Data shown:** public_call_waiter (customer scans the table QR and taps "Call waiter") → ServiceCallNotifier
- **Layout:** Top banner: table, message, time · On my way.
- **Components:** Alert banner · On my way button
- **Buttons and actions:** On my way · Dismiss
- **Navigation:** → Tables
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** Also in-app only (no push).

## OTK-12 — Me
![Me](previews/otk-12.png)
- **Purpose:** Which restaurant this phone belongs to, the order taker's own details and picture, and the location-sharing switch.
- **Route / entry:** tab: Me
- **Roles:** order_taker
- **Status:** Exists in the software — evidence: `src/pages/OrderTakerPortalPage.tsx (OrderTakerMe, StaffProfileCard, PortalRestaurantBadge)`
- **Data shown:** portal_me (name, phone, photo), restaurant badge (name + code), location-sharing setting
- **Layout:** "You are taking orders for" card · profile card (photo, name, phone) · Share my location · Dark theme · Log out.
- **Components:** Restaurant badge · Profile card · Setting rows · Switch · Log out
- **Buttons and actions:** Edit name / phone / photo · Toggle location sharing · Log out (asks first)
- **Navigation:** —
- **Empty state:** n/a
- **Loading state:** Skeleton cards.
- **Error state:** Save fails: field error.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
- **Note:** The restaurant badge exists so nobody takes orders into the wrong restaurant (v1.43.0).

## OTK-13 — Empty, offline and error states
![Empty, offline and error states](previews/otk-13.png)
- **Purpose:** What the order taker sees with no tables, no connection, or an order that could not be sent.
- **Route / entry:** all screens
- **Roles:** order_taker
- **Status:** New UI on existing data — evidence: `src/pages/OrderTakerPortalPage.tsx`
- **Data shown:** —
- **Layout:** Offline banner · not-sent banner · empty bills.
- **Components:** Banner · Empty state · Retry
- **Buttons and actions:** Retry · Open Bills
- **Navigation:** —
- **Empty state:** This screen is the specification.
- **Loading state:** Skeleton rows.
- **Error state:** Banners as drawn.
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.

## OTK-14 — POS (dark)
![POS (dark)](previews/otk-14.png)
- **Purpose:** Dark theme for dim dining rooms.
- **Route / entry:** tab: POS — dark
- **Roles:** order_taker
- **Status:** New UI on existing data — evidence: `src/pages/OrderTakerPortalPage.tsx`
- **Data shown:** same as POS
- **Layout:** Same as POS.
- **Components:** Same as POS
- **Buttons and actions:** Same as POS
- **Navigation:** Same as POS
- **Empty state:** Same as POS
- **Loading state:** Same as POS
- **Error state:** Same as POS
- **Responsive:** Designed at 390 × 844 (Android phone). On a tablet the app is constrained to a 820 px column, as it is today, so it always feels like an app; the POS grid gains columns.
