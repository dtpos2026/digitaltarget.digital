import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Delete } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  unit?: string;
  onConfirm: (value: number) => void;
}

export default function NumpadDialog({ open, onOpenChange, title, subtitle, unit = '', onConfirm }: Props) {
  const [value, setValue] = useState('');

  const handleKey = (key: string) => {
    if (key === 'C') { setValue(''); return; }
    if (key === '⌫') { setValue(v => v.slice(0, -1)); return; }
    if (key === '.' && value.includes('.')) return;
    setValue(v => v + key);
  };

  const handleConfirm = () => {
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      onConfirm(num);
      setValue('');
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) setValue('');
    onOpenChange(o);
  };

  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xs p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </DialogHeader>

        {/* Display */}
        <div className="bg-accent rounded-lg px-4 py-3 text-right">
          <span className="text-2xl font-bold font-mono text-foreground">
            {value || '0'}
          </span>
          {unit && <span className="text-sm text-muted-foreground ml-1">{unit}</span>}
        </div>

        {/* Numpad Grid */}
        <div className="grid grid-cols-3 gap-1.5">
          {keys.map(key => (
            <button
              key={key}
              onClick={() => handleKey(key)}
              className="h-12 rounded-lg bg-card border text-lg font-semibold hover:bg-accent transition-colors active:scale-95 flex items-center justify-center"
            >
              {key === '⌫' ? <Delete className="h-5 w-5" /> : key}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" onClick={() => { setValue(''); handleOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!value || parseFloat(value) <= 0}>
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
