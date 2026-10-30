# DT POS Enterprise — Technical Audit (Steps 1–3)

Date: 2026-10-30 · Repo version audited: **v1.66.0** (`dda3715`) · Production project: Supabase `drpzxzpvkpqfxcjbwypo`

Everything below was read from the code or measured on the live database with **read-only** queries. Nothing in
production was changed during this audit. Where something could not be verified it says **NOT VERIFIED**.

---

## 0. One thing in the brief that does not match the product

The brief says *"This is NOT an offline application."* The product **is offline-first by design**
(`docs/DT-POS-ARCHITECTURE.md`, `src/lib/orderNumbers.ts`): a bill saves and prints locally and never waits for the
network; a deferred queue uploads it afterwards. The Windows shell does exactly what the brief asks otherwise (same
cloud backend, no second database) — it serves the *same* web bundle over `app://` and talks to the *same* Supabase.

Removing offline-first would be a rewrite of the sync engine and would stop billing during a network drop. I have
**kept it** and treated "connection failure and retry handling" as satisfied by it. If you really want online-only,
that is a separate, large decision — say so and it gets its own plan.

---

## 1. Current architecture

| Layer | What it is | Where |
|---|---|---|
| Web app | React 19 SPA + TanStack Start server functions, Vite, Tailwind | `digitaltarget.digital` |
| Hosting | Cloudflare Pages (`wrangler pages deploy dist --project-name dt-pos`) | `npm run deploy` |
| Backend | Supabase (Postgres 17, PostgREST, RLS, Auth, Realtime, Storage, 3 Edge Functions) | project `drpzxzpvkpqfxcjbwypo` |
| Local store | `store.ts` snapshot in localStorage + IndexedDB (`localDb`) + deferred sync queue | `src/lib/store.ts`, `deferredSync.ts` |
| Windows app | Electron 33 shell, serves the web bundle over `app://`, IPC for printing/PRA/files | repo `dtpos-desktop` |
| Android | Capacitor shells; Customer = bundled build, Rider/Order Taker = WebView of the live site | repo `dtpos.apk` |

Hosting facts worth knowing: server functions (`createServerFn`) run with the Supabase **service-role** key read from the
Cloudflare environment (`client.server.ts`); the browser only ever holds the publishable key.

### Auth — three separate mechanisms
1. **Owner / Super Admin** — Supabase Auth (email + password).
2. **POS staff** — `user_profiles` + `staff_login_global` RPC (username + password/PIN).
3. **Portal apps (Rider / Order Taker)** — opaque token → `staff_portal_sessions` (30 days, sha256-hashed) → `portal_*` RPCs.
   A portal device has **no Supabase session**, so `auth.uid()` is null and ordinary RLS reads return `200 []`, not an error.
   This was the root of several "data vanished" reports and is why `isPortalOnlyDevice()` exists.

### Data model (important)
- 71 public tables, **RLS enabled on all 71**, 112 `SECURITY DEFINER` functions, 43 tables carry `branch_id`.
- Orders are stored as a **jsonb document** (`orders.data`); the flat columns are an index of it. `order_items` is **populated**
  (7,007 rows covering 3,724 of 3,733 orders) — filled by the trigger `trg_sync_order_items_mirror` (v1.34.0) as a relational copy of the
  document. `order_payments` and `kot_revisions` exist but are **empty**: payments live only inside `orders.data`. (An earlier version of this
  report, and `ARCHITECTURE.md` §7, said `order_items` was empty; that was out of date.) `rowFromDb()` documents which one wins on a conflict.
  `orders` also carries triggers for the number (`trg_resolve_order_number`), money mirror, customer link and sync push — see §5.
- Local ids are not UUIDs; `cloudId()` derives a deterministic UUID from the local id **alone, with no tenant salt**
  (cross-tenant id collision is theoretically possible — see §9).

### Scale today
711 tracked files · 82 pages · 145 components · 141 lib modules · 119 test files · 107 migrations · 3 Edge Functions.
Live data: 4 restaurants, ~3,700 bills (First Chef ≈ 3,400), 13 staff accounts.

---

## 2. Phase status at a glance

| Phase | Status | Evidence |
|---|---|---|
| 1 Inspection | **Done** (this document) | — |
| 2 Electron Windows app | **Built. Single-ZIP build delivered and verified up to packaging; the installer `.exe` itself is NOT VERIFIED here** (§3, §17) | `dtpos-desktop`; ZIP: `npm install` + `npm run build` pass from a fresh extract |
| 3 Data protection | Strategy below (§4). **Backup restore NOT VERIFIED** | — |
| 4 PRA | **Largely built**; real gaps listed (§6). Endpoints NOT VERIFIED | 1,185 lines in `praEims/praQueue/praTransport` |
| 5 Invoice numbering | **Root cause found, fix designed, not applied** (§5) | live data |
| 6 Remove APKs | **Nothing to remove** — none are in this repo (§7) | `git ls-files` |
| 7 Customer website | Exists; redesign waits for your references | — |
| 8 External integration | **Does not exist** — design in §8 | no tables, no API keys, no webhooks |
| 9 / 10 Order Taker / Rider | Backend exists (`portal_*`); redesign waits for your references | — |
| 11 Multi-branch | Core money tables (orders, items, counters) **proven isolated**; **real leaks found in 5 other tables** and role-gating gaps (§9, `2026-10-30-security-findings.md`) | rolled-back probes as a branch cashier |
| 12 Duplicate modules | Report in §10 — **waiting for your approval** | — |
| 13 Login bug | Root cause fixed in v1.56.2; data confirms (§11) | 0 case collisions |
| 14 Super Admin | Message bug **not reproducible**; "client" flow **unclear** (§12) | — |
| 15 UI/UX | References analysed (§13). **Shipped v1.67–v1.69:** Payment screen, kilogram panel, 21 themes, product icon | tests + Chromium screenshots (§17) |
| 16 Receipts/KOT/tokens | Engine exists; 58/80 mm supported; template catalogue in references (§13) | — |
| 17 Owner dashboard | `/owner` page exists (v1.64.0), read-only | — |
| 18 Security/perf | §14 | advisors read in full |
| 19 Testing | `2026-10-30-testing-report.md` | 1,951 unit tests pass; 17-item checklist with status |

---

## 3. Electron Windows application (Phase 2)

Repository `dtpos-desktop` (v1.26.9, 27 files, 1,735 lines of source). Checked against your 16 requirements:

| # | Requirement | State |
|---|---|---|
| 1–2 | Main process, preload | Yes (`src/main`, `src/preload`) |
| 3–5 | Secure window | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, devtools off when packaged |
| 6 | Secure IPC | Typed channel list (`InvokeChannel`); only channels registered through `ipc/registry.ts` exist. **NOT VERIFIED:** that the preload exposes nothing beyond that list (not read line by line) |
| 7–8 | Window, icon, branding | Yes; icon is `build/icon.png` (to be replaced — see §13) |
| 10–11 | Connectivity / retry | Inherited from the web app's offline-first queue |
| 12 | Session handling | Same Supabase session as web; CSP limits `connect-src` to Supabase + the site |
| 13–16 | Installer, version, packaging | `electron-builder.yml`: NSIS (per-machine, not one-click) + portable; `deleteAppDataOnUninstall: false` |

**The gap, and what was done:** the brief wants *one ZIP* that builds with `npm install → npm run build → npm run dist`. It was two
repos: the Electron repo needs the web bundle copied in first. A combined ZIP now exists (§17) with a root `scripts/build-all.mjs`
that runs both in order. **NOT VERIFIED:** the Windows installer `.exe` — packaging stops at `release/win-unpacked/DT POS.exe`
on Linux because the icon/version step needs wine. On Windows that step uses its own binary; the existing CI workflow builds on `windows-latest`.

**A versioning defect found while doing it:** the shell was `1.26.9` while the POS was `1.6x`. The POS decides "update available" by
comparing its own version with `getAppVersion()` of the installed shell, so every installed copy looked permanently out of date
until reinstalled. The ZIP's build script now stamps the shell's version from the POS's, so the installer is named after what it contains.

No code-signing certificate is configured → Windows SmartScreen will warn on first run. That is a purchase, not a code change.

---

## 4. Production data protection (Phase 3)

### Risks found
1. **Backups are NOT VERIFIED.** I have no tool that lists or restores Supabase backups. Whether point-in-time recovery is
   on depends on your plan. *Please check Dashboard → Database → Backups before any schema change.*
2. **28 live functions are not in `supabase/migrations`** (per `ARCHITECTURE.md` §7): the repo cannot rebuild the backend.
   Action: `supabase db pull` into a new migration. Read-only, low risk, high value.
3. `reset_order_counter(branch, start)` lets an owner/admin/manager *lower* the invoice counter. It cannot cause a duplicate
   (the allocator uses `greatest(counter, max(bill))+1`), but it is a "reset invoices" lever and should be audited or removed.
4. Local-id → UUID derivation has no tenant salt (cross-tenant collision risk; none observed).
5. Day Close before v1.27.1 **hard-deleted** bills (per the code's own comments; see §5). Current code soft-archives.

### Rules I will follow for every database change
- Additive only: `create ... if not exists`, nullable columns, new functions. No `drop`, no `truncate`, no `delete`, no rewrite of existing rows.
- Each change ships with its own rollback script (below) and is applied through a migration file, never ad-hoc.
- Before applying: row counts of the touched tables recorded; after applying: re-counted and compared.
- Anything that touches `orders`, invoices or credentials waits for the backup check in item 1.

### Rollback template (additive changes only)
```sql
-- undo for §5 (example): only drops objects this change created
drop trigger if exists orders_issue_invoice_no on public.orders;
drop function if exists public.issue_invoice_no();
drop table    if exists public.invoice_counters;
alter table public.orders drop column if exists invoice_no, drop column if exists invoice_issued_at;
```

---

## 5. Billing / invoice numbering (Phase 5) — root cause

### What the live data shows (First Chef, 3,412 numbered bills; read-only queries)
| Check | Result |
|---|---|
| Duplicate numbers | **0** — unique index `(tenant_id, branch_id, order_number)` holds |
| Receipts out of order **by payment time** | **1,115 of 3,177 paid bills = 35.1%** |
| Numbers that exist in no bill (gaps) | 699 of 4,078 |
| Where the gaps are | 329 in one band (500–999); then a steady 40–70 per 500 (~10%) |
| Counter vs bills | Self-heals: `next_order_number` uses `greatest(counter, max(bill)) + 1` |
| A clean tenant (Butt Grilled fish) | 1001→1078, **no gap, no inversion** — the allocator is correct when used alone |

### Why it moves
1. **The number is issued when the bill is *opened*, but the customer receives the invoice when it is *paid*.**
   `POSScreen.tsx:881`, `TablesPage.tsx:472`, `tokens.ts:124` all call `getNextOrderNumberAsync()` at order creation.
   A dine-in bill stays open for an hour or two (the inversions sampled were 29–119 minutes), so a bill opened at 16:20 holds
   #3656 while bills opened later and paid sooner already printed #3679. **This is the main cause and it is by design of
   "one number for the order", not a race.**
2. **Numbers are burned.** The server allocation races a 1.5 s timeout (`orderNumbers.ts`). A slow-but-successful call consumes
   a number and the till falls back to its *local* counter (a different series). Abandoned/removed bills also leave holes.
3. **Local counter fallback** (offline, no branch selected as owner/admin → `canAllocateFromServer()` false) mints numbers from
   a per-device counter that never reconciles with the server one. Several tenants show two series (e.g. 1…30 and 1000+).
4. **Printed numbers change afterwards — measured.** Two mechanisms: the client's `emitOrderRenumbered`, and a **server-side BEFORE INSERT trigger,
   `trg_resolve_order_number`**, which on a collision gives the arriving bill `max(order_number) + 1` and keeps the number the till printed in
   `data.originalOrderNumber`. **181 bills (4.8% of 3,733) carry `originalOrderNumber`** — 138 at First Chef Main Branch, 21 Butt Grilled fish,
   14 + 6 at My Restaurant, 2 at First Chef's second branch; **163 of them are paid**. The biggest jump is 889 numbers. So the receipt in the customer's
   hand shows a different number from the system for those bills, and they land at the *end* of the sequence rather than where they were made.
   The printed number is preserved, so a paper receipt can be traced — which is the right instinct — but for tax compliance a bill's number must never
   change after it is printed. The proposed `invoice_no` (below) is issued once, at payment, and is never rewritten, so it removes the cause; this trigger
   would stay for `order_number` (the kitchen/token reference) and be left exactly as it is.
5. Historical: before v1.27.1 Day Close hard-deleted bills (stated in the code's own comments). That *probably* explains the 329-number hole in one band, but the data cannot prove it — **NOT VERIFIED**.

### Proposed fix (design only — **not applied**)
Keep `order_number` exactly as it is (it is the kitchen/token reference and it is history). Add a **separate** invoice number
issued at the moment of payment, inside the same database transaction that marks the bill paid.

```sql
-- all additive; nothing existing is read, rewritten or renumbered
alter table public.orders
  add column if not exists invoice_no integer,
  add column if not exists invoice_issued_at timestamptz;

create unique index if not exists orders_invoice_no_per_branch
  on public.orders (tenant_id, branch_id, invoice_no) where invoice_no is not null;

create table if not exists public.invoice_counters (
  tenant_id uuid not null, branch_id uuid, last_value integer not null default 0,
  primary key (tenant_id, branch_id));          -- RLS on, no client policy: only the trigger touches it

-- BEFORE UPDATE trigger: when status becomes 'paid' and invoice_no is null, take the next value
-- from invoice_counters (row-locked UPDATE ... RETURNING) and stamp it. Idempotent: never overwrites.
```
Why a trigger: it fires for **every** write path (till, Order Taker portal RPC, sync batch), runs in the paying transaction
(a failed payment issues nothing), is restart-proof (state lives in the database) and is concurrency-safe (row lock).
Historical bills keep `invoice_no = NULL` and keep showing `order_number` — **nothing is backfilled or renumbered.**

**Decision for you** (offline billing): a receipt printed while offline cannot carry a server number yet. Options:
(A) show the order number and attach the invoice number on sync; (B) reserve a block of numbers per device (unique and
increasing, gaps possible); (C) PRA restaurants use the fiscal number returned by the fiscal device, which is the legal one anyway.
I recommend **A for ordinary restaurants and C where PRA is on**. Not building B unless you need printed sequential numbers offline.

Also recommended: stop `emitOrderRenumbered` from changing a bill that has already been printed, and put `reset_order_counter`
behind an audit row.

---

## 6. PRA readiness (Phase 4)

Built already, from the PRAL *"Technical Specification for Data Sharing through Software Fiscal Device"* v1.0/1.1 (2019):
invoice mapping + validation (`praEims.ts`), durable queue with backoff, request/response log and audit export (`praQueue.ts`),
local-device and cloud transport (`praTransport.ts`), server proxy with host allow-list `ims.pral.com.pk` + https only
(`pra.functions.ts`), per-tenant settings page, Electron IPC for the `localhost:8524` fiscal device.
Safe defaults: `enabled: false`, `environment: 'sandbox'`, `transport: 'local'`. Nothing is submitted until a restaurant turns it on.

**NOT VERIFIED:** the endpoints, field names and the `Code "100"` success rule come from the 2019 spec already in the code. I have
no access to the current official document or to sandbox credentials, so I cannot confirm they are still current. I have not invented any.

Real gaps:
1. **The request/response log and queue live on the till only** (IndexedDB / JSON). There is no server-side table, so no cloud tax
   report, no view across devices, and the audit trail is lost with the device. Only `praStatus`/`praInvoiceNumber` ride along on the order.
2. Duplicate prevention is per-device (`orderId` coalescing). Two tills opening the same bill are not guarded server-side.
3. No cloud-side tax report grouped by restaurant/branch/period.
4. Invoice numbering (§5) must exist first, so the tax invoice and the internal bill are separate series.

Needed from you before any live use: the current PRA spec, sandbox POS ID/credentials, and the sandbox test sign-off. Live stays off until then.

---

## 7. APKs and build artifacts (Phase 6)

`git ls-files` finds **no** `.apk`, `.aab`, `android/` folder or Capacitor dependency in this repo. What remains: 304 KB of
`android-icons/` and three small `capacitor.*.config.json` files that future apps need. **Nothing was deleted — nothing needed to be.**
APK projects live in `dtpos.apk`; its "build all" no longer includes the Customer app (branch `claude/hybrid-pos-sync-audit-o8ixc8`, not yet merged to its `main`).
Five dependencies are not imported directly (`@hookform/resolvers`, `@tailwindcss/vite`, `@tanstack/router-plugin`, `date-fns`,
`tw-animate-css`); two are almost certainly loaded by the build wrapper, so **none will be removed without a per-package check.**

---

## 8. External website integration (Phase 8) — design

Today there is **nothing**: no API-key table, no webhook table, no integration log. Customer orders enter only through the
`public_place_order` RPC. Proposed (all new tables, all additive, RLS by tenant):

| Table | Purpose |
|---|---|
| `integration_sites` | tenant, branch scope, kind (`custom` / `wordpress` / `shopify`), status, allowed origins |
| `integration_keys` | **hash only** of the key, prefix for display, scopes (`menu:read`, `orders:write`, …), `expires_at`, `revoked_at`, rotation link |
| `integration_webhooks` | target URL, event list, HMAC signing secret (sealed), active flag |
| `integration_events` | outbox: event, payload, attempts, next retry, delivered_at — gives retry and an audit log |
| `integration_logs` | every inbound call: key prefix, route, status, latency, no secrets, no PII beyond order refs |

Flow: owner registers a site → system shows the key **once** → site calls a versioned REST edge function
(`GET /menu`, `POST /orders` with an idempotency key, `GET /orders/:id`) → the order lands as `pending_approval` in the existing
Online Order Approval screen → approve/reject emits a signed webhook back. WordPress/Shopify become thin connectors on the same
API (no store admin password is ever requested). Rate-limit per key; keys scoped to a branch. This needs your go-ahead on the schema.

---

## 9. Multi-branch (Phase 11)

Already enforced in the database: `auth_tenant_id()`, `auth_branch_ids()`, `can_access_branch()`; orders, payments, shifts and
the like carry branch policies. **27 of the 43 tables that have `branch_id` have a policy that mentions branches. 16 do not**
(their policy is tenant-wide):

`account_categories, advances, employees, leaves, module_documents, parties, payslips, pending_owners, recipes, service_calls,
staff_audit_logs, staff_locations, staff_portal_sessions, sync_operations, tenant_settings, user_profiles`

Classification (a judgement from table purpose — **NOT VERIFIED** per table):
- Probably correct tenant-wide: `account_categories, parties, recipes, tenant_settings, user_profiles`; `staff_portal_sessions` has no policy at all (deny-all, accessed only through RPCs — correct); `pending_owners` is sign-up.
- **Branch-sensitive and worth fixing:** `employees, advances, leaves, payslips` (payroll), `service_calls`, `staff_audit_logs`, `staff_locations`, `sync_operations`, and `module_documents` (many kinds).
  Frontend filtering (v1.63/v1.66 `scopeToBranch`) is cosmetic, **not security**.

**Now measured, not assumed** (rolled-back probes as a burewala cashier; full detail in `2026-10-30-security-findings.md`):
`orders` 36 own / 0 other, `order_items` 97 / 0, `order_counters` 1 / 0 — **the money path is isolated by branch in the database.**
Real leaks to sibling branches: `staff_audit_logs` (86 rows), `staff_locations` (37 — staff GPS), `module_documents` (17).
Beyond branches, **role** gates are missing: any cashier can read and write `employees` / `payslips` / `advances` (CNIC, salary) and
`tenant_settings` (which holds the licence flags Super Admin sets), and could read colleagues' PIN hashes (fixed in v1.70.0).
Most other branch-scoped tables hold no rows today, so their isolation is **unproven** until a seeded test harness exists.

Safest rollout: add branch-aware *restrictive* policies only for branch-bound roles, leaving owners/admins (who see every branch)
exactly as they are; ship one table at a time behind a test that signs in as a branch cashier and asserts zero sibling rows.
The target model *Organization → Brand → Branch → User → Role → Permission* needs a new `organizations`/`brands` layer above
`tenants`; that is a schema decision and is deliberately **not** started.

---

## 10. Duplicate modules (Phase 12) — **WAITING FOR YOUR APPROVAL. Nothing removed or merged.**

Method: for every page pair I compared the `@/lib` data functions each one imports (Jaccard overlap). Overlap is evidence, not
proof — I have not read each pair line by line.

| Pair | Overlap | Reading |
|---|---|---|
| `KitchenDisplayPage` (`/kitchen`) ~ `KdsTvPage` (`/kds-tv`) | **1.00** (11 of 11 identical) | Same data, two skins (tablet vs TV). **Strongest candidate.** Keep Kitchen Display; fold TV into a display mode. Risk: the TV route is bookmarked on kitchen screens. |
| `CreditsPage` ~ `CreditCustomersPage` | 0.53 | Partly overlapping credit ledgers. Keep Credit Customers (larger, 831 lines); review Credits for unique features first. Risk: money screens. |
| `ReportsPage` ~ `ReportsCenterPage` | 0.32 | Partial. Needs a feature-by-feature read. |
| `BranchesMapPage` ~ `CustomerMapPage` | 0.31 | Different purpose, shared map code. Probably keep both. |
| `LiveMapPage` ~ `LiveRidersMapPage` | 0.06 | **Not** duplicates (staff vs riders). |
| `UpdateSafetyPage` ~ `SuperAdminUpdateSafetyPage` | 0.00 | **Not** duplicates (tenant vs platform). |
| `Login` ~ `OwnerLogin`, `Dashboard` ~ `OwnerManagement`, `StaffAuditLog` ~ `AuditHistory`, `DailyWages` ~ `HR` | ≤ 0.08 | Different data — not duplicates. |

Recommendation: approve only the **KDS pair** as a first consolidation candidate; leave the rest. Tell me which, if any.

---

## 11. Login / password (Phase 13)

Root cause (fixed in v1.56.2): two sign-in paths treated the username's case differently, so a correct password for `Admin`
failed where `admin` worked; a Super Admin reset rewrote the stored form, which is why "resetting fixes it". Live check today:
13 staff accounts, **0** usernames with capitals, **0** case collisions inside a tenant, 0 inactive accounts. No password check
was bypassed and no password was reset in bulk. **NOT RE-TESTED in a browser this session**; covered by the unit tests.

---

## 12. Super Admin (Phase 14)

- **Message read/unread — NOT REPRODUCED.** The server side is correct: `support_mark_read` sets `read_by_admin`, `support_unread_counts`
  counts the same flag, the table is in the realtime publication with `REPLICA IDENTITY FULL`. The live table holds **0** restaurant
  messages, so there is nothing to reproduce against. Weak spots in the client: `markRead` swallows its error with `console.warn`
  (a failure would look exactly like "stays unread"), the unread count is derived from a `limit(300)` list across all tenants, and every
  realtime event re-downloads those 300 rows. Cheap, safe hardening: surface the error, update the local flag optimistically, count server-side.
- **"Client → link restaurant → 'No Restaurant'" — UNCLEAR.** There is no `clients` table and no "No Restaurant" label anywhere in the code.
  The Super Admin "Clients" tab is the list of approved restaurants. I need the exact screen (a screenshot of where "No Restaurant" appears)
  before I can fix a relationship that, as far as the code shows, does not exist as a separate entity.

---

## 13. UI / UX references (Phase 15/16) — analysis

Reference set: 8 screenshots, 6-page PDF, `DESIGN_UI_A_TO_Z.md` (809 lines) and a 133-file gallery (21 screen themes, 52 receipts, 9 KOT, 12 tokens, 5 report slips).
The reference product is the *offline* DT Retail POS (Electron); the document itself says what to port and what not to.

What defines the look: espresso-brown sidebar with an orange filled active pill; warm cream canvas; white 1-px-bordered cards, ~14 px radius,
soft shadow; one orange accent; uppercase muted table headers; segmented controls (Dine-in/Takeaway/Delivery, 80/58 mm, Today/Yesterday…);
KPI cards with an icon chip and one gradient hero card; split sign-in with PIN pad; stacked clock and a printer-status pill in the header;
a red "default admin password" banner; F-key hints on buttons (F2 search, F6 discount, F9 pay).

The five rules worth adopting verbatim: presentation-only themes; one token set, no hex in screens; every theme rule scoped by an attribute;
print documents never inherit screen CSS; **contrast checked by a test, not by eye.** Our theme engine already follows 1, 3 and the premium gate.

Not ported (the document itself advises against): the Windows print host / raster printing (`escposRaster.cjs`), offline licence/device slots, plaintext local passwords.

Requested for implementation (your message): the **Payment screen** and the **kilogram panel** as in the references, themes with branding, a better product icon. **All four shipped — §17.**
Defect found while reading, now fixed (v1.68.0): with any premium theme active the sidebar showed the fixed text `VINCE BY TAIMOOR / Premium Edition` instead of the
restaurant's name (`AppLayout.tsx:163`). The reference rule is "the restaurant's name and logo lead"; Soft Light had inherited the swap too.

---

## 14. Security and performance (Phase 18)

Supabase advisors read in full: security 4 lint types / 127 findings; performance 6 types / 188 findings.

| Finding | Count | Assessment |
|---|---|---|
| `SECURITY DEFINER` functions executable by `anon` | 44 | Mostly intentional (customer ordering, portal login). I read the bodies of `reset_order_counter`, `recycle_bin_restore`, `update_own_tenant_name`, `sync_order_money_mirror`: all reject a null `auth_tenant_id()`, so **not exploitable**, but the `anon` grant should be revoked wherever the function is not meant to be public. |
| …executable by `authenticated` | 79 | Same review. |
| Leaked-password protection off | 1 | Dashboard toggle (Auth settings). Yours to switch on. |
| RLS enabled, no policy | 3 | `customer_otps`, `customer_sessions`, `staff_portal_sessions` — intentional deny-all behind RPCs. |
| Multiple permissive policies | 44 (WARN) | Planner cost; consolidate gradually. |
| `auth_rls_initplan` | 4 (WARN) | Wrap `auth.uid()` in `(select …)`. Safe, mechanical. |
| Duplicate indexes | 3 (WARN) | Safe to drop after a check. |
| Unused indexes / unindexed FKs | 110 / 26 (INFO) | Do not drop blind; many are new. |

Egress (done in v1.65.0): the orders poll re-downloaded the whole collection (1,765 kB per poll for 352 rows). It now reads only changes.
Secrets: tracked `.env` holds only public keys; the service-role key is read server-side from the Cloudflare environment and the client
refuses a service-role key (`supabase.ts`, `buildConfig.test.ts`). Git **history** was not scanned.

---

## 15. Testing status

| Area | Result |
|---|---|
| Unit/integration suite | **1,943 passed, 0 failed, 1 skipped** (`version.test.ts:59`, pre-existing) at v1.69.0 |
| Typecheck / production build | pass |
| Live DB checks in this audit | read-only; numbers above |
| **Not tested** | A real browser session; the Windows installer build; any thermal printer (58/80 mm); PRA sandbox; Rider/Order-Taker on a phone; multi-till concurrency on a real shop floor |
| Needs external credentials | PRA sandbox/production; code-signing certificate; the Supabase backup check |
| Needs a real restaurant | Invoice-number change; branch-policy tightening; receipt/KOT/token templates on real printers |

---

## 16. Recommended sequence

1. You: confirm Supabase backups (§4.1), run `npm run deploy` (14 versions are undeployed: v1.56.3 → v1.69.0), merge the `dtpos.apk` branch.
2. ~~UI you asked for: Payment screen, kilogram panel, theme set with branding, product icon~~ — **shipped (§17).**
3. Invoice numbering (§5), after the backup check and your option choice for offline receipts.
4. PRA: server-side log table + report, then sandbox once you send the spec and credentials.
5. Branch policies, one table at a time, each with a cashier-isolation test (§9).
6. ~~Combined Windows source ZIP with a single build script~~ — **delivered (§17); the Windows `.exe` still needs one real build on Windows.**
7. External website integration schema (§8) on your go-ahead.
8. Duplicate consolidation — only what you approve (§10).

---

## 17. Shipped since this audit (2026-10-30)

*References received after this audit — an ER target model, a floor-plan screen and a dashboard — are noted in `docs/design-references/2026-10-30-references.md`, with a comparison to the live schema.*

| Release | What | Verified by |
|---|---|---|
| **v1.67.0** `cae618e` | **Payment screen** as in the reference: hero *Total payable*, method tiles, *Amount received* with Exact/quick amounts, Change and Due cards, footer *Back to cart* / *Complete Sale [Enter]*. **Kilogram panel**: right-hand, *By weight* (kg/g/pao) or *By amount*, keypad, Quantity/Price. Layout only — the arithmetic moved unchanged into `lib/weightPricing.ts`; the cart line has the same fields. Roman-Urdu UI strings replaced with English. | 42 tests (every payment payload unchanged: exact, over-tender, partial, online; weight maths; keyboard); mutation checks (tests fail when the guard or the maths is broken); Chromium screenshots of both screens in two themes |
| **v1.68.0** `16bc29c` | **21 themes** (13 Modern + 8 DT Retail) from a data table, premium-gated, with the DT Retail look (gradient sidebar and hero, accent pill, branding card). Fixes: the Vince brand name replacing the restaurant's; hero banners fading under white text; light-sidebar highlight. | 77 tests incl. WCAG contrast for every theme (7:1 body, 4.5:1 text, accent-as-text); Chromium screenshots in 6 themes |
| **v1.69.0** `011a5a3` | **Product icon** (the Digital Target mark on a purple squircle; SVG source in `branding/`) for favicon, PWA, Apple touch icon; desktop icon in `dtpos-desktop` (`b7b79e5`). **Currency:** the POS cart panel no longer prints a hand-typed "PKR". | 5 tests; icon checked at 16–128 px on light and dark |
| **v1.70.0** | **Security:** staff can no longer read each other's PIN hashes (column-level grant on `user_profiles`; applied to production, verified, one-statement rollback). Six findings recorded, five still open — `docs/audit/2026-10-30-security-findings.md`. | 8 guard tests (mutation-checked); post-apply probes: hash refused, app reads / RLS helpers / orders / login path unchanged |
| **ZIP** | `release-zip/DT-POS-Enterprise-Windows-source-v1.69.0.zip` — 754 files, 3.9 MB, no `node_modules`/build output. Root `npm install`, `npm run build`, `npm run dist`; `README-BUILD.md`; `.env.example`. | From a **fresh extract**: `npm install` exit 0 (23 s), `npm run build` OK (9 s), shell tests 27/27, shell typecheck clean |

### Multi-country gap (new finding)
The currency layer exists (`lib/currency.ts`), but **136 hand-typed "PKR" strings in 20 files** bypass it, so a restaurant on SAR/AED still sees rupees.
10 were fixed in the POS cart panel through `screenAmount()`, which prints exactly what a PKR install always printed. About 126 remain
(Credit Customers 33, Reports 25, Credits 13, Receiving 10, Analytics 6, Tables/Settings 5 each, and a handful elsewhere).
They sit in accounting-adjacent screens and exports, so they need a pass of their own with tests — not a find-and-replace.

### Not verified
- The real `AppLayout` was not rendered (it imports server-only TanStack Start code and cannot run in a plain page); the sidebar was checked from a copy of its markup and the same class strings.
- The Windows installer `.exe`; the installed app starting; a thermal printer; a cashier using the new payment/kg screens on a real shop floor.
- Android launcher icons: they are built into each APK by `dtpos.apk`; changing a web file does not change an installed app's icon.
