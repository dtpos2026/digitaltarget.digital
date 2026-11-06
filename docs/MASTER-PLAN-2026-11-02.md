# DT Enterprise POS — Master plan (one product, one design, worldwide)

Written 2 Nov 2026 from the owner's brief (Roman Urdu / Urdu, with the Dribbble food-POS references:
GoFood pink, Sweetco orange, TastyIgniter, Tst Food). It replaces nothing; it orders the work that remains.

## 1. The rules (owner decisions, fixed)

1. **One UI, themes change colour only.** Every module, every phone app, the website and Super Admin use the
   same buttons, fields, cards, tables, badges, tabs, dialogs, spacing and type. A theme or colour scheme
   never moves a control or changes a layout.
2. **One brand.** Same logo mark, name pattern ("Powered by Digital Target"), icon style (outline), tone
   (plain English, short labels), amount format (`Rs 1,450`), date/time format, empty/loading/error states.
3. **Screens adjust themselves** to every size and type (till 1366×768, 1080p, 4K, tablet, phone, portrait kiosk,
   kitchen TV, customer display) — no manual zoom needed.
4. **One flow.** The same journey in the same order on every surface: sign in → home → order → kitchen → pay →
   receipt → close day, with the same words and the same shortcuts.
5. **Nothing the owner uses may be removed**; new design is added around working functions.
6. **Security is a feature**: every public door is throttled, checked on the server, and reviewed
   (`docs/SECURITY-REVIEW-2026-11-02.md`). Database changes are additive, reviewed, and backed up first.

7. **The owner's reference pictures are the look** (GoFood, Sweetco, TastyIgniter, Tst Food — analysed in
   `docs/design-references/2026-11-02-dribbble-food-pos-analysis.md`): photo-first cards, one accent colour, big
   rounded shapes, category icon tiles, an order panel that reads top to bottom with one wide Pay button, a hero
   dashboard, order cards with a timer ring. Where the earlier purple design package differs, the pictures win.

## 2. Where we are (honest, 2 Nov 2026, v1.100.0)

| Area | State |
|---|---|
| Shell (sidebar, top bar), Dashboard, POS panel and cards | In the design (v1.85–v1.99) |
| **Shared components on every page** (buttons, fields, cards, tables, badges, tabs, dialogs) | **One language under DT Refined from v1.100.0** — token-driven, call-site sizes still win |
| Page frame (title row, gutters, filters bar) | Still differs page to page (e.g. Inventory vs Customers gutter) → WP-2 |
| 40 restaurant-software screens | Dashboard + POS done. The other 38 use the shared components now, but their *layouts* are not yet rebuilt to the design |
| Phone apps (Rider 22, Order Taker 14, Owner 24 screens) | Built and working; they use the earlier purple phone kit — to be aligned to the single UI (WP-5) |
| Customer website | Home (WEB-01) built; switches enforced; other pages still old (WP-6) |
| Super Admin | Works; design pass pending (WP-7) |
| Security | Reviewed; hygiene items, the tracking throttle and the Custom Website intake applied in v1.107.0 (see the review's §6); S-4 / S-5 remain |

## 3. Work packages (in order)

| WP | What | Needs from the owner |
|---|---|---|
| **WP-1 ✔ v1.100.0** | Component language: `data-slot` markers + size tokens on every shared component; Refined styles them; two new reference colour schemes (Berry, Sunrise) | — |
| **WP-1b ✔ v1.101.0** | POS screen in the reference look: photo-first cards, category icon tiles, cart lines with photos | — |
| **WP-1c** | ✔ v1.102.0: Dashboard hero + KPI sparklines, Kitchen order cards with timer ring. Still: order-panel payment tiles + Pay (SW-04); Orders / Delivery / Tables cards; flat navigation | — |
| **WP-2** | **Page frame**: one `PageHeader` (title, subtitle, actions), one gutter, one filter bar, one empty / loading / error state; applied to all pages by a codemod where safe | — |
| **WP-3** | **Auto screen layout for every page** (see §4) | — |
| **WP-4** | The 38 remaining desktop screens in the design's layouts, in this order: Tables/Retrieve/Delivery/Pickup/Kitchen (SW-06…12) → management (13…28) → settings/printing/permissions (29…40) → payment dialog and weight panel (04/05). Amount format `Rs 1,450` everywhere. | the issue list the owner will send |
| **WP-5** | Phone apps on the single UI: same tokens, same component language, theme = colour only | — |
| **WP-6** | Website: WEB-02/05–21 (product, cart, checkout, offers, tracking, account, contact …) on the same components; opening hours / banners / social links as fields of the settings document | choose "settings document" (no table) vs new table |
| **WP-7** | Super Admin on the same system | — |
| **WP-8 ✔ v1.107.0** | **Custom Website** option (see §5) — built: Settings → Online Order → "My own website", signed intake endpoint, "Needs matching" list. Super Admin view added in v1.108.0; the card works in the Windows app too | — |
| **WP-9 ◐ v1.107.0** | Security items: S-1, S-2 (throttle), S-4, S-5 (growing lock), S-6, S-7 applied; S-3 corrected (no change needed); only leaked-password protection remains | leaked-password switch: owner (dashboard) |
| **WP-10** | International pack (see §6) | — |
| **WP-11** | Multi-branch Phase 2, regional managers, ERP gaps (reservations, stock count, batch/expiry, accounting, rosters) | the five multi-branch answers |

## 4. Automatic screen layout (WP-3)

The POS already has an engine (`src/lib/posLayout.ts`, v1.81.0): it measures the real container and picks the
mode, panel widths and product columns; the Settings preview and the POS call the same pure functions.
Extend the same idea to every page:

* **Breakpoint tokens** set once on `<html>` from the window size and pointer type: `data-screen="phone | tablet | desktop | tv"`,
  `data-density="compact | comfortable"`, `--page-gutter`, `--grid-min-card`.
* Shared components read them: table → card list on phone, filter bar wraps, dialogs become bottom sheets on phone,
  tap targets ≥ 44 px on touch, 32–40 px on mouse.
* Saved per machine (like printers). A "Screen" tab in Settings shows the current profile and lets the owner override it.
* Tests render every page at 360, 768, 1366, 1920 px and fail on horizontal scroll or clipped primary actions.

## 5. Custom Website (WP-8) — design

**Need.** A restaurant that already has its own food-order website (WordPress, Shopify, custom code) must be able to
connect it, so orders placed there arrive in the software like any other order, and staff can open that site's
admin from inside the software.

**Settings → Online Order → "My own website"** (a card next to the built-in Website):

1. **Mode**: *Built-in website* (default) · *My own website* · *Both*.
2. **Site address** (https://…) — shown on receipts and in the app; "Open site" and "Open its admin panel" links
   (optional admin URL). The software stores no passwords for that site: the owner signs in there, in a new tab
   (or the Windows shell's own window).
3. **Order intake**: the software gives the site an **endpoint + a secret key** (shown once, rotatable, stored hashed).
   The site POSTs each order as JSON; the request carries a signature (`HMAC-SHA256(body, key)`), a timestamp
   (±5 min) and an idempotency key (a repeated order is accepted once).
4. **Mapping**: the payload uses the same shape as the built-in website's order (customer, lines by item code or
   name, order type, address, payment method, notes). Unknown items are accepted as *custom lines* with a warning
   so a sale is never lost, and listed in a "Needs matching" tray.
5. **Arrival**: the order appears in Online approvals / Retrieve like a built-in website order, with a source badge
   (*Own website*), prints a KOT per the auto-KOT rule, and follows the owner's switches (delivery, pickup, minimum).
6. **Health**: last order received, last error, "Send a test order" button, 7-day count.
7. **Super Admin**: can see which restaurants use a custom site and open the same panel (read-only link).

**Security rules:** HMAC + timestamp + idempotency; per-restaurant rate limit; body size cap; the intake runs the same
validation as `public_place_order` (so that RPC is fixed first — S-3); the secret never appears in logs; revocation is
one click. **Needs approval and a DB backup:** one table for the key hash/health and one intake function — nothing is
created until the owner confirms.

## 6. International standard pack (WP-10)

* **Money and tax**: any currency (symbol, decimals, rounding rule), inclusive / exclusive tax, several tax rates
  per item, tax invoice fields (VAT / GST / NTN / TRN), per-country receipt rules.
* **Languages**: English, Urdu (RTL), Arabic (RTL), more by adding a dictionary; all text in one dictionary, direction from the language,
  numerals and date formats per locale.
* **Accessibility**: WCAG 2.2 AA — contrast checked per colour scheme, keyboard paths on every screen, visible focus
  ring (already in the design), reduced-motion, screen-reader names on icon buttons.
* **Privacy & payment**: customer data export / delete on request (GDPR-style), no card data stored (PCI scope kept
  at the payment provider), audit log of staff actions (exists), session timeout, device approval (exists).
* **Reliability**: offline-first till with a retry queue and a visible state (exists), daily automatic backup,
  Day Close archive-not-delete (exists), health page for Super Admin.
* **Scale**: per-restaurant isolation (RLS, verified in the security review), branch scoping, indexes reviewed per release.
* **Brand kit**: logo lock-ups, app icons, store-listing screenshots, a one-page brand sheet (BRAND-SYSTEM.md extended).

## 7. What each delivery contains

Code + tests (full suite green) + a QA/UAT note + CHANGELOG line + the ZIP; every user-visible change is also checked
in a real browser screenshot before it is called done. Anything not executed is said so plainly.
