import { lazy, Suspense, useState } from 'react';
import { money } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { CreditCard } from 'lucide-react';
import { Order, PaymentEntry } from '@/lib/types';
import { saveOrder, getTables, saveTable, genId } from '@/lib/store';
import { enqueueReceipt } from '@/lib/printQueue';
import { toast } from 'sonner';
import { releasedTable } from '@/lib/tableRelease';

const PaymentDialog = lazy(() => import('@/components/PaymentDialog'));

interface Props {
  order: Order;
  onUpdated?: () => void;
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * Button + dialog to receive remaining (balance due) on a partially paid bill.
 * Appends to order.payments[], updates amountPaid, marks 'paid' when full.
 */
export default function ReceivePaymentButton({ order, onUpdated, size = 'sm', className }: Props) {
  const [open, setOpen] = useState(false);
  const total = Number(order.grandTotal || 0);
  const paidSoFar = Number(order.amountPaid || 0);
  const due = Math.max(0, total - paidSoFar);

  const handleConfirm = (r: any) => {
    setOpen(false);
    const stamp = new Date().toISOString();
    const by = localStorage.getItem('pos-user-name') || 'cashier';
    const newPayments: PaymentEntry[] = (r.payments || []).map((p: any) => ({
      ...p, id: genId(), at: stamp, by,
    }));
    const merged: PaymentEntry[] = [...(order.payments || []), ...newPayments];
    const newPaid = merged.reduce((s, p) => s + (p.amount || 0), 0);
    const fully = newPaid >= total - 0.5;
    const updated: Order = {
      ...order,
      payments: merged,
      amountPaid: Math.min(newPaid, total),
      status: fully ? 'paid' : 'partial',
      paymentMethod: order.paymentMethod || r.method,
      paymentAccountId: order.paymentAccountId || r.accountId,
      paymentAccountName: order.paymentAccountName || r.accountName,
      paidAt: fully ? stamp : order.paidAt,
    };
    saveOrder(updated);
    if (fully && order.tableId) {
      const t = getTables().find(t => t.id === order.tableId);
      if (t) saveTable(releasedTable(t, updated));   // v1.15.1 — clears the dine timer too
    }
    try { enqueueReceipt(updated, { force: true }); } catch {}
    toast.success(fully
      ? `Bill #${order.orderNumber} fully paid — receipt printing`
      : `${money(r.totalReceived)} received · ${money(Math.max(0, total - newPaid))} still pending`);
    onUpdated?.();
  };

  return (
    <>
      <Button
        size={size}
        className={className || 'h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white'}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <CreditCard className="h-3 w-3 mr-1" /> Receive {money(due)}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <PaymentDialog
            open={open}
            onClose={() => setOpen(false)}
            grandTotal={due}
            items={order.items}
            onConfirm={handleConfirm}
            customerPhone={order.customer?.phone}
            remainingMode
          />
        </Suspense>
      )}
    </>
  );
}
