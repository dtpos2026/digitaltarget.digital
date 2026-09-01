// ============================================================================
// Uploading a customer's profile photo — v1.32.0
//
// The browser NEVER writes to storage here. The customer-photos bucket has a
// public READ policy and no write policy at all, so only the service key can
// put a file in it. That is deliberate: an anon INSERT policy on storage is
// exactly the shape of the hole that was found on order_items in v1.31.0 —
// anyone with the public key could have filled the bucket.
//
// So the flow is: the app sends its session token and the image bytes here;
// this verifies the token by asking Postgres who it belongs to, writes the file
// under a path derived from that answer, and records the URL through the same
// RPC the app could have called itself. The customer can only ever replace
// their own photo, because the path is not theirs to choose.
// ============================================================================
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

/** 2 MB, matching the bucket's own file_size_limit. */
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export const uploadCustomerPhoto = createServerFn({ method: 'POST' })
  .inputValidator((value: unknown) =>
    z.object({
      token: z.string().min(32).max(200),
      contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      // base64 WITHOUT the data: prefix. Capped before decoding so an oversized
      // payload is refused without ever being materialised.
      base64: z.string().min(16).max(Math.ceil(MAX_BYTES * 4 / 3) + 1024),
    }).parse(value))
  .handler(async ({ data }): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
    const { getSupabaseAdmin } = await import('@/integrations/supabase/client.server');
    const admin = await getSupabaseAdmin();

    // Who is this? The token is the only claim, and Postgres is the only thing
    // that can answer it — the tenant and customer id come from there, never
    // from the request body.
    // `as never`: these RPCs post-date the generated types file, which is the
    // convention already used for every other public_customer_* call.
    const me = await admin.rpc('public_customer_me' as never, { p_token: data.token } as never);
    if (me.error) return { ok: false, reason: 'lookup_failed' };
    const res = me.data as { ok?: boolean; reason?: string; customer?: { id?: string } } | null;
    if (!res?.ok || !res.customer?.id) {
      return { ok: false, reason: res?.reason ?? 'no_session' };
    }

    const bytes = Buffer.from(data.base64, 'base64');
    if (bytes.length === 0) return { ok: false, reason: 'empty' };
    if (bytes.length > MAX_BYTES) return { ok: false, reason: 'too_large' };

    const ext = ALLOWED[data.contentType];
    // One stable path per customer, so a new photo replaces the old one instead
    // of leaving the bucket to grow forever with every edit.
    const path = `${res.customer.id}/profile.${ext}`;

    const up = await admin.storage.from('customer-photos').upload(path, bytes, {
      contentType: data.contentType,
      upsert: true,
    });
    if (up.error) return { ok: false, reason: up.error.message };

    const { data: pub } = admin.storage.from('customer-photos').getPublicUrl(path);
    // Cache-bust: the path is stable, so without this the old image keeps
    // showing after a change.
    const url = `${pub.publicUrl}?v=${Date.now()}`;

    const saved = await admin.rpc('public_customer_set_photo' as never, {
      p_token: data.token,
      p_url: pub.publicUrl,
    } as never);
    if (saved.error) return { ok: false, reason: saved.error.message };
    const savedRes = saved.data as { ok?: boolean; reason?: string } | null;
    if (!savedRes?.ok) return { ok: false, reason: savedRes?.reason ?? 'save_failed' };

    return { ok: true, url };
  });
