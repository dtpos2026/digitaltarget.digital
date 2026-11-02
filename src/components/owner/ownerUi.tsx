// Shared visual pieces of the Owner app screens (v1.86.0) — cards, chips, badges, headers. Hooks: ./ownerHooks.ts
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronLeft, Lock, RefreshCw, WifiOff } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { cn } from '@/lib/utils';
import { PRESETS, type RangePreset, type Tone } from '@/lib/ownerApp';

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div data-own-card className={cn('p-4', className)} {...rest}>{children}</div>;
}

export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 pb-2 pt-1">
      <span data-own-label>{children}</span>
      {right && <span className="text-[13px] text-muted-foreground">{right}</span>}
    </div>
  );
}

/** Period presets as the design draws them: a row of pills that scrolls sideways on a phone. */
export function PresetChips({ value, onChange, presets = PRESETS }: { value: RangePreset; onChange: (p: RangePreset) => void; presets?: typeof PRESETS }) {
  return (
    <div role="tablist" aria-label="Period" className="own-scroll-x -mx-4 flex gap-2 px-4 pb-1">
      {presets.map(p => (
        <button key={p.id} type="button" role="tab" aria-selected={value === p.id} data-own-chip onClick={() => onChange(p.id)}>{p.label}</button>
      ))}
    </div>
  );
}

const TONE: Record<Tone, string> = {
  info: 'bg-[hsl(var(--own-info-bg))] text-[hsl(var(--own-info))]',
  success: 'bg-[hsl(var(--own-ok-bg))] text-[hsl(var(--own-ok))]',
  warning: 'bg-[hsl(var(--own-warn-bg))] text-[hsl(var(--own-warn))]',
  danger: 'bg-[hsl(var(--own-bad-bg))] text-[hsl(var(--own-bad))]',
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-[hsl(var(--own-accent-bg))] text-primary',
};
export function Badge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-bold', TONE[tone], className)}>{children}</span>;
}

/** A screen title, with a back arrow on screens below a tab. */
export function ScreenHeader({ title, back, right, sub }: { title: ReactNode; back?: string | true; right?: ReactNode; sub?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="flex items-center gap-3 pb-3 pt-2">
      {back && (
        <button
          type="button"
          aria-label="Back"
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-card text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        {sub && <div className="text-[13px] text-muted-foreground">{sub}</div>}
        <h1 className="truncate text-[22px] font-extrabold leading-tight tracking-tight">{title}</h1>
      </div>
      {right}
    </header>
  );
}

export function IconButton({ label, onClick, children, badge }: { label: string; onClick: () => void; children: ReactNode; badge?: number }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-card text-foreground">
      {children}
      {!!badge && badge > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--own-bad))] px-1 text-[11px] font-bold text-[hsl(var(--primary-foreground))]">{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/60 px-4 py-8 text-center text-[14px] text-muted-foreground">
      <div>{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A thin level bar (share of the business, stock against its reorder level). */
export function Bar({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'bad' }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)} role="presentation">
      <div className={cn('h-full rounded-full', tone === 'bad' ? 'bg-[hsl(var(--own-bad))]' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ OWN-23 — what the owner sees when there is nothing, it is loading, or it failed (v1.91.0)

/** Placeholder rows in the shape of the content while it loads. */
export function Skeletons({ rows = 3, height = 'h-16' }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-2.5" aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, i) => <div key={i} className={cn('animate-pulse rounded-2xl bg-muted', height)} />)}
    </div>
  );
}

/** A failed load, with the way out. The cached content stays on screen below it. */
export function RetryBanner({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--own-bad)/.35)] bg-[hsl(var(--own-bad-bg))] px-4 py-3 text-[14px] font-semibold text-[hsl(var(--own-bad))]">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <span className="flex-1">{children}</span>
      <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-1.5 rounded-xl border bg-card px-3 text-[13.5px] font-bold text-foreground"><RefreshCw className="h-3.5 w-3.5" />Retry</button>
    </div>
  );
}

/** The phone has no connection: what is shown is the last data it loaded. */
export function OfflineBanner() {
  return (
    <div role="status" data-testid="own-offline" className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--own-warn)/.35)] bg-[hsl(var(--own-warn-bg))] px-4 py-2.5 text-[13.5px] font-semibold text-[hsl(var(--own-warn))]">
      <WifiOff className="h-4 w-4 shrink-0" /> You are offline. Showing the last data this phone loaded; changes are kept and sent when you are back.
    </div>
  );
}

/** This account may not open the screen: say so, and who can. */
export function PermissionDenied({ what, onBack }: { what: string; onBack: () => void }) {
  return (
    <div className="space-y-4 pt-10 text-center" data-testid="own-denied">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-muted text-muted-foreground"><Lock className="h-7 w-7" /></div>
      <h1 className="text-[20px] font-extrabold">{what} is not available to your account</h1>
      <p className="mx-auto max-w-[320px] text-[14.5px] text-muted-foreground">Your role does not include this screen. Ask the restaurant owner or administrator to allow it.</p>
      <button type="button" onClick={onBack} className="rounded-2xl border bg-card px-5 py-3 text-[15px] font-semibold">Back to Overview</button>
    </div>
  );
}
