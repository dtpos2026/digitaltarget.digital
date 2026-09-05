/**
 * apk-build — start a branded APK build for one restaurant, from Super Admin.
 *
 * WHY verify_jwt IS OFF (and why that is not a weakening)
 *
 * REPORTED from Super Admin: "Failed to send a request to the Edge Function".
 *
 * That is supabase-js's message for a fetch that never completed — not a
 * refusal from this code, which was never reached. With verify_jwt ON, the
 * gateway rejects the browser's CORS PREFLIGHT: an OPTIONS request carries no
 * Authorization header by definition, so it is answered 401, the browser
 * blocks the real request, and the button fails before a single line here runs.
 *
 * The gateway check is turned off and the SAME check is done below, where the
 * preflight can be answered first: the caller's own JWT is verified against
 * auth.getUser, then is_super_admin() is asked WITH THAT TOKEN. A caller with
 * no token gets 401 and a restaurant owner gets 403, exactly as before.
 *
 * WHY A FUNCTION AND NOT A FETCH FROM THE BROWSER
 *
 * Starting a GitHub Actions run needs a token with write access to the
 * repository. A token that reaches the browser is a token every Super Admin's
 * machine, every extension on it and every network in between has a copy of —
 * and it can push code, not merely build it. So the token lives here, where
 * only the platform can read it, and the browser gets a button instead.
 *
 *   POST /functions/v1/apk-build
 *   Authorization: Bearer <the caller's own Supabase access token>
 *   { "tenant_id": "<uuid>", "app_id": "com.digitaltarget.<slug>",
 *     "apps": "Customer" | "Rider" | "OrderTaker" | "all",
 *     "refresh_bundle": true }
 *
 * Required secrets:
 *   SUPABASE_URL                 (provided by the platform)
 *   SUPABASE_SERVICE_ROLE_KEY    (provided by the platform)
 *   GITHUB_APK_TOKEN             a fine-grained PAT with Actions: read+write
 *                                on dtpos2026/dtpos.apk, and nothing else
 * Optional:
 *   GITHUB_APK_REPO              default "dtpos2026/dtpos.apk"
 *   GITHUB_APK_REF               default "main"
 *
 * AUTHORISATION
 *
 * The caller's own JWT is verified against auth.getUser, then is_super_admin()
 * is asked with that identity. The service-role key is used ONLY to make that
 * check — never to act on the caller's behalf. A restaurant owner reaching this
 * endpoint gets 403, not a build.
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
const PACKAGE_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const APPS = ["all", "Customer", "Rider", "OrderTaker"];

Deno.serve(async (req) => {
  // Answered FIRST, before any auth. This is the request that was failing.
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const GH_TOKEN = Deno.env.get("GITHUB_APK_TOKEN") ?? "";
  const GH_REPO = Deno.env.get("GITHUB_APK_REPO") ?? "dtpos2026/dtpos.apk";
  const GH_REF = Deno.env.get("GITHUB_APK_REF") ?? "main";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "the function is not configured" }, 500);
  }
  // ---------------------------------------------------------------- who asks
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "not signed in" }, 401);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${jwt}`, apikey: SERVICE_KEY },
  });
  if (!userRes.ok) return json({ error: "not signed in" }, 401);
  const user = await userRes.json();
  if (!user?.id) return json({ error: "not signed in" }, 401);

  // is_super_admin() reads the caller's identity from the JWT it is given, so
  // it is asked WITH THE CALLER'S TOKEN. Asking with the service-role key would
  // answer for the service role and let anyone through.
  const adminRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_super_admin`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      apikey: SERVICE_KEY,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const isSuper = adminRes.ok && (await adminRes.json()) === true;
  if (!isSuper) return json({ error: "super admin only" }, 403);

  if (!GH_TOKEN) {
    // Said plainly, because this is the one failure an operator can fix, and a
    // generic 500 would send them looking at the wrong thing entirely.
    return json({
      error: "no_build_token",
      message:
        "APK builds are not set up yet. Add a GITHUB_APK_TOKEN secret to this " +
        "Supabase project: a fine-grained GitHub token with Actions read+write " +
        "on " + GH_REPO + ". Until then, run the workflow from GitHub directly.",
    }, 501);
  }


  // ------------------------------------------------------------- what to build
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const tenantId = String(body.tenant_id ?? "").trim();
  const appId = String(body.app_id ?? "").trim();
  const apps = String(body.apps ?? "Customer").trim();
  const refreshBundle = body.refresh_bundle === true;
  // v1.48.0 — the workflow has taken these since the version inputs were added,
  // and this function did not pass them, so every build a Super Admin started
  // from the panel shipped versionCode 1. Android refuses to install a build
  // whose versionCode is not HIGHER than the installed one, so the second APK
  // handed to a restaurant failed with INSTALL_FAILED_VERSION_DOWNGRADE and the
  // only way through was to uninstall — losing the staff member's session.
  const versionCode = String(body.version_code ?? "").trim();
  const appVersion = String(body.app_version ?? "").trim();

  if (tenantId && !UUID.test(tenantId)) return json({ error: "tenant_id is not a uuid" }, 400);
  if (appId && !PACKAGE_ID.test(appId)) return json({ error: "app_id is not a valid Android package id" }, 400);
  if (!APPS.includes(apps)) return json({ error: `apps must be one of ${APPS.join(", ")}` }, 400);
  if (versionCode && !/^[1-9][0-9]{0,8}$/.test(versionCode)) {
    return json({ error: "version_code must be a whole number, 1 or greater" }, 400);
  }
  if (appVersion && !/^[0-9]+(\.[0-9]+){0,3}$/.test(appVersion)) {
    return json({ error: "app_version must look like 1.2.3" }, 400);
  }

  // The staff apps are ONE build for every restaurant: the login decides which
  // one, so a tenant here would brand every rider's phone with whichever
  // restaurant happened to be selected when the build was started. That is
  // exactly what put "BUTT BBQ" on the DT Rider icon.
  if ((apps === "Rider" || apps === "OrderTaker") && tenantId) {
    return json({
      error: "staff_apps_are_shared",
      message:
        "DT Rider and DT Order Taker are one build for every restaurant — the " +
        "login decides which one. Build them without a restaurant selected.",
    }, 400);
  }

  // ------------------------------------------------------------------ dispatch
  const ghRes = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/build-apks.yml/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${GH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "dt-pos-apk-build",
      },
      body: JSON.stringify({
        ref: GH_REF,
        inputs: {
          apps,
          tenant_id: tenantId,
          app_id: appId,
          // GitHub's workflow_dispatch inputs are strings even when the
          // workflow declares them boolean.
          refresh_bundle: String(refreshBundle),
          version_code: versionCode,
          app_version: appVersion,
          release: "false",
        },
      }),
    },
  );

  if (!ghRes.ok) {
    const detail = await ghRes.text();
    // 404 here almost always means the token cannot see the repository rather
    // than that the repository is missing, and that is worth saying.
    const hint = ghRes.status === 404
      ? "The build token cannot reach " + GH_REPO + ". Check that it grants Actions read+write on that repository."
      : ghRes.status === 403
      ? "The build token was refused. It may have expired, or lack the Actions permission."
      : "";
    return json({ error: "github_refused", status: ghRes.status, hint, detail: detail.slice(0, 400) }, 502);
  }

  return json({
    ok: true,
    message: "Build started. The APK appears under Actions in a few minutes.",
    runs_url: `https://github.com/${GH_REPO}/actions/workflows/build-apks.yml`,
  });
});
