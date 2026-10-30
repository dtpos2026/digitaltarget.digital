// ============================================================================
// Sold-by-weight entry — a right-hand panel, "by weight" or "by amount"
//
// Replaces the inline numpad that used to double as the weight entry. The
// arithmetic is unchanged and lives in lib/weightPricing.ts; this component
// only collects a number and hands back the resulting line. It never touches
// the cart itself, so the cart line a weight item produces is byte-for-byte
// what it was.
//
// Keyboard: digits and "." type, Backspace deletes, Enter adds, Esc closes —
// a counter with a scale and a keyboard should not need the mouse.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { Delete, Scale } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { money } from '@/lib/currency';
import type { MenuItem } from '@/lib/types';
import {
  AMOUNT_QUICK, WEIGHT_QUICK, applyWeightKey, lineFromAmount, lineFromWeight,
  type WeightLine, type WeightUnit,
} from '@/lib/weightPricing';

type Mode = 'weight' | 'amount';

interface Props {
  /** The weight item being added; null keeps the panel closed. */
  item: MenuItem | null;
  onClose: () => void;
  onAdd: (item: MenuItem, line: WeightLine) => void;
}

const UNIT_LABEL: Record<WeightUnit, string> = { KG: 'kg', Gram: 'g', Pao: 'pao' };
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'DEL'] as const;
export default function WeightPanel({ item, onClose, onAdd }: Props) {
  const [mode, setMode] = useState<Mode>('weight');
  const [unit, setUnit] = useState<WeightUnit>('KG');
  const [entry, setEntry] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const open = !!item;
  const rate = Number(item?.ratePerKg) || 0;

  // A fresh item always starts from an empty entry, in the default mode.
  useEffect(() => {
    if (item) { setMode('weight'); setUnit('KG'); setEntry(''); }
  }, [item]);

  const value = parseFloat(entry);
  const line = useMemo<WeightLine | null>(() => {
    if (!item) return null;
    return mode === 'weight' ? lineFromWeight(value, unit, rate) : lineFromAmount(value, rate);
  }, [item, mode, unit, value, rate]);

  // By amount cannot work for an item that has no rate to divide by.
  const amountUnavailable = rate <= 0;

  const press = (key: string) => setEntry(prev => applyWeightKey(prev, key));
  const add = () => { if (item && line) onAdd(item, line); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { e.preventDefault(); add(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); press('DEL'); return; }
    if (e.key === '.' || e.key === ',') { e.preventDefault(); press('.'); return; }
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
  };

  const quick = mode === 'weight' ? WEIGHT_QUICK[unit] : AMOUNT_QUICK;
  const readoutLabel = mode === 'weight' ? `Enter ${UNIT_LABEL[unit]}` : 'Enter amount';
  const readoutUnit = mode === 'weight' ? UNIT_LABEL[unit] : '';

  const quantityText = line
    ? `${line.kg.toFixed(line.kg >= 10 ? 2 : 3)} kg`
    : '0 kg';

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        ref={contentRef}
        side="right"
        overlayClassName="bg-black/40"
        // Focus the panel itself, not its first tab: keys go straight to the readout
        // and no focus ring is drawn on a button nobody pressed.
        onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
        onKeyDown={onKeyDown}
        className="w-full sm:max-w-[420px] p-0 gap-0 flex flex-col overflow-y-auto focus:outline-none"
      >
        <div className="px-5 pt-5 pb-3 flex items-center gap-3 pr-12">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Scale className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <SheetTitle className="text-base font-extrabold leading-tight truncate">{item?.name}</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {money(rate)} per kg
            </SheetDescription>
          </div>
        </div>

        <div className="px-5">
          <div className="grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-bold" role="tablist" aria-label="Entry mode">
            {([['weight', 'By weight (kg)'], ['amount', 'By amount']] as const).map(([m, label]) => (
              <button
                key={m} type="button" role="tab" aria-selected={mode === m}
                disabled={m === 'amount' && amountUnavailable}
                onClick={() => { setMode(m); setEntry(''); }}
                className={`h-9 rounded-lg transition-colors ${
                  mode === m ? 'bg-card text-primary shadow ring-1 ring-primary/25' : 'text-muted-foreground hover:text-foreground'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >{label}</button>
            ))}
          </div>
          {amountUnavailable && (
            <p className="mt-1.5 text-[11px] text-status-warning font-semibold">
              This item has no price per kg, so it can only be entered by weight.
            </p>
          )}
        </div>

        <div className="px-5 mt-3">
          <div className="rounded-2xl bg-primary/10 px-4 py-3 text-right" aria-live="polite">
            <div className="text-xs font-semibold text-muted-foreground">{readoutLabel}</div>
            <div className="text-4xl font-black text-primary tabular-nums leading-tight">
              {entry || '0'}
              {readoutUnit && <span className="ml-1.5 text-lg font-extrabold">{readoutUnit}</span>}
            </div>
          </div>
        </div>

        {mode === 'weight' && (
          <div className="px-5 mt-2 flex justify-end gap-1" role="group" aria-label="Unit">
            {(['KG', 'Gram', 'Pao'] as const).map(u => (
              <button
                key={u} type="button" onClick={() => { setUnit(u); setEntry(''); }}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-bold border transition-colors ${
                  unit === u ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground hover:bg-accent'
                }`}
              >{UNIT_LABEL[u]}</button>
            ))}
          </div>
        )}

        <div className="px-5 mt-3 flex flex-wrap gap-1.5">
          {quick.map(q => (
            <button
              key={q} type="button" onClick={() => setEntry(String(q))}
              className={`h-8 px-3 rounded-lg border text-xs font-bold transition-colors ${
                entry === String(q) ? 'border-primary bg-primary/10 text-primary' : 'bg-card hover:bg-accent'
              }`}
            >{q}</button>
          ))}
        </div>

        <div className="px-5 mt-3 grid grid-cols-3 gap-2">
          {KEYS.map(k => (
            <button
              key={k} type="button" onClick={() => press(k)}
              aria-label={k === 'DEL' ? 'Backspace' : k}
              className="h-14 rounded-xl border bg-card text-xl font-extrabold flex items-center justify-center shadow-sm hover:bg-accent active:scale-[0.97] transition"
            >
              {k === 'DEL' ? <Delete className="h-5 w-5 text-destructive" /> : k}
            </button>
          ))}
        </div>

        <div className="mt-auto px-5 pb-5 pt-4 space-y-3">
          <div className="rounded-xl border bg-card px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Quantity</span><span className="font-extrabold tabular-nums">{quantityText}</span></div>
            <div className="flex justify-between items-baseline"><span className="text-muted-foreground">Price</span><span className="text-xl font-black text-primary tabular-nums">{money(line?.price ?? 0)}</span></div>
          </div>
          <button
            type="button" onClick={add} disabled={!line}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-extrabold text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            Add to cart
            <kbd className="text-[10px] font-bold rounded border border-primary-foreground/40 px-1.5 py-0.5">Enter</kbd>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
