/**
 * profile-photo — save a customer's or a staff member's profile picture.
 *
 * WHY THIS EXISTS
 *
 * The customer photo upload already worked, on the website. It went through a
 * TanStack server function, which lives on the website's own origin. Inside the
 * packaged Android app the WebView is not serving that origin, so the request
 * had nowhere to land and the photo silently never appeared — which is exactly
 * what was reported: "customer me pic lgana ha but nzr nhi aya".
 *
 * An Edge Function is on the Supabase origin, which every one of our surfaces
 * already talks to: the website, the Windows app, and all three APKs. One
 * endpoint, one code path, one place to fix.
 *
 * WHY THE BROWSER STILL DOES NOT WRITE TO STORAGE
 *
 * The customer-photos bucket has a public READ policy and NO write policy, so
 * only the service key can put a file in it. Giving the browser an anon INSERT
 * policy would let anyone holding the public key fill the bucket. So the bytes
 * come here, this verifies who is asking, and this chooses the path — the
 * uploader never names the file, so nobody can overwrite somebody else's.
 *
 * AUTHORISATION — why verify_jwt is off
 *
 * Neither caller has a Supabase auth session. A customer holds an opaque
 * session token from public_customer_signin; a rider or order taker holds one
 * from staff_login_global. Postgres is the only thing that can say who a token
 * belongs to, so that is what is asked, with the service key, before a single
 * byte is written:
 *
 *   kind=customer -> public_customer_me(p_token)  -> customers.id
 *   kind=staff    -> portal_me(p_token)           -> user_profiles.user_id
 *
 * An absent, expired or unknown token gets 401 and no upload. The token is
 * never echoed back and never logged.
 *
 *   POST /functions/v1/profile-photo
 *   { "kind": "customer" | "staff", "token": "...",
 *     "contentType": "image/jpeg" | "image/png" | "image/webp",
 *     "base64": "<the image, no data: prefix>" }
 *
 *   -> 200 { "ok": true, "url": "https://...?v=<ts>" }
 *   -> 4xx { "ok": false, "reason": "..." }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

/** Matches the bucket's own file_size_limit, so nothing gets uploaded to be rejected. */
const MAX_BYTES = 2 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Does the file actually start like the image it claims to be?
 *
 * The bucket enforces allowed_mime_types against the header we send, not
 * against the bytes, so without this a caller could store anything at all by
 * labelling it image/png. Cheap check, closes the gap.
 */
function looksLikeImage(b: Uint8Array, contentType: string): boolean {
  if (b.length < 12) return false;
  if (contentType === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (contentType === "image/png") {
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
           b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
  }
  if (contentType === "image/webp") {
    return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
           b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  }
  return false;
}

async function rpc(url: string, key: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return { error: `${name}_failed`, data: null as unknown };
  return { error: null as string | null, data: await res.json() as unknown };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "post_only" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!URL_ || !SERVICE_KEY) return json({ ok: false, reason: "not_configured" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, reason: "bad_json" }, 400); }

  const kind = String(body.kind ?? "");
  const token = String(body.token ?? "");
  const contentType = String(body.contentType ?? "");
  const base64 = String(body.base64 ?? "");

  if (kind !== "customer" && kind !== "staff") return json({ ok: false, reason: "bad_kind" }, 400);
  if (token.length < 16 || token.length > 400) return json({ ok: false, reason: "no_session" }, 401);
  if (!EXT[contentType]) return json({ ok: false, reason: "bad_type" }, 400);
  // Cap before decoding, so an oversized payload is refused without ever being
  // materialised in memory.
  if (base64.length < 16) return json({ ok: false, reason: "empty" }, 400);
  if (base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 1024) {
    return json({ ok: false, reason: "too_large" }, 413);
  }

  // --- who is asking? Postgres answers, not the request body ---------------
  let path: string;
  if (kind === "customer") {
    const me = await rpc(URL_, SERVICE_KEY, "public_customer_me", { p_token: token });
    const r = me.data as { ok?: boolean; reason?: string; customer?: { id?: string } } | null;
    if (me.error || !r?.ok || !r.customer?.id) {
      return json({ ok: false, reason: r?.reason ?? "no_session" }, 401);
    }
    // The path shape customers have used since v1.32.0 — keep it, so an
    // existing photo is replaced rather than orphaned alongside a new one.
    path = `${r.customer.id}/profile.${EXT[contentType]}`;
  } else {
    const me = await rpc(URL_, SERVICE_KEY, "portal_me", { p_token: token });
    const r = me.data as { ok?: boolean; reason?: string; userId?: string } | null;
    if (me.error || !r?.ok || !r.userId) {
      return json({ ok: false, reason: r?.reason ?? "no_session" }, 401);
    }
    path = `staff/${r.userId}/profile.${EXT[contentType]}`;
  }

  // --- decode and check the bytes ------------------------------------------
  let bytes: Uint8Array;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return json({ ok: false, reason: "bad_base64" }, 400);
  }
  if (bytes.length === 0) return json({ ok: false, reason: "empty" }, 400);
  if (bytes.length > MAX_BYTES) return json({ ok: false, reason: "too_large" }, 413);
  if (!looksLikeImage(bytes, contentType)) return json({ ok: false, reason: "not_an_image" }, 400);

  // --- store it -------------------------------------------------------------
  const up = await fetch(`${URL_}/storage/v1/object/customer-photos/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": contentType,
      // The path is stable per person, so every change overwrites rather than
      // letting the bucket grow forever.
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) return json({ ok: false, reason: "upload_failed" }, 502);

  const publicUrl = `${URL_}/storage/v1/object/public/customer-photos/${path}`;

  // --- record it, through the same RPC the app could have called ------------
  const saved = kind === "customer"
    ? await rpc(URL_, SERVICE_KEY, "public_customer_set_photo", { p_token: token, p_url: publicUrl })
    : await rpc(URL_, SERVICE_KEY, "portal_update_me", { p_token: token, p_photo: publicUrl });

  const sr = saved.data as { ok?: boolean; reason?: string } | null;
  if (saved.error || !sr?.ok) return json({ ok: false, reason: sr?.reason ?? "save_failed" }, 400);

  // Cache-bust: the path never changes, so without this the old picture keeps
  // showing after a change.
  return json({ ok: true, url: `${publicUrl}?v=${Date.now()}` });
});
