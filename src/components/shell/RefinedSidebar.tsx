// ============================================================
// REFINED SIDEBAR — the DT design package's sidebar (SW-02 / SW-10), v1.85.0; rebuilt to the package exactly in v1.129.0
//
// White, 248 px (72 collapsed). The brand row (DT mark, "DT POS / Enterprise", the collapse button), then the groups as an
// ACCORDION — one open at a time (Operations holds the design's ten; Marketing, Inventory, Accounts, Staff, Reports, Admin each show
// how many modules they hold) — and one status card at the foot. The active module is a filled pill in the accent. Who may open what
// is still decided by lib/permissions.ts; hidden modules (Settings → Modules) stay hidden; favourites stay on top.
// The user block, log-out and "Powered by" that used to crowd the foot are in the user menu of the top bar; Settings (always there,
// whatever the role hides) is the first entry of Admin.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@/lib/hash-router';
import {
  BarChart3, ChevronRight, ChevronUp, IdCard, LayoutGrid, Megaphone, PanelLeftClose, PanelLeftOpen, Settings, ShoppingCart, Star, UtensilsCrossed, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import { getBranches, getSettings, getUsers, onSyncStatus } from '@/lib/store';
import { visiblePagesForUser, type PageDef } from '@/lib/permissions';
import { resolveNav, useNavPrefs } from '@/lib/navPrefs';
import { cn } from '@/lib/utils';
import { navIcon } from '@/components/shell/navIcons';
import { navTitle, navGroupTitle } from '@/components/shell/navLabels';
import DtMark from '@/components/DtMark';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { groupPages, initialOpenGroups, OPEN_GROUPS_KEY, readOpenGroups, syncLabel, toggleGroup } from '@/lib/refinedNav';

/** The design's group icons (SW-02 sidebar). */
const GROUP_ICON: Record<string, LucideIcon> = {
  Operations: ShoppingCart, Marketing: Megaphone, Inventory: UtensilsCrossed, Accounts: Wallet, Staff: IdCard, Reports: BarChart3, Admin: Settings,
};

interface Props {
  userRole: string;
  onLogout: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  collapsed: boolean;
  onOpenLauncher: () => void;
  onToggleCollapse?: () => void;
}

function Item({ item, active, collapsed, onGo }: { item: PageDef; active: boolean; collapsed: boolean; onGo: (p: string) => void }) {
  const Icon = navIcon(item.key);
  const label = navTitle(item.key, item.title);
  const btn = (
    <button
      type="button"
      onClick={() => onGo(item.path)}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      data-nav-key={item.key}
      data-refined-nav-item
      className={cn('flex w-full items-center gap-3 px-3 transition-colors', collapsed && 'justify-center px-0')}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
  if (!collapsed) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function RefinedSidebar({ mobileOpen, setMobileOpen, collapsed, onOpenLauncher, onToggleCollapse }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = getSettings();
  const user = getUsers().find(u => u.id === (localStorage.getItem('pos-user-id') || ''));
  const prefs = useNavPrefs();
  const [, setPlanTick] = useState(0);
  useEffect(() => {
    const h = () => setPlanTick(t => t + 1);
    window.addEventListener('pos-plan-changed', h);
    return () => window.removeEventListener('pos-plan-changed', h);
  }, []);

  const pages = visiblePagesForUser(user, !!settings.costTrackingEnabled, settings, { branchCount: getBranches().length });
  const nav = resolveNav(pages, prefs);
  // Settings is always reachable whatever the role hides (nav.locked); in the design it is simply one of the Admin entries.
  const groups = useMemo(() => groupPages([...nav.main, ...nav.more, ...nav.locked]), [nav.main, nav.more, nav.locked]);
  // One filled item only: a few entries share a route (Day Close is a permission that opens Settings), so the first
  // match wins — the footer's Settings, then favourites, then the groups.
  const activeKey = [...nav.favorites, ...groups.flatMap(g => g.items)].find(i => i.path === location.pathname)?.key;
  const activeGroup = groups.find(g => g.items.some(i => i.key === activeKey))?.group;

  const [open, setOpen] = useState<Set<string>>(() => initialOpenGroups(readOpenGroups(), activeGroup));
  // Going to a page in another group (a link, the module search) opens ITS group and folds the rest.
  useEffect(() => { if (activeGroup) setOpen(o => (o.has(activeGroup) && o.size === 1 ? o : new Set([activeGroup]))); }, [activeGroup]);
  useEffect(() => { try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...open])); } catch { /* private mode */ } }, [open]);
  const toggle = (g: string) => setOpen(o => toggleGroup(o, g));

  const [sync, setSync] = useState<{ online: boolean; pending: number; lastError?: string }>({ online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0 });
  useEffect(() => onSyncStatus(setSync), []);
  const status = syncLabel(sync);

  const go = (path: string) => { navigate(path); setMobileOpen(false); };
  // Long groups can push the current page below the fold: bring it into view when the page changes.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    try { (navRef.current?.querySelector('[aria-current="page"]') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' }); } catch { /* old webview */ }
  }, [location.pathname]);

  return (
    <aside
      data-ui-shell="sidebar"
      data-refined-sidebar
      className={cn(
        'fixed inset-y-0 start-0 z-50 flex w-[var(--ui-sidebar-w)] flex-col border-e border-sidebar-border bg-sidebar transition-[width,transform] duration-200',
        'lg:relative lg:translate-x-0',
        collapsed && 'lg:w-[var(--ui-sidebar-w-collapsed)]',
        mobileOpen ? 'translate-x-0 shadow-[var(--ui-shadow-pop)]' : '-translate-x-full rtl:translate-x-full lg:translate-x-0 lg:rtl:translate-x-0',
      )}
    >
      {/* Brand — the design's: the DT mark, "DT POS / Enterprise", the collapse button */}
      <div className={cn('flex h-[var(--ui-header-h)] shrink-0 items-center gap-2.5 border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'px-4')}>
        <span className="grid h-8 w-8 shrink-0 place-items-center text-primary"><DtMark size={28} title={null} /></span>
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-[1.1]">
            <div className="text-[13px] font-bold text-foreground">DT POS</div>
            <div className="text-[11px] font-semibold text-muted-foreground">Enterprise</div>
          </div>
        )}
        {onToggleCollapse && !collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onToggleCollapse} aria-label="Collapse sidebar"
                className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:grid">
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
        <button type="button" className="ml-auto text-muted-foreground lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>

      <nav ref={navRef} className="pos-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3" aria-label="Main">
        {nav.favorites.length > 0 && (
          <div className="space-y-0.5" data-refined-group="Favorites">
            {!collapsed && <div data-refined-group-head className="flex items-center gap-1.5 px-3 pb-1"><Star className="h-3 w-3" /> Favorites</div>}
            {nav.favorites.map(i => <Item key={i.key} item={i} active={i.key === activeKey} collapsed={collapsed} onGo={go} />)}
          </div>
        )}

        {/* The 72 px rail (the design's POS): the daily modules as icons, then one icon per other group — click one and the menu opens on it. */}
        {collapsed && groups.map(g => {
          const GroupIcon = GROUP_ICON[g.group] || LayoutGrid;
          if (g.group === 'Operations') return (
            <div key={g.group} className="space-y-0.5" data-refined-group={g.group}>
              {g.items.map(i => <Item key={i.key} item={i} active={i.key === activeKey} collapsed onGo={go} />)}
            </div>
          );
          return (
            <Tooltip key={g.group}>
              <TooltipTrigger asChild>
                <button type="button" aria-label={navGroupTitle(g.group)} data-refined-nav-item data-refined-group-icon={g.group} className="flex w-full items-center justify-center"
                  onClick={() => { setOpen(new Set([g.group])); onToggleCollapse?.(); }}>
                  <GroupIcon className="h-[18px] w-[18px]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{navGroupTitle(g.group)} ({g.items.length})</TooltipContent>
            </Tooltip>
          );
        })}

        {!collapsed && groups.map(g => {
          const isOpen = open.has(g.group);
          const GroupIcon = GROUP_ICON[g.group] || LayoutGrid;
          return (
            <div key={g.group} className={cn('space-y-0.5', isOpen && !collapsed && 'pb-1.5 pt-1')} data-refined-group={g.group}>
              {!collapsed && (isOpen ? (
                // An open group: a small label over its modules (design: "REPORTS ^")
                <button type="button" onClick={() => toggle(g.group)} aria-expanded className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-accent">
                  <span data-refined-group-head className="flex-1">{navGroupTitle(g.group)}</span>
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ) : (
                // A closed group reads like a module row: icon, name, how many modules it holds, chevron
                <button type="button" onClick={() => toggle(g.group)} aria-expanded={false} data-refined-nav-item className="flex w-full items-center gap-3 px-3 text-left">
                  <GroupIcon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-bold text-foreground">{navGroupTitle(g.group)}</span>
                  <span data-refined-count>{g.items.length}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ))}
              {isOpen && g.items.map(i => <Item key={i.key} item={i} active={i.key === activeKey} collapsed={collapsed} onGo={go} />)}
            </div>
          );
        })}

        {collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onOpenLauncher} aria-label="Search modules" data-nav-key="more" data-refined-nav-item className="flex w-full items-center justify-center">
                <LayoutGrid className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Search modules</TooltipContent>
          </Tooltip>
        )}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        {collapsed && onToggleCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onToggleCollapse} aria-label="Expand sidebar" className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><PanelLeftOpen className="h-4 w-4" /></button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        )}
        {collapsed ? (
          <span data-testid="refined-sync-dot" title={`${status.title} · ${status.detail}`} className="mx-auto block h-2.5 w-2.5 rounded-full" style={{ background: status.tone === 'ok' ? 'hsl(var(--dt-ok))' : status.tone === 'warn' ? 'hsl(var(--dt-warn))' : 'hsl(var(--dt-bad))' }} />
        ) : (
          <div data-testid="refined-sync-card" className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: status.tone === 'ok' ? 'hsl(var(--dt-ok))' : status.tone === 'warn' ? 'hsl(var(--dt-warn))' : 'hsl(var(--dt-bad))' }} aria-hidden />
            <span className="min-w-0">
              <span className="block text-[12.5px] font-bold leading-tight">{status.title}</span>
              <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">{status.detail}</span>
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}


