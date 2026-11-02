// ============================================================
// REFINED SIDEBAR — the DT design package's sidebar (SW-02 / SW-10), v1.85.0
//
// White, 248 px (72 collapsed). Favorites first, then every module the user may open in accordion groups
// (Operations, Marketing, Inventory, Accounts, Staff, Reports, Admin) with a count on each group; the active module is
// a filled pill in the accent. A status card at the bottom says whether the till is online and how many changes are
// waiting to sync. Who may open what is still decided by lib/permissions.ts; hidden modules (Settings → Modules) stay
// hidden; favourites stay on top.
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@/lib/hash-router';
import {
  BarChart3, ChevronRight, ChevronUp, IdCard, LayoutGrid, LogOut, Megaphone, Settings, ShoppingCart, Star, UtensilsCrossed, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import { getBranches, getSettings, getUsers, onSyncStatus } from '@/lib/store';
import { visiblePagesForUser, type PageDef } from '@/lib/permissions';
import { resolveNav, useNavPrefs } from '@/lib/navPrefs';
import { cn } from '@/lib/utils';
import { navIcon } from '@/components/shell/navIcons';
import { navTitle } from '@/components/shell/navLabels';
import PoweredByBrand from '@/components/PoweredByBrand';
import DtMark from '@/components/DtMark';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { groupPages, initialOpenGroups, OPEN_GROUPS_KEY, readOpenGroups, syncLabel } from '@/lib/refinedNav';

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

export default function RefinedSidebar({ userRole, onLogout, mobileOpen, setMobileOpen, collapsed, onOpenLauncher }: Props) {
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
  const groups = useMemo(() => groupPages([...nav.main, ...nav.more]), [nav.main, nav.more]);
  // One filled item only: a few entries share a route (Day Close is a permission that opens Settings), so the first
  // match wins — the footer's Settings, then favourites, then the groups.
  const activeKey = [...nav.locked, ...nav.favorites, ...groups.flatMap(g => g.items)].find(i => i.path === location.pathname)?.key;
  const activeGroup = groups.find(g => g.items.some(i => i.key === activeKey))?.group;

  const [open, setOpen] = useState<Set<string>>(() => initialOpenGroups(readOpenGroups(), activeGroup));
  useEffect(() => { if (activeGroup) setOpen(o => (o.has(activeGroup) ? o : new Set([...o, activeGroup]))); }, [activeGroup]);
  useEffect(() => { try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...open])); } catch { /* private mode */ } }, [open]);
  const toggle = (g: string) => setOpen(o => { const n = new Set(o); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  const [sync, setSync] = useState<{ online: boolean; pending: number; lastError?: string }>({ online: typeof navigator === 'undefined' ? true : navigator.onLine, pending: 0 });
  useEffect(() => onSyncStatus(setSync), []);
  const status = syncLabel(sync);

  const go = (path: string) => { navigate(path); setMobileOpen(false); };
  // Long groups can push the current page below the fold: bring it into view when the page changes.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    try { (navRef.current?.querySelector('[aria-current="page"]') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' }); } catch { /* old webview */ }
  }, [location.pathname]);
  const logo = settings.appLogo || settings.logo;

  return (
    <aside
      data-ui-shell="sidebar"
      data-refined-sidebar
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-[var(--ui-sidebar-w)] flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-200',
        'lg:relative lg:translate-x-0',
        collapsed && 'lg:w-[var(--ui-sidebar-w-collapsed)]',
        mobileOpen ? 'translate-x-0 shadow-[var(--ui-shadow-pop)]' : '-translate-x-full lg:translate-x-0',
      )}
    >
      {/* Brand: the restaurant first, the product under it */}
      <div className={cn('flex h-[var(--ui-header-h)] shrink-0 items-center gap-3 border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'px-4')}>
        {logo
          ? <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-[10px] object-contain" />
          : <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary p-1.5 text-primary-foreground"><DtMark size={24} title={null} /></div>}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-extrabold leading-tight tracking-tight text-foreground">{settings.name || 'DT POS'}</div>
            <div className="text-[11px] font-medium leading-tight text-muted-foreground">DT POS Enterprise</div>
          </div>
        )}
        <button type="button" className="ml-auto text-muted-foreground lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>

      <nav ref={navRef} className="pos-scrollbar flex-1 space-y-1.5 overflow-y-auto px-3 py-3" aria-label="Main">
        {nav.favorites.length > 0 && (
          <div className="space-y-0.5" data-refined-group="Favorites">
            {!collapsed && <div data-refined-group-head className="flex items-center gap-1.5 px-3 pb-1"><Star className="h-3 w-3" /> Favorites</div>}
            {nav.favorites.map(i => <Item key={i.key} item={i} active={i.key === activeKey} collapsed={collapsed} onGo={go} />)}
          </div>
        )}

        {groups.map(g => {
          const isOpen = collapsed || open.has(g.group);
          const GroupIcon = GROUP_ICON[g.group] || LayoutGrid;
          return (
            <div key={g.group} className={cn('space-y-0.5', isOpen && !collapsed && 'pb-1.5 pt-1')} data-refined-group={g.group}>
              {!collapsed && (isOpen ? (
                // An open group: a small label over its modules (design: "REPORTS ^")
                <button type="button" onClick={() => toggle(g.group)} aria-expanded className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-accent">
                  <span data-refined-group-head className="flex-1">{g.group}</span>
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ) : (
                // A closed group reads like a module row: icon, name, how many modules it holds, chevron
                <button type="button" onClick={() => toggle(g.group)} aria-expanded={false} data-refined-nav-item className="flex w-full items-center gap-3 px-3 text-left">
                  <GroupIcon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{g.group}</span>
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

      <div className="shrink-0 space-y-2 border-t border-sidebar-border px-3 py-3">
        {nav.locked.map(i => <Item key={i.key} item={i} active={i.key === activeKey} collapsed={collapsed} onGo={go} />)}
        {!collapsed && (
          <div data-testid="refined-sync-card" className="flex items-start gap-2.5 rounded-xl border bg-card px-3 py-2.5">
            <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', status.tone === 'ok' ? 'bg-[hsl(142_72%_29%)]' : status.tone === 'warn' ? 'bg-amber-500' : 'bg-[hsl(0_72%_51%)]')} aria-hidden />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold leading-tight">{status.title}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{status.detail}</span>
            </span>
          </div>
        )}
        <div className={cn('flex items-center gap-2.5 rounded-[10px] p-1.5', collapsed && 'flex-col')}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[12px] font-extrabold uppercase text-primary">{(user?.name || userRole || '?').slice(0, 2)}</div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold leading-tight text-foreground">{user?.name || userRole}</div>
              <div className="text-[11px] capitalize leading-tight text-muted-foreground">{userRole}</div>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onLogout} aria-label="Log out" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><LogOut className="h-4 w-4" /></button>
            </TooltipTrigger>
            <TooltipContent side="right">Log out</TooltipContent>
          </Tooltip>
        </div>
        <PoweredByBrand variant="credit" collapsed={collapsed} />
      </div>
    </aside>
  );
}


