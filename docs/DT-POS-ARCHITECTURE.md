# DT POS Enterprise — Offline-First Architecture & Cloud Sync

Version: v1.25.x • Last updated: 21 Aug 2026

Yeh document batata hai ke software **offline kaise kaam karta hai**, **data ka structure kya hai**, aur **online sync kaise hota hai**.

---

## 1. Big Picture

```text
┌───────────────────────── DEVICE (Electron app ya Browser) ─────────────────────────┐
│                                                                                     │
│   React UI (POS, Menu, Reports)                                                     │
│        │  saveOrder() / saveMenuItem() / saveCategory() ...                         │
│        ▼                                                                            │
│   src/lib/store.ts        ← single source of truth (in-memory cache + local write)  │
│        │                                                                            │
│        ├──► localDb (src/lib/localDb.ts)      → IndexedDB (web) / JSON file (Electron)
│        │                                       tenant-namespaced: `${tenantId}::orders`
│        │                                                                            │
│        └──► enqueueDeferredOp(col, id, 'set') → deferred queue (durable, FIFO)      │
│                    │                                                                │
│                    ▼                                                                │
│           deferredSync.ts  ── flush har 20s / online event / manual "Sync Now"      │
│                    │                                                                │
│                    ▼                                                                │
│           supabaseSync.ts  ── batch (100 ops) → RPC `apply_sync_batch`              │
└────────────────────┼────────────────────────────────────────────────────────────────┘
                     ▼
              LOVABLE CLOUD (Postgres + RLS + Realtime + Storage)
                     │
                     └─► Realtime channel + `pull_orders_delta` → doosre devices
```

**Rule:** Billing kabhi cloud ka intezar nahi karta. Har save pehle local disk par, phir background me cloud.

---

## 2. Offline Layer

### 2.1 Storage engine
| Environment | Engine | Location |
|---|---|---|
| Electron (Windows counter PC) | JSON file via IPC `dbRead`/`dbWrite` | `AppData/Roaming/DT POS Enterprise` |
| Browser / PWA | IndexedDB (`dt-pos-local`, store `kv`) | Browser profile |

Dono ka API same hai (`src/lib/localDb.ts`):

```ts
await localDb.putRow('orders', row)
await localDb.getRows('orders')
await localDb.deleteRow('orders', id)
await localDb.clear('deferredOps')
```

### 2.2 Tenant isolation
Har key `"${tenantId}::${collection}"` se namespaced hai. Ek hi install par do restaurants ka data kabhi mix nahi ho sakta. Tenant set na ho to `localDb` throw karta hai (fail-safe).

### 2.3 Local collections
`orders`, `runningBills`, `retrieveBills`, `syncQueue`, `printQueue`, `deferredOps`, `deferredOpsDeadLetter`, `praQueue`, `praLogs`, `products`, `categories`, `tables`, `printers`, `settings`, `usersCache`.

### 2.4 Offline me kya kaam karta hai
- Order lena, KOT print, bill print, payment, void, refund
- Menu / category / table / customer edit
- Running bills, retrieve, shift close (local bill number: `nextLocalBillNumber(deviceId)`)
- Reports jitna local data maujood hai us par

Offline me kya **nahi** chalta: Super Admin panel, plan changes, live map, cross-device order tracking, staff login jo pehli baar ho (PIN cache na ho).

---

## 3. Deferred Sync Queue (`src/lib/deferredSync.ts`)

Yeh sync ka dil hai.

### 3.1 Op record
```ts
interface DeferredOp {
  id: string;              // deterministic: `${col}::${entityId}` → coalescing key
  col: string;             // app collection, e.g. 'orders'
  entityId: string;
  op: 'set' | 'delete';
  at: number;              // latest update time
  firstEnqueuedAt: number; // audit / SLA metric
  deviceId: string;        // multi-device audit trail
  attempts: number;
  lastError?: string;
}
```

### 3.2 Design decisions
1. **In-memory Map + debounced persist** — enqueue synchronous aur instant (<1ms), disk write batched.
2. **Coalescing** — ek hi entity ke 100 edits = 1 cloud write (quota safety).
3. **FIFO by `firstEnqueuedAt`** — audit chronology preserved.
4. **Exponential backoff** — retry delays `0, 2s, 6s, 15s, 30s, 2m, 5m`.
5. **Dead letter** — `MAX_ATTEMPTS = 6` ke baad op `deferredOpsDeadLetter` me chala jata hai; UI se requeue ya discard ho sakta hai. Healthy items block nahi hote.
6. **Lifecycle** — `installDeferredSyncTriggers()` idempotent hai aur `stopDeferredSyncTriggers()` tenant switch par timers clean karta hai (leak fix).
7. **Migration** — purane v1.5.4 `localStorage` queues boot par import ho kar delete ho jate hain.

### 3.3 Sync modes (per device)
| Mode | Behaviour |
|---|---|
| `auto` (default) | Online ho to seedha write; offline ho to queue + har 20s auto flush |
| `manual` | Har write queue hoti hai, sirf "Sync Now" par flush |

`shouldDeferCloudWrite()` = `mode === 'manual' || navigator.onLine === false`.

---

## 4. Cloud Push (`src/lib/supabaseSync.ts`)

```
flushDeferredOps()
  → registered flusher (installSupabaseFlusher)
  → rows read from store cache
  → rowToDb(col, row)              // camelCase → snake_case + jsonb packing
  → buildSyncOp()                  // { opId, table, action, row }
  → batches of BATCH_SIZE = 100
  → supabase.rpc('apply_sync_batch', { ops })
  → applyResults(): success → op removed | error → attempts++, lastError, backoff
```

- `opIdFor({col, entityId, at})` deterministic hai → server par **idempotent upsert**, duplicate bill kabhi nahi banta.
- Server side `sync_ops` table har applied op ka record rakhta hai (replay protection + audit).

### 4.1 Field mapping (`src/lib/supabaseStore.ts`)
App camelCase use karta hai, Postgres snake_case. Translation sirf is boundary par hoti hai (346 files rename karne ki zaroorat nahi):

```ts
toSnake('menuItemId') // 'menu_item_id'
toCamel('grand_total') // 'grandTotal'
```

Teen tarah ki tables:

| Type | Example | How stored |
|---|---|---|
| Column tables | `menu_items`, `categories`, `branches` | explicit column allowlist |
| Document tables | `employees`, `stock_logs`, `attendance` | poora record `data jsonb` me, kuch fields top-level indexed |
| Hybrid | `orders` | `order_number`, `status`, `total`, `branch_id` columns + `data jsonb` (items, payments) |

Safety helpers:
- `uuidOrNull()` — legacy human labels (e.g. `"Kitchen"`) ko UUID column me jane se rokta hai.
- `NOT_GENERICALLY_SYNCABLE` — `users`/`waiters`/`riders`/`marketingContacts` generic writer se skip (inke dedicated RPC hain).
- `BRANCH_SCOPED` — in tables par har write par `branch_id` stamp hota hai.

### 4.2 Collection → table map (core)
```
categories→categories · menuItems→menu_items · orders→orders · tables→dining_tables
floors→floors · kitchens→kitchens · inventory→inventory_items · stockLogs→stock_logs
employees→employees · attendance→attendance · customers→customers · branches→branches
recipes→recipes · wastages→wastages · deals→deals · shifts→shifts · refunds→refunds
paymentAccounts→payment_accounts · promoCodes→promo_codes · transactions→transactions
```
Unknown collection = skip (guess nahi karta) → schema errors se bachav.

---

## 5. Cloud Pull & Realtime

1. **Delta pull** — `pullOrders(limit)` cursor-based: per-table cursor (`getCursor`/`setCursor`) ISO timestamp store karta hai, RPC `pull_orders_delta` sirf naye/badle rows deta hai.
2. **Realtime** — `subscribeOrders()` Supabase Realtime channel se INSERT/UPDATE events leta hai aur `applyRowEvent()` local cache me merge karta hai.
3. **Conflict rule** — last-write-wins by `updated_at`; local pending op hamesha jeet-ta hai jab tak flush na ho jaye (taake cashier ka abhi ka kaam overwrite na ho).
4. **Safety** — cloud read fail ho to local rows preserve hote hain, empty se replace nahi hote.

---

## 6. Multi-Tenant & Multi-Branch Security

- Har row par `tenant_id` aur (jahan relevant ho) `branch_id`.
- RLS har public table par ON; policies `auth.uid()` + `auth_branch_ids()` helper par based.
- `user_branch_access` table = user ↔ branches mapping; staff sirf apni branches ka data dekhta hai.
- `menu_item_branches` = branch-specific pricing/availability.
- Privileged kaam (owner provisioning, plan set, staff create) SECURITY DEFINER RPCs se: `pos_create_user`, `pos_list_users`, `staff_login_check`, `sa_set_plan`, `public_place_order`, `public_track_order`, `public_call_waiter`.
- Storage buckets private hain; images signed URLs se serve hoti hain, tenant-scoped policies ke saath.

**Auth do alag cheezen hain:**
| Kaun | Kahan |
|---|---|
| Owner / Super Admin | Supabase Auth (email + password) |
| POS staff (cashier, waiter, rider) | DB `user_profiles` + `staff_login_check` RPC (username + PIN/password) |

---

## 7. Device Layer

- `registerThisDevice()` — pehli login par device register, `deviceId` local me save.
- `startDeviceHeartbeat()` — periodic `device_heartbeat` RPC (GPS + status) → Live Map pins.
- Har deferred op par `deviceId` stamp — audit trail me pata chalta hai kis counter se entry hui.
- Local bill numbering device-scoped hai taake offline par do counters ka number clash na ho.

---

## 8. Sync Health & Diagnostics

| Tool | File | Kya karta hai |
|---|---|---|
| Sync status badge | `SyncStatusBadge.tsx` | Synced / Offline / Syncing(n) / Sync error |
| Pending chip | `SyncPendingChip.tsx` | Queue depth |
| Self test | `runSyncSelfTest()` | Backend configured → device registered → tenant/branch resolved → round-trip write |
| Integrity inspector | `syncRepair.ts` | Duplicate IDs, missing IDs, corrupt rows, orphan refs; repair karke store se re-import |
| Dead letter UI | `getDeadLetterOps()` / `requeueDeadLetter()` | Failed ops ko dobara bhejna ya discard |

Common errors ka matlab:
- `invalid input syntax for type uuid: "..."` → legacy non-UUID id; `uuidOrNull()`/`genId()` path use karein.
- `Could not find the 'x' column ... in schema cache` → local-only UI field DB tak ja rahi hai; column allowlist me fix karein.
- `Cloud sync issue — saved locally and will retry` → queue flush fail; dead letter aur `lastError` check karein.

---

## 9. Data Flow Example — Ek Bill

```
1. Cashier "PAY" dabata hai
2. store.saveOrder(order)      → in-memory cache update (UI turant)
3. localDb.putRow('orders')    → disk (debounced)
4. enqueueDeferredOp('orders', id, 'set')
5. Receipt/KOT print queue     → printer (cloud se independent)
6. ≤20s me flush → apply_sync_batch → Postgres orders row (columns + data jsonb)
7. Realtime event → manager ke dashboard aur KDS par bill turant nazar
8. Net band tha? Op queue me rehta hai; net aate hi step 6 khud chal jata hai
```

---

## 10. Key Files Index

| File | Role |
|---|---|
| `src/lib/store.ts` | App-wide data API + cache + local write + enqueue |
| `src/lib/localDb.ts` | Offline persistence (IndexedDB / Electron JSON) |
| `src/lib/deferredSync.ts` | Durable FIFO queue, backoff, dead letter, modes |
| `src/lib/supabaseStore.ts` | Collection→table map, camel↔snake, jsonb packing, allowlists |
| `src/lib/supabaseSync.ts` | Batch push, delta pull, realtime, heartbeat, self test |
| `src/lib/tenant.ts` | tenantId / deviceId resolution |
| `src/lib/branchAccess.ts` | Authorized branch filtering in UI |
| `src/lib/syncRepair.ts` | Integrity inspection & repair |
| `src/integrations/supabase/client.ts` | Browser Supabase client (auto-generated) |

---

## 11. Backup & Recovery

- **Local**: `exportData()` / `importData()` → poora tenant JSON snapshot (Backup & Restore page).
- **Day close**: `dayCloseBackup.ts` har din ka snapshot banata hai.
- **Cloud**: Postgres managed backups; `sync_ops` se op-level replay possible.
- **Restore rule**: import hamesha store layer se hota hai (raw localStorage se nahi), taake cache aur cloud dono update hon.
