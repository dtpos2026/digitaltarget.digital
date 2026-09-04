// ============================================================================
// REPORTED with screenshots: "1 change could not be uploaded (orders/riders/
// customers)" and a rider Claim that does not stick — the order stays in
// AVAILABLE ORDERS and MY ACTIVE ORDERS stays 0.
//
// A portal app holds a token, not a Supabase session, so auth.uid() is null.
// Reads went through portal_* SECURITY DEFINER functions; writes went straight
// at the table as `anon`. An UPDATE that RLS filters does NOT raise — it
// matches zero rows and returns success. Proven on the live database:
//
//     set role anon; update orders        ... -> no error, rows affected = 0
//     set role anon; update user_profiles ... -> no error, rows affected = 0
//
// So the claim was written locally, reported as saved, and never left the
// phone.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql   = readFileSync('supabase/migrations/20260904100000_v1_41_0_portal_writes.sql', 'utf8');
const data  = readFileSync('src/lib/portalData.ts', 'utf8');
const rider = readFileSync('src/pages/RiderAppPage.tsx', 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

describe('the server decides, not the phone', () => {
  it('resolves the caller from the token and fails closed', () => {
    expect(sql).toContain('from public.portal_identity(p_token)');
    expect(sql.match(/'no_session'/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('scopes every write to the token holder\'s own restaurant', () => {
    expect(sql).toContain('where id = p_order and tenant_id = v_tenant');
  });

  it('will not let one rider steal an order another already claimed', () => {
    expect(sql).toContain("'already_claimed'");
    expect(sql).toContain("coalesce(o.data->>'riderId','') not in ('', v_id::text)");
  });

  it('will not let a rider advance somebody else\'s delivery', () => {
    expect(sql).toContain("'not_yours'");
  });

  it('only riders and order takers may use it', () => {
    expect(sql).toContain("v_role not in ('rider','order_taker')");
  });

  it('a staff member edits only their OWN row', () => {
    const fn = sql.slice(sql.indexOf('function public.portal_update_me'));
    expect(fn).toContain('where user_id = v_id');
    // role, permissions, branch and is_active belong to the restaurant admin
    for (const col of ['role =', 'permissions =', 'is_active =', 'tenant_id =']) {
      expect(fn, `portal_update_me must not write ${col}`).not.toContain(col);
    }
  });

  it('refuses a photo that is not a real URL', () => {
    expect(sql).toContain("'bad_photo_url'");
  });

  it('reports whether a row was actually written', () => {
    // The whole defect was a write that changed nothing and said success.
    expect(sql).toContain('get diagnostics n = row_count');
    expect(sql).toContain("jsonb_build_object('ok', n > 0");
  });
});

describe('the app actually calls them', () => {
  it('portalData exposes the three writes', () => {
    for (const fn of ['portalClaimOrder', 'portalSetDeliveryStage', 'portalUpdateMe']) {
      expect(data).toContain(`export function ${fn}`);
    }
  });

  it('Claim goes to the server BEFORE it is shown as claimed', () => {
    const fn = rider.slice(rider.indexOf('const claimOrder'), rider.indexOf('const advance'));
    expect(fn).toContain('await portalClaimOrder(o.id)');
    // the local write must come after the server accepted it
    expect(fn.indexOf('await portalClaimOrder')).toBeLessThan(fn.indexOf('saveOrder(next)'));
    expect(fn.indexOf('await portalClaimOrder')).toBeLessThan(fn.indexOf('toast.success'));
  });

  it('a refused claim says so instead of pretending', () => {
    const fn = rider.slice(rider.indexOf('const claimOrder'), rider.indexOf('const advance'));
    expect(fn).toContain('already_claimed');
    expect(fn).toContain('toast.error');
  });

  it('advancing a delivery goes to the server too', () => {
    const fn = rider.slice(rider.indexOf('const advance'));
    expect(fn).toContain('await portalSetDeliveryStage(o.id, stage)');
    expect(fn.indexOf('await portalSetDeliveryStage')).toBeLessThan(fn.indexOf('setDeliveryStage(o, stage)'));
  });
});
