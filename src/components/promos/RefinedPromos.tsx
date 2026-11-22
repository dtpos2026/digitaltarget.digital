// v1.144.0 — Promo codes in the design's shape (SW-34): "N codes", All · Active · Expired, and a table — Code · Discount · Valid · Used (with a bar) ·
// Active (a switch). A row opens the editor; the ⋯ has Edit, Copy code and Delete. The page owns the saving and the editor.
import { useState } from 'react';
import { Copy, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { money } from '@/lib/currency';
import type { PromoCode } from '@/lib/types';
import { discountLabel, isRunOut, matchesPromoFilter, matchesPromoQuery, promoState, promoSubtitle, PROMO_FILTERS, sortPromos, usedLabel, usedRatio, validLabel, type PromoFilter } from '@/lib/promoBoard';

export interface RefinedPromosProps {
  list: PromoCode[];
  onNew: () => void;
  onEdit: (p: PromoCode) => void;
  onToggle: (p: PromoCode, on: boolean) => void;
  onCopy: (p: PromoCode) => void;
  onDelete: (p: PromoCode) => void;
  now?: number;
}

function RowMenu({ p, props }: { p: PromoCode; props: RefinedPromosProps }) {
  const [open, setOpen] = useState(false);
  const run = (fn: (p: PromoCode) => void) => () => { setOpen(false); fn(p); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="pm-more" aria-label={`More for ${p.code}`} data-pm-more onClick={e => e.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></button></PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1.5" data-pm-menu>
        <button type="button" className="pm-menu-item" onClick={run(props.onEdit)}><Pencil className="h-4 w-4" />Edit</button>
        <button type="button" className="pm-menu-item" data-pm-copy onClick={run(props.onCopy)}><Copy className="h-4 w-4" />Copy code</button>
        <button type="button" className="pm-menu-item pm-menu-danger" data-pm-delete onClick={run(props.onDelete)}><Trash2 className="h-4 w-4" />Delete</button>
      </PopoverContent>
    </Popover>
  );
}

export default function RefinedPromos(props: RefinedPromosProps) {
  const now = props.now ?? Date.now();
  const [filter, setFilter] = useState<PromoFilter>('all');
  const [q, setQ] = useState('');
  const shown = sortPromos(props.list, now).filter(p => matchesPromoFilter(p, filter, now) && matchesPromoQuery(p, q));
  return (
    <div data-pm-page className="pm-root">
      <div className="pm-head">
        <div className="pm-titles"><h1 data-pm-title>Promo codes</h1><p data-pm-subtitle>{promoSubtitle(props.list.length)}</p></div>
        <button type="button" className="pm-btn pm-btn-primary" data-pm-new onClick={props.onNew}><Plus aria-hidden className="h-4 w-4" />New code</button>
      </div>
      <div className="pm-filters" role="search" aria-label="Filter promo codes">
        <label className="pm-search"><Search aria-hidden className="h-4 w-4" /><input type="search" aria-label="Search promo codes" placeholder="Search promo codes…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div role="group" aria-label="Status" className="pm-chips">
          {PROMO_FILTERS.map(f => <button key={f.key} type="button" data-pm-filter={f.key} aria-pressed={filter === f.key} className="pm-chip" onClick={() => setFilter(f.key)}>{f.label}</button>)}
        </div>
      </div>
      <div className="pm-card" data-pm-table>
        {shown.length === 0 ? (
          <div className="pm-empty" data-pm-empty>{props.list.length === 0 ? 'No promo codes yet. Click “New code” to create one.' : 'No codes match.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table data-roomy className="w-full text-[14px]">
              <thead><tr><th>Code</th><th>Discount</th><th className="hidden md:table-cell">Valid</th><th>Used</th><th>Active</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {shown.map(p => {
                  const st = promoState(p, now);
                  const ratio = usedRatio(p);
                  return (
                    <tr key={p.id} data-pm-row={p.code} data-state={st} tabIndex={0} onClick={() => props.onEdit(p)} onKeyDown={e => { if (e.key === 'Enter') props.onEdit(p); }}>
                      <td>
                        <span className="pm-code">{p.code}</span>
                        {(p.accountsOnly || p.showOnWebsite) && (
                          <span className="pm-tags">{p.accountsOnly && <i data-promo-badge-accounts>Account</i>}{p.showOnWebsite && <i data-promo-badge-public>On website</i>}</span>
                        )}
                      </td>
                      <td>{discountLabel(p, money)}</td>
                      <td className="hidden md:table-cell" data-pm-valid={st}>{validLabel(p, now)}</td>
                      <td>
                        <span className="tabular-nums">{usedLabel(p)}</span>
                        {ratio !== null && <span className="pm-bar" aria-hidden><i style={{ width: `${Math.round(ratio * 100)}%` }} data-full={ratio >= 1 ? '' : undefined} /></span>}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <Switch checked={p.isActive} disabled={isRunOut(st) && !p.isActive} onCheckedChange={v => props.onToggle(p, v)} aria-label={`${p.code} active`} />
                      </td>
                      <td className="text-right"><RowMenu p={p} props={props} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
