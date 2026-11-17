// ============================================================================
// Opening hours for the ordering website (v1.115.0) — design WEB-02 (opening hours slot) and WEB-20 (restaurant closed).
//
// The owner sets the hours once in Settings → Online Portal; they are one small document inside the settings the site already
// reads (`onlineHours`), so there is no new table. Pure functions, no clock of their own: the caller passes `now`.
//
//   • A time zone (IANA name, e.g. "Asia/Karachi") decides what "today 18:30" means — the customer's phone clock and the server's
//     clock may sit anywhere in the world. Without a valid zone the hours are read in the zone of the machine asking.
//   • A day can be closed, open once (11:00–23:00), or open past midnight (18:00–02:00 — the part after midnight belongs to the
//     day that opened).
//   • Hours that are switched off, missing or unreadable NEVER block an order. Only a clearly configured schedule can close the site.
//   • A pause ("busy mode", until a time) closes the site by hand, whatever the schedule says.
// ============================================================================

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const DAY_KEYS: readonly DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export interface DayHours { closed: boolean; open: string; close: string }
export interface OpeningHours { enabled: boolean; timeZone?: string; days: Record<DayKey, DayHours> }

export const DEFAULT_DAY: DayHours = { closed: false, open: '11:00', close: '23:00' };

/** The hours a new schedule starts from: every day 11:00–23:00, switched off until the owner turns it on. */
export function defaultOpeningHours(): OpeningHours {
  const days = {} as Record<DayKey, DayHours>;
  for (const k of DAY_KEYS) days[k] = { ...DEFAULT_DAY };
  return { enabled: false, days };
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const toMin = (s: string): number | null => { const m = HHMM.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const pad = (n: number) => String(n).padStart(2, '0');
/** "9:5" is not a time; "09:05" is. Returns the canonical form or null. */
export function cleanTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = toMin(s);
  return m === null ? null : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Read the stored document. Anything that is not a clear schedule returns null (= "no hours", which never blocks). */
export function parseOpeningHours(raw: unknown): OpeningHours | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const daysIn = (r.days && typeof r.days === 'object' ? r.days : {}) as Record<string, unknown>;
  const days = {} as Record<DayKey, DayHours>;
  let any = false;
  for (const k of DAY_KEYS) {
    const d = daysIn[k];
    if (!d || typeof d !== 'object') { days[k] = { closed: true, open: DEFAULT_DAY.open, close: DEFAULT_DAY.close }; continue; }
    const o = d as Record<string, unknown>;
    const open = cleanTime(o.open), close = cleanTime(o.close);
    const closed = o.closed === true || !open || !close || open === close;
    days[k] = { closed, open: open ?? DEFAULT_DAY.open, close: close ?? DEFAULT_DAY.close };
    if (!closed) any = true;
  }
  const tz = isValidTimeZone(r.timeZone) ? (r.timeZone as string) : undefined;
  return { enabled: r.enabled === true && any, ...(tz ? { timeZone: tz } : {}), days };
}

// ------------------------------------------------------------------ the clock in the restaurant's zone

interface Wall { day: number /* 0 = Monday */; minutes: number /* since midnight */; date: string /* y-m-d, for "today" */ }

/** What the wall clock says in `timeZone` at `now`. Falls back to the machine's own zone when the zone is unknown. */
export function wallClock(now: Date, timeZone?: string): Wall {
  const tz = isValidTimeZone(timeZone) ? timeZone : undefined;
  const f = new Intl.DateTimeFormat('en-US', { ...(tz ? { timeZone: tz } : {}), weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(now)) p[x.type] = x.value;
  const idx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { day: idx < 0 ? 0 : idx, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), date: `${p.year}-${p.month}-${p.day}` };
}

export type OpenState =
  | { kind: 'always' }                                   // no schedule — never blocks
  | { kind: 'open'; closesAt: string; closingSoon: boolean }
  | { kind: 'closed'; reason: 'schedule' | 'paused'; opensAt?: { dayOffset: number; day: DayKey; time: string }; pausedUntil?: string };

export interface OpenOptions { pausedUntil?: string | null; closingSoonMinutes?: number }

const iso = (v: unknown): number | null => { if (typeof v !== 'string') return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

/** Is the restaurant taking online orders at `now`? */
export function openState(hours: OpeningHours | null, now: Date, o: OpenOptions = {}): OpenState {
  const pausedMs = iso(o.pausedUntil);
  if (pausedMs !== null && pausedMs > now.getTime()) return { kind: 'closed', reason: 'paused', pausedUntil: new Date(pausedMs).toISOString() };
  if (!hours || !hours.enabled) return { kind: 'always' };

  const w = wallClock(now, hours.timeZone);
  const today = hours.days[DAY_KEYS[w.day]];
  const yesterday = hours.days[DAY_KEYS[(w.day + 6) % 7]];
  const soon = o.closingSoonMinutes ?? 30;

  // the tail of yesterday's late opening (e.g. 18:00–02:00) — the minutes after midnight
  if (!yesterday.closed) {
    const yo = toMin(yesterday.open)!, yc = toMin(yesterday.close)!;
    if (yc < yo && w.minutes < yc) return { kind: 'open', closesAt: yesterday.close, closingSoon: yc - w.minutes <= soon };
  }
  if (!today.closed) {
    const to = toMin(today.open)!, tc = toMin(today.close)!;
    if (tc > to) {
      if (w.minutes >= to && w.minutes < tc) return { kind: 'open', closesAt: today.close, closingSoon: tc - w.minutes <= soon };
    } else if (w.minutes >= to) {
      return { kind: 'open', closesAt: today.close, closingSoon: tc + 24 * 60 - w.minutes <= soon };   // runs past midnight
    }
  }
  // closed now — find the next opening within a week
  for (let off = 0; off < 8; off++) {
    const day = DAY_KEYS[(w.day + off) % 7];
    const d = hours.days[day];
    if (d.closed) continue;
    const start = toMin(d.open)!;
    if (off === 0 && start <= w.minutes) continue;
    return { kind: 'closed', reason: 'schedule', opensAt: { dayOffset: off, day, time: d.open } };
  }
  return { kind: 'closed', reason: 'schedule' };
}

// ------------------------------------------------------------------ words for the customer

/** "9:00 AM" style for a 24h "HH:MM" — the way a customer in most countries reads it. */
export function formatClock(hhmm: string, hour12 = true): string {
  const m = toMin(hhmm);
  if (m === null) return hhmm;
  const h = Math.floor(m / 60), mm = m % 60;
  if (!hour12) return `${pad(h)}:${pad(mm)}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The one line the site shows when it is closed: when it opens again, or when the pause ends. null when it is open. */
export function closedMessage(s: OpenState, hour12 = true): string | null {
  if (s.kind !== 'closed') return null;
  if (s.reason === 'paused') return 'We are very busy right now and have paused online orders for a short while. Please try again soon or call the restaurant.';
  if (!s.opensAt) return 'We are closed right now. Please call the restaurant.';
  const { dayOffset, day, time } = s.opensAt;
  const when = dayOffset === 0 ? `today at ${formatClock(time, hour12)}` : dayOffset === 1 ? `tomorrow at ${formatClock(time, hour12)}` : `${DAY_NAMES[day]} at ${formatClock(time, hour12)}`;
  return `We are closed right now. We open ${when}.`;
}

/** "Open until 11:00 PM" / "Closes soon — 11:00 PM" / "Closed — opens tomorrow at 11:00 AM" for the small status chip. */
export function statusChip(s: OpenState, hour12 = true): { tone: 'open' | 'soon' | 'closed'; text: string } | null {
  if (s.kind === 'always') return null;
  if (s.kind === 'open') return s.closingSoon ? { tone: 'soon', text: `Closes soon · ${formatClock(s.closesAt, hour12)}` } : { tone: 'open', text: `Open until ${formatClock(s.closesAt, hour12)}` };
  if (s.reason === 'paused') return { tone: 'closed', text: 'Paused for a short while' };
  if (!s.opensAt) return { tone: 'closed', text: 'Closed' };
  const { dayOffset, day, time } = s.opensAt;
  return { tone: 'closed', text: `Closed · opens ${dayOffset === 0 ? 'today' : dayOffset === 1 ? 'tomorrow' : DAY_NAMES[day]} ${formatClock(time, hour12)}` };
}

/** The week as lines for the About page: consecutive days with the same hours are one line ("Mon – Fri  11:00 AM – 11:00 PM"). */
export function weekLines(h: OpeningHours, hour12 = true): { label: string; hours: string; closed: boolean }[] {
  const text = (d: DayHours) => (d.closed ? 'Closed' : `${formatClock(d.open, hour12)} – ${formatClock(d.close, hour12)}`);
  const short = (k: DayKey) => DAY_NAMES[k].slice(0, 3);
  const out: { label: string; hours: string; closed: boolean }[] = [];
  let i = 0;
  while (i < 7) {
    let j = i;
    while (j + 1 < 7 && text(h.days[DAY_KEYS[j + 1]]) === text(h.days[DAY_KEYS[i]])) j++;
    out.push({ label: i === j ? short(DAY_KEYS[i]) : `${short(DAY_KEYS[i])} – ${short(DAY_KEYS[j])}`, hours: text(h.days[DAY_KEYS[i]]), closed: h.days[DAY_KEYS[i]].closed });
    i = j + 1;
  }
  return out;
}

/** The pause the owner can set: an ISO time in the future, or null for "not paused". */
export function pauseUntil(now: Date, minutes: number): string { return new Date(now.getTime() + minutes * 60_000).toISOString(); }
export function isPaused(pausedUntil: unknown, now: Date): boolean { const t = iso(pausedUntil); return t !== null && t > now.getTime(); }
