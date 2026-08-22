# DT POS — database aur sync kaise kaam karta hai

Aap ne poocha "structure kaise hai, ye kaam kaise karta hai". Ye poora naqsha
hai, aur wo bhi jo tootta raha.

---

## 1. Bara naqsha

```
   TILL (browser)                    CLOUDFLARE                SUPABASE
   ─────────────                     ──────────                ────────
   React UI
      |
      v
   store.ts  ────► localStorage      Pages (dist/)             Postgres
   (working state)  (fast cache)     static + _worker.js       65 tables
      |                                    |                   + RLS
      v                                    v                   + 31 functions
   deferredSync.ts ──────────────────► PostgREST API ────────► Storage
   (durable queue)                     (auto REST)              4 buckets
                                            |
                                       Auth (GoTrue)
```

**Local-first design.** Till pehle localStorage pe likhti hai (taake internet
band ho to bhi bill ban sake), phir queue background mein cloud pe bhejti hai.

Ye design theek hai. Masla ye tha ke **cloud tak pohanchne wale raaste toote
huay thay**, aur nakami khamoshi se hoti thi — is liye local data "saved" lagta
tha jabke wo kahin nahi gaya.

---

## 2. Data cloud tak kaise jata hai — 4 alag raaste

Yehi wo cheez hai jis ne mujhe sab se zyada waqt liya. **Ek raasta nahi, chaar
hain**, aur har ek ka apna schema contract hai:

| Raasta | Kaunse modules | DB mein kaise jata hai |
|---|---|---|
| **Explicit mappers** | orders, categories, menuItems, inventory | Haath se likha mapper, sirf ginay huay columns |
| **ALLOWED_COLUMNS** | tables, floors, kitchens, customers, branches, deals, promoCodes, shifts, paymentAccounts | Allow-list se filter — **baqi sab chup-chaap gir jata hai** |
| **DOC_TABLES** | HR, accounts, inventory logs, refunds (16 tables) | Poora record ek `data` jsonb column mein |
| **module_documents** | promotions, wallet, zones, daily wages, blocked customers, WhatsApp (18 keys) | Ek shared table, `kind` + `doc_id` se |

Har round mein main **ek raasta** check karta tha aur samajhta tha kaam ho gaya.
Isi liye bugs ek ek kar ke aate rahe. Jo audit chahiye tha wo **chaaron ka ek
saath** tha.

---

## 3. Ids — sab se bara masla

Aap ke restaurant ka har record **legacy id** pe hai:

```
menu item   mqnmh0700qvw4u
category    cat-deals
inventory   inv_13333219
customer    923451873354      (khud phone number)
```

Lekin Postgres mein har `id` column **`uuid` type** hai.

`cloudId()` in ko deterministic UUID mein badalta hai — wahi input hamesha wahi
UUID deta hai, is liye ek record hamesha usi cloud row pe girta hai:

```
cat-deals  ->  883fb1e5-25aa-561e-86c5-026ba58aa26c   (hamesha)
```

**Jo toota hua tha:** `cloudId` sirf record ke **apne id** pe lagta tha. Foreign
keys `uuidOrNull()` se guzarte thay, jo non-UUID ko **`null`** kar deta hai. To
172 ke 172 menu items apni category kho dete thay. Row save hoti thi, rishta
nahi. Aur agli baar cloud se load hone pe menu bikhar jata tha.

Ab `cloudFk()` wohi UUID banata hai jo parent khud istemal karega.

---

## 4. RLS — data alag kaise rehta hai

Har table pe Row Level Security hai:

```sql
tenant_id = auth_tenant_id()
```

aur `auth_tenant_id()` ye hai:

```sql
select tenant_id from user_profiles where user_id = auth.uid() and is_active
```

Matlab: aap ka JWT → `user_profiles` row → `tenant_id` → sirf usi restaurant ka
data.

**Ahem:** jis user ki `user_profiles` row na ho, uske liye `auth_tenant_id()`
NULL hai aur **har write khamoshi se reject** ho jati hai. Super Admin ke liye
alag policy hai (`is_super_admin()`).

Kuch tables pe INSERT/UPDATE policy jaan bujh kar nahi hai — `order_counters`,
`token_counters`, `super_admins`, `order_edit_logs`. In pe likhna sirf
SECURITY DEFINER functions se hota hai, jo RLS bypass karte hain. Ye design hai,
bug nahi.

---

## 5. Sync queue

`deferredSync.ts` ek durable queue rakhta hai (IndexedDB mein), har op ka
deterministic id ke saath taake retry duplicate na bane.

**Backoff:** 2s → 6s → 15s → 30s → 2m → 5m. `MAX_ATTEMPTS` ke baad op
dead-letter mein chala jata hai — khoya nahi jata, audit panel mein nazar aata
hai.

**v1.25.23 mein tarteeb thi:** queue sirf waqt se sort karti thi, is liye menu
item apni category se **pehle** push hota tha aur FK violation deta tha — 447 +
353 + 134 errors, poore project ke sab se bare error sources. Ab tiers hain:

```
branches → floors/kitchens/categories → inventory → menuItems/tables → recipes → orders
```

---

## 6. Jo cheezen khamoshi se fail hoti thin

Yehi sab se khatarnaak qism thi — koi error nahi, bas data ghayab:

| Kya | Kyun |
|---|---|
| menu items ki category | FK `null` ho jata tha |
| customers ke 14 fields (delivery addresses samet) | ALLOWED_COLUMNS filter |
| shift ke cash pay-in/pay-out | koi column hi nahi (**ab bhi baqi**) |
| promo redemption counts | app `usage_count` likhta, table `used_count` |
| branding | settings save ho jati, phir mirror fail hone pe throw |

---

## 6b. v1.26.0 — multi-device sync (jo ab theek hua)

Upar wale masle **push** ke thay: data cloud tak pohanchta nahi tha. v1.26.0
ne **pull** ka masla theek kiya — data cloud tak pohanch raha tha, lekin
doosri device tak nahi.

**Realtime publication mein sirf 7 tables thin.** Client ~28 tables sun raha
tha. Sirf `orders` aur `dining_tables` kaam kar rahe thay. Menu, categories,
customers, inventory, branches, deals, promos, shifts — in par koi event hi
nahi aata tha. Doosri till ko naya data sirf restart par milta tha.

`tenant_settings` (branding, logo, restaurant ka naam) aur `module_documents`
(waiters, riders, promotions, wallet, zones, wages, blocked customers) to
subscription mein thin hi nahi. Isi liye "logo change kiya, doosri device par
nahi aaya".

**16 tables ka `updated_at` kabhi barhta hi nahi tha.** Column maujood tha,
lekin trigger nahi — value hamesha INSERT wali rehti thi. Merge isi se
faisla karta hai, is liye device A ka *edited* record device B ke *untouched*
record se **purana** lagta tha, aur B jeet jata tha. 5 aur tables mein column
hi nahi tha (stamp = 0, local hamesha jeetta).

**11 tables hard-DELETE hoti thin.** "Doosri device par delete hua" client tak
"cloud mein nahi hai" ban kar pohanchta tha — bilkul wohi shakal jo "abhi push
nahi hua" ki hai. Merge ko andaza lagana parta tha:

- andaza "deleted" → offline bane bills mit jate the
- andaza "unsynced" → deletions wapas zinda ho kar dobara push ho jati thin

Dono ship huay. Ab `deleted_at` tombstone hai, to deletion ek **haqiqat** hai jo
replicate hoti hai — aur "cloud mein nahi hai" ka hamesha mehfooz jawab diya
ja sakta hai: record rakho aur queue mein wapas daal do.

**Settings ki koi retry nahi thi.** Har module failed write ko durable queue
mein rakhta hai; settings sirf error report kar ke chhor deti thin, aur
`saveSettings` us error ko nigal jata tha. Internet band ho to naam/logo/tax
ki tabdeeli **hamesha ke liye** gayab, aur UI "saved" dikhata tha.

**Dead-letter khamoshi thi.** 6 nakam koshishon ke baad op park ho jati hai.
Comment kehta hai "audit panel mein nazar aata hai" — koi panel ise parhta hi
nahi tha. Ab toast aata hai aur status bar mein laal **"Stuck (n)"** pill hai
jise daba kar dobara koshish hoti hai.

---

## 7. Ab bhi jo maloom masle hain

**`payIns` / `payOuts`** — shift ke cash movements ab bhi Supabase nahi jate.
`public.cash_movements` table maujood hai lekin code use nahi karta. Paisay ka
hisaab hai, is liye aap ki ijazat ke baghair nahi chheda.

**28 functions repo mein nahi** — live Supabase mein hain, `supabase/migrations`
mein nahi. Aaj kuch nahi tootega, lekin ye repo backend dobara nahi bana sakta.
`config.toml` ghalat project par lagi thi (is liye CLI kuch karta hi nahi tha) —
ab theek hai. Hal: `supabase db pull`. Tafseel:
`supabase/migrations/README.md`.

**`order_items` / `order_payments` tables khali hain** — poora order
`orders.data` jsonb mein hai. `supabaseSync.ts` ka engine (apply_sync_batch,
pull_orders_delta, cursors) mojood hai lekin `installSupabaseFlusher()` kabhi
call nahi hota, is liye wo poora raasta **dead code** hai. Chhera nahi gaya:
business logic theek chal rahi hai, aur ise badalna sync fix nahi balke
re-architecture hota.

**Do-browser testing** — main nahi kar sakta, aap ko karna hoga.

---

## 8. Kaise dekhen ke kya ho raha hai

**Supabase Dashboard → Logs → Postgres** — asal errors yahan milte hain. Isi se
447/353/134 wale FK errors pakde gaye. Aap khud dekh sakte hain:

```sql
select event_message, count(*)
from postgres_logs
where event_message ilike '%violates%'
group by 1 order by 2 desc
```

**Browser → F12 → Console** — build stamp `DT-POS-1.25.21` dikhna chahiye.
Nahi dikhta to nayi build live nahi hui.

**Dashboard ka success rate** — 57% ka matlab tha ke har doosri request fail ho
rahi hai. Deploy ke baad ye 95%+ hona chahiye. Agar nahi hota to Logs kholen.
