// ============================================================
// SETTINGS → MODULES — choose what the Modern sidebar shows.
//
// Navigation only (src/lib/navPrefs.ts). Hiding a module never deletes its
// data, switches the feature off, or changes who may open it; it opens from
// its address, from Go to module…, or from here.
// ============================================================
import { useMemo, useState } from 'react';
import { useNavigate } from '@/lib/hash-router';
import { ArrowDown, ArrowUp, ExternalLink, Lock, RotateCcw, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getBranches, getSettings, getUsers } from '@/lib/store';
import { GROUP_ORDER, visiblePagesForUser, type PageDef } from '@/lib/permissions';
import {
  LOCKED_KEYS, moveModule, placementOf, resetNavPrefs, resolveNav, setPlacement, toggleFavorite,
  useNavPrefs, writeNavPrefs, type NavPlacement,
} from '@/lib/navPrefs';
import { useUiStyle } from '@/lib/uiStyle';
import { navIcon } from '@/components/shell/navIcons';
import { navTitle } from '@/components/shell/navLabels';
import { SearchField, SectionCard, StatusBadge, EmptyState } from '@/components/ui-kit';
import { cn } from '@/lib/utils';

const PLACES: { id: NavPlacement; label: string; hint: string }[] = [
  { id: 'main', label: 'Sidebar', hint: 'One click, always visible' },
  { id: 'more', label: 'More', hint: 'Under the More button' },
  { id: 'hidden', label: 'Hidden', hint: 'Not in the menu' },
];

export default function ModuleManagementCard() {
  const navigate = useNavigate();
  const modern = useUiStyle() === 'modern';
  const prefs = useNavPrefs();
  const [query, setQuery] = useState('');

  const { pages, nav } = useMemo(() => {
    const settings = getSettings();
    const user = getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || ''));
    const all = visiblePagesForUser(user, !!settings.costTrackingEnabled, settings, { branchCount: getBranches().length });
    return { pages: all, nav: resolveNav(all, prefs) };
  }, [prefs]);

  const star = new Set(prefs.favorites);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const ordered: PageDef[] = [...nav.favorites, ...nav.main, ...nav.more, ...nav.hidden, ...nav.locked];
    return ordered.filter(p => !q || p.title.toLowerCase().includes(q) || navTitle(p.key, p.title).toLowerCase().includes(q) || p.group.toLowerCase().includes(q));
  }, [nav, q]);

  const counts = { main: nav.main.length + nav.favorites.length, more: nav.more.length, hidden: nav.hidden.length };

  const set = (key: string, place: NavPlacement) => writeNavPrefs(setPlacement(pages, prefs, key, place));

  return (
    <div className="space-y-4" data-testid="module-management">
      {!modern && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900">
          The Classic menu always lists every module. These choices apply to the Modern menu — switch to it in Theme.
        </div>
      )}

      <SectionCard
        title="Modules"
        description="Choose what appears in the menu, where, and in what order. Nothing is deleted or switched off — hidden modules keep all their data and still open from Go to module…."
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => { resetNavPrefs(); toast.success('Menu restored to the default'); }}>
            <RotateCcw className="h-4 w-4" /> Restore default
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusBadge tone="accent">{counts.main} in sidebar</StatusBadge>
          <StatusBadge tone="neutral">{counts.more} under More</StatusBadge>
          <StatusBadge tone={counts.hidden ? 'warning' : 'neutral'}>{counts.hidden} hidden</StatusBadge>
          <SearchField value={query} onChange={setQuery} placeholder="Search modules…" className="ml-auto w-full sm:w-64" />
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No module matches" description="Try a shorter word, for example “bill” or “stock”." />
        ) : (
          <ul className="divide-y rounded-xl border" aria-label="Modules">
            {rows.map(p => {
              const Icon = navIcon(p.key);
              const locked = LOCKED_KEYS.includes(p.key);
              const place = placementOf(p.key, prefs);
              const starred = star.has(p.key);
              const peers = [...nav.favorites, ...nav.main, ...nav.more, ...nav.hidden].filter(x => placementOf(x.key, prefs) === place);
              const at = peers.findIndex(x => x.key === p.key);
              return (
                <li key={p.key} data-module-row={p.key} className={cn('flex flex-wrap items-center gap-3 px-3 py-2.5', place === 'hidden' && 'bg-muted/40')}>
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', place === 'hidden' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-[8rem] flex-1">
                    <div className={cn('text-[13.5px] font-semibold', place === 'hidden' && 'text-muted-foreground')}>{navTitle(p.key, p.title)}</div>
                    <div className="text-[12px] text-muted-foreground">{p.group}</div>
                  </div>

                  {locked ? (
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" /> Always in the menu
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={starred ? `Unstar ${p.title}` : `Star ${p.title}`}
                        aria-pressed={starred}
                        title={starred ? 'Remove from favorites' : 'Add to favorites (top of the sidebar)'}
                        onClick={() => writeNavPrefs(toggleFavorite(prefs, p.key))}
                        className={cn('grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-accent', starred ? 'text-primary' : 'text-muted-foreground')}
                      >
                        <Star className={cn('h-4 w-4', starred && 'fill-current')} />
                      </button>
                      <div role="radiogroup" aria-label={`${p.title} placement`} className="inline-flex rounded-[10px] bg-muted p-0.5">
                        {PLACES.map(pl => (
                          <button
                            key={pl.id}
                            type="button"
                            role="radio"
                            aria-checked={place === pl.id}
                            title={pl.hint}
                            onClick={() => set(p.key, pl.id)}
                            className={cn(
                              'h-7 rounded-lg px-2.5 text-[12px] font-semibold transition-colors',
                              place === pl.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {pl.label}
                          </button>
                        ))}
                      </div>
                      <div className="inline-flex">
                        <button type="button" aria-label={`Move ${p.title} up`} disabled={at <= 0} onClick={() => writeNavPrefs(moveModule(pages, prefs, p.key, -1))}
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                        <button type="button" aria-label={`Move ${p.title} down`} disabled={at < 0 || at >= peers.length - 1} onClick={() => writeNavPrefs(moveModule(pages, prefs, p.key, 1))}
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                      </div>
                    </>
                  )}
                  <button type="button" aria-label={`Open ${p.title}`} title="Open" onClick={() => navigate(p.path)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
