// v1.149.0 — the money screen in the design's shape (SW-25): three figure cards, a search with the categories as chips, and the entries as one table
// (Date · Category · Account · Note · Amount). The page owns the data and the saving (the Add form, deleting); this is the picture and the clicks.
import { useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import KpiCard from '@/components/ui-kit/KpiCard';
import { money } from '@/lib/currency';
import type { LucideIcon } from 'lucide-react';
import type { AccountCategory, Transaction, TxnType } from '@/lib/types';
import { accountWord, categoryChips, dayLabel, txnRows } from '@/lib/accountsBoard';

export interface AccountsCard { label: string; value: number; icon: LucideIcon; caption?: string; tone?: 'ok' | 'bad' }

const PAGE = 100;

export default function RefinedTxnView({ type, txns, cats, cards, onDelete }: {
  type: TxnType; txns: Transaction[]; cats: AccountCategory[]; cards: AccountsCard[]; onDelete: (t: Transaction) => void;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const chips = categoryChips(cats, type);
  const rows = txnRows(txns, type, cat, q);
  const word = type === 'income' ? 'income' : 'expenses';

  return (
    <div data-ac-view={type} className="ac-view">
      <div className="ac-kpis">
        {cards.map(c => <KpiCard key={c.label} label={c.label} value={money(c.value)} icon={c.icon} caption={c.caption} captionTone={c.tone} />)}
      </div>
      <div className="ac-filters" role="search" aria-label={`Filter ${word}`}>
        <label className="ac-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label={`Search ${word}`} placeholder="Search accounts & expenses…" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} /></label>
        <div role="group" aria-label="Category" className="ac-chips">
          {chips.map(c => <button key={c.key} type="button" data-ac-chip={c.key} aria-pressed={cat === c.key} className="ac-chip" onClick={() => { setCat(c.key); setShown(PAGE); }}>{c.label}</button>)}
        </div>
      </div>
      <div className="ac-card" data-ac-table>
        {rows.length === 0 ? (
          <div className="ac-empty" data-ac-empty>{txns.some(t => t.type === type) ? 'Nothing matches.' : type === 'income' ? 'No income entries yet. Add the first one with “Add income”.' : 'No expenses yet. Add the first one with “Add expense”.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table data-roomy className="w-full text-[14px]">
              <thead><tr><th>Date</th><th>Category</th><th className="hidden sm:table-cell">Account</th><th>Note</th><th className="text-right">Amount</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {rows.slice(0, shown).map(t => (
                  <tr key={t.id} data-ac-row={t.id}>
                    <td className="ac-nowrap">{dayLabel(t.date)}</td>
                    <td>{t.categoryName || '—'}<span className="ac-sub ac-sub-phone">{accountWord(t.paymentMethod)}</span></td>
                    <td className="hidden sm:table-cell">{accountWord(t.paymentMethod)}</td>
                    <td>{t.description || '—'}{(t.partyName || t.reference) && <span className="ac-sub">{[t.partyName, t.reference].filter(Boolean).join(' · ')}</span>}</td>
                    <td className="ac-amount ac-nowrap">{money(t.amount)}</td>
                    <td className="ac-actions"><button type="button" className="ac-del" aria-label="Delete" onClick={() => onDelete(t)}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown && <button type="button" className="ac-more" data-ac-more onClick={() => setShown(n => n + PAGE)}>Show more ({rows.length - shown} more)</button>}
      </div>
    </div>
  );
}
