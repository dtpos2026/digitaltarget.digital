import { useEffect, useState } from 'react';
import { onSyncStatus } from '@/lib/store';
import { Cloud, CloudOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SyncStatusBadge({ className }: { className?: string }) {
  const [s, setS] = useState<{ online: boolean; pending: number; lastError?: string }>({ online: true, pending: 0 });
  useEffect(() => onSyncStatus(setS), []);

  if (s.online && s.pending === 0 && !s.lastError) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[10px] text-muted-foreground', className)} title="Cloud synced">
        <Cloud className="h-3 w-3 text-green-600" /> Synced
      </span>
    );
  }
  if (!s.online) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[10px] text-amber-600 font-medium', className)} title="Offline — saving locally, will sync when online">
        <CloudOff className="h-3 w-3" /> Offline
      </span>
    );
  }
  if (s.pending > 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[10px] text-blue-600', className)} title={`${s.pending} pending writes`}>
        <Loader2 className="h-3 w-3 animate-spin" /> Syncing ({s.pending})
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] text-destructive', className)} title={s.lastError}>
      <CloudOff className="h-3 w-3" /> Sync error
    </span>
  );
}
