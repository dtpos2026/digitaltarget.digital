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
                           store.indexOf('function getSyncDeviceIdSafe'));
    expect(fn).toContain('return getSyncDeviceIdSafe()');
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
