// ============================================================
// MODULE LAUNCHER — every module the user may open, searchable, in one place.
// Opened from "More" in the sidebar and from the header's search button.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@/lib/hash-router';
import { SearchX, Search, Settings2, Star } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getBranches, getSettings, getUsers } from '@/lib/store';
import { GROUP_ORDER, visiblePagesForUser, type PageDef, type PageGroup } from '@/lib/permissions';
import { resolveNav, toggleFavorite, useNavPrefs, writeNavPrefs } from '@/lib/navPrefs';
import { cn } from '@/lib/utils';
import { navIcon } from '@/components/shell/navIcons';
import { navTitle } from '@/components/shell/navLabels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ModuleLauncher({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const prefs = useNavPrefs();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) setQuery(''); }, [open]);

  const { groups, canManage, total } = useMemo(() => {
    const settings = getSettings();
    const user = getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || ''));
    const pages = visiblePagesForUser(user, !!settings.costTrackingEnabled, settings, { branchCount: getBranches().length });
    const nav = resolveNav(pages, prefs);
    // Everything the user may open and has not hidden, favourites first within a group.
    const shown: PageDef[] = [...nav.favorites, ...nav.main, ...nav.more, ...nav.locked];
    const q = query.trim().toLowerCase();
    const matches = q
      ? shown.filter(p => navTitle(p.key, p.title).toLowerCase().includes(q) || p.group.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))
      : shown;
    const byGroup = GROUP_ORDER
      .map(g => ({ group: g as PageGroup, items: matches.filter(p => p.group === g) }))
      .filter(g => g.items.length > 0);
    return { groups: byGroup, canManage: pages.some(p => p.key === 'settings'), total: matches.length };
  }, [prefs, query, open]);

  const star = new Set(prefs.favorites);
  const go = (path: string) => { onOpenChange(false); navigate(path); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus(); }}
      >
        <div className="border-b px-5 pb-4 pt-5">
          <DialogTitle className="text-[17px] font-extrabold tracking-tight">All modules</DialogTitle>
          <DialogDescription className="mt-1 text-[13px]">Open any module. Star the ones you use most to pin them to the top of the sidebar.</DialogDescription>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search modules…"
              aria-label="Search modules"
              className="h-10 w-full rounded-[10px] border border-input bg-background pl-9 pr-3 text-[14px] outline-none transition-shadow focus:border-primary/60 focus:shadow-[var(--ui-shadow-focus)]"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const first = groups[0]?.items[0];
                  if (first) go(first.path);
                }
              }}
            />
          </div>
        </div>

        <div className="pos-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <SearchX className="h-8 w-8" />
              <div className="text-[14px] font-semibold text-foreground">No module matches “{query}”</div>
              <div className="text-[13px]">Try a shorter word, for example “bill” or “stock”.</div>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map(g => (
                <section key={g.group} aria-label={g.group}>
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{g.group}</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map(item => {
                      const Icon = navIcon(item.key);
                      const starred = star.has(item.key);
                      return (
                        <div key={item.key} className="group relative">
                          <button
                            type="button"
                            onClick={() => go(item.path)}
                            data-module={item.key}
                            className="flex h-14 w-full items-center gap-3 rounded-xl border bg-card px-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                          >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary">
                              <Icon className="h-[18px] w-[18px]" />
                            </span>
                            <span className="min-w-0 flex-1 truncate pr-6 text-[13.5px] font-semibold">{navTitle(item.key, item.title)}</span>
                          </button>
                          {item.key !== 'settings' && (
                            <button
                              type="button"
                              aria-label={starred ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}
                              aria-pressed={starred}
                              onClick={() => writeNavPrefs(toggleFavorite(prefs, item.key))}
                              className={cn(
                                'absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md transition-opacity',
                                starred ? 'text-primary opacity-100' : 'text-muted-foreground opacity-0 hover:text-primary focus:opacity-100 group-hover:opacity-100',
                              )}
                            >
                              <Star className={cn('h-4 w-4', starred && 'fill-current')} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {canManage && (
          <div className="flex items-center justify-between border-t bg-muted/40 px-5 py-3">
            <span className="text-[12px] text-muted-foreground">Showing {total} module{total === 1 ? '' : 's'}</span>
            <button
              type="button"
              onClick={() => go('/settings?tab=modules')}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              <Settings2 className="h-4 w-4" /> Manage modules
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
