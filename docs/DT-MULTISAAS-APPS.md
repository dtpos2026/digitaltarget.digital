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

## 3. Which restaurant is this app for?

One APK serves every restaurant, so the name cannot come from the bundle — it
comes from the login. Since v1.45.0 there is ONE resolver behind every screen
(`src/lib/restaurantIdentity.ts`), and it answers for all four kinds of session:

| Session | How it resolves |
|---|---|
| Rider / Order Taker (opaque portal token, no `auth.uid()`) | `portal_restaurant(p_token)` |
| POS owner or admin (Supabase session) | `tenants` + `tenant_settings`, then `get_workspace_code()` |
| POS staff PIN login (no Supabase session) | the code `staff_login_check` returns at sign-in |
| Offline | the cache, written by whichever of the above last succeeded |

It paints from cache on the first frame, so a rider on a dead signal still sees
whose app it is instead of a blank header. The cache is discarded if it belongs
to a different tenant, and is wiped on `clearTenant()` and on portal sign-out.

Where it shows:

- **POS / Windows** — a chip in the app header on every page: restaurant, and
  the Workspace Code. Tap the code to copy it. The Dashboard and Users & Access
  also carry the full Workspace Code card.
- **Rider / Order Taker** — restaurant, branch and Workspace Code in the header,
  and again on the Order Taker's **Me** tab.

`portal_restaurant` prefers the name the owner typed into POS Settings
(`tenant_settings.settings->>'name'`, branch row before tenant-wide row) over
`tenants.name`, which is only the name the row was created with. Renaming the
restaurant in Settings therefore changes the rider's phone too.

### The staff member's own profile

`portal_update_me` lets a rider or order taker set their **name, phone and
picture** — nothing else. Username, role, restaurant and branch are set by the
restaurant and are not theirs to change.

The picture goes through the `profile-photo` Edge Function, never the browser:
the `customer-photos` bucket has a public READ policy and no write policy, and
the FUNCTION picks the path from the identity Postgres resolves, so no caller
can overwrite anyone else's. Both `portal_update_me` and
`public_customer_set_photo` refuse a URL that is not a file in that bucket.

---

## 4. Android builds

The three Android projects live in a separate repository, `dtpos2026/dtpos.apk`.
Everything Gradle reads is committed there — there is no `cap add`/`cap sync`
step and no npm install in the build.

| App | Name | Application ID | Kind |
|---|---|---|---|
| Customer | per restaurant | `com.digitaltarget.<slug>` | packages the web bundle |
| Rider | DT Rider | `com.digitaltarget.dtrider` | WebView on this site |
| Order Taker | DT Order Taker | `com.digitaltarget.dtordertaker` | WebView on this site |

### Building from Super Admin (the normal way)

Super Admin → **Customer Apps**:

- **Per restaurant** — set the app name, icon and colours, Save, then
  **Build APK**. This is the Customer app, and it is the only one that is
  branded per restaurant.
- **Staff Apps — Rider & Order Taker** — one build for every restaurant, so
  there is no restaurant to pick. `apk-build` REFUSES a tenant on these two:
  building them with a restaurant selected is what once put one client's name
  on every rider's phone.

Set a **version name** before building. The versionCode is derived from it
(`1.2.3` → `10203`) and must rise every time: Android refuses to install a build
whose versionCode is not higher than the installed one, and the only way past
that is to uninstall, which signs the person out.

The build needs a `GITHUB_APK_TOKEN` secret on the Supabase project — a
fine-grained GitHub token with Actions read+write on `dtpos2026/dtpos.apk` and
nothing else. Without it the panel says so plainly instead of failing.

### Building from GitHub directly

`dtpos2026/dtpos.apk` → Actions → **Build Android APKs** → Run workflow. Inputs:
`apps`, `tenant_id` (Customer only), `app_id`, `refresh_bundle`, `version_code`,
`app_version`.

### Why the portal apps carry `?app=` in their URL

The Rider and Order Taker APKs point at this site:

```
https://digitaltarget.digital/?app=rider#/rider-portal
https://digitaltarget.digital/?app=order-taker#/order-taker
```

The fragment alone is not enough. Android drops it on a WebView restore after
the process is killed, and the app then loaded `/` — which is the full POS, so a
staff phone showed the owner's email login, and the Order Taker could land in
the Rider Portal. Both were reported.

The `?app=` marker is part of the URL proper and is reloaded with it. `lib/appEntry`
reads it before anything reads the hash, remembers it, and puts the app back on
its own route. `tools/brand.mjs --site` preserves it when it moves the origin.

Android permissions used by the Rider app: `ACCESS_FINE_LOCATION`,
`ACCESS_COARSE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS`.

---

## 5. Test checklist before release

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
- Order Taker APK: force-stop it, reopen → the DT Order Taker login, never the
  POS owner email login and never the Rider Portal
- Sign out of a portal, then check `staff_portal_sessions` — the row is gone,
  not merely the local token
- Rider sets a name, phone and picture → visible after a reinstall (it is stored
  server-side, not on the phone)
- Rename the restaurant in POS Settings → the rider's header changes too
