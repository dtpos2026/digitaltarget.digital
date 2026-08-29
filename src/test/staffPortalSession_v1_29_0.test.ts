// ============================================================================
// v1.29.0 — the staff portals could see the menu and nothing else
//
// REPORTED: signed into the Order Taker app with the workspace code, the menu
// appeared, but there were no tables — and the restaurant has twelve. No riders
// to hand a delivery to. In the Rider app, no orders at all. All three apps
// then reported "saved locally, cloud sync issue".
//
// ONE CAUSE, AND RLS WAS RIGHT. portalSignIn() verifies the staff member
// server-side and binds the device to the resolved restaurant, but creates no
// Supabase session — POS staff are user_profiles rows and have no auth.users
// account to sign into. So every read went as `anon`, and the live policies
// answered exactly as written:
//
//     menu_items, categories   public read       -> the menu appeared
//     dining_tables            authenticated     -> no tables
//     user_profiles            authenticated     -> no riders
//     orders                   anon INSERT only  -> no orders
//
// Verified against the live database with `set local role anon`: with a portal
// token, 12 tables, 1 rider and 10 live orders; a rider's token returns 8,
// because two belong to somebody else. A bad token returns no_session, and anon
// still cannot read `tenants` at all.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const session = readFileSync(join(process.cwd(),
  'supabase/migrations/20260829120000_v1_29_0_staff_portal_session.sql'), 'utf8');
const dataFns = readFileSync(join(process.cwd(),
  'supabase/migrations/20260829130000_v1_29_0_staff_portal_data.sql'), 'utf8');
const fallback = readFileSync(join(process.cwd(),
  'supabase/migrations/20260829140000_v1_29_1_portal_orders_document_fallback.sql'), 'utf8');
const portalData = readFileSync(join(process.cwd(), 'src/lib/portalData.ts'), 'utf8');
const portalAuth = readFileSync(join(process.cwd(), 'src/lib/staffPortalAuth.ts'), 'utf8');
const staffFns = readFileSync(join(process.cwd(), 'src/lib/staffAuth.functions.ts'), 'utf8');
const rider = readFileSync(join(process.cwd(), 'src/pages/RiderAppPage.tsx'), 'utf8');
const orderTaker = readFileSync(join(process.cwd(), 'src/pages/OrderTakerPortalPage.tsx'), 'utf8');
const store = readFileSync(join(process.cwd(), 'src/lib/store.ts'), 'utf8');

describe('the token itself', () => {
  it('is stored only as a hash, so a database copy cannot be replayed', () => {
    expect(session).toContain('token_hash    text primary key');
    expect(session).toContain("encode(extensions.digest(v_token, 'sha256'), 'hex')");
    // The token column itself must not exist.
    expect(session).not.toMatch(/^\s*token\s+text/m);
  });

  it('is minted from a CSPRNG, not from anything guessable', () => {
    expect(session).toContain('extensions.gen_random_bytes(32)');
  });

  it('cannot be read from the table by anyone but the functions', () => {
    expect(session).toContain('alter table public.staff_portal_sessions enable row level security');
    expect(session).toContain('revoke all on public.staff_portal_sessions from anon, authenticated');
    // No policy is granted, so RLS denies every direct read.
    expect(session).not.toMatch(/create policy[\s\S]*staff_portal_sessions/i);
  });

  it('can only be created by the server, never by a browser', () => {
    expect(session).toContain(
      'revoke all on function public.portal_session_create(uuid, uuid, uuid, text, boolean) from public, anon, authenticated');
    expect(session).toContain(
      'grant execute on function public.portal_session_create(uuid, uuid, uuid, text, boolean) to service_role');
  });

  it('expires, so a lost phone stops being a way in', () => {
    expect(session).toContain("now() + interval '30 days'");
    expect(session).toContain('and s.expires_at > now()');
  });
});

describe('what the reading functions may return', () => {
  it('take the restaurant from the token, never from the request', () => {
    // This is the whole isolation guarantee: there is no tenant argument to
    // tamper with. Every one of them resolves the caller first.
    for (const fn of ['portal_tables', 'portal_riders', 'portal_orders', 'portal_bootstrap']) {
      const body = dataFns.slice(dataFns.indexOf(`function public.${fn}(`));
      expect(body.slice(0, 900), fn).toContain('portal_identity(p_token)');
    }
    // The three that query directly filter on the token's own tenant.
    // portal_bootstrap queries nothing itself; it delegates to these.
    for (const fn of ['portal_tables', 'portal_riders', 'portal_orders']) {
      const body = dataFns.slice(dataFns.indexOf(`function public.${fn}(`));
      expect(body.slice(0, 1400), fn).toContain('tenant_id = s.tenant_id');
    }
    expect(dataFns).not.toMatch(/portal_(tables|riders|orders)\(p_token text, p_tenant/);
  });

  it('refuse an unknown or expired token instead of returning rows', () => {
    const guards = dataFns.match(/if s\.user_id is null then/g) ?? [];
    expect(guards.length).toBe(4);
    expect(dataFns).toContain("'reason', 'no_session'");
  });

  it('scope to the staff member\'s own branch unless they span branches', () => {
    expect(dataFns).toContain('s.all_branches or s.branch_id is null or d.branch_id = s.branch_id');
    expect(dataFns).toContain('s.all_branches or s.branch_id is null or o.branch_id = s.branch_id');
  });

  it('give a rider their own deliveries plus what nobody has taken', () => {
    expect(dataFns).toContain("o.data->>'riderId' = s.user_id::text");
    expect(dataFns).toContain("coalesce(o.data->>'riderId', '') = ''");
  });

  it('never hand out a password or PIN hash with the rider list', () => {
    const riders = dataFns.slice(dataFns.indexOf('function public.portal_riders'),
                                 dataFns.indexOf('function public.portal_orders'));
    expect(riders).not.toContain('pin_hash');
    expect(riders).not.toContain('password');
  });

  it('leave settled and deleted bills out of a live order list', () => {
    expect(dataFns).toContain("not in ('paid', 'cancelled', 'closed')");
    expect(dataFns).toContain('o.deleted_at is null');
    expect(dataFns).toContain('o.archived_at is null');
  });
});

describe('the client half', () => {
  it('mints a token only for the two portal roles', () => {
    expect(staffFns).toContain("rawRole === 'rider' || rawRole === 'order_taker'");
    expect(staffFns).toContain("supabaseAdmin.rpc('portal_session_create'");
  });

  it('does not fail a sign-in when the token could not be minted', () => {
    // The app still works offline from its cached roster, and "wrong password"
    // would be a lie.
    expect(staffFns).toContain('portal session could not be created');
  });

  it('stores the token on sign-in and ends it server-side on sign-out', () => {
    expect(portalAuth).toContain('setPortalToken(res.portalToken ?? null)');
    expect(portalAuth).toContain('export async function portalSignOut');
    expect(portalData).toContain("sb().rpc('portal_logout'");
  });

  it('tells "signed out" apart from "the network is down"', () => {
    // They need opposite responses, and the old code could not distinguish
    // them at all — every failure looked like "cloud sync issue".
    expect(portalData).toContain("reason: 'no_session'");
    expect(portalData).toContain("reason: 'offline'");
  });

  it('drops a token the server has stopped honouring', () => {
    expect(portalData).toContain('setPortalToken(null)');
  });
});

describe('the apps actually use it', () => {
  it('the rider polls through the portal rather than the blocked path', () => {
    const pull = rider.slice(rider.indexOf('const pull = async'), rider.indexOf('const t = setInterval'));
    expect(pull).toContain('portalOrders()');
    expect(pull).toContain('hasPortalSession()');
    // The old call stays as the fallback for a session-backed staff route.
    expect(pull).toContain('refreshOrdersFromCloud()');
  });

  it('the order taker fetches tables, riders and orders on the way in', () => {
    expect(orderTaker).toContain('portalBootstrap()');
    expect(orderTaker).toContain('adoptPortalRows');
  });

  it('adopting rows never queues them straight back for upload', () => {
    // They came FROM the server. Pushing them back would hand the till a
    // backlog it did not create, on every single login.
    const adopt = store.slice(store.indexOf('export async function adoptPortalRows'),
                              store.indexOf('export function getTables()'));
    expect(adopt).not.toContain('saveEntity');
    expect(adopt).not.toContain('enqueueDeferredOp');
    expect(adopt).toContain('saveLocal(data)');
  });

  it('leaves a collection it was not given alone', () => {
    // "Not asked for" and "empty" are different, and confusing them is what
    // emptied tills in v1.26.2.
    const adopt = store.slice(store.indexOf('export async function adoptPortalRows'),
                              store.indexOf('export function getTables()'));
    expect(adopt).toContain('if (!Array.isArray(rows)) return;');
  });
});

describe('an order the POS has not synced back yet', () => {
  it('is built from the columns rather than shown blank', () => {
    // public_place_order writes the typed columns and order_items, never a
    // document — and orders.data DEFAULTS to '{}', so a coalesce() would never
    // fire on it. Two orders in production sit in exactly that state.
    expect(fallback).toContain("case when o.data ? 'id' then o.data");
    expect(fallback).toContain("'orderNumber',   o.order_number");
    expect(fallback).toContain('from public.order_items i');
  });

  it('tells a real document from an empty one by its own id', () => {
    // rowToDb always writes data.id, so its presence is what distinguishes a
    // POS document from the default '{}'.
    expect(fallback).toContain("o.data ? 'id'");
    expect(fallback).not.toContain('o.data is null');
  });

  it('finds a rider\'s work through the column as well as the document', () => {
    // An order assigned but not yet synced has rider_id and no document.
    expect(fallback).toContain('o.rider_id = s.user_id');
  });

  it('builds the document for the read only, never storing it', () => {
    // The POS must stay the only writer of orders.data, or the two race.
    const body = fallback.slice(fallback.indexOf('create or replace function'));
    expect(body).not.toMatch(/update\s+public\.orders/i);
    expect(body).not.toMatch(/insert\s+into\s+public\.orders/i);
  });
});
