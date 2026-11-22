// v1.141.0 — Credits (Udhaar) in the design's shape (SW-33): "Rs 148,600 outstanding · 11 customers", a search with All · Over 30 days · Over 60 days,
// the customers who owe (biggest first, how long their oldest bill has waited, a Receive button), and the selected customer's ledger beside it.
// The page owns the money (receiving, deleting a payment, printing); this is the picture and the clicks.
import { useEffect, useState } from 'react';
import { HandCoins, MoreHorizontal, Phone, Printer, Search, Trash2, UserX } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import MasterDetail, { useWideScreen } from '@/components/layout/MasterDetail';
import { money } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { CreditPayment, Order } from '@/lib/types';
import {
  CREDIT_FILTERS, creditLedger, creditSubtitle, matchesFilter, matchesSearch, oldestLabel, type CreditCustomer, type CreditFilter, type LedgerEntry,
} from '@/lib/creditLedger';

export interface RefinedCreditsProps {
  customers: CreditCustomer[];
  payments: CreditPayment[];
  onReceive: (c: CreditCustomer) => void;
  onPrintBill: (o: Order) => void;
  onDeletePayment: (paymentId: string) => void;
  onBlock: (c: CreditCustomer) => void;
}

function EntryMenu({ e, c, p }: { e: LedgerEntry; c: CreditCustomer; p: RefinedCreditsProps }) {
  const [open, setOpen] = useState(false);
  const order = c.bills.find(b => b.order.id === e.orderId)?.order;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-cr-entry-more aria-label={`More for ${e.label}`} className="cr-more"><MoreHorizontal className="h-4 w-4" /></button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1.5" data-cr-entry-menu>
        {e.kind === 'bill' && order && <button type="button" className="cr-menu-item" data-cr-print onClick={() => { setOpen(false); p.onPrintBill(order); }}><Printer className="h-4 w-4" />Print credit parchi</button>}
        {e.kind === 'payment' && e.paymentId && <button type="button" className="cr-menu-item cr-menu-danger" data-cr-delete-payment onClick={() => { setOpen(false); p.onDeletePayment(e.paymentId!); }}><Trash2 className="h-4 w-4" />Delete this payment</button>}
      </PopoverContent>
    </Popover>
  );
}

function Panel({ c, p }: { c: CreditCustomer; p: RefinedCreditsProps }) {
  const entries = creditLedger(c, p.payments);
  return (
    <div data-cr-panel={c.key} className="cr-panel">
      <div className="cr-panel-head">
        <div className="min-w-0">
          <p className="cr-panel-owes" data-cr-owes>{c.owes > 0 ? `Owes ${money(c.owes)}` : 'Settled — owes nothing'}</p>
          {(c.phone || c.address) && <p className="cr-panel-contact">{[c.phone, c.address].filter(Boolean).join(' · ')}</p>}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="cr-more" aria-label={`More for ${c.name}`} data-cr-customer-more><MoreHorizontal className="h-4 w-4" /></button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1.5">
            {c.phone && <a className="cr-menu-item" href={`tel:${c.phone}`}><Phone className="h-4 w-4" />Call customer</a>}
            <button type="button" className="cr-menu-item cr-menu-danger" data-cr-block onClick={() => p.onBlock(c)}><UserX className="h-4 w-4" />Block customer</button>
          </PopoverContent>
        </Popover>
      </div>
      <ul className="cr-ledger" data-cr-ledger>
        {entries.map(e => (
          <li key={e.id} data-cr-entry={e.kind}>
            <div className="min-w-0">
              <span className="cr-entry-label">{e.label}</span>
              <span className="cr-entry-note">{new Date(e.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{e.note ? ` · ${e.note}` : ''}</span>
            </div>
            <b className="cr-entry-amount" data-sign={e.amount >= 0 ? 'plus' : 'minus'}>{e.amount >= 0 ? '+ ' : '− '}{money(Math.abs(e.amount))}</b>
            <EntryMenu e={e} c={c} p={p} />
          </li>
        ))}
        {entries.length === 0 && <li className="cr-ledger-empty">No bills on credit yet.</li>}
      </ul>
      <button type="button" className="cr-btn cr-btn-primary" data-cr-receive-panel disabled={c.owes <= 0} onClick={() => p.onReceive(c)}><HandCoins aria-hidden className="h-4 w-4" />Receive payment</button>
    </div>
  );
}

export default function RefinedCredits(p: RefinedCreditsProps) {
  const wide = useWideScreen();
  const [filter, setFilter] = useState<CreditFilter>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const shown = p.customers.filter(c => matchesFilter(c, filter) && matchesSearch(c, q));
  const current = p.customers.find(c => c.key === selected && shown.some(s => s.key === c.key)) || null;

  // On a wide window the panel is never empty: the biggest debtor is open until the user closes it.
  useEffect(() => { setClosed(false); }, [filter]);
  useEffect(() => { if (wide && !closed && shown.length > 0 && !shown.some(c => c.key === selected)) setSelected(shown[0].key); }, [wide, closed, shown, selected]);

  const chip = 'cr-chip';
  return (
    <div data-cr-page className="cr-root">
      <div className="cr-head">
        <div className="cr-titles"><h1 data-cr-title>Credits (Udhaar)</h1><p data-cr-subtitle>{creditSubtitle(p.customers, money)}</p></div>
        {current ? (
          <button type="button" className="cr-btn cr-btn-primary cr-btn-lg" data-cr-receive disabled={current.owes <= 0} onClick={() => p.onReceive(current)}>
            <HandCoins aria-hidden className="h-4 w-4" />Receive payment
          </button>
        ) : (
          /* nobody picked yet (a narrow window): choose who is paying */
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="cr-btn cr-btn-primary cr-btn-lg" data-cr-receive data-cr-pick disabled={p.customers.every(c => c.owes <= 0)}><HandCoins aria-hidden className="h-4 w-4" />Receive payment</button>
            </PopoverTrigger>
            <PopoverContent align="end" className="max-h-80 w-72 overflow-y-auto p-1.5" data-cr-picker>
              <p className="cr-menu-meta">Who is paying?</p>
              {p.customers.filter(c => c.owes > 0).map(c => (
                <button key={c.key} type="button" className="cr-menu-item" data-cr-pick-row={c.key} onClick={() => p.onReceive(c)}>{c.name}<span className="cr-menu-sub">{money(c.owes)}</span></button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className="cr-filters" role="search" aria-label="Filter credits">
        <label className="cr-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label="Search credits" placeholder="Search credits (udhaar)…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div role="group" aria-label="Age" className="cr-chips">
          {CREDIT_FILTERS.map(f => <button key={f.key} type="button" data-cr-filter={f.key} aria-pressed={filter === f.key} className={chip} onClick={() => setFilter(f.key)}>{f.label}</button>)}
        </div>
      </div>
      <MasterDetail
        title={current ? current.name : 'Customer'} open={!!current} onClose={() => { setSelected(null); setClosed(true); }}
        emptyText="Select a customer to see their ledger." dialogClassName="sm:max-w-md max-h-[90vh] overflow-y-auto" panelWidth={360}
        detail={current ? <Panel c={current} p={p} /> : null}
        list={
          <div className="cr-table-card" data-cr-table>
            {shown.length === 0 ? (
              <div className="cr-empty" data-cr-empty>{p.customers.length === 0 ? 'No credit (udhaar) yet. Sell on credit from the POS and it appears here.' : 'No customers match.'}</div>
            ) : (
              <div className="overflow-x-auto">
                <table data-roomy className="w-full text-[14px]">
                  <thead><tr><th>Customer</th><th className="hidden sm:table-cell">Phone</th><th className="text-right">Owes</th><th className="hidden md:table-cell">Oldest bill</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {shown.map(c => (
                      <tr key={c.key} data-cr-row={c.key} aria-selected={current?.key === c.key} tabIndex={0}
                        onClick={() => { setSelected(c.key); setClosed(false); }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(c.key); setClosed(false); } }}
                        className={cn(current?.key === c.key && 'cr-row-on')}>
                        <td className="cr-cell-name">{c.name}</td>
                        <td className="hidden sm:table-cell cr-cell-phone">{c.phone || '—'}</td>
                        <td className="text-right cr-cell-owes" data-zero={c.owes <= 0 ? '' : undefined}>{money(c.owes)}</td>
                        <td className="hidden md:table-cell">{oldestLabel(c.oldestDays)}</td>
                        <td className="text-right"><button type="button" data-cr-receive-row className="cr-btn cr-btn-ghost" disabled={c.owes <= 0} onClick={e => { e.stopPropagation(); p.onReceive(c); }}>Receive</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
