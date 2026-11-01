// ============================================================
// MODERN SIDEBAR — the everyday modules, one click each; the rest behind
// "More". Which modules sit where is a navigation preference
// (src/lib/navPrefs.ts, Settings → Modules); who may open what is still
// decided by src/lib/permissions.ts, exactly as before.
// ============================================================
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from '@/lib/hash-router';
import { LayoutGrid, LogOut, Star, X } from 'lucide-react';
import { getBranches, getSettings, getUsers } from '@/lib/store';
import { visiblePagesForUser, type PageDef } from '@/lib/permissions';
import { resolveNav, useNavPrefs } from '@/lib/navPrefs';
import { isVinceBrandActive, isPremiumThemeActive, PREMIUM_BRAND_NAME } from '@/lib/premiumTheme';
import { cn } from '@/lib/utils';
import { navIcon } from '@/components/shell/navIcons';
import { navTitle } from '@/components/shell/navLabels';
import { useUiLook } from '@/lib/uiStyle';
import PoweredByBrand from '@/components/PoweredByBrand';
import DtMark from '@/components/DtMark';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  userRole: string;
  onLogout: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  collapsed: boolean;
  onOpenLauncher: () => void;
}

function NavItem({ item, active, collapsed, onGo }: { item: PageDef; active: boolean; collapsed: boolean; onGo: (p: string) => void }) {
  const Icon = navIcon(item.key);
  const label = navTitle(item.key, item.title);
  const button = (
    <button
      type="button"
      onClick={() => onGo(item.path)}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      data-nav-key={item.key}
      className={cn(
        'group relative flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-semibold transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-sidebar-accent-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export default function ModernSidebar({ userRole, onLogout, mobileOpen, setMobileOpen, collapsed, onOpenLauncher }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const settings = getSettings();
  const currentUserId = localStorage.getItem('pos-user-id') || '';
  const user = getUsers().find(u => u.id === currentUserId);
  const prefs = useNavPrefs();
  const [, setPlanTick] = useState(0);
  useEffect(() => {
    const h = () => setPlanTick(t => t + 1);
    window.addEventListener('pos-plan-changed', h);
    return () => window.removeEventListener('pos-plan-changed', h);
  }, []);

  const pages = visiblePagesForUser(user, !!settings.costTrackingEnabled, settings, { branchCount: getBranches().length });
  const nav = resolveNav(pages, prefs);
  const go = (path: string) => { navigate(path); setMobileOpen(false); };
  // The restaurant's name leads on every theme except the one that is itself a brand (v1.68.0).
  const shopName = isVinceBrandActive() ? PREMIUM_BRAND_NAME : (settings.name || 'DT POS');
  const logo = settings.appLogo || settings.logo;
  const moreCount = nav.more.length;
  const retail = useUiLook() === 'retail';

  return (
    <aside
      data-ui-shell="sidebar"
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-[var(--ui-sidebar-w)] flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-200',
        'lg:relative lg:translate-x-0',
        collapsed && 'lg:w-[var(--ui-sidebar-w-collapsed)]',
        mobileOpen ? 'translate-x-0 shadow-[var(--ui-shadow-pop)]' : '-translate-x-full lg:translate-x-0',
      )}
    >
      {/* Brand: the restaurant first */}
      <div className={cn('flex h-[var(--ui-header-h)] shrink-0 items-center gap-3 border-b border-sidebar-border', collapsed ? 'justify-center px-2' : 'px-4')}>
        {logo ? (
          <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-[10px] object-contain" />
        ) : (
          <div data-dtr="brand-mark" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary p-1.5 text-primary-foreground">
            <DtMark size={24} title={null} />
          </div>
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-extrabold leading-tight tracking-tight text-foreground">{shopName}</div>
            <div className="text-[11px] font-medium leading-tight text-muted-foreground">{isPremiumThemeActive() ? 'Premium Edition' : 'DT Enterprise POS'}</div>
          </div>
        )}
        <button type="button" className="ml-auto text-muted-foreground lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Modules */}
      <nav className="pos-scrollbar flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Main">
        {nav.favorites.length > 0 && (
          <div className="space-y-0.5">
            {!collapsed && (
              <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                <Star className="h-3 w-3" /> Favorites
              </div>
            )}
            {nav.favorites.map(item => (
              <NavItem key={item.key} item={item} active={location.pathname === item.path} collapsed={collapsed} onGo={go} />
            ))}
          </div>
        )}

        <div className="space-y-0.5">
          {nav.favorites.length > 0 && !collapsed && (
            <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Modules</div>
          )}
          {nav.main.map(item => (
            <NavItem key={item.key} item={item} active={location.pathname === item.path} collapsed={collapsed} onGo={go} />
          ))}
          {moreCount > 0 && (
            collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={onOpenLauncher} aria-label="More modules" data-nav-key="more"
                    className="flex h-10 w-full items-center justify-center rounded-[10px] text-sidebar-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <LayoutGrid className="h-[18px] w-[18px] text-muted-foreground" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">More modules ({moreCount})</TooltipContent>
              </Tooltip>
            ) : (
              <button type="button" onClick={onOpenLauncher} data-nav-key="more"
                className="group flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-semibold text-sidebar-foreground transition-colors hover:bg-accent hover:text-foreground">
                <LayoutGrid className="h-[18px] w-[18px] shrink-0 text-muted-foreground group-hover:text-foreground" />
                <span className="flex-1 truncate text-left">More</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{moreCount}</span>
              </button>
            )
          )}
        </div>
      </nav>

      {/* Footer: settings, the signed-in user, and a small credit */}
      <div className="shrink-0 space-y-2 border-t border-sidebar-border px-3 py-3">
        {nav.locked.map(item => (
          <NavItem key={item.key} item={item} active={location.pathname === item.path} collapsed={collapsed} onGo={go} />
        ))}
        <div data-dtr="user-row" className={cn('flex items-center gap-2.5 rounded-[10px] p-1.5', collapsed && 'flex-col')}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[12px] font-extrabold uppercase text-primary">
            {(user?.name || userRole || '?').slice(0, 1)}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold leading-tight text-foreground">{user?.name || userRole}</div>
              <div className="text-[11px] capitalize leading-tight text-muted-foreground">{userRole}</div>
            </div>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={onLogout} aria-label="Log out"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Log out</TooltipContent>
          </Tooltip>
        </div>
        <PoweredByBrand variant={retail ? 'retail' : 'credit'} collapsed={collapsed} />
      </div>
    </aside>
  );
}
