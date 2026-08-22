// Reusable searchable select (Combobox) — Popover + Command (cmdk).
// Use when option list is long and user needs to type-to-filter.
import { useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';

export interface SearchableOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface Props {
  options: SearchableOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  triggerClassName?: string;
}

export default function SearchableSelect({
  options, value, onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyText = 'No match',
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between font-normal',
            !selected && 'text-muted-foreground',
            triggerClassName,
          )}
        >
          <span className="truncate text-left">
            {selected ? (
              <>
                {selected.label}
                {selected.hint && <span className="text-muted-foreground text-[10px] ml-1">{selected.hint}</span>}
              </>
            ) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] max-w-[420px]" align="start">
        <Command>
          <div className="flex items-center border-b px-2">
            <Search className="h-4 w-4 opacity-50 mr-1" />
            <CommandInput placeholder={searchPlaceholder} className="h-9 border-0 focus:ring-0" />
          </div>
          <CommandList className="max-h-[280px]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map(opt => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.hint || ''} ${opt.value}`}
                  disabled={opt.disabled}
                  onSelect={() => { onChange(opt.value); setOpen(false); }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === opt.value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{opt.label}</span>
                  {opt.hint && <span className="ml-auto text-[10px] text-muted-foreground">{opt.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
