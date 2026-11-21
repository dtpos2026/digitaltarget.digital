// v1.129.0 — "Synced 12 s ago": when this device last heard from the cloud, for the top bar's sync chip (design SW-02).
// Marked by the places that actually talk to the cloud (the orders poll, the background refresh, a queue flush that emptied),
// never by the clock alone, so the chip cannot claim "Synced" while nothing has been reaching the server.
let last = 0;
const subs = new Set<() => void>();

export function markSynced(at = Date.now()): void {
  last = at;
  subs.forEach(f => { try { f(); } catch { /* a listener must never break a sync */ } });
}
export function lastSyncedAt(): number { return last; }
export function onSyncedAt(cb: () => void): () => void { subs.add(cb); return () => subs.delete(cb); }

/** "just now" · "12 s ago" · "3 min ago" · "2 h ago" · "3 d ago" */
export function agoLabel(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** The words and tone of the top bar's sync chip. */
export function syncChipState(
  s: { online: boolean; pending: number; lastError?: string; flushing?: boolean },
  lastAt: number,
  now = Date.now(),
): { tone: 'ok' | 'warn' | 'bad' | 'busy'; label: string } {
  if (!s.online) return { tone: 'bad', label: s.pending > 0 ? `Offline · ${s.pending} waiting` : 'Offline' };
  if (s.flushing) return { tone: 'busy', label: 'Syncing…' };
  if (s.lastError) return { tone: 'warn', label: 'Sync needs attention' };
  if (s.pending > 0) return { tone: 'warn', label: `${s.pending} waiting to sync` };
  return { tone: 'ok', label: lastAt > 0 ? `Synced ${agoLabel(lastAt, now)}` : 'Synced' };
}
