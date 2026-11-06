// The one part of the Custom Website card that needs a server (v1.107.0, trimmed in v1.108.0).
//
// The card's reads and writes — status, save, create / replace / revoke the key — are database functions for the signed-in
// owner (src/lib/customSiteApi.ts) and work in the Windows app too. This check signs a sample order with the stored key
// and runs it through the real intake rules, which live in TypeScript, so it runs here and places nothing.
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { SAMPLE_ORDER, signRequest } from '@/lib/customSite';

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
