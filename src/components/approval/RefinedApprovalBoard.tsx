// v1.140.0 — Online order approval in the design's shape (SW-07): "Awaiting approval — 3 orders · auto-refreshing", All · Website · QR · Order taker,
// and a white card per order — the source and how long it has waited, what it is, the items, the total, Reject · Accept.
// What the old page had beyond that is one click away: the processing mode (Auto / Manual, and per source) behind "Processing mode",
// the history behind "History", and on each card ⋯ — call, WhatsApp, block the customer.
// The page owns the orders and the saving; this is the picture and the clicks.
import { useState } from 'react';
import { Check, History, MessageCircle, MoreHorizontal, Phone, SlidersHorizontal, UserX, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { money } from '@/lib/currency';
import { REJECT_REASONS, SOURCE_LABELS } from '@/lib/onlineApproval';
import { itemLine } from '@/lib/kitchenBoard';
import type { ApprovalMode, ApprovalModeSetting, OnlineSourceKey, Order } from '@/lib/types';
import {
  APPROVAL_FILTERS, approvalAge, approvalLine, approvalSubtitle, groupApprovals, sourceBadge, waitingCounts, type ApprovalFilter,
} from '@/lib/approvalBoard';

const SOURCE_KEYS: OnlineSourceKey[] = ['website', 'takeaway_qr', 'qr', 'order_taker', 'delivery'];

export interface RefinedApprovalBoardProps {
  orders: Order[];
  globalMode: ApprovalMode;
  sourceModes: Partial<Record<OnlineSourceKey, ApprovalModeSetting>>;
  onGlobalMode: (m: ApprovalMode) => void;
  onSourceMode: (k: OnlineSourceKey, m: ApprovalModeSetting) => void;
  onApprove: (o: Order) => void;
  /** The reason as chosen, and the optional note. */
  onReject: (o: Order, reason: string, note: string) => void;
  onBlock: (o: Order) => void;
  now?: number;
}

const whatsappLink = (phone: string, no?: number) => {
  const num = (phone || '').replace(/\D/g, '');
  return num ? `https://wa.me/${num.startsWith('0') ? '92' + num.slice(1) : num}?text=${encodeURIComponent(`Hello! I would like to talk about your order #${no || ''}.`)}` : '';
};
const when = (iso?: string) => { try { return iso ? new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—'; } catch { return iso || '—'; } };

function CardMenu({ o, p }: { o: Order; p: RefinedApprovalBoardProps }) {
  const [open, setOpen] = useState(false);
  const phone = o.customer?.phone || '';
  const close = () => setOpen(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-ap-more aria-label={`More for order ${o.orderNumber}`} className="ap-more"><MoreHorizontal className="h-4 w-4" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5" data-ap-menu>
        <p className="ap-menu-meta">{[when(o.createdAt), o.paymentMethod, phone].filter(Boolean).join(' · ')}</p>
        {o.customer?.address && <p className="ap-menu-meta ap-menu-addr">{o.customer.address}</p>}
        {phone && <a className="ap-menu-item" href={`tel:${phone}`} onClick={close}><Phone className="h-4 w-4" />Call customer</a>}
        {phone && <a className="ap-menu-item" href={whatsappLink(phone, o.orderNumber)} target="_blank" rel="noreferrer" onClick={close}><MessageCircle className="h-4 w-4" />WhatsApp</a>}
        {phone && <button type="button" className="ap-menu-item ap-menu-danger" data-ap-block onClick={() => { close(); p.onBlock(o); }}><UserX className="h-4 w-4" />Block this customer</button>}
        {!phone && <p className="ap-menu-meta">No phone number on this order.</p>}
      </PopoverContent>
    </Popover>
  );
}

function Card({ o, history, p, now, onAskReject }: { o: Order; history: boolean; p: RefinedApprovalBoardProps; now: number; onAskReject: (o: Order) => void }) {
  const age = approvalAge(o.createdAt, now);
  const rejected = o.status === 'rejected';
  return (
    <article data-ap-card data-source={sourceBadge(o)} className="ap-card">
      <div className="ap-top">
        <b className="ap-num">#{o.orderNumber}</b>
        <span className="ap-badge" data-ap-source>{sourceBadge(o)}</span>
        <span className="ap-age" data-tone={age.tone} data-ap-age>{age.label}</span>
        <CardMenu o={o} p={p} />
      </div>
      <div className="ap-line" title={o.customer?.address || undefined}>{approvalLine(o)}</div>
      <div className="ap-items">
        {o.items.map(it => (
          <div key={it.id}>{itemLine(it)}{it.note && <span className="ap-note"> — {it.note}</span>}</div>
        ))}
        {o.notes && <div className="ap-note" data-ap-note>{o.notes}</div>}
      </div>
      <div className="ap-total"><b>Total</b><b className="ap-amount">{money(o.grandTotal)}</b></div>
      {history ? (
        <div className="ap-result" data-ap-result data-rejected={rejected ? '' : undefined}>
          {rejected
            ? <><b>Rejected</b> — {o.rejectedReason || 'no reason'} · {o.rejectedByName || '—'} · {when(o.rejectedAt)}</>
            : <><b>Accepted</b> by {o.approvedByName || '—'} · {when(o.approvedAt)}</>}
        </div>
      ) : (
        <div className="ap-actions">
          <button type="button" data-ap-action="reject" className="ap-btn ap-btn-bad" onClick={() => onAskReject(o)}><X aria-hidden className="h-4 w-4" />Reject</button>
          <button type="button" data-ap-action="accept" className="ap-btn ap-btn-primary" onClick={() => p.onApprove(o)}><Check aria-hidden className="h-4 w-4" />Accept</button>
        </div>
      )}
    </article>
  );
}

export default function RefinedApprovalBoard(p: RefinedApprovalBoardProps) {
  const now = p.now ?? Date.now();
  const [filter, setFilter] = useState<ApprovalFilter>('all');
  const [history, setHistory] = useState(false);
  const [rejecting, setRejecting] = useState<Order | null>(null);
  const [reason, setReason] = useState<string>(REJECT_REASONS[0]);
  const [note, setNote] = useState('');
  const counts = waitingCounts(p.orders);
  const groups = groupApprovals(p.orders, filter);
  const list = history ? groups.history : groups.pending;

  const submit = () => {
    if (!rejecting) return;
    p.onReject(rejecting, reason, note.trim());
    setRejecting(null); setNote(''); setReason(REJECT_REASONS[0]);
  };
  return (
    <div data-ap-board className="ap-root">
      <div className="ap-head">
        <div className="ap-titles">
          <h1 data-ap-title>{history ? 'Decided orders' : 'Awaiting approval'}</h1>
          <p data-ap-subtitle>{approvalSubtitle(list.length, history)}</p>
        </div>
        <div className="ap-head-actions">
          <div className="ap-seg" role="tablist" aria-label="Source">
            {APPROVAL_FILTERS.map(f => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} data-on={filter === f.key ? '' : undefined} onClick={() => setFilter(f.key)}>
                {f.label}{!history && f.key !== 'all' && counts[f.key] > 0 && <i className="ap-seg-n">{counts[f.key]}</i>}
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ap-ghost" data-ap-mode><SlidersHorizontal aria-hidden className="h-4 w-4" />{p.globalMode === 'manual' ? 'Manual approval' : 'Auto processing'}</button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[22rem] p-3" data-ap-mode-panel>
              <p className="ap-mode-h">Processing mode</p>
              <p className="ap-mode-sub">Manual = someone accepts each order first · Auto = straight to the kitchen</p>
              <div className="ap-mode-pair" role="group" aria-label="Processing mode">
                <button type="button" aria-pressed={p.globalMode === 'auto'} onClick={() => p.onGlobalMode('auto')}>Auto processing</button>
                <button type="button" aria-pressed={p.globalMode === 'manual'} onClick={() => p.onGlobalMode('manual')}>Manual approval</button>
              </div>
              <div className="ap-mode-grid">
                {SOURCE_KEYS.map(k => (
                  <label key={k}>
                    <span>{SOURCE_LABELS[k]}</span>
                    <select value={p.sourceModes[k] || 'inherit'} onChange={e => p.onSourceMode(k, e.target.value as ApprovalModeSetting)} aria-label={`${SOURCE_LABELS[k]} mode`}>
                      <option value="inherit">Inherit (global)</option><option value="auto">Auto</option><option value="manual">Manual</option>
                    </select>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <button type="button" className="ap-ghost" aria-pressed={history} data-ap-history onClick={() => setHistory(h => !h)}><History aria-hidden className="h-4 w-4" />{history ? 'Back to waiting' : 'History'}</button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="ap-empty" data-ap-empty>{history ? 'No decided orders yet.' : filter === 'all' ? 'Nothing is waiting for approval.' : `No ${APPROVAL_FILTERS.find(f => f.key === filter)!.label.toLowerCase()} orders are waiting.`}</div>
      ) : (
        <div className="ap-grid">{list.map(o => <Card key={o.id} o={o} history={history} p={p} now={now} onAskReject={setRejecting} />)}</div>
      )}

      <Dialog open={!!rejecting} onOpenChange={v => { if (!v) setRejecting(null); }}>
        <DialogContent className="max-w-md" data-ap-reject>
          <DialogHeader>
            <DialogTitle>Reject order #{rejecting?.orderNumber}</DialogTitle>
            <DialogDescription>The customer sees the reason when they track the order.</DialogDescription>
          </DialogHeader>
          <label className="ap-field"><span>Reason</span>
            <select value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason">{REJECT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}</select>
          </label>
          <label className="ap-field"><span>Additional note (optional)</span>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} aria-label="Additional note" />
          </label>
          <DialogFooter>
            <button type="button" className="ap-btn ap-btn-ghost" onClick={() => setRejecting(null)}>Cancel</button>
            <button type="button" className="ap-btn ap-btn-bad" data-ap-confirm-reject onClick={submit}>Reject order</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
