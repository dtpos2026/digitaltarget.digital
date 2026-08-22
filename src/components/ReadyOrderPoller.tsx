// Cross-device "order ready" detector.
// Polls local orders cache every 5s. Jab koi order kitchenStatus='ready' hota hai
// (KDS / Kitchen ne doosri device se mark kiya) to notifyReady() dispatch karta hai.
// ReadyNotificationBus is event ko sun ke beep + toast dikhata hai.
//
// Use type filter to limit which order types this poller cares about:
//   <ReadyOrderPoller types={['dine-in']} />            // Order Taker
//   <ReadyOrderPoller types={['takeaway']} />           // Pickup screen
//   <ReadyOrderPoller types={['delivery']} />           // Rider app
import { useEffect } from 'react';
import { getOrders } from '@/lib/store';
import { notifyReady, wasReadyNotified, markReadyNotified } from '@/lib/readyNotify';

type OrderType = 'dine-in' | 'takeaway' | 'delivery';

export default function ReadyOrderPoller({
  types,
  intervalMs = 5000,
}: { types: OrderType[]; intervalMs?: number }) {
  useEffect(() => {
    // On mount: silently mark already-ready orders as seen (no spam beep on login).
    try {
      getOrders()
        .filter(o => o.kitchenStatus === 'ready')
        .forEach(o => markReadyNotified(o.id));
    } catch {}

    const tick = () => {
      try {
        for (const o of getOrders()) {
          if (o.kitchenStatus !== 'ready') continue;
          if (wasReadyNotified(o.id)) continue;
          const ot = ((o as any).orderType || 'dine-in') as OrderType;
          if (!types.includes(ot)) continue;
          notifyReady(o);
        }
      } catch {}
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [types.join(','), intervalMs]);

  return null;
}
