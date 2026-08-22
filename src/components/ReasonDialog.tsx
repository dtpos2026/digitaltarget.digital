import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  presets?: string[];
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (reason: string) => void;
}

/** Universal "reason required" dialog used for Void / Cancel / Complimentary. */
export default function ReasonDialog({
  open, onOpenChange, title, description, presets = [],
  confirmLabel = 'Confirm', destructive = true, onConfirm,
}: Props) {
  const [reason, setReason] = useState('');

  useEffect(() => { if (open) setReason(''); }, [open]);

  const handleConfirm = () => {
    const r = reason.trim();
    if (!r) { toast.error('A reason is required'); return; }
    onConfirm(r);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </DialogHeader>
        <div className="space-y-2">
          {presets.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {presets.map(p => (
                <button key={p} type="button" onClick={() => setReason(p)}
                  className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-accent border font-medium">
                  {p}
                </button>
              ))}
            </div>
          )}
          <Textarea
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason likhein (required)…"
            rows={3}
            className="text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={handleConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
