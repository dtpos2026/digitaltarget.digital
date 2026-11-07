// DT Order Taker — the app's own cart (v1.111.0).
//
// REPORTED by the owner after using the app on a phone: "the cart section is the software's cart — the Order Taker app should have
// its own cart, in the shape of an app, not copied things". Until now the Cart button opened the till's cart panel (an item table,
// a calculator keypad, CLR / Hold, a print-the-kitchen button). An order taker needs none of that: they need to see what was
// ordered, change a quantity, add a word for the kitchen, say where it goes, and send it.
//
// It only asks and arranges: Send still does what it always did (POSScreen.processOrder('running') after the review). The till's
// cart panel is untouched and still what a cashier sees.
import { useState } from 'react';
import { ChefHat, Minus, NotebookPen, Phone, Plus, Trash2, User, X } from 'lucide-react';
import { money } from '@/lib/currency';
import type { CartItem, OrderType } from '@/lib/types';
import { RBadge, RButton, Sheet } from '@/components/rider/riderUi';
import { cn } from '@/lib/utils';

export interface OrderTakerCartProps {
  open: boolean;
  onClose: () => void;
  lines: CartItem[];
  subtotal: number;
  total: number;
  editing?: boolean;
  /** "Table T-04", "Takeaway", "Delivery" — where this order goes. */
  where: string;
  orderType: OrderType;
  onOrderType: (t: OrderType) => void;
  /** An order already on a table cannot change type. */
  typeLocked?: boolean;
  types: { value: OrderType; label: string }[];
  onQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onLineNote: (id: string, note: string) => void;
  custName: string; custPhone: string; custAddress: string;
  onCustName: (v: string) => void; onCustPhone: (v: string) => void; onCustAddress: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
  onClear: () => void;
  onSend: () => void;
}

const NOTE_PRESETS = ['No onion', 'Less spicy', 'Extra spicy', 'No ice', 'Pack separately'];

export default function OrderTakerCart(p: OrderTakerCartProps) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const delivery = p.orderType === 'delivery';
  const count = p.lines.reduce((n, l) => n + (l.pricingType === 'weight' ? 1 : l.quantity), 0);
  const needAddress = delivery && !p.custAddress.trim();
  const needPhone = delivery && !p.custPhone.trim();
  const blocked = p.lines.length === 0 || needAddress || needPhone;

  return (
    <Sheet open={p.open} onClose={p.onClose} label="Your order">
      <div className="flex items-center gap-2" data-otk-cart-head>
        <h2 className="text-[19px] font-extrabold">{p.editing ? 'Update the order' : 'Your order'}</h2>
        <RBadge tone="accent">{p.where}</RBadge>
        <span className="ml-auto text-[13px] text-muted-foreground" data-otk-cart-count>{`${count} item${count === 1 ? '' : 's'}`}</span>
        <button type="button" aria-label="Close the order" onClick={p.onClose} className="grid h-9 w-9 place-items-center rounded-full border bg-card"><X className="h-4 w-4" /></button>
      </div>

      {/* where it goes */}
      <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-[hsl(var(--rd-tint))] p-1" role="group" aria-label="Order type" data-otk-cart-types>
        {p.types.map(t => (
          <button
            key={t.value} type="button" disabled={p.typeLocked} aria-pressed={p.orderType === t.value} onClick={() => p.onOrderType(t.value)}
            className={cn('h-10 rounded-xl text-[13.5px] font-bold transition-colors disabled:opacity-60',
              p.orderType === t.value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')}
          >{t.label}</button>
        ))}
      </div>

      {/* who it is for */}
      {(delivery || showCustomer || p.custName || p.custPhone) && (
        <div className="space-y-2" data-otk-cart-customer>
          <div className="grid grid-cols-2 gap-2">
            <label className="relative block">
              <User className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <input aria-label="Customer name" placeholder="Name" value={p.custName} onChange={e => p.onCustName(e.target.value)} className="h-11 w-full rounded-xl border bg-card pl-9 pr-3 text-[15px]" />
            </label>
            <label className="relative block">
              <Phone className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden />
              <input aria-label="Customer phone" placeholder={delivery ? 'Phone (needed)' : 'Phone'} inputMode="tel" value={p.custPhone} onChange={e => p.onCustPhone(e.target.value)}
                className={cn('h-11 w-full rounded-xl border bg-card pl-9 pr-3 text-[15px]', needPhone && 'border-[hsl(var(--rd-bad))]')} />
            </label>
          </div>
          {delivery && (
            <input aria-label="Delivery address" placeholder="Delivery address (house, street, landmark)" value={p.custAddress} onChange={e => p.onCustAddress(e.target.value)}
              className={cn('h-11 w-full rounded-xl border bg-card px-3 text-[15px]', needAddress && 'border-[hsl(var(--rd-bad))]')} />
          )}
        </div>
      )}
      {!delivery && !showCustomer && !p.custName && !p.custPhone && (
        <button type="button" onClick={() => setShowCustomer(true)} className="flex h-11 w-full items-center gap-2 rounded-xl border border-dashed px-3 text-left text-[14px] text-muted-foreground" data-otk-cart-add-customer>
          <User className="h-4 w-4" aria-hidden /> Add a customer name or phone (optional)
        </button>
      )}

      {/* what was ordered */}
      <ul className="max-h-[38dvh] divide-y overflow-y-auto rounded-2xl border bg-card" data-otk-cart-lines>
        {p.lines.length === 0 && <li className="py-8 text-center text-[14px] text-muted-foreground">Nothing added yet — pick items from the menu.</li>}
        {p.lines.map(l => (
          <li key={l.id} className="space-y-2 px-3 py-2.5" data-otk-cart-line={l.id}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-snug">{l.name}{l.variantName ? ` (${l.variantName})` : ''}</div>
                <div className="text-[12.5px] text-muted-foreground">{money(l.price)} each</div>
              </div>
              {l.pricingType === 'weight' ? (
                <span className="text-[14px] font-bold">{(Number(l.weightGrams) || 0) / 1000} kg</span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label={`Fewer ${l.name}`} disabled={l.quantity <= 1} onClick={() => p.onQty(l.id, -1)} className="grid h-9 w-9 place-items-center rounded-lg border bg-card disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                  <span className="w-6 text-center text-[15px] font-extrabold" aria-label={`${l.quantity} ${l.name}`}>{l.quantity}</span>
                  <button type="button" aria-label={`More ${l.name}`} onClick={() => p.onQty(l.id, 1)} className="grid h-9 w-9 place-items-center rounded-lg border bg-card"><Plus className="h-4 w-4" /></button>
                </div>
              )}
              <span className="w-[68px] shrink-0 text-right text-[14px] font-bold">{money(l.lineTotal)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setNoteFor(noteFor === l.id ? null : l.id)} aria-expanded={noteFor === l.id}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-primary">
                <NotebookPen className="h-3.5 w-3.5" aria-hidden />{l.note?.trim() ? l.note.trim() : 'Add a note'}
              </button>
              <button type="button" aria-label={`Remove ${l.name}`} onClick={() => p.onRemove(l.id)} className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-[hsl(var(--rd-bad))]"><Trash2 className="h-4 w-4" /></button>
            </div>
            {noteFor === l.id && (
              <div className="space-y-1.5" data-otk-cart-line-note>
                <input aria-label={`Note for ${l.name}`} autoFocus value={l.note || ''} onChange={e => p.onLineNote(l.id, e.target.value)} placeholder="e.g. no onion, extra spicy" className="h-10 w-full rounded-xl border bg-card px-3 text-[14px]" />
                <div className="flex flex-wrap gap-1.5">
                  {NOTE_PRESETS.map(t => (
                    <button key={t} type="button" onClick={() => p.onLineNote(l.id, (l.note?.trim() ? `${l.note.trim()}, ${t}` : t))} className="rounded-full border bg-card px-2.5 py-1 text-[12.5px] font-semibold">{t}</button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <label className="block">
        <span className="mb-1 block text-[12px] font-bold uppercase tracking-wide text-muted-foreground">Note for the kitchen</span>
        <textarea aria-label="Note for the kitchen" rows={2} value={p.note} onChange={e => p.onNote(e.target.value)} placeholder="Anything the whole order needs" className="w-full rounded-xl border bg-card px-3 py-2 text-[14px]" />
      </label>

      <div className="flex items-center justify-between border-t pt-3">
        <div>
          <div className="text-[13px] text-muted-foreground">Total</div>
          {p.subtotal !== p.total && <div className="text-[12px] text-muted-foreground">Items {money(p.subtotal)}</div>}
        </div>
        <b className="text-[22px]" data-otk-cart-total>{money(p.total)}</b>
      </div>
      {(needAddress || needPhone) && <p role="alert" className="text-[13px] font-semibold text-[hsl(var(--rd-bad))]" data-otk-cart-missing>A delivery order needs {needPhone && needAddress ? 'a phone number and an address' : needPhone ? 'a phone number' : 'an address'}.</p>}
      <RButton variant="primary" size="lg" className="w-full" icon={ChefHat} disabled={blocked} onClick={p.onSend}>{p.editing ? 'Update the kitchen' : 'Send to kitchen'}</RButton>
      <div className="grid grid-cols-2 gap-2">
        <RButton onClick={p.onClose}>Add more items</RButton>
        <RButton variant="ghost" disabled={p.lines.length === 0} onClick={p.onClear}>Clear the order</RButton>
      </div>
    </Sheet>
  );
}
