# Security review — 2 Nov 2026 (v1.99.0 baseline)

Scope: Supabase project `drpzxzpvkpqfxcjbwypo` (security advisors + read-only inspection of
function bodies and RLS policies) and the public website server functions.
**Nothing in the database was changed by this review.** Every fix below that touches the
database is a proposal and waits for owner approval + a confirmed DB backup.

## 1. Advisor results (4 lints)

| Lint | Level | Count | Verdict |
|---|---|---|---|
| `rls_enabled_no_policy` | INFO | 3 tables (`customer_otps`, `customer_sessions`, `staff_portal_sessions`) | **Intended.** These hold hashed OTPs / session tokens. RLS on + no policy = deny-all for the API; they are reached only through SECURITY DEFINER RPCs. Keep as is. |
| `auth_leaked_password_protection` | WARN | 1 | **Action (owner, dashboard only).** Turn on *Auth → Passwords → Leaked password protection*. Cannot be done from SQL. |
| `anon_security_definer_function_executable` | WARN | 45 | Reviewed one by one, see §2. No function lets an anonymous caller read or change another restaurant's private data. Hygiene fixes proposed. |
| `authenticated_security_definer_function_executable` | WARN | 80 | 35 are signed-in-only. 34 of 35 check the caller inside (`auth_tenant_id()`, `is_super_admin()`, `can_access_branch()` …). One has no check (see §2.3). |

RLS: no table in `public` has RLS disabled (no `rls_disabled_in_public` lint). The only policy
with `USING (true)` is `profiles_auth_admin_read`, scoped to the `supabase_auth_admin` role
(needed by the auth hook), not to `anon`/`authenticated`.

## 2. The 45 anonymous-callable functions

### 2.1 Token-gated portal / customer RPCs — OK by design (30)
`portal_*` (14), `public_customer_*` (13), `portal_verify_manager`, `public_customer_logout`.
Each resolves a hashed session token before touching data. Lock-outs exist:
* staff manager re-auth: 5 wrong → 15 min lock (per session)
* customer PIN: 5 wrong → 15 min lock (per phone)
* customer OTP: 3 requests / 15 min per phone, 5 wrong codes burn the code

### 2.2 Caller-checked inside, so anon gets "not permitted" (10)
`auth_branch_ids`, `device_heartbeat`, `get_workspace_code`, `orders_waiting_by_branch`,
`pos_change_own_password`, `promotion_audience_size`, `recycle_bin_list`, `recycle_bin_restore`,
`register_device` (×2), `reset_order_counter`, `update_own_tenant_name`.
All read `auth_tenant_id()` / `is_super_admin()`, which are `NULL` for `anon`.
**Hygiene fix (S-1):** `REVOKE EXECUTE … FROM anon` on these — they have no anonymous use, and
removing the door is better than relying on the lock.

### 2.3 Findings that deserve a decision

| ID | Severity | Finding | Proposed fix |
|---|---|---|---|
| S-2 | **Medium** | `public_track_order(tenant, order_number, phone_last4 \| table_label)` has **no throttle**. With a known tenant id an attacker can walk order numbers and 10 000 last-4 combinations (or common table labels like `T1`) and read items, totals and status of other people's orders. | Make anonymous tracking require the order **UUID** (unguessable) — the website already has it after checkout; keep number+last4 only for signed-in customers (`public_customer_order_track`). Alternatively add a per-tenant attempt counter. Needs DB change → approval + backup. |
| S-3 | **Medium** | `public_place_order` ignores owner switches (delivery/pickup/dine-in off, minimum order) and does not add the delivery fee. Already mitigated in the app (`submitPublicOrder` backstop, v1.95.0), but a direct RPC call bypasses it. | Move the same checks into the RPC. **Needs your explicit approval + DB backup confirmation** (not given yet). |
| S-4 | Low | `public_customer_request_otp` limits 3 per phone, but not per tenant → an attacker can pump SMS cost by cycling numbers. | Add a per-tenant hourly cap + CAPTCHA/turnstile on the web form. |
| S-5 | Low | Customer PIN is 4 digits with 5 tries / 15 min → a determined attacker needs ~33 h per account; locked/blocked replies reveal that an account exists. | Move to a 6-digit PIN (or progressive lock-out), return one generic reply. |
| S-6 | Low | `sync_order_money_mirror()` is a trigger function and is anon-executable. It cannot be called over REST (trigger return type) but should not be granted. | `REVOKE EXECUTE … FROM anon, authenticated`. |
| S-7 | Low | `sync_super_admins_from_allowlist()` is executable by any signed-in user and has no caller check. It only copies the (server-side) allow-list into the table, so it cannot add an arbitrary user, but it should not be callable by a restaurant user. | `REVOKE EXECUTE … FROM authenticated` and call it from a trigger / service role only. |
| S-8 | Info | `verify_invoice(uuid)`, `public_tenant_by_slug`, `customer_app_blocked`, `generate_customer_code` are anonymous on purpose (invoice QR check, site lookup, app-disabled screen, code preview). UUIDs are unguessable; nothing sensitive beyond invoice number/total/status/customer name. | Keep. |

### 2.4 One-shot migration (proposal only — NOT applied)
```sql
-- S-1, S-6, S-7  (additive-safe: removes grants only, no data touched)
revoke execute on function public.auth_branch_ids()                       from anon;
revoke execute on function public.device_heartbeat(uuid,double precision,double precision,text) from anon;
revoke execute on function public.get_workspace_code(uuid)                from anon;
revoke execute on function public.orders_waiting_by_branch()              from anon;
revoke execute on function public.pos_change_own_password(uuid,text,text,text) from anon;
revoke execute on function public.promotion_audience_size()               from anon;
revoke execute on function public.recycle_bin_list(text,integer)          from anon;
revoke execute on function public.recycle_bin_restore(text,uuid[])        from anon;
revoke execute on function public.reset_order_counter(uuid,integer)       from anon;
revoke execute on function public.update_own_tenant_name(text)            from anon;
revoke execute on function public.sync_order_money_mirror()               from anon, authenticated;
revoke execute on function public.sync_super_admins_from_allowlist()      from anon, authenticated;
-- register_device (both overloads): revoke from anon after confirming the
-- Windows shell registers devices only after sign-in.
```
Rollback is the matching `GRANT`. The call sites in `src/` (`supabaseSync.ts` register/heartbeat,
`restaurantIdentity.ts`, `supabaseStore.ts`, `LoginPage.tsx` forced password change) all run
**after** sign-in (the functions already reject a caller without a tenant), and the Windows shell
repo has no direct call. Still, confirm on a staging copy first — not executed here.

## 3. Application layer

| Area | Status |
|---|---|
| Public website settings | Allow-listed server function with the server key; anon cannot read `tenant_settings`. ✔ |
| Owner switches (delivery / pickup / dine-in / guest) | Enforced server-side in `submitPublicOrder` (fail-open if settings unreadable). RPC itself not yet (S-3). |
| Staff PIN / manager password | bcrypt (`crypt`) in DB; lock-outs on portal re-auth. ✔ |
| Role/permission model | `userHasFeature` + role presets; "no rights" marker `feat.none`. ✔ |
| Service-role key | Server-only (`*.functions.ts`); not in the browser bundle. ✔ |
| Secrets in repo | None committed; env files are git-ignored. ✔ |
| Backups with pictures | Embedded images capped at 4 MB each; restore re-uploads through the normal storage policy. ✔ |

## 4. Custom Website — security design (feature not built yet)
* Orders from a restaurant's own website must arrive through a **signed intake endpoint**
  (HMAC of the body with a per-restaurant secret, timestamp window ±5 min, idempotency key).
* The secret is generated server-side, shown once, stored hashed/encrypted, rotatable.
* Intake maps the payload to the same internal order shape as `public_place_order`, so all
  switches/totals are validated once, in one place (needs S-3 first).
* The "open that website's admin panel" link is a plain outbound link or iframe-free
  deep link; no credentials are stored in the software.

## 5. Recommended order
1. Owner: enable *Leaked password protection* (2 minutes, dashboard).
2. Approve S-1/S-6/S-7 migration (grants only) after a backup.
3. Approve S-2 + S-3 (RPC changes) with a backup — these two close the remaining real gaps.
4. S-4/S-5 with the Customer-app hardening pass.

## 6. Status after v1.107.0 (6 Nov 2026) — what was applied, what was not

The owner instructed the work to be completed ("complete it now"). **No backup confirmation was given in words**, so the
change was made the careful way: the exact grants and the full previous `public_track_order` body were read from the live
database first and saved in `docs/rollback/` (a one-file undo for each step), every step was applied separately, each was
checked against the live database straight after, and nothing that holds business data was touched.

| ID | Applied? | What was done |
|---|---|---|
| S-1 | **Yes** | EXECUTE removed from `public` and `anon` on 12 signed-in-only functions (both `register_device` overloads included). Signed-in users and the server keep it. Every call site in `src/` runs after sign-in, and `pos_change_own_password` also checks `auth_tenant_id()` inside. |
| S-6 | **Yes** | `sync_order_money_mirror()` (trigger) no longer executable by `public`, `anon`, `authenticated`. A trigger does not need the firing user to hold EXECUTE. |
| S-7 | **Yes** | `sync_super_admins_from_allowlist()` no longer executable by `authenticated`. `sa_add_team_member` (SECURITY DEFINER) still calls it. |
| S-2 | **Yes — as a throttle, not "uuid only"** | The website's tracking page really uses *order number + last 4 digits* (`store.ts`), so removing that path would have broken it. Instead: a lookup by the order's own uuid is unchanged; a guessable lookup that finds nothing counts as a miss for that restaurant, and after 60 misses in a 10-minute window the guessable path answers "not found" until the window ends (10,000 combinations would take about 28 hours). A found order never counts. Misses are only recorded for restaurants that exist; rows older than a day are removed. Verified on the live database: 65 wrong guesses → blocked at 60, uuid lookup still works, the test rows were deleted afterwards. One new closed table `public_track_attempts`. |
| S-3 | **Corrected finding — no change made** | `public_place_order` is **not** callable by `anon` or `authenticated` (its grants are `postgres` and `service_role` only), so the "direct RPC call" in the original finding could not happen. It also does not trust the client's prices: it re-reads each item from `menu_items`. The owner's switches are enforced in `submitPublicOrder` (the only caller) and in the new own-website intake. What it still does not do is add the delivery fee to the stored total (the page shows it); moving the switch checks inside the RPC would add risk to the live order path without closing a reachable hole, so it was left. |
| S-4 | No | Per-restaurant SMS cap + CAPTCHA — with the customer-app hardening pass. |
| S-5 | No | 6-digit PIN / generic reply — same pass. |
| — | No (owner, dashboard only) | *Auth → Passwords → Leaked password protection* is still off. |

Advisor result after the change: anonymous-callable SECURITY DEFINER functions **45 → 32**, signed-in **80 → 78**; three new
closed tables (`public_track_attempts`, `custom_site_intake`, `custom_site_orders`) show as INFO "RLS on, no policy" — intended,
the same as the three session tables.

### Custom Website (WP-8) as built
Two closed tables and one server-only function (`custom_site_place_order`, `service_role` only). The intake is
`POST /api/custom-site/order/<restaurant id>`: size cap → own-site mode on → HMAC-SHA256 over `<timestamp>.<body>` with
±5 minutes → 60 orders a minute per restaurant → shape → the owner's switches → idempotency key → the database places the
order. **Deviation from the design:** the secret is stored in clear text in a table that no API role can read (RLS on, no
policy, no grants but `service_role`), not hashed — HMAC verification needs the key itself. It is shown to the owner once,
only its last four characters afterwards, and is replaced or revoked in one click.
