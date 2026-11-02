// DT Order Taker — Review and send (OTK-07), v1.92.0.
//
// "Check the order once, then send it to the kitchen." Shown by the POS when an order taker presses Send: the lines with
// their steppers, the table or order type, the total, and one big Send to kitchen. It only asks; what Send does is what it
// always did (POSScreen.processOrder('running')) — this adds a look at the order before it goes, so a wrong tap does not
// reach the kitchen. Never shown to a cashier.
import { Minus, Plus, ChefHat } from 'lucide-react';
import { money } from '@/lib/currency';
import type { CartItem } from '@/lib/types';
import { RBadge, RButton, Sheet } from '@/components/rider/riderUi';

export default function OrderTakerReview({ open, onClose, lines, where, total, onQty, onSend, editing }: {
  open: boolean; onClose: () => void; lines: CartItem[]; where: string; total: number;
  onQty: (id: string, delta: number) => void; onSend: () => void; editing?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} label="Review and send">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[19px] font-extrabold">{editing ? 'Update the order' : 'Review the order'}</h2>
        <RBadge tone="accent">{where}</RBadge>
      </div>
      <ul className="max-h-[46dvh] divide-y overflow-y-auto" data-otk-review-lines>
        {lines.length === 0 && <li className="py-6 text-center text-[14px] text-muted-foreground">Nothing added yet.</li>}
        {lines.map(l => (
          <li key={l.id} className="flex items-center gap-3 py-2.5" data-otk-review-line={l.id}>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{l.name}{l.variantName ? ` (${l.variantName})` : ''}</div>
              {l.note?.trim() && <div className="text-[13px] text-muted-foreground">{l.note.trim()}</div>}
            </div>
            {l.pricingType === 'weight' ? (
              // by-weight lines are changed on the weight panel, not by a stepper
              <span className="text-[14px] font-bold" data-otk-weight-line>{(Number(l.weightGrams) || 0) / 1000} kg</span>
            ) : (
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label={`Fewer ${l.name}`} disabled={l.quantity <= 1} onClick={() => onQty(l.id, -1)} className="grid h-9 w-9 place-items-center rounded-lg border bg-card disabled:opacity-40"><Minus className="h-4 w-4" /></button>
              <span className="w-6 text-center text-[15px] font-extrabold" aria-label={`${l.quantity} ${l.name}`}>{l.quantity}</span>
              <button type="button" aria-label={`More ${l.name}`} onClick={() => onQty(l.id, 1)} className="grid h-9 w-9 place-items-center rounded-lg border bg-card"><Plus className="h-4 w-4" /></button>
            </div>
            )}
            <span className="w-[72px] shrink-0 text-right text-[14px] text-muted-foreground">{money(l.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t pt-3"><span className="text-[15px] text-muted-foreground">Total</span><b className="text-[21px]">{money(total)}</b></div>
      <RButton variant="primary" size="lg" className="w-full" icon={ChefHat} disabled={lines.length === 0} onClick={onSend}>{editing ? 'Update the kitchen' : 'Send to kitchen'}</RButton>
      <RButton className="w-full" onClick={onClose}>Back to the order</RButton>
    </Sheet>
  );
}
