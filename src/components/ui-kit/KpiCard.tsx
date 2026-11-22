// The design's figure card (SW-02 / 24 / 26): the label top left, a tinted icon tile top right, the number big, one line of context.
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function KpiCard({ label, value, icon: Icon, caption, captionTone }: { label: string; value: ReactNode; icon: LucideIcon; caption?: ReactNode; captionTone?: 'ok' | 'bad' }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-5 shadow-card" data-kpi={label}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-bold">{label}</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[hsl(var(--dt-accent-tint))] text-primary"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
      </div>
      <div className="mt-2 truncate text-[26px] font-extrabold leading-tight tracking-tight tabular-nums">{value}</div>
      {caption && <div className={cn('mt-1 text-[12px] font-bold', captionTone === 'ok' ? 'text-[hsl(var(--dt-ok))]' : captionTone === 'bad' ? 'text-[hsl(var(--dt-bad))]' : 'text-muted-foreground')}>{caption}</div>}
    </div>
  );
}
