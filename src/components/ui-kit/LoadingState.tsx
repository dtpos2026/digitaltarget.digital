import { cn } from '@/lib/utils';

interface Props {
  rows?: number;
  label?: string;
  className?: string;
}

/** Skeleton rows while data loads, with a text label for screen readers. */
export default function LoadingState({ rows = 4, label = 'Loading…', className }: Props) {
  return (
    <div role="status" aria-live="polite" className={cn('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-slot="skeleton" className="h-12 animate-pulse rounded-xl bg-muted" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}
