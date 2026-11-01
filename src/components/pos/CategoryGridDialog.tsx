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
}

export default function CategoryGridDialog({ open, onOpenChange, categories, counts, selected, onSelect, fontStyle }: Props) {
  const pick = (id: string) => { onSelect(id); onOpenChange(false); };
  const box = (id: string, name: string, visual: ReactNode, count: number) => {
    const active = selected === id;
    return (
      <button
        key={id}
        type="button"
        role="option"
        aria-selected={active}
        data-cat-grid-item={id}
        onClick={() => pick(id)}
        className={`relative flex min-h-[92px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-2.5 text-center transition-all active:scale-[0.98] ${
          active ? 'border-primary bg-primary/10 shadow-md' : 'border-border bg-card hover:border-primary/50 hover:bg-accent'
        }`}
      >
        {active && <Check className="absolute right-1.5 top-1.5 h-4 w-4 text-primary" aria-hidden />}
        {visual}
        <span className="w-full break-words text-[13px] font-bold leading-tight" style={id === 'all' ? undefined : fontStyle}>{name}</span>
        <span className="text-[11px] font-semibold text-muted-foreground">{count} item{count === 1 ? '' : 's'}</span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl" data-testid="category-grid">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LayoutGrid className="h-5 w-5 text-primary" /> All Categories</DialogTitle>
          <DialogDescription>Pick a category to show its items.</DialogDescription>
        </DialogHeader>
        <div role="listbox" aria-label="Categories" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {box('all', 'All items', <span className="text-2xl leading-none" aria-hidden>📋</span>, counts.all)}
          {categories.map(c => box(
            c.id,
            c.name,
            c.image
              ? <img src={c.image} alt="" className="h-9 w-9 rounded-full object-cover" />
              : <span className="text-2xl leading-none" aria-hidden>{c.icon || '🍽️'}</span>,
            counts.byCat.get(c.id) || 0,
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
