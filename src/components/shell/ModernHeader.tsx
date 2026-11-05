// ============================================================
// MODERN HEADER — page title, quick module search, then the live status the
// old header carried (connection, printer, version, notifications, branch,
// clock, zoom), grouped and quieter. Nothing was removed.
// ============================================================
import type { ReactNode } from 'react';
import { Activity, Check, LogOut, Menu, Palette, PanelLeftClose, PanelLeftOpen, Search, Type, ZoomIn, ZoomOut } from 'lucide-react';
import HeaderNotificationBar from '@/components/HeaderNotificationBar';
import BillingStatusBar from '@/components/BillingStatusBar';
import HeaderClock from '@/components/shell/HeaderClock';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAccentOverride, useRefinedSurface, useThemeId, useUiLook, REFINED_SURFACES } from '@/lib/uiStyle';
import { REFINED_SCHEMES, activeRefinedScheme, applyRefinedScheme } from '@/lib/refinedSchemes';
import { ESPRESSO_THEME_ID, isRefinedTheme } from '@/lib/uiThemes';

interface Props {
  title: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMobileMenu: () => void;
  onOpenLauncher: () => void;
  zoom: number;
  onZoom: (delta: number) => void;
  onResetZoom: () => void;
  /** Extra controls placed before the clock (the branch selector). */
  children?: ReactNode;
  /** Live status chips beside the notification bell (the cloud app's pending-sync and restaurant-identity chips). */
  chips?: ReactNode;
  /** Controls after the text-size button (the cloud app's connection / sync badge). */
  tail?: ReactNode;
  /** DT Retail look: the signed-in user's chip with the log-out button, at the far right. */
  userChip?: { name: string; role: string; onLogout: () => void };
}

const iconButton = 'grid h-9 w-9 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

/** v1.103.0 — DT Refined: change the colour scheme from anywhere, without opening Settings. Colours only; nothing moves. */
function SchemeSwitcher() {
  const surface = useRefinedSurface();
  const accent = useAccentOverride();
  const active = activeRefinedScheme(surface, accent);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={iconButton} aria-label="Colour scheme" title="Colour scheme" data-testid="scheme-switcher">
          <Palette className="h-[18px] w-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Colour scheme</span>
          <span className="text-[11px] text-muted-foreground">{active ? active.name : 'Custom'}</span>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Colour scheme">
          {REFINED_SCHEMES.map(sc => {
            const surf = REFINED_SURFACES.find(x => x.id === sc.surface)!;
            const on = active?.id === sc.id;
            return (
              <button
                key={sc.id} type="button" role="radio" aria-checked={on} data-scheme={sc.id} onClick={() => applyRefinedScheme(sc)}
                className={`group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[11.5px] font-semibold transition-colors ${on ? 'border-primary bg-primary/5' : 'hover:border-primary/40'}`}
              >
                <span className="relative flex h-9 w-full overflow-hidden rounded-lg border" style={{ background: surf.page }} aria-hidden>
                  <span className="w-1/3" style={{ background: surf.card, borderRight: `1px solid ${surf.ink}22` }} />
                  <span className="m-auto h-3 w-1/3 rounded" style={{ background: sc.accent || '#5b21b6' }} />
                </span>
                <span className="truncate">{sc.name}</span>
                {on && <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">More choices, and your own accent colour: Settings → Appearance.</p>
      </PopoverContent>
    </Popover>
  );
}

export default function ModernHeader({
  title, collapsed, onToggleCollapse, onOpenMobileMenu, onOpenLauncher, zoom, onZoom, onResetZoom, children, chips, tail, userChip,
}: Props) {
  const themeId = useThemeId();
  const espresso = useUiLook() === 'retail' && themeId === ESPRESSO_THEME_ID;
  // v1.85.0 — DT Refined (design package SW-02): a wide search, the branch, the sync state, the bell and the user;
  // the other live status chips (connection, print mode, setup check, version) sit one click away under "Status".
  const refined = isRefinedTheme(themeId);
  return (
    <header data-ui-shell="header" className="flex h-[var(--ui-header-h)] shrink-0 items-center gap-2 border-b bg-card px-4">
      <button type="button" className={`${iconButton} lg:hidden`} onClick={onOpenMobileMenu} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={`${iconButton} hidden lg:grid`} onClick={onToggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</TooltipContent>
      </Tooltip>

      <h1 className="max-w-[12rem] shrink-0 truncate text-[17px] font-extrabold tracking-tight text-foreground" title={title}>{title}</h1>

      <button
        type="button"
        onClick={onOpenLauncher}
        data-dtr="search-wide"
        className={`ml-2 hidden h-9 shrink-0 items-center gap-2 rounded-[10px] border bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground ${refined ? 'w-[300px] xl:flex' : 'w-[220px] 2xl:flex'}`}
        aria-label="Search modules"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">{refined ? 'Search modules…' : 'Go to module…'}</span>
      </button>
      <button type="button" data-dtr="search-icon" className={`${iconButton} shrink-0 ${refined ? 'xl:hidden' : '2xl:hidden'}`} onClick={onOpenLauncher} aria-label="Search modules">
        <Search className="h-[18px] w-[18px]" />
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* The cloud app shows more live status than the offline POS did (connection, print mode, setup check, version,
            billing, pending sync). They share the room that is left and scroll sideways rather than push the clock off. */}
        <div className="dt-header-chips flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {refined ? (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={iconButton} aria-label="Status" title="Connection, printing and setup status" data-testid="refined-status">
                  <Activity className="h-[18px] w-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto max-w-[min(92vw,560px)] p-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Status</div>
                <div className="flex flex-wrap items-center gap-1.5"><BillingStatusBar /></div>
              </PopoverContent>
            </Popover>
          ) : (
            <div className="hidden shrink-0 items-center gap-1.5 xl:flex">
              <BillingStatusBar />
            </div>
          )}
          <HeaderNotificationBar />
          {chips}
        </div>
        {children}
        <HeaderClock variant={espresso ? 'stacked' : 'modern'} />
        {refined && <SchemeSwitcher />}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={iconButton} aria-label="Text size" title="Text size">
              <Type className="h-[18px] w-[18px]" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Screen text size</div>
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => onZoom(-5)} className={`${iconButton} border`} aria-label="Smaller"><ZoomOut className="h-4 w-4" /></button>
              <button type="button" onClick={onResetZoom} className="rounded-lg px-2 py-1 font-mono text-[13px] font-bold tabular-nums hover:bg-accent" title="Reset to 100%">{zoom}%</button>
              <button type="button" onClick={() => onZoom(5)} className={`${iconButton} border`} aria-label="Larger"><ZoomIn className="h-4 w-4" /></button>
            </div>
          </PopoverContent>
        </Popover>
        {tail}
        {userChip && (
          <div data-dtr="user-chip" className={refined ? 'ml-1 flex shrink-0 items-center gap-2.5 border-l pl-3' : undefined}>
            <span data-dtr="avatar" className={refined ? 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[13px] font-extrabold text-primary' : 'text-[13px]'}>
              {refined ? (userChip.name || userChip.role || '?').slice(0, 2).toUpperCase() : (userChip.name || userChip.role || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className={`hidden min-w-0 leading-tight ${refined ? 'xl:block' : 'sm:block'}`}>
              <span className="block max-w-[9rem] truncate text-[13px] font-bold">{userChip.name || userChip.role}</span>
              <span className="block text-[11px] capitalize text-muted-foreground">{userChip.role}</span>
            </span>
            <button type="button" onClick={userChip.onLogout} aria-label="Log out" title="Log out"
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
