// ============================================================================
// v1.28.5 — telling a phone it is out of date
//
// Two shapes, because two situations are genuinely different:
//
//   optional  a bar the customer can dismiss. They are mid-order as often as
//             not, and interrupting a paying customer to advertise a release is
//             a bad trade.
//   required  a full-screen stop. Either the restaurant marked the release
//             required, or this build is below min_supported_version and no
//             longer works against the server — in which case letting them
//             carry on means letting them place an order that will fail.
//
// A dismissal is remembered per version, so the bar does not return on every
// screen; the next release brings it back. A required update is never
// dismissible, and offers no way past.
// ============================================================================
import { useEffect, useState } from 'react';
import { Download, X, ArrowUpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CustomerAppConfig } from '@/lib/customerAppConfig';
import { evaluateUpdate, type UpdateDecision } from '@/lib/appUpdate';
import { loadAppBuildInfo } from '@/lib/appBuildInfo';

const DISMISS_KEY = 'dt-update-dismissed';

function dismissedFor(version: string): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === version; } catch { return false; }
}
function rememberDismissal(version: string): void {
  try { localStorage.setItem(DISMISS_KEY, version); } catch { /* private mode */ }
}

export default function AppUpdateGate({ config }: { config: CustomerAppConfig | null }) {
  const [decision, setDecision] = useState<UpdateDecision | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const build = await loadAppBuildInfo();
      if (cancelled) return;
      const d = evaluateUpdate({ config, installed: build.appVersion });
      setDecision(d);
      if (d.state === 'optional' && d.latest) setDismissed(dismissedFor(d.latest));
    })().catch(() => { /* never let this break the page it sits on */ });
    return () => { cancelled = true; };
  }, [config]);

  if (!decision || decision.state === 'none') return null;
  if (decision.state === 'optional' && dismissed) return null;

  const open = () => {
    if (!decision.url) return;
    // A plain navigation: Android hands the .apk to the download manager, and
    // the customer installs it the same way they installed this one.
    try { window.open(decision.url, '_blank', 'noopener'); }
    catch { window.location.href = decision.url; }
  };

  // ------------------------------------------------------------- required
  if (decision.state === 'required') {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dt-update-title"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-sm p-6"
      >
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ArrowUpCircle className="h-7 w-7" />
          </div>
          <h2 id="dt-update-title" className="text-lg font-bold">Update required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This version of the app no longer works. Install the latest one to carry on ordering.
          </p>
          {decision.latest && (
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              {decision.installed ?? '—'} → {decision.latest}
            </p>
          )}

          {decision.url ? (
            <Button className="mt-5 w-full font-bold" onClick={open}>
              <Download className="mr-2 h-4 w-4" /> Download the update
            </Button>
          ) : (
            // update_required with no update_url is a misconfiguration, and it
            // would otherwise be a dead end with a button that does nothing.
            // Say what is true instead of pretending there is an action.
            <p className="mt-5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              Please contact the restaurant for the new version of the app.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- optional
  return (
    <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-2.5 text-sm">
      <ArrowUpCircle className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        A new version{decision.latest ? ` (${decision.latest})` : ''} is available.
      </span>
      {decision.url && (
        <Button size="sm" variant="outline" className="shrink-0 font-semibold" onClick={open}>
          Update
        </Button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={() => {
          if (decision.latest) rememberDismissal(decision.latest);
          setDismissed(true);
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
