# Security findings from live probes — 2026-10-30

**Method.** Each probe ran as a `DO` block that became a real user (`set local role authenticated` + that user's `sub`),
counted or tested something, and then **raised an exception on purpose so the transaction rolled back**. Nothing was
persisted by any probe. No secret value was ever read: only counts, column names, hash *formats* and yes/no results.
The subject was a branch-bound cashier of "My Restaurant" (5 branches), bound to *burewala*; the RLS helper `auth_branch_ids()`
returned exactly 1 branch for it.

## What is protected (the part that matters most for money)

| Table | Rows visible: own branch | other branches |
|---|---|---|
| `orders` | 36 | **0** |
| `order_items` | 97 | **0** |
| `order_counters` | 1 | **0** |

Bills, their lines and the invoice counter are isolated by branch, enforced in the database. **Most other branch-scoped tables
hold zero rows in production today, so their isolation could not be proven by data** (cash movements, shifts, day closes, inventory,
refunds…). They need a seeded test harness; that gap is listed under "Not verified".

## Findings

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| S1 | **High** | Any signed-in staff member could read every colleague's **PIN hash** (`user_profiles.pin_hash`), because `authenticated` had SELECT on the whole table and `profiles_read` lets a tenant read all its profiles. Hashes are bcrypt, but a POS PIN is four digits: ten thousand guesses against bcrypt is minutes of work, so a readable hash is a readable PIN — and usernames are in the same table. | cashier read 4 other users' hashes | **FIXED v1.70.0** (applied 2026-10-30) |
| S2 | **High** | **HR and payroll are readable and writable by every role in the tenant.** `employees` (CNIC, phone, address, salary), `payslips`, `advances`: one policy each, `FOR ALL … USING (tenant_id = auth_tenant_id())`. | cashier saw 3 employees, 1 payslip, 1 advance; a no-op `UPDATE` on `employees` affected 1 row | **OPEN** |
| S3 | **High** | **A cashier can write the restaurant's settings, including licence flags.** `tenant_settings_tenant_rw` is `FOR ALL`. Super Admin stores `premiumThemeAllowed` (and other feature flags, PRA settings, tax settings) inside that same JSON row (`SuperAdminPage.tsx:754-770`), so any staff member can unlock the premium themes — now 23 of them — or change tax/PRA settings for their own restaurant. The gate is front-end only. | no-op `UPDATE` on `tenant_settings` affected 1 row | **OPEN** |
| S4 | Medium | Staff can read **other branches'** audit logs, **GPS locations** of staff and branch-tagged documents. | burewala cashier saw `staff_audit_logs` 86 Main-Branch rows, `staff_locations` 32 Main-Branch + 5 hafiz rows, `module_documents` 17 Main-Branch rows | **OPEN** |
| S5 | Medium | **Customers' app PIN hashes** (`customers.pin_hash`, 5 of 2,254 customers have one) are readable by every staff member, and the POS loader does `select('*')` so they travel in the network response (the client then drops them from memory). | policy `customers_tenant_rw` is `FOR ALL` for the tenant; `sbLoadCollection` uses `select('*')` | **OPEN** |
| S6 | Low | 44 `SECURITY DEFINER` functions are executable by `anon`. Four were read in full (`reset_order_counter`, `recycle_bin_restore`, `update_own_tenant_name`, `sync_order_money_mirror`): all reject a null `auth_tenant_id()`, so not exploitable — but the grant should be removed wherever the function is not meant to be public. | Supabase advisor + function bodies | **OPEN** |
| — | Info | Writes to **other users' profiles are refused** for a cashier (`profiles_manage` needs owner/admin): 0 rows updated. | probe | OK |

A correction made while writing this: the probe's `tenant_settings: 1 sibling row` is the restaurant's **tenant-wide** row (branch id is the
all-zero placeholder), not another branch's data. S3 is about *writing* that row, not about branch visibility.

## S1 — what was done

Migration `supabase/migrations/20261030140000_v1_70_0_hide_pin_hashes_from_staff.sql`, applied as `v1_70_0_hide_pin_hashes_from_staff`.
It takes table-level SELECT from `authenticated` on `user_profiles` and grants it back on every column except `pin_hash`. No row, policy,
write grant or other role changed.

*Dependencies checked first:* only `SECURITY DEFINER` functions read `pin_hash` (they run as `postgres`, untouched); the browser never reads it and
never `select *`s `user_profiles` (its three reads name their columns); no view depends on the table; no browser code subscribes to its changes.

*Verified after applying (rolled-back probes):*

| Check | Result |
|---|---|
| cashier `select pin_hash` | refused — `42501` |
| cashier `select *` from `user_profiles` | refused (expected; the browser never does it) |
| the three reads the app really makes, and a staff-list style read | all work (1, 1, 6 rows) |
| `auth_tenant_id()`, `auth_role()`, `auth_branch_ids()` | unchanged (tenant matches, role `cashier`, 1 branch) |
| cashier still reads `orders` | 36 rows, as before |
| `verify_staff_pin` with a wrong PIN | normal `{"ok": false}`, no permission error |
| the real login path (service role → `staff_login_global`, wrong password) | normal `{"ok": false, "reason": "bad_password"}`; service role can still read `pin_hash` (11) |

*Rollback (one statement, restores exactly the previous grant):* `grant select on public.user_profiles to authenticated;`
*Future columns:* a new `user_profiles` column is not readable by `authenticated` until granted — deliberately the safe default.
*Guard:* `src/test/pinHashNotReadable_v1_70_0.test.ts` fails if browser code ever selects `pin_hash` or `select *`s `user_profiles`
(mutation-checked).

*Not verified:* an actual PIN or password sign-in from a browser or the Windows app (no credentials used). The login function was exercised with
wrong credentials only, which proves the permission path, not the success path.

## Plan for the rest (nothing below has been applied)

These change what real staff can do, so each needs the same sequence: confirm who legitimately uses the screen, change policy + app together,
test as the affected role, keep a one-statement rollback.

1. **S3 first (licence bypass).** Move the platform-controlled flags (`premiumThemeAllowed`, feature/optional-module flags, plan limits) out of the
   tenant-writable JSON into a Super-Admin-only place (a column on `tenants`, or a `tenant_entitlements` table with a read-only policy for tenants),
   and restrict `tenant_settings` writes to owner/admin. App change: read the entitlement from there; Super Admin writes it there.
   Until then the front-end gate stands but is bypassable by a signed-in staff member.
2. **S2.** Replace `employees_tenant_rw` / `payslips_tenant_rw` / `advances_tenant_rw` with policies that require `auth_role() in ('owner','admin')`
   (plus `manager` if the HR page is meant for managers — `permissions.ts` decides) and the branch predicate for branch-bound roles.
3. **S4.** Add `branch_id in (select auth_branch_ids())` (or null) to the read policies of `staff_audit_logs`, `staff_locations`, and — after
   deciding whether they are tenant-wide rosters — `module_documents`.
4. **S5.** Change `sbLoadCollection('customers')` to an explicit column list (the writable set already exists as `ALLOWED_COLUMNS.customers`),
   then take `pin_hash`, `pin_attempts`, `pin_locked_until` out of `authenticated`'s grant exactly as in S1.
5. **S6.** `revoke execute … from anon` for each function that is not part of the public ordering/portal flow, one at a time, each tested.
6. A **seeded isolation test** (a throwaway tenant with two branches and a row in every branch-scoped table, probed as each role) so the
   "zero rows" tables are proven rather than assumed.

## Not verified

- Isolation of every branch-scoped table that holds no rows today.
- Roles other than cashier (order_taker, rider, manager) — the probe used a cashier only.
- Whether any restaurant's customers actually use the customer-app PIN in a way that makes S5 more or less serious.
- That a PIN can be recovered from its bcrypt hash in practice: this audit did not attempt it (and will not). The risk is stated from the size of the PIN space.
