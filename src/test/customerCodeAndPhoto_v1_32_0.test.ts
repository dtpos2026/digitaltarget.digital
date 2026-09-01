// ============================================================================
// v1.32.0 — a customer ID the restaurant can quote, and a profile photo.
// Plus v1.31.7, the regression this work uncovered.
//
// ASKED FOR: "custumer me profile ho photo ke sath, custumer id resturant ko
// dikhy". A uuid cannot be read down a phone line.
//
// VERIFIED LIVE (rolled back): 1498 of 1498 customers hold a code, none
// duplicated within a tenant (C-NJNXX, C-DZ29B, C-WFEP4); a bucket URL saves;
// an outside URL is refused bad_url; a junk token is refused no_session.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const sql = (f: string) =>
  readFileSync(resolve(ROOT, 'supabase/migrations', f), 'utf8').replace(/^\s*--.*$/gm, '');
const ts = (f: string) =>
  readFileSync(resolve(ROOT, f), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

const MIG = sql('20260901110000_v1_32_0_customer_code_and_photo.sql');
const FIX = sql('20260901100000_v1_31_7_fix_customer_public_json.sql');

describe('v1.31.7 — the dropped column that broke customer sign-in', () => {
  it('customer_public_json no longer reads push_token', () => {
    expect(FIX).toContain('create or replace function public.customer_public_json');
    expect(FIX).not.toContain('push_token');
    expect(FIX).not.toContain('pushEnabled');
  });

  it('the final version in v1.32.0 does not reintroduce it', () => {
    expect(MIG).not.toContain('push_token');
    expect(MIG).not.toContain('pushEnabled');
  });
});

describe('the customer code', () => {
  it('is unique per restaurant, not globally', () => {
    expect(MIG).toContain('create unique index if not exists customers_code_per_tenant');
    expect(MIG).toContain('on public.customers (tenant_id, customer_code)');
  });

  it('avoids glyphs that are misread aloud or mistyped', () => {
    const at = MIG.indexOf('alphabet constant text');
    expect(at).toBeGreaterThan(-1);
    const alphabet = /'([A-Z0-9]+)'/.exec(MIG.slice(at, at + 200))?.[1] ?? '';
    expect(alphabet.length).toBeGreaterThan(20);
    for (const bad of ['0', 'O', '1', 'I']) expect(alphabet, bad).not.toContain(bad);
  });

  it('cannot loop forever on collisions', () => {
    expect(MIG).toContain('if attempt > 20 then');
  });

  it('is assigned by a trigger AND backfilled onto existing customers', () => {
    expect(MIG).toContain('create trigger trg_assign_customer_code');
    expect(MIG).toContain('before insert on public.customers');
    expect(MIG).toContain('update public.customers');
    expect(MIG).toContain('where customer_code is null');
  });
});

describe('the photo, and the hole it deliberately does not open', () => {
  it('gives the bucket a public read policy and NO write policy', () => {
    expect(MIG).toContain('create policy "customer-photos_public_read"');
    expect(MIG).toContain('for select to public using (bucket_id = \'customer-photos\')');
    // the whole point: anon must not be able to write to storage
    expect(MIG).not.toMatch(/for insert[\s\S]{0,120}customer-photos/);
    expect(MIG).not.toMatch(/for update[\s\S]{0,120}customer-photos/);
  });

  it('refuses a URL that is not in our own bucket', () => {
    const at = MIG.indexOf('create or replace function public.public_customer_set_photo');
    const body = MIG.slice(at, MIG.indexOf('$function$;', at));
    expect(body).toContain("'bad_url'");
    expect(body).toContain('storage/v1/object/public/customer-photos/');
    expect(body).toContain("'no_session'");
    // and it stops working when the app module is switched off
    expect(body).toContain('customer_app_blocked');
  });

  it('writes only the caller\'s own row', () => {
    const at = MIG.indexOf('create or replace function public.public_customer_set_photo');
    const body = MIG.slice(at, MIG.indexOf('$function$;', at));
    expect(body).toContain('customer_from_token(p_token)');
    expect(body).toContain('where id = v_row.id');
  });

  it('uploads through the server function, never the browser', () => {
    const fn = ts('src/lib/customerPhoto.functions.ts');
    expect(fn).toContain('getSupabaseAdmin');
    // identity comes from Postgres, never from the request body
    expect(fn).toContain("admin.rpc('public_customer_me'");
    expect(fn).toContain('res.customer?.id');
    expect(fn).toContain('const path = `${res.customer.id}/profile.${ext}`');
    expect(fn).toContain('MAX_BYTES');
  });
});

describe('what the POS may and may not do with them', () => {
  it('shows the code and the photo, and can search by the code', () => {
    const page = ts('src/pages/CustomersPage.tsx');
    expect(page).toContain('c.customerCode');
    expect(page).toContain('c.photoUrl');
    expect(page).toContain("(c.customerCode ?? '').toLowerCase().includes(s)");
  });

  it('cannot overwrite either — neither is in the write allow-list', () => {
    const store = readFileSync(resolve(ROOT, 'src/lib/supabaseStore.ts'), 'utf8');
    const at = store.indexOf('customers: new Set([');
    expect(at).toBeGreaterThan(-1);
    const allow = store.slice(at, store.indexOf(']),', at));
    expect(allow).not.toContain('customer_code');
    expect(allow).not.toContain('photo_url');
  });
});
