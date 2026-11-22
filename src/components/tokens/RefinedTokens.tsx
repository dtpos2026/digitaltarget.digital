// v1.142.0 — Tokens in the design's shape (SW-36): "Tokens · Counter service", Reset counter, the waiting tokens as large numbers with their state
// (Ready · Cooking · New) and a history table (Token · Bill · Time · Status · Reprints). Tap a number to Call it, Complete it, Reprint it or Cancel it.
// The page owns the saving and the printing; this is the picture and the clicks.
import { useState } from 'react';
import { CheckCircle2, Megaphone, MoreHorizontal, Printer, RotateCcw, Search, SlidersHorizontal, XCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { money } from '@/lib/currency';
import type { Order } from '@/lib/types';
import { activeTokens, historyTokens, statusWord, TOKEN_STATE_LABEL, tokenState, tokenStatusOf, type HistoryFilter } from '@/lib/tokenBoard';

export interface RefinedTokensProps {
  orders: Order[];
  subtitle: string;
  showMoney: boolean;
  canReprint: boolean;
  canCancel: boolean;
  canReset: boolean;
  cashiers: string[];
  onCall: (o: Order) => void;
  onComplete: (o: Order) => void;
  onReprint: (o: Order) => void;
  onCancel: (o: Order) => void;
  onReset: () => void;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const label = (o: Order) => String(o.tokenLabel || o.tokenNumber || '');

function ActionList({ o, p, close }: { o: Order; p: RefinedTokensProps; close: () => void }) {
  const waiting = tokenStatusOf(o) === 'pending';
  const run = (fn: (o: Order) => void) => () => { close(); fn(o); };
  return (
    <>
      <p className="tk-menu-meta">{[`Bill #${o.orderNumber}`, (o.items || []).map(i => i.name).join(', '), o.cashierName, p.showMoney ? money(o.grandTotal || 0) : ''].filter(Boolean).join(' · ')}</p>
      {waiting && <button type="button" className="tk-menu-item" data-tk-call onClick={run(p.onCall)}><Megaphone className="h-4 w-4" />Call token</button>}
      {waiting && <button type="button" className="tk-menu-item" data-tk-complete onClick={run(p.onComplete)}><CheckCircle2 className="h-4 w-4" />Complete — collected</button>}
      <button type="button" className="tk-menu-item" data-tk-reprint disabled={!p.canReprint} onClick={run(p.onReprint)}><Printer className="h-4 w-4" />Reprint</button>
      {tokenStatusOf(o) !== 'cancelled' && <button type="button" className="tk-menu-item tk-menu-danger" data-tk-cancel disabled={!p.canCancel} onClick={run(p.onCancel)}><XCircle className="h-4 w-4" />Cancel token</button>}
    </>
  );
}

function Tile({ o, p }: { o: Order; p: RefinedTokensProps }) {
  const [open, setOpen] = useState(false);
  const st = tokenState(o);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-tk-tile={label(o)} data-state={st} aria-label={`Token ${label(o)} — ${TOKEN_STATE_LABEL[st]}`} className="tk-tile">
          <b className="tk-num">{label(o)}</b>
          <span className="tk-chip" data-state={st}>{TOKEN_STATE_LABEL[st]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 p-1.5" data-tk-menu><ActionList o={o} p={p} close={() => setOpen(false)} /></PopoverContent>
    </Popover>
  );
}

function RowMenu({ o, p }: { o: Order; p: RefinedTokensProps }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="tk-more" aria-label={`More for token ${label(o)}`} data-tk-row-more><MoreHorizontal className="h-4 w-4" /></button></PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5" data-tk-menu><ActionList o={o} p={p} close={() => setOpen(false)} /></PopoverContent>
    </Popover>
  );
}

export default function RefinedTokens(p: RefinedTokensProps) {
  const [f, setF] = useState<HistoryFilter>({ range: 'today', q: '', from: '', to: '', cashier: '' });
  const waiting = activeTokens(p.orders);
  const history = historyTokens(p.orders, f);
  const set = (patch: Partial<HistoryFilter>) => setF(x => ({ ...x, ...patch }));
  return (
    <div data-tk-page className="tk-root">
      <div className="tk-head">
        <div className="tk-titles"><h1 data-tk-title>Tokens</h1><p data-tk-subtitle>{p.subtitle}</p></div>
        <button type="button" className="tk-btn" data-tk-reset disabled={!p.canReset} title={p.canReset ? undefined : 'Only an Admin or Manager can reset the counter'} onClick={p.onReset}><RotateCcw aria-hidden className="h-4 w-4" />Reset counter</button>
      </div>

      <div className="tk-tiles" data-tk-tiles>
        {waiting.map(o => <Tile key={o.id} o={o} p={p} />)}
        {waiting.length === 0 && <div className="tk-quiet" data-tk-none>No token is waiting.</div>}
      </div>

      <div className="tk-card" data-tk-history>
        <div className="tk-bar">
          <b>History</b>
          <label className="tk-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label="Search tokens" placeholder="Token, item or bill no" value={f.q} onChange={e => set({ q: e.target.value })} /></label>
          <div className="tk-seg" role="group" aria-label="Period">
            <button type="button" aria-pressed={f.range === 'today'} onClick={() => set({ range: 'today' })}>Today</button>
            <button type="button" aria-pressed={f.range === 'all'} onClick={() => set({ range: 'all' })}>All time</button>
          </div>
          <Popover>
            <PopoverTrigger asChild><button type="button" className="tk-btn tk-btn-sm" data-tk-filters><SlidersHorizontal aria-hidden className="h-4 w-4" />Filters</button></PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3" data-tk-filter-panel>
              <label className="tk-field"><span>From</span><input type="date" aria-label="From date" value={f.from} onChange={e => set({ from: e.target.value })} /></label>
              <label className="tk-field"><span>To</span><input type="date" aria-label="To date" value={f.to} onChange={e => set({ to: e.target.value })} /></label>
              <label className="tk-field"><span>Cashier</span>
                <select aria-label="Cashier" value={f.cashier} onChange={e => set({ cashier: e.target.value })}><option value="">All cashiers</option>{p.cashiers.map(c => <option key={c} value={c}>{c}</option>)}</select>
              </label>
            </PopoverContent>
          </Popover>
        </div>
        {history.length === 0 ? (
          <div className="tk-quiet tk-quiet-pad" data-tk-empty>{p.orders.length === 0 ? 'No tokens yet. Sell a token item from the POS and it appears here.' : 'No tokens match.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table data-roomy className="w-full text-[14px]">
              <thead><tr><th>Token</th><th>Bill</th><th>Time</th><th>Status</th><th>Reprints</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {history.map(o => (
                  <tr key={o.id} data-tk-row={label(o)}>
                    <td className="tk-cell-token">{label(o)}</td>
                    <td>#{o.orderNumber}</td>
                    <td className="tabular-nums">{timeOf(o.createdAt)}</td>
                    <td><span className="tk-pill" data-status={tokenStatusOf(o)}>{statusWord(o)}</span></td>
                    <td className="tabular-nums">{o.tokenReprintCount || 0}</td>
                    <td className="text-right"><RowMenu o={o} p={p} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
