// The top bar's sync chip (design SW-02: a green pill, "Synced 12 s ago"). One chip instead of the three the bar used to carry
// (pending-sync, restaurant identity, connection badge): the words say what is true — offline, syncing, waiting, needs attention,
// or how long ago the cloud was last heard from. Click it to flush the queue now.
import { useEffect, useState } from 'react';
import { CheckCircle2, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { onSyncStatus } from '@/lib/store';
import { flushDeferredOps, isFlushing } from '@/lib/deferredSync';
import { lastSyncedAt, onSyncedAt, syncChipState } from '@/lib/syncClock';
import { cn } from '@/lib/utils';

const TONE = {
  ok: 'bg-[hsl(var(--dt-ok-bg))] text-[hsl(var(--dt-ok))]',
  warn: 'bg-[hsl(var(--dt-warn-bg))] text-[hsl(var(--dt-warn))]',
  bad: 'bg-[hsl(var(--dt-bad-bg))] text-[hsl(var(--dt-bad))]',
  busy: 'bg-[hsl(var(--dt-info-bg))] text-[hsl(var(--dt-info))]',
} as const;

export default function RefinedSyncChip() {
  const [snap, setSnap] = useState<{ online: boolean; pending: number; lastError?: string }>({ online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0 });
  const [flushing, setFlushing] = useState<boolean>(isFlushing());
  const [last, setLast] = useState<number>(lastSyncedAt());
  const [, tick] = useState(0);

  useEffect(() => onSyncStatus(setSnap), []);
  useEffect(() => onSyncedAt(() => setLast(lastSyncedAt())), []);
  // "12 s ago" has to keep counting even when nothing else changes.
  useEffect(() => {
    const t = setInterval(() => { setFlushing(isFlushing()); tick(n => n + 1); }, 5000);
    return () => clearInterval(t);
  }, []);

  const st = syncChipState({ ...snap, flushing }, last);
  const Icon = st.tone === 'bad' ? CloudOff : st.tone === 'busy' ? RefreshCw : st.tone === 'warn' ? TriangleAlert : CheckCircle2;
  return (
    <button
      type="button"
      data-testid="refined-sync-chip"
      data-sync-tone={st.tone}
      onClick={async () => { try { await flushDeferredOps(); } catch { /* handled inside */ } }}
      title="Click to sync now"
      className={cn('hidden h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-bold leading-none transition-colors sm:inline-flex', TONE[st.tone])}
    >
      <Icon className={cn('h-3.5 w-3.5', st.tone === 'busy' && 'animate-spin')} aria-hidden />
      {st.label}
    </button>
  );
}
