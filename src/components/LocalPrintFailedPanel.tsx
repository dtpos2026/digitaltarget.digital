// ============================================================
// Local Failed Jobs Panel — shows device-local failed prints
// (separate from cloud queue). Auto-retry already happens 3x in
// the queue processor; this panel surfaces jobs that exhausted
// retries so the user can fix the printer and retry manually.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, RotateCw, Trash2, WifiOff } from 'lucide-react';
import {
  getPrintQueue,
  onPrintQueueChange,
  retryJob,
  retryAllFailed,
  clearPrintedJobs,
  type PrintJob,
} from '@/lib/printQueue';
import { getSettings } from '@/lib/store';
import { toast } from 'sonner';

function reasonLabel(r?: PrintJob['errorReason']): string {
  if (r === 'no-printer') return 'No printer assigned — select one in Settings';
  if (r === 'offline') return 'Check the printer connection';
  if (r === 'render-failed') return 'Receipt formatting problem — please try again';
  return 'Retry required';
}

export default function LocalPrintFailedPanel() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);

  useEffect(() => {
    const refresh = () => setJobs(getPrintQueue().filter(j => j.status === 'failed'));
    refresh();
    return onPrintQueueChange(refresh);
  }, []);

  const offlineAlertOn = getSettings().offlinePrinterAlert !== false;
  const offlineJobs = jobs.filter(j => j.errorReason === 'offline');

  return (
    <Card className="p-4">
      {offlineAlertOn && offlineJobs.length > 0 && (
        <div className="mb-3 flex items-start gap-3 rounded-lg border-2 border-red-300 bg-red-50 p-3">
          <WifiOff className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-red-700">Printer Offline — {offlineJobs.length} job(s) held</div>
            <div className="text-xs text-red-600 mt-0.5">
              Check the printer connection (USB / network / power). Once it is fixed, press "Retry All" .
            </div>
          </div>
          <Button size="sm" variant="destructive" onClick={() => { retryAllFailed(); toast.success('Retrying held jobs'); }}>
            <RotateCw className="h-4 w-4 mr-1" /> Retry All
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-600" />
          Pending Print Jobs ({jobs.length})
        </h3>
        <div className="flex gap-2">
          {jobs.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => { retryAllFailed(); toast.success('All jobs requeued'); }}>
              <RotateCw className="h-4 w-4 mr-1" /> Retry All
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => { clearPrintedJobs(); toast.success('History cleared'); }}>
            <Trash2 className="h-4 w-4 mr-1" /> Clear History
          </Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          ✓ All prints complete. No pending jobs.
        </p>
      ) : (
        <div className="space-y-2">
          {jobs.map(j => (
            <div key={j.id} className="flex items-center justify-between border border-amber-200 bg-amber-50/30 rounded p-2 text-sm">
              <div className="flex-1">
                <div className="font-semibold uppercase">
                  {j.printType} · #{j.orderNumber ?? '—'}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Retry Required ({j.retryCount}/3 attempts)
                  </span>
                </div>
                <div className="text-xs text-amber-700 mt-0.5">{reasonLabel(j.errorReason)}</div>
              </div>

              <Button size="sm" variant="outline" onClick={() => { retryJob(j.id); toast.success('Retry queued'); }}>
                <RotateCw className="h-4 w-4 mr-1" /> Retry
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
