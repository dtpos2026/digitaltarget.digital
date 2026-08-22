import { useEffect, useState } from 'react';
import { Download, RefreshCw, X, AlertTriangle, Sparkles } from 'lucide-react';
import { APP_VERSION } from '@/lib/version';
import {
  subscribeLatestRelease, isUpdateAvailable, isBelowMinimum,
  dismissReleaseLocally, wasDismissed, isReleaseForTenant, type SystemRelease,
} from '@/lib/releases';
import { isElectron, openExternal, downloadAndRunInstaller, onUpdateProgress } from '@/lib/electron';
import { onAuthUserChanged, authTenantId } from '@/lib/authProvider';
import { fbAuth } from '@/lib/firebase';
import { toast } from 'sonner';

export default function UpdateAvailableBanner() {
  const [release, setRelease] = useState<SystemRelease | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [myTenantId, setMyTenantId] = useState<string | null>(null);

  useEffect(() => {
    // Track current tenant (user uid). Update on auth change.
    // v1.18.0 — tenantId(), NOT uid(). Under Supabase they are different UUIDs.
    const unsub = onAuthUserChanged(() => setMyTenantId(authTenantId()));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeLatestRelease((r) => {
      setRelease(r);
      if (r) setDismissed(wasDismissed(r.version));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isElectron()) return;
    const off = onUpdateProgress?.((pct: number) => setProgress(pct));
    return () => { try { off && off(); } catch {} };
  }, []);

  if (!release) return null;

  // Filter: if release targets specific tenants, only show to those.
  if (!isReleaseForTenant(release, myTenantId)) return null;

  const available = isUpdateAvailable(APP_VERSION, release.version);
  if (!available) return null;



  const force = !!release.forceUpdate || isBelowMinimum(APP_VERSION, release.minimumSupportedVersion);
  if (dismissed && !force) return null;

  const electron = isElectron();

  const handleDismiss = () => {
    dismissReleaseLocally(release.version);
    setDismissed(true);
  };

  const handleWebRefresh = () => {
    try { (window as any).location.reload(true); } catch { window.location.reload(); }
  };

  const handleDesktopUpdate = async () => {
    if (!release.desktopUpdateUrl) {
      toast.error('Desktop update URL not set by admin');
      return;
    }
    if (!electron) { openExternal(release.desktopUpdateUrl); return; }
    setDownloading(true);
    setProgress(0);
    try {
      const r = await downloadAndRunInstaller(release.desktopUpdateUrl);
      if (!r?.success) {
        toast.error(`Update failed: ${r?.error || 'unknown'}`);
        setDownloading(false);
        return;
      }
      toast.success('Installer downloaded — app will restart');
      // main process will quit after launching installer
    } catch (e: any) {
      toast.error(`Update failed: ${e?.message || e}`);
      setDownloading(false);
    }
  };

  // ===== FORCE UPDATE — blocking modal =====
  if (force) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-card border-2 border-red-500/60 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-red-500/15 text-red-600 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold">Update Required</h3>
              <p className="text-xs text-muted-foreground">Version {release.version} — {release.title}</p>
            </div>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 text-[12px] leading-relaxed whitespace-pre-wrap max-h-56 overflow-auto">
            {release.notes || 'Please update to continue using DT POS.'}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Current: <span className="font-mono">v{APP_VERSION}</span> · Required: <span className="font-mono">v{release.minimumSupportedVersion || release.version}</span>
          </div>
          {electron ? (
            <button
              onClick={handleDesktopUpdate}
              disabled={downloading}
              className="w-full h-11 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-extrabold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {downloading ? `Downloading ${progress}%…` : 'Download & Restart to Install'}
            </button>
          ) : (
            <button
              onClick={handleWebRefresh}
              className="w-full h-11 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-extrabold flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />Refresh to Update
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===== Soft banner (top) =====
  return (
    <div className="bg-gradient-to-r from-primary/15 via-accent/10 to-primary/15 border-b border-primary/30">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3 text-[12px]">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-bold text-foreground truncate">
            New DT POS update available — v{release.version} {release.title ? `· ${release.title}` : ''}
          </div>
          {showNotes && release.notes && (
            <div className="mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap max-h-32 overflow-auto">
              {release.notes}
            </div>
          )}
          {release.notes && (
            <button onClick={() => setShowNotes(s => !s)} className="text-[10px] text-primary hover:underline mt-0.5">
              {showNotes ? 'Hide notes' : 'Release notes'}
            </button>
          )}
        </div>
        {electron ? (
          <button
            onClick={handleDesktopUpdate}
            disabled={downloading}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-bold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? `${progress}%` : 'Download & Restart'}
          </button>
        ) : (
          <button
            onClick={handleWebRefresh}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[11px] font-bold flex items-center gap-1.5 hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" />Refresh now
          </button>
        )}
        <button onClick={handleDismiss} className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground" title="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
