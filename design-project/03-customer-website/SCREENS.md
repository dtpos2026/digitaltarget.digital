# Customer ordering website — screen inventory
21 screens. Preview PNGs: `previews/<id>.png`; full-size HTML: `screens/<id>.html`. Sample content only — no figure on any screen is real data.
| Status | Meaning |
|---|---|
| Exists in the software | the module / feature is in the code today; this is a redesign of it |
| New UI on existing data | a new screen, but every field comes from tables/RPCs that exist |
| Needs backend work | the design is ready, the backend cannot do it yet (named in the screen) |

## WEB-01 — Home
![Home](previews/web-01.png)
![Home — desktop](previews/web-01-d.png)
- **Purpose:** First impression and the fastest way into the menu: choose delivery or pickup, see the categories and what is popular.
- **Route / entry:** #/order/<restaurant>
- **Roles:** customer (public)
- **Status:** New UI on existing data — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** tenants/customer_apps (name, logo, theme), branches, categories, menu_items, promo_codes
- **Layout:** Header · mode switch + address/branch bar · hero banner · category tiles · popular items · offers strip · footer.
- **Components:** Header (menu, search, cart) · Delivery / Pickup switch · Hero banner · Category tiles · Item cards · Offer chip
- **Buttons and actions:** Choose mode · Open category · Add item · Open cart
- **Navigation:** → Menu, Offers, Branch picker
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** The hero banner is a placeholder slot: banners are not stored today (needs-backend: tenant banners, see handoff).

## WEB-02 — Restaurant information
![Restaurant information](previews/web-02.png)
- **Purpose:** Who the restaurant is and how to reach it.
- **Route / entry:** #/order/<restaurant> → About
- **Roles:** customer (public)
- **Status:** New UI on existing data — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** tenants (name), customer_apps (logo_url, whatsapp_number), branches (address, phone, city)
- **Layout:** Logo + name + tagline · contact rows · branch list · (opening hours, social links as reserved slots).
- **Components:** Brand header · Contact rows · Branch cards · WhatsApp button
- **Buttons and actions:** Call · WhatsApp · Get directions
- **Navigation:** → Branch picker, Contact
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** Opening hours and social links are not stored today — shown as slots that appear once the data exists (needs-backend).

## WEB-03 — Menu categories
![Menu categories](previews/web-03.png)
- **Purpose:** Browse the menu by category, in the order the restaurant set.
- **Route / entry:** #/order/<restaurant>/menu
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** categories (name, icon, image_path, sort_order, is_active), menu_items count
- **Layout:** Search · 2-column category tiles with item counts.
- **Components:** Search field · Category tile
- **Buttons and actions:** Open category · Search
- **Navigation:** → Product listing
- **Empty state:** No categories: "The menu is being updated" with a call button.
- **Loading state:** Tile skeletons (6).
- **Error state:** Banner "Could not load the menu" with Retry; cached menu stays visible.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-04 — Product listing
![Product listing](previews/web-04.png)
![Product listing — desktop](previews/web-04-d.png)
- **Purpose:** See every item in a category with price, add quickly or open details.
- **Route / entry:** #/order/<restaurant>/menu/<category>
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** menu_items (name, price, image_path, is_active, sub_category, flavor_group, size_variants, inch_variants)
- **Layout:** Sticky category rail · optional subcategory chips · item rows with image, name, price, add button.
- **Components:** Category rail · Subcategory chips · Item row · Add / stepper · Sold-out badge
- **Buttons and actions:** Add · Change quantity · Open details
- **Navigation:** → Product details
- **Empty state:** "Nothing here right now" with the other categories suggested.
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-05 — Product details
![Product details](previews/web-05.png)
![Product details — desktop](previews/web-05-d.png)
- **Purpose:** Decide: big picture, name, price, then size and extras on the same screen.
- **Route / entry:** #/order/<restaurant>/item/<id>
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** menu_items (name, price, image_path, size_variants, inch_variants, flavors, flavor_group)
- **Layout:** Hero image · name and price · size radio list · flavour / add-on checklist · notes field · sticky "Add to cart".
- **Components:** Hero image · Size radio list · Add-on checklist · Quantity stepper · Special instructions · Add to cart bar
- **Buttons and actions:** Pick size · Pick add-ons · Write a note · Add to cart
- **Navigation:** → Cart
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** The data model has sizes, inches and flavours (menu_items.size_variants / inch_variants / flavors). Free-form add-on groups with prices are NOT in the model — add-ons here are flavours and variants.

## WEB-06 — Variations & add-ons sheet
![Variations & add-ons sheet](previews/web-06.png)
- **Purpose:** Quick add for an item with sizes: pick, confirm, stay on the list.
- **Route / entry:** Listing → Add (item with sizes)
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** menu_items.size_variants / inch_variants / flavors
- **Layout:** Bottom sheet over the listing: size list, flavour chips, quantity, Add button.
- **Components:** Bottom sheet · Size radios · Flavour chips · Add button
- **Buttons and actions:** Pick size · Pick flavour · Add
- **Navigation:** → back to listing with the cart updated
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-07 — Cart
![Cart](previews/web-07.png)
- **Purpose:** Review, adjust, apply a promo code, see the real total before checkout.
- **Route / entry:** #/order/<restaurant>/cart
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** cart lines (item, size, qty, notes), promo_codes, delivery fee, minimum order
- **Layout:** Lines with steppers · promo code field · totals (subtotal, delivery fee, discount) · minimum-order warning · Checkout.
- **Components:** Cart line · Stepper · Promo field · Totals · Min-order banner · Checkout button
- **Buttons and actions:** Change quantity · Remove · Apply promo · Checkout
- **Navigation:** → Checkout
- **Empty state:** Empty cart: bag illustration, "Your cart is empty", "Browse the menu".
- **Loading state:** Totals show skeletons while the promo is checked.
- **Error state:** Invalid promo: red hint under the field ("This code has expired"). Below minimum: warning banner and Checkout disabled.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-08 — Checkout
![Checkout](previews/web-08.png)
![Checkout — desktop](previews/web-08-d.png)
- **Purpose:** Confirm who, where, how and pay — in one scrolling page.
- **Route / entry:** #/order/<restaurant>/checkout
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** customer (name, phone), address (lat, lng, text), mode, payment_method, notes → place order RPC
- **Layout:** Sections: Delivery / Pickup · Your details · Address (or branch) · Payment · Order summary · Place order bar.
- **Components:** Section cards · Mode switch · Details form · Address card · Payment list · Summary · Place order
- **Buttons and actions:** Edit details · Change address · Choose payment · Place order
- **Navigation:** → Order confirmation
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Outside the service radius: the address card turns red ("We do not deliver here yet") and Place order is disabled. Network failure: the order is kept and Place order retries; the customer is never shown a success that did not happen.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-09 — Customer information — phone & verification
![Customer information — phone & verification](previews/web-09.png)
- **Purpose:** Order as a guest, or sign in with a phone number to keep addresses and history.
- **Route / entry:** Checkout → Sign in
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx (OTP, guest)`
- **Data shown:** customers (phone, name, customer_code), customer_otps, customer_sessions (RPC: customer sign-up / login / OTP)
- **Layout:** Brand header · "Continue with phone" / "Continue as guest" · phone field → 6-digit code → name.
- **Components:** Brand header · Phone field · OTP boxes · Resend timer · Guest button
- **Buttons and actions:** Send code · Verify · Resend · Continue as guest
- **Navigation:** → Checkout
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Wrong code: boxes shake, "That code is not right — 2 tries left". Too many tries: locked for a minute with a countdown.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** The code is sent through the restaurant's configured channel; if no sender is configured the guest path is the working path — the OTP delivery channel is an open backend item (notification outbox).

## WEB-10 — Delivery address
![Delivery address](previews/web-10.png)
- **Purpose:** Put the pin where the rider should go, and see at once whether the restaurant delivers there.
- **Route / entry:** Checkout → Address
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx, src/components/AddressPicker.tsx`
- **Data shown:** customers.addresses (label, text, lat, lng), branches (lat, lng, service_radius_km)
- **Layout:** Map with pin · search box · "use my location" · saved addresses · address text + landmark · Confirm.
- **Components:** Map + pin · Search · Locate button · Saved addresses · Address form · Radius message
- **Buttons and actions:** Drag pin · Search · Use my location · Save address · Confirm
- **Navigation:** → Checkout
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Location denied: map stays, "Allow location or search your area". Outside radius: red message and Confirm disabled.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-11 — Delivery or pickup — branch
![Delivery or pickup — branch](previews/web-11.png)
- **Purpose:** Pickup: choose the branch. Delivery: the nearest branch that serves the address is chosen for you.
- **Route / entry:** Header → Mode / Branch
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx (branch picker + search)`
- **Data shown:** branches (name, address, lat, lng, service_radius_km, is_active), computed distance
- **Layout:** Mode switch · branch search · branch cards with address, distance and (when available) hours and Open now · map.
- **Components:** Mode switch · Search · Branch card · Distance · Open-now badge · Map
- **Buttons and actions:** Search · Select branch · Switch mode
- **Navigation:** → Menu of that branch
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** Distance exists. "Open now" and opening hours are not stored per branch today (needs-backend); the badge is hidden until the data exists.

## WEB-12 — Payment methods
![Payment methods](previews/web-12.png)
- **Purpose:** Show exactly the methods the restaurant accepts online — no more.
- **Route / entry:** Checkout → Payment
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/lib/types.ts (PaymentMethod: cash, card, online, credit + custom)`
- **Data shown:** tenant payment settings (cash, card on delivery, online accounts via payment_accounts)
- **Layout:** Radio list of accepted methods with a one-line explanation each.
- **Components:** Method row · Instruction text
- **Buttons and actions:** Choose method
- **Navigation:** → Checkout
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** Today the website takes cash on delivery / pay at pickup. There is no online payment gateway in the system: JazzCash / card-online rows are NOT drawn as working. If a restaurant later adds one, it appears as a method here.

## WEB-13 — Order confirmation
![Order confirmation](previews/web-13.png)
- **Purpose:** Reassure: the order is placed, here is the number, here is what happens next.
- **Route / entry:** #/track/<order>
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** orders (order_number, status, delivery.etaMinutes, grand_total, payment_method)
- **Layout:** Success mark · order number · ETA · summary · Track order · Back to menu · WhatsApp link.
- **Components:** Success illustration · Order number · ETA card · Summary · Track button
- **Buttons and actions:** Track order · Back to menu · Share tracking link
- **Navigation:** → Live tracking
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** Until the restaurant accepts a website order the status reads "Waiting for the restaurant to confirm" — never "confirmed".

## WEB-14 — Live order tracking
![Live order tracking](previews/web-14.png)
![Live order tracking — desktop](previews/web-14-d.png)
- **Purpose:** Where is my food? Status steps, rider and ETA, and the map when a rider has the order.
- **Route / entry:** #/track/<order>
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/components/CustomerOrderTracker.tsx, src/lib/delivery.ts`
- **Data shown:** orders (delivery_status, rider_name, rider_phone, delivery.etaMinutes / distanceKm / customerLat / Lng), track_order RPC
- **Layout:** ETA header · status steps (placed → accepted → preparing → rider assigned → picked up → on the way → delivered) · rider card (name, call) · order summary.
- **Components:** ETA header · Status steps · Rider card · Call button · Map · Summary
- **Buttons and actions:** Call rider · Call restaurant · Share link · Cancel (only before accepted)
- **Navigation:** → Order history
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeleton steps.
- **Error state:** Offline: "Showing the last update from 2 min ago"; the map shows the rider only while the location is fresh — a stale location is labelled, never shown as live.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-15 — Order history
![Order history](previews/web-15.png)
- **Purpose:** Find a past order and track the current one.
- **Route / entry:** #/order/<restaurant>/orders
- **Roles:** customer (signed in)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx (history)`
- **Data shown:** orders by customer (order_number, created_at, grand_total, status, items)
- **Layout:** Active order card on top · past orders list with status and total.
- **Components:** Active order card · Order row · Status badge
- **Buttons and actions:** Open order · Track · Reorder
- **Navigation:** → Tracking, Cart (reorder)
- **Empty state:** "No orders yet" with a Browse menu button.
- **Loading state:** Row skeletons.
- **Error state:** Retry banner; sign-in expired → back to sign-in.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** "Reorder" is a new button on existing data: it copies the order's items into the cart (items that are no longer available are skipped and listed).

## WEB-16 — Customer profile
![Customer profile](previews/web-16.png)
- **Purpose:** Keep details and saved addresses up to date.
- **Route / entry:** #/order/<restaurant>/profile
- **Roles:** customer (signed in)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx (profile)`
- **Data shown:** customers (name, phone, email, date_of_birth, gender, photo_url, customer_code, addresses)
- **Layout:** Avatar + name + customer code · details form · saved addresses · sign out.
- **Components:** Avatar · Form · Address list · Sign out
- **Buttons and actions:** Edit · Add address · Sign out
- **Navigation:** → Order history
- **Empty state:** Fields show placeholders; required fields are marked; Save is disabled until valid.
- **Loading state:** Save shows a spinner and locks the form; fields keep their values.
- **Error state:** Field errors under the field (red border + message); a summary banner if the save itself failed.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-17 — Offers & promotions
![Offers & promotions](previews/web-17.png)
- **Purpose:** Show current deals and the promo codes customers can use.
- **Route / entry:** #/order/<restaurant>/offers
- **Roles:** customer (public)
- **Status:** New UI on existing data — evidence: `src/pages/PromoCodesPage.tsx (admin), OnlineOrderPage.tsx (apply)`
- **Data shown:** promo_codes (code, discount_type, discount_value, valid_from, valid_until, is_active), deals
- **Layout:** Deal cards · promo code tickets with Copy · terms.
- **Components:** Deal card · Promo ticket · Copy button · Validity chip
- **Buttons and actions:** Order a deal · Copy code
- **Navigation:** → Cart
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** Listing active codes publicly is a new read; codes that the restaurant does not want public need a "show on website" flag (needs-backend, small).

## WEB-18 — Contact & support
![Contact & support](previews/web-18.png)
- **Purpose:** Reach the restaurant about an order in two taps.
- **Route / entry:** #/order/<restaurant>/help
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx (WhatsApp)`
- **Data shown:** customer_apps.whatsapp_number, branches (phone, address), orders (for "my order" help)
- **Layout:** Big WhatsApp and Call buttons · common questions · my-order shortcut.
- **Components:** Action tiles · FAQ accordion · Order shortcut
- **Buttons and actions:** WhatsApp · Call · Open FAQ
- **Navigation:** → Order tracking
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-19 — Empty cart
![Empty cart](previews/web-19.png)
- **Purpose:** A friendly dead end that leads back to the menu.
- **Route / entry:** #/order/<restaurant>/cart
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** —
- **Layout:** Illustration, one sentence, one button.
- **Components:** Empty state
- **Buttons and actions:** Browse the menu
- **Navigation:** → Menu
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.

## WEB-20 — Restaurant closed / item unavailable
![Restaurant closed / item unavailable](previews/web-20.png)
- **Purpose:** Be honest: say what cannot be ordered right now and when it can.
- **Route / entry:** Any screen
- **Roles:** customer (public)
- **Status:** Needs backend work — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** menu_items.is_active, branch is_active; (opening hours — needs backend)
- **Layout:** Top banner and disabled add buttons; checkout blocked with the reason.
- **Components:** Banner · Disabled buttons · Sold-out badge
- **Buttons and actions:** Browse · Choose another branch
- **Navigation:** → Branch picker
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
- **Note:** Branch availability today = the branch is active. A closed-hours rule needs opening hours in the data.

## WEB-21 — Menu failed to load
![Menu failed to load](previews/web-21.png)
- **Purpose:** A failed load never looks like an empty restaurant.
- **Route / entry:** Any screen
- **Roles:** customer (public)
- **Status:** Exists in the software — evidence: `src/pages/OnlineOrderPage.tsx`
- **Data shown:** —
- **Layout:** Inline banner with Retry; cached menu stays; skeletons while retrying.
- **Components:** Banner · Skeleton rows · Retry
- **Buttons and actions:** Retry
- **Navigation:** —
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Mobile-first at 390. Tablet 820: two-column grids. Desktop 1440: content in a 1160 column, cart as a right panel.
