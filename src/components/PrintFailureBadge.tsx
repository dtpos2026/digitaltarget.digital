// ============================================================
// PRINT FAILURE BADGE — non-blocking printer-trouble indicator.
//
// A dead printer must never stop billing, but it must not be silent
// either: the cashier needs to know a slip is owed and be able to get
// it out once the printer is back. This sits in the POS header, stays
// hidden while everything is fine, and turns into a one-click
// Retry / Reprint / Select printer panel when jobs are stuck.
// ============================================================
import { useEffect, useState } from 'react';
import { Printer, RotateCw, Settings2, X } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { toast } from 'sonner';
import {
  getPrintQueue, onPrintQueueChange, retryJob, retryAllFailed, clearAllPendingJobs,
  type PrintJob,
} from '@/lib/printQueue';

const MAX_RETRY = 3;

function label(job: PrintJob): string {
  const what = job.printType === 'kot' ? 'Kitchen slip'
    : job.printType === 'token' ? 'Token'
    : job.printType === 'rider' ? 'Rider slip'
    : 'Receipt';
  return `${what} · Bill #${job.orderNumber ?? '—'}`;
}

function why(job: PrintJob): string {
  switch (job.errorReason) {
    case 'no-printer': return 'No printer selected';
    case 'offline': return 'Printer not responding';
    case 'render-failed': return 'Slip could not be prepared';
    default: return job.error ? job.error.slice(0, 80) : 'Printer did not accept the job';
  }
}

export default function PrintFailureBadge() {
  const [stuck, setStuck] = useState<PrintJob[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const refresh = () => setStuck(getPrintQueue().filter(j => j.status === 'failed' && j.retryCount >= MAX_RETRY));
    refresh();
    const off = onPrintQueueChange(refresh);
    // Also react to the explicit "gave up" event so the badge appears at once.
    const onFail = () => refresh();
    window.addEventListener('dtpos-print-failed', onFail);
    return () => { off(); window.removeEventListener('dtpos-print-failed', onFail); };
  }, []);

  if (stuck.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Printing problem — bills are saved, slips are waiting"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold
                   text-destructive bg-destructive/10 border-destructive/40 hover:bg-destructive/20 transition-colors"
      >
        <Printer className="h-3 w-3" />
        {stuck.length} not printed
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-lg border bg-popover text-popover-foreground shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b bg-destructive/10 flex items-center gap-2">
              <Printer className="h-4 w-4 text-destructive shrink-0" />
              <div className="min-w-0">
                <div className="text-[12px] font-extrabold text-destructive">Bills saved — printing failed</div>
                <div className="text-[10px] text-muted-foreground">Nothing has been lost. Fix the printer, then retry.</div>
              </div>
              <button onClick={() => setOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-52 overflow-y-auto pos-scrollbar">
              {stuck.map(job => (
                <div key={job.id} className="px-3 py-2 border-b last:border-b-0 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold truncate">{label(job)}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {why(job)} · {job.printerId || 'Windows default'}
                    </div>
                  </div>
                  <button
                    onClick={() => { retryJob(job.id); toast.info(`Retrying ${label(job)}`); }}
                    className="shrink-0 h-6 px-2 rounded border text-[10px] font-bold hover:bg-accent"
                  >
                    Retry
                  </button>
                </div>
              ))}
            </div>

            <div className="p-2 flex gap-1.5 border-t bg-muted/30">
              <button
                onClick={() => { retryAllFailed(); toast.info('Retrying all held slips'); setOpen(false); }}
                className="flex-1 h-7 rounded border text-[10px] font-bold hover:bg-accent flex items-center justify-center gap-1"
              >
                <RotateCw className="h-3 w-3" /> Retry all
              </button>
              <button
                onClick={() => { setOpen(false); navigate('/printer-settings'); }}
                className="flex-1 h-7 rounded border text-[10px] font-bold hover:bg-accent flex items-center justify-center gap-1"
              >
                <Settings2 className="h-3 w-3" /> Select printer
              </button>
              <button
                onClick={() => {
                  const n = clearAllPendingJobs();
                  toast.success(`${n} held slip(s) discarded — the bills themselves are untouched`);
                  setOpen(false);
                }}
                title="Give up on these slips. The bills stay in the system and can be reprinted from Bill Reprint."
                className="h-7 px-2 rounded border text-[10px] font-bold text-muted-foreground hover:bg-accent"
              >
                Discard
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
