// Owner-side server functions for the Custom Website card (Settings → Online Order). v1.107.0.
//
// Every function resolves the CALLER's restaurant from their own session (auth_tenant_id()) and requires the owner or
// an admin. The table that holds the secret is closed to the API, so it is read and written here with the server key,
// and the secret is returned to the browser exactly once — when it is created or rotated.
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import {
  EMPTY_STATUS, SAMPLE_ORDER, generateSecret, normalizeSiteUrl, secretHint, signRequest,
  type CustomSiteMode, type CustomSiteStatus,
} from '@/lib/customSite';

type Ctx = { supabase: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> } };

async function ownerTenant(context: Ctx): Promise<string> {
  const t = await context.supabase.rpc('auth_tenant_id');
  if (t.error || typeof t.data !== 'string') throw new Error('Sign in as the restaurant owner first.');
  const r = await context.supabase.rpc('auth_role');
  if (r.error || (r.data !== 'owner' && r.data !== 'admin')) throw new Error('Only the owner or an admin can change this.');
  return t.data;
}

async function admin() {
  const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
  return (await getSupabaseAdmin()) as unknown as import('@/lib/customSiteIntake.server').IntakeDb;
}

export const getCustomSiteStatus = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CustomSiteStatus> => {
    const tenantId = await ownerTenant(context as unknown as Ctx);
    const db = await admin();
    const row = (await db.from('custom_site_intake').select('*').eq('tenant_id', tenantId).maybeSingle()).data as Record<string, string | null> | null;
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const ledger = await db.from('custom_site_orders')
      .select('order_number, unmatched, created_at').eq('tenant_id', tenantId).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(200);
    const rows = (ledger.data ?? []) as { order_number: number | null; unmatched: { name: string; quantity: number; price: number }[]; created_at: string }[];
    const recentUnmatched = rows.flatMap(r => (r.unmatched ?? []).map(u => ({ orderNumber: r.order_number, name: u.name, quantity: u.quantity, price: u.price, at: r.created_at }))).slice(0, 10);
    return {
      ...EMPTY_STATUS,
      mode: (row?.mode as CustomSiteMode) ?? 'builtin',
      siteUrl: row?.site_url ?? null,
      adminUrl: row?.admin_url ?? null,
      hasKey: !!row?.secret_hint,
      keyHint: row?.secret_hint ?? null,
      keyCreatedAt: row?.key_created_at ?? null,
      lastOrderAt: row?.last_order_at ?? null,
      lastError: row?.last_error ?? null,
      lastErrorAt: row?.last_error_at ?? null,
      orders7d: rows.length,
      unmatched7d: rows.filter(r => (r.unmatched ?? []).length > 0).length,
      recentUnmatched,
    };
  });

export const saveCustomSiteSettings = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    mode: z.enum(['builtin', 'own', 'both']),
    siteUrl: z.string().max(300).nullable(),
    adminUrl: z.string().max(300).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await ownerTenant(context as unknown as Ctx);
    const siteUrl = data.siteUrl?.trim() ? normalizeSiteUrl(data.siteUrl) : null;
    const adminUrl = data.adminUrl?.trim() ? normalizeSiteUrl(data.adminUrl) : null;
    if (data.siteUrl?.trim() && !siteUrl) throw new Error('The site address must be a full https:// address, for example https://myrestaurant.com.');
    if (data.adminUrl?.trim() && !adminUrl) throw new Error('The admin address must be a full https:// address.');
    const db = await admin();
    const { error } = await db.from('custom_site_intake').upsert(
      { tenant_id: tenantId, mode: data.mode, site_url: siteUrl, admin_url: adminUrl, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const, siteUrl, adminUrl };
  });

/** Create the key, or replace it. The only moment the secret leaves the server. */
export const rotateCustomSiteKey = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await ownerTenant(context as unknown as Ctx);
    const secret = generateSecret();
    const db = await admin();
    const { error } = await db.from('custom_site_intake').upsert(
      {
        tenant_id: tenantId, secret, secret_hint: secretHint(secret),
        key_created_at: new Date().toISOString(), last_error: null, last_error_at: null, updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    );
    if (error) throw new Error(error.message);
    return { secret, hint: secretHint(secret) };
  });

/** One click: the old key stops working at once and no order can arrive until a new key is made. */
export const revokeCustomSiteKey = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await ownerTenant(context as unknown as Ctx);
    const db = await admin();
    const { error } = await db.from('custom_site_intake')
      .update({ secret: null, secret_hint: null, key_created_at: null, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Sign a sample order with the stored key and run it through the real checks — without placing anything. */
export const testCustomSiteConnection = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await ownerTenant(context as unknown as Ctx);
    const db = await admin();
    const row = (await db.from('custom_site_intake').select('secret').eq('tenant_id', tenantId).maybeSingle()).data as { secret: string | null } | null;
    if (!row?.secret) return { ok: false as const, status: 0, message: 'Create a key first.' };
    const { processIntake } = await import('@/lib/customSiteIntake.server');
    const body = JSON.stringify(SAMPLE_ORDER);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = await processIntake(db, {
      tenantId, rawBody: body, timestamp, signature: await signRequest(row.secret, timestamp, body),
      idempotencyKey: null, dryRun: true,
    });
    return { ok: result.status === 200, status: result.status, message: String(result.body.message ?? result.body.error ?? '') };
  });
