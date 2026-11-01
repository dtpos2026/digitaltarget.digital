import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** Only when it adds to the top bar's page name (which every page already has). */
  title?: string;
  description?: ReactNode;
  /** Buttons, filters, a date range… aligned to the right. */
  actions?: ReactNode;
  className?: string;
}

/** The strip at the top of a page: what this screen is for, and its main actions. */
export default function PageHeader({ title, description, actions, className }: Props) {
  if (!title && !description && !actions) return null;
  return (
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        {title && <h2 className="truncate text-[22px] font-extrabold leading-tight tracking-tight text-foreground">{title}</h2>}
        {description && <p className={cn('text-[13px] text-muted-foreground', title && 'mt-0.5')}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
