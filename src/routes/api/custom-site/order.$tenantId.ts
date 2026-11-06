// POST /api/custom-site/order/<restaurant id> — the door a restaurant's OWN website sends its orders through (v1.107.0).
// All decisions are in src/lib/customSiteIntake.server.ts; this file only reads the request and writes the answer.
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { HEADER_IDEMPOTENCY, HEADER_SIGNATURE, HEADER_TIMESTAMP, MAX_BODY_BYTES } from '@/lib/customSite';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const Route = createFileRoute('/api/custom-site/order/$tenantId')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { tenantId: string } }) => {
        const tenantId = z.string().uuid().safeParse(params.tenantId);
        if (!tenantId.success) return json(404, { ok: false, error: 'not_found' });

        const declared = Number(request.headers.get('content-length') ?? 0);
        if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' });
        const rawBody = await request.text();

        try {
          const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
          const { processIntake } = await import('@/lib/customSiteIntake.server');
          const db = await getSupabaseAdmin();
          const result = await processIntake(db as never, {
            tenantId: tenantId.data,
            rawBody,
            timestamp: request.headers.get(HEADER_TIMESTAMP),
            signature: request.headers.get(HEADER_SIGNATURE),
            idempotencyKey: request.headers.get(HEADER_IDEMPOTENCY),
          });
          return json(result.status, result.body);
        } catch (e) {
          console.error('[custom-site] intake failed', e instanceof Error ? e.message : 'unknown');
          return json(500, { ok: false, error: 'server_error', message: 'The server could not take the order. Retry.' });
        }
      },
    },
  },
});
