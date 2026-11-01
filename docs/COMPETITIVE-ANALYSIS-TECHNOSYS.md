# DT Enterprise POS vs Technosys Business Expert — an evidence-based analysis

**Date:** 2026-11-01 · **Version analysed:** v1.78.0 (`digitaltarget.digital`, branch `claude/hybrid-pos-sync-audit-o8ixc8`)

The owner's instruction: benchmark against Technosys (technosysint.com) and its Business Expert ERP; do not merely match it; make
**no unsupported claims** — verify through the source, the database and tests.

## 0. How to read this, and what could not be verified

**Our side — verified.** Every statement about DT Enterprise POS below comes from the source tree, the live Supabase project
(read-only queries on 2026-11-01), or the test suite (169 test files; 2,682 tests pass). Where a claim rests on a file, the file
is named.

**Technosys side — NOT fully verified.** `technosysint.com` could not be opened from this session (the host is outside the
environment's allowed network domains), so **no Technosys page was read directly**. The only Technosys information used is what a
web search returned as indexed excerpts of Technosys's own pages:

| Excerpt (vendor's own words, as returned by search) | Where it came from |
|---|---|
| Business Expert ERP is described as the company's best-selling product; operating in Pakistan **since 1998**; focus on **retail ERP and POS** | `technosysint.com/business-expert-erp/`, LinkedIn company page |
| "600+ clients" (self-reported) | `technosysint.com/products/` |
| Modules listed: Point of Sale, Supply Chain Management, **Production**, **Accounts and Finance**, **HRIS**, CRM, Sales Order & Delivery, **Recipe Management**, SMS, **Guest Reservation**, **Digital Queue Management** | products page |
| Inventory: reorder alerts; data "from anywhere, anytime" | `technosysint.com/inventory/` |
| HRM: **time-attendance machine integration**, payroll processing | `technosysint.com/hrm/` |
| Vertical pages: automotive, pharmacy (**batch and expiry tracking**), cosmetics & jewelry | vertical pages |

Everything not in that table — pricing, depth of each module, offline behaviour, mobile apps, security model, multi-company
support, API — is **unknown to me** and is marked **NOT VERIFIED** below. It is not assumed absent, and it is not assumed weak.
**To close this gap, either add `technosysint.com` to the session's Allowed domains (Network access) or paste the product
brochure / feature list; the matrix below is built to be re-scored from that.**

One strategic observation that does follow from the excerpts: Technosys presents itself as a **retail-first ERP** (pharmacy,
automotive, jewelry, restaurant as one vertical among several), sold in Pakistan since 1998. DT Enterprise POS is
**restaurant-first and cloud-native multi-tenant**. Those are different shapes of product, which matters for what "outperform"
should mean (§5).

## 1. What DT Enterprise POS is today (verified)

| Fact | Evidence |
|---|---|
| 65 modules in 7 groups (Operations 19, Reports 11, Admin 13, Accounts 4, Inventory 7, Marketing 6, Staff 5) | `src/lib/permissions.ts` |
| 82 pages, 185 library modules | `src/pages`, `src/lib` |
| **Multi-tenant database with row-level security on 71 of 71 tables**, 100 policies, 123 SQL functions, 87 triggers | live project, `pg_class` / `pg_policies` |
| 3 tables with RLS and no policy (customer OTPs, customer sessions, staff portal sessions) — deny-all by design, reached only through functions | live project; advisor "rls_enabled_no_policy" (INFO) |
| 112 SECURITY DEFINER functions, **44 executable by anonymous callers** (the token-based customer / rider / order-taker portals) and 79 by signed-in users | live project; advisor WARN ×2 — each must authorise itself; needs periodic review |
| Leaked-password protection is **off** | advisor WARN — an Auth dashboard setting, one switch |
| Offline-first sync: durable upload queue, merge with tombstones, dead-letter, reconcile and repair tools; realtime reload now reads deltas | `deferredSync`, `syncMerge`, `syncReconcile`, `syncRepair`; v1.77.0 |
| Audit trails: staff actions, bill edits, reprints, payment corrections, version audit | tables `staff_audit_logs`, `order_edit_logs`, `reprint_logs`, `order_payment_corrections`; libs `staffAudit`, `reprintAudit` |

## 2. Feature-by-feature (the owner's twelve areas)

Status key: **Strong** = implemented and tested in our source · **Partial** = exists but shallow · **Gap** = not in our source ·
**NV** = Technosys side not verified.

### 2.1 Complete restaurant ERP and business management
| Capability | DT today | Technosys | Status |
|---|---|---|---|
| POS, tables, KOT, split bill, tokens, refunds, voids, day close, shifts and cash drawer | implemented (`POSScreen`, `splitBill`, `tokenLedger`, `shifts`, `refunds`, `DayClosePage`) | POS listed | **Strong** |
| Supply chain / procurement workflow (purchase order → receive → pay) | **none**: there is a goods-receiving note (`ReceivingPage`) but no purchase order, no approval, no PO-to-GRN match, no supplier return | "Supply Chain Management" listed | **Gap → built in v1.79.0** |
| Production / central kitchen / semi-finished items | **none** (searched `production`, `commissary`, `central kitchen`: no feature code) | "Production" listed | **Gap** |
| Guest reservations / waiting list | **none** (no reservation code) | "Guest Reservation" listed | **Gap** |
| Queue / token management | implemented (`TokenModulePage`, `tokenLedger`, `tokenRules`, token slips) | "Digital Queue Management" listed | **Strong** (customer-facing digital queue screen: Partial) |
| Sales order & delivery | delivery board, rider claim, live tracking (v1.75.0), pickup orders, online-order approval | listed | **Strong** |

### 2.2 Multi-company, multi-brand, multi-branch
| Capability | DT today | Technosys | Status |
|---|---|---|---|
| Multi-branch under one restaurant business (branch list, branch access control, branch invoice identity and prefix, branches map, per-branch order scoping) | `Branch` type, `branchAccess`, v1.63–1.66 branch scoping | NV | **Strong** |
| One tenant = one company; **no layer above tenant** (group / brand / franchise owner seeing several companies) | no `brandId` / `groupId` / `companyId` anywhere in `src/lib` | NV | **Gap** |
| Per-branch financial statements | orders carry `branchId`; transactions, payslips and wastage do not in the type model | NV | **Partial** (see v1.79.0 note) |
| Inter-branch stock transfer | **none** | NV | **Gap** |

### 2.3 Centralised owner management portal
| Capability | DT today | Status |
|---|---|---|
| Owner Management page, owner sign-in, owner shell app | `OwnerManagementPage`, `OwnerLoginPage`, `dtpos.apk` owner shell (design delivered; build **not verified**) | **Partial** |
| Cross-company consolidated view | none (no layer above tenant) | **Gap** |

### 2.4 Advanced Super Admin and SaaS management
| Capability | DT today | Status |
|---|---|---|
| Tenants, plans, packages, per-tenant feature overrides, devices and device limits, releases, support inbox, team, live map, monitor, cleanup | `SuperAdminPage` (2,672 lines) + tables `admin_plans`, `admin_packages`, `admin_invoices`, `admin_payments`, `admin_releases`, `super_admins` | **Strong** |
| Plan gating of modules and premium-theme allotment per tenant | `plans.ts`, `featureEnabled`, `premiumThemeAllowed` | **Strong** |
| Admin panel UX in the reference style; invoice verification online | not yet (requested 2026-11-01) | **Gap** |

### 2.5 Inventory, procurement, recipes and food costing
| Capability | DT today | Technosys | Status |
|---|---|---|---|
| Items with base units, purchase-unit conversions, moving-average cost, low-stock threshold, stock ledger with idempotent movements | `InventoryItem`, `units.ts`, `stockLedger.ts` | "reorder alerts" | **Strong** |
| Goods receiving with landed cost (freight, loading, tax share) | `ReceivingEntry.surcharge`, `baseUnitCost` | NV | **Strong** |
| Recipes per menu item **and per variant**; recipe-based costing, profitability, ingredient consumption, inventory valuation | `Recipe`, `CostingReportsPage`, `ProfitabilityPage` | "Recipe Management" | **Strong** |
| Wastage with reasons and cost | `Wastage`, `WastagePage` | NV | **Strong** |
| Reorder **suggestions** (what to buy, how much, from whom) | alerts only; no suggestion, no PO | reorder alerts only (as excerpted) | **Gap → built in v1.79.0** |
| Batch / lot / **expiry** tracking | `InventoryItem` has none (`expired` exists only as a wastage reason) | pharmacy vertical lists batch and expiry | **Gap** |
| Physical stock count with variance posting | none | NV | **Gap** |
| Sub-recipes / semi-finished items | none | "Production" | **Gap** |

### 2.6 Accounting, finance and HR
| Capability | DT today | Technosys | Status |
|---|---|---|---|
| Income / expense transactions by category and payment method; supplier and customer parties with ledger; cash close; daily wages | `Transaction`, `Party`, `LedgerEntry`, `AccountsPage`, `DailyWagesPage` | "Accounts and Finance" | **Partial** |
| **Financial statements** (profit and loss, cash movement, payables and receivables ageing) | **none** — searched `trial balance`, `balance sheet`, `profit and loss`, `journal`, `bank reconcil`: no code | listed (depth NV) | **Gap → built in v1.79.0** (P&L, cash movement, ageing) |
| Double-entry chart of accounts, journal vouchers, trial balance, balance sheet, bank reconciliation | none | NV | **Gap** (needs a design decision, §4) |
| Pakistan tax: PRA integration (queue, transport) | `praEims`, `praQueue`, `praTransport`, module "PRA EIMS" | NV | **Strong** |
| HR: employees, attendance, leave with approval, payslips, advances | `HRPage`, `Employee`, `Attendance`, `Leave`, `Payslip`, `Advance` | "HRIS", payroll | **Strong** (basic) |
| **Biometric time-attendance machine integration** | none | explicitly listed | **Gap** |
| Shift roster / scheduling, overtime rules | none beyond a plain overtime amount | NV | **Gap** |

### 2.7 Advanced POS and restaurant operations
Strong: dine-in, takeaway, delivery, KOT with diffs and cancel slips, tokens, split bills, weight pricing, deals and combos,
manager approval guard (`actionGuard`), recycle bin, printing centre with raw ESC/POS and per-slip margins (v1.76.0),
KDS (`KitchenDisplayPage`, `KdsTvPage`). **Gaps in the cloud app that the offline POS has:** the customer-facing display
(`CustomerDisplayPage` and its settings card, ~1,370 lines offline, absent in the cloud — requested in the 2026-11-01 directive),
the Modern sale-screen layout and Screen & Layout presets (v1.78.0 note).

### 2.8 Customer CRM, loyalty and marketing
Strong/Partial: loyalty points (earn per Rs 100, redeem rate, minimum), CRM insights (sign-ups, frequency, top customers), promo
codes, WhatsApp, marketing contacts, birthday data, blocked customers and locations; wallet and campaign records exist as synced
modules (`blink-modules`, `cloudDocs`) — their depth was **not** tested here. Gap (no code found): customer segmentation, triggered
journeys (birthday / win-back), loyalty tiers, an SMS gateway (Technosys lists "SMS"; ours is WhatsApp-based).

### 2.9 Mobile applications and online ordering
Strong: customer website with ordering, tracking and rider map; rider app with server-enforced single claim; order-taker app;
online-order approval; Foodpanda orders page. Not verified: the three Android shells on a real phone (builds not executed here).
Technosys side: NV.

### 2.10 Real-time synchronisation and offline operations
Strong (verified): durable queue, tombstone merge, idempotent stock movements, realtime delta reload and rationed rider GPS
(v1.77.0). Not verified: behaviour under a real network split between two tills; the 1,000-row PostgREST default cap (customers
= 2,271 rows) has not been checked against the project setting.

### 2.11 Enterprise security, scalability and performance
Strong: RLS on 71/71 tables; audit trails; secure storage; session isolation; PIN hashing; 2026-10-30 security audit.
Gaps: **no two-factor authentication** (no TOTP/MFA code in `src`), no SSO, no public API or webhooks for customers (searched),
leaked-password protection off, 44 anonymous-callable SECURITY DEFINER functions that need a scheduled review. Scalability: the
client holds each collection in memory and reports are computed in the browser — adequate for one restaurant, a risk for a chain
with years of orders; server-side aggregation is the path (§4).

### 2.12 Premium UI/UX and theme management
Strong: 13 Modern + 8 DT Retail themes, custom themes, Modern shell, More launcher, Module Management (v1.78.0, seen in a real
browser). Open: Modern sale-screen layout; per-restaurant sync of the look.

## 3. Where DT is verifiably strong
Cloud-native multi-tenant isolation at the database (71/71 RLS), offline-first sync with measured egress control, a restaurant
operations core (KOT, tokens, split bill, delivery with live tracking), local tax integration, a modern themed shell, and a
regression suite of 168 test files and 2,737 passing tests (v1.79.0). These are statements about our code; whether Technosys matches them
is **not verified**.

## 4. Where DT is behind, ranked by value × feasibility
1. **Procurement workflow** (PO, approval, receive-against-PO, supplier payable, reorder suggestions) — no PO exists. *Built v1.79.0.*
2. **Financial statements** (P&L, cash movement, ageing) — none exist. *Built v1.79.0.*
3. Double-entry accounting (chart of accounts, journals, trial balance, balance sheet, bank reconciliation) — design decision: layer
   a posting engine over the existing events rather than replace the cash ledger. Larger.
4. Reservations and waiting list; customer-facing digital queue.
5. Batch / expiry, stock count, inter-branch transfer, production and sub-recipes.
6. Multi-brand / group owner layer and consolidated reporting (needs a schema decision above the tenant).
7. Biometric attendance integration and rosters.
8. Two-factor authentication, public API and webhooks, leaked-password protection, SECURITY DEFINER review.
9. Server-side report aggregation for large chains.
10. CRM automation: segments, triggered campaigns, loyalty tiers, SMS.

## 5. What "outperform" can honestly mean
Technosys is, from its own excerpts, a broad retail-first ERP. DT cannot claim to be "more complete" until
items 3–7 above exist and are tested. DT *can* aim at advantages that are plausible for a cloud-native product but **not verified against Technosys**: true multi-tenant SaaS with database-enforced isolation, offline-first sync, live delivery tracking, a modern
themeable UI, and restaurant-specific depth. The plan is to close the ERP breadth gaps in the order above while keeping those.

## 6. Done in this pass
v1.79.0 builds the first two gaps (ranked items 1 and 2):

| Gap | Built | Tests | Not done / limits |
|---|---|---|---|
| Procurement workflow | `src/lib/procurement.ts`, `ProcurementPage` (`/procurement`): draft → approved → sent → partly/fully received → closed/cancelled; receive-against-PO (partial deliveries, freight/extra charges, over-delivery only on an explicit tick); receiving posts stock + moving-average cost through the existing `saveReceivingEntry` and the supplier payable through the existing ledger; reorder suggestions from the last 30 days' usage; drafts grouped per supplier | 26 | Real-Supabase end-to-end not run (document-store path reused; schema/RLS read only); supplier price lists, quotations and 3-way invoice matching are **not** built |
| Financial statements | `src/lib/financials.ts`, `FinancialStatementsPage` (`/financials`): profit and loss (revenue → food cost → expenses → profit), cash movement by method, payables ageing, receivables ageing (credit customers), CSV export | 29 | **Not a double-entry ledger** — no chart of accounts, journals, trial balance or balance sheet; food cost is *theoretical* (recipes × sold), not stock-count based; payroll is not per-branch |

Everything else in §4 (items 3–10) is still open. See `docs/qa/2026-11-01-QAT-UAT-v1.79.0-erp.md`.
