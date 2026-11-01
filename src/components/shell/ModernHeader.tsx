// ============================================================
// MODERN HEADER — page title, quick module search, then the live status the
// old header carried (connection, printer, version, notifications, branch,
// clock, zoom), grouped and quieter. Nothing was removed.
// ============================================================
import type { ReactNode } from 'react';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Type, ZoomIn, ZoomOut } from 'lucide-react';
import HeaderNotificationBar from '@/components/HeaderNotificationBar';
import BillingStatusBar from '@/components/BillingStatusBar';
import HeaderClock from '@/components/shell/HeaderClock';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useThemeId, useUiLook } from '@/lib/uiStyle';
import { ESPRESSO_THEME_ID } from '@/lib/uiThemes';

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

export default function ModernHeader({
  title, collapsed, onToggleCollapse, onOpenMobileMenu, onOpenLauncher, zoom, onZoom, onResetZoom, children, chips, tail, userChip,
}: Props) {
  const themeId = useThemeId();
  const espresso = useUiLook() === 'retail' && themeId === ESPRESSO_THEME_ID;
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
        className="ml-2 hidden h-9 w-[220px] shrink-0 items-center gap-2 rounded-[10px] border bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground 2xl:flex"
        aria-label="Search modules"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Go to module…</span>
      </button>
      <button type="button" data-dtr="search-icon" className={`${iconButton} shrink-0 2xl:hidden`} onClick={onOpenLauncher} aria-label="Search modules">
        <Search className="h-[18px] w-[18px]" />
      </button>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* The cloud app shows more live status than the offline POS did (connection, print mode, setup check, version,
            billing, pending sync). They share the room that is left and scroll sideways rather than push the clock off. */}
        <div className="dt-header-chips flex min-w-0 items-center gap-1.5 overflow-x-auto">
          <div className="hidden shrink-0 items-center gap-1.5 xl:flex">
            <BillingStatusBar />
          </div>
          <HeaderNotificationBar />
          {chips}
        </div>
        {children}
        <HeaderClock variant={espresso ? 'stacked' : 'modern'} />
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
          <div data-dtr="user-chip">
            <span data-dtr="avatar" className="text-[13px]">{(userChip.name || userChip.role || '?').slice(0, 1).toUpperCase()}</span>
            <span className="hidden min-w-0 leading-tight sm:block">
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
