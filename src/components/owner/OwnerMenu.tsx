// ============================================================
// OWNER APP — Menu and availability (OWN-13), v1.86.0
//
// Switch an item off the moment the kitchen runs out, from anywhere, and fix a price. The POS, the ordering website
// and the apps read menu_items.is_active, so the switch takes effect everywhere. Everything else about an item
// (sizes, recipes, pictures) stays in the full menu manager. Saved the same way the menu manager saves (saveMenuItem).
// ============================================================
import { useMemo, useState } from 'react';
import { Check, Pencil, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { getCategories, getMenuItems, saveMenuItem } from '@/lib/store';
import { menuRows, parsePrice, type MenuRow } from '@/lib/ownerApp';
import { tileHue, tileInitials } from '@/lib/tileLook';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Card, Empty, IconButton, ScreenHeader } from './ownerUi';
import { rs, useLiveTick } from './ownerHooks';

export function OwnerMenu() {
  const tick = useLiveTick(['menuItems', 'categories']);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [cat, setCat] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [priceText, setPriceText] = useState('');
  // Optimistic switches: what the owner just set, until the store says the same.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const categories = useMemo(() => getCategories().filter(c => !c.deleted).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => getMenuItems(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => menuRows(items, categories, { query, categoryId: cat }), [items, categories, query, cat]);
  const withItems = categories.filter(c => items.some(i => i.categoryId === c.id));

  const toggle = (r: MenuRow) => {
    const next = !(pending[r.id] ?? r.isActive);
    setPending(p => ({ ...p, [r.id]: next }));
    try {
      const item = getMenuItems().find(i => i.id === r.id);
      if (!item) throw new Error('missing');
      saveMenuItem({ ...item, isActive: next });
      toast.success(next ? `${r.name} is back on the menu` : `${r.name} is switched off (sold out)`);
    } catch {
      setPending(p => { const n = { ...p }; delete n[r.id]; return n; }); // snaps back
      toast.error('Could not save');
    }
  };

  const savePrice = (r: MenuRow) => {
    const price = parsePrice(priceText);
    if (price === null) { toast.error('Enter a price, e.g. 1450'); return; }
    try {
      const item = getMenuItems().find(i => i.id === r.id);
      if (!item) throw new Error('missing');
      saveMenuItem({ ...item, price });
      setEditing(null);
      toast.success(`${r.name}: ${rs(price)}`);
    } catch { toast.error('Could not save'); }
  };

  return (
    <div className="space-y-3" data-testid="owner-menu">
      <ScreenHeader title="Menu" right={<IconButton label="Search the menu" onClick={() => setShowSearch(v => !v)}><Search className="h-5 w-5" /></IconButton>} />
      {showSearch && (
        <label className="flex h-12 items-center gap-2.5 rounded-2xl border bg-card px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search items" aria-label="Search items" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        </label>
      )}
      <div role="tablist" aria-label="Category" className="own-scroll-x -mx-4 flex gap-2 px-4 pb-1">
        <button type="button" role="tab" aria-selected={cat === 'all'} data-own-chip onClick={() => setCat('all')}>All</button>
        {withItems.map(c => <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} data-own-chip onClick={() => setCat(c.id)}>{c.name}</button>)}
      </div>

      {rows.length === 0 ? <Empty>{query ? 'No item matches' : 'No items in this category'}</Empty> : (
        <div className="space-y-2.5" data-testid="own-menu-list">
          {rows.map(r => {
            const on = pending[r.id] ?? r.isActive;
            return (
              <Card key={r.id} className="py-3.5" data-testid={`own-menu-${r.id}`}>
                <div className="flex items-center gap-3">
                  {r.image
                    ? <img src={r.image} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                    : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[13px] font-extrabold text-white" style={{ background: `linear-gradient(135deg, hsl(${tileHue(r.categoryId || r.name)} 75% 52%), hsl(${tileHue(r.categoryId || r.name)} 70% 38%))` }}>{tileInitials(r.name)}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15.5px] font-bold">{r.name}</div>
                    {editing === r.id ? null : (
                      <button type="button" onClick={() => { if (r.fixedPrice) { setEditing(r.id); setPriceText(String(r.price)); } else toast.info('Sizes are priced in the full menu manager'); }} className="flex items-center gap-1 text-[13.5px] text-muted-foreground" aria-label={`Edit the price of ${r.name}`}>
                        {r.fixedPrice ? rs(r.price) : 'Priced by size'}
                        {!on && <span className="text-[hsl(var(--own-bad))]"> · sold out</span>}
                        {r.fixedPrice && <Pencil className="ml-1 h-3 w-3 opacity-60" />}
                      </button>
                    )}
                  </div>
                  <Switch checked={on} onCheckedChange={() => toggle(r)} aria-label={`${r.name} available`} className={cn(on ? '' : 'opacity-80')} />
                </div>
                {editing === r.id && (
                  <div className="mt-3 flex items-center gap-2" data-testid="own-price-editor">
                    <input autoFocus inputMode="decimal" value={priceText} onChange={e => setPriceText(e.target.value)} aria-label="New price"
                      onKeyDown={e => { if (e.key === 'Enter') savePrice(r); if (e.key === 'Escape') setEditing(null); }}
                      className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-[16px] font-semibold tabular-nums outline-none" />
                    <button type="button" onClick={() => savePrice(r)} aria-label="Save price" className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"><Check className="h-5 w-5" /></button>
                    <button type="button" onClick={() => setEditing(null)} aria-label="Cancel" className="grid h-11 w-11 place-items-center rounded-xl border bg-card"><X className="h-5 w-5" /></button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="px-1 pb-2 text-[12px] text-muted-foreground">Switching an item off hides it on the POS, the ordering website and the apps. Sizes, recipes and pictures stay in the full menu manager.</p>
    </div>
  );
}
