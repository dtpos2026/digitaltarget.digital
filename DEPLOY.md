# Deploy — exactly the commands you already used

```cmd
npm install
npm run build
wrangler pages deploy dist --project-name dt-pos
```

Or in one step:

```cmd
npm run deploy
```

`npm run dist` also works — same thing.

Nothing about your project structure, your Pages project, or your attached
domain changes.

## What was actually broken

Nitro's default target here was the **Workers** preset (`cloudflare`). That
writes `.output/` — assets in `.output/public`, server in
`.output/server/index.mjs`. There is no `dist/` at all.

You deploy to Cloudflare **Pages**, which wants one directory whose root holds
the static assets plus an advanced-mode `_worker.js`. Different artifact, not
just a different folder name — which is why copying `.output` into `dist`
(v1.25.3) still would not have deployed correctly.

`scripts/build.mjs` now pins `NITRO_PRESET=cloudflare_pages`, which writes
straight to `dist/` in the layout Pages expects. It is set in the script rather
than as a shell variable because `NITRO_PRESET=... npm run build` does not work
in Windows CMD.

The build now also **fails loudly** if `dist/_worker.js` is missing, instead of
letting you deploy a broken bundle to a live domain.

## Environment variables — set these on Cloudflare Pages

Cloudflare builds your app itself if you deploy from git. `.env` is not read
there, so set these in
**Workers & Pages → dt-pos → Settings → Variables and Secrets**:

| Name | Type | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | Variable | `https://drpzxzpvkpqfxcjbwypo.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Variable | `sb_publishable_wAdvU6MKlCyBCAMogNUdCQ_34DK6CVS` |
| `SUPABASE_URL` | Variable | same URL |
| `SUPABASE_PUBLISHABLE_KEY` | Variable | same publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | from Supabase dashboard |

The last one must be a **Secret**, not a Variable, and must never carry a
`VITE_` prefix — it bypasses Row Level Security.

## compatibility_date is pinned — do not let it drift

Nitro stamps the **build machine's current date** into
`dist/_worker.js/wrangler.json`. Cloudflare rejects anything it reads as the
future:

```
X [ERROR] Failed to publish your Function.
  Can't set compatibility date in the future: 2026-08-22
```

Whether this fires depends on your timezone versus Cloudflare's UTC clock, so
the same build can fail at night and succeed the next morning. `scripts/build.mjs`
now pins it to **2026-06-01** after the build, so the clock is out of the picture.

This also makes the runtime reproducible: `compatibility_date` decides which
Workers runtime semantics you get, so a date that changes on every build means
the deployed runtime can shift without any code change.

To move it deliberately:

```cmd
set CF_COMPATIBILITY_DATE=2026-07-01
npm run build
```

Keep it at or after **2024-09-23** — that is the minimum for `nodejs_compat` v2.

---

# v1.25.7 — schema drift (column level)

## What broke

```
Could not find the 'address' column of 'admin_marketing_contacts'
in the schema cache
```

Tables and RPCs were all correct. The gap was at **column** level — code wrote
columns the database did not have. Two real drifts, both now fixed:

**admin_marketing_contacts** — missing `address`, `owner_name`,
`restaurant_name`, `source`, `status`, `linked_tenant_id`, `linked_device_ids`.
Saving a marketing contact failed outright.

**branches** — missing `branch_code`, `email`, `invoice_prefix`,
`invoice_footer`, `registration_number`, `tax_number`. These are listed in
`ALLOWED_COLUMNS`, so the sync silently stripped them: a branch's tax number,
invoice prefix and footer never saved, and those **print on customer receipts**.
No error was shown — the data just vanished.

Migration applied to the live project and saved as
`supabase/migrations/20260822000000_v1_25_7_schema_drift.sql`. Additive only:
new nullable columns, nothing dropped, renamed or retyped.

## Do not generate migrations from types.ts

`src/integrations/supabase/types.ts` is **stale**. It describes an older
document-shaped design — it claims `orders` has a `data` column, while the live
table has ~100 real ones. Generating DDL from it would corrupt the schema.

The authoritative write contract is `ALLOWED_COLUMNS` in
`src/lib/supabaseStore.ts`, plus explicit mappers such as `contactToDb()` in
`src/lib/marketingContacts.ts`.

`src/test/schemaDrift.test.ts` now checks that every column those declare is
created in some migration, so this fails in the test run rather than at a till.

## The old `business` / `stage` columns were left alone

They are unused by current code but may hold data entered before the rename.
Dropping them here would destroy it silently. Migrate the data first, then drop
in a separate, deliberate migration.

---

# v1.25.8 — the 16 document modules could not save at all

## What was wrong

`src/lib/supabaseStore.ts` routes 16 modules through `DOC_TABLES`. For those,
`rowToDb()` builds this row and nothing else:

```
{ id, tenant_id, branch_id, data: <jsonb>, deleted_at, updated_at }
```

**Not one of those 16 tables had a `data` column.** They were still carrying an
older relational shape (`employees.emp_code`, `attendance.work_date`, ...) with
NOT NULL constraints the document write never fills.

Every write from these modules failed:

| Area | Tables |
|---|---|
| HR | employees, attendance, leaves, payslips, advances |
| Accounts | account_categories, transactions, parties, ledger_entries |
| Inventory | stock_logs, receiving_entries, recipes, wastages |
| Finance | day_closes, credit_payments, refunds |

Same class of failure as the marketing-contact error, but across sixteen tables
instead of one. Those records lived only in the browser — a cleared cache or a
second till and they were gone.

## Fixed

Migration `20260822010000_v1_25_8_doc_tables_data_column.sql`, applied to the
live project:

* added `data jsonb not null default '{}'`, `deleted_at`, `branch_id`,
  `created_at`, `updated_at` to all 16
* relaxed NOT NULL on the legacy relational columns the document write does not
  populate — **kept, not dropped**, so any historical row retains its values
* added a `(tenant_id, branch_id)` index on each

All 16 were verified **empty** first, so nothing was at risk. A probe insert of
the exact document shape was then run against all 16 inside a transaction and
rolled back: all succeeded, nothing left behind.

## Guarded

`src/test/schemaDrift.test.ts` now parses `DOC_TABLES` **out of the source** and
checks each table has the document columns. Add a table to `DOC_TABLES` without
a migration and the test run fails — not a till.

## Still verified clean

`menu_items`, `categories`, `orders`, `module_documents` — no missing columns.

---

# v1.25.9 / v1.25.10 — full Super Admin + 64-module audit

## BUG 1 — no till could register (critical)

`src/lib/supabaseSync.ts` calls:

```
rpc('register_device', { p_hardware_id, p_label, p_branch_id,
                         p_platform, p_app_version, p_meta, p_ip })
```

The function accepted only the first five. **PostgREST resolves an RPC by
argument name**, so the extra `p_meta` / `p_ip` meant no candidate matched:

```
Could not find the function public.register_device(...)
```

Device registration is the **first** thing a till does. Failing there means the
device never gets an id, so nothing after it could sync.

The function also returned only `device_id` / `approved` / `branch_id` while the
caller reads `blocked` and `auto_approved` — both came back `undefined`, so a
**blocked device still looked usable**.

Also added 11 missing `devices` columns: `ip`, `meta`, `blocked`, `blocked_at`,
`blocked_reason`, `auto_approved`, `is_kds`, `kds_kitchen_id`,
`kds_kitchen_name`, `login_count`, `last_login_at`.

## BUG 2 — setting a plan was broken

`sa_set_plan` had **two overloads** (`p_expires` as `text` and as `timestamptz`).
PostgREST cannot choose and fails. The text version is dropped.

**Watch for this pattern:** `CREATE OR REPLACE` cannot change a signature — it
creates a *second* overload and reintroduces the ambiguity. Old versions must be
dropped explicitly.

## BUG 3 — Super Admin device-limit override did nothing

`tenants.custom_device_limit` did not exist. The operator raised a restaurant's
limit, saw no error, and the extra till still could not register.

## Audit results

| Area | Result |
|---|---|
| 28 RPC argument contracts vs live functions | all match ✅ |
| RPC overload ambiguity | none remaining ✅ |
| Super Admin table columns (14 tables) | all present ✅ |
| POS module columns (`menu_items`, `categories`, `orders`, `module_documents`) | all present ✅ |
| `devices`, `tenants` | fixed above ✅ |
| RLS on all 65 tables | enabled, all have policies ✅ |

## ⚠️ Known gap — the migrations cannot rebuild this database

**20 of the 31 functions the app calls exist only in the live Supabase project.**
They were created through the dashboard and never captured as migrations:

`apply_sync_batch, auth_branch_ids, auth_role, bootstrap_restaurant,
can_access_branch, device_heartbeat, next_order_number, pos_list_users,
pos_set_staff_profile, public_call_waiter, public_place_order,
public_track_order, pull_orders_delta, reset_order_counter,
set_default_owner_pos_login, staff_login_check, staff_login_global,
update_own_tenant_name, verify_manager_password, verify_staff_pin`

**Nothing is broken today** — the live project has them. The risk is that a
fresh Supabase project built from `supabase/migrations` would be missing staff
login, order numbering, device heartbeat and the entire sync path.

Fix it with:

```cmd
supabase link --project-ref drpzxzpvkpqfxcjbwypo
supabase db pull
```

That writes the live schema out as a baseline migration. It needs your project
credentials, so it has to be run by you — I could not do it from here.

---

# v1.25.11 — the secret WAS set correctly; the code was looking in the wrong place

## What actually happened

`SUPABASE_SERVICE_ROLE_KEY` was added in the Cloudflare dashboard as a Secret,
in the Production environment, and the project was rebuilt and redeployed. The
server still reported it missing.

**Cloudflare Workers have no populated `process.env`.** Variables and secrets
arrive as **bindings** on the `env` object given to the fetch handler. Node's
`process.env` is a compatibility shim that Nitro's `cloudflare_pages` preset
does not fill from dashboard secrets.

The code read only `process.env`, so a correctly-configured secret looked
absent. The error message blamed the configuration, which was wrong — the
configuration was fine.

## Fixed

`src/integrations/supabase/serverEnv.ts` resolves in order:

1. `process.env` — so `.env.local` still wins in local dev
2. `env` from `cloudflare:workers` — the Workers binding
3. `globalThis`

Used by `client.server.ts` and `auth-middleware.ts`.

`cloudflare:workers` needs `compatibility_date >= 2024-09-23`; this project
pins **2026-06-01**, so it is available. Verified the dynamic import survives
bundling (`dist/_worker.js/_ssr/serverEnv-*.mjs`) rather than being inlined or
stripped.

## API change

`supabaseAdmin` (a synchronous Proxy) became `getSupabaseAdmin()`, because
reading a Workers binding requires an async import — which the old synchronous
Proxy could not do. All three call sites were updated:

```ts
const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
const supabaseAdmin = await getSupabaseAdmin();
```

## The error message now reports which sources it checked

If it ever fires again it ends with, for example:

```
[env sources: process.env=present, cloudflare:workers env=present]
```

That distinguishes "the variable is not set" from "this runtime has no way to
reach it" — the ambiguity that made this take several rounds to find.

---

# v1.25.12 — "Auth account step: Database error creating new user"

## This one is fixed in the DATABASE, not the code

The migration is already applied to the live project. Nothing in the app needed
changing — but the migration file is in `supabase/migrations/` so the repo
stays reproducible.

## The chain

1. Super Admin creates a restaurant; `sa_create_restaurant` leaves a row in
   `pending_owners` for the owner's email.
2. `platform.functions.ts` calls `auth.admin.createUser()`.
3. The AFTER INSERT trigger `claim_pending_owner()` runs
   `update tenants set owner_user_id = new.id`.
4. That fires `guard_tenant_billing_columns()`, which refuses any ownership
   change unless `is_super_admin()`.
5. GoTrue performs the insert as `supabase_auth_admin` with **no JWT**, so
   `auth.uid()` is NULL and `is_super_admin()` is false. The guard raises
   `42501` and aborts the whole `auth.users` insert.

GoTrue then reports only **"Database error creating new user"**, which hides the
real cause entirely. The error had nothing to do with the password, the email,
or the service role key.

## Why the guard was not simply removed

It is doing its job: a restaurant owner must never be able to reassign their own
tenant, change their plan, or extend their own expiry. Deleting it to make the
error go away would have opened a real hole.

Instead `claim_pending_owner()` announces itself with a transaction-local flag
around its single UPDATE and clears it immediately after. `set local` dies with
the transaction, no PostgREST client can set a custom GUC before its statement,
and both functions are SECURITY DEFINER owned by the database owner.

## Also fixed

`claim_pending_owner()` was inserting `branch_id` as a hardcoded `null` even
though `pending_owners` records one — the new owner ended up with no branch. It
now carries `p.branch_id` through.

## Verified on the live project

| Check | Result |
|---|---|
| Owner account created | SUCCEEDED |
| Ownership transferred to the new owner | YES |
| `user_profiles` row created | YES |
| `pending_owners` marked claimed | YES |
| **Guard still blocks an ordinary ownership change** | **YES — 42501** |

All probe rows were removed afterwards.

## Two restaurants are still waiting for their owner

`pending_owners` has unclaimed rows for:

* `yoyo@gmail.com` -> restaurant "yooo"
* `hmtaimooryounas@gmail.com` -> restaurant "hi"

Creating those owners from the Super Admin panel should now work. The claim
trigger will pick up the pending row and transfer ownership automatically.

---

# v1.25.13 / v1.25.14 — the proactive audit

Every earlier fix was reactive: you hit an error, I checked that one layer.
Each round found a DIFFERENT KIND of mismatch, which is why bugs kept arriving
one at a time. The layers should have been enumerated up front. This is that
list, checked in full.

| # | Layer | Result |
|---|---|---|
| 1 | Tables exist | clean |
| 2 | ALLOWED_COLUMNS columns | 2 drifts — fixed v1.25.7 |
| 3 | DOC_TABLES `data` column | 16 tables — fixed v1.25.8 |
| 4 | RPC argument names | 2 breaks — fixed v1.25.9 |
| 5 | RPC overload ambiguity | 1 — fixed v1.25.9 |
| 6 | Runtime env resolution | Cloudflare bindings — fixed v1.25.11 |
| 7 | Triggers that abort writes | 1 — fixed v1.25.12 |
| 8 | **upsert onConflict vs UNIQUE constraints** | **1 — fixed v1.25.13** |
| 9 | **CHECK constraints vs code enums** | **1 — fixed v1.25.13** |
| 10 | **NOT NULL vs what the code actually sends** | **1 — fixed v1.25.14** |
| 11 | RLS policy completeness per command | clean (see below) |
| 12 | Storage buckets exist | clean |

## BUG — menu items with size or inch pricing could not be saved

`types.ts` declares `PricingType = 'fixed' | 'weight' | 'manual' | 'size' |
'inch' | 'both'`. The CHECK constraint allowed **only `fixed` and `weight`**.

`menu_items` already has `size_variants` and `inch_variants` columns, so this
is a shipped feature the database was rejecting. Saving a pizza with
Small/Medium/Large prices failed with a check violation. All six now verified
accepted against the live database.

## BUG — pending_owners upsert had no unique constraint

The code upserts with `onConflict: 'tenant_id'`; Postgres requires a matching
UNIQUE constraint for `ON CONFLICT`. Re-inviting an owner could not work.

## BUG — pending_owners.branch_id was NOT NULL

`platform.functions.ts` upserts only `{ tenant_id, email, claimed_at }`. When
the row already existed the UPDATE path worked; when it did not, the INSERT
failed. It broke on the **first** owner for a restaurant and looked fine on a
retry — the worst kind to diagnose.

## RLS: six tables have no INSERT/UPDATE policy — and that is correct

`order_counters`, `token_counters`, `super_admins`, `order_edit_logs`,
`order_payment_corrections`, `sync_operations`.

Verified none of them is written directly by client code; all writes go through
SECURITY DEFINER functions, which bypass RLS by design. The append-only tables
correctly have INSERT but no UPDATE.

## What is still NOT verified

* **RLS policy correctness.** Every table has policies; I checked that they
  EXIST, not that each one isolates tenants properly. A wrong policy leaks data
  with no error.
* **Storage bucket policies.** `employee-docs` holds CNIC scans.
* **End-to-end browser flows.** Everything above is verified at the database
  level.

---

# v1.25.15 — no order a till sold could reach the cloud

```
Sync rejected (save orders/...): Could not find the 'client_seq' column
Sync rejected (save categories/...): Could not find the 'icon' column
```

## Why my earlier audits missed this — and this one is on me

Earlier rounds checked `ALLOWED_COLUMNS` (10 tables) and `DOC_TABLES` (16).

`orders`, `order_items`, `order_payments` and `categories` are in **neither**.
They have their own hand-written mappers at the top of `rowToDb()` in
`supabaseStore.ts`, and I never compared those to the database. I checked the
two lists I had found and assumed they were the whole write surface.

`rowToDb('orders')` sends exactly:

```
branch_id, device_id, order_number, status, total, data, client_seq, deleted_at
```

The table had **none** of `total`, `data`, `client_seq`, `deleted_at`. It was
still the old ~100-column relational design while the code had moved to the
document design — the same mismatch as v1.25.8, but in the most important
tables in the product.

## Fixed

* `orders`, `order_items`, `order_payments`: added `data`, `client_seq`,
  `deleted_at`, `updated_at`, `total`; relaxed the legacy NOT NULLs the
  document write does not fill; added sync/lookup indexes.
* `categories`: added `icon`, `image_path`.

Verified against the live database with the exact mapper payloads — an order
with items and a cash payment, and a category with an icon and image. All four
inserts succeeded; probe rows removed.

`menu_items` and `inventory_items` were checked the same way and are clean.

## Guarded

`schemaDrift.test.ts` now parses the explicit mappers **out of `rowToDb()`** and
checks every column they send. Add a field to any mapper without a migration and
the test run fails — not a till mid-service. 967 tests pass.

## About the "Cloud data sync is slow" screen

That safety lock was doing its job. It refused to open the app on empty data
rather than showing a blank menu and risking overwriting the cloud with
nothing. It appeared because every sync push was being rejected — with the
schema fixed, it should stop.

---

# v1.25.16 — table sync, website orders, and branding that vanished

## BUG A — freeing a table broke its sync

```
Sync rejected (save tables/...): violates "chk_free_table_not_seated"
```

The constraint says a table with `status = 'free'` must have `seated_at` and
`current_order_id` NULL. When the POS closes a bill it sets `status = 'free'`
but does not always clear those two fields, so the row was rejected and the
table **never synced** — it stayed "occupied" on every other till in the
restaurant.

The constraint is right: a free table still pointing at an order is corrupt
data. So it was not removed. A BEFORE trigger now **makes** the invariant true
instead of merely asserting it, which means no client can violate it — not the
POS, not the offline queue replaying an old operation, not a future screen.

Verified: a free table with stale fields is accepted and cleaned; a **running**
table keeps its seating data untouched.

## BUG B — website orders were rejected

```
Order fail: null value in column "notes" of relation "orders"
```

`orders.notes` is NOT NULL **with a default**. A default only applies when the
column is *omitted*; the website order path sends `notes` explicitly as `null`.

v1.25.15 relaxed the legacy NOT NULLs but **skipped every column that had a
default**, assuming the default would cover it. That assumption was wrong, and
this is the same bug class arriving through the gap it left. Now relaxed
properly across `orders`, `order_items` and `order_payments`.

## BUG C — branding disappeared on refresh (this one was in the code)

The database was never the problem: `tenant_settings` accepts the exact upsert,
and reading it back returns the saved name. Verified directly.

`sbSaveSettings()` does two things: upsert the settings, then mirror the
restaurant name into `tenants` via `update_own_tenant_name`. **If the second
call failed it threw** — after the first had already succeeded. `store.ts`
treated the whole save as failed, the UI rolled back, and the operator watched
their restaurant name, logo and tagline vanish on refresh **while the branding
sat in the database the whole time**.

`update_own_tenant_name` is also the more fragile call: it requires the caller
to be the tenant's owner, so a Super Admin editing a restaurant's branding
fails it by design while having every right to save the settings.

The mirror is a convenience. A stale mirror is a small problem; discarding the
operator's branding is a large one. It now logs a warning instead of throwing.

---

# v1.25.19 — THE root cause: every relationship was being erased on sync

Found by replaying your real backup (405 orders, 172 menu items, 90 customers,
253 recipes, 5111 stock logs) through the actual sync code, rather than
reasoning about it in the abstract. That is what I should have done rounds ago.

## Every record id in the existing restaurant is a legacy id

`mqnmh0700qvw4u`, `cat-deals`, `inv_13333219`, and for customers the phone
number itself. **Not one is a UUID** — but every `id` column in Postgres is
typed `uuid`.

`cloudId()` already handled this for a record's **own** id: it derives a stable
UUID from the legacy id, deterministically, so the same record always lands on
the same cloud row.

**Foreign keys did not get that treatment.** They went through `uuidOrNull()`,
which returns `null` for anything that is not already a UUID. So:

* all 172 menu items synced with `category_id = NULL`
* all 24 tables synced with `floor_id = NULL`
* customers lost `favorite_item_id`, `preferred_branch_id`, `last_rider_id`

Nothing errored. The rows saved. **The links did not.** Then the next cloud load
overwrote the local copy that still had them — and the menu "disappeared on
refresh". That is exactly the symptom, and this is its cause.

## Fixed

`cloudFk()` now derives the same UUID the referenced record itself will use.
Because `cloudId()` is deterministic, `cat-deals` maps to the identical UUID
whether it arrives as a category's own id or as a menu item's `category_id`.
The relationship survives with no data migration.

Verified against your real backup:

```
menu_items -> categories:  172 / 172 linked, 0 dangling
dining_tables -> floors:    24 /  24 linked
```

## Also fixed: 14 customer fields were being dropped

`ALLOWED_COLUMNS` silently discards anything not listed. Customers lost
`addresses` (saved delivery addresses), `area`, `province`, `full_address`,
`grade`, `avg_order_value`, `first_order_at`, `favorite_item_name`,
`preferred_branch_id`, and more. Columns added and the allow-list extended.

Promo codes: the app writes `usage_count`, the table had `used_count`. A
trigger now keeps the pair in step so redemption counts sync and `max_uses` can
actually be enforced across devices.

## One caveat to watch

Foreign keys now carry real values, so **sync order matters**: categories must
land before menu items, branches before everything, floors before tables. A
first pass may report FK errors for children that arrive before their parents;
those ops retry and settle. If you see FK errors that do **not** clear after a
few minutes, send them — that would mean an ordering fix is needed too.

---

# v1.25.20 — why two browsers on the SAME account showed DIFFERENT data

This is the architectural cause the brief asked for, and it sits in one merge
function.

## The rule that was wrong

`refreshCloudStoreInBackground()` in `src/lib/store.ts` merged the cloud
response into the local cache with:

```js
if (!cloudRow || localAt > cloudAt) byId.set(row.id, row);
```

The `localAt > cloudAt` half is fine — newest edit wins.

The **`!cloudRow`** half says: *"the cloud does not have this row, so keep
mine."* That is only correct for a row that has not been pushed yet. It is
wrong for a row that was **deleted on another device** — and the two cases are
indistinguishable without consulting the sync queue.

## What it did

**Deletions undid themselves.** Browser B deletes a menu item. The cloud no
longer has it. Browser A still has it locally, hits `!cloudRow`, resurrects it,
writes it back to localStorage — and pushes it back up. The delete reverses
itself, and the two browsers now disagree permanently.

**Failed saves looked successful.** Any row whose sync was rejected — and until
v1.25.19 that was most of them — lived in localStorage forever and was
re-adopted on every refresh. The operator saw it on their till. Nobody else
ever did. That is the "data disappears on refresh" report seen from the other
side: it was never in the database to begin with.

## The fix

A local row missing from the cloud has exactly two meanings: deleted
elsewhere, or not pushed yet. Only the durable sync queue can tell them apart,
so the merge now asks it (`getDeferredOps()`) instead of assuming the
favourable answer.

* row has a pending op → keep it (a genuine unsynced write)
* no pending op → the cloud wins, **including its absence**

The database is now the single source of truth. The local cache is a fast first
paint, not an authority.

## Guarded

`src/test/cloudAuthority.test.ts` pins the rules: deleted-elsewhere stays
deleted, queued-offline survives, newest wins, and a **tie goes to the cloud**
so clock skew between a till and the server cannot decide whose data is real.
The pending key is scoped by collection, so `orders:b` cannot rescue
`menuItems:b`.

977 tests pass.

## Still not verified — and it needs you

The brief's Tests A–H are two-browser, real-session tests. I cannot run those
from here: I have no browser and no login. Everything above is verified at the
database and unit level.

The most valuable next step is the exact experiment described in the brief:

1. Browser A: change the restaurant name and logo, Save.
2. Browser B: hard refresh (Ctrl+Shift+R).
3. Report what Browser B shows.

Do that **after deploying this build**, since the merge fix only takes effect in
the new bundle.

---

# v1.25.21 — URGENT: fixing a regression I shipped in v1.25.20

## What I broke

v1.25.20 changed the cloud/local merge to drop a local row that the cloud does
not have, unless the sync queue says it is still pending. The intent was right.
The implementation was not.

`getDeferredOps()` reads an in-memory Map that starts **empty** and is filled by
`ensureLoaded()` — which is **async** and only primed lazily. Called during boot
it returns `[]`. That does not mean "nothing is pending". It means **"I have
not looked yet."**

v1.25.20 read it synchronously and trusted the empty result. So on the first
background refresh, **every unsynced local row was discarded** — destroying
exactly the data the queue exists to protect.

On this project that was close to everything: until v1.25.19 most rows never
synced at all (legacy ids nulled every foreign key), so most of the 405 orders,
172 menu items and 90 customers existed only in localStorage. The merge treated
all of them as deleted.

That is why nothing worked today, and it was my fault.

## The fix

* `whenDeferredQueueReady()` added to `deferredSync.ts` — awaits the actual
  load instead of guessing from an empty Map.
* The merge now distinguishes three states, not two:
  * `pendingIds` is a **Set with the id** → keep (unsynced write)
  * `pendingIds` is a **Set without it** → cloud wins, including its absence
  * `pendingIds` is **null** (queue unreadable) → **keep the local row**

The governing rule: **never drop a row on uncertainty.** A stale duplicate is
recoverable. A deleted order is not.

## Guarded

`cloudAuthority.test.ts` now pins the distinction explicitly — an empty Set and
an unread queue must behave *differently*, which is the exact confusion that
caused this. 979 tests pass.

## If data is missing on a till right now

Do **not** clear that browser's cache or storage — that is the copy the data
may still be in. Deploy this build first and let it refresh; rows still held
locally will be kept and pushed rather than dropped.
