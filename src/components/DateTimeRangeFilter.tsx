// ============================================================
// DateTimeRangeFilter — shared filter for all reports.
// Provides Start Date + Start Time + End Date + End Time inputs
// plus quick presets (Today / Yesterday / This Week / This Month / Custom).
// All values respect the Business Day engine.
// ============================================================
import { useEffect, useState } from 'react';
import { Calendar as CalIcon } from 'lucide-react';
import {
  getCurrentBusinessDay,
  getBusinessDayOffset,
  getBusinessDayRange,
} from '@/lib/businessDay';

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export interface DateTimeRange {
  startMs: number;
  endMs: number;
  preset: RangePreset;
}

interface Props {
  value?: DateTimeRange;
  onChange: (r: DateTimeRange) => void;
  className?: string;
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): number {
  return new Date(v).getTime();
}

function presetWindow(p: RangePreset): { startMs: number; endMs: number } {
  if (p === 'today') {
    const w = getCurrentBusinessDay();
    return { startMs: w.startMs, endMs: w.endMs };
  }
  if (p === 'yesterday') {
    const w = getBusinessDayOffset(1);
    return { startMs: w.startMs, endMs: w.endMs };
  }
  if (p === 'week') return getBusinessDayRange(7);
  if (p === 'month') return getBusinessDayRange(30);
  // custom — caller provides
  const w = getCurrentBusinessDay();
  return { startMs: w.startMs, endMs: w.endMs };
}

export default function DateTimeRangeFilter({ value, onChange, className }: Props) {
  const [preset, setPreset] = useState<RangePreset>(value?.preset || 'today');
  const [startStr, setStartStr] = useState(() => toLocalInput(value?.startMs ?? presetWindow(preset).startMs));
  const [endStr, setEndStr] = useState(() => toLocalInput(value?.endMs ?? presetWindow(preset).endMs));

  // When preset changes (non-custom), recompute window
  useEffect(() => {
    if (preset === 'custom') return;
    const w = presetWindow(preset);
    setStartStr(toLocalInput(w.startMs));
    setEndStr(toLocalInput(w.endMs));
    onChange({ startMs: w.startMs, endMs: w.endMs, preset });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const applyCustom = (s: string, e: string) => {
    setStartStr(s);
    setEndStr(e);
    onChange({ startMs: fromLocalInput(s), endMs: fromLocalInput(e), preset: 'custom' });
  };

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className || ''}`}>
      <div className="flex items-center gap-1 mr-2">
        <CalIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-bold text-muted-foreground">Range:</span>
      </div>
      {(['today', 'yesterday', 'week', 'month', 'custom'] as RangePreset[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setPreset(p)}
          className={`px-3 py-1.5 text-xs font-bold rounded-md border transition ${
            preset === p ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'
          }`}
        >
          {p === 'today' ? 'Today' :
            p === 'yesterday' ? 'Yesterday' :
            p === 'week' ? 'This Week' :
            p === 'month' ? 'This Month' : 'Custom'}
        </button>
      ))}
      <div className="flex flex-col">
        <label className="text-[10px] font-bold text-muted-foreground uppercase">Start</label>
        <input
          type="datetime-local"
          value={startStr}
          disabled={preset !== 'custom'}
          onChange={(e) => applyCustom(e.target.value, endStr)}
          className="text-xs border rounded-md px-2 py-1 bg-card"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-[10px] font-bold text-muted-foreground uppercase">End</label>
        <input
          type="datetime-local"
          value={endStr}
          disabled={preset !== 'custom'}
          onChange={(e) => applyCustom(startStr, e.target.value)}
          className="text-xs border rounded-md px-2 py-1 bg-card"
        />
      </div>
    </div>
  );
}
