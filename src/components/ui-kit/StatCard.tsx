import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_CLASS, type Tone } from './StatusBadge';

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
}

/** One number, said clearly: label, value, and a line of context. */
export default function StatCard({ label, value, hint, icon: Icon, tone = 'accent', className }: Props) {
  return (
    <div data-stat-card className={cn('min-w-0 rounded-[var(--ui-radius-card,1rem)] border bg-card p-4 shadow-sm', className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-[10px]', TONE_CLASS[tone])}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <span className="min-w-0 truncate text-[13px] font-semibold text-muted-foreground">{label}</span>
      </div>
      <div className="mt-3 truncate text-[24px] font-extrabold leading-none tracking-tight tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-1.5 truncate text-[12px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
