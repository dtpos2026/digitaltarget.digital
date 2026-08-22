# DT Multi-SaaS — Rider & Order Taker Apps

**One DT Rider APK → all restaurants. One DT Order Taker APK → all restaurants. One web platform, one secure multi-tenant backend.**

---

## 1. How a staff member reaches the right restaurant

The apps never choose the restaurant. Sign-in sends only credentials:

```
username / phone + password/PIN  (+ optional Workspace Code)
        ↓  staffSignInGlobal  (server function)
        ↓  staff_login_global()  — SECURITY DEFINER, service-role only
user_id → tenant_id → branch_id → role   (resolved in Postgres)
        ↓
device is bound to that tenant, cross-tenant cache is wiped, dashboard loads
```

- `src/lib/staffAuth.functions.ts` → `staffSignInGlobal` (server, never trusts client tenant)
- `src/lib/staffPortalAuth.ts` → shared client helper for both apps
- Rider app: `#/rider-portal` · Order Taker app: `#/order-taker`
  (no tenant id needed in the URL any more; the old `/:tenantId` links still work)

### Workspace Code

Every restaurant has a unique 6-character **Workspace Code** (`tenants.workspace_code`),
visible in **Users & Access** and copyable by the admin.

It is **only a disambiguator**: it is required only when the same username exists at
more than one restaurant. It is never a credential — an attacker with a code and no
valid password gets nothing, and RLS still scopes every row by tenant.

### Role guard

The Rider app refuses non-`rider` accounts; the Order Taker app refuses
non-`order_taker` accounts (`expectedRole` in `portalSignIn`).

---

## 2. Security model

| Layer | Enforcement |
|---|---|
| Identity | Supabase Auth for owner/admin; hashed (bcrypt) staff credentials verified inside Postgres |
| Tenant resolution | Server-side only (`staff_login_global`) |
| Row access | RLS on every table via `auth_tenant_id()` / `auth_branch_ids()` / `auth_can_branch()` |
| Restricted actions | `src/lib/actionGuard.ts` + `RestrictedActionGate` + Manager PIN |
| Audit | `staff_audit_logs` (insert-only for staff; update/delete denied) |
| Location | `staff_locations`, consent-gated, tenant-scoped, insert-only |

Order Taker restrictions (payment, settle, free table, void, refund, discount,
bill close) are enforced by the guard + manager approval, and every approval is
written to the audit log.

---

## 3. Android builds (Capacitor)

Two app identities, one codebase:

| App | Name | Application ID | Config |
|---|---|---|---|
| Rider | DT Rider | `com.digitaltarget.dtrider` | `capacitor.rider.config.json` |
| Order Taker | DT Order Taker | `com.digitaltarget.dtordertaker` | `capacitor.ordertaker.config.json` |

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/android @capacitor/geolocation @capacitor/splash-screen

npm run build

# DT Rider
npx cap add android --config capacitor.rider.config.json
npx cap sync  android --config capacitor.rider.config.json
npx cap open  android --config capacitor.rider.config.json

# DT Order Taker
npx cap add android --config capacitor.ordertaker.config.json
npx cap sync  android --config capacitor.ordertaker.config.json
npx cap open  android --config capacitor.ordertaker.config.json
```

Each config writes into its own folder (`android/Rider`, `android/OrderTaker`) so the
two APKs never overwrite each other. Both use the Digital Target purple identity
(`#3C096C` / `#5A189A` / accent `#E0AAFF`) for icon, splash and status bar.

Android permissions needed by the Rider app: `ACCESS_FINE_LOCATION`,
`ACCESS_COARSE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`.

---

## 4. Test checklist before release

- Restaurant A staff login, then Restaurant B staff login on the same device
  (cache wipe on tenant switch — `sessionIsolation.ts`)
- Same username at two restaurants → app asks for the Workspace Code
- Wrong Workspace Code → `no_user_in_workspace`, no data leak
- Rider account rejected by the Order Taker app and vice versa
- Branch-scoped staff sees only their branch's tables/orders
- Payment / void / refund blocked for Order Taker without manager approval
- Audit log rows created for login, order create, send-to-kitchen, status changes
- Location rows only visible inside the owning tenant
- Airplane mode → offline queue, reconnect → no duplicate orders (idempotent
  `op_id` in `apply_sync_batch`, server-minted order numbers)
