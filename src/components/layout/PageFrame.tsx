// ============================================================
// PAGE FRAME (v1.109.0) — the pieces every page is built from, so the same kind of screen always looks the same:
//   <PageHeader>   a title, a one-line subtitle, the page's actions — wraps on a phone
//   <FilterBar>    search + filters in one wrapping row
//   <EmptyState> <LoadingState> <ErrorState>   one look for "nothing here", "loading" and "could not load"
// Styles live in src/styles/ui-screen.css and read the screen profile (src/lib/screenProfile.ts).
// ============================================================
import type { ComponentType, ReactNode } from 'react';
import { ArrowLeft, Inbox, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PageHeader({ title, subtitle, icon, actions, onBack, backLabel = 'Back' }: {
  title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; onBack?: () => void; backLabel?: string;
}) {
  return (
    <header data-page-header>
      <div data-page-heading className="flex items-start gap-2">
        {onBack && (
          <Button type="button" variant="outline" size="icon" aria-label={backLabel} onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        )}
        <div className="min-w-0">
          <h1 data-page-title className="flex items-center gap-2">
            {icon && <span className="text-primary [&>svg]:h-5 [&>svg]:w-5" aria-hidden>{icon}</span>}
            <span className="min-w-0 truncate">{title}</span>
          </h1>
          {subtitle && <p data-page-subtitle>{subtitle}</p>}
        </div>
      </div>
      {actions && <div data-page-actions>{actions}</div>}
    </header>
  );
}

/**
 * v1.110.0 — the title block of a page, in the design package's header style: an icon tile, the title (the page's one <h1>)
 * and a one-line subtitle. It is only the left half of a header: the page keeps its own row for the actions, so it drops in
 * where a bare <h1> was without moving anything else.
 */
export function PageTitle({ icon: Icon, children, subtitle }: {
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; children: ReactNode; subtitle?: ReactNode;
}) {
  return (
    <div data-page-heading className="flex min-w-0 items-center gap-3">
      {Icon && (
        <span data-page-icon className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <h1 data-page-title className="flex flex-wrap items-center gap-x-2 text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">{children}</h1>
        {subtitle && <p data-page-subtitle>{subtitle}</p>}
      </div>
    </div>
  );
}

/** The search box and its filters, in one row that wraps. Give the search field `data-filter-grow` to let it take the spare room. */
export function FilterBar({ children, label = 'Filters' }: { children: ReactNode; label?: string }) {
  return <div data-filter-bar role="search" aria-label={label}>{children}</div>;
}

export function EmptyState({ title, hint, icon, action }: { title: string; hint?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div data-testid="empty-state" className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-center">
      <span className="text-muted-foreground [&>svg]:h-8 [&>svg]:w-8" aria-hidden>{icon ?? <Inbox />}</span>
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div data-testid="loading-state" role="status" aria-live="polite" className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function ErrorState({ title = 'Could not load this', hint, onRetry, retryLabel = 'Try again' }: {
  title?: string; hint?: string; onRetry?: () => void; retryLabel?: string;
}) {
  return (
    <div data-testid="error-state" role="alert" className="flex flex-col items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center">
      <TriangleAlert className="h-7 w-7 text-destructive" aria-hidden />
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {onRetry && <Button type="button" size="sm" variant="outline" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}
