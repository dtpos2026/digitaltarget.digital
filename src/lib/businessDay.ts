// ============================================================
// Business Day Engine — restaurant-specific shift timing.
//
// Restaurant defines:
//   businessDayStart = "08:00"   (e.g. 8 AM)
//   businessDayClose = "03:00"   (e.g. 3 AM next day)
//
// All sales between Start and Close (inclusive of overnight wrap)
// belong to ONE business day. The label is the calendar date of the
// START moment (so "Business Day 2025-06-27" runs 27 June 08:00 → 28 June 03:00).
//
// ALL reports, dashboards and exports MUST use this engine — never
// raw Calendar Date.
// ============================================================
import { getSettings } from './store';

export interface BusinessDayWindow {
  /** ms — inclusive start (e.g. 27 June 08:00 local) */
  startMs: number;
  /** ms — exclusive end (e.g. 28 June 03:00 local) */
  endMs: number;
  /** YYYY-MM-DD of startMs in local time */
  label: string;
  /** Pretty start Date (local) */
  start: Date;
  /** Pretty end Date (local) */
  end: Date;
}

interface Timing {
  startHHMM: string;
  closeHHMM: string;
}

const DEFAULTS: Timing = { startHHMM: '08:00', closeHHMM: '03:00' };

function parseHHMM(v: string | undefined, fallback: string): { h: number; m: number } {
  const s = (v || fallback).trim();
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return {
    h: Number.isFinite(h) ? Math.max(0, Math.min(23, h)) : 0,
    m: Number.isFinite(m) ? Math.max(0, Math.min(59, m)) : 0,
  };
}

export function getBusinessDayTiming(): Timing {
  try {
    const s: any = getSettings();
    return {
      startHHMM: s?.businessDayStart || DEFAULTS.startHHMM,
      closeHHMM: s?.businessDayClose || DEFAULTS.closeHHMM,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Return the business-day window that contains the given timestamp (default = now). */
export function getBusinessDayFor(at: Date | number = Date.now()): BusinessDayWindow {
  const t = getBusinessDayTiming();
  const { h: sh, m: sm } = parseHHMM(t.startHHMM, DEFAULTS.startHHMM);
  const { h: ch, m: cm } = parseHHMM(t.closeHHMM, DEFAULTS.closeHHMM);

  const at_ = at instanceof Date ? at : new Date(at);
  // Window length in minutes (handle overnight wrap)
  const startMin = sh * 60 + sm;
  const closeMin = ch * 60 + cm;
  const windowMin = closeMin > startMin ? closeMin - startMin : (24 * 60 - startMin) + closeMin;

  // Anchor at the START of the day-of-at, then walk backward until at lies in window
  let anchor = new Date(at_.getFullYear(), at_.getMonth(), at_.getDate(), sh, sm, 0, 0);
  // If at is before today's start moment, the active business day actually started YESTERDAY
  if (at_.getTime() < anchor.getTime()) {
    anchor.setDate(anchor.getDate() - 1);
  }
  const startMs = anchor.getTime();
  const endMs = startMs + windowMin * 60 * 1000;
  const end = new Date(endMs);
  return {
    startMs,
    endMs,
    label: ymdLocal(anchor),
    start: anchor,
    end,
  };
}

/** Current (active) business day window. */
export function getCurrentBusinessDay(): BusinessDayWindow {
  return getBusinessDayFor(Date.now());
}

/** Window N days back (0 = today, 1 = yesterday, …) */
export function getBusinessDayOffset(daysBack: number): BusinessDayWindow {
  const cur = getCurrentBusinessDay();
  const ref = new Date(cur.startMs);
  ref.setDate(ref.getDate() - daysBack);
  // mid-window pick so getBusinessDayFor lands inside
  ref.setHours(ref.getHours() + 1);
  return getBusinessDayFor(ref);
}

/** Does this timestamp fall inside the given business day? */
export function isInBusinessDay(at: Date | number | string, win: BusinessDayWindow): boolean {
  const ms = typeof at === 'string' ? new Date(at).getTime() : at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(ms)) return false;
  return ms >= win.startMs && ms < win.endMs;
}

/** Filter helper for arrays of records carrying an ISO/ms timestamp field. */
export function filterByBusinessDay<T>(items: T[], getTs: (x: T) => string | number | Date | undefined, win: BusinessDayWindow): T[] {
  return items.filter((it) => {
    const ts = getTs(it);
    return ts != null && isInBusinessDay(ts, win);
  });
}

/** Convenience: window spanning N consecutive business days ending today. */
export function getBusinessDayRange(daysBack: number): { startMs: number; endMs: number; label: string } {
  const today = getCurrentBusinessDay();
  const start = getBusinessDayOffset(Math.max(0, daysBack - 1));
  return {
    startMs: start.startMs,
    endMs: today.endMs,
    label: `${start.label} → ${today.label}`,
  };
}

/** Custom range from explicit local start + end dates (with optional times). */
export function makeCustomRange(startISO: string, endISO: string): { startMs: number; endMs: number; label: string } {
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  return {
    startMs: Math.min(s, e),
    endMs: Math.max(s, e),
    label: `${startISO} → ${endISO}`,
  };
}

// ============================================================
// Per-cashier day close.
// Cashier apna business day khud close kar sakta hai — sirf uska
// per-user marker save hota hai, restaurant ka global business day
// untouched rehta hai (manager/admin still runs the global close).
// ============================================================
const CASHIER_CLOSE_KEY = 'pos-cashier-day-close';

export interface CashierCloseRecord {
  userId: string;
  closedAt: number;
  businessDayLabel: string;
  cashCollected?: number;
  notes?: string;
}

function readCashierCloses(): CashierCloseRecord[] {
  try { return JSON.parse(localStorage.getItem(CASHIER_CLOSE_KEY) || '[]'); } catch { return []; }
}
function writeCashierCloses(list: CashierCloseRecord[]) {
  try { localStorage.setItem(CASHIER_CLOSE_KEY, JSON.stringify(list.slice(-500))); } catch {}
}

export function closeCashierDay(userId: string, opts: { cashCollected?: number; notes?: string } = {}): CashierCloseRecord {
  const win = getCurrentBusinessDay();
  const rec: CashierCloseRecord = {
    userId,
    closedAt: Date.now(),
    businessDayLabel: win.label,
    cashCollected: opts.cashCollected,
    notes: opts.notes,
  };
  const list = readCashierCloses();
  list.push(rec);
  writeCashierCloses(list);
  return rec;
}

export function isCashierClosedForToday(userId: string): boolean {
  const win = getCurrentBusinessDay();
  return readCashierCloses().some(r => r.userId === userId && r.businessDayLabel === win.label);
}

export function getCashierCloseHistory(userId?: string): CashierCloseRecord[] {
  const list = readCashierCloses();
  return userId ? list.filter(r => r.userId === userId) : list;
}
