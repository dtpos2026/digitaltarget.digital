import { ReceiptTextStyle, UrduFontOption, TextAlign } from '@/lib/types';
import { Input } from '@/components/ui/input';

const FONT_OPTIONS: { value: UrduFontOption; label: string }[] = [
  { value: 'default', label: 'Default (Mono)' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Norvas Demo Expanded', label: 'Norvas Demo Expanded' },
  { value: 'Regaltion Highter', label: 'Regaltion Highter' },
  { value: 'Aseer Unicode', label: 'Aseer Unicode (اردو)' },
  { value: 'AA Sameer Armaa', label: 'AA Sameer Armaa (اردو)' },
  { value: 'Jameel Noori Nastaleeq', label: 'Jameel Noori Nastaleeq (اردو)' },
  { value: 'Jameel Noori Nastaleeq Regular', label: 'Jameel Noori Nastaleeq Regular (اردو)' },
];

const ALIGN_OPTIONS: { value: TextAlign; icon: string }[] = [
  { value: 'left', icon: '◧' },
  { value: 'center', icon: '◫' },
  { value: 'right', icon: '◨' },
];

interface Props {
  label: string;
  style: ReceiptTextStyle;
  onChange: (s: ReceiptTextStyle) => void;
  onReset?: () => void;
  preview?: string;
}

const DEFAULT_STYLE: ReceiptTextStyle = { font: 'default', size: 12, align: 'center', bold: true };

export default function ReceiptStyleEditor({ label, style, onChange, onReset, preview }: Props) {
  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">{label}</span>
        <div className="flex items-center gap-2">
          {preview && (
            <span
              className="text-sm truncate max-w-[140px]"
              style={{
                fontFamily: style.font !== 'default' ? `'${style.font}', serif` : "'Lucida Console', monospace",
                fontSize: `${style.size}px`,
                fontWeight: style.bold ? 800 : 400,
                textAlign: style.align,
                direction: style.font !== 'default' ? 'rtl' : 'ltr',
              }}
            >
              {preview}
            </span>
          )}
          <button
            type="button"
            onClick={() => (onReset ? onReset() : onChange(DEFAULT_STYLE))}
            className="text-[10px] px-2 py-1 rounded border bg-card hover:bg-destructive hover:text-destructive-foreground transition-colors"
            title="Reset font / delete custom style"
          >
            ↺ Reset
          </button>
        </div>
      </div>

      {/* Font Select */}
      <div>
        <label className="text-[10px] text-muted-foreground">Font</label>
        <select
          className="w-full h-8 text-xs rounded-md border bg-background px-2"
          value={style.font}
          onChange={e => onChange({ ...style, font: e.target.value as UrduFontOption })}
        >
          {FONT_OPTIONS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Size + Bold + Align */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-muted-foreground">Size (px)</label>
          <Input
            type="number"
            className="h-7 text-xs"
            value={style.size}
            onChange={e => onChange({ ...style, size: Math.max(8, Math.min(40, Number(e.target.value))) })}
            min={8} max={40}
          />
        </div>
        <button
          onClick={() => onChange({ ...style, bold: !style.bold })}
          className={`h-7 w-8 rounded border text-xs font-black transition-colors ${
            style.bold ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'
          }`}
        >
          B
        </button>
        <div className="flex border rounded overflow-hidden">
          {ALIGN_OPTIONS.map(a => (
            <button
              key={a.value}
              onClick={() => onChange({ ...style, align: a.value })}
              className={`h-7 w-7 text-xs transition-colors ${
                style.align === a.value ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'
              }`}
            >
              {a.icon}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
