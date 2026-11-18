# Offline and speed audit — v1.119.0 (18 Nov 2026)

**How it was measured.** `node scripts/audit-load.mjs` (new; run `npm run build` and `npm run smoke:worker` once first). It starts the *built*
app in workerd, opens it in headless Chromium at phone width, and lists every script and style fetched on the first load. The numbers below
are from the build machine, not from a phone, and the cloud (Supabase) is not reachable from there — so they show the **shape** of the
load, not what a cashier's phone feels. Re-run it on any machine you like; it prints the same table.

## What the first load costs (sign-in route, v1.118.0 build)

| | |
|---|---|
| Script + style files fetched | **230** |
| Their size, not compressed | **2.4 MB** (the host sends them compressed — roughly a third of that on the wire) |
| Biggest | the stylesheet 373 KB · entry 333 KB · App shell 233 KB · supabase/auth libs 203 KB · receipt preview 138 KB · store 132 KB · till screen 109 KB |
| Whole build | 457 script files, 7.0 MB — the rest are screens fetched on demand |
| Time to the sign-in form (build machine, cloud unreachable) | ~4.6 s, of which **1.8 s is the splash** (shown once per session) |
| Same with the CPU slowed 4× | ~4.8 s — the wait is the splash and the network, not the processor |

Reading it: the heavy report libraries (spreadsheet 414 KB, PDF 390 KB, charts 355 KB, image maker 200 KB) are **not** in the first load —
they are fetched only when used. That part is right. What is in the first load that a sign-in page does not need is the **till screen and
its receipt stack** (about 340 KB), because the app shell imports the till directly.

## Offline, as it is

* **Works with no signal, once the app is open:** the till (its data is on the device), every screen already opened, and every write —
  each save goes to the device first and into a queue that is sent when the signal returns (`enqueueDeferredOp`; the screens added in
  v1.115–v1.118 — production, prep and batches, lots, cake orders, rights rules — go through the same path, as the document store does).
* **Does not work:** *reloading the page with no signal* — the page is gone (there is no service worker; the audit script confirms it),
  and *a screen nobody has opened yet* — each screen is its own file, fetched the first time (the till is the exception: it is in the first load).

## What was changed in v1.119.0

1. **Warming (`lib/prefetchScreens.ts`).** After sign-in, when the browser is idle, the 18 day-to-day screens (tables, running bills,
   kitchen, dashboard, day close, inventory, receiving, reports, bill reprint, refund, shift, pending payments, customers, wastage,
   production, stock count, expiry, cake orders) and the PDF / PDF-table / image makers are fetched one at a time, 250 ms apart, once per
   session. They then open at once, and a screen opened for the first time after the signal drops still opens; a report can still be made
   into a PDF or JPG with no signal. It does nothing offline, on a data saver, or on a slow (3G or worse) link, and never in the Owner
   app, the displays or the public website. Cost: about 1.5 MB of idle-time downloads per device per release (the build fingerprints its
   files, so a file is fetched once and kept).

## What was deliberately **not** changed — and why

* **No service worker** *(built in v1.125.0 — see `2026-11-18-offline-reload-v1.125.0.md`; opt-in, with kill switches)*. It is the right fix for "reload with no signal", and it is the riskiest change on this list: the project already
  had a release (v1.25.2) where a cached page asked for files a new deploy had removed, and the recovery code unregisters service workers
  on purpose. It must be built and tried on real phones and the Windows shell, not on a build machine. Design for when it is done:
  cache `/assets/*` forever by file name; load the page **network-first** with a 3-second timeout and the cached copy as the fallback;
  never cache `/api`, the cloud or POSTs; version the cache name with the release and delete older ones on activate; keep the existing
  "clear caches and reload" button as the kill switch; try it by pulling the cable on a till, a phone and the Windows app.
* **The till screen stays in the first load.** Making it a separate file would take ~340 KB off the sign-in page, but then the screen a
  cashier cannot do without would depend on a file fetch. With warming that risk is small; it is still the owner's call, and worth
  doing together with the service worker, not before it.
* **The 1.8-second splash is unchanged.** It is a brand moment and the app boots underneath it; shortening it is a design decision.

## To check on a real device (nothing below was possible here)

1. Open the web app on a phone over mobile data; time from tap to sign-in form. Repeat after a deploy (new files) and on the second visit.
2. Sign in, wait 30 s, switch on airplane mode, open Day Close, Expiry and Cake Orders: they should open. Make a PDF of a report: it should save.
3. In airplane mode take a cake order with an advance, then switch the signal on: the order and its Accounts entry should appear on a second device within a minute.
4. Reload the page in airplane mode: the page is gone — expected until the service worker is built.
