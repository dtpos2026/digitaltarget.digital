# Redevelopment & legacy reset — plan, backups and inventory (2026-10-31)

**Nothing described here as a clean-up has been executed.** This stage produced backups of the source, a read-only inventory of production,
an application register and a design-parity matrix. Production was only ever `SELECT`ed.

## 0. Direction (your instruction, 2026-10-31)

- The **cloud project is the platform** (`digitaltarget.digital` + the Windows shell + the Android apps + the cloud Super Admin). It is **not** to become offline-only.
- The uploaded **v1.21.0 offline edition is a design/theme reference** ("copy the same design"), nothing more. Its Phase 1 audit
  (`2026-10-31-v1.21.0-upload-phase1-audit.md`) stays as a record; its findings only matter if that edition is kept on sale.
- Production data is never cleared without your explicit, written approval, table by table.

## 1. Rules for the reset

1. Back up first; verify the backup before anything else (§2).
2. **Archive, don't delete:** copy candidate rows into a `legacy_archive` schema, compare counts and checksums, and only then — with your approval — remove the originals in one transaction that has a written rollback.
3. Never touch: live or archived orders, order lines, customers with orders, day-closes, shifts, ledger/payments, licences/plans, devices of live tenants, staff accounts of live tenants.
4. The "clean structure" for the new architecture is built by **additive migrations** (new tables/columns alongside the old) and, if you approve the cost, tried first in a **Supabase development branch**, never by emptying today's tables.
5. An old APK, page or module is retired only after its features and integrations are listed in §4 and you approve.

## 2. Backups

### Source — done
`release-zip/DT-POS-source-backup-2026-10-31.zip` (25 MB), with a `MANIFEST.txt` of SHA-256 sums:

| File | What |
|---|---|
| `digitaltarget.digital-full-history-7535118.bundle` | the whole cloud repo, all history, verified (`git bundle verify`). Restore: `git clone <file> digitaltarget.digital` |
| `dtpos-desktop-b7b79e5-snapshot.zip` | Windows shell, working tree (the clone here is shallow; full history is on GitHub) |
| `dtpos.apk-ce0cabd-snapshot.zip` | the three Android apps, working tree (shallow clone; full history on GitHub) |
| `DT-POS-Enterprise-v1.21.0-source-AS-UPLOADED.zip` | your upload, unchanged |
| `DT-POS-Enterprise-Windows-source-v1.70.1-r2.zip` | the Windows build ZIP |

All three repositories also live on GitHub (`dtpos2026/*`); the cloud repo branch `claude/hybrid-pos-sync-audit-o8ixc8` is pushed.

### Database — **NOT done; I cannot do it from here**
No tool I have takes a restorable dump. Please do one of these and tell me which, with the time:
1. Supabase dashboard → project `drpzxzpvkpqfxcjbwypo` → **Database → Backups** → confirm a recent daily backup exists (or **Create backup**, plan permitting); or
2. `supabase db dump --db-url "<connection string>" -f dtpos-prod-2026-10-31.sql` and `... --data-only -f dtpos-prod-data.sql`; and
3. Storage buckets (logos, photos) are *not* in a database dump — download them from **Storage** if you want them in the backup.

Until you confirm, every item in §3 stays "proposal".

## 3. Production inventory — read-only, 2026-10-31 (project `drpzxzpvkpqfxcjbwypo`)

Production is small: **3 tenants, 3,895 orders, 7,316 order lines, 2,268 customers**, 71 tables (47 hold rows, 24 are empty).

| Tenant | Created | Branches / staff | Orders | Last order | Customers | Verdict (proposal) |
|---|---|---|---|---|---|---|
| **First Chef Pizza & Burger** | 2026-09-16 | 1 / 5 | 3,572 (3,328 paid; 3,252 archived by Close Day; 13 soft-deleted) | **today** | 743 | **Live. Untouchable.** |
| **Butt Grilled fish & Restaurant** | 2026-08-25 | 1 / 4 | 80 (71 paid) | 2026-10-30 | 25 | **Live. Untouchable.** |
| **My Restaurant** | 2026-08-21 | 5 / 6 | 243 (192 live, 51 soft-deleted; 33 cancelled, 8 void) | 2026-10-12 | **1,500** (105 never ordered; created in bursts, up to 50 in a day) | **Looks like the build/test tenant** — **you confirm**. Not touched; if confirmed, archive then decide. It also carries 0 devices and 159 audit-log rows. |

Name scan: no menu item or customer is literally named test / demo / sample / dummy (weak heuristic; names only).

| Item | Rows | Class | Proposal |
|---|---|---|---|
| `orders` (live + `archived_at` + the books) | 3,895 | real | keep; never clear |
| `order_items`, `customers` (with orders), `day_closes` (171), `shifts`, `credit_payments`, `stock_logs`, `menu_items`, `categories` | — | real | keep |
| `staff_audit_logs` | 8,632 (First Chef 8,467; My Restaurant 159; Butt 8) | audit trail | keep; retention rule later (e.g. archive > 12 months) |
| `staff_locations` | 55 | personal data | keep for now; define retention + consent display |
| Soft-deleted orders (recycle bin) | First Chef 13, My Restaurant 51 | recoverable by design | leave to the existing safe purge |
| `customer_otps` | 4, all expired | ephemeral | safe to expire; needs a routine job, not a one-off delete |
| `notification_outbox` | 4 pending (all My Restaurant) | stale | I found no sender that delivers them (FCM was removed in v1.30.0) — decide per §4 |
| `customer_sessions` 6, `staff_portal_sessions` 2 | valid | live | leave |
| `pending_owners` 3 (all claimed), `sync_operations` 1, `super_admins` 3, `super_admin_allowlist` 2, `admin_*` | small | config / licensing | keep |
| 24 empty tables (`refunds`, `order_payments`, `transactions`, `cash_movements`, `print_jobs`, `kot_revisions`, `attendance`, …) | 0 | unused **today** | keep the structure; zero rows ≠ dead code (e.g. refunds are also recorded on `orders`). Candidates for consolidation in the new schema. |

Candidates for clearing after your approval: **none are urgent.** The data is small and mostly real; there is no bulk of "temporary records" to remove.
The real "legacy" lives in the **structure** (orders as a JSON document plus mirror columns, duplicated modules, empty parallel tables), not in the rows.

## 4. Application register — what exists, what it really is

| App | Where | What it is (evidence) | Gaps against the brief | Proposed verdict |
|---|---|---|---|---|
| **Customer ordering website** | cloud repo, public routes | part of the web app; per-restaurant branding and menu from Supabase; orders enter the POS tables (`source = website`: 37 orders in production) | not yet the multi-brand premium site of the brief; not benchmarked against Domino's/KFC patterns; no SEO review | **Redevelop UI** (Phase 5), keep backend/RPCs |
| **Customer APK** `com.digitaltarget.dtcustomer` | `dtpos.apk/Customer` | Capacitor shell with the web bundle inside; `versionCode 1`; permissions: internet, network state, **foreground** location, vibrate | no push, no background features, no offline orders | **Upgrade** after the website is redesigned |
| **Rider APK** `com.digitaltarget.dtrider` | `dtpos.apk/Rider` | Capacitor shell loading the **live site** `#/rider-portal`; same permissions | **no background location** (no foreground service / `ACCESS_BACKGROUND_LOCATION`), no notifications, no offline, no proof-of-delivery capture hardware (camera) | **Rebuild properly** (Phase 7) |
| **Order Taker APK** `com.digitaltarget.dtordertaker` | `dtpos.apk/OrderTaker` | same shell loading `#/order-taker` | no push / offline / tablet layout verification | **Rebuild properly** (Phase 6) |
| **Windows POS** | cloud web app + `dtpos-desktop` (Electron 33) | the same React app in a shell; offline-first local store + sync queue | installer `.exe` never run by me; workspace code in the top bar present; UI redesign in progress | **Keep & redesign** (Phase 2) |
| **Super Admin (cloud)** | cloud repo | restaurants, plans, devices, branding, support, staff-app builds, password reset | no `clients` entity ("No Restaurant" bug not reproducible); roles/audit gaps (S2–S3) | **Modernize** (Phase 3) |
| v1.21.0 offline POS + Firebase Super Admin | upload | separate edition | — | **Design reference only** |

On the Android shells: they are acceptable only as a *delivery vehicle*. The brief asks for background location, notifications and offline behaviour, which need native
permissions and plugins that are not there. The proposed path is Capacitor **plus** the missing native plugins and mobile-first redesigned portals (one backend, one codebase),
and native Kotlin only if Capacitor cannot meet reliable background tracking. That is a decision for you at Phase 6.

## 5. Design parity with the v1.21.0 reference — for Phase 2

The cloud app already carries the **same 21 theme ids** as the reference (13 Modern + 8 DT Retail, incl. Espresso Orange; ported in v1.68.0). What it does **not** have yet:

| Reference piece | Lines | In the cloud app? |
|---|---|---|
| PIN sign-in panel (user cards, 4 dots, keypad) `PinLoginPanel` | 164 | no |
| Sign-in brand panel `LoginRetailBrand` + Espresso sign-in (wider panel, glows, "Licensed to …") | 134 + `LoginPage` 430 | no |
| Default-password banner under the top bar | — | no |
| Coloured category pills / dots `categoryColors`; category grid dialog `CategoryGridDialog` | 18 + 72 | no |
| Theme manager: custom themes, import/export `customTheme` | 355 | no |
| Short-screen POS layout `posLayout` | 332 | no |
| Customer Display live bill `liveBill` + `LiveBillPanel` | 165 + 116 | no |
| `ui-retail.css` look rules (`data-dtr` hooks: brand-mark, user-row, hero, search-wide, KPI lead/second) | 476 | partly (gradient sidebar/hero, accent pill, branding card) — not compared line by line |
| Classic ↔ Modern interface-style switch | — | no |
| `HeaderClock` (stacked variant) | — | exists in `AppLayout`; stacked variant not checked |

Proposed Phase 2 order: (1) shell + sign-in parity (PIN panel, brand panel, banner), (2) POS category pills/grid and short-screen layout, (3) theme manager, (4) Customer Display.
Each slice: Figma (connected) or the reference screenshots → implement → contrast/screenshot checks → tests. Nothing is deployed until you run `npm run deploy`.

## 6. What I need from you

1. **Database backup confirmation** (§2) — required before any structural step.
2. Is **My Restaurant** a test tenant (so it can be archived later) or does it hold real history?
3. OK to start **Phase 2** in the order above?
4. For the Android apps: Capacitor + native plugins (recommended) or native Kotlin?
5. Do you approve a Supabase **development branch** (a paid feature) for trying the new schema safely?
