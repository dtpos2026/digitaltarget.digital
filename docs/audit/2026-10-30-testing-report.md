# Testing report — 2026-10-30 (build under test: v1.74.0)

Four kinds of evidence were used. They are not equal, and each row below says which one it rests on.

| Kind | What it proves | What it does not |
|---|---|---|
| **Unit / component tests** (Vitest, happy-dom) | code behaves as asserted; mutation-checked where marked | anything in a real browser, printer, or network |
| **Chromium screenshots** against the real stylesheet | how a screen looks | behaviour with real data |
| **Live database probes** — read-only or rolled back (`DO` block that ends in a deliberate exception) | what the production database actually enforces | anything about the UI on top of it |
| **Fresh-extract build** of the delivered ZIP | the ZIP builds from scratch on a clean tree | the Windows installer itself |

## Results

| Check | Result |
|---|---|
| TypeScript, whole web app | **clean** |
| Test suite | **2,072 passed, 0 failed, 1 skipped** (129 files). The skip, `version.test.ts:59`, predates this work. Start of the session: 1,762 passing → **+310 tests**. |
| Production web build | **OK** (`npm run build`) |
| Windows shell, from the delivered ZIP | **27 / 27 tests**, typecheck clean, `npm run build` OK (9 s) |
| ZIP v1.70.1, fresh extract | `npm install` exit 0 (33 s); `npm run build` OK (9 s); shell version stamped 1.26.9 → 1.70.1; inside the extract the web suite is **1,961 passed / 125 files** and the shell **27 / 27**. `npm run dist` on Linux builds `release/win-unpacked/DT POS.exe` (189 MB) and then stops with `wine is required` — the installer step, which does not need wine on Windows. **The `.exe` installer itself is therefore NOT VERIFIED.** The ZIP's root `npm run deploy` was run only as far as its guard: with `wrangler` absent it stops before building anything and prints the two commands to install and log in. **A real deploy was not run (no Cloudflare credentials in this environment).** |
| Production database changes made in this whole session | **two**, both non-data: the `orders (tenant_id, updated_at)` index (v1.65.0) and the `pin_hash` column grant (v1.70.0) — confirmed against the migration list. Every other probe was read-only or rolled back. |

### Phase 19 checklist (the 17 items in the brief)

| # | Item | Status | Basis |
|---|---|---|---|
| 1 | Existing restaurant login | **PARTIAL** | Login functions exercised with *wrong* credentials: normal `bad_password`, no permission errors, after the v1.70.0 change. Case-sensitivity covered by unit tests. **A real sign-in was not performed (no credentials).** |
| 2 | Restaurant data preservation | **PASSED** (scope: this session) | No data-changing statement was run; duplicates 0; 71 tables, 0 without RLS |
| 3 | Invoice generation | **NOT VERIFIED** live | unchanged code; unit tests only |
| 4 | Sequential invoice numbering | **PASSES at the database, FAILS the business requirement** | `next_order_number`: 1025, 1026, 1027 on three calls (rolled back), above the highest bill (1024); refuses another tenant and another branch; 0 duplicates. **But** 35.1% of First Chef's paid receipts are out of order by payment time and 181 bills (4.8%) were renumbered by the server. Known; the fix is designed and **not applied**. |
| 5 | Customer ordering | **NOT VERIFIED** live | existing unit tests pass; no end-to-end order placed |
| 6 | Order synchronization | **PARTIAL** | v1.65.0 delta read: 16 tests, delta and full reads give identical bills and totals over a 41-step script; multi-till on a real network not tested |
| 7 | Branch-level data isolation | **MIXED** | **PASSED**: `orders` 36 own / 0 other, `order_items` 97 / 0, `order_counters` 1 / 0, as a branch cashier. **FAILED**: staff audit logs, staff GPS locations, branch-tagged documents visible across branches; HR/payroll and settings readable and writable by every role. **UNPROVEN**: every branch table that holds no rows. See `2026-10-30-security-findings.md`. |
| 8 | Owner consolidated reporting | **PARTIAL** | `/owner` page unit-tested; not exercised against live multi-branch data |
| 9 | Super Admin client management | **NOT REPRODUCED / UNCLEAR** | no `clients` table and no "No Restaurant" label exist; needs the screen |
| 10 | Message read / unread | **NOT REPRODUCED live; client hardened (v1.70.1)** | server functions correct; production holds 0 restaurant messages; the client no longer ignores a failed `support_mark_read` (10 tests) |
| 11 | Password reset | **PARTIAL** | unit tests; a live reset was deliberately not run (it would change a real password) |
| 12 | Electron startup | **NOT VERIFIED** | shell unit tests pass; the boot smoke test needs a display |
| 13 | Electron production build | **PASSED** to packaging | compile + renderer sync from a fresh extract; packaging reached `release/win-unpacked/DT POS.exe` |
| 14 | Windows installer generation | **NOT VERIFIED** | Linux stops at the icon/version step (needs wine); build on Windows or via the CI workflow |
| 15 | API integration | **NOT VERIFIED / NEEDS CREDENTIALS** | PRA mapping and validation unit-tested; sandbox needs the restaurant's PRA registration and credentials. External-website API does not exist yet. |
| 16 | Receipt printing | **NOT VERIFIED** | no printer; slip layouts are unit-tested only |
| 17 | Existing production workflow compatibility | **PARTIAL** | every payment payload and every weight cart line is proven unchanged by tests; **no cashier has used the new screens** |

### What was added this session, with its proof

| Release | New tests | Proof beyond the tests |
|---|---|---|
| v1.65.0 egress | 26 | fail when the delta is switched off |
| v1.66.0 branch scoping, Soft Light | 11 | — |
| v1.67.0 Payment + kilogram | 42 | mutation checks; Chromium screenshots in two themes |
| v1.68.0 themes | 77 (contrast of all 21, shared CSS scoped, applying/clearing attributes) | mutation check; Chromium screenshots in six themes |
| v1.69.0 currency, icon | 5 | icon checked at 16–128 px |
| v1.70.0 PIN hashes | 8 (mutation-checked) | live probe after applying: hash refused, app reads and orders unchanged, login path unchanged |
| v1.74.0 splash | 19 (content, 1.8 s timing and fade, skip keys, no leaked timers, theme-only colours, darkening-only overlay, reduced-motion, boot screen has no app imports, first-paint colour script is injection-proof) + 1 shell test | mutation-checked; Chromium frames at 0.25 / 0.7 / 1.5 s in 6 themes, reduced-motion and phone width |
| v1.73.0 brand system | 21 (one source, contrast of every app colour, role badges, Android sizes, vector-only artwork, no phone/e-mail typed in a branded component, self-contained guide) | mutation-checked; guide and icons checked visually; the 54 replaced Android PNGs keep their dimensions; **Android build NOT verified** |
| v1.72.0 brand + invoice | 27 (invoice arithmetic in every state, sections absent when empty, no bank details in code, footer in flow, logo placement, owner sign-in on the shared frame) | mutation-checked; Chromium screenshots of the invoice in 4 states and the sign-in in 5 themes |
| v1.71.0 sign-in look | 43 (frame renders; no hard-coded colour; darkening-only overlay; primary/primary-foreground contrast for all 32 themes; sign-in logic anchors) | mutation-checked; Chromium screenshots in 5 themes + phone width (markup copy of the card) |
| v1.70.1 message read | 10 (7 fail against the old code) | production holds 0 restaurant messages, so the failure was not reproduced live — it is a hardening, not a proven live bug |

## Pending / needs you

- **Credentials needed:** PRA sandbox; a restaurant login for a real sign-in test.
- **Real restaurant / real hardware needed:** thermal printers (58 / 80 mm), a cashier using the new Payment and kilogram screens, a Rider / Order Taker device, two tills at once.
- **A Windows machine needed:** the installer `.exe`, and starting the installed app.
- **Deploy needed:** `npm run deploy` — none of v1.56.3 → v1.70.1 is live yet, so nothing above has been seen by a customer.
