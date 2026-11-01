# Developer handoff

## What is in the package
| Folder | Content |
|---|---|
| `00-source-analysis/` | What the real source and database were found to do (evidence, not assumptions) |
| `01-design-system/` | tokens (CSS + JSON), the visual reference with measured contrast |
| `02-restaurant-software/` | 40 screens: Windows POS + web (sidebar, top bar, dashboard, every module) |
| `03-customer-website/` | 21 screens + desktop variants |
| `04-customer-app/` | 25 screens (Android) |
| `05-rider-app/` | 22 screens (Android) |
| `06-owner-app/` | 24 screens (Android) + desktop view of Owner Management |
| `07-flows/` | 6 flow diagrams (SVG) |
| `08-architecture/` | integration architecture + what is missing |
| `09-handoff/` | this file, SCREEN-MAP, COMPONENTS, BUILD-ORDER |

Every product folder has `index.html` (gallery), `SCREENS.md` (per-screen purpose, layout, components, actions, navigation, data, empty/loading/error, responsive), `screens/<id>.html` (full-size, self-contained) and `previews/<id>.png`.

## Status counts (from the screen specs)
| Product | Screens | Exists today (redesign) | New UI on existing data | Needs backend |
|---|---|---|---|---|
| Restaurant software (Windows + web) | 40 | 40 | 0 | 0 |
| Customer ordering website | 21 | 17 | 3 | 1 |
| Customer mobile app (Android) | 25 | 9 | 13 | 3 |
| Rider mobile app (Android) | 22 | 13 | 6 | 3 |
| Owner management mobile app | 24 | 11 | 12 | 1 |

"Exists" = the module or feature is in the code now and the screen redesigns it. "New UI on existing data" = every field comes from a table or RPC that exists. "Needs backend" = the design is ready and the screen says what is missing.

## How to implement a screen
1. Find it in `SCREEN-MAP.md` — it gives the route, the data and the file where the real implementation lives today.
2. Open `screens/<id>.html` for exact spacing/colour (it uses the same tokens as `01-design-system/tokens.css`).
3. Build with the existing component library (`src/components/ui`, shadcn-style) and the tokens; add a component only if COMPONENTS.md lists one that does not exist.
4. Keep behaviour as it is. The redesign changes layout, hierarchy, spacing and states — not what a button does. Where a screen says "needs backend", build the UI behind the capability check and hide it until the backend exists.

## Gaps — things the brief asked for that the backend cannot do today
- **WEB-20 Restaurant closed / item unavailable** — Branch availability today = the branch is active. A closed-hours rule needs opening hours in the data.
- **APP-03 Sign in** — Today the website identifies a customer by phone number at checkout and has no SMS/OTP channel. The code step is designed but needs an SMS/WhatsApp provider (see handoff). Until then this screen is "enter your phone + name" and the guest path.
- **APP-04 Verify code** — Needs an SMS or WhatsApp sending service and a short-lived code table. Not built; the design reserves the screen so it can be switched on without a redesign.
- **APP-18 Notifications** — There is no push service (FCM) and no notifications table today. This screen is designed for when they exist. Until then, order updates are visible only by opening Tracking.
- **RID-03 Verification code** — The rider portal signs in with username + PIN; there is no OTP in the system. This screen is NOT part of today's flow and is shown only because the brief asked for it "if supported". It needs an SMS/WhatsApp service first.
- **RID-14 Proof of delivery (optional)** — The system has no proof-of-delivery photo or customer-code feature. Shown because the brief listed it; needs a storage bucket + a handover-code field on the order. Not part of today's flow.
- **RID-20 Notifications** — No notifications table or push service exists. Today a rider only hears about ready orders while the app is open (RID-06).
- **OWN-18 Notifications and alerts** — There is no push channel (FCM) and no notifications table. This is the one big gap for an owner app: today the owner must open the app to see anything. Designed so it can be switched on when the backend exists (see handoff §gaps).

Also not designed because nothing supports them: customer ratings/reviews, loyalty points (fields exist, unused), table reservations, in-app calling/chat, rider documents, multi-restaurant customer accounts.

## Open decisions for the owner of the product
1. Push notifications (FCM) and a notifications table — enables APP-18, RID-06/20, OWN-18.
2. An SMS / WhatsApp provider — enables APP-03/04, RID-03.
3. Online payments — enables "Pay online" in checkout.
4. A small `tenant_storefront` table (banners, opening hours per branch, social links) — enables hero banners, "open now", the About screen. See BUILD-ORDER step 3.
5. Whether the owner app stays a Capacitor shell over the web routes (fastest, what exists) or becomes native (better push, offline, performance; large rewrite).
