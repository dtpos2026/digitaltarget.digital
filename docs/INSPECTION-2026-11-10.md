# Inspection of the deployed v1.113.0 — 10 Nov 2026

How it was inspected: the Supabase logs of the last 24 hours (edge and Postgres), the security advisors, the live database (counters, indexes, grants, function bodies), and the **real app code run in a browser** (the three phone apps and the ordering website, 43 checks). The live site itself cannot be opened from the build machine (the network blocks it), so what the owner sees on the phones is not covered here.

## A. Found and fixed in v1.114.0
| # | Found | Cause | Fix | Check |
|---|---|---|---|---|
| 1 | `get_workspace_code` refused (401) 15× in one hour | The function is granted to signed-in users only; a rider / order taker / PIN login has no Supabase user | Ask only when someone is signed in; never again after a refusal | test; log count after deploy |
| 2 | "duplicate key … order_number": 46 refused bill inserts in 24 h, each renumbered after its receipt printed | A till drew the bill number from the counter of the branch its account is tied to, but stamped the bill with the branch it is working in | Number from the branch the bill is stamped with (also for the fresh number after a clash) | tests; **confirm the 409 count drops** |
| 3 | Urdu line with English words torn apart right-to-left ("Users) … (& Access") | Bidirectional text: brackets of an embedded English run flip | English runs of 2+ words isolated | tests; screenshot |

## B. Seen, not changed
| Seen | Why not | What to do |
|---|---|---|
| Order-list refresh hit a statement timeout 3× (08:46, 08:53, 12:22) | It coincides with a Postgres checkpoint that took 258 s to write: an I/O stall on the database server, not a missing index (the needed indexes exist) | If it repeats: raise the Supabase compute size; otherwise ignore |
| `POST /customers` refused (403) about once an hour | A customer record from another restaurant is set aside by design (v1.110.0); one attempt per start | Watch; should not grow |
| 5 failed sign-ins (`/auth/v1/token` 400) | Wrong passwords | None |
| Security advisors: public / signed-in users can run SECURITY DEFINER functions; RLS enabled with no policy on one table | The public ordering site and the staff apps work through guarded SECURITY DEFINER functions by design; the table is read by functions only | None |
| Leaked-password protection disabled | A switch in the Supabase dashboard (Authentication), not code | Owner: switch it on |
| Tenant `64434fd6…`: bills carry a branch id that has no row in `branches` | Data oddity; not touched | Owner: check the restaurant's branch list |

## C. Not built yet (needs a decision, the database, or a design)
| Item | Needs |
|---|---|
| Roman Urdu for the apps | a second dictionary (~550 phrases) — after the Urdu is proofread |
| Urdu proofreading by a native speaker | someone who reads Urdu: `docs/qa/urdu-proofread-sheet.html` |
| Rider's end-of-day cash hand-over | the server must record what the rider took (change to the live delivery function) |
| 38 desktop screens in the design's layouts; website pages WEB-02 and later | separate phases |
| Real-phone test of every app, release-signed APKs, Windows shell rebuild | a phone, the four `ANDROID_*` secrets, the Windows machine |
| Promo code rule is checked on the page, not by the server | a server check inside the order function (live path) |
