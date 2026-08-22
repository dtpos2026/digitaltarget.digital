import { useEffect, useState } from 'react';
import { APP_VERSION, cmpVersion, listenSystemConfig, type SystemConfig } from '@/lib/version';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Floating banner that watches systemConfig/latest. When server-side
 * minClientVersion > APP_VERSION, prompt user to reload (forced if
 * forceUpgrade=true). Clears caches before reload so the new bundle
 * is actually fetched.
 */
export default function VersionUpdateBanner() {
  const [cfg, setCfg] = useState<SystemConfig | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => listenSystemConfig(setCfg), []);

  const min = cfg?.minClientVersion || '';
  const outdated = !!min && cmpVersion(APP_VERSION, min) < 0;
  const force = !!cfg?.forceUpgrade;

  if (!outdated || (!force && dismissed)) return null;

  const reload = async () => {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    try { (window as any).location.reload(true); } catch { window.location.reload(); }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg">
      <div className="max-w-5xl mx-auto flex items-center gap-3 px-4 py-2 text-sm">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-bold">New version available</span>
          <span className="ml-2 opacity-90">
            v{cfg?.latestVersion || min} — you are on v{APP_VERSION}.{' '}
            {cfg?.message || 'Please reload to get the latest features and fixes.'}
          </span>
        </div>
        <button
          onClick={reload}
          className="inline-flex items-center gap-1 bg-white text-amber-700 font-bold px-3 py-1 rounded-md hover:bg-amber-50 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Reload now
        </button>
        {!force && (
          <button
            onClick={() => setDismissed(true)}
            className="text-white/80 hover:text-white text-xs px-2"
          >Later</button>
        )}
      </div>
    </div>
  );
}
