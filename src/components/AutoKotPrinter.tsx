// Global Print Host — mounted once in AppLayout & Order Taker portal.
// Processes the centralized print queue ONE job at a time so the browser
// never shows overlapping/duplicate print dialogs. Renders the correct
// hidden receipt (KOT or customer receipt) with autoPrint, then advances.
//
// Backward-compat: triggerAutoKot(orderId) still works — it now enqueues a
// KOT job through the centralized print queue.
import { useEffect, useRef, useState } from 'react';
import { getOrders, getSettings } from '@/lib/store';
import {
  getProcessableJobs,
  markPrinting,
  markPrintCommandSent,
  markPrinted,
  markFailed,
  onPrintQueueChange,
  enqueueKot,
  type PrintJob,
} from '@/lib/printQueue';
import { appendPrintLog } from '@/lib/printLog';
import { toast } from 'sonner';
import KitchenReceipt from '@/components/KitchenReceipt';
import ReceiptPreview from '@/components/ReceiptPreview';
import type { Order } from '@/lib/types';

interface ActiveRender {
  job: PrintJob;
  order: Order;
  copyIndex: number; // 0-based copy currently printing
}

const PRINT_BUFFER_MS = 500; // receipt dialog fallback buffer; KOT waits for native print callback

// ===== Cross-instance lock =====
// AppLayout aur OrderTakerPortal dono AutoKotPrinter mount karte hain.
// Agar dono ek hi waqt active hon to ek hi job pe race kar ke DOUBLE
// silent print kar dete hain. Lock se ensure hota hai ek waqt me sirf
// ek instance hi queue process kare.
const HOST_LOCK_KEY = 'dtpos-print-host-lock';
const HOST_ID = `host_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const HOST_LOCK_TTL = 8000; // ms; auto-expire to recover from crashed tabs
function acquireHostLock(): boolean {
  try {
    const raw = localStorage.getItem(HOST_LOCK_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.id === HOST_ID) {
        localStorage.setItem(HOST_LOCK_KEY, JSON.stringify({ id: HOST_ID, at: Date.now() }));
        return true;
      }
      if (typeof p?.at === 'number' && Date.now() - p.at < HOST_LOCK_TTL) return false;
    }
    localStorage.setItem(HOST_LOCK_KEY, JSON.stringify({ id: HOST_ID, at: Date.now() }));
    return true;
  } catch { return true; }
}
function releaseHostLock() {
  try {
    const raw = localStorage.getItem(HOST_LOCK_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p?.id === HOST_ID) localStorage.removeItem(HOST_LOCK_KEY);
  } catch {}
}

export default function AutoKotPrinter() {
  const [active, setActive] = useState<ActiveRender | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const advance = () => {
      busyRef.current = false;
      setActive(null);
      releaseHostLock();
      // process next job immediately
      setTimeout(processNext, 30);
    };

    const processNext = () => {
      if (cancelled || busyRef.current) return;
      if (!acquireHostLock()) return; // another instance is processing
      const jobs = getProcessableJobs();
      if (jobs.length === 0) { releaseHostLock(); return; }
      // Silent KOT Mode: hold all auto KOT jobs in queue (user must manually release)
      const silent = !!getSettings().kotSilentMode;
      // Silent mode holds AUTOMATIC KOTs only — a manual reprint always prints.
      const job = silent ? jobs.find(j => j.printType !== 'kot' || j.manual) : jobs[0];

      if (!job) {
        if (silent && jobs.some(j => j.printType === 'kot')) {
          try {
            appendPrintLog({
              printType: 'kitchen', stage: 'queue', status: 'skipped',
              error: 'Silent KOT Mode is ON — KOT job held in queue, release it manually',
            });
          } catch {}
        }
        releaseHostLock();
        return;
      }
      const order = getOrders().find(o => o.id === job.orderId);
      if (!order) {
        // order missing — mark printed to drop it from the queue
        markPrinted(job.id);
        releaseHostLock();
        setTimeout(processNext, 30);
        return;
      }
      busyRef.current = true;
      markPrinting(job.id);
      setActive({ job, order, copyIndex: 0 });
    };

    const unsub = onPrintQueueChange(() => {
      if (!busyRef.current) processNext();
    });
    // kick off in case there are pending jobs at mount
    const t = setTimeout(processNext, 50);
    const poll = setInterval(() => { if (!busyRef.current) processNext(); }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(poll);
      unsub();
    };
  }, []);

  // ===== Blank-Receipt Fix v1.2.3 =====
  // Receipts previously advanced (and UNMOUNTED the hidden receipt DOM) after a
  // blind 500ms timer. On busy/slow POS machines Electron had not rasterized the
  // page yet — the printer received an empty page => intermittent BLANK receipts.
  // Now BOTH receipt and KOT wait for the actual print completion callback.
  // A generous safety timeout (20s) still guarantees the queue can never stall.
  useEffect(() => {
    if (!active) return;
    // Stamp the moment print command is fired (first copy only)
    if (active.copyIndex === 0) {
      try { markPrintCommandSent(active.job.id); } catch {}
    }
    // Safety net: if the completion callback never fires (e.g. crashed print
    // dialog), advance after 20s so the queue keeps flowing.
    const safety = setTimeout(() => {
      const totalCopies = Math.max(1, active.job.copies || 1);
      if (active.copyIndex + 1 < totalCopies) {
        setActive(a => (a ? { ...a, copyIndex: a.copyIndex + 1 } : a));
      } else {
        try {
          appendPrintLog({
            printType: active.job.printType === 'kot' ? 'kitchen' : 'receipt',
            stage: 'queue', status: 'failed',
            billNumber: String(active.order.orderNumber ?? ''),
            printerName: active.job.printerId,
            error: 'No print completion callback within 20s (timed out)',
          });
        } catch {}
        markPrinted(active.job.id);
        busyRef.current = false;
        setActive(null);
        releaseHostLock();
      }
    }, 20000);
    return () => clearTimeout(safety);
  }, [active]);

  const handleReceiptComplete = (result: { success: boolean; error?: string }) => {
    if (!active) return;
    if (!result.success) {
      markFailed(active.job.id, result.error || 'Receipt print failed');
      busyRef.current = false;
      setActive(null);
      releaseHostLock();
      return;
    }
    const totalCopies = Math.max(1, active.job.copies || 1);
    // Small buffer so the spooler fully captures the page before the DOM
    // remounts for the next copy / next job.
    setTimeout(() => {
      if (active.copyIndex + 1 < totalCopies) {
        setActive(a => (a ? { ...a, copyIndex: a.copyIndex + 1 } : a));
      } else {
        markPrinted(active.job.id);
        busyRef.current = false;
        setActive(null);
        releaseHostLock();
      }
    }, PRINT_BUFFER_MS);
  };

  const handleKotComplete = (result: { success: boolean; error?: string }) => {
    if (!active) return;
    if (!result.success) {
      const msg = result.error || 'KOT print failed';
      try {
        appendPrintLog({
          printType: 'kitchen', stage: 'queue', status: 'failed',
          billNumber: String(active.order.orderNumber ?? ''),
          printerName: active.job.printerId, error: msg,
        });
      } catch {}
      try { toast.error(`KOT print failed: ${msg}`); } catch {}
      markFailed(active.job.id, msg);
      busyRef.current = false;
      setActive(null);
      releaseHostLock();
      return;
    }
    const totalCopies = Math.max(1, active.job.copies || 1);
    if (active.copyIndex + 1 < totalCopies) {
      setActive(a => (a ? { ...a, copyIndex: a.copyIndex + 1 } : a));
    } else {
      markPrinted(active.job.id);
      busyRef.current = false;
      setActive(null);
      releaseHostLock();
    }
  };

  if (!active) return null;
  const settings = getSettings();
  const isReceipt = active.job.printType === 'receipt' || active.job.printType === 'token' || active.job.printType === 'rider';

  return (
    <div style={{ position: 'fixed', left: -9999, top: -9999, width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      {isReceipt ? (
        <ReceiptPreview
          key={`${active.job.id}-${active.copyIndex}`}
          order={active.order}
          settings={settings}
          autoPrint
          showPrintButton={false}
          onAutoPrintComplete={handleReceiptComplete}
        />
      ) : (
        <KitchenReceipt
          key={`${active.job.id}-${active.copyIndex}`}
          order={active.order}
          settings={settings}
          autoPrint
          autoPrintDelayMs={50}
          showPrintButton={false}
          onAutoPrintComplete={handleKotComplete}
          updateMode={active.job.updateMode}
          diffItemIds={active.job.diffItemIds}
          diffDeltas={active.job.diffDeltas}
          cancelDeltas={active.job.cancelDeltas}
          cancelNames={active.job.cancelNames}
        />
      )}
    </div>
  );
}

/** Backward-compatible helper — enqueues a KOT through the central queue. */
export function triggerAutoKot(orderId: string) {
  try {
    const order = getOrders().find(o => o.id === orderId);
    if (order) enqueueKot(order);
  } catch {}
}
