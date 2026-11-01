# Customer mobile app — PARKED for later — screen inventory
> **Parked for later.** Not part of the current scope — customers order on the ordering website. Kept so a branded multi-restaurant customer app can be built later.
25 screens. Preview PNGs: `previews/<id>.png`; full-size HTML: `screens/<id>.html`. Sample content only — no figure on any screen is real data.
| Status | Meaning |
|---|---|
| Exists in the software | the module / feature is in the code today; this is a redesign of it |
| New UI on existing data | a new screen, but every field comes from tables/RPCs that exist |
| Needs backend work | the design is ready, the backend cannot do it yet (named in the screen) |

## APP-01 — Splash
![Splash](previews/app-01.png)
- **Purpose:** A calm first second: the restaurant's brand on the app colour while the menu loads in the background.
- **Route / entry:** app launch (native splash → web view)
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `branding/ (Customer icon family), scripts/brand/build-brand-assets.mjs`
- **Data shown:** customer_apps (app_name, logo_url, theme) — cached from the last launch
- **Layout:** Full-bleed brand colour · centred mark (draws in, 600 ms) · restaurant name · tiny "Powered by Digital Target" at the foot.
- **Components:** Animated DT mark · Restaurant name · Powered-by line
- **Buttons and actions:** None — advances on its own when the menu is ready (max 2.5 s, then shows the cached menu)
- **Navigation:** → Onboarding (first launch) or Home
- **Empty state:** n/a
- **Loading state:** This screen IS the loading state; a thin progress line appears only after 1.5 s.
- **Error state:** If the menu cannot load, continue to Home with the cached menu and the offline banner.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Android 12+ shows the system splash first; the colour and icon are set in the Android resources (windowSplashScreenBackground) so there is no white flash. Reduced-motion: the mark is simply shown.

## APP-02 — Onboarding
![Onboarding](previews/app-02.png)
- **Purpose:** Three short slides that tell a new customer what the app does and ask for location only when it is useful.
- **Route / entry:** first launch only
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** static text; restaurant name
- **Layout:** Illustration · title · one sentence · page dots · Next / Skip.
- **Components:** Illustration slot · Page dots · Primary button · Skip link
- **Buttons and actions:** Next · Skip · Allow location (optional, last slide)
- **Navigation:** → Sign in / Continue as guest
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** Location denied: continue with a typed address — no dead end.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Skippable at any point; shown once (flag in local storage).

## APP-03 — Sign in
![Sign in](previews/app-03.png)
- **Purpose:** Let a returning customer see their orders and saved addresses; never block a first order.
- **Route / entry:** Profile → Sign in, or at checkout
- **Roles:** customer
- **Status:** Needs backend work — evidence: `public_place_order (guest checkout exists); sign-in code = needs-backend`
- **Data shown:** customers (phone, name) — a customer record is created from the phone number at first order
- **Layout:** Brand header · phone field · Send code · "Continue as guest" · terms line.
- **Components:** Phone field (+92) · Primary button · Secondary button · Terms link
- **Buttons and actions:** Send code · Continue as guest
- **Navigation:** → Verify code, or back to where the customer was
- **Empty state:** n/a
- **Loading state:** Send code shows a spinner; field locked.
- **Error state:** Invalid number: inline "Enter a valid mobile number (03XX XXXXXXX)".
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Today the website identifies a customer by phone number at checkout and has no SMS/OTP channel. The code step is designed but needs an SMS/WhatsApp provider (see handoff). Until then this screen is "enter your phone + name" and the guest path.

## APP-04 — Verify code
![Verify code](previews/app-04.png)
- **Purpose:** Confirm the phone number with a six-digit code.
- **Route / entry:** after Send code
- **Roles:** customer
- **Status:** Needs backend work — evidence: `none today`
- **Data shown:** one-time code (6 digits)
- **Layout:** Back · title · six boxes · resend timer · Verify.
- **Components:** OTP boxes · Resend timer · Primary button
- **Buttons and actions:** Enter code · Resend after 30 s · Change number
- **Navigation:** → Home / back to checkout
- **Empty state:** n/a
- **Loading state:** Verify shows a spinner.
- **Error state:** Wrong code: boxes shake once, "That code is not right. 2 tries left".
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Needs an SMS or WhatsApp sending service and a short-lived code table. Not built; the design reserves the screen so it can be switched on without a redesign.

## APP-05 — Home
![Home](previews/app-05.png)
- **Purpose:** The shortest path from opening the app to a full cart: where to, what to eat, what is on offer.
- **Route / entry:** tab: Home
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** branches (open now?), categories, menu_items (popular = most ordered, needs order counts), promo_codes, customer_apps
- **Layout:** Location bar · search · delivery/pickup switch · offer banner · categories (horizontal) · popular · "order again" shortcut · bottom tabs.
- **Components:** Location bar · Search field · Mode switch · Banner · Category tiles · Item cards · Bottom tab bar · Cart pill
- **Buttons and actions:** Change location · Search · Choose mode · Open category · Add item · Reorder last
- **Navigation:** → Menu, Product, Cart, Offers, Notifications
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** "Popular" is computed from past orders per tenant; until enough orders exist it shows the first items of each category. Banner is a placeholder slot (banners are not stored yet).

## APP-06 — Menu and categories
![Menu and categories](previews/app-06.png)
- **Purpose:** Browse the whole menu quickly: jump between categories, add without leaving the list.
- **Route / entry:** tab: Menu
- **Roles:** customer
- **Status:** Exists in the software — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** categories (sort_order, icon/image), menu_items (name, price, image, is_active, size/inch variants)
- **Layout:** Search · category chips (sticky) · item rows grouped by category · cart pill.
- **Components:** Search · Category chips · Item row · Sticky cart pill
- **Buttons and actions:** Pick category · Add / change quantity · Open item
- **Navigation:** → Product, Cart
- **Empty state:** "Nothing in this category right now" + other categories.
- **Loading state:** Row skeletons.
- **Error state:** Retry banner; cached menu stays.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.

## APP-07 — Search
![Search](previews/app-07.png)
- **Purpose:** Find a dish by typing a few letters.
- **Route / entry:** Home → search field
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** menu_items name, sub_category
- **Layout:** Search field with cancel · recent searches · results as item rows.
- **Components:** Search field · Recent chips · Item row
- **Buttons and actions:** Type · Clear · Open result · Add
- **Navigation:** → Product
- **Empty state:** "No dish called "pasta"" + suggested categories.
- **Loading state:** Skeleton rows after 300 ms of typing.
- **Error state:** Searching is done on the cached menu, so it works offline.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.

## APP-08 — Product details
![Product details](previews/app-08.png)
- **Purpose:** Show the dish large, then let the customer pick size and extras and add to cart in one place.
- **Route / entry:** Menu → item
- **Roles:** customer
- **Status:** Exists in the software — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** menu_items (name, description, price, image, size_variants, inch_variants, flavors)
- **Layout:** Hero image with back/share · name and price · description · size list · extras checklist · notes · sticky quantity + Add.
- **Components:** Hero image · Size radios · Extras checklist · Notes field · Quantity stepper · Add to cart
- **Buttons and actions:** Choose size · Toggle extras · Quantity ± · Add to cart
- **Navigation:** → Cart
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Add-on groups with their own prices are not in the data model today; extras here are flavours and variants. Allergens are not stored (no allergen row is shown).

## APP-09 — Customisation sheet
![Customisation sheet](previews/app-09.png)
- **Purpose:** Choose the option without leaving the list (fast path for items with only a size or flavour).
- **Route / entry:** Menu → add on an item with options
- **Roles:** customer
- **Status:** Exists in the software — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** menu_items size_variants / flavors
- **Layout:** Bottom sheet · name · size radios · flavour chips · Add button.
- **Components:** Bottom sheet · Radios · Flavour chips · Add button
- **Buttons and actions:** Pick size · Pick flavour · Add
- **Navigation:** Closes back to the list
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** n/a
- **Error state:** If a variant became unavailable, it is greyed with "Sold out".
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.

## APP-10 — Cart
![Cart](previews/app-10.png)
- **Purpose:** Review, adjust, apply a code and see exactly what will be charged.
- **Route / entry:** cart pill / Orders tab
- **Roles:** customer
- **Status:** Exists in the software — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** local cart; promo_codes (code, value, min order, valid dates); branch delivery fee
- **Layout:** Item lines with steppers · promo field · totals · sticky Checkout.
- **Components:** Cart line · Stepper · Promo field · Totals · Checkout button
- **Buttons and actions:** Change quantity · Remove · Apply code · Checkout
- **Navigation:** → Checkout
- **Empty state:** Bag illustration, "Your cart is empty", Browse the menu.
- **Loading state:** n/a (local)
- **Error state:** Item no longer available: row greyed with "Remove"; checkout disabled until removed.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.

## APP-11 — Checkout
![Checkout](previews/app-11.png)
- **Purpose:** Confirm who, where and how to pay, then place the order.
- **Route / entry:** Cart → Checkout
- **Roles:** customer
- **Status:** Exists in the software — evidence: `public_place_order`
- **Data shown:** customer name, phone, address, branch, payment method, notes → RPC public_place_order
- **Layout:** Mode switch · details · address card · payment · notes · totals · sticky Place order.
- **Components:** Mode switch · Fields · Address card · Payment radios · Place order
- **Buttons and actions:** Edit details · Change address / branch · Place order
- **Navigation:** → Order placed
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Place order fails: banner "We could not send your order. Nothing was charged — try again", cart kept.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Payment is cash on delivery or pay at pickup. There is no online payment gateway today; "Pay online" is shown disabled, as in the website.

## APP-12 — Address book and map
![Address book and map](previews/app-12.png)
- **Purpose:** Pick or add a delivery address and see at once whether the restaurant delivers there.
- **Route / entry:** Checkout → Change / Profile → Addresses
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `customers / customer_addresses (verify), branch geo fields`
- **Data shown:** customer addresses (label, text, landmark, lat/lng); branches.delivery_radius_km, delivery zone
- **Layout:** Map with pin and locate-me · "we deliver here" banner · saved address cards · landmark · Confirm.
- **Components:** Map · Locate-me button · Coverage banner · Address cards · Landmark field
- **Buttons and actions:** Move pin · Use my location · Select / edit / delete address · Confirm
- **Navigation:** Back to Checkout
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Outside the area: banner "Sorry, we do not deliver here — try pickup", Confirm disabled.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** The map uses the device map SDK; the grey area here stands in for it. Coverage check uses the branch radius if the branch has one set; otherwise the banner is hidden.

## APP-13 — Order placed
![Order placed](previews/app-13.png)
- **Purpose:** Reassure: the order reached the restaurant, here is the number and what happens next.
- **Route / entry:** after Place order
- **Roles:** customer
- **Status:** Exists in the software — evidence: `public_place_order result`
- **Data shown:** orders (order_number, status, total, payment), estimated time (branch setting)
- **Layout:** Success mark · number · "waiting for the restaurant to confirm" · estimate · Track / Share / Back to menu.
- **Components:** Success mark · Summary card · Track button
- **Buttons and actions:** Track order · Share tracking link · Back to menu
- **Navigation:** → Live tracking
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** A new online order is pending until staff approve it (pending_approval → accepted). The copy says so; it never says "confirmed" before the restaurant has.

## APP-14 — Live order tracking
![Live order tracking](previews/app-14.png)
- **Purpose:** Answer "where is my food" without a phone call.
- **Route / entry:** Orders → active order / tracking link
- **Roles:** customer
- **Status:** Exists in the software — evidence: `track_order, delivery_status values`
- **Data shown:** RPC track_order (status, delivery_status, rider name/phone, estimate), Realtime on the order row
- **Layout:** ETA card · map with rider · rider card with call · step list from the real statuses · help.
- **Components:** ETA card · Map · Rider card · Status steps · Call button
- **Buttons and actions:** Call rider · Share link · Help
- **Navigation:** → Support
- **Empty state:** n/a
- **Loading state:** Skeleton ETA + steps.
- **Error state:** Offline: "Showing the last update at 12:41" with Retry.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** The rider's live position needs the rider app to send GPS; the table for it exists (audit/GPS log) — if no position is available the map shows the branch and address only, and the steps carry the story.

## APP-15 — Order history
![Order history](previews/app-15.png)
- **Purpose:** Find a past order and reorder it in two taps.
- **Route / entry:** tab: Orders
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `track_order / orders by customer phone`
- **Data shown:** orders by phone number: order_number, date, total, status
- **Layout:** Active order card on top · past orders with status, total, Reorder, Details.
- **Components:** Active order card · Order row · Status badge · Reorder button
- **Buttons and actions:** Track · Reorder · Details
- **Navigation:** → Tracking, Order detail, Cart
- **Empty state:** "No orders yet" + Browse the menu.
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Listing a customer's past orders needs a server function that returns them for a verified phone number (guest orders are reachable only through their tracking link today).

## APP-16 — Order detail and reorder
![Order detail and reorder](previews/app-16.png)
- **Purpose:** The receipt of a past order, with a one-tap reorder that refills the cart.
- **Route / entry:** Orders → Details
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `track_order`
- **Data shown:** orders + order_items, totals, payment, address, branch
- **Layout:** Status + date · item list · totals · address · branch · Reorder / Get help.
- **Components:** Item list · Totals · Reorder button · Help link
- **Buttons and actions:** Reorder (adds the items that are still on the menu) · Get help
- **Navigation:** → Cart, Support
- **Empty state:** n/a
- **Loading state:** Skeleton blocks.
- **Error state:** Banner with Retry.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Reorder skips items that are no longer on the menu and says which ones.

## APP-17 — Profile
![Profile](previews/app-17.png)
- **Purpose:** Keep personal details and addresses up to date.
- **Route / entry:** tab: Profile
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `customers table`
- **Data shown:** customers (name, phone, email, birthday), addresses
- **Layout:** Avatar + name · details form · saved addresses · language · sign out.
- **Components:** Avatar · Form fields · Address cards · Language row · Sign out
- **Buttons and actions:** Edit details · Add / edit address · Sign out
- **Navigation:** → Address book, Support
- **Empty state:** Guest: "Sign in to save your details" card replaces the form.
- **Loading state:** Skeleton fields.
- **Error state:** Save fails: field error + banner.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Loyalty points exist in the database but are not used online; no points card is drawn.

## APP-18 — Notifications
![Notifications](previews/app-18.png)
- **Purpose:** Order updates and offers in one list.
- **Route / entry:** Home → bell
- **Roles:** customer
- **Status:** Needs backend work — evidence: `none — no push channel today`
- **Data shown:** notifications (order updates, offers)
- **Layout:** Today / earlier groups · icon, title, one line, time · unread dot.
- **Components:** Notification row · Unread dot · Group headers
- **Buttons and actions:** Open the related order / offer · Mark all read
- **Navigation:** → Tracking, Offers
- **Empty state:** "You are all caught up".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** There is no push service (FCM) and no notifications table today. This screen is designed for when they exist. Until then, order updates are visible only by opening Tracking.

## APP-19 — Offers
![Offers](previews/app-19.png)
- **Purpose:** Show the codes that work today and let the customer copy one.
- **Route / entry:** tab: Offers
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `promo_codes table; code field at checkout`
- **Data shown:** promo_codes (code, type, value, min order, valid_from/to, is_active)
- **Layout:** Featured banner · code cards (code, rule, expiry, Copy).
- **Components:** Banner · Code card · Copy button
- **Buttons and actions:** Copy code · Apply at checkout
- **Navigation:** → Cart
- **Empty state:** "No offers right now".
- **Loading state:** Card skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Today promo codes are typed at checkout and are not listed publicly. Listing them needs a public read function that returns only active, non-secret codes — a code the owner marks "private" must stay hidden.

## APP-20 — Support and help
![Support and help](previews/app-20.png)
- **Purpose:** Reach the restaurant fast, with the order number already attached.
- **Route / entry:** Profile → Help / order → Get help
- **Roles:** customer
- **Status:** Exists in the software — evidence: `customer_apps.whatsapp_number`
- **Data shown:** customer_apps (whatsapp_number), branches (phone), order context
- **Layout:** WhatsApp and Call cards · "Help with order #…" · FAQ accordion.
- **Components:** Contact cards · Order shortcut · FAQ accordion
- **Buttons and actions:** Chat on WhatsApp · Call branch · Open FAQ
- **Navigation:** Opens WhatsApp / dialer
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** No WhatsApp installed: the button falls back to a call.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** There is no ticketing system; support means WhatsApp or a phone call. The FAQ is static text the owner can edit later (needs a small settings field).

## APP-21 — Empty states
![Empty states](previews/app-21.png)
- **Purpose:** Every empty list explains itself and offers one next step.
- **Route / entry:** cart · orders · addresses · offers
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** —
- **Layout:** Three examples side by side: empty cart, no orders yet, no saved address.
- **Components:** Illustration disc · Title · One sentence · Primary action
- **Buttons and actions:** Browse the menu · Add an address
- **Navigation:** → Menu / Address book
- **Empty state:** This screen is the empty-state specification.
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.

## APP-22 — Loading states
![Loading states](previews/app-22.png)
- **Purpose:** Skeletons in the shape of the real content — no spinners over blank screens, no layout jump.
- **Route / entry:** every list while data loads
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** —
- **Layout:** Home, menu rows and tracking drawn as skeletons.
- **Components:** Skeleton block · Skeleton row · Shimmer (disabled with reduced motion)
- **Buttons and actions:** Pull to refresh
- **Navigation:** —
- **Empty state:** n/a
- **Loading state:** This screen is the loading specification.
- **Error state:** After 8 s: the error banner replaces the skeleton.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.

## APP-23 — Error and offline states
![Error and offline states](previews/app-23.png)
- **Purpose:** Say what happened in plain words, keep what the customer had, and offer Try again.
- **Route / entry:** any screen
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** —
- **Layout:** Offline banner with cached menu · full-screen error · restaurant closed banner.
- **Components:** Banner · Retry button · Cached content
- **Buttons and actions:** Try again · Call the restaurant
- **Navigation:** —
- **Empty state:** n/a
- **Loading state:** Retry shows a spinner in the button.
- **Error state:** This screen is the error specification.
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.

## APP-24 — Order status variations
![Order status variations](previews/app-24.png)
- **Purpose:** The same tracking card for every real status: waiting, preparing, on the way, delivered, cancelled, rejected.
- **Route / entry:** Tracking
- **Roles:** customer
- **Status:** Exists in the software — evidence: `delivery_status values in the code`
- **Data shown:** orders.status / delivery_status: pending, accepted, cooking, ready, rider_assigned, rider_picked, onway, rider_reached, delivered, cancelled, rejected
- **Layout:** Four status cards: Waiting for the restaurant · Being prepared · Delivered · Cancelled / Rejected.
- **Components:** Status card · Status badge · Reorder / Help actions
- **Buttons and actions:** Call restaurant (waiting too long) · Rate (needs-backend) · Reorder · Get help
- **Navigation:** → Order history
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
- **Note:** Rating and feedback are not stored today; the "Rate your order" row appears only when that exists.

## APP-25 — Home (dark)
![Home (dark)](previews/app-25.png)
- **Purpose:** The dark variant: the same layout on dark surfaces with the accent kept readable (contrast checked ≥ 4.5:1 for text).
- **Route / entry:** tab: Home — dark theme
- **Roles:** customer
- **Status:** New UI on existing data — evidence: `dtpos.apk (Customer shell) + src/pages/OnlineOrderPage.tsx`
- **Data shown:** same as Home
- **Layout:** Identical to Home.
- **Components:** Same as Home
- **Buttons and actions:** Same as Home
- **Navigation:** Same as Home
- **Empty state:** Same as Home
- **Loading state:** Same as Home
- **Error state:** Same as Home
- **Responsive:** Designed at 390 × 844 (Android). Works from 360 wide; on tablets the content centres in a 560 column. Dark theme follows the system setting.
