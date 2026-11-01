// Global Print Host — mounted once in AppLayout & Order Taker portal.
// Processes the centralized print queue ONE job at a time so the browser
// never shows overlapping/duplicate print dialogs. Renders the correct
// hidden receipt (KOT or customer receipt) with autoPrint, then advances.
//
// Backward-compat: triggerAutoKot(orderId) still works — it now enqueues a
// KOT job through the centralized print queue.
import { memo, useEffect, useRef, useState } from 'react';
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
import KitchenReceipt from '@/components/KitchenReceipt';
import ReceiptPreview from '@/components/ReceiptPreview';
import TokenReceipt from '@/components/TokenReceipt';
import { prewarmDirectPrint } from '@/printing/directPrint';
import { autoDetectPrintersOnStartup } from '@/printing/printerAutoDetect';
import { forceExitThermalPrintMode } from '@/lib/thermal-print';
import type { Order } from '@/lib/types';
import { prewarmPrintGuard } from '@/licensing/printGuard';

interface ActiveRender {
  job: PrintJob;
  order: Order;
  copyIndex: number; // 0-based copy currently printing
  /** Bumped by the start watchdog to mount the slip afresh. */
  attempt?: number;
}

/**
 * A slip that has not STARTED printing this long after it was mounted never
 * will — it is mounted afresh rather than left for the 20-second safety
 * timeout. Starting is one timer tick after mount, and a busy main thread
 * delays this watchdog as much as the print, so it cannot fire first.
 */
const START_WATCHDOG_MS = 2500;
const MAX_START_KICKS = 2;

const PRINT_BUFFER_MS = 500; // receipt dialog fallback buffer; KOT waits for native print callback

// ===== Cross-instance lock =====
// Both AppLayout and OrderTakerPortal mount AutoKotPrinter.
// Agar dono ek hi waqt active hon to ek hi job pe race kar ke DOUBLE
// end up silently printing. The lock ensures that at any given time only
// ek instance hi queue process kare.
const HOST_LOCK_KEY = 'dtpos-print-host-lock';
const HOST_LOCK_TTL = 8000; // ms; auto-expire to recover from crashed tabs
function acquireHostLock(hostId: string): boolean {
  try {
    const raw = localStorage.getItem(HOST_LOCK_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p?.id === hostId) {
        localStorage.setItem(HOST_LOCK_KEY, JSON.stringify({ id: hostId, at: Date.now() }));
        return true;
      }
      if (typeof p?.at === 'number' && Date.now() - p.at < HOST_LOCK_TTL) return false;
    }
    localStorage.setItem(HOST_LOCK_KEY, JSON.stringify({ id: hostId, at: Date.now() }));
    return true;
  } catch { return true; }
}
function releaseHostLock(hostId: string) {
  try {
    const raw = localStorage.getItem(HOST_LOCK_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p?.id === hostId) localStorage.removeItem(HOST_LOCK_KEY);
  } catch {}
}

// ===== DOUBLE-PRINT FIX =====
// AutoKotPrinter is mounted in two places (AppLayout + OrderTakerPortal).
// Dono ek hi queue process karte thay → har KOT/receipt DO BAAR chhapti thi.
// localStorage lock race me haar jata tha (dono ne ek hi waqt claim kiya).
// Now a module-level singleton: within one JS context, only the FIRST instance
// becomes the printer host, the rest stay silent — deterministic, race-free.
let ACTIVE_HOST_ID: string | null = null;

/**
 * ===== A DISPLAY WINDOW MUST NEVER HOST THE PRINT QUEUE =====
 *
 * ACTIVE_HOST_ID above is a module variable, so it makes one host per JS
 * CONTEXT. The Kitchen Display and the Customer Display are separate Electron
 * windows — separate contexts — so each got its own "only" host, and the
 * cross-window localStorage lock behind it expires after 8 seconds.
 *
 * The TV would therefore take a job, mark it `printing`, render the receipt
 * into its own hidden DOM and print nothing, because the spooler call goes
 * through the till's window. The till then waited on a job another window had
 * claimed until the 20-second safety timeout fired — the late and stuck
 * prints reported from the counter.
 *
 * AppLayout already keeps this component off those routes. This is the second
 * lock on the same door, because the cost of getting it wrong is a shop that
 * cannot print and the cost of the check is one string comparison.
 */
const DISPLAY_ROUTES = ['/customer-display', '/kds-tv'];

function isDisplayWindow(): boolean {
  try {
    const hash = window.location.hash || '';
    return DISPLAY_ROUTES.some(r => hash.startsWith(`#${r}`));
  } catch {
    return false;
  }
}

function AutoKotPrinter() {
  const [active, setActive] = useState<ActiveRender | null>(null);
  // The job id + copy + attempt whose slip has actually started printing.
  const startedRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const processNextRef = useRef<(() => void) | null>(null);
  const myHostId = useRef<string>(`host_${Math.random().toString(36).slice(2, 9)}`);
  const [isPrimaryHost, setIsPrimaryHost] = useState(false);

  // Licence guard ko pehle se garam kar lo — pehle bill par zero intezar.
  useEffect(() => {
    prewarmPrintGuard();
    // Bring the saved printer configuration in line with what Windows has
    // installed BEFORE the first bill. Without this a fresh machine, or one
    // whose printer was renamed by a driver reinstall, queues every bill as
    // Pending until somebody opens Printer Center and presses Detect & Save.
    autoDetectPrintersOnStartup();
    // Printer mapping ko pehle se load kar lo — pehla direct print bhi bina rukey.
    prewarmDirectPrint();
    // Printer config bhi pehle se garam — pehla bill bhi bina rukey chhape.
    void import('@/components/ReceiptPreview').then(m => m.prewarmReceiptPrinting?.());
  }, []);

  useEffect(() => {
    if (isDisplayWindow()) {
      setIsPrimaryHost(false);
      try { console.log('%c[DT-Print]', 'color:#f59e0b', 'display window — not hosting the print queue'); } catch { /* no console */ }
      return;
    }
    if (ACTIVE_HOST_ID === null) {
      ACTIVE_HOST_ID = myHostId.current;
      setIsPrimaryHost(true);
      try { console.log('%c[DT-Print]', 'color:#0ea5e9;font-weight:700', 'primary print host', myHostId.current); } catch {}
    } else if (ACTIVE_HOST_ID === myHostId.current) {
      setIsPrimaryHost(true);
    } else {
      setIsPrimaryHost(false);
      try { console.log('%c[DT-Print]', 'color:#f59e0b', 'passive host (double-print guard)', myHostId.current); } catch {}
    }
    return () => {
      if (ACTIVE_HOST_ID === myHostId.current) ACTIVE_HOST_ID = null;
    };
  }, []); // to chain the next job immediately after completion
  // Per-instance host ID — ensures two AutoKotPrinter mounts in the same tab
  // (AppLayout + OrderTakerPortal) don't both acquire the lock and print
  // duplicate KOTs for the same job.
  const hostIdRef = useRef(`host_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    // ===== FIX v1.0.38 (queue jam + double print) =====
    // Pehle yeh guard effect ke AAKHIR me tha (subscription aur 50ms
    // kick-off ke BAAD), aur dependency array khali `[]` thi jabke
    // `isPrimaryHost` doosre effect me set hota hai. Do masle:
    //   1. Pehle run par isPrimaryHost hamesha false hota tha → effect
    //      jaldi return kar jata tha → 2s poll KABHI start nahi hua aur
    //      cleanup bhi register nahi hui (listener leak).
    //   2. Passive hosts phir bhi queue-change par jobs process kar lete
    //      thay → ek hi KOT do dafa chhapti thi.
    // Ab guard sab se upar hai aur effect isPrimaryHost par re-run hota hai.
    if (!isPrimaryHost) return;

    let cancelled = false;
    const hostId = hostIdRef.current;

    const advance = () => {
      busyRef.current = false;
      setActive(null);
      releaseHostLock(hostId);
      // process the next job on the next tick
      setTimeout(processNext, 0);
    };

    const processNext = () => {
      if (cancelled || busyRef.current) return;
      if (!acquireHostLock(hostId)) return; // another instance is processing
      const jobs = getProcessableJobs();
      if (jobs.length === 0) { releaseHostLock(hostId); return; }
      // Silent KOT Mode: hold all auto KOT jobs in queue (user must manually release)
      const silent = !!getSettings().kotSilentMode;
      // FIX: Silent-KOT hold should only apply to AUTO jobs. The user's explicit
      // \"Send Kitchen\" / reprint (manual flag) HAMESHA print ho.
      const allowedJobs = silent ? jobs.filter(j => j.printType !== 'kot' || j.manual) : jobs;
      // Payment must feel immediate: when Pay queued a receipt and KOT together,
      // send the complete paid receipt first. The kitchen job follows separately.
      const job = allowedJobs.find(j => j.printType === 'receipt') || allowedJobs[0];
      if (!job) { releaseHostLock(hostId); return; }
      const order = getOrders().find(o => o.id === job.orderId);
      if (!order) {
        // order missing — mark printed to drop it from the queue
        markPrinted(job.id);
        releaseHostLock(hostId);
        setTimeout(processNext, 0);
        return;
      }
      busyRef.current = true;
      markPrinting(job.id);
      // Render the selected receipt/KOT/token component first. The hidden worker
      // converts that exact design to ESC/POS raster data, so fast printing never
      // bypasses templates, compact mode, logos, or Urdu fonts.
      setActive({ job, order, copyIndex: 0 });
    };

    // ===== RECEIPT FIRST ON PAY =====
    // Picking a job synchronously inside the queue-change event took the FIRST
    // job queued, before the rest of the same click had queued anything else.
    // Retrieve → Pay queues the new items' KOT and then the paid receipt, so
    // the customer's receipt waited for the kitchen ticket to print. Now the
    // pick waits for the click to finish (one microtask), sees every job it
    // queued, and the receipt-first rule below applies.
    let kickQueued = false;
    const unsub = onPrintQueueChange(() => {
      if (busyRef.current || kickQueued) return;
      kickQueued = true;
      queueMicrotask(() => {
        kickQueued = false;
        if (!busyRef.current) processNext();
      });
    });
    // kick off in case there are pending jobs at mount
    const t = setTimeout(processNext, 0);
    processNextRef.current = processNext;
    const poll = setInterval(() => { if (!busyRef.current) processNext(); }, 600); // 5s→2s→0.6s: removes the long gap before KOT after receipt

    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(poll);
      unsub();
      processNextRef.current = null;
    };
  }, [isPrimaryHost]);

  // ===== FIX (blank/no receipt): pehle receipts ko 500ms timer pe printed
  // mark kar ke component UNMOUNT kar diya jata tha — jabke asal print
  // (settings load + render delay ke baad) ~600ms+ pe fire hota tha. Portal
  // already removed from the DOM → the printer would get a blank page or nothing at all.
  // Ab receipt bhi KOT ki tarah onAutoPrintComplete callback ka intezar
  // does this. A 20s safety timeout prevents the queue from getting stuck. =====
  const renderKey = active ? `${active.job.id}-${active.copyIndex}-${active.attempt || 0}` : '';
  const onSlipStart = () => {
    if (!active) return;
    startedRef.current = renderKey;
    // Stamp the moment the print actually starts (first copy only).
    if (active.copyIndex === 0) {
      try { markPrintCommandSent(active.job.id); } catch { /* queue storage gone */ }
    }
  };

  // ===== START WATCHDOG =====
  // A slip that never starts printing (its start was lost) is mounted afresh
  // after START_WATCHDOG_MS instead of waiting out the 20-second timeout.
  useEffect(() => {
    if (!active) return;
    const key = renderKey;
    const t = setTimeout(() => {
      if (startedRef.current === key) return;
      if ((active.attempt || 0) >= MAX_START_KICKS) return; // the safety timeout takes it from here
      try { console.warn('[DT-Print] slip did not start — mounting it again', { jobId: active.job.id, attempt: (active.attempt || 0) + 1 }); } catch { /* no console */ }
      setActive(a => (a && a.job.id === active.job.id && a.copyIndex === active.copyIndex ? { ...a, attempt: (a.attempt || 0) + 1 } : a));
    }, START_WATCHDOG_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the slip being printed
  }, [renderKey]);

  useEffect(() => {
    if (!active) return;
    // ===== FIX (queue-jam / "everything prints on restart"): safety
    // timeout now applies to BOTH KOT + receipt. Previously the KOT callback would
    // miss ho jata to busyRef hamesha true → POORI queue jam → har naya
    // never fire and the print would stay pending, only flushing on restart. =====
    const safety = setTimeout(() => {
      markFailed(active.job.id, `${active.job.printType} print timeout (no completion callback)`);
      // A job that never called back may also have left the POS in print
      // mode (white screen, UI hidden). Releasing the queue is not enough —
      // give the cashier their screen back too.
      forceExitThermalPrintMode();
      busyRef.current = false;
      setActive(null);
      releaseHostLock(hostIdRef.current);
      setTimeout(() => { if (!busyRef.current) processNextRef.current?.(); }, 200);
    }, 20000);
    // ===== FIX (parallel-host race): keep the lock alive while a job runs —
    // TTL is 8s; during a long job a second host would jump in and print at the
    // SAME time (corrupt/blank). Every 3s heartbeat = only one printer host at a time. =====
    const heartbeat = setInterval(() => {
      try { localStorage.setItem('dtpos-print-host-lock', JSON.stringify({ id: hostIdRef.current, at: Date.now() })); } catch {}
    }, 3000);
    return () => { clearTimeout(safety); clearInterval(heartbeat); };
    // A watchdog re-mount (attempt) is the same job: it keeps its timeout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.job.id, active?.copyIndex]);

  const handleReceiptComplete = (result: { success: boolean; error?: string }) => {
    if (!active) return;
    if (!result.success) {
      markFailed(active.job.id, result.error || 'Receipt print failed');
      busyRef.current = false;
      setActive(null);
      releaseHostLock(hostIdRef.current);
      setTimeout(() => { if (!busyRef.current) processNextRef.current?.(); }, 0);
      return;
    }
    const totalCopies = Math.max(1, active.job.copies || 1);
    if (active.copyIndex + 1 < totalCopies) {
      setActive(a => (a ? { ...a, copyIndex: a.copyIndex + 1, attempt: 0 } : a));
    } else {
      markPrinted(active.job.id);
      busyRef.current = false;
      setActive(null);
      releaseHostLock(hostIdRef.current);
      setTimeout(() => { if (!busyRef.current) processNextRef.current?.(); }, 0); // chain straight into the next job
    }
  };

  const handleKotComplete = (result: { success: boolean; error?: string }) => {
    if (!active) return;
    if (!result.success) {
      markFailed(active.job.id, result.error || 'KOT print failed');
      busyRef.current = false;
      setActive(null);
      releaseHostLock(hostIdRef.current);
      return;
    }
    const totalCopies = Math.max(1, active.job.copies || 1);
    if (active.copyIndex + 1 < totalCopies) {
      setActive(a => (a ? { ...a, copyIndex: a.copyIndex + 1, attempt: 0 } : a));
    } else {
      markPrinted(active.job.id);
      busyRef.current = false;
      setActive(null);
      releaseHostLock(hostIdRef.current);
      setTimeout(() => { if (!busyRef.current) processNextRef.current?.(); }, 0); // chain straight into the next job
    }
  };

  if (!active) return null;
  const settings = getSettings();
  const isToken = active.job.printType === 'token';
  const isReceipt = active.job.printType === 'receipt' || active.job.printType === 'rider';

  return (
    <div style={{ position: 'fixed', left: -9999, top: -9999, width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
      {isToken ? (
        <TokenReceipt
          key={renderKey}
          order={active.order}
          settings={settings}
          autoPrint
          onAutoPrintStart={onSlipStart}
          onAutoPrintComplete={handleReceiptComplete}
          printerOverride={active.job.printerId}
        />
      ) : isReceipt ? (
        <ReceiptPreview
          key={renderKey}
          order={active.order}
          settings={settings}
          autoPrint
          showPrintButton={false}
          onAutoPrintStart={onSlipStart}
          onAutoPrintComplete={handleReceiptComplete}
          printerOverride={active.job.printerId}
        />
      ) : (
        <KitchenReceipt
          key={renderKey}
          order={active.order}
          settings={settings}
          printerOverride={active.job.printerId}
          autoPrint
          autoPrintDelayMs={0}
          showPrintButton={false}
          onAutoPrintStart={onSlipStart}
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

/**
 * Memoised: it takes no props, so the layout re-rendering around it (the
 * header clock ticks every second) never re-renders the print host or the
 * slip it is printing.
 */
export default memo(AutoKotPrinter);

/** Backward-compatible helper — enqueues a KOT through the central queue. */
export function triggerAutoKot(orderId: string) {
  try {
    const order = getOrders().find(o => o.id === orderId);
    if (order) enqueueKot(order);
  } catch {}
}
