import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Remove the inner padding (for tables that run edge to edge). */
  flush?: boolean;
}

/** A titled panel — the building block of dashboards, reports and settings. */
export default function SectionCard({ title, description, actions, children, className, flush }: Props) {
  return (
    <section className={cn('rounded-[var(--ui-radius-card,1rem)] border bg-card shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 pb-0 pt-4">
          <div className="min-w-0">
            {title && <h3 className="truncate text-[15px] font-bold tracking-tight text-foreground">{title}</h3>}
            {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? 'pt-3' : 'p-5', (title || actions) && !flush && 'pt-3')}>{children}</div>
    </section>
  );
}
