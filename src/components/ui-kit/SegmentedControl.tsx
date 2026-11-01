import { cn } from '@/lib/utils';

interface Option<T extends string> { value: T; label: string; count?: number }

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
  'aria-label'?: string;
}

/** Pill tabs for filters (All / New / Cooking / Ready …). */
export default function SegmentedControl<T extends string>({ value, onChange, options, className, ...rest }: Props<T>) {
  return (
    <div role="tablist" aria-label={rest['aria-label']} className={cn('inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border bg-card p-1 shadow-sm', className)}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors',
              on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none', on ? 'bg-white/25 text-primary-foreground' : 'bg-muted text-muted-foreground')}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
