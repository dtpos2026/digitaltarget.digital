# Supabase egress — what drives it, what v1.77.0 changed, how to prove it

**Release:** v1.77.0 · 2026-11-01 · project `drpzxzpvkpqfxcjbwypo`

The owner's requirement: *Supabase egress must stay low, even with many tills, riders and kitchen screens.*

Everything below is labelled **MEASURED** (read from the live database, read-only), **READ FROM CODE**, or **ESTIMATED**
(arithmetic on measured numbers, not a meter reading). No byte counter was available to this audit; the way to get one is in §5.

---

## 1. What was found

### 1.1 The biggest driver: every realtime event re-read the whole collection — READ FROM CODE
`startSupabaseRealtime()` listens to about 30 tenant tables on one channel. Each event only said *"collection X is stale"*,
and the till then called `sbLoadCollection(X, {includeDeleted: true})` — a `select *` of **every row** of X, tombstones
included — after a 400 ms debounce. That happens on **every signed-in device** (tills, kitchen, rider and order-taker
phones, owner).

| Collection | Size on First Chef | Source |
|---|---|---|
| live orders | 388 rows × ~2.2 kB ≈ 0.9 MB raw (1,765 kB was measured for 352 rows in v1.65.0, JSON overhead included) | MEASURED |
| customers | 2,271 rows × ~0.3 kB ≈ 0.7 MB | MEASURED |
| menu items | 315 rows | MEASURED |

How often events fire (MEASURED, last 24 h): **690 orders, 889 customers and 291 of 315 menu items were updated in one
day.** Lifetime counters: 36,841 order updates against 2,497 inserts (≈15 writes per order), 50,860 customer updates.

### 1.2 The rider's phone wrote on every GPS fix — READ FROM CODE
`watchPosition` fires about once a second in a moving vehicle. The rider app saved the order on each fix. Each save:
sends the whole order (with up to 200 route points), makes the database **delete and re-insert every item row of that
order** (`sync_order_items_mirror` runs on each `orders` write — MEASURED: 52,321 inserts and 48,212 deletes on
`order_items` against 7,512 live rows), fires a realtime event, and — through §1.1 — made every device re-read all orders.
One rider on one order for an hour ≈ 3,600 such cycles.

Current data are small (17 orders have a stored route, max 80 points, avg order 1,971 B), because riders rarely had
Live on — which is exactly what v1.75.0's reminder and auto-Live change. **The cost would have grown the moment riders
actually used it.**

### 1.3 Not egress, but load — MEASURED
`realtime.list_changes` (the realtime server polling the WAL) is the most expensive statement in the database: **2,018,146
calls, 17,570 s (≈ 4.9 h) of database time.** 41 tables are in the `supabase_realtime` publication. `order_items`
alone produces ~100,000 row events (§1.2) and **no client code subscribes to it** (the only `channel()` subscriptions in
the code are the tenant tables, `tenants`, `devices`, `admin_support_messages` and `tenant_settings`/`module_documents`).
This costs database CPU, not egress bytes; see §4.

### 1.4 What was already fine
- The orders poll (v1.65.0) already reads a delta; the rider portal poll payload is tiny; the database is ~30 MB.
- `subscribeOrders()` in `supabaseSync.ts` has no caller, so there is no duplicate `orders` subscription.
- Channel leak (v1.26.9) is fixed and pinned by tests.

## 2. What v1.77.0 changed

### 2.1 Realtime events re-read only what changed — `ENABLE_REALTIME_DELTA_RELOAD`
`sbReloadCollections()` now calls `sbLoadCollectionDelta()`:
- **First read, a device holding no rows of that collection, and once an hour (`REALTIME_FULL_RECONCILE_MS`):** a full read, exactly as before.
- **Every other event:** the same query plus `updated_at >= cursor − 30 s`. Tombstones are rows with a new `updated_at`
  (every table on this path has a `BEFORE UPDATE` trigger that sets it — checked against the live schema), so
  **deletions still replicate**.
- The delta is merged with `mergeDelta()`: only the local rows the delta is about take part in the merge. Handing a
  partial list to `mergeCollection()` would have re-queued every other local row for upload; a test pins that this
  cannot happen.
- The cursor is per **tenant and per collection** (`customers` and `marketingContacts` read one table and must not share
  one), separate from the orders cursor used by `refreshOrdersFromCloud()`, and kept under the `pos-` prefix so it is
  wiped when the browser switches restaurant.
- A failed read throws and does **not** advance the cursor.
- **Kill switch:** set `ENABLE_REALTIME_DELTA_RELOAD = false` in `src/lib/featureFlags.ts` for the old behaviour.

### 2.2 Rider GPS is rationed — `src/lib/riderPing.ts`
A write needs **15 s and 20 m** since the last one, or a **90 s heartbeat** when standing still. The route keeps one
point per minute or per 120 m, capped at **60** (was 200). The rider's own screen still follows every fix. Per order, so
an order claimed a second ago gets its position at once.
Hour of driving: ~3,600 writes → ≤ 241. Hour standing still: 3,600 → ≤ 41.

### 2.3 Estimated effect — ESTIMATED, not metered
Take First Chef's measured day (690 orders touched) and 6 signed-in devices. If every touched order caused its own
reload (an upper bound, since bursts within 400 ms coalesce):
- **before:** 690 × 6 × ~1.9 MB ≈ **up to ~7.9 GB/day** from orders alone;
- **after:** deltas 690 × 6 × ~3 changed rows × ~2.5 kB ≈ **~31 MB/day**, plus the hourly safety read:
  24 × 6 × ~1.9 MB ≈ **~0.27 GB/day** if every device receives events all day. About **0.3 GB/day** in total, roughly
  **25× less**.
The hourly full read is now the largest remaining piece, which is why it is an hour and not the orders poll's 15 minutes
(§2.1: the cursor already catches up a dropped connection on the next event). The true figure depends on how many devices
are open and how bursty the writes are. **Measure it (§5) before quoting it.**

## 3. Verification
| Check | Result |
|---|---|
| Delta and full read leave the **same** local collection after every step of a mixed create/edit/delete script | pass (`realtimeDelta_v1_77_0`) |
| 388 orders, 3 rows moved: wire rows 388 → 3 | pass |
| A deletion on another device removes the row here | pass |
| A late-committing row (older `updated_at` than the cursor) is missing from the delta and **healed by the hourly reconcile** | pass |
| A failed read does not move the cursor | pass |
| Empty local cache forces a full read; per-collection cursors; tenant-keyed cursor | pass |
| Partial list through the old merge would re-queue 49 of 50 rows; through `mergeDelta` 0 | pass |
| Rider: 1 fix/s for an hour ≤ 241 writes; standing still ≤ 41; route cap 60 | pass (`riderPing_v1_77_0`) |
| Full suite | 159 files · 2,470 tests pass (1 skipped, as before) · `tsc` clean · build OK |
| **Real traffic, two devices, bytes on the wire** | **NOT MEASURED** |

## 4. Database changes that would help further — NOT APPLIED, need your approval
These touch the production database, so none was run.

1. **Take `order_items` out of the realtime publication.** No client subscribes to it, and it is the largest source of
   WAL events (§1.3). Database load only, not egress.
   ```sql
   alter publication supabase_realtime drop table public.order_items;
   -- undo:
   alter publication supabase_realtime add table public.order_items;
   ```
   Before running: confirm nothing outside this repository (the parked customer app, any Android shell code) subscribes
   to it. Same check, and same one-line change, for `kot_revisions`, `print_jobs`, `printer_settings` and
   `inventory_categories`, which no code in this repository subscribes to. `notification_outbox` is written with
   `channel = 'realtime'`: keep it until the customer-side consumer is confirmed.
2. **`portal_rider_ping(token, order, lat, lng, eta)`** — merges only the position into the order, instead of replacing
   the order's whole `data` (the D-5 defect in the v1.75.0 QA report). Removes the stale-copy overwrite risk and shrinks
   each ping to a few bytes. Needs approval **and a confirmed backup**.

Take a backup first (Dashboard → Database → Backups, or `pg_dump`) and say "go" for either.

## 5. How to prove it with a real meter
1. Supabase Dashboard → **Reports → Egress** (or Project Settings → Usage). Note the last 7 days' daily figure.
2. Deploy v1.77.0 (`npm run deploy`).
3. Over a normal trading day with the usual devices open, read the same chart. Compare the same weekday.
4. If it is not clearly lower, tell me the device count and which screens stay open; the next candidates are the
   hourly reconcile and any screen with its own timer.
5. In a browser: DevTools → Network → filter `supabase.co` while someone takes an order on another device: the
   response after the event should be a few kB with a `updated_at=gte.` query, not hundreds of kB.
