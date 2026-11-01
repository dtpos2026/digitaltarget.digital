import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Nothing here yet — say so, and say what to do next. Never a blank white area. */
export default function EmptyState({ icon: Icon = Inbox, title, description, action, className }: Props) {
  return (
    <div role="status" className={cn('flex flex-col items-center justify-center gap-2 rounded-[var(--ui-radius-card,1rem)] border border-dashed bg-card/60 px-6 py-12 text-center', className)}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <div className="text-[15px] font-bold text-foreground">{title}</div>
      {description && <p className="max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
