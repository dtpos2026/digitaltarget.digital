# Source analysis — what the designs are based on

Everything below was read from the repository (`dtpos2026/digitaltarget.digital`, branch `claude/hybrid-pos-sync-audit-o8ixc8`) and the Supabase project, not assumed. "NOT VERIFIED" marks what I could not confirm.

## Products and where they live
| Product | Real implementation | Notes |
|---|---|---|
| Windows POS | `dtpos-desktop` (Electron 33 shell) loading the web app via `app://` | Offline store + sync; installer `.exe` NOT VERIFIED (never built on Windows by me) |
| Web POS + all modules | `src/` (React 19, TanStack Start/Router, Tailwind 4, Supabase) | 32 themes (21 reference themes) |
| Customer website | `src/pages/OnlineOrderPage.tsx`, route `#/order/<restaurant>`, tracking `#/track` | Guest checkout; cash on delivery / pay at pickup; no payment gateway |
| Customer Android app | `dtpos.apk` (Capacitor shell, Customer flavour) | Splash/icon NOT yet applied; Android build NOT VERIFIED |
| Rider app | `src/pages/RiderAppPage.tsx`, route `#/rider-portal`; Android shell in `dtpos.apk` | Username/phone + PIN + workspace code; no OTP; Go Live GPS pings; Google Maps links |
| Order Taker app | `src/pages/OrderTakerPortalPage.tsx`, `#/order-taker` | Not redesigned in this package (not in the five products of the brief) |
| Owner | `OwnerLoginPage.tsx`, `OwnerManagementPage.tsx`, `OnlinePortalPage.tsx`, `DevicesPage.tsx` | There is no separate owner mobile app today; the owner uses the web app |
| Super Admin | `SuperAdminPage.tsx`, `SuperAdminPortfolioPage.tsx` … | Licences, portfolio; shares the brand system |

## Roles, order types, statuses (from the code)
- Roles: admin, manager, cashier, rider, order_taker. (Owner = admin of the workspace.)
- Order types: dining, takeaway, delivery, foodpanda.
- Bill status: running, hold, paid, partial, void, complimentary, cancelled, credit_pending, credit_received, pending_approval, rejected.
- Delivery status: pending, accepted, cooking, ready, rider_assigned, rider_picked, onway, rider_reached, delivered, cancelled.
- Payment methods: cash, card, online, credit, custom.

## Modules found (sidebar groups)
Operations · Marketing · Inventory · Accounts · Staff · Reports · Admin — 40+ modules, listed in `tools/lib.mjs` MODULE_GROUPS, which is what the redesigned sidebar draws (permission-filtered at runtime).

## Things the brief assumed that are not in the system
Push notifications · OTP for riders or customers · proof of delivery · online payments · banners, opening hours, social links · customer ratings · a separate owner mobile app · table reservations · loyalty in the online flow (fields exist, unused) · promo-code listing for customers. Each is marked on the screens it touches and collected in HANDOFF.md.

## Known open items that constrain the design (unchanged by it)
Invoice numbering (B4) · security findings S2–S6 · PRA unverified (off by default) · ~126 hard-coded "PKR" strings · duplicate KDS and Credits modules (reported, not merged) · Android and Windows installer builds unverified. Details: `docs/audit/` and `docs/RELEASE-CHECKLIST.md` in the repository.

## Method
Screens are generated from structured specs (`design-project/tools/screens-*.mjs`): each spec holds the documentation and the render function together, so a screen and its description cannot drift apart. Sample restaurant content is placeholder; no figure on any screen is real data. Figma was not used for the build (see README).
