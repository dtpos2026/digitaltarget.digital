# Reference D2 — a restaurant web-ordering site (sent 2026-10-31: "ye web order site")

Six screenshots of a Pakistani fast-food chain's ordering website. **A reference for patterns, not for copying:** its logo, artwork, photography, copy and colours
belong to that brand and are not used. Our site takes the structure and the interaction patterns, in each restaurant's own brand (logo, colours, banners from
Super Admin / the owner's settings), as the brief requires ("original design using international-standard UX principles").

## What the screenshots show

| # | Screen | Patterns worth adopting |
|---|---|---|
| 1 | **Header** | One bar that holds everything: menu button · logo · **Delivery / Pick-up segmented switch** · global **search** · **delivery-address field** · **Cart** with count badge · **Login**. The mode switch and the address are always visible, not buried in checkout. |
| 2 | **Side drawer** | "Login to explore", Explore Menu, Branch Locator, Blog, Privacy Policy, a **hotline strip** pinned at the bottom. |
| 3 | **Hero** | Full-width promotional carousel with dots, an accent band, then **Explore Menu** (with *View all*) and an *Order now* call to action. |
| 4 | **Enter Address (modal)** | Map with a pin, a search box, a "use my location" target button, a short reason ("allow location for free delivery"). |
| 5 | **Pick-up branch (modal)** | Branch search, list of branches each with address, **opening hours**, **Open now** state and **distance from you**, map beside the list, selected branch highlighted. |
| 6 | **Login** | Split screen: brand illustration on one side; "Hey there, feeling hungry?" with **Continue with phone** and **Continue as a guest**. |

## Against what the cloud app has today (`OnlineOrderPage.tsx`, `OnlinePortalPage.tsx`) — by keyword search, not a full read

| Pattern | Today | Note |
|---|---|---|
| Delivery / self-pickup mode | yes (URL `?mode=`, in the page) | not a header switch |
| Branch picker with search; distance | yes (`computeDistance`) | no opening hours, no "Open now" |
| Phone login with OTP; guest checkout | yes (OTP + guest code paths exist) | not the split-screen presentation |
| Address on a map | Leaflet map in the page | not a modal with search + "my location" |
| Cart with badge; sticky bar | yes | |
| Hero / promo banners | **no** configurable banner | owner needs to upload banners, order them, link them |
| Opening hours, "Open now" | **no** | needs hours per branch in the data |
| Social links, hotline strip, footer | **no** | contact/social fields in tenant settings |
| Header with mode switch + search + address + cart + login in one bar | **no** | layout work |
| Multi-brand theming from the tenant's branding | partly (customer-app branding exists in `customer_apps`) | extend to the web site |

## Proposed order of work (Phase 5; none of it is started)

1. **Data first (additive migrations only):** per-branch opening hours; tenant banners (image, link, order, active window); social/hotline fields. Nothing existing is altered.
2. **Header + drawer + mode switch** in the restaurant's brand colours (tokens, as the sign-in now does).
3. **Branch modal** with hours / Open now / distance; **address modal** with search and "use my location".
4. **Hero carousel + Explore Menu** sections, driven by the owner's banners and categories.
5. **Login split screen** (phone / guest) using the restaurant's logo and colours.
6. Owner-side editor (logo, colours, banners, hours, social) in the Owner Portal; SEO (titles, meta, structured menu data, per-restaurant URLs); mobile-first review at phone width; accessibility pass.
Each slice: screenshots at phone and desktop width, tests, and a check that an order placed from the site still lands in the correct restaurant's POS with the same payload as today.

## Open questions
- Is the ordering site served from one domain with a restaurant slug (`/r/<slug>`) or from each restaurant's own domain? (Affects SEO and branding.)
- Do restaurants take payment online, or only cash on delivery / pick-up? (Today: no online payment.)
