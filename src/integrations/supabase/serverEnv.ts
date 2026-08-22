// ============================================================================
// SERVER ENVIRONMENT RESOLVER — v1.25.11
//
// ===== THE PROBLEM THIS SOLVES =====
// On Cloudflare Workers there is no `process.env`. Environment variables and
// secrets are delivered as **bindings** on the `env` object handed to the
// fetch handler. Node's `process.env` is a compatibility shim that Nitro's
// cloudflare_pages preset does NOT populate from dashboard secrets.
//
// So this happened, and it looked exactly like a mistake by the operator:
//
//   * SUPABASE_SERVICE_ROLE_KEY was correctly added in the Cloudflare
//     dashboard, as a Secret, in the Production environment.
//   * The project was rebuilt and redeployed.
//   * The server still reported "Missing server-side Supabase configuration",
//     because it only ever looked at process.env — which is empty there.
//
// Reading `env` from `cloudflare:workers` is the documented way to reach
// bindings from any module, without threading the request context through
// every caller. It needs compatibility_date >= 2024-09-23; this project pins
// 2026-06-01 (see scripts/build.mjs), so it is available.
//
// Local development still uses process.env, populated from .env.local.
// ============================================================================

/** Cached so the dynamic import happens at most once per isolate. */
let cloudflareEnv: Record<string, unknown> | null | undefined;

async function loadCloudflareEnv(): Promise<Record<string, unknown> | null> {
  if (cloudflareEnv !== undefined) return cloudflareEnv;
  try {
    // Virtual module, present only inside the Workers runtime. The variable
    // indirection keeps bundlers from trying to resolve it at build time for
    // Node targets, where it does not exist.
    const specifier = 'cloudflare:workers';
    const mod: any = await import(/* @vite-ignore */ specifier);
    cloudflareEnv = (mod?.env ?? null) as Record<string, unknown> | null;
  } catch {
    // Not running on Workers. Expected in dev and in tests.
    cloudflareEnv = null;
  }
  return cloudflareEnv;
}

/**
 * Read a server-side variable from wherever this runtime keeps it.
 *
 * Order matters: process.env first so a local .env.local override always wins
 * during development, then the Cloudflare binding, then globalThis for any
 * runtime that attaches values there.
 *
 * NEVER pass a name with a VITE_ prefix. Those are inlined into the browser
 * bundle at build time; a secret read through this function must not be one of
 * them.
 */
export async function serverEnv(...names: string[]): Promise<string | undefined> {
  for (const name of names) {
    const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
    if (fromProcess) return fromProcess;
  }

  const cf = await loadCloudflareEnv();
  if (cf) {
    for (const name of names) {
      const value = cf[name];
      if (typeof value === 'string' && value) return value;
    }
  }

  const g = globalThis as Record<string, any>;
  for (const name of names) {
    const value = g[name] ?? g.__env__?.[name];
    if (typeof value === 'string' && value) return value;
  }

  return undefined;
}

/** Which sources actually answered — for diagnosing a missing variable. */
export async function describeEnvSources(): Promise<string> {
  const hasProcess = typeof process !== 'undefined' && !!process.env;
  const cf = await loadCloudflareEnv();
  return `process.env=${hasProcess ? 'present' : 'absent'}, `
    + `cloudflare:workers env=${cf ? 'present' : 'absent'}`;
}
