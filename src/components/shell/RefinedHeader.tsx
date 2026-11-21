// REFINED TOP BAR — design SW-02, exactly: the page title, a search with a Ctrl K badge, the branch, "Synced 12 s ago", the bell and
// the user. Sixty pixels, one row, nothing else. Everything the bar used to carry (clock, colour scheme, text size, status, log out)
// is one click away in the user menu.
import { useEffect, type ReactNode } from 'react';
import { Menu, Search } from 'lucide-react';
import HeaderNotificationBar from '@/components/HeaderNotificationBar';
import BillingStatusBar from '@/components/BillingStatusBar';
import RefinedSyncChip from '@/components/shell/RefinedSyncChip';
import RefinedUserMenu from '@/components/shell/RefinedUserMenu';
import { useLocation } from '@/lib/hash-router';

interface Props {
  title: string;
  onOpenMobileMenu: () => void;
  onOpenLauncher: () => void;
  zoom: number;
  onZoom: (delta: number) => void;
  onResetZoom: () => void;
  /** The branch chip. */
  children?: ReactNode;
  user: { name: string; role: string; onLogout: () => void };
}

export default function RefinedHeader({ title, onOpenMobileMenu, onOpenLauncher, zoom, onZoom, onResetZoom, children, user }: Props) {
  const location = useLocation();
  // On the POS, Ctrl K belongs to the item search (POSScreen); everywhere else it opens the module search.
  const onPos = location.pathname === '/';
  useEffect(() => {
    if (onPos) return;
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpenLauncher(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onPos, onOpenLauncher]);

  return (
    <header data-ui-shell="header" data-refined-header className="flex h-[var(--ui-header-h)] shrink-0 items-center gap-2 border-b bg-card px-3 sm:gap-3 sm:px-5">
      <button type="button" className="grid h-9 w-9 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden" onClick={onOpenMobileMenu} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>

      <h1 className="min-w-0 max-w-[16rem] shrink truncate text-[16px] font-extrabold sm:text-[18px] md:shrink-0 tracking-tight text-foreground" title={title}>{title}</h1>

      {/* the design: the title, a spacer, then search · branch · sync · bell · user together at the right */}
      <span className="flex-1" aria-hidden />
      <button
        type="button" onClick={onOpenLauncher} data-dtr="search-wide" aria-label="Search modules"
        className="hidden h-[38px] w-[300px] min-w-[170px] shrink items-center gap-2 rounded-xl border bg-background px-3 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex lg:w-[340px]"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search modules…</span>
        {!onPos && <kbd className="rounded-md border bg-card px-1.5 py-0.5 font-sans text-[11px] font-semibold text-muted-foreground">Ctrl K</kbd>}
      </button>
      <button type="button" data-dtr="search-icon" onClick={onOpenLauncher} aria-label="Search modules"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden">
        <Search className="h-[18px] w-[18px]" />
      </button>

      {/* the one-time "Browser Print Mode" notice is a floating card; the status pills themselves live in the user menu */}
      <BillingStatusBar pills={false} />
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
        {children}
        <RefinedSyncChip />
        <HeaderNotificationBar />
        <RefinedUserMenu name={user.name} role={user.role} onLogout={user.onLogout} zoom={zoom} onZoom={onZoom} onResetZoom={onResetZoom} />
      </div>
    </header>
  );
}
