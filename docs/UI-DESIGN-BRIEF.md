# DT-POS Enterprise — UI Structure & Design Brief

**Audience:** UI/UX designer producing a new design system + screen designs for DT-POS Enterprise.
**Rule #1:** Backend, database (Supabase), auth, business logic, print engine and data structures are FROZEN. Only the presentation layer (layout, colors, typography, spacing, components, motion) may change.

---

## 1. Product summary

DT-POS Enterprise is an **offline-first, multi-tenant, multi-branch restaurant POS** used by:

| User type | Where they work | Device |
|---|---|---|
| Cashier / Waiter | POS billing screen | Desktop / touch screen, 100% zoom, 1366×768 and up |
| Kitchen staff | Kitchen Display / KDS TV | Large TV, read from distance |
| Manager / Owner | Back-office (reports, inventory, HR, accounts, branches) | Desktop laptop |
| Rider | Rider portal | Mobile phone |
| Customer | Online order + track order portal | Mobile phone |
| Super Admin (Digital Target) | Super Admin panel — sells/manages restaurants | Desktop |

Software is sold internationally. UI must be **English-first** (Urdu / Roman Urdu only appear when country = Pakistan). Urdu text is RTL and uses Nastaleeq fonts on receipts.

---

## 2. Tech stack (constrains the design)

- React 18 + TypeScript, Vite, Electron desktop wrapper
- **Tailwind CSS** utility classes + **shadcn/ui** component library (Radix primitives)
- Icons: **lucide-react**
- Charts: **recharts**; Maps: **Leaflet**
- Toasts: **sonner**
- Theme tokens: HSL CSS variables in `src/index.css`, consumed by `tailwind.config.ts`

**Implication for the designer:** deliver the design as **design tokens + component states**, not as flat pictures. Every color must be expressible as an HSL token. Available component set is the shadcn catalogue (see §7).

---

## 3. Current design system (what exists today)

### 3.1 Brand palette (HSL tokens, light mode)

| Token | Value | Hex-ish | Use |
|---|---|---|---|
| `--primary` | 273 89% 23% | `#3C096C` | Brand deep purple, sidebar, primary buttons |
| `--primary-glow` | 272 73% 35% | `#5A189A` | Gradient partner |
| `--accent` / `--gold` | 276 100% 84% | `#E0AAFF` | Soft accent, active pills |
| `--background` | 270 30% 98% | near-white lilac | App background |
| `--foreground` | 274 60% 10% | near-black purple | Text |
| `--card` | 0 0% 100% | white | Cards, panels |
| `--muted` / `--muted-foreground` | 270 20% 95% / 274 15% 38% | | Secondary surfaces & text |
| `--border` / `--input` / `--ring` | 274 30% 88% … | | Outlines, focus |
| `--destructive` | 0 84% 56% | `#EF4444` | Delete / void |

### 3.2 Status color scale (used by orders, tables, bills — semantics must survive redesign)

`success #22C55E` · `warning #F59E0B` · `danger #EF4444` · `info #0EA5E9` · `pending` · `cooking (orange)` · `onway (blue)` · `delivered (green)` · `cancelled (grey)` · `teal` · `purple` · table states: `free` (green), `running` (yellow), `pending-payment` (red), `closed` (dark).

### 3.3 POS-specific surfaces
`--pos-sidebar` (deep purple), `--pos-sidebar-foreground`, `--pos-cart` (white), `--pos-grid-bg` (light lilac).

### 3.4 Radius, shadow, motion
- `--radius: 0.875rem` (14px); pills use `rounded-full`.
- `--shadow-soft`, `--shadow-card`, `--shadow-elegant` (purple-tinted), `--shadow-gold`.
- Gradients: `--gradient-primary`, `--gradient-sidebar`, `--gradient-hero`, `--gradient-gold`.
- Transition: `all .25s cubic-bezier(.4,0,.2,1)`.

### 3.5 Typography
- UI font today: **system stack** (`-apple-system, Segoe UI, system-ui…`) — chosen for offline/Electron safety. **Any new font must be bundled locally (no Google Fonts CDN).**
- Headings: weight 800, letter-spacing −0.015em.
- Receipt/print font: monospace 12px on 80mm paper; Urdu receipts use bundled `Jameel Noori Nastaleeq`, `Aseer Unicode`, `AA Sameer Armaa`.

### 3.6 Theme modes already supported
`light`, `dark`, and `purple` (gradient admin shell `#1a0633 → #3c096c → #5b1499` with glass header). Redesign must keep all three.

---

## 4. Application shells (4 distinct layouts)

### A. Back-office shell — `src/components/AppLayout.tsx`
```
┌──────────────────────────────────────────────────────────┐
│ Top header: brand · branch selector · sync badge · user  │
├────────────┬─────────────────────────────────────────────┤
│ Sidebar    │  Page content (single scroll region)        │
│ collapsible│                                             │
│ grouped    │                                             │
│ accordion  │                                             │
└────────────┴─────────────────────────────────────────────┘
```
- Sidebar width uses `clamp()`; collapsible to icon rail; open groups persisted in `localStorage` (`pos-sidebar-groups`).
- Root container is `overflow-hidden`; **only inner regions scroll** (no page-level scroll).

### B. POS billing shell — `src/pages/POSScreen.tsx` (most important screen)
```
┌───────┬──────────────────────────────────────┬───────────────┐
│ Cat   │ Search bar + Manual item             │ CART          │
│ side  │ Category pill ribbon (h-scroll)      │ 3–4 rows      │
│ list  │ ─────────────────────────────────    │ visible       │
│(narrow│ Item grid (cards w/ image)           │ ─────────────  │
│ 144–  │ scrolls internally                   │ Billing totals │
│ 176px)│                                      │ Numpad         │
│       │                                      │ ── pinned ──   │
│       │                                      │ PAY / TOKEN /  │
│       │                                      │ Running/Credit/│
│       │                                      │ Void buttons   │
└───────┴──────────────────────────────────────┴───────────────┘
```
Hard rules already agreed with the client:
- Everything fits at **100% browser zoom** — no page scroll ever.
- Cart shows **3–4 line items** without scrolling; cart list scrolls internally.
- Action buttons (PAY, PRINT TOKEN, Running / Credit / Void, Special Note) are **always visible** (pinned, `shrink-0`).
- Numpad + action buttons: **bold/black weight**, compact height, big touch targets.

### C. Full-screen / kiosk screens (no sidebar)
Kitchen Display, KDS TV, Login, Owner Login, Online Order portal, Track Order, Rider portal, Order-Taker portal.

### D. Super Admin shell — `src/pages/SuperAdminPage.tsx`
Own header with light/dark/purple mode toggle + a horizontal tab strip:
`Restaurants · Clients · Messages · Reports · Packages · Plans · Devices · Live Map · Team · Monitoring · Releases · Cleanup`.

---

## 5. Navigation map (sidebar groups → modules)

Order of groups is fixed: **Operations → Marketing → Inventory → Accounts → Staff → Reports → Admin**. Visibility is driven by role + subscription plan, so every group must render gracefully when partially empty.

- **Operations:** POS, Tables, Retrieve (running bills), Delivery, Pickup Orders, Rider App, Kitchen, Credits/Udhaar, Credit Customers (Ledger), Void/Comp/Cancel, Retray, Token Management, Refund, Pending Payments, Bill Reprint, Foodpanda Orders, Customer Portal/Website, Online Order Approval, Blocked Customers, Blocked Locations
- **Marketing:** WhatsApp, Customers, Customer Map, CRM Insights, Contacts, Promo Codes
- **Inventory:** Menu, Deals/Combos, Inventory, Recipes, Wastage, Receiving, Barcode & Labels
- **Accounts:** Accounts, Party Master, Daily Wages, Shift & Cash Drawer
- **Staff:** HR, Users, Riders
- **Reports:** Dashboard, Profitability, Cost Reports, Reports, Reports Center, Advanced Item/Variant Reports, Item Sales Report, Admin Sales History, Bill/KOT Edit History, Bill Editor
- **Admin:** Settings, Printing Center, Branches, Branches Map, Live Map, Live Riders Map, Devices, Backup, Data Integrity, Module Management, PRA EIMS, Software Version, Update Safety

Total: **80 page components**. A redesign must therefore be **system-driven** (page templates), not per-page bespoke art.

---

## 6. Recurring page templates (design these, not 80 screens)

1. **List / table page** — header (title, filters, date-range, search, primary action) + data table + row actions + pagination/empty/loading states. Used by ~35 pages.
2. **Board page** — status columns / card grid with live updates (Delivery Board, Kitchen, Pickup, Online Approval).
3. **Dashboard page** — KPI stat cards + recharts panels + top-N lists.
4. **Form / settings page** — sectioned cards, tabs, switches, helper text (helper text must be plain English).
5. **Dialog with live preview** — two-column: form left, live preview right (Branch editor + invoice preview, Receipt style editor).
6. **Map page** — full-bleed Leaflet canvas + floating filter card + marker legend + detail drawer.
7. **Print/receipt surfaces** — 80mm receipt, KOT slip, token slip. **Print CSS is exempt from the redesign** and must keep exact template fidelity.

Global states needed for every template: **loading skeleton, empty state, error state, offline/sync-pending state, permission-denied state.**

---

## 7. Component inventory available

shadcn/ui: accordion, alert, alert-dialog, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner (toast), switch, table, tabs, textarea, toggle, toggle-group, tooltip.

Notable custom components the design must cover: `SyncStatusBadge`, `SyncPendingChip`, `PlanStatusWidget`, `HeaderNotificationBar`, `NumpadDialog`, `PaymentDialog`, `OrderDetailDialog`, `ManagerAuthDialog`, `TableShapePreview`, `TableQR`, `ReceiptPreview` / `StandardReceipt` / `KitchenReceipt` / `TokenSlip`, `SplashScreen`, `LeafletMap`, `SupportChatWidget`, `WhatsAppFloat`, `PoweredByBrand`.

---

## 8. Behaviour constraints the design must respect

1. **Offline-first.** No CDN assets, no remote fonts/images. Everything bundles locally.
2. **Speed.** Splash is 550ms; screens must feel instant during rush hours. Avoid heavy blur/shadow stacks on the POS item grid, avoid large hero imagery in operational screens.
3. **Sync visibility.** A persistent indicator communicates: synced / pending N / offline / error. This is business-critical, must be prominent but not alarming.
4. **Role & plan gating.** Menu items and buttons appear/disappear per role and subscription plan.
5. **Multi-branch.** Branch selector is always reachable; branch context must be visible on data screens.
6. **Localization.** English default; Urdu/Roman Urdu only for Pakistan → design must survive RTL text and longer strings. Helper text in English.
7. **Touch targets.** POS buttons ≥ 44px effective hit area; numpad keys bold, high contrast.
8. **Density.** Back-office is data-dense; prefer compact rows (32–40px) with clear zebra/hover.
9. **Accessibility.** Contrast ≥ 4.5:1 for text in all three theme modes.

---

## 9. What to deliver (designer checklist)

**A. Foundations**
- Color tokens for light / dark / purple modes, expressed as HSL triplets matching the token names in §3.
- Type scale (display → caption) with a locally-bundleable font family, plus Urdu fallback pairing.
- Spacing scale, radius scale, elevation/shadow scale, border treatment, focus ring.
- Motion spec: duration + easing for hover, press, dialog, toast, page transition.

**B. Core components** (default / hover / active / focus / disabled / loading / error)
Button variants (primary, secondary, ghost, destructive, POS action), input, select, switch, checkbox, tabs, badge/status chip (all statuses from §3.2), card, table row, dialog, drawer/sheet, toast, sidebar item (active/collapsed), category pill, KPI stat card, empty state, skeleton.

**C. Key screens (high fidelity)**
1. POS billing screen (1366×768 and 1920×1080)
2. Tables screen
3. Kitchen Display + KDS TV
4. Dashboard
5. A list/table page (e.g. Menu Manager or Customers)
6. Settings page (tabbed form)
7. Branches add/edit dialog with live invoice preview
8. Login + Owner login + splash
9. Super Admin panel (Restaurants tab + Live Map tab), in all three modes
10. Mobile: Online Order portal, Track Order, Rider portal

**D. Handoff format**
Figma file with published styles/variables + a written token table (`token name → value`). Screens must be built from the shared components so implementation is a token+template swap, not a rewrite.

---

## 10. Out of scope (do not redesign)

- Printed receipt / KOT / token templates and print CSS (fidelity is contractual).
- Data models, field names, RPC/API shapes.
- Auth flows, permission rules, plan gating logic.
- Sync engine behaviour, order numbering, stock ledger.

---

## 11. Reference files for the developer implementing the new design

| Concern | File |
|---|---|
| Theme tokens & utilities | `src/index.css`, `tailwind.config.ts` |
| Back-office shell | `src/components/AppLayout.tsx` |
| Navigation & permissions | `src/lib/permissions.ts` |
| POS screen | `src/pages/POSScreen.tsx` |
| Super Admin panel | `src/pages/SuperAdminPage.tsx` |
| Routing | `src/App.tsx` |
| Receipts (frozen) | `src/components/StandardReceipt.tsx`, `KitchenReceipt.tsx`, `TokenSlip.tsx`, `src/printing/printCss.ts` |
| Architecture / sync | `docs/DT-POS-ARCHITECTURE.md` |
