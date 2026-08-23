/**
 * push-dispatch — drains notification_outbox to Firebase Cloud Messaging.
 *
 * Invoke on a schedule (Supabase cron, or any scheduler that can POST):
 *
 *   POST https://<project>.functions.supabase.co/push-dispatch
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Required secrets:
 *   SUPABASE_URL                  (provided by the platform)
 *   SUPABASE_SERVICE_ROLE_KEY     (provided by the platform)
 *   FCM_SERVICE_ACCOUNT           the Firebase service-account JSON, verbatim
 *
 * Optional:
 *   PUSH_DISPATCH_SECRET          an alternative caller secret, sent as
 *                                 x-dispatch-secret, for schedulers that
 *                                 cannot hold the service-role key
 *   PUSH_BATCH_LIMIT              rows per invocation (default 50)
 *
 * Design notes:
 *   * Rows are claimed with FOR UPDATE SKIP LOCKED inside
 *     claim_notification_batch, so two overlapping invocations never send the
 *     same notification twice.
 *   * A row that fails goes back to 'pending' until 5 attempts, then 'failed'.
 *   * FCM reporting a dead token clears customers.push_token, so the queue
 *     stops filling with rows nothing can deliver.
 *   * With no FCM credentials configured the function reports that plainly and
 *     leaves the queue alone. It does not pretend to have delivered anything.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface OutboxRow {
  id: string;
  tenant_id: string;
  channel: string;
  destination: string;
  title: string | null;
  body: string;
  data: Record<string, unknown>;
  customer_id: string | null;
  attempts: number;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Exchange the service account for a short-lived FCM access token. */
async function fcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })));
  const signingInput = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)),
  );
  const assertion = `${signingInput}.${b64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`token exchange failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.access_token as string;
}

/** A token FCM says will never work again — retrying it is pointless. */
function isDeadToken(status: number, payload: string): boolean {
  if (status === 404) return true;
  return /UNREGISTERED|INVALID_ARGUMENT.*registration|NotRegistered/i.test(payload);
}

async function rpc(url: string, key: string, fn: string, args: unknown): Promise<Response> {
  return await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(args),
  });
}

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const secret = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "";
  const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";
  const limit = Number(Deno.env.get("PUSH_BATCH_LIMIT") ?? "50") || 50;

  // verify_jwt alone would also admit the anon key, which every customer holds.
  // The caller must present the service-role key, or the dedicated secret.
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const given = req.headers.get("x-dispatch-secret") ?? "";
  const authorised = (svc !== "" && bearer === svc) || (secret !== "" && given === secret);
  if (!authorised) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorised" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!url || !svc) {
    return new Response(JSON.stringify({ ok: false, error: "SUPABASE_URL / SERVICE_ROLE_KEY missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!saRaw) {
    // No credentials is a configuration state, not a delivery failure. Say so
    // and leave the queue untouched rather than burning attempts.
    return new Response(JSON.stringify({
      ok: false,
      error: "FCM_SERVICE_ACCOUNT is not set — no notifications were sent",
      claimed: 0, sent: 0, failed: 0,
    }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  let sa: { client_email: string; private_key: string; project_id: string };
  try {
    sa = JSON.parse(saRaw);
    if (!sa.client_email || !sa.private_key || !sa.project_id) throw new Error("missing fields");
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `FCM_SERVICE_ACCOUNT is not valid JSON: ${e}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const claimRes = await rpc(url, svc, "claim_notification_batch", { p_channel: "push", p_limit: limit });
  if (!claimRes.ok) {
    const text = await claimRes.text();
    return new Response(JSON.stringify({ ok: false, error: `claim failed: ${text.slice(0, 300)}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const rows = (await claimRes.json()) as OutboxRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, claimed: 0, sent: 0, failed: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let access: string;
  try {
    access = await fcmAccessToken(sa);
  } catch (e) {
    // Put every claimed row back; this is our fault, not the device's.
    await Promise.all(rows.map(r =>
      rpc(url, svc, "settle_notification", { p_id: r.id, p_ok: false, p_error: String(e), p_drop_token: false })
    ));
    return new Response(JSON.stringify({ ok: false, error: String(e), claimed: rows.length, sent: 0, failed: rows.length }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
        body: JSON.stringify({
          message: {
            token: row.destination,
            notification: { title: row.title ?? "Update", body: row.body },
            // FCM data values must be strings, so everything is stringified.
            data: Object.fromEntries(
              Object.entries(row.data ?? {}).map(([k, v]) => [k, String(v)]),
            ),
            android: { priority: "HIGH", notification: { channel_id: "dt_orders" } },
          },
        }),
      });
      const text = await res.text();
      if (res.ok) {
        sent++;
        await rpc(url, svc, "settle_notification", { p_id: row.id, p_ok: true });
      } else {
        failed++;
        await rpc(url, svc, "settle_notification", {
          p_id: row.id,
          p_ok: false,
          p_error: `fcm ${res.status}: ${text.slice(0, 300)}`,
          p_drop_token: isDeadToken(res.status, text),
        });
      }
    } catch (e) {
      failed++;
      await rpc(url, svc, "settle_notification", {
        p_id: row.id, p_ok: false, p_error: String(e), p_drop_token: false,
      });
    }
  }

  return new Response(JSON.stringify({ ok: failed === 0, claimed: rows.length, sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
