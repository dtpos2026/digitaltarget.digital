# Release checklist — DT POS Enterprise v1.70.1

Written 2026-10-30. Everything below is either something that was **done and checked** (and says how) or something
**you still have to do** (and says so). Nothing is marked done that was not.

## Release status: **NOT READY — BLOCKERS REMAIN**

The code is built, type-checked and tested, and the ZIP builds from a clean folder. It is **not** declared ready because
these things have not happened yet, and only you (or a Windows machine) can do them:

| # | Blocker | Why it blocks | Who / how |
|---|---|---|---|
| B1 | **Nothing from v1.56.3 → v1.70.1 is deployed.** The live website still runs an older build. | A customer has seen none of this work. | You: `npm run deploy` (step 2 below) |
| B2 | **The Windows installer `.exe` has never been built or started.** Linux stops at the icon/version step (needs wine). | The one file you will hand to restaurants is unproven. | You, on Windows: `npm install` → `npm run build` → `npm run dist` (step 4) |
| B3 | **No real sign-in, no real print, no real sale** was performed by me (no credentials, no printer, no display). | Login, receipts and the new Payment / kilogram screens are tested by code only. | You: the 10-minute smoke test (step 3 and step 5) |
| B4 | **Invoice numbering is not fixed.** 35.1 % of First Chef's paid receipts are out of order by payment time; 181 bills were renumbered by the server. | The brief says numbering must be sequential. The fix is designed, not applied, because it touches live bills. | Needs your decision (option A / B / C in the audit, §5) **and** your confirmation that a Supabase backup exists |
| B5 | **Open security findings S2–S6** (HR/payroll visible to every role, settings writable by a cashier, other branches' audit/GPS logs, customer PIN hashes, 44 anon-executable functions). S1 is fixed. | A cashier could read salaries or flip a licence flag. | Needs your confirmation of the default (owner/admin only) — see `docs/audit/2026-10-30-security-findings.md` |
| B6 | **PRA is not verified against the current official specification** and has no sandbox credentials. | Fiscal submission must not go live on a guess. It stays **off by default**. | You: PRA registration + sandbox credentials; then a sandbox test |

A restaurant that does **not** use PRA can run the new build the moment B1–B3 are cleared; B4 and B5 are risk you accept or fix first.

---

## Order of work

### 1. Before anything — backup (5 minutes, free)
Supabase dashboard → project `drpzxzpvkpqfxcjbwypo` → **Database → Backups** → confirm a recent backup exists (or take one).
Database changes in this release are already applied (below), so this is for safety, not because step 2 touches the database.

### 2. Deploy the website (this is what makes all of it live)
```bat
cd digitaltarget.digital
npm install
npm run deploy
```
`deploy` builds and pushes `dist` to Cloudflare Pages (`dt-pos`). Open the site and hard-refresh (Ctrl+F5); the version
shown must read **1.70.1**.

**Database state — nothing to run.** All 8 migrations in `supabase/migrations` are already applied to production
(checked against the migration list on 2026-10-30; the last two are `v1_65_0_orders_delta_index` and `v1_70_0_hide_pin_hashes_from_staff`).

### 3. Smoke test the website — 10 minutes, one real restaurant account
| Step | Expect |
|---|---|
| Sign in as an owner | the dashboard opens; no "wrong username or password" |
| Sign in as a cashier (PIN) | the POS opens; the sidebar shows only the cashier's modules |
| Add 2 items → **Pay** | the new Payment screen: *Total payable*, method tiles, *Amount received*, Exact / quick amounts, Change / Due, *Complete Sale* |
| Pay **cash, exact** | a receipt; the bill appears in Orders with the right total |
| Pay **cash, over-tender** (e.g. 1000 on 760) | Change shows 240; the saved bill's total is 760, not 1000 |
| Add a kilogram item → open the weight panel | *By weight* and *By amount* both give the same line the old screen gave |
| Print the receipt | prints on your printer (58 mm and 80 mm if you use both) |
| Orders list | newest first; opens a bill |
| Super Admin → a restaurant's messages | opens; an unread restaurant message becomes read after opening. If a warning toast appears, **screenshot it** — that is v1.70.1 telling you the server refused |
| Settings → Theme | the 21 themes apply; text stays readable on each |

If any row fails: stop, do not build the installer, and use the rollback below.

### 4. Build the Windows app (on a Windows 10/11 PC)
Needs **Node.js 22 LTS** (https://nodejs.org) and ~3 GB free. Unzip `DT-POS-Enterprise-Windows-source-v1.70.1.zip`, open CMD in that folder:
```bat
npm install
npm run build
npm run dist
```
Result in `dtpos-desktop\release\`:
- `DT-POS-Setup-1.70.1.exe` — installer
- `DT-POS-Portable-1.70.1.exe` — single file, no install

`README-BUILD.md` inside the ZIP lists the settings and the known snags (SmartScreen warning on an unsigned installer, proxy, etc.).
**If `npm run dist` fails, copy the last 30 lines of the output** — that is the one step I could not run on Linux.

### 5. Smoke test the Windows app
| Step | Expect |
|---|---|
| Run the installer, start **DT POS** | a window opens on the login screen, with the new icon |
| Sign in | same account as the website; same orders |
| Take one sale offline (unplug the network), plug it back | the bill uploads; it appears on the website's Orders |
| Print a receipt | prints (the shell used to refuse printing; fixed in the shell repo, commit `cc8449a` — not yet seen on a real printer) |
| Close and reopen the app | still signed in; no data lost |
| Upgrade (run the installer again) | local data is kept |

---

## Rollback

| What | How | Cost |
|---|---|---|
| **Website** | Cloudflare dashboard → Workers & Pages → `dt-pos` → **Deployments** → pick the previous deployment → **Rollback** | one click, seconds |
| **v1.70.0 database change** (PIN hashes hidden) | one statement: `grant select on public.user_profiles to authenticated;` — this restores exactly the previous grant | seconds; reopens finding S1, so only if something breaks |
| **v1.65.0 index** | `drop index if exists public.orders_tenant_updated_idx;` | only slows the orders poll; no data involved |
| **Delta orders poll** | the flag `ENABLE_ORDERS_DELTA_PULL` in `src/lib/featureFlags.ts` set to `false` and redeploy — the app goes back to reading the whole table, as before | one redeploy |
| **Windows app** | uninstall, or reinstall the previous installer. Local data is left alone on uninstall and on upgrade | minutes |

No data-changing statement was run on production during this work. The only database changes are the index and the column grant above.

---

## What is in v1.70.1 (and the 15 versions before it that are not live yet)
See `docs/CHANGELOG.md` for every release and `docs/audit/2026-10-30-master-audit.md` for the reasoning. Headlines since v1.56.3:
delta orders poll (less egress), branch scoping on order screens, Owner Management by branch, Soft Light theme and 21 reference themes,
new Payment screen and kilogram panel, product icon, currency-aware POS total, PIN hashes hidden from staff, message-read hardening.

## Known issues (not fixed, not hidden)
- **Invoice numbering** — see B4. Existing numbers are never renumbered by anything in this release.
- **~126 hard-coded "PKR" strings** in 20 files; a restaurant on SAR/AED sees rupees on those screens (the POS cart total is fixed).
- **Security S2–S6** — see B5.
- **Super Admin "client → link restaurant → No Restaurant"** — could not be reproduced; no such table or label exists in the code. Needs a screenshot.
- **Duplicate modules** (two KDS screens, two Credits screens) — report only; nothing removed or merged until you approve.
- **PRA** — submission log lives on the device only; the specification has not been checked against the current official document.
- **Real-network multi-till sync** and **Rider / Order Taker on a real phone** — not tested by me.

## Not in this release
Post-sale "Order Successful" screen, modifier/add-on groups, table legend/reservations, dashboard KPI sparklines, the organization layer (ER target),
external-website integration tables, S2–S6 hardening, signed installer (needs a certificate you buy), the Android apps (separate repo `dtpos.apk`;
its branch and `dtpos-desktop`'s must be merged to their `main` by you).

## Evidence
`docs/audit/2026-10-30-testing-report.md`: 1,961 tests pass (125 files), TypeScript clean, production web build OK, shell 27/27, fresh-extract
`npm install` + `npm run build` OK. Each row says what it proves and what it does not.
