// Mounted once in AppLayout. Every 30s scans active orders. Any order that's
// in "cooking/preparing" and whose cooking time has elapsed past the
// configured prep time → auto-set to ready (kitchenStatus='ready',
// deliveryStatus='ready' for delivery) and fire the ready event bus.
import { useEffect } from 'react';
import { getOrders, getSettings, saveOrder } from '@/lib/store';
import { notifyReady } from '@/lib/readyNotify';
import type { Order } from '@/lib/types';

const TICK_MS = 30_000;

function prepMinutesFor(order: Order, defaultMinutes: number): number {
  if (typeof order.prepTimeMinutes === 'number' && order.prepTimeMinutes > 0) return order.prepTimeMinutes;
  // Per-item override: any item has its own prepTimeMinutes → use max
  let max = 0;
  for (const it of order.items || []) {
    const p = (it as any).prepTimeMinutes;
    if (typeof p === 'number' && p > max) max = p;
  }
  return max > 0 ? max : defaultMinutes;
}

function isStillActiveCooking(order: Order): boolean {
  if (order.status === 'void' || order.status === 'cancelled') return false;
  // already ready / past ready?
  if (order.kitchenStatus === 'ready' || order.kitchenStatus === 'served') return false;
  if (order.deliveryStatus && ['ready', 'rider_assigned', 'rider_picked', 'onway', 'rider_reached', 'delivered', 'cancelled'].includes(order.deliveryStatus)) return false;
  return true;
}

export default function AutoReadyTimer() {
  useEffect(() => {
    const tick = () => {
      try {
        const settings = getSettings();
        if (settings?.autoReadyEnabled === false) return;
        const defMin = Math.max(1, settings?.defaultPrepTimeMinutes || 20);
        const now = Date.now();
        const orders = getOrders();
        for (const o of orders) {
          if (!isStillActiveCooking(o)) continue;
          const prep = prepMinutesFor(o, defMin);
          const startedIso = o.cookingStartedAt || (o as any).createdAt;
          if (!startedIso) continue;
          const started = new Date(startedIso).getTime();
          if (now - started < prep * 60_000) continue;
          // Time's up — mark ready
          const at = new Date().toISOString();
          const next: Order = {
            ...o,
            kitchenStatus: 'ready',
            kitchenStatusAt: at,
            readyAt: at,
            deliveryStatus: o.orderType === 'delivery' ? 'ready' : o.deliveryStatus,
          };
          saveOrder(next);
          notifyReady(next);
        }
      } catch {}
    };
    const t = setInterval(tick, TICK_MS);
    // run once on mount (after 5s grace)
    const first = setTimeout(tick, 5000);
    return () => { clearInterval(t); clearTimeout(first); };
  }, []);
  return null;
}
