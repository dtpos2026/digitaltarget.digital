# Rider mobile app (Android) — screen inventory
22 screens. Preview PNGs: `previews/<id>.png`; full-size HTML: `screens/<id>.html`. Sample content only — no figure on any screen is real data.
| Status | Meaning |
|---|---|
| Exists in the software | the module / feature is in the code today; this is a redesign of it |
| New UI on existing data | a new screen, but every field comes from tables/RPCs that exist |
| Needs backend work | the design is ready, the backend cannot do it yet (named in the screen) |

## RID-01 — Splash
![Splash](previews/rid-01.png)
- **Purpose:** Open on the Rider app colour with the DT mark and the bike badge, then go straight to Home if the rider is still signed in.
- **Route / entry:** app launch
- **Roles:** rider
- **Status:** New UI on existing data — evidence: `branding/ (Rider icon family: DT mark + bike badge)`
- **Data shown:** none (signed-in rider is read from the saved session)
- **Layout:** Full-bleed rider orange · mark with bike badge · "DT Rider" · powered-by line.
- **Components:** Animated DT mark · Role badge · Title
- **Buttons and actions:** None
- **Navigation:** → Login or Home
- **Empty state:** n/a
- **Loading state:** This screen is the loading state (max 2 s).
- **Error state:** If the saved session is rejected: go to Login with "Please sign in again".
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** Native splash colour matches (windowSplashScreenBackground), so there is no white flash.

## RID-02 — Sign in
![Sign in](previews/rid-02.png)
- **Purpose:** Sign in with the account the restaurant created. One app serves every restaurant — the workspace code says which.
- **Route / entry:** #/rider-portal (public)
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (doLogin)`
- **Data shown:** username or phone + PIN/password + workspace code (restaurant code) → staff_portal login RPC
- **Layout:** Bike icon · title · username/phone · PIN · workspace code · Sign in.
- **Components:** Text fields · PIN field (masked) · Workspace code field · Primary button
- **Buttons and actions:** Sign in
- **Navigation:** → Home
- **Empty state:** Fields show placeholders "03xxxxxxxxx", "••••", "ABC123".
- **Loading state:** Button reads "Signing in…" and is locked.
- **Error state:** Wrong details: banner "Wrong username/phone or PIN". Lockout and rate-limit messages come from the server unchanged.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** Workspace code is required only when the username exists in more than one restaurant — the field turns amber and says "(required)" then, exactly as today.

## RID-03 — Verification code
![Verification code](previews/rid-03.png)
- **Purpose:** Optional second step: confirm the phone with a code (only if the restaurant turns it on).
- **Route / entry:** optional step after Sign in
- **Roles:** rider
- **Status:** Needs backend work — evidence: `none today`
- **Data shown:** one-time code
- **Layout:** Title · six boxes · resend timer · Verify.
- **Components:** OTP boxes · Timer · Primary button
- **Buttons and actions:** Enter code · Resend · Verify
- **Navigation:** → Home
- **Empty state:** n/a
- **Loading state:** Spinner on Verify.
- **Error state:** Wrong code: shake + "2 tries left".
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** The rider portal signs in with username + PIN; there is no OTP in the system. This screen is NOT part of today's flow and is shown only because the brief asked for it "if supported". It needs an SMS/WhatsApp service first.

## RID-04 — Home
![Home](previews/rid-04.png)
- **Purpose:** Everything a rider needs between deliveries: am I live, what is on my plate, what did I earn today.
- **Route / entry:** tab: Home
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx`
- **Data shown:** rider (name, phone, restaurant badge), orders assigned to the rider (delivery_status), portal_my_history totals (today, delivered, earnings), live-tracking flag
- **Layout:** Header (name, restaurant badge, Go Live) · 3 stat tiles · active orders · available orders to claim · Refresh.
- **Components:** Header card · Go Live switch · Stat tiles · Order card · Claim button · Tab bar
- **Buttons and actions:** Go Live / Go offline · Open order · Claim an order · Refresh
- **Navigation:** → Order detail, Earnings
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Skeletons in the shape of the content; pull-to-refresh spinner.
- **Error state:** Offline / failed banner at the top with Retry; cached content stays.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** Go Live starts location pings (watchPosition) that the restaurant sees on the live rider map. The 3 tiles are Active, Done today, Earnings (as returned by the server).

## RID-05 — Available orders
![Available orders](previews/rid-05.png)
- **Purpose:** Orders waiting for a rider — claim one with a single tap.
- **Route / entry:** tab: Orders → Available
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (claimOrder)`
- **Data shown:** delivery orders ready and not yet assigned (riderId empty)
- **Layout:** Segmented Mine / Available · order rows with total and area · Claim.
- **Components:** Segment · Order row · Claim button
- **Buttons and actions:** Claim · Refresh
- **Navigation:** → Order detail
- **Empty state:** "No orders waiting" — "New orders appear here automatically."
- **Loading state:** Row skeletons.
- **Error state:** Claim fails because someone else got it: toast "Already taken" and the row disappears.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.

## RID-06 — New order alert
![New order alert](previews/rid-06.png)
- **Purpose:** Tell a rider with the app open that an order is ready: sound, vibration and a banner they can claim from.
- **Route / entry:** in-app, any screen
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (ReadyNotificationBus, ReadyOrderPoller)`
- **Data shown:** ready delivery order (ReadyOrderPoller / ReadyNotificationBus)
- **Layout:** Top banner over the current screen: order number, area, total, Claim / Later.
- **Components:** Alert banner · Claim button · Later link
- **Buttons and actions:** Claim · Later
- **Navigation:** → Order detail
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** Works only while the app is open (the order poller). There is NO push notification service today, so a closed app gets no alert. A background alert needs FCM (see handoff).

## RID-07 — Order details
![Order details](previews/rid-07.png)
- **Purpose:** All the facts for one delivery in one scroll, with the next step always at the bottom.
- **Route / entry:** Home / Orders → order
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (OrderCard)`
- **Data shown:** order (number, items, total, payment method), customer (name, phone, address, lat/lng), delivery (distance_km, eta_minutes), branch location
- **Layout:** Status + number · route map · customer block with call · address · items · amount to collect · sticky next-step button.
- **Components:** Route map · Customer card · Call button · Navigate button · Item list · Amount card · Next-step button
- **Buttons and actions:** Call customer · Navigate · Advance status
- **Navigation:** → Pickup / Navigation / Delivery confirmation
- **Empty state:** n/a
- **Loading state:** Skeleton blocks.
- **Error state:** Offline: the last known details stay; status change is queued and retried.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.

## RID-08 — Claim confirmation
![Claim confirmation](previews/rid-08.png)
- **Purpose:** One quick confirmation so a stray tap does not take an order.
- **Route / entry:** Claim
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (claimOrder)`
- **Data shown:** order summary
- **Layout:** Bottom sheet · order, area, total, distance · Claim order / Cancel.
- **Components:** Bottom sheet · Summary rows · Primary + secondary buttons
- **Buttons and actions:** Claim order · Cancel
- **Navigation:** → Order details
- **Empty state:** Centered illustration, one sentence, one action.
- **Loading state:** Button spinner.
- **Error state:** "Someone else claimed this order" — sheet closes, list refreshes.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.

## RID-09 — Go to the restaurant
![Go to the restaurant](previews/rid-09.png)
- **Purpose:** Get to the kitchen: map with the branch, distance, and a one-tap hand-off to Google Maps.
- **Route / entry:** order → before pickup
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (DeliveryRouteMap)`
- **Data shown:** branch location (restaurant lat/lng from settings), rider position
- **Layout:** Large map · branch card with phone · Navigate · "Picked up" button.
- **Components:** Map · Branch card · Navigate button · Picked up button
- **Buttons and actions:** Navigate (opens Google Maps) · Call branch · Picked up
- **Navigation:** → Pickup confirmation
- **Empty state:** n/a
- **Loading state:** Map skeleton.
- **Error state:** No GPS: banner "Turn on location to see the route"; the buttons still work.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** Turn-by-turn navigation is delegated to Google Maps via a link; the app does not draw its own directions.

## RID-10 — Pickup confirmation
![Pickup confirmation](previews/rid-10.png)
- **Purpose:** Check the bag against the order before leaving the kitchen.
- **Route / entry:** Picked up
- **Roles:** rider
- **Status:** New UI on existing data — evidence: `src/pages/RiderAppPage.tsx (STAGE_FLOW rider_picked)`
- **Data shown:** order items (checklist)
- **Layout:** Item checklist · "Everything is in the bag" · Confirm pickup.
- **Components:** Checklist · Confirm button
- **Buttons and actions:** Tick items · Confirm pickup
- **Navigation:** → On the way
- **Empty state:** n/a
- **Loading state:** Button spinner.
- **Error state:** Status change fails: "Could not update — retrying", queued.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** Today the rider taps "Picked up" with no checklist. The checklist is a UI-only addition (not stored); status change uses the existing rider_picked stage.

## RID-11 — On the way
![On the way](previews/rid-11.png)
- **Purpose:** Drive to the customer: status stepper, map, customer address and one-tap navigation and call.
- **Route / entry:** after Picked up
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx`
- **Data shown:** customer address, lat/lng, distance, eta
- **Layout:** Stage stepper · map · address card with Navigate / Call · sticky "Reached".
- **Components:** Stage stepper · Map · Address card · Navigate / Call buttons · Reached button
- **Buttons and actions:** Navigate · Call customer · Reached
- **Navigation:** → Delivery confirmation
- **Empty state:** n/a
- **Loading state:** Map skeleton.
- **Error state:** Offline: "Updates will send when you are back online".
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.

## RID-12 — Call the customer
![Call the customer](previews/rid-12.png)
- **Purpose:** Reach the customer from the delivery screen with one tap (opens the phone dialer).
- **Route / entry:** Call button
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (tel: link)`
- **Data shown:** customer phone
- **Layout:** Sheet · customer name · number · Call · "Message on WhatsApp".
- **Components:** Bottom sheet · Call button · WhatsApp link
- **Buttons and actions:** Call · WhatsApp · Cancel
- **Navigation:** Opens the dialer / WhatsApp
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** No number on the order: the button is disabled with "No phone number".
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** The call is a normal phone call (tel: link) — there is no in-app calling or masked number. The customer's number is shown to the rider only for orders assigned to them.

## RID-13 — Delivery confirmation
![Delivery confirmation](previews/rid-13.png)
- **Purpose:** Finish the job: confirm the cash taken and mark the order delivered.
- **Route / entry:** Reached → Delivered
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (stage delivered)`
- **Data shown:** order total, payment method (cash on delivery / paid)
- **Layout:** Amount to collect (large) · payment method · "I collected" confirmation · Delivered.
- **Components:** Amount card · Collect checkbox · Delivered button
- **Buttons and actions:** Confirm cash collected · Delivered
- **Navigation:** → Delivered success
- **Empty state:** n/a
- **Loading state:** Button spinner.
- **Error state:** Fails: "Could not mark delivered — try again"; the order stays on screen.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** The system records the status change only; it does not record how much cash the rider handed over. A cash-handover/settlement step is a backend addition.

## RID-14 — Proof of delivery (optional)
![Proof of delivery (optional)](previews/rid-14.png)
- **Purpose:** Optional evidence that the order reached the customer: a photo or a 4-digit handover code.
- **Route / entry:** Delivered (if switched on)
- **Roles:** rider
- **Status:** Needs backend work — evidence: `none today`
- **Data shown:** photo or customer code
- **Layout:** Camera frame · "Take photo" · or "Enter customer code" · Submit.
- **Components:** Camera frame · Code boxes · Submit
- **Buttons and actions:** Take photo · Enter code · Skip (if allowed)
- **Navigation:** → Delivered success
- **Empty state:** n/a
- **Loading state:** Upload progress bar.
- **Error state:** Upload fails: keep the photo and retry; do not block the delivery.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** The system has no proof-of-delivery photo or customer-code feature. Shown because the brief listed it; needs a storage bucket + a handover-code field on the order. Not part of today's flow.

## RID-15 — Delivered
![Delivered](previews/rid-15.png)
- **Purpose:** Close the loop with a clear "done" and the day's running total.
- **Route / entry:** after Delivered
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx`
- **Data shown:** portal_my_history totals
- **Layout:** Success mark · order number · today count + earnings · "Back to orders".
- **Components:** Success mark · Summary · Primary button
- **Buttons and actions:** Back to orders
- **Navigation:** → Home
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.

## RID-16 — Earnings
![Earnings](previews/rid-16.png)
- **Purpose:** Show what the rider earned and how many orders they delivered, with a list to check against.
- **Route / entry:** tab: Earnings
- **Roles:** rider
- **Status:** New UI on existing data — evidence: `src/pages/RiderAppPage.tsx (history)`
- **Data shown:** RPC portal_my_history → totals (delivered, today, earnings) and delivered orders (number, customer, total, delivered_at)
- **Layout:** Period chips (Today / Week / Month) · big total · bar chart · delivered orders list.
- **Components:** Period chips · Total · Bar chart · Order rows
- **Buttons and actions:** Change period · Open order
- **Navigation:** → Order detail (read-only)
- **Empty state:** "No deliveries in this period".
- **Loading state:** Skeleton total + rows.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** Today the app shows Today and lifetime totals only. Week/Month chips and the chart are UI built on the same history rows (group by delivered_at). How "earnings" is calculated (fee per order vs. order total) is decided by the server function and is not changed here.

## RID-17 — Delivery history
![Delivery history](previews/rid-17.png)
- **Purpose:** Look back at past deliveries — to answer "did I deliver #1020?"
- **Route / entry:** tab: Orders → History
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx (history list)`
- **Data shown:** portal_my_history rows
- **Layout:** Segmented Mine / Available / History · rows with number, customer, area, total, date.
- **Components:** Segment · History row
- **Buttons and actions:** Open row · Filter by date
- **Navigation:** → Order detail
- **Empty state:** "No completed deliveries yet".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.

## RID-18 — Profile
![Profile](previews/rid-18.png)
- **Purpose:** Who is signed in, which restaurant, and the settings a rider actually uses.
- **Route / entry:** tab: Profile
- **Roles:** rider
- **Status:** Exists in the software — evidence: `src/pages/RiderAppPage.tsx`
- **Data shown:** rider (name, phone, vehicle?, restaurant badge), live-tracking setting
- **Layout:** Avatar + name + restaurant · Live tracking switch · Theme · Language · Help · Log out (asks first).
- **Components:** Avatar · Setting rows · Switch · Log out button
- **Buttons and actions:** Toggle live tracking · Change theme · Log out (with confirmation)
- **Navigation:** → Help
- **Empty state:** n/a
- **Loading state:** Skeleton rows.
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** The log-out icon is a log-out icon and asks "Log out of DT Rider?" first (v1.49.0 fixed the old profile-icon-logs-out surprise). Documents (licence, CNIC) are not stored for riders today.

## RID-19 — Support and report a problem
![Support and report a problem](previews/rid-19.png)
- **Purpose:** When something goes wrong (customer unreachable, wrong address, accident) the rider can reach the restaurant in one tap with the order attached.
- **Route / entry:** Profile → Help / order → Problem
- **Roles:** rider
- **Status:** New UI on existing data — evidence: `none (no ticketing)`
- **Data shown:** branch phone, order number
- **Layout:** Problem list · Call restaurant · WhatsApp.
- **Components:** Problem rows · Call button · WhatsApp button
- **Buttons and actions:** Call the restaurant · WhatsApp the restaurant
- **Navigation:** Opens dialer / WhatsApp
- **Empty state:** n/a
- **Loading state:** n/a
- **Error state:** n/a
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** There is no problem-report table; this opens a call or a WhatsApp message prefilled with the order number. A logged "problem" status would be a backend addition.

## RID-20 — Notifications
![Notifications](previews/rid-20.png)
- **Purpose:** A list of order-ready and assignment messages.
- **Route / entry:** Home → bell
- **Roles:** rider
- **Status:** Needs backend work — evidence: `none — no push channel today`
- **Data shown:** notifications table
- **Layout:** Today / earlier groups · icon · title · line · time.
- **Components:** Notification row · Unread dot
- **Buttons and actions:** Open order · Mark all read
- **Navigation:** → Order detail
- **Empty state:** "Nothing new".
- **Loading state:** Row skeletons.
- **Error state:** Retry banner.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
- **Note:** No notifications table or push service exists. Today a rider only hears about ready orders while the app is open (RID-06).

## RID-21 — Empty, loading and error states
![Empty, loading and error states](previews/rid-21.png)
- **Purpose:** What the rider sees with no orders, no GPS, no network, or while loading.
- **Route / entry:** all lists
- **Roles:** rider
- **Status:** New UI on existing data — evidence: `src/pages/RiderAppPage.tsx`
- **Data shown:** —
- **Layout:** No orders · GPS off · offline · skeleton.
- **Components:** Empty illustration · Banner · Skeleton · Retry
- **Buttons and actions:** Refresh · Open location settings · Retry
- **Navigation:** —
- **Empty state:** This screen is the specification.
- **Loading state:** Skeleton rows.
- **Error state:** Banners as drawn.
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.

## RID-22 — Home (dark, night shift)
![Home (dark, night shift)](previews/rid-22.png)
- **Purpose:** Dark theme for night riding: lower glare, accent kept readable.
- **Route / entry:** tab: Home — dark
- **Roles:** rider
- **Status:** New UI on existing data — evidence: `src/pages/RiderAppPage.tsx`
- **Data shown:** same as Home
- **Layout:** Same as Home.
- **Components:** Same as Home
- **Buttons and actions:** Same as Home
- **Navigation:** Same as Home
- **Empty state:** Same as Home
- **Loading state:** Same as Home
- **Error state:** Same as Home
- **Responsive:** Designed at 390 × 844 (Android), one-handed: every primary action sits in the bottom 40 % and is at least 52 px high. Large type and high contrast for use outdoors; dark theme for night shifts.
