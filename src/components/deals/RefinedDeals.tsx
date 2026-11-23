// v1.153.0 — Deals & combos in the design's shape (SW-15): "N active deals", New deal, and a card per deal — a coloured banner with a gift, the name with an on / off switch,
// the combo price beside the regular price struck through and "Save Rs X", and the ticked list of what is in it. Edit and Delete sit on the banner (the design has no place for
// them). The page owns the deals, the menu and the form; this is the picture and the clicks.
import { Check, Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { money } from '@/lib/currency';
import type { Deal, MenuItem } from '@/lib/types';
import { bannerTone, dealLine, dealsSubtitle, saving } from '@/lib/dealsBoard';

export interface RefinedDealsProps {
  deals: Deal[];
  /** the menu, to price the lines and to name them */
  items: MenuItem[];
  onNew: () => void;
  onEdit: (d: Deal) => void;
  onDelete: (d: Deal) => void;
  onToggle: (d: Deal, on: boolean) => void;
}

export default function RefinedDeals(p: RefinedDealsProps) {
  const nameOf = (id: string) => p.items.find(i => i.id === id)?.name || '';
  return (
    <div className="dl-root" data-dl-page>
      <div className="dl-head">
        <div className="dl-titles"><h1 data-dl-title>Deals &amp; combos</h1><p data-dl-subtitle>{dealsSubtitle(p.deals)}</p></div>
        <button type="button" className="dl-btn" data-dl-new onClick={p.onNew}><Plus aria-hidden className="h-4 w-4" />New deal</button>
      </div>
      {p.deals.length === 0 ? (
        <div className="dl-empty" data-dl-empty>No deals yet. “New deal” makes a combo that goes on the menu and the POS by itself.</div>
      ) : (
        <div className="dl-grid">
          {p.deals.map((d, i) => {
            const s = saving(d, p.items);
            return (
              <article key={d.id} className="dl-card" data-dl-card={d.id} data-off={d.isActive ? undefined : ''}>
                <div className="dl-banner" data-tone={bannerTone(i)}>
                  <Gift aria-hidden className="h-9 w-9" />
                  <div className="dl-banner-actions">
                    <button type="button" aria-label={`Edit ${d.name}`} data-dl-edit onClick={() => p.onEdit(d)}><Pencil className="h-4 w-4" /></button>
                    <button type="button" aria-label={`Delete ${d.name}`} data-dl-delete onClick={() => p.onDelete(d)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="dl-name"><b>{d.name}</b>
                  <button type="button" role="switch" aria-checked={d.isActive} aria-label={`${d.name} on the menu`} className="dl-switch" data-dl-switch onClick={() => p.onToggle(d, !d.isActive)}><i /></button>
                </div>
                <div className="dl-price">
                  <b data-dl-price>{money(d.price)}</b>
                  {s && <del data-dl-regular>{money(s.regular)}</del>}
                  {s && <span className="dl-save" data-dl-save>Save {money(s.save)}</span>}
                </div>
                <ul className="dl-lines">
                  {d.items.map((di, k) => <li key={k}><Check aria-hidden className="h-4 w-4" />{dealLine(di, nameOf)}</li>)}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
