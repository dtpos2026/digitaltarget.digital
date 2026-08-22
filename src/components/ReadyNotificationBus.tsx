// Listens for `dt-order-ready` events and shows the right notification
// based on the order type:
//   - dine-in   → toast for the waiter/order-taker ("Table X ready")
//   - takeaway  → toast + persistent side panel ("Takeaway #N tayyar")
//   - delivery  → toast for the dispatcher ("Order #N ready for rider")
//
// Plays the same notification beep the new-order notifier uses.
import { useEffect, useState } from 'react';
import { money } from '@/lib/currency';
import { toast } from 'sonner';
import { Package, Bike, Utensils, X, BellRing } from 'lucide-react';
import { onReady, type ReadyEvent } from '@/lib/readyNotify';

function playBeep(strong = false) {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const tones = strong ? [1200, 900, 1200] : [880];
    let t = ctx.currentTime;
    for (const f of tones) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.55);
      t += 0.6;
    }
    // Vibration on mobile/tablet
    try { (navigator as any).vibrate?.([200, 100, 200, 100, 200]); } catch {}
  } catch {}
}


export default function ReadyNotificationBus() {
  const [takeawayQueue, setTakeawayQueue] = useState<ReadyEvent[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    return onReady((ev) => {
      playBeep(ev.orderType === 'dine-in');
      if (ev.orderType === 'delivery') {
        // Delivery → customer name + order #
        const who = ev.customerName?.trim() || 'Walk-in';
        toast.success(
          `🛵 ${who} — Order #${ev.orderNumber} READY — assign a rider for pickup`,
          { duration: 8000, icon: <Bike className="h-4 w-4" /> },
        );
      } else if (ev.orderType === 'takeaway') {
        // Takeaway → just order #
        const who = ev.customerName?.trim();
        toast.success(
          `📦 Takeaway Order #${ev.orderNumber} READY${who ? ' — ' + who : ''}${ev.customerPhone ? ' · ' + ev.customerPhone : ''}`,
          { duration: 10000, icon: <Package className="h-4 w-4" /> },
        );
        setTakeawayQueue((q) => [ev, ...q.filter(x => x.orderId !== ev.orderId)].slice(0, 10));
      } else {
        // Dine-in → friendly table label + order #. Never show raw table id.
        const tbl = ev.table?.trim();
        const looksLikeId = tbl && /^[a-z0-9]{12,}$/i.test(tbl); // safety net
        const tableLabel = tbl && !looksLikeId ? `Table ${tbl}` : `Order #${ev.orderNumber}`;
        toast.success(
          `🍽️ ${tableLabel} — Order #${ev.orderNumber} READY to serve`,
          { duration: 8000, icon: <Utensils className="h-4 w-4" /> },
        );
      }
    });
  }, []);


  const removeTakeaway = (id: string) => setTakeawayQueue(q => q.filter(x => x.orderId !== id));

  // User request: persistent bottom-right pickup panel hide kar diya (pay button par overlap kar raha tha).
  // Toast notifications upar normal chalti rahengi.
  return null;
  // eslint-disable-next-line no-unreachable
  if (takeawayQueue.length === 0) return null;

  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-20 right-4 z-[80] flex items-center gap-1.5 px-3 py-2 rounded-full bg-amber-500 text-white shadow-elegant text-xs font-bold hover:bg-amber-600"
      >
        <BellRing className="h-3.5 w-3.5" /> {takeawayQueue.length} Ready
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[80] w-72 max-w-[calc(100vw-2rem)] space-y-2 pointer-events-auto">
      <div className="flex items-center justify-between rounded-t-md bg-amber-500 text-white px-3 py-1.5 text-[11px] font-bold">
        <span className="flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Ready for Pickup ({takeawayQueue.length})</span>
        <button onClick={() => setPanelOpen(false)} className="hover:bg-white/20 rounded p-0.5"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
        {takeawayQueue.map(ev => (
          <div key={ev.orderId} className="bg-card border border-amber-300 rounded-md p-2 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-sm">#{ev.orderNumber}</div>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => removeTakeaway(ev.orderId)}>
                <X className="h-3 w-3" />
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {ev.customerName || 'Walk-in'}{ev.customerPhone ? ' · ' + ev.customerPhone : ''}
            </div>
            <div className="text-[10px] text-amber-700 mt-0.5">{money(ev.total)} · {new Date(ev.at).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
