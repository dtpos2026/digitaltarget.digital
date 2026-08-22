// Print Queue — pending/failed local print jobs with retry + clear.
// Part of the Printing Center module (single hub for all printing).
import { useEffect, useState } from 'react';
import { localDb } from '@/lib/localDb';
import { printReceiptNative } from '@/lib/electron';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RefreshCw, Trash2, Printer } from 'lucide-react';
import { toast } from 'sonner';

export default function PrintQueueCard() {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => setRows(await localDb.readPrintQueue());
  useEffect(() => { load(); }, []);

  const retryOne = async (row: any) => {
    setBusy(true);
    try {
      if (row.html) {
        const w = window.open('', '_blank', 'width=380,height=600');
        if (w) { w.document.write(row.html); w.document.close(); w.focus(); w.print(); w.close(); }
      }
      const r = await printReceiptNative({ printerName: row.printerName, silent: true });
      if (r.success) {
        await localDb.removePrintIds([row.id]);
        toast.success('Printed');
        await load();
      } else {
        toast.error(r.error || 'Print failed');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Print failed');
    } finally { setBusy(false); }
  };

  const retryAll = async () => { for (const r of rows) await retryOne(r); };
  const clearAll = async () => {
    if (!confirm('Clear all pending print jobs?')) return;
    await localDb.removePrintIds(rows.map((r) => r.id));
    await load();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold flex items-center gap-2"><Printer className="h-4 w-4" /> Pending Print Jobs</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          <Button size="sm" variant="outline" onClick={retryAll} disabled={busy || rows.length === 0}>Retry all</Button>
          <Button size="sm" variant="destructive" onClick={clearAll} disabled={rows.length === 0}><Trash2 className="h-4 w-4 mr-1" /> Clear</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed rounded p-8 text-center">
          No pending print jobs. Everything has printed.
        </div>
      ) : (
        <div className="border rounded divide-y">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-3 gap-2">
              <div className="text-sm min-w-0">
                <div className="font-semibold uppercase truncate">{r.kind} · Order {r.orderId || '—'}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {new Date(r.at).toLocaleString()} · attempts: {r.attempts || 0}{r.printerName ? ' · ' + r.printerName : ''}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => retryOne(r)} disabled={busy}>Retry</Button>
                <Button size="sm" variant="destructive" onClick={async () => { await localDb.removePrintIds([r.id]); await load(); }}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
