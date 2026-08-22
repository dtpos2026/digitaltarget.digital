import { useEffect, useMemo, useRef, useState } from 'react';
import { money } from '@/lib/currency';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { searchCustomers, gradeColor, computeGrade } from '@/lib/customers';
import { CustomerProfile } from '@/lib/types';
import { Search, Phone, User as UserIcon, Clock } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSelect: (c: CustomerProfile) => void;
  mode?: 'name' | 'phone';
  placeholder?: string;
  className?: string;
}

export default function CustomerAutocomplete({ value, onChange, onSelect, mode = 'name', placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    if (!value || value.length < 1) return [];
    return searchCustomers(value, 8);
  }, [value]);

  useEffect(() => { setHighlight(0); }, [value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (c: CustomerProfile) => {
    onSelect(c);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    if (e.key === 'Enter')     { if (open) { e.preventDefault(); choose(suggestions[highlight]); } }
    if (e.key === 'Escape')    { setOpen(false); }
  };

  return (
    <div ref={wrapRef} className={`relative ${className || ''}`}>
      <div className="relative">
        {mode === 'phone'
          ? <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          : <UserIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />}
        <Input
          className="pl-8"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder || (mode === 'phone' ? 'Phone (auto-suggest)' : 'Customer name (auto-suggest)')}
          type={mode === 'phone' ? 'tel' : 'text'}
          autoComplete="off"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-80 overflow-auto rounded-md border bg-popover shadow-lg">
          {suggestions.map((c, i) => {
            const g = c.grade || computeGrade(c.totalSpent || 0);
            return (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(c)}
                className={`w-full text-left px-3 py-2 text-sm border-b last:border-0 transition-colors ${
                  i === highlight ? 'bg-accent' : 'hover:bg-accent/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{c.name || 'Unnamed'}</span>
                  <Badge className={`text-[9px] uppercase ${gradeColor(g)}`}>{g}</Badge>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</span>
                  <span>{c.totalOrders} orders</span>
                  <span>{money((c.totalSpent || 0))}</span>
                  {c.lastOrderAt && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(c.lastOrderAt).toLocaleDateString()}</span>}
                </div>
                {(c.fullAddress || c.addresses?.[0]) && (
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">{c.fullAddress || c.addresses[0]}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
