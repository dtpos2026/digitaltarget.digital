import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Soft tinted background + solid text, from the status tokens, so it reads in either style. */
export const TONE_CLASS: Record<Tone, string> = {
  accent: 'bg-primary/10 text-primary',
  success: 'bg-[hsl(var(--status-success)/0.12)] text-[hsl(var(--status-success))]',
  warning: 'bg-amber-500/15 text-amber-700',
  danger: 'bg-[hsl(var(--status-danger)/0.10)] text-[hsl(var(--status-danger))]',
  info: 'bg-[hsl(var(--status-info)/0.11)] text-[hsl(var(--status-info))]',
  neutral: 'bg-muted text-muted-foreground',
};

interface Props {
  tone?: Tone;
  children: ReactNode;
  /** A small filled dot before the label. */
  dot?: boolean;
  className?: string;
}

export default function StatusBadge({ tone = 'neutral', children, dot = true, className }: Props) {
  return (
    <span
      data-tone={tone}
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold leading-none', TONE_CLASS[tone], className)}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
