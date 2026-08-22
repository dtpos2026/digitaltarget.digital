// v1.8.0 — SyncPendingChip now reads the canonical deferredSync path.
//
// Before: this chip pulled counts from src/lib/syncWorker.ts — the legacy
// worker that no live code path produces items for. It always showed
// pending: 0, no matter how many bills were actually queued for cloud.
// On an international-facing SaaS that is unacceptable: the operator
// sees "Synced" and shuts the machine off with real revenue still local.
//
// Now the chip subscribes to the SAME source of truth as the header
// BillingStatusBar — `onSyncStatus` from store.ts, which in v1.8.0
// includes deferred-queue depth. Clicking the chip triggers a real
// flush (respects online/manual mode), replacing the no-op runSyncOnce.
import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, Printer, CheckCircle2 } from 'lucide-react';
import { onSyncStatus } from '@/lib/store';
import { flushDeferredOps, isFlushing } from '@/lib/deferredSync';
import { localDb } from '@/lib/localDb';
import { cn } from '@/lib/utils';

export default function SyncPendingChip() {
  const [snap, setSnap] = useState<{ online: boolean; pending: number; lastError?: string }>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: 0,
  });
  const [flushing, setFlushing] = useState<boolean>(isFlushing());
  const [pendingPrints, setPendingPrints] = useState(0);

  useEffect(() => onSyncStatus(setSnap), []);

  useEffect(() => {
    // Print queue + flushing state refresh — kept 5s (independent of sync).
    const t = setInterval(async () => {
      try { setPendingPrints((await localDb.readPrintQueue()).length); } catch { /* ignore */ }
      setFlushing(isFlushing());
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const { online, pending } = snap;
  const label = !online
    ? 'Offline'
    : flushing
      ? 'Syncing…'
      : pending > 0
        ? `Pending ${pending}`
        : 'Synced';
  const Icon = !online ? WifiOff : flushing ? RefreshCw : pending > 0 ? RefreshCw : CheckCircle2;

  return (
    <button
      onClick={async () => {
        // Real flush — no-ops offline (correctly), reports true result online.
        try { await flushDeferredOps(); } catch { /* handled internally */ }
      }}
      title={`Network: ${online ? 'online' : 'offline'} · pending sync: ${pending} · pending prints: ${pendingPrints}`}
      className={cn(
        'hidden sm:inline-flex items-center justify-center gap-1 h-6 px-2.5 rounded-full text-[10px] font-semibold leading-none whitespace-nowrap border transition-colors',
        !online ? 'bg-red-500/15 text-red-600 border-red-500/40' :
        flushing ? 'bg-blue-500/15 text-blue-600 border-blue-500/40' :
        pending > 0 ? 'bg-amber-500/15 text-amber-700 border-amber-500/40' :
                      'bg-green-500/15 text-green-700 border-green-500/40',
      )}
    >
      <Icon className={cn('h-3 w-3', flushing && 'animate-spin')} />
      {label}
      {pendingPrints > 0 && (
        <span className="ml-1 inline-flex items-center gap-0.5 text-purple-700">
          <Printer className="h-3 w-3" /> {pendingPrints}
        </span>
      )}
    </button>
  );
}
