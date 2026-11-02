import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// v1.95.0 — the customer website's view of the restaurant's settings, read with the server's own key (an anonymous
// visitor cannot read tenant_settings) and cut down to the allow-list in publicStorefront.ts.
export const getPublicStorefront = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) => z.object({ tenantId: z.string().uuid() }).parse(value))
  .handler(async ({ data }) => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { readStorefront } = await import('@/lib/publicStorefront');
    const admin = await getSupabaseAdmin();
    return readStorefront(admin as unknown as import('@/lib/publicStorefront').StorefrontDb, data.tenantId);
  });
