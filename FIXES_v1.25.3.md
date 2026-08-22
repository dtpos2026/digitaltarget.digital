# DT POS v1.25.3 — what was wrong and what changed

## 1. The root cause: there was no `.env`

`.env` was missing; `.env.example` had an empty `VITE_SUPABASE_PUBLISHABLE_KEY`.

Vite substitutes `VITE_*` at **build time**. Without the file, the bundle carried no
Supabase configuration, so all of these returned `false`:

| Function | File |
|---|---|
| `isCloudConfigured()` | `src/lib/cloudMode.ts` |
| `supabaseAvailable()` | `src/lib/authProvider.ts` |
| `isSupabaseConfigured()` | `src/lib/supabase.ts` |

Two separately-reported bugs were both this:

* **"email login nahi aa raha"** — `App.tsx` gates the owner/email screen on
  `cloudMode`. False meant it never rendered; the app went straight to the staff
  PIN screen.
* **"Invalid login credentials"** — the Super Admin exists only in Supabase.
  With Supabase judged unavailable, sign-in went to the removed Firebase path,
  which rejects every password.

Clearing the browser cache could never fix this. The fault was in the build.

`src/test/buildConfig.test.ts` already existed and already tested for this. It was
failing. **Run the test suite before shipping a zip.**

## 2. Backend is now Supabase, with no second path

* `usingSupabaseAuth()` returns `true` unconditionally. It used to consult a
  per-device `localStorage` flag — a stale `'firebase'` value pinned that till to a
  dead backend permanently.
* `resolveAndSignIn()` no longer retries against Firebase. That retry hit the SDK
  stub and surfaced `[firebase-removed] signInWithEmailAndPassword` instead of the
  real Supabase error, so a wrong password reported the wrong problem.
* ~300 lines of legacy Firebase login flow deleted from `OwnerLoginPage.tsx`,
  including two hand-rolled `fetch`es straight to `firestore.googleapis.com` that
  bypassed the SDK stub. Those were the last Firebase network endpoints in the
  shipped bundle.
* `lovable-error-reporting.ts` no longer forwards error payloads (message, stack,
  context) to the editor's telemetry hooks. It logs to console only.

**Note:** there was never a separate "Lovable Cloud storage layer" to remove.
Lovable Cloud *is* Supabase underneath — the data was always in this project.
In `src/` the phrase appeared in exactly three error-message strings.

The Lovable *build* plugin (`@lovable.dev/vite-tanstack-config`) is untouched. It is
a Vite config preset, not a backend, and replacing it means rewriting the whole
build pipeline.

## 3. `dist/` was never produced — by design

This is TanStack Start + Nitro, not a plain Vite SPA. `vite build` writes to
`.output/`. The committed `.wrangler/deploy/config.json` pointed at
`dist/server/wrangler.json` (stale, from an older Nitro), which is where the
expectation came from; a current build rewrites it to `.output/`.

`npm run build` now also mirrors `.output/` → `dist/` via `scripts/mirror-dist.mjs`.
`.output/` remains authoritative.

## 4. Also fixed along the way

* `package.json` had **no `version` field** and was still named `tanstack_start_ts`
  (the template default). Five tests failed on it. Now `dt-pos` / `1.25.2`.
* `src/integrations/supabase/client.ts` accepted only `VITE_SUPABASE_PUBLISHABLE_KEY`,
  while every other module also accepted `VITE_SUPABASE_ANON_KEY`. A project
  configured the older way passed every availability check, then threw here.
* `.gitignore` now lists `.env.local` / `.env.*.local` explicitly, with a comment
  warning against ever adding a bare `.env` rule.

## Verified

* `npx tsc --noEmit` — clean
* `npx vitest run` — 778 passed, 1 skipped, 0 failed
* `npm run build` — succeeds; `.output/` and `dist/` both produced
* No `firestore.googleapis` / `firebaseapp.com` / `identitytoolkit` in the build
* No `__lovableEvents` / `__lovableReportRuntimeError` in the build
* Only the publishable key is embedded; no `service_role` key (the `sb_secret_`
  strings present are the `assertNotSecretKey()` guard, not a key)

## Before you deploy

Set these in your host's environment settings **as well** (Lovable / Cloudflare /
wherever). If the host builds without them, this exact bug returns:

```
VITE_SUPABASE_URL=https://drpzxzpvkpqfxcjbwypo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_wAdvU6MKlCyBCAMogNUdCQ_34DK6CVS
```

**Change the `admin@dtpos.app` password immediately** — it was set to a value that
has been written down in plain text.


---

# v1.25.4 — "owner account could not be made"

## Symptom

```
⚠️ TAIMOOR created, but the owner account could not be made:
   Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
```

The restaurant **was** created. Only its owner login was not.

## Cause — a different layer from the v1.25.3 bug

v1.25.3 fixed the **client**. This is the **server**.

Adding a restaurant owner runs `provisionRestaurantOwner` in
`src/lib/platform.functions.ts` — a server function on the Nitro server, not in
the browser. It needs Supabase configuration from `process.env`, and
`auth-middleware.ts` read *only* the un-prefixed names:

```ts
process.env['SUPABASE_URL']
process.env['SUPABASE_PUBLISHABLE_KEY']
```

Vite never copies `.env` into `process.env`. It inlines `VITE_*` into
`import.meta.env` at build time. So the browser had configuration and the server
had none — which is exactly why login worked but provisioning failed.

## Fixed

* `auth-middleware.ts` now falls back to the `VITE_` names via `import.meta.env`.
  The publishable key is client-safe and already in the browser bundle, so this
  costs nothing.
* `client.server.ts` accepts either name for the URL, but **only** `process.env`
  for the service-role key — reading that from `import.meta.env` would inline it
  into the browser bundle and expose every tenant.
* `.env` now also carries the un-prefixed `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`.

## You must still supply one key yourself

Creating an owner login calls `supabaseAdmin.auth.admin.createUser()`, which
requires the **service_role** key. I do not have it and it must never be
committed.

Supabase Dashboard → Project Settings → API Keys → `service_role` → Reveal

Local dev — create `.env.local` (gitignored, see `.env.local.example`):

```
SUPABASE_SERVICE_ROLE_KEY=<paste it here>
```

Production — set it as an **encrypted secret** on your host, not a plain variable.

Never give it a `VITE_` prefix.

## Verified

* `npx tsc --noEmit` — clean
* `npx vitest run` — 778 passed, 1 skipped, 0 failed
* `npm run build` — succeeds
* Only an `anon`-role key is present in the client bundle; no `service_role`
