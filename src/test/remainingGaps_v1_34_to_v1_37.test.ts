// ============================================================================
// The six items that were listed as "not built / not possible", now built.
// Every one was verified against the live database inside a rolled-back
// transaction; these assertions hold the migrations to what was verified.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const sql = (f: string) =>
  readFileSync(resolve(ROOT, 'supabase/migrations', f), 'utf8').replace(/^\s*--.*$/gm, '');
const ts = (f: string) =>
  readFileSync(resolve(ROOT, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const MIRROR = sql('20260902100000_v1_34_0_normalise_order_items.sql');
const DELBY  = sql('20260902110000_v1_35_0_recycle_bin_deleted_by.sql');
const BRAND  = sql('20260902120000_v1_36_0_restaurant_owns_its_branding.sql');
const PROMO  = sql('20260902130000_v1_37_0_promotions.sql');

describe('1. order_items is filled for every source, not a third', () => {
  it('fans the document out from a trigger, so no writer can be forgotten', () => {
    expect(MIRROR).toContain('create trigger trg_sync_order_items_mirror');
    expect(MIRROR).toContain('after insert or update of data on public.orders');
  });

  it('is idempotent — a re-saved bill cannot duplicate a line', () => {
    expect(MIRROR).toContain('delete from public.order_items where order_id = new.id');
  });

  it('survives a deleted menu item and a pre-uuid id', () => {
    // Both were found by RUNNING the backfill, not by reading.
    expect(MIRROR).toMatch(/menuItemId' ~\* '\^\[0-9a-f\]\{8\}/);
    expect(MIRROR).toContain('from public.menu_items m');
    // guard AND lookup: the regex stops the cast throwing, the lookup stops the
    // foreign key firing
    expect(MIRROR).toContain('where m.id = (it->>\'menuItemId\')::uuid');
  });

  it('backfills without bumping orders.updated_at', () => {
    expect(MIRROR).toContain('not exists (select 1 from public.order_items i where i.order_id = o.id)');
    expect(MIRROR).not.toMatch(/update public\.orders\s+set/);
  });
});

describe('2. the weekly purge is actually scheduled', () => {
  it('installs pg_cron and schedules the job', () => {
    expect(MIRROR).toContain('create extension if not exists pg_cron');
    expect(MIRROR).toContain("cron.schedule('recycle-bin-weekly-purge'");
    expect(MIRROR).toContain('public.recycle_bin_purge(7)');
  });

  it('unschedules first, so re-running cannot stack duplicate jobs', () => {
    const at = MIRROR.indexOf('cron.unschedule');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(MIRROR.indexOf('cron.schedule('));
  });
});

describe('3. the recycle bin records who deleted a record', () => {
  it('stamps from auth.uid(), never from the client', () => {
    expect(DELBY).toContain('new.deleted_by      := auth.uid()');
    // the stamp is a zero-argument trigger function: there is no parameter a
    // caller could pass, so the identity cannot be supplied from outside
    expect(DELBY).toContain('create or replace function public.stamp_deleted_by()');
    expect(DELBY).not.toMatch(/function public\.stamp_deleted_by\s*\(\s*[a-z]/i);
  });

  it('only stamps the transition INTO the bin', () => {
    expect(DELBY).toContain('if new.deleted_at is not null and old.deleted_at is null then');
  });

  it('clears the marks on restore', () => {
    expect(DELBY).toContain('elsif new.deleted_at is null and old.deleted_at is not null then');
    expect(DELBY).toContain('new.deleted_by      := null');
  });

  it('covers tables discovered from the catalogue, not a hand-written list', () => {
    expect(DELBY).toContain("d.attname='deleted_at'");
    expect(DELBY).toContain("t.attname='tenant_id'");
  });
});

describe('4. a restaurant brands its own app, but only the branding', () => {
  it('lets owner/admin/manager write their own row', () => {
    expect(BRAND).toContain('create policy customer_apps_tenant_brand');
    expect(BRAND).toContain("auth_role() in ('owner','admin','manager')");
    expect(BRAND).toContain('with check (tenant_id = auth_tenant_id())');
  });

  it('refuses the module switch and the release train', () => {
    for (const col of ['enabled', 'min_supported_version', 'update_required', 'require_claim_otp']) {
      expect(BRAND, col).toContain(col);
    }
    expect(BRAND).toContain('the customer app module can only be switched by Digital Target');
    expect(BRAND).toContain('app release settings can only be changed by Digital Target');
  });

  it('refuses loudly rather than ignoring silently', () => {
    expect(BRAND).toContain("using errcode='42501'");
  });
});

describe('5. promotions reach only the sending restaurant\'s customers', () => {
  it('selects by the tenant the TOKEN resolves to, never a supplied one', () => {
    const at = PROMO.indexOf('create or replace function public.public_customer_promotions');
    const body = PROMO.slice(at, PROMO.indexOf('$function$;', at));
    expect(body).toContain('customer_from_token(p_token)');
    expect(body).toContain('where p.tenant_id = v_row.tenant_id');
    // there is no tenant parameter at all, so one cannot be spoofed
    expect(PROMO).not.toContain('public_customer_promotions(p_tenant');
  });

  it('gives anon no way to read the table directly', () => {
    expect(PROMO).toContain('revoke all on public.customer_promotions from anon');
    expect(PROMO).not.toMatch(/create policy[^;]*to anon/);
  });

  it('scopes the restaurant\'s own management by tenant', () => {
    expect(PROMO).toContain('using      (tenant_id = auth_tenant_id() or is_super_admin())');
    expect(PROMO).toContain('with check (tenant_id = auth_tenant_id() or is_super_admin())');
  });

  it('stops serving when the app module is switched off', () => {
    expect(PROMO).toContain('customer_app_blocked(v_row.tenant_id)');
  });
});

describe('6. a bill marked paid records HOW it was paid', () => {
  const POS = ts('src/pages/POSScreen.tsx');

  it('records the method, the account and the amount', () => {
    const at = POS.indexOf('const payBillFromRetrieve');
    expect(at).toBeGreaterThan(-1);
    const fn = POS.slice(at, at + 1400);
    expect(fn).toContain('paymentMethod: method');
    expect(fn).toContain('amountPaid: order.grandTotal');
    expect(fn).toContain('paymentAccountId');
  });

  it('says which method it used, so a wrong default is visible at once', () => {
    expect(POS).toContain('paid — ${method}');
  });
});
