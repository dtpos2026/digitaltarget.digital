// ============================================================================
// ORDER TRACKING DIALOG — the customer's tracking view, inside the software.
//
// Opens from the Delivery Board (and anywhere else a delivery order is listed). It draws the same
// OrderTrackingPanel as the customer's #/track page, from the same order, so the restaurant sees exactly what
// the customer sees — in the browser and in the Windows app alike.
//
// It follows the order live: the store tells it when orders change (rider moves, status steps), and while the
// dialog is open it also asks the cloud for a refresh every 15 s, so a position that arrived while this device was
// busy still shows up.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Bike } from 'lucide-react';
import OrderTrackingPanel from '@/components/OrderTrackingPanel';
import { getOrders, getSettings, onDataChange, refreshOrdersFromCloud } from '@/lib/store';
import { trackingView } from '@/lib/trackingSteps';
import { startVisiblePoll } from '@/lib/visiblePoll';
import { money } from '@/lib/currency';

interface Props {
  /** The order to follow; null keeps the dialog closed. */
  orderId: string | null;
  onClose: () => void;
}

const REFRESH_MS = 20_000;

export default function OrderTrackingDialog({ orderId, onClose }: Props) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    const off = onDataChange(col => { if (col === 'orders' || col === '*') setTick(t => t + 1); });
    return off;
  }, [orderId]);

  const order = useMemo(() => (orderId ? getOrders().find(o => o.id === orderId) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderId, tick]);
  const finished = !!order && trackingView(order).finished;

  useEffect(() => {
    if (!orderId || finished) return;
    // Egress: only while this window is on screen (a hidden tab asks for nothing), and the store's own listener already
    // delivers changes made on this device — this is just the floor for ones made elsewhere.
    return startVisiblePoll(() => { void refreshOrdersFromCloud().then(() => setTick(x => x + 1)).catch(() => {}); }, REFRESH_MS);
  }, [orderId, finished]);

  const s = getSettings();
  const branch = s?.restaurantLat != null && s?.restaurantLng != null ? { lat: s.restaurantLat, lng: s.restaurantLng } : null;

  return (
    <Dialog open={!!orderId} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" data-testid="order-tracking-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bike className="h-5 w-5 text-primary" />
            {order ? `Order #${order.orderNumber} — tracking` : 'Tracking'}
          </DialogTitle>
          <DialogDescription>
            {order
              ? <>This is what the customer sees. {order.customer?.name ? `${order.customer.name} · ` : ''}{money(order.grandTotal)}</>
              : 'This order is no longer on this device.'}
          </DialogDescription>
        </DialogHeader>
        {order && <OrderTrackingPanel order={order} branch={branch} mapHeight={260} />}
      </DialogContent>
    </Dialog>
  );
}
