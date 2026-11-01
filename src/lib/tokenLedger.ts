// ============================================================
// TOKEN LEDGER — har token (auto ya manual) ka register.
// Tandoor wale se sham ki milaan ke liye: kitne token, kis item
// ke kitne pieces. Date-wise, localStorage.
// ============================================================

export interface TokenEntry {
  id: string;
  dateKey: string;        // YYYY-MM-DD
  ts: number;
  orderNumber?: number | string;
  items: { name: string; qty: number }[];
  totalPieces: number;
  source: 'auto' | 'manual';
}

const KEY = 'dtpos-token-ledger-v1';
const MAX = 3000;

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function load(): TokenEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(list: TokenEntry[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch {}
}

export function appendTokenEntry(e: Omit<TokenEntry, 'id' | 'ts' | 'dateKey' | 'totalPieces'> & { totalPieces?: number }) {
  const list = load();
  const totalPieces = e.totalPieces ?? e.items.reduce((s, i) => s + (i.qty || 0), 0);
  list.push({
    id: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    dateKey: todayKey(),
    ts: Date.now(),
    orderNumber: e.orderNumber,
    items: e.items,
    totalPieces,
    source: e.source,
  });
  save(list);
  try { window.dispatchEvent(new Event('dtpos-token-ledger-change')); } catch {}
}

export function getTokenEntries(dateKey?: string): TokenEntry[] {
  const list = load();
  return dateKey ? list.filter(e => e.dateKey === dateKey) : list;
}

export function getTokenSummary(dateKey: string) {
  const entries = getTokenEntries(dateKey);
  const perItem = new Map<string, number>();
  let totalPieces = 0;
  for (const e of entries) {
    totalPieces += e.totalPieces;
    for (const it of e.items) perItem.set(it.name, (perItem.get(it.name) || 0) + it.qty);
  }
  return {
    tokenCount: entries.length,
    totalPieces,
    perItem: Array.from(perItem.entries()).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
    entries: entries.slice().reverse(),
  };
}
