// Shared visual pieces of the DT Rider screens (v1.88.0) — design-project/05-rider-app.
import { useEffect, type ReactNode } from 'react';
import { Check, ChevronLeft, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RIDER_STEPS, stepIndex, type StageTone } from '@/lib/riderApp';
import type { DeliveryStatus } from '@/lib/types';

export function RCard({ children, className, active, ...rest }: { children: ReactNode; className?: string; active?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return <div data-rd-card data-active={active ? 'true' : undefined} className={cn('p-4', className)} {...rest}>{children}</div>;
}

export function RLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 pt-1">
      <span data-rd-label>{children}</span>
      {right}
    </div>
  );
}

const TONE: Record<StageTone, string> = {
  accent: 'bg-[hsl(var(--rd-tint))] text-primary',
  warn: 'bg-[hsl(var(--rd-warn-bg))] text-[hsl(var(--rd-warn))]',
  ok: 'bg-[hsl(var(--rd-ok-bg))] text-[hsl(var(--rd-ok))]',
  info: 'bg-[hsl(var(--rd-info-bg))] text-[hsl(var(--rd-info))]',
  bad: 'bg-[hsl(var(--rd-bad-bg))] text-[hsl(var(--rd-bad))]',
  neutral: 'bg-muted text-muted-foreground',
};
export function RBadge({ tone, children, className }: { tone: StageTone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold', TONE[tone], className)}>{children}</span>;
}

/** The design's buttons: primary (orange), soft, plain; `lg` is the 52-px one-handed action. */
export function RButton({
  children, onClick, variant = 'plain', size = 'md', disabled, busy, className, icon: Icon, type = 'button', ...rest
}: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'soft' | 'plain' | 'danger' | 'ghost'; size?: 'sm' | 'md' | 'lg';
  disabled?: boolean; busy?: boolean; className?: string; icon?: LucideIcon; type?: 'button' | 'submit';
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>) {
  const v = {
    primary: 'bg-primary text-primary-foreground border-primary',
    soft: 'bg-[hsl(var(--rd-tint))] text-primary border-transparent',
    plain: 'bg-card text-foreground border-border',
    danger: 'bg-[hsl(var(--rd-bad))] text-white border-[hsl(var(--rd-bad))]',
    ghost: 'bg-transparent text-primary border-transparent',
  }[variant];
  const s = { sm: 'h-9 px-3 text-[14px] rounded-[10px]', md: 'h-11 px-4 text-[15px] rounded-xl', lg: 'h-[52px] px-5 text-[16px] rounded-[14px]' }[size];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn('inline-flex items-center justify-center gap-2 whitespace-nowrap border font-bold transition-opacity disabled:opacity-45', v, s, className)}
      {...rest}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

/** A screen below a tab: back arrow, title, optional action. */
export function AppBar({ title, onBack, right }: { title: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="flex min-h-[56px] items-center gap-2.5 py-2">
      {onBack && (
        <button type="button" aria-label="Back" onClick={onBack} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-card">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-[20px] font-extrabold tracking-tight">{title}</h1>
      {right}
    </header>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div data-rd-seg role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Banner({ tone, icon: Icon, children, action }: { tone: 'warn' | 'bad' | 'info' | 'ok'; icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  const c = {
    warn: 'bg-[hsl(var(--rd-warn-bg))] text-[hsl(var(--rd-warn))]',
    bad: 'bg-[hsl(var(--rd-bad-bg))] text-[hsl(var(--rd-bad))]',
    info: 'bg-[hsl(var(--rd-info-bg))] text-[hsl(var(--rd-info))]',
    ok: 'bg-[hsl(var(--rd-ok-bg))] text-[hsl(var(--rd-ok))]',
  }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[14px] font-semibold', c)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** RID-21 — one sentence, one action, centred. */
export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-[14px] text-muted-foreground">
      <div className="mb-1 grid h-16 w-16 place-items-center rounded-full bg-[hsl(var(--rd-tint))] text-primary"><Icon className="h-7 w-7" /></div>
      <div className="text-[17px] font-bold text-foreground">{title}</div>
      {children && <div className="max-w-[300px]">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div data-rd-skel aria-hidden className={className} />;
}

/** A bottom sheet over a dimmed screen (RID-08, RID-12). Escape and a tap outside close it. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-[rgba(15,11,24,.5)]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={label} data-rd-sheet className="relative mx-auto w-full max-w-md space-y-3">
        {children}
      </div>
    </div>
  );
}

/** RID-11 — the four rider steps; done ones filled. */
export function Stepper({ stage, icons }: { stage?: DeliveryStatus; icons: LucideIcon[] }) {
  const at = stepIndex(stage);
  return (
    <ol className="flex gap-1.5" aria-label="Delivery steps">
      {RIDER_STEPS.map((s, i) => {
        const Icon = icons[i];
        const done = i <= at;
        return (
          <li key={s.stage} aria-current={i === at ? 'step' : undefined} className={cn('flex flex-1 flex-col items-center gap-1 text-center', !done && 'opacity-45')}>
            <span className={cn('grid h-10 w-10 place-items-center rounded-full', done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
              {done && i < at ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
            </span>
            <span className="text-[12px] font-bold leading-tight">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} data-rd-toggle onClick={() => onChange(!checked)} />;
}

/** A tick box the size of a thumb (RID-10, RID-13). */
export function CheckRow({ checked, onChange, children, sub }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; sub?: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 py-3 text-left">
      <span data-rd-check data-on={checked ? 'true' : 'false'}>{checked && <Check className="h-4 w-4" />}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{children}</span>
        {sub && <span className="block text-[13px] text-muted-foreground">{sub}</span>}
      </span>
    </button>
  );
}

/** The one action at the bottom of a delivery screen: always in reach of the thumb. */
export function StickyAction({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-auto self-stretch bg-gradient-to-t from-[hsl(var(--background))] via-[hsl(var(--background))] to-transparent px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-5">
      {children}
    </div>
  );
}
