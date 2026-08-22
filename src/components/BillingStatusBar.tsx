// ============================================================
// Billing Status Bar — Phase-3
// Thin floating pill (top-right of POS screen) showing:
//   Cloud sync · Print Mode · Printer Status
// Plus a one-time warning for Browser Print Mode.
// ============================================================
import { useEffect, useState } from 'react';
import { Cloud, CloudOff, Loader2, Printer, Server, Globe, AlertTriangle, X } from 'lucide-react';
import { onSyncStatus } from '@/lib/store';
import { isElectron } from '@/lib/electron';
import { APP_NAME, APP_VERSION, getInstalledVersion } from '@/lib/version';
import {
  isPrintServerEnabled,
  subscribePrinterSettings,
  resolvePrinterForRole,
  type PrinterSettingsDoc,
} from '@/lib/printerSettings';
import { getDeviceId } from '@/lib/tenant';
import {
  getSyncMode, setSyncMode, deferredPendingCount, flushDeferredOps,
  isFlushing, onDeferredSyncChange, type SyncMode,
} from '@/lib/deferredSync';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const WARNING_DISMISSED_KEY = 'dtpos-browser-warning-dismissed';

export default function BillingStatusBar() {
  const [sync, setSync] = useState<{ online: boolean; pending: number; lastError?: string }>({ online: true, pending: 0 });
  const [settings, setSettings] = useState<PrinterSettingsDoc>({ printers: [], deviceAssignments: {} });
  const [, force] = useState(0);
  const [appVer, setAppVer] = useState(APP_VERSION);
  useEffect(() => { getInstalledVersion().then(setAppVer).catch(() => {}); }, []);
  const [warningDismissed, setWarningDismissed] = useState<boolean>(
    () => { try { return localStorage.getItem(WARNING_DISMISSED_KEY) === '1'; } catch { return false; } }
  );

  useEffect(() => onSyncStatus(setSync), []);
  // v1.5.4 — deferred sync (offline billing / manual mode)
  const [syncMode, setSyncModeState] = useState<SyncMode>(getSyncMode());
  const [deferred, setDeferred] = useState(deferredPendingCount());
  const [flushing, setFlushing] = useState(false);
  useEffect(() => onDeferredSyncChange(() => {
    setSyncModeState(getSyncMode());
    setDeferred(deferredPendingCount());
    setFlushing(isFlushing());
  }), []);
  const toggleMode = () => {
    const next: SyncMode = getSyncMode() === 'auto' ? 'manual' : 'auto';
    setSyncMode(next);
    toast.info(next === 'manual'
      ? 'Manual sync ON — data only goes to the cloud when you press "Sync Now"'
      : 'Auto sync ON — data goes to the cloud by itself while online');
    if (next === 'auto') void flushDeferredOps();
  };
  const syncNow = async () => {
    const r = await flushDeferredOps();
    if (r.skipped && deferredPendingCount() > 0) toast.error('No internet — try again once you are back online');
    else if (r.flushed > 0) toast.success(`${r.flushed} items cloud par sync ho gaye${r.remaining ? ` · ${r.remaining} baqi` : ''}`);
    else toast.info('Everything is already synced');
  };
  useEffect(() => subscribePrinterSettings(setSettings), []);
  useEffect(() => {
    const h = () => force(x => x + 1);
    window.addEventListener('dtpos-print-server-changed', h);
    return () => window.removeEventListener('dtpos-print-server-changed', h);
  }, []);

  const electron = isElectron();
  const silent = electron && isPrintServerEnabled();
  const counter = resolvePrinterForRole(settings, 'counter', getDeviceId());
  const kitchen = resolvePrinterForRole(settings, 'kitchen', getDeviceId());
  const printerReady = !!(counter && counter.printerName) && !!kitchen;

  // Sync pill
  let syncPill: { Icon: any; label: string; cls: string };
  if (!sync.online) syncPill = { Icon: CloudOff, label: 'Offline', cls: 'text-amber-700 bg-amber-50 border-amber-200' };
  else if (sync.pending > 0) syncPill = { Icon: Loader2, label: `Syncing (${sync.pending})`, cls: 'text-blue-700 bg-blue-50 border-blue-200' };
  else syncPill = { Icon: Cloud, label: 'Online', cls: 'text-green-700 bg-green-50 border-green-200' };

  // Print mode pill
  const modePill = silent
    ? { Icon: Server, label: 'Silent', cls: 'text-green-700 bg-green-50 border-green-200' }
    : electron
      ? { Icon: Printer, label: 'Manual', cls: 'text-blue-700 bg-blue-50 border-blue-200' }
      : { Icon: Globe, label: 'Browser', cls: 'text-amber-700 bg-amber-50 border-amber-200' };

  // Printer status pill
  const printerPill = printerReady
    ? { Icon: Printer, label: 'Ready', cls: 'text-green-700 bg-green-50 border-green-200' }
    : { Icon: Printer, label: 'Check Setup', cls: 'text-amber-700 bg-amber-50 border-amber-200' };

  function dismissWarning() {
    try { localStorage.setItem(WARNING_DISMISSED_KEY, '1'); } catch {}
    setWarningDismissed(true);
  }

  const showWarning = !electron && !warningDismissed;

  return (
    <>
      {/* Status pill row — inline next to header bell, no longer hidden behind cart */}
      <div className="flex items-center gap-1.5">
        <Pill {...syncPill} title="Cloud Sync" />
        {/* v1.5.4 — sync mode toggle + manual Sync Now */}
        <button
          onClick={toggleMode}
          title={syncMode === 'auto' ? 'Auto sync ON — click for Manual' : 'Manual sync ON — click for Auto'}
          className={`${PILL_BASE} transition-colors ${
            syncMode === 'auto'
              ? 'text-green-700 bg-green-50 border-green-200'
              : 'text-purple-700 bg-purple-50 border-purple-200'
          }`}
        >
          {syncMode === 'auto' ? '🔄 Auto' : '✋ Manual'}
        </button>
        {(syncMode === 'manual' || deferred > 0) && (
          <button
            onClick={syncNow}
            disabled={flushing}
            title="Send pending data to the cloud now"
            className={`${PILL_BASE} text-blue-700 bg-blue-50 border-blue-300 hover:bg-blue-100 disabled:opacity-50 transition-colors`}
          >
            <RefreshCw className={`h-3 w-3 ${flushing ? 'animate-spin' : ''}`} />
            Sync Now{deferred > 0 ? ` (${deferred})` : ''}
          </button>
        )}
        <Pill {...modePill} title="Print Mode" />
        <Pill {...printerPill} title="Printer Status" />
        <span
          title="App version"
          className={`${PILL_BASE} text-slate-700 bg-slate-50 border-slate-200`}
        >
          {APP_NAME} v{appVer}
        </span>
      </div>

      {/* Browser-mode warning banner */}
      {showWarning && (
        <div className="fixed top-14 right-2 z-40 max-w-xs bg-amber-50 border border-amber-300 rounded-lg shadow-lg p-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-amber-900">Browser Print Mode</div>
              <div className="text-amber-800 mt-1">
                For best performance use the <b>DT POS Desktop App</b> — silent printing, no dialogs.
              </div>
            </div>
            <button
              onClick={dismissWarning}
              className="text-amber-600 hover:text-amber-900"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One shared shape for every header chip: same height, same padding, same
 * type size, never wrapping. Mixed sizes made the header look untidy and let
 * "Check Setup" break onto a second line.
 */
export const PILL_BASE =
  'inline-flex items-center justify-center gap-1 h-6 px-2.5 rounded-full border ' +
  'text-[10px] font-semibold leading-none whitespace-nowrap';

function Pill({ Icon, label, cls, title }: { Icon: any; label: string; cls: string; title: string }) {
  const spin = label.startsWith('Syncing');
  return (
    <span
      title={title}
      className={`${PILL_BASE} ${cls}`}
      style={{ pointerEvents: 'auto' }}
    >
      <Icon className={`h-3 w-3 ${spin ? 'animate-spin' : ''}`} />
      {label}
    </span>
  );
}
