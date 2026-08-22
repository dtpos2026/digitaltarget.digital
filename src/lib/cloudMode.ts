// ============================================================================
// CLOUD MODE — v1.24.1
//
// "Is this installation backed by a cloud, or is it a single offline device?"
//
// This used to be answered by isFirebaseConfigured(). When Firebase was
// removed and its config emptied, that function began returning false forever
// — and cloudMode gates the owner login screen, the tenant guard, device
// registration, plan checks and eleven other things in App.tsx.
//
// The result was subtle and total: the app decided it was a standalone local
// till. The email/password screen never rendered, so there was no way to reach
// the Super Admin panel, while the POS user screen kept working normally.
// Nothing errored; the application simply became a different product.
//
// The question was never "is Firebase set up". It is "is a cloud backend set
// up" — and the answer must not be tied to one vendor.
// ============================================================================

/** True when this build carries Supabase configuration. */
export function isSupabaseConfiguredBuild(): boolean {
  const env = (import.meta as any).env ?? {};
  return !!env.VITE_SUPABASE_URL
    && !!(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY);
}

/**
 * True when ANY cloud backend is available.
 *
 * Deliberately not `isFirebaseConfigured() || isSupabaseConfiguredBuild()`:
 * Firebase is gone, and reintroducing the dependency here is what tied cloud
 * mode to a single vendor in the first place.
 */
export function isCloudConfigured(): boolean {
  return isSupabaseConfiguredBuild();
}
