// ============================================================
// Print Speed Test Panel — Phase-2
// Shows last N print jobs with timings: enqueue, render, command,
// done — plus a "Run Speed Test" button that fires a sample KOT
// through the local queue end-to-end.
// ============================================================
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, Zap, RotateCw } from 'lucide-react';
import {
  getPrintQueue,
  onPrintQueueChange,
  enqueueKot,
  retryJob,
  type PrintJob,
} from '@/lib/printQueue';
import { getOrders } from '@/lib/store';
import { toast } from 'sonner';

function ms(a?: string, b?: string): string {
  if (!a || !b) return '—';
  const diff = new Date(b).getTime() - new Date(a).getTime();
  if (isNaN(diff)) return '—';
  return `${diff} ms`;
}

function statusColor(s: PrintJob['status']) {
  if (s === 'printed') return 'text-green-600';
  if (s === 'failed') return 'text-red-600';
  if (s === 'printing') return 'text-amber-600';
  return 'text-blue-600';
}

function reasonLabel(r?: PrintJob['errorReason']): string {
  if (r === 'no-printer') return 'No printer selected';
  if (r === 'offline') return 'Printer offline / unreachable';
  if (r === 'render-failed') return 'Render failed';
  return 'Unknown error';
}

export default function PrintSpeedTestPanel() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);

  useEffect(() => {
    const refresh = () => setJobs(getPrintQueue().slice(-15).reverse());
    refresh();
    return onPrintQueueChange(refresh);
  }, []);

  function runSpeedTest() {
    const lastOrder = getOrders().slice().sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
    if (!lastOrder) {
      toast.error('No order found. Create an order first.');
      return;
    }
    const job = enqueueKot(lastOrder, { force: true });
    if (job) toast.success('Speed test KOT queued — timings neeche dikhengi');
    else toast.error('KOT enqueue fail');
  }

  const avgDuration = (() => {
    const done = jobs.filter(j => j.status === 'printed' && j.durationMs);
    if (!done.length) return null;
    return Math.round(done.reduce((s, j) => s + (j.durationMs || 0), 0) / done.length);
  })();

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" /> Print Speed Test
        </h3>
        <div className="flex items-center gap-2">
          {avgDuration !== null && (
            <span className="text-xs text-muted-foreground">
              avg: <b className={avgDuration < 1500 ? 'text-green-600' : 'text-amber-600'}>{avgDuration} ms</b>
            </span>
          )}
          <Button size="sm" onClick={runSpeedTest}>
            <Zap className="h-4 w-4 mr-1" /> Run Test
          </Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No print jobs yet. Press "Run Test", or send a KOT from the POS.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Order</th>
                <th className="py-1 pr-2">Printer</th>
                <th className="py-1 pr-2">Enqueue→Render</th>
                <th className="py-1 pr-2">Render→Cmd</th>
                <th className="py-1 pr-2">Total</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 font-mono uppercase">{j.printType}</td>
                  <td className="py-1.5 pr-2">#{j.orderNumber ?? '—'}</td>
                  <td className="py-1.5 pr-2 truncate max-w-[140px]">{j.printerId || '—'}</td>
                  <td className="py-1.5 pr-2">{ms(j.createdAt, j.renderStartedAt)}</td>
                  <td className="py-1.5 pr-2">{ms(j.renderStartedAt, j.printCommandAt)}</td>
                  <td className="py-1.5 pr-2 font-semibold">
                    {j.durationMs != null ? `${j.durationMs} ms` : '—'}
                  </td>
                  <td className={`py-1.5 pr-2 font-semibold ${statusColor(j.status)}`}>
                    {j.status}
                    {j.status === 'failed' && (
                      <div className="text-[10px] text-red-500 font-normal">
                        {reasonLabel(j.errorReason)}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {j.status === 'failed' && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                        onClick={() => { retryJob(j.id); toast.success('Retry queued'); }}>
                        <RotateCw className="h-3 w-3 mr-1" /> Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-3">
        🎯 Target: KOT enqueue → command <b>&lt;1000ms</b>. If it is higher, the printer may be offline or the driver slow.
      </p>
    </Card>
  );
}
