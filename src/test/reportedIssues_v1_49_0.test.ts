// ============================================================================
// v1.49.0 — the issues in the audit PDF, each traced to its root cause.
//
// Every one of these was found by reading the LIVE database or the shipped
// code, not by reading the screenshots twice.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { versionCodeFor } from '@/lib/appVersionCode';

const ROOT = process.cwd();
const raw = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const code = (f: string) =>
  raw(f).replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
const sql = (f: string) => raw(`supabase/migrations/${f}`).replace(/^\s*--.*$/gm, '');

describe('1. the bill that opened at zero', () => {
  const M = sql('20260905120000_v1_49_0_order_money_mirror.sql');

  it('derives the money columns from the document, so no writer can forget', () => {
    // portal_upsert_order wrote id/tenant/branch/number/status/data and
    // nothing else, so subtotal and grand_total stayed at 0 while the
    // document said 410.
    expect(M).toContain('create trigger trg_sync_order_money_mirror');
    expect(M).toContain('before insert or update of data on public.orders');
    for (const col of ['order_type', 'subtotal', 'grand_total', 'amount_paid', 'payment_method']) {
      expect(M, col).toContain(col);
    }
  });

  it('leaves a column alone when the document says nothing about it', () => {
    // `d ? key` rather than a coalesce chain — otherwise a document with no
    // opinion would blank a column a writer set deliberately.
    expect(M).toContain("if d ? 'grandTotal'");
    expect(M).toContain("if d ? 'orderType'");
  });

  it('does not resurrect a deliberate zero', () => {
    // A cancelled order's document says 0 and its column says 0. That is
    // correct and must stay. The backfill only touches rows where the column
    // is empty and the document is NOT.
    expect(M).toContain("coalesce(grand_total, 0) = 0 and coalesce((data->>'grandTotal')::numeric, 0) > 0");
  });

  it('backfills narrowly, not by rewriting every order', () => {
    expect(M).toContain('where deleted_at is null');
    expect(M).not.toMatch(/update public\.orders set data = data;\s*$/m);
  });
});

describe('2. every shift the restaurant ever opened was rejected', () => {
  const store = code('src/lib/supabaseStore.ts');

  it('sends the REGISTERED device id, not the id this machine calls itself', () => {
    // shifts.device_id is a foreign key to devices.id. getDeviceId() returns
    // the hardware uuid from localStorage, which is a different value, so
    // every push came back violating shifts_device_id_fkey. Live proof:
    // 6 devices registered, 0 shifts stored.
    expect(store).toContain('function registeredDeviceFk');
    expect(store).toContain("if (column === 'device_id')");
    expect(store).toContain('device_id: registeredDeviceFk(data.deviceId)');
  });

  it('reads the id through the sync module rather than copying its key', () => {
    // The bug WAS two places disagreeing about what "the device id" means.
    expect(store).toContain("import { getSyncDeviceId } from './supabaseSync'");
    expect(store).not.toContain("localStorage.getItem('pos-sync-device-id')");
  });

  it('sends null when the device is not registered, rather than losing the shift', () => {
    // The constraint is ON DELETE SET NULL, so the column is optional by
    // design. A shift without a device pointer is still a complete cash
    // record; a rejected shift is nothing at all.
    const fn = store.slice(store.indexOf('function registeredDeviceFk'),
                           store.indexOf('function localDeviceIdSafe'));
    expect(fn).toContain('return raw ? null : syncId;');
  });

  it('never reattributes a record another till created', () => {
    // A record made on device A carries A's local id in its document. Stamping
    // OUR registered row onto it would silently move A's shift, or A's sale,
    // onto this till. Null says "not known", which the column is built for.
    const fn = store.slice(store.indexOf('function registeredDeviceFk'),
                           store.indexOf('function localDeviceIdSafe'));
    expect(fn).toContain('raw === localDeviceIdSafe()');
    expect(fn).toContain('return raw ? null : syncId;');
  });

  it('reads both ids through their own accessors, never a copied key', () => {
    // Two places disagreeing about what "the device id" means IS this bug.
    expect(store).toContain("import { getDeviceId } from './tenant'");
    expect(store).not.toContain("localStorage.getItem('pos-device-id')");
  });
});

describe('3. the manager password that was always "Not Valid"', () => {
  const M = sql('20260905130000_v1_49_1_portal_manager_auth.sql');
  const dialog = code('src/components/ManagerAuthDialog.tsx');

  it('gives the portal its own door', () => {
    // verify_manager_password is granted to `authenticated` only AND guards on
    // auth_tenant_id(). An Order Taker is anon with a null auth.uid(), so the
    // call was refused before the password was ever compared.
    expect(M).toContain('create or replace function public.portal_verify_manager');
    expect(M).toContain('grant execute on function public.portal_verify_manager(text, text) to anon');
  });

  it('takes the restaurant from the token, never from the caller', () => {
    expect(M).toContain('portal_identity(p_token)');
    expect(M).toContain('where tenant_id = s.tenant_id');
    expect(M).not.toMatch(/portal_verify_manager\(\s*p_tenant/);
  });

  it('locks the guessing DEVICE, never the manager\'s account', () => {
    // Locking the account would let any order taker lock their own manager out
    // of the till at will.
    expect(M).toContain('manager_auth_locked_until');
    expect(M).toContain('where token_hash = s.token_hash');
    expect(M).not.toContain('update public.user_profiles');
  });

  it('the dialog tries the portal first and shows what the server said', () => {
    expect(dialog).toContain('portalVerifyManager');
    expect(dialog).toContain('attemptsLeft');
    expect(dialog).toContain('retryAfterSeconds');
  });

  it('a wrong password is an answer, not a transport error', () => {
    // call() collapses every ok:false into "the server refused the request",
    // which would throw away how many tries are left.
    const portal = code('src/lib/portalData.ts');
    expect(portal).toContain('async function callRaw');
    expect(portal).toContain("callRaw('portal_verify_manager'");
    // an expired session must STILL clear itself
    const fn = portal.slice(portal.indexOf('async function callRaw'),
                            portal.indexOf('export function portalBootstrap'));
    expect(fn).toContain('setPortalToken(null)');
  });
});

describe('4. the versionCode that made every update fail to install', () => {
  it('rises with the version name', () => {
    expect(Number(versionCodeFor('1.1.0'))).toBeGreaterThan(1);
    expect(Number(versionCodeFor('1.1.0'))).toBeGreaterThan(Number(versionCodeFor('1.0.0')));
  });
});

describe('5. the items that were never given a price', () => {
  const pos = code('src/pages/POSScreen.tsx');
  const menu = code('src/pages/MenuManagerPage.tsx');

  it('the till shows "No price" instead of a confident Rs.0', () => {
    // Live menu: 129 items, 53 at price 0, and 41 of those with no size
    // variant and no rate per kg either — no price anywhere. "Rs.0" read as a
    // real price of nothing.
    expect(pos).toContain('No price');
    expect(pos).toContain('Number(item.price) > 0');
  });

  it('adding one asks for the price rather than ringing up zero', () => {
    const fn = pos.slice(pos.indexOf('const addToCart = useCallback'),
                         pos.indexOf('// Numpad mode for selected cart item'));
    expect(fn).toContain("item.pricingType === 'fixed' && !(Number(item.price) > 0)");
    expect(fn).toContain("setNumpadTarget('price')");
    // Nothing is invented and nothing is blocked — the cashier can still sell
    // it, they just have to say for how much.
    expect(fn).not.toMatch(/price:\s*\d+/);
  });

  it('the owner can find all of them in one click', () => {
    expect(menu).toContain('const unpriced = useMemo');
    expect(menu).toContain("setSearch('__unpriced__')");
    expect(menu).toContain('unpricedIds.has(i.id)');
  });

  it('counts an item as priced when a variant or a per-kg rate carries it', () => {
    const fn = menu.slice(menu.indexOf('const unpriced = useMemo'),
                          menu.indexOf('const unpricedIds'));
    expect(fn).toContain('i.sizeVariants?.length');
    expect(fn).toContain('i.inchVariants?.length');
    expect(fn).toContain('Number(i.ratePerKg) > 0');
  });
});

describe('6. the performance profile, from real orders', () => {
  const M = sql('20260905140000_v1_50_0_staff_performance.sql');
  const card = code('src/components/StaffProfileCard.tsx');

  it('computes at query time, so it cannot drift from the bills', () => {
    expect(M).toContain('from public.orders o');
    // Nothing is stored on the profile, so a reinstall cannot reset it.
    expect(M).not.toMatch(/insert into public\.user_profiles/);
  });

  it('scopes to the token — a staff member cannot read a colleague', () => {
    expect(M).toContain('portal_identity(p_token)');
    expect(M).toContain('o.tenant_id = s.tenant_id');
    expect(M).toContain('o.rider_id = s.user_id');
    expect(M).toContain("o.data->>'takenByUserId' = s.user_id::text");
    expect(M).not.toMatch(/portal_my_stats\(\s*p_user/);
  });

  it('mirrors the rider onto the column the reports read', () => {
    // rider_id was null on EVERY row while 68 documents named a rider, so the
    // live map and every rider report saw nobody.
    expect(M).toContain('new.rider_id := (d->>\'riderId\')::uuid');
  });

  it('guards the uuid cast, or the trigger blocks every order write', () => {
    // 43 documents hold a riderId that is not uuid-shaped, mostly ''. An
    // unguarded cast raises inside the trigger and no order can be saved.
    expect(M).toContain("d->>'riderId' ~* '^[0-9a-f]{8}-");
    expect(M).toContain("elsif coalesce(btrim(d->>'riderId'), '') = ''");
  });

  it('excludes deleted orders from the numbers', () => {
    expect(M).toContain('o.deleted_at is null');
  });

  it('the profile card shows them', () => {
    expect(card).toContain('portalMyStats');
    expect(card).toContain("stats.role === 'rider'");
    for (const k of ['assigned', 'delivered', 'earnings', 'taken', 'completed', 'sales']) {
      expect(card, k).toContain(k);
    }
  });
});

describe('7. the heavy libraries load with the button, not with the page', () => {
  it('Customers does not pull the spreadsheet library just to show a list', () => {
    // `import * as XLSX from 'xlsx'` at the top of the file put 412 KB of
    // spreadsheet code in this page's dependency graph, fetched every time
    // someone opened Customers to LOOK at it.
    const f = raw('src/pages/CustomersPage.tsx');
    expect(f).not.toMatch(/^import \* as XLSX from 'xlsx';$/m);
    expect(f).toContain("await import('xlsx')");
  });

  it('Marketing loads it when a file is chosen', () => {
    const f = raw('src/pages/MarketingPage.tsx');
    expect(f).not.toMatch(/^import \* as XLSX from 'xlsx';$/m);
    expect(f).toContain("await import('xlsx')");
  });

  it('the invoice preview loads the PDF stack at the click', () => {
    // html2canvas (196 KB) + jspdf (392 KB) were fetched merely to OPEN a
    // preview the viewer may never export.
    const f = raw('src/components/InvoicePreviewDialog.tsx');
    expect(f).not.toMatch(/^import html2canvas from 'html2canvas';$/m);
    expect(f).not.toMatch(/^import jsPDF from 'jspdf';$/m);
    expect(f).toContain("await import('html2canvas')");
    expect(f).toContain("await import('jspdf')");
  });
});

describe('8. the Order Taker bill that arrived empty', () => {
  const store = code('src/lib/supabaseStore.ts');
  const M = sql('20260905160000_v1_52_0_legacy_total_and_repair.sql');

  it('the document wins over the legacy column on a pull', () => {
    // payload.grandTotal = Number(row.total ?? payload.grandTotal) || 0
    // `total` is the legacy column, which portal_upsert_order never fills, so
    // it sat at 0 — and `0 ?? x` is 0, never a fallthrough. The column's zero
    // beat the document's 590, and the next save wrote the zero INTO the
    // document. One pull destroyed the figure.
    expect(store).toContain('Number(payload.grandTotal ?? row.grand_total ?? row.total) || 0');
    expect(store).not.toContain('Number(row.total ?? payload.grandTotal) || 0');
  });

  it('the trigger keeps total and grand_total equal', () => {
    expect(M).toContain('new.grand_total := coalesce((d->>\'grandTotal\')::numeric, new.grand_total)');
    expect(M).toContain('new.total       := coalesce((d->>\'grandTotal\')::numeric, new.total)');
  });

  it('repairs only documents that contradict themselves', () => {
    // netOfTax is grandTotal minus tax. With tax 0, "netOfTax 590 and
    // grandTotal 0" is arithmetically impossible — that invariant, not a
    // guess, is what makes the repair safe.
    expect(M).toContain("coalesce((o.data->>'netOfTax')::numeric, 0) > 0");
    expect(M).toContain("coalesce((o.data->>'grandTotal')::numeric, 0) = 0");
  });

  it('cross-checks the restored figure against the line items', () => {
    expect(M).toContain("sum((it->>'lineTotal')::numeric)");
  });
});

describe('9. "Order not found" for an order that exists', () => {
  const store = code('src/lib/store.ts');
  const page = code('src/pages/TrackOrderPage.tsx');

  it('calls the RPC directly, not only through the website origin', () => {
    // Order #1046 was in the table the whole time. The lookup went through a
    // TanStack server function on the website's own origin, which the packaged
    // app is not serving and which throws with no service-role key.
    const fn = store.slice(store.indexOf('export async function getOrderFromCloudByLookup'),
                           store.indexOf('if (!useFirestore()) return null;'));
    expect(fn).toContain("rpc('public_track_order'");
    // the server function stays as the fallback
    expect(fn).toContain('trackPublicOrder');
    expect(fn.indexOf("rpc('public_track_order'")).toBeLessThan(fn.indexOf('trackPublicOrder'));
  });

  it('a failed lookup is no longer reported as "not found"', () => {
    expect(page).toContain('reachError');
    expect(page).toContain('Could not check right now');
    // and a real miss still says so
    expect(page).toContain('Order not found. Check the order #');
  });
});

describe('10. the Edge Function the browser could never reach', () => {
  const fn = code('supabase/functions/apk-build/index.ts');

  it('answers the CORS preflight before asking for a token', () => {
    // "Failed to send a request to the Edge Function" is a fetch that never
    // completed. With verify_jwt on, the gateway 401s the OPTIONS preflight —
    // which carries no Authorization header by definition — so the browser
    // blocked the real request and no line of this function ever ran.
    const optionsAt = fn.indexOf('req.method === "OPTIONS"');
    const authAt = fn.indexOf('const authHeader');
    expect(optionsAt).toBeGreaterThan(-1);
    expect(optionsAt).toBeLessThan(authAt);
  });

  it('still verifies the caller and still demands super admin', () => {
    // The gateway check moved INTO the function; it was not removed.
    expect(fn).toContain('/auth/v1/user');
    expect(fn).toContain('is_super_admin');
    expect(fn).toContain('"super admin only"');
    expect(fn).toContain('401');
    expect(fn).toContain('403');
  });
});

describe('11. uploading the app icon instead of hunting for hosting', () => {
  const fn = code('supabase/functions/app-icon/index.ts');
  const ui = code('src/components/CustomerAppsManager.tsx');

  it('the path comes from the tenant, never from the uploader', () => {
    // Otherwise one restaurant's icon could land on another's.
    expect(fn).toContain('`app-icons/${tenantId}/${kind}.${EXT[contentType]}`');
    expect(fn).not.toMatch(/body\.(path|filename|folder|key)/);
  });

  it('is super admin only, checked with the CALLER\'s token', () => {
    // Asking with the service key would answer for the service role and let
    // anyone through.
    expect(fn).toContain('/auth/v1/user');
    expect(fn).toContain('is_super_admin');
    expect(fn).toContain('super_admin_only');
    expect(fn).toContain('authorization: `Bearer ${jwt}`');
  });

  it('answers the preflight before asking for a token', () => {
    const optionsAt = fn.indexOf('req.method === "OPTIONS"');
    const authAt = fn.indexOf('const jwt =');
    expect(optionsAt).toBeGreaterThan(-1);
    expect(optionsAt).toBeLessThan(authAt);
  });

  it('refuses a file that is not the image it claims to be', () => {
    expect(fn).toContain('looksLikeImage');
    expect(fn).toContain('not_an_image');
  });

  it('records the URL on the restaurant row so Build APK just uses it', () => {
    expect(fn).toContain('customer_apps?tenant_id=eq.');
    expect(fn).toContain('kind === "icon" ? "icon_url" : "logo_url"');
  });

  it('the form offers an upload, and still accepts a pasted link', () => {
    expect(ui).toContain('uploadBrandImage');
    expect(ui).toContain('function BrandImageField');
    expect(ui).toContain('…or paste a link');
    expect(ui).toContain("accept=\"image/png,image/jpeg,image/webp\"");
  });
});
