// ============================================================
// WHEN SOMETHING GOES WRONG, LEAVE A TRACE.
//
// This codebase has hundreds of bare `catch {}` blocks, and most of them are
// right to swallow: a failed console.log or a missing optional setting must
// not take a bill down with it. But the same habit was applied to failures
// that DO matter, and those vanished — which is why a support call starts
// with "it stopped working" and cannot go any further.
//
// `reportFault` is the other half of that pattern. The catch still swallows,
// so nothing changes for the cashier; but the failure is now written where
// somebody can read it afterwards:
//
//   • the rolling app.log file, which Electron already rotates at 2 MB;
//   • a short in-memory ring, so the Diagnostics screen can show the last
//     faults without reading a file the shop cannot open.
//
// It never throws. A logger that can break the thing it is logging about is
// worse than no logger.
// ============================================================

export type FaultLevel = 'WARN' | 'ERROR';

export interface Fault {
  at: string;
  level: FaultLevel;
  /** Where it happened — a module or action name, not a stack trace. */
  where: string;
  /** What happened, in one line. */
  detail: string;
}

/**
 * How many faults are kept in memory.
 *
 * Small on purpose: this is for "what just went wrong", not a history. The
 * file is the history.
 */
const RING = 100;
const recent: Fault[] = [];

/** Same fault, over and over, must not fill the file. */
const lastSeen = new Map<string, number>();
const REPEAT_QUIET_MS = 30_000;

function api(): any {
  try { return (window as any).electronAPI; } catch { return undefined; }
}

/** One readable line from whatever was thrown. */
export function describeError(err: unknown): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const e = err as any;
  if (e?.message) return String(e.message);
  try { return JSON.stringify(e).slice(0, 500); } catch { return String(e); }
}

/**
 * Record a failure that a `catch` is about to swallow.
 *
 * `where` should name the action, not the file — "pay: save order" reads far
 * better in a log a week later than "POSScreen.tsx:1842".
 */
export function reportFault(where: string, err: unknown, level: FaultLevel = 'ERROR'): void {
  try {
    const detail = describeError(err);
    const key = `${where}|${detail}`;
    const now = Date.now();
    const seen = lastSeen.get(key) || 0;
    if (now - seen < REPEAT_QUIET_MS) return;
    lastSeen.set(key, now);

    const fault: Fault = { at: new Date().toISOString(), level, where, detail };
    recent.push(fault);
    if (recent.length > RING) recent.splice(0, recent.length - RING);

    try { api()?.appLog?.(level, where, detail); } catch { /* the ring still has it */ }
    // Also to the console, where a developer sitting at the machine will see
    // it without opening anything.
    try { console.warn(`[DT-Fault] ${where}: ${detail}`); } catch { /* no console */ }
  } catch {
    // A logger that can break what it is logging about is worse than none.
  }
}

/** The last faults this session, newest first. */
export function recentFaults(): Fault[] {
  return [...recent].reverse();
}

/** For the Diagnostics screen's "nothing has gone wrong" state. */
export function faultCount(): number {
  return recent.length;
}

/** Test seam. */
export function clearFaultsForTests(): void {
  recent.length = 0;
  lastSeen.clear();
}

// ===== GLOBAL NET =====
// Anything that escaped every catch in the app. Without this an unhandled
// rejection is a blank screen with no record of why.
let installed = false;

export function installGlobalFaultHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    window.addEventListener('error', (e) => {
      reportFault('uncaught error', e.error || e.message || 'unknown');
    });
    window.addEventListener('unhandledrejection', (e) => {
      reportFault('unhandled promise', (e as PromiseRejectionEvent).reason);
    });
  } catch { /* an old engine still gets the explicit reports */ }
}
