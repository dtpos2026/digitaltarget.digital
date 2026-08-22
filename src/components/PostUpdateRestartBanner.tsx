import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Power } from 'lucide-react';
import { APP_VERSION } from '@/lib/version';

/**
 * Post-update lifecycle helper.
 *
 *  - On every boot, compare APP_VERSION with the version that was running on
 *    the *last* boot (stored in localStorage as `pos-last-installed-version`).
 *  - If different, the build has been freshly updated → clear all browser
 *    caches once, mark a "needs restart" flag, then continue.
 *  - The "needs restart" flag stays until the user actually restarts the
 *    PC/laptop. We detect a real restart by checking whether the browser
 *    sessionStorage still holds the marker set when the flag was created —
 *    sessionStorage dies on full process restart, so its absence on next
 *    boot proves the app was relaunched.
 */
const LAST_VERSION_KEY = 'pos-last-installed-version';
const NEEDS_RESTART_KEY = 'pos-needs-restart';
const SESSION_GUARD_KEY = 'pos-restart-session-guard';

async function clearAllBrowserCaches() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistrations();
    reg?.forEach(r => r.unregister().catch(() => {}));
  } catch {}
}

export default function PostUpdateRestartBanner() {
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prev = localStorage.getItem(LAST_VERSION_KEY);
        if (prev && prev !== APP_VERSION) {
          // Fresh update detected — wipe stale bundle/asset caches once.
          await clearAllBrowserCaches();
          localStorage.setItem(NEEDS_RESTART_KEY, '1');
          sessionStorage.setItem(SESSION_GUARD_KEY, '1');
        }
        // Always update last-seen version
        localStorage.setItem(LAST_VERSION_KEY, APP_VERSION);

        // Decide whether to show restart banner.
        if (localStorage.getItem(NEEDS_RESTART_KEY) === '1') {
          const stillSameSession = sessionStorage.getItem(SESSION_GUARD_KEY) === '1';
          if (stillSameSession) {
            if (!cancelled) setNeedsRestart(true);
          } else {
            // sessionStorage was wiped → process restarted → clear flag.
            localStorage.removeItem(NEEDS_RESTART_KEY);
          }
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  if (!needsRestart) return null;

  const reload = () => { try { window.location.reload(); } catch {} };

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-red-600 to-orange-600 text-white shadow-lg">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-bold">Software updated to v{APP_VERSION}.</span>
          <span className="ml-2 opacity-95">
            For better performance, <b>restart your PC or laptop</b>.
            This message stays here until you restart.
          </span>
        </div>
        <button
          onClick={reload}
          className="inline-flex items-center gap-1 bg-white/15 hover:bg-white/25 font-bold px-3 py-1 rounded-md text-xs"
          title="Just refresh the app"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <span
          className="inline-flex items-center gap-1 bg-white text-red-700 font-bold px-3 py-1 rounded-md text-xs"
        >
          <Power className="h-3.5 w-3.5" /> Restart required
        </span>
      </div>
    </div>
  );
}
