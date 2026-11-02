// ============================================================
// STOCK TRANSFERS — the screens (v1.87.0), shared by the desktop Branch Management page and the Owner app.
//
// A list (what is on the road first), "New transfer" (from, to, items with what each branch has), Receive (what
// arrived, line by line — a shortfall is recorded) and Cancel (back into the sender's stock). Who may do what follows
// branch access: send and cancel need the sending branch, receive needs the receiving one. The database enforces the
// same rule on every stock row.
// ============================================================
import { useMemo, useState } from 'react';
import { ArrowRight, PackagePlus, Search, Trash2, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { getBranches, getInventory, getStockTransfers } from '@/lib/store';
import { branchItems, parseReceived, transferTotals, transfersFor, validateTransfer } from '@/lib/branchHub';
import { cancelTransfer, receiveTransfer, sendTransfer } from '@/lib/stockTransfers';
import type { StockTransfer } from '@/lib/types';
import { cn } from '@/lib/utils';
import { rs, useLiveTick } from '@/components/owner/ownerHooks';

export interface TransferCaps {
  /** May this user act for the branch (send/cancel from it, receive into it)? */
  can: (branchId: string) => boolean;
  /** Whether the user may move stock at all (the Inventory module). */
  stock: boolean;
  by: string;
}

const STATUS: Record<StockTransfer['status'], { label: string; cls: string }> = {
  in_transit: { label: 'In transit', cls: 'bg-amber-100 text-amber-800' },
  received: { label: 'Received', cls: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground' },
};
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

function Sheet({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-[640px] space-y-3 overflow-y-auto rounded-t-3xl bg-background p-5 md:rounded-3xl" data-testid={testId}>
        <div className="flex items-center justify-between">
          <h2 className="text-[19px] font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl border bg-card"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NewTransferSheet({ caps, defaultFrom, onClose }: { caps: TransferCaps; defaultFrom?: string; onClose: () => void }) {
  const branches = getBranches().filter(b => b.isActive !== false);
  const senders = branches.filter(b => caps.can(b.id));
  const [from, setFrom] = useState(defaultFrom && caps.can(defaultFrom) ? defaultFrom : senders[0]?.id || '');
  const [to, setTo] = useState(branches.find(b => b.id !== (defaultFrom || senders[0]?.id))?.id || '');
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const stock = branchItems(getInventory(), from);
  const draft = { fromBranchId: from, toBranchId: to, lines: lines.map(l => ({ itemId: l.itemId, qty: Number(l.qty) })), note };
  const errors = validateTransfer(draft, getInventory());
  const picks = stock.filter(i => !lines.some(l => l.itemId === i.id) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 8);

  const send = () => {
    setTried(true);
    if (errors.length) return;
    const r = sendTransfer(draft, caps.by);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`${r.transfer.number} sent — ${r.transfer.lines.length} item${r.transfer.lines.length === 1 ? '' : 's'} on the way`);
    onClose();
  };

  return (
    <Sheet title="New stock transfer" onClose={onClose} testId="transfer-sheet">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label className="text-[12.5px] font-semibold text-muted-foreground">From
          <select value={from} onChange={e => { setFrom(e.target.value); setLines([]); }} aria-label="From branch" className="mt-1 h-11 w-full rounded-xl border bg-card px-2 text-[14px] font-semibold text-foreground">
            {senders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <ArrowRight className="mb-3 h-4 w-4 text-muted-foreground" />
        <label className="text-[12.5px] font-semibold text-muted-foreground">To
          <select value={to} onChange={e => setTo(e.target.value)} aria-label="To branch" className="mt-1 h-11 w-full rounded-xl border bg-card px-2 text-[14px] font-semibold text-foreground">
            {branches.filter(b => b.id !== from).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        {lines.map((l, idx) => {
          const item = stock.find(i => i.id === l.itemId);
          return (
            <div key={l.itemId} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{item?.name}</div>
                <div className="text-[12px] text-muted-foreground">In stock: {Number(item?.quantity) || 0} {item?.baseUnit || item?.unit}</div>
              </div>
              <input inputMode="decimal" value={l.qty} onChange={e => setLines(ls => ls.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} aria-label={`Quantity of ${item?.name}`} className="h-10 w-24 rounded-lg border bg-background px-2 text-right text-[15px] font-bold tabular-nums outline-none" />
              <button type="button" onClick={() => setLines(ls => ls.filter((_, i) => i !== idx))} aria-label={`Remove ${item?.name}`} className="grid h-10 w-10 place-items-center rounded-lg border bg-background text-muted-foreground"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border bg-card p-2">
        <label className="flex h-10 items-center gap-2 px-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={stock.length ? 'Add an item from this branch’s stock' : 'This branch has no stock recorded'} aria-label="Find an item to send" className="min-w-0 flex-1 bg-transparent text-[14px] outline-none" />
        </label>
        <ul className="divide-y">
          {picks.map(i => (
            <li key={i.id}>
              <button type="button" onClick={() => { setLines(ls => [...ls, { itemId: i.id, qty: '' }]); setQ(''); }} className="flex w-full items-center gap-2 px-2 py-2 text-left text-[14px] hover:bg-muted">
                <PackagePlus className="h-4 w-4 text-primary" /><span className="flex-1 truncate">{i.name}</span>
                <span className="text-[12.5px] text-muted-foreground tabular-nums">{Number(i.quantity) || 0} {i.baseUnit || i.unit}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional) — e.g. for the weekend rush" aria-label="Note" className="h-11 w-full rounded-xl border bg-card px-3 text-[14px] outline-none" />
      <p className="text-[12.5px] text-muted-foreground">The stock leaves {branches.find(b => b.id === from)?.name || 'the sending branch'} when you send; it reaches {branches.find(b => b.id === to)?.name || 'the other branch'} when they receive it.</p>
      {tried && errors.length > 0 && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-700">{errors[0]}</div>}
      <button type="button" onClick={send} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-[15px] font-bold text-primary-foreground" data-testid="send-transfer">
        <Truck className="h-5 w-5" /> Send now
      </button>
    </Sheet>
  );
}

function ReceiveSheet({ t, caps, onClose }: { t: StockTransfer; caps: TransferCaps; onClose: () => void }) {
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(t.lines.map(l => [l.id, String(l.qty)])));
  const [error, setError] = useState('');
  const receive = () => {
    const received: Record<string, number> = {};
    for (const l of t.lines) {
      const v = parseReceived(got[l.id] ?? '', l.qty);
      if (v === null) { setError(`${l.itemName}: between 0 and ${l.qty}`); return; }
      received[l.id] = v;
    }
    const r = receiveTransfer(t.id, caps.by, received);
    if (!r.ok) { setError(r.error); return; }
    const short = transferTotals(r.transfer).shortfall;
    toast.success(`${t.number} received${short > 0 ? ` — ${short} short, recorded` : ''}`);
    onClose();
  };
  return (
    <Sheet title={`Receive ${t.number}`} onClose={onClose} testId="receive-sheet">
      <p className="text-[13.5px] text-muted-foreground">Count what arrived. Less than was sent is recorded as a shortfall on the transfer.</p>
      <ul className="space-y-2">
        {t.lines.map(l => (
          <li key={l.id} className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2">
            <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold">{l.itemName}</div><div className="text-[12px] text-muted-foreground">Sent {l.qty} {l.unit}</div></div>
            <input inputMode="decimal" value={got[l.id] ?? ''} onChange={e => setGot(g => ({ ...g, [l.id]: e.target.value }))} aria-label={`Received ${l.itemName}`} className="h-10 w-24 rounded-lg border bg-background px-2 text-right text-[15px] font-bold tabular-nums outline-none" />
          </li>
        ))}
      </ul>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-700">{error}</div>}
      <button type="button" onClick={receive} className="w-full rounded-2xl bg-primary py-3.5 text-[15px] font-bold text-primary-foreground" data-testid="confirm-receive">Receive into stock</button>
    </Sheet>
  );
}

export function TransferList({ caps, branchId, compact }: { caps: TransferCaps; branchId?: string; compact?: boolean }) {
  const tick = useLiveTick(['stockTransfers', 'inventory']);
  const [version, bump] = useState(0);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [newOpen, setNewOpen] = useState(false);
  const [receiving, setReceiving] = useState<StockTransfer | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const names = useMemo(() => new Map(getBranches().map(b => [b.id, b.name] as const)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => transfersFor(getStockTransfers(), branchId), [tick, version, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = filter === 'open' ? all.filter(t => t.status === 'in_transit') : all;
  const branchCount = names.size;
  const close = () => { setNewOpen(false); setReceiving(null); bump(x => x + 1); };

  const doCancel = (t: StockTransfer) => {
    const r = cancelTransfer(t.id, caps.by, reason);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`${t.number} cancelled — stock is back at ${names.get(t.fromBranchId) || 'the sender'}`);
    setCancelling(null); setReason(''); bump(x => x + 1);
  };

  return (
    <div className="space-y-3" data-testid="transfer-list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Transfers" className="inline-flex gap-1 rounded-xl bg-muted p-1">
          {([['open', `In transit (${all.filter(t => t.status === 'in_transit').length})`], ['all', `All (${all.length})`]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={cn('h-8 rounded-[9px] px-3 text-[13px] font-semibold', filter === id ? 'bg-card shadow-sm' : 'text-muted-foreground')}>{label}</button>
          ))}
        </div>
        {caps.stock && branchCount > 1 && (
          <button type="button" onClick={() => setNewOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-bold text-primary-foreground" data-testid="new-transfer">
            <Truck className="h-4 w-4" /> New transfer
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">
          {filter === 'open' ? 'Nothing is on the road between branches.' : 'No transfers yet.'}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(t => {
            const tot = transferTotals(t);
            const s = STATUS[t.status];
            const incoming = branchId && t.toBranchId === branchId;
            return (
              <li key={t.id} className="rounded-2xl border bg-card p-4" data-testid={`transfer-${t.number}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold">{t.number} · {names.get(t.fromBranchId) || 'Unknown branch'} <ArrowRight className="inline h-3.5 w-3.5" /> {names.get(t.toBranchId) || 'Unknown branch'}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {tot.lines} item{tot.lines === 1 ? '' : 's'} · {rs(tot.value)} at cost · sent {when(t.sentAt)}{t.sentBy ? ` by ${t.sentBy}` : ''}
                      {t.status === 'received' && ` · received ${when(t.receivedAt)}${t.receivedBy ? ` by ${t.receivedBy}` : ''}`}
                      {t.status === 'cancelled' && ` · cancelled ${when(t.cancelledAt)}${t.cancelReason ? ` — ${t.cancelReason}` : ''}`}
                    </div>
                  </div>
                  <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-bold', s.cls)}>{incoming && t.status === 'in_transit' ? 'Incoming' : s.label}</span>
                </div>
                {!compact && (
                  <ul className="mt-2 space-y-0.5 text-[13.5px]">
                    {t.lines.map(l => (
                      <li key={l.id} className="flex justify-between gap-2">
                        <span className="truncate">{l.itemName}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {t.status === 'received' && (l.receivedQty ?? l.qty) < l.qty ? <><b className="text-red-600">{l.receivedQty}</b> of </> : null}{l.qty} {l.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {tot.shortfall > 0 && <div className="mt-2 text-[13px] font-semibold text-red-600">Short on arrival: {tot.shortfall}</div>}
                {t.status === 'in_transit' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {caps.stock && caps.can(t.toBranchId) && (
                      <button type="button" onClick={() => setReceiving(t)} className="rounded-xl bg-primary px-4 py-2 text-[13.5px] font-bold text-primary-foreground" data-testid={`receive-${t.number}`}>Receive</button>
                    )}
                    {caps.stock && caps.can(t.fromBranchId) && (cancelling === t.id ? (
                      <div className="flex w-full flex-wrap items-center gap-2">
                        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why? (optional)" aria-label="Reason" className="h-10 min-w-0 flex-1 rounded-xl border bg-background px-3 text-[14px]" />
                        <button type="button" onClick={() => doCancel(t)} className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-[13.5px] font-bold text-red-700" data-testid={`confirm-cancel-${t.number}`}>Cancel transfer</button>
                        <button type="button" onClick={() => setCancelling(null)} className="rounded-xl border px-3 py-2 text-[13.5px]">Keep</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setCancelling(t.id)} className="rounded-xl border px-4 py-2 text-[13.5px] font-semibold" data-testid={`cancel-${t.number}`}>Cancel</button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {newOpen && <NewTransferSheet caps={caps} defaultFrom={branchId} onClose={close} />}
      {receiving && <ReceiveSheet t={receiving} caps={caps} onClose={close} />}
    </div>
  );
}
