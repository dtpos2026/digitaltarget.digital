// Support chat outbox — gives every message a visible delivery state
// (sending → sent, or failed) and retries automatically when the network or
// realtime layer hiccups. Pending items survive a reload via localStorage.
import { sendSupportMessage, type SupportFrom, type SupportMessage } from './support';

export type OutboxStatus = 'sending' | 'failed';

export interface OutboxItem {
  localId: string;
  tenantId: string;
  from: SupportFrom;
  body: string;
  authorEmail?: string;
  extra?: Partial<Pick<SupportMessage, 'category' | 'imageUrl' | 'meta' | 'intent' | 'aiGenerated' | 'status'>>;
  status: OutboxStatus;
  attempts: number;
  error?: string;
  createdAt: number;
}

const KEY = 'dtpos-support-outbox-v1';
const MAX_AUTO_ATTEMPTS = 5;

let items: OutboxItem[] = load();
const listeners = new Set<(items: OutboxItem[]) => void>();

function load(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota */ }
  listeners.forEach(fn => { try { fn(items); } catch { /* ignore */ } });
}

export function subscribeOutbox(fn: (items: OutboxItem[]) => void): () => void {
  listeners.add(fn);
  fn(items);
  return () => { listeners.delete(fn); };
}

export function outboxFor(tenantId: string): OutboxItem[] {
  return items.filter(i => i.tenantId === tenantId);
}

export function discardOutboxItem(localId: string) {
  items = items.filter(i => i.localId !== localId);
  persist();
}

async function attempt(item: OutboxItem) {
  try {
    await sendSupportMessage(item.tenantId, item.from, item.body, item.authorEmail, item.extra);
    items = items.filter(i => i.localId !== item.localId);
    persist();
  } catch (e: any) {
    const cur = items.find(i => i.localId === item.localId);
    if (!cur) return;
    cur.attempts += 1;
    cur.error = e?.message || 'Network error';
    cur.status = cur.attempts >= MAX_AUTO_ATTEMPTS ? 'failed' : 'sending';
    persist();
  }
}

/** Queue a message. Resolves as soon as it is queued; delivery is tracked. */
export function queueSupportMessage(
  tenantId: string,
  from: SupportFrom,
  body: string,
  authorEmail?: string,
  extra?: OutboxItem['extra'],
): OutboxItem {
  const item: OutboxItem = {
    localId: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId, from, body, authorEmail, extra,
    status: 'sending', attempts: 0, createdAt: Date.now(),
  };
  items = [...items, item];
  persist();
  void attempt(item);
  return item;
}

export function retryOutboxItem(localId: string) {
  const cur = items.find(i => i.localId === localId);
  if (!cur) return;
  cur.status = 'sending';
  cur.attempts = 0;
  cur.error = undefined;
  persist();
  void attempt(cur);
}

function sweep() {
  // Retry anything still in flight; failed items wait for a manual retry.
  items.filter(i => i.status === 'sending').forEach(i => { void attempt(i); });
}

if (typeof window !== 'undefined') {
  setInterval(sweep, 10_000);
  window.addEventListener('online', sweep);
}
