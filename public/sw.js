/* ============================================================================
 * DT POS — offline shell (v1.125.0).   Opt-in per device, with kill switches.
 *
 * What it does: lets a till, a tablet or the Windows app RELOAD the page with no signal. Nothing else.
 *   • The page (GET /) is loaded NETWORK-FIRST: the network answers if it does within 3 seconds, and the answer is kept; if it is
 *     slow, down, or a 5xx, the kept copy answers. So with a signal the page is always today's build and can never ask for files a
 *     new deploy removed (the v1.25.2 failure); the old copy is used only when the new one cannot be had.
 *   • /assets/* (fingerprinted by the build: a new build means new file names) are CACHE-FIRST and kept, except anything that is
 *     not a 200 from this site or that is HTML (a missing file answered with the page must never be stored as a script).
 *   • fonts, icons, the manifest: kept, answered from the copy while a fresh one is fetched.
 *
 * What it never touches: anything that is not a GET from this site, /api/*, server functions, the cloud (another origin), the
 * service worker file itself. Orders, payments, stock and sign-in are exactly as they were — they never pass through here.
 *
 * Kill switches (any one is enough):
 *   1. Settings → Devices → "This device" → Turn off (tells this worker to stop, unregisters it and deletes its copies).
 *   2. Open the site with ?nosw=1 in the address (same thing, for a device whose screens will not open).
 *   3. Set KILL = true below and deploy: every installed copy deletes its caches and unregisters itself on its next update check
 *      (this file is served no-store, see public/_headers).
 * The page registers this file as /sw.js?v=<release>: the release number names the cache of the page, so a new release starts clean
 * and its first activation deletes the old one. The registration is made by src/lib/offlineShell.ts, only after the owner opts in.
 * ========================================================================== */
'use strict';

var KILL = false;
var OFF = false;                        // set by the page's kill switch: from then on this worker passes everything straight through
var VERSION = (function () { try { return new URL(self.location.href).searchParams.get('v') || '0'; } catch (e) { return '0'; } })();
var SHELL = 'dt-shell-' + VERSION;      // the page and the small files, one cache per release
var ASSETS = 'dt-assets';               // fingerprinted build files — immutable, shared by releases, trimmed to the newest MAX_ASSETS
var MAX_ASSETS = 700;
var NAV_WAIT_MS = 3000;
var NEVER = ['/api/', '/_server', '/_serverFn', '/sw.js'];
var SMALL_FILES = /^\/(fonts\/|favicon|apple-touch-icon|pwa-icon|splash\.png|manifest\.webmanifest)/;

function noop() {}
function isHtml(res) { return /text\/html/i.test((res.headers && res.headers.get('content-type')) || ''); }

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('message', function (event) { if (event.data && event.data.type === 'dt-off') OFF = true; });

self.addEventListener('activate', function (event) {
  event.waitUntil((function () {
    return caches.keys().then(function (names) {
      var ours = names.filter(function (n) { return n.indexOf('dt-') === 0; });
      if (KILL) {
        return Promise.all(ours.map(function (n) { return caches.delete(n); })).then(function () { return self.registration.unregister(); });
      }
      var old = ours.filter(function (n) { return n.indexOf('dt-shell-') === 0 && n !== SHELL; });
      return Promise.all(old.map(function (n) { return caches.delete(n); })).then(function () { return self.clients.claim(); });
    });
  })());
});

// the stored copy of the page: one entry, whatever the query string was
function storedPage() { return caches.open(SHELL).then(function (c) { return c.match('/'); }); }
function keepPage(res) {
  if (!res || res.status !== 200 || !isHtml(res)) return Promise.resolve();
  return caches.open(SHELL).then(function (c) { return c.put('/', res); }).catch(noop);
}

function pageRequest(request, event) {
  var copy;
  var net = fetch(request).then(function (res) { copy = res.clone(); return res; });
  event.waitUntil(net.then(function () { return keepPage(copy); }).catch(noop));
  var timer;
  var slow = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('slow')); }, NAV_WAIT_MS); });
  return Promise.race([net, slow]).then(function (res) {
    clearTimeout(timer);
    if (res.status >= 500) return storedPage().then(function (kept) { return kept || res; });
    return res;
  }, function () {
    clearTimeout(timer);
    // down or slow: the kept page; if there is none yet, wait for the real network like any browser would
    return storedPage().then(function (kept) { return kept || net; });
  });
}

function trim(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= MAX_ASSETS) return;
    return Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map(function (k) { return cache.delete(k); }));
  });
}
function keepable(res) { return res && res.status === 200 && res.type === 'basic' && !isHtml(res); }

function assetRequest(request, event) {
  return caches.open(ASSETS).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (keepable(res)) {
          var copy = res.clone();
          event.waitUntil(cache.put(request, copy).then(function () { return trim(cache); }).catch(noop));
        }
        return res;
      });
    });
  });
}

function smallFileRequest(request, event) {
  return caches.open(SHELL).then(function (cache) {
    return cache.match(request).then(function (hit) {
      var copy;
      var net = fetch(request).then(function (res) { if (keepable(res)) copy = res.clone(); return res; });
      event.waitUntil(net.then(function () { return copy ? cache.put(request, copy) : undefined; }).catch(noop));
      return hit || net;
    });
  });
}

self.addEventListener('fetch', function (event) {
  if (KILL || OFF) return;
  var request = event.request;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  var path = url.pathname;
  for (var i = 0; i < NEVER.length; i++) if (path.indexOf(NEVER[i]) === 0) return;

  if (request.mode === 'navigate') {
    if (path === '/') event.respondWith(pageRequest(request, event));
    return;
  }
  if (path.indexOf('/assets/') === 0) { event.respondWith(assetRequest(request, event)); return; }
  if (SMALL_FILES.test(path)) { event.respondWith(smallFileRequest(request, event)); }
});
