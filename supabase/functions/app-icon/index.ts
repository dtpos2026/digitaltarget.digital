/**
 * app-icon — upload a restaurant's app icon or logo from Super Admin.
 *
 * REQUESTED: "jahan link maanga tha icon ki, wahan UPLOAD icon maang lein — jis
 * se upload kare, ye usi restaurant ki uid mein save ho, aur generate pe
 * automatically icon change kar le."
 *
 * Pasting a URL meant the operator had to find image hosting first, and the
 * APK build then depended on a stranger's server still serving that file weeks
 * later. The file now lives in our own bucket, under the restaurant's own id,
 * and the build reads it from there.
 *
 * WHY THE BROWSER DOES NOT WRITE TO STORAGE DIRECTLY
 *
 * The branding bucket has a public READ policy and no write policy, so only
 * the service key can put a file in it. This function chooses the path from
 * the tenant id it was GIVEN and then checked — the uploader never names the
 * file — so one restaurant's icon can never land on another's.
 *
 * AUTHORISATION — why verify_jwt is off
 *
 * With verify_jwt on, the gateway 401s the CORS preflight (an OPTIONS request
 * carries no Authorization header by definition) and the browser blocks the
 * real call before this code runs — the "Failed to send a request to the Edge
 * Function" that was reported on the Build APK button. The check is done HERE
 * instead, after the preflight is answered: the caller's own JWT is verified
 * against auth/v1/user, then is_super_admin() is asked WITH THAT TOKEN. No
 * token is 401; a restaurant owner is 403.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Android launcher icons are 512x512 PNG; 4 MB is far above any real one. */
const MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Does the file actually start like the image it claims to be? The bucket
 * validates the Content-Type header we send, not the bytes, so without this a
 * caller could store anything at all by labelling it a png.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "post_only" }, 405);

  const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!URL_ || !SERVICE_KEY) return json({ ok: false, reason: "not_configured" }, 500);

  // ---------------------------------------------------------------- who asks
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ ok: false, reason: "not_signed_in" }, 401);

  const userRes = await fetch(`${URL_}/auth/v1/user`, {
    headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE_KEY },
  });
  if (!userRes.ok) return json({ ok: false, reason: "not_signed_in" }, 401);
  const user = await userRes.json();
  if (!user?.id) return json({ ok: false, reason: "not_signed_in" }, 401);

  // Asked with the CALLER'S token. The service key would answer for the
  // service role and let anyone through.
  const adminRes = await fetch(`${URL_}/rest/v1/rpc/is_super_admin`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      apikey: SERVICE_KEY,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (!(adminRes.ok && (await adminRes.json()) === true)) {
    return json({ ok: false, reason: "super_admin_only" }, 403);
  }

  // ------------------------------------------------------------- what to store
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, reason: "bad_json" }, 400); }

  const tenantId = String(body.tenant_id ?? "").trim();
  const kind = String(body.kind ?? "icon");
  const contentType = String(body.contentType ?? "");
  const base64 = String(body.base64 ?? "");

  if (!UUID.test(tenantId)) return json({ ok: false, reason: "bad_tenant" }, 400);
  if (kind !== "icon" && kind !== "logo") return json({ ok: false, reason: "bad_kind" }, 400);
  if (!EXT[contentType]) return json({ ok: false, reason: "bad_type" }, 400);
  // Capped before decoding, so an oversized payload is refused without ever
  // being materialised.
  if (base64.length < 16) return json({ ok: false, reason: "empty" }, 400);
  if (base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 1024) {
    return json({ ok: false, reason: "too_large" }, 413);
  }

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

  // The path is built from the tenant id, never from the request. One stable
  // name per restaurant per kind, so a new upload REPLACES the old file rather
  // than leaving the bucket to grow with every edit.
  const path = `app-icons/${tenantId}/${kind}.${EXT[contentType]}`;

  const up = await fetch(`${URL_}/storage/v1/object/branding/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": contentType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) return json({ ok: false, reason: "upload_failed" }, 502);

  const publicUrl = `${URL_}/storage/v1/object/public/branding/${path}`;

  // Recorded on the restaurant's own row, so the next build picks it up with
  // no copy-paste step.
  const col = kind === "icon" ? "icon_url" : "logo_url";
  const patch = await fetch(
    `${URL_}/rest/v1/customer_apps?tenant_id=eq.${tenantId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({ [col]: publicUrl }),
    },
  );
  // A row may not exist yet for a restaurant whose app has never been saved.
  // The URL is still returned so the form can hold it until Save.
  const recorded = patch.ok;

  // Cache-bust: the path is stable, so without this the old image keeps
  // showing after a change.
  return json({ ok: true, url: `${publicUrl}?v=${Date.now()}`, storedUrl: publicUrl, recorded });
});
