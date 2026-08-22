# DT POS Enterprise — Complete Guide (v1.25.2)

Yeh guide poore system ka setup, structure, sync, aur daily use cover karti hai.

---

## 1. Quick Start (Developer)

```bash
bun install       # ya: npm install
bun run dev       # dev server -> http://localhost:8080
bun run build     # production build
```

Requirements: Node 20+ / Bun, aur backend (Lovable Cloud / Supabase) env keys:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_PROJECT_ID=...
```

Ye keys `.env` me project ke saath already inject hoti hain — inhe manually edit na karein.

---

## 2. Project Structure

```
src/
  components/     UI components (AppLayout, BillingStatusBar, dialogs, printing)
  pages/          Screens (POSScreen, SettingsPage, SuperAdminPage, Branches, HR, Accounts...)
  lib/
    store.ts            Core data layer (local-first, emits change events)
    localDb.ts          IndexedDB durable storage
    supabaseStore.ts    Cloud read/write mapping (tables + module_documents)
    deferredSync.ts     Retry queue — offline ops cloud par flush karti hai
    cloudDocs.ts        Extra modules ka cloud mirror (lists + single values)
    staffAuth.functions.ts / staffPortalAuth.ts   Staff login (username + PIN)
    printCss.ts, printLog.ts, printing/           Printing Center engine
  routes/         TanStack routes + /api server routes
supabase/migrations/    Database schema history
docs/                   Architecture + apps documentation
```

---

## 3. Architecture (Offline-First Hybrid)

```
[ UI ] -> [ store.ts ] -> [ IndexedDB (instant, offline) ]
                       -> [ deferredSync queue ] -> [ Cloud DB (Supabase) ]
```

- Har save pehle **local disk** par jata hai — POS internet ke bina bhi chalta hai.
- Har save simultaneously **cloud queue** me jata hai; online hote hi flush ho jata hai.
- Header chip (`Synced / Pending N / Offline`) queue depth live dikhata hai; click par manual flush.
- Bills, orders, menu, tables, staff, inventory, HR, accounts — sab cloud par mirror hote hain.
- Chhote modules (promotions, wallet, zones, wage, blocklist, templates, signatures) `module_documents` table me JSON documents ke tor par save hote hain.
- Images (logo, QR, promo, portal banner) cloud **storage buckets** me jati hain — base64 nahi.

### Order numbering
Order number **server** deta hai (`next_order_number` RPC + unique constraint), is liye:
- Do tills par kabhi same bill number nahi banta.
- Number kabhi aage-peeche nahi hota.
- Day Close par `reset_order_counter` se counter reset hota hai.

---

## 4. Multi-Tenant & Multi-Branch

- Har restaurant = ek `tenant`. Har tenant ke andar `branches`.
- RLS (row-level security) har query ko `tenant_id` + allowed `branch_ids` tak mehdood karta hai.
- Branch-level pricing, receipt header, aur reports supported.
- **Workspace Code** (6 characters, e.g. `C6803C`): Dashboard aur Users/Roles page par card me milta hai. Staff apps me restaurant identify karne ke liye.

---

## 5. Roles & Login

| Role | Login | Access |
|---|---|---|
| Super Admin | email + password | Saare restaurants, plans, devices, invoices, support chat |
| Owner / Admin | username + password (default `admin` / `admin123`) | Poora POS + settings |
| Manager | username + PIN | POS + approvals |
| Cashier | username + PIN | POS billing |
| Order Taker | username + PIN | Sirf order create/edit/send to kitchen |
| Rider | username + PIN | Delivery list + status |

Restricted actions (discount, void, refund, settle) par **Manager PIN** mangta hai aur har action **Audit Log** me record hota hai.

---

## 6. Devices & Plans

- Har device login par `register_device` RPC chalti hai: hardware id, IP, platform, version record hote hain.
- Plan ki device limit se zyada device auto-approve nahi hoti — Super Admin approve karta hai.
- Live Map par approved devices ke GPS pins nazar aate hain (heartbeat se update).

---

## 7. Printing Center (`/printing-center`)

Ek jagah: Printers, Print Server, Margins, Calibration, Queue, Diagnostics.
- KOT + Receipt templates jaisa design waisa hi print hota hai (koi CSS override nahi).
- Token slips: Classic, Compact, Boxed, Stars + Pre-Receipt (Boxed).
- Desktop app me silent printing; browser me dialog.
- Failed prints queue me rehte hain aur reprint ho sakte hain.

---

## 8. Day Close

1. Settings > Day Close me modules tick karein (Accounts, Inventory, HR, Ledger, Stock...). Selection auto-save hoti hai.
2. Day Close par:
   - Sab bills/module rows **soft-delete** hote hain — POS 00 ho jata hai, record admin history me mehfooz.
   - Saari tables **Free** ho jati hain.
   - Order counter reset.
   - Cloud backup + audit log save hota hai.

---

## 9. Mobile Apps

- `capacitor.rider.config.json` — DT Rider (`com.digitaltarget.dtrider`)
- `capacitor.ordertaker.config.json` — DT Order Taker (`com.digitaltarget.dtordertaker`)
- Ek hi APK sab restaurants ke liye: staff username + PIN (+ workspace code agar zaroorat ho) se login.

Build:
```bash
bun run build
npx cap sync android --config capacitor.rider.config.json
npx cap open android
```

---

## 10. Troubleshooting

| Problem | Wajah / Hal |
|---|---|
| "Cloud sync issue — saved locally" | Internet off ya schema mismatch. Chip click karke flush karein; error toast me table name dekhein. |
| Staff login fail | User inactive hai, ya galat workspace. Users/Roles me active + password reset karein. |
| Data refresh par gayab | Us module ka cloud mirror missing. `src/lib/cloudDocs.ts` ki list me key add karein. |
| Print nahi hota | Printing Center > Diagnostics dekhein; printer role assign hai ya nahi check karein. |
| Device approve nahi ho rahi | Plan device limit poori — Super Admin se limit barhayein. |

---

## 11. Security

- Har table par RLS enabled + explicit GRANTs.
- Sensitive operations SECURITY DEFINER functions ke through (staff login, plan change, device register, order numbering).
- Service keys sirf server par; browser me sirf publishable key.
- Staff PIN bcrypt hash me store hoti hai — plain text kahin nahi.
