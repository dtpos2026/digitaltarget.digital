import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

export default function SearchField({ value, onChange, placeholder = 'Search…', className, ...rest }: Props) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={rest['aria-label'] || placeholder}
        className="h-10 w-full rounded-[10px] border border-input bg-[hsl(var(--ui-field-bg,var(--background)))] pl-9 pr-9 text-[14px] outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary/60 focus:shadow-[var(--ui-shadow-focus,0_0_0_3px_hsl(var(--ring)/0.2))]"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
