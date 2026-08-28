// ============================================================================
// v1.28.6 — the build that shipped without its own backend
//
// REPORTED, on a fresh Windows install: the app opens, asks for a username and
// password, and answers every correct credential with
//
//     This device is not linked to a restaurant yet.
//     Sign in with the owner email first.
//
// with no owner-email screen anywhere to be found.
//
// It is a dead end by construction, and both halves of it are true at once:
//
//   isCloudConfigured()   reads VITE_SUPABASE_URL / _PUBLISHABLE_KEY, which
//                         Vite substitutes AT BUILD TIME. False when the build
//                         did not carry them.
//   usingSupabaseAuth()   hard-returns true since v1.25.3 — Firebase is gone,
//                         there is exactly one backend.
//
// App.tsx gates the Stage-1 owner email screen on cloudMode, so a build with no
// configuration skips it and lands on the staff screen; the staff screen then
// takes the Supabase path, needs a tenant, and can never get one because there
// is no backend to sign into. The instruction it prints names a screen the same
// defect has just hidden.
//
// How a build loses its configuration: .env is committed on purpose (see the
// comment at the top of it), but an EMPTY environment variable OVERRIDES a
// committed .env. CI that passes `VITE_SUPABASE_URL: ${{ secrets.… }}` for a
// secret that was never set passes an empty string, and strips the backend out
// of the bundle. That is what happened to the Windows installer.
//
// So this is not a state a user can fix by signing in differently, and offering
// them a login is a lie. It says what is wrong and who can fix it.
// ============================================================================
import { AlertTriangle } from 'lucide-react';

export default function MisconfiguredBuildScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#10002b] p-6 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-amber-400/30 bg-white/[0.04] p-8 backdrop-blur-xl">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">This copy of DT POS is missing its configuration</h1>
            <p className="mt-2 text-sm text-white/70">
              It was built without the address of the restaurant server, so it cannot
              sign anyone in — not the owner, and not a staff member. Nothing is wrong
              with your account or your password.
            </p>

            <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
                For whoever built this
              </p>
              <p className="mt-2 text-sm text-white/80">
                The bundle carries no <code className="text-amber-300">VITE_SUPABASE_URL</code> or{' '}
                <code className="text-amber-300">VITE_SUPABASE_PUBLISHABLE_KEY</code>.
                An <strong>empty</strong> environment variable overrides the committed{' '}
                <code>.env</code>, so a CI job that passes a secret which was never set
                strips the backend out of the build. Set those secrets, or stop passing
                them, and build again.
              </p>
            </div>

            <p className="mt-4 text-xs text-white/50">
              Reinstalling will not help. A new installer is needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
