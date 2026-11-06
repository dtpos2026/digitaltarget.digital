// POST /api/custom-site/order/<restaurant id> — the door a restaurant's OWN website sends its orders through.
// All decisions are in src/lib/customSiteIntake.server.ts; this file only reads the request and writes the answer.
//
// ===== This file deliberately imports NOTHING of ours at the top =====
// Every module is loaded inside the handler. v1.107.0 added a server function file next to this route, and the production
// worker stopped starting (the server bundle split into two chunks that imported each other: "__exportAll2 is not a
// function", every page answered "This page didn't load"). Only a route and a handler that load their code on demand
// keep the server entry's chunk graph exactly as it was. `npm run smoke:worker` runs the built worker and must answer 200.
import { createFileRoute } from '@tanstack/react-router';

const MAX_BODY_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const Route = createFileRoute('/api/custom-site/order/$tenantId')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { tenantId: string } }) => {
        if (!UUID.test(params.tenantId)) return json(404, { ok: false, error: 'not_found' });

        const declared = Number(request.headers.get('content-length') ?? 0);
        if (declared > MAX_BODY_BYTES) return json(413, { ok: false, error: 'too_large' });
        const rawBody = await request.text();

        try {
          const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
          const { processIntake } = await import('@/lib/customSiteIntake.server');
          const db = await getSupabaseAdmin();
          const result = await processIntake(db as never, {
            tenantId: params.tenantId,
            rawBody,
            timestamp: request.headers.get('x-dt-timestamp'),
            signature: request.headers.get('x-dt-signature'),
            idempotencyKey: request.headers.get('x-dt-idempotency-key'),
            // x-dt-dry-run: 1 — check the key, the signature, the shape and the owner's switches; place nothing.
            dryRun: request.headers.get('x-dt-dry-run') === '1',
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
