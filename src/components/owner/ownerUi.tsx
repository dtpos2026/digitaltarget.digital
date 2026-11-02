// Shared visual pieces of the Owner app screens (v1.86.0) — cards, chips, badges, headers. Hooks: ./ownerHooks.ts
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
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
  info: 'bg-[hsl(214_95%_93%)] text-[hsl(var(--own-info))]',
  success: 'bg-[hsl(141_84%_93%)] text-[hsl(var(--own-ok))]',
  warning: 'bg-[hsl(48_96%_89%)] text-[hsl(var(--own-warn))]',
  danger: 'bg-[hsl(0_93%_94%)] text-[hsl(var(--own-bad))]',
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-[hsl(258_68%_93%)] text-primary',
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
        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--own-bad))] px-1 text-[11px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
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
