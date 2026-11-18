# Offline reload — the service worker (v1.125.0)

What was missing (from the v1.119.0 audit): with the signal gone, a till could keep selling, but **reloading the page** (or reopening the app)
showed nothing, because the page itself was not on the device. This release adds it — **opt-in per device, with three kill switches**.

## What it does
* **The page (`GET /`) is network-first.** The network answers if it does within 3 seconds, and the answer is kept. If the network is
  down, slow, or answers 5xx, the kept copy answers. With a signal the page is therefore always today's build and can never ask for files
  that a new deploy removed (the v1.25.2 failure); the old copy is used only when the new one cannot be had.
* **`/assets/*` (fingerprinted files) are cache-first** and kept (newest 700). Never kept: a non-200, a cross-origin or opaque answer, and
  **anything that is HTML** (a missing script answered with the page must not be stored as a script).
* **Fonts, icons, the manifest** are answered from the copy while a fresh one is fetched.
* **Never touched:** anything that is not a GET from this site, `/api/*`, server functions, the cloud (another origin), `sw.js` itself.
  Orders, payments, stock and sign-in never pass through the worker.
* The cache of the page is named after the release (`dt-shell-<release>`); a new release's worker deletes the older ones when it takes over.

## How an owner turns it on / off
Settings → **Devices** → *Reload with no signal — this device* → **Turn on**. It registers the worker, then saves the page and every
build file already loaded, so it works at once (not after another reload). The choice is kept on **that device only**. Nothing is registered
on a device that never opted in. A device that opted in registers again at sign-in/boot, which is how a new release's worker arrives.

## Kill switches (any one is enough)
1. **Turn off** (or *Clear the saved copy and reload*) in the same card: tells the worker to stop, unregisters it, deletes every `dt-` copy.
2. **`?nosw=1`** added to the address: the app does the same at start-up and drops the parameter — for a device whose screens will not open.
3. **`KILL = true` in `public/sw.js`, deploy:** every installed worker deletes its copies and unregisters itself on its next update check
   (`/sw.js` is served `no-store`, see `public/_headers`).

## What was tested (and how)
* **`npm run test:offline`** (after `npm run build` and one `npm run smoke:worker`): the BUILT app in workerd, headless Chromium with service
  workers allowed. 12 checks — the page opens online; after one online reload it is controlled by the worker, the page is kept and 231 build
  files are kept under `/assets/`; **with the network switched off a reload opens the page, and so does the page with a query string**;
  `/api` is never answered from the copy (POST and GET fail while offline); a missing `/assets` file (404, HTML) is not stored; `?nosw=1`
  unregisters the worker, deletes every `dt-` copy and drops the parameter; and **after that, no signal means no page again** (the old behaviour).
  A first run found a real fault (the worker kept writing to the caches while the kill switch deleted them); the switch now tells the worker
  to stop first and clears twice.
* **Unit tests** run `public/sw.js` in a sandbox with a fake cache and a fake network (16 tests): network wins inside 3 s, the kept page wins
  after 3 s and the late answer is kept for next time, 5xx, offline with and without a kept page, one key for the page whatever the query
  string, only GET `/` as a page load, the never-touch list, build files kept once and trimmed to 700, no HTML/404/opaque kept, versioned
  caches and clean-up on activate, `KILL`, and the page's `dt-off` message. And 18 tests for the page side (register address, flag, saved page
  and files, status, kill switch, `?nosw=1`, boot, the card, wiring: no `register` call anywhere except behind the choice).

## NOT tested here — to check on real devices (nothing below was possible on a build machine)
1. **Windows app (Electron shell):** turn it on, sign in, pull the network cable, press Ctrl+R / reopen the app. The shell loads the hosted
   page; whether its window honours service workers depends on how `dtpos-desktop` loads the URL — not touched in this release.
2. **A real phone / tablet browser (Chrome, Safari):** turn it on over mobile data, wait 30 s, switch on airplane mode, reload. iOS Safari
   evicts stored data of sites that are not used for some weeks; the page is then fetched again when there is a signal.
3. **The three Android apps** are not affected (the card is in the desktop/web Settings; nothing is registered in them).
4. **After a deploy:** with the signal, the first load is the new build; with no signal, the kept page of the *last visit* opens — and a
   screen never opened before the signal dropped may not (the idle warming of v1.119.0 fetches the 18 day-to-day screens after sign-in).
5. **Storage:** about 231 build files are kept (the same files the browser downloads anyway); a device with very little free space may refuse
   and the worker then simply keeps less.
