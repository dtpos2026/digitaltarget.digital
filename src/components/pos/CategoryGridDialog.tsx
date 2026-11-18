// ============================================================
// ALL CATEGORIES — the grid picker behind the 4-box button next to "All".
//
// Every category as a box with its full name, its picture or icon and how many
// items it holds. Picking one shows its items at once and closes the picker.
// Built on the same dialog as the variant picker, so it opens centred and
// scrolls inside on a small screen, in every look.
// ============================================================
import type { CSSProperties, ReactNode } from 'react';
import { Check, LayoutGrid } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Category } from '@/lib/types';
import { iconFor, toneIndex, TONES } from '@/lib/websiteHome';
import { TileIconView } from '@/components/website/siteBits';
import { splitCategoryName } from '@/lib/categoryName';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  /** Items per category id, and the total. */
  counts: { all: number; byCat: Map<string, number> };
  /** 'all' or a category id. */
  selected: string;
  onSelect: (id: string) => void;
  /** The shop's category font (Urdu fonts etc.), the same as the ribbon uses. */
  fontStyle?: CSSProperties;
  /** v1.126.0 — 'tile': a coloured icon tile per category, as the design shows (DT Refined, Order Taker); 'emoji': the category's own emoji (other looks). */
  iconStyle?: 'tile' | 'emoji';
}

export default function CategoryGridDialog({ open, onOpenChange, categories, counts, selected, onSelect, fontStyle, iconStyle = 'emoji' }: Props) {
  const pick = (id: string) => { onSelect(id); onOpenChange(false); };
  const box = (id: string, name: string, visual: ReactNode, count: number) => {
    const active = selected === id;
    // "Chicken Karahi (چکن کڑاہی)": the English name leads, the Urdu one is its own smaller line — never a name broken inside its brackets
    const label = id === 'all' ? { primary: name } : splitCategoryName(name);
    return (
      <button
        key={id}
        type="button"
        role="option"
        aria-selected={active}
        data-cat-grid-item={id}
        title={name}
        onClick={() => pick(id)}
        className={`relative flex h-full min-h-[112px] flex-col items-center justify-start gap-1.5 rounded-xl border-2 p-3 text-center transition-all active:scale-[0.98] ${
          active ? 'border-primary bg-primary/10 shadow-md' : 'border-border bg-card hover:border-primary/50 hover:bg-accent'
        }`}
      >
        {active && <Check className="absolute right-1.5 top-1.5 h-4 w-4 text-primary" aria-hidden />}
        {visual}
        <span className="w-full min-w-0" style={id === 'all' ? undefined : fontStyle}>
          <span data-cat-grid-name className="block line-clamp-2 break-words text-[13px] font-bold leading-tight">{label.primary}</span>
          {label.secondary && <span data-cat-grid-sub dir="rtl" className="mt-0.5 block truncate text-[12px] font-medium leading-snug text-muted-foreground">{label.secondary}</span>}
        </span>
        <span className="mt-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{count} item{count === 1 ? '' : 's'}</span>
      </button>
    );
  };

  // the picture of a category: its own photo, else (design look) a coloured icon tile, else its emoji
  const tile = (name: string, icon: ReturnType<typeof iconFor>) => (
    <span data-cat-grid-tile aria-hidden className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm ${TONES[toneIndex(name)]}`}>
      <TileIconView icon={icon} className="h-5 w-5" />
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" data-testid="category-grid">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LayoutGrid className="h-5 w-5 text-primary" /> All Categories</DialogTitle>
          <DialogDescription>Pick a category to show its items.</DialogDescription>
        </DialogHeader>
        <div role="listbox" aria-label="Categories" className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {box('all', 'All items', iconStyle === 'tile' ? tile('All items', 'default') : <span className="text-2xl leading-none" aria-hidden>📋</span>, counts.all)}
          {categories.map(c => box(
            c.id,
            c.name,
            c.image
              ? <img src={c.image} alt="" className="h-10 w-10 rounded-xl object-cover" />
              : iconStyle === 'tile'
                ? tile(c.name, iconFor(c.name))
                : <span className="text-2xl leading-none" aria-hidden>{c.icon || '🍽️'}</span>,
            counts.byCat.get(c.id) || 0,
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
