# Multi-device sync test

    npm run test:sync

Two real browser contexts — separate localStorage, separate IndexedDB, separate
websockets — signed into the same restaurant against one shared backend. Device
A acts; Device B must see it *without* a refresh. Then A goes offline, keeps
taking orders, reconnects, and B must receive the backlog exactly once.

It drives the POS's own `src/lib/store.ts` API, the same functions the UI calls.
Nothing about the sync path is stubbed.

## What it covers (13 checks)

| Area | Check |
| --- | --- |
| Realtime | create, edit, delete a menu item; take a bill; change branding |
| Tombstones | a deleted item does not resurrect on the other device |
| Offline | work is queued, not attempted, and B does not see it yet |
| Reconnect | the queue drains; B receives the offline item and the offline bill |
| Idempotence | no duplicate orders; a synced bill is not re-inserted |
| Direction | B creates, A receives |

## Why there is a stand-in backend

`mock-supabase.mjs` implements just enough PostgREST and Realtime for the real
client to run unmodified. The live project is unreachable from CI (the egress
proxy refuses CONNECT to `*.supabase.co`), and pointing the test at production
would write test rows into a real restaurant.

It proves the **client** half: subscription wiring, the merge, tombstones, the
deferred queue, offline→online flush. The **server** half — RLS, tenancy, branch
isolation, RPCs — is not modelled here and was verified directly against the
real database instead.

Two details of the real protocol that the stand-in must reproduce, because
getting either wrong silently looks like "sync is broken in the app":

- supabase-js connects with `vsn=2.0.0`, so Phoenix frames are **arrays**
  (`[join_ref, ref, topic, event, payload]`), not objects. Replying with v1
  objects leaves every channel stuck in `joining` forever.
- Incoming changes are routed by the **binding id** handed out in the join
  reply, per socket — not by the table name in the payload.

## Both servers are started by the test, on purpose

The harness spawns the mock **and** the Vite dev server itself, and waits for
both devices' realtime channels to join before acting.

- A long-lived mock keeps the previous run's rows, so a run inherits yesterday's
  tombstones and reports failures that have nothing to do with the code.
- Vite's HMR serves an edited module under a cache-busting URL
  (`/src/lib/store.ts?t=...`). The app then holds *that* instance while a test
  importing the plain path gets a **second copy of the module, with its own
  in-memory store cache** — every assertion then reads a different object than
  the one sync just wrote.

Both failure modes look exactly like a sync bug and are not one.
