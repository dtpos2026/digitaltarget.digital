// The app signs in through its OWN Supabase client (src/lib/supabase.ts, storage
// key `dtpos-auth`), not the generated integration client. The generated
// attacher therefore found no session and every protected server function came
// back "Unauthorized: No authorization header provided" — which is why owner
// accounts were never created for a new restaurant.
//
// This middleware reads the token from the app's client (falling back to the
// generated one) so the bearer is always attached. It asks the client for the
// session rather than trusting the module-level cache, because that cache goes
// stale after a token refresh or a reload of the panel and produced the same
// "No authorization header" warning intermittently.
import { createMiddleware } from '@tanstack/react-start';

const EXPIRY_SKEW_SECONDS = 60;

function fresh(session: { access_token?: string; expires_at?: number } | null | undefined) {
  if (!session?.access_token) return undefined;
  const exp = session.expires_at;
  if (exp && exp * 1000 - Date.now() < EXPIRY_SKEW_SECONDS * 1000) return undefined;
  return session.access_token;
}

async function appToken(): Promise<string | undefined> {
  const { sb, accessToken } = await import('./supabase');
  const client = sb();
  const { data } = await client.auth.getSession();
  let token = fresh(data.session);
  if (!token) {
    // Session present but expiring/expired — force a refresh instead of
    // sending a token the server will reject.
    const refreshed = await client.auth.refreshSession();
    token = fresh(refreshed.data.session);
  }
  return token ?? accessToken() ?? undefined;
}

async function generatedToken(): Promise<string | undefined> {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data } = await supabase.auth.getSession();
  return fresh(data.session) ?? data.session?.access_token ?? undefined;
}

export const attachAppSupabaseAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    let token: string | undefined;
    try {
      token = await appToken();
    } catch {
      /* app client unavailable — fall through to the generated client */
    }
    if (!token) {
      try {
        token = await generatedToken();
      } catch {
        /* no session at all */
      }
    }
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
