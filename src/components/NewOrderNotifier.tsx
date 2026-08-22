import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/currency';
import { useNavigate } from '@/lib/hash-router';
import { getOrders, getSettings, refreshOrdersFromCloud, onDataChange } from '@/lib/store';
import type { Order } from '@/lib/types';
import { enqueueKot } from '@/lib/printQueue';
import { shouldAutoApprove, holdForApproval, rejectOrder } from '@/lib/onlineApproval';
import { isCustomerBlocked, findBlockingLocation } from '@/lib/blocklist';
import { Bell, X, Truck, Globe, QrCode, ClipboardList } from 'lucide-react';

const isElectronEnv = typeof window !== 'undefined' && !!(window as any).electronAPI;
const DBG = (...a: any[]) => {
  try { console.log('%c[DT-NewOrder]', 'color:#0d9488;font-weight:700', ...a); } catch {}
};

const SEEN_KEY = 'pos-seen-online-orders';
const MUTE_KEY = 'pos-mute-online-orders';

// Sources that should raise a cashier notification (remote / non-cashier origin)
const NOTIFY_SOURCES = ['website', 'qr', 'order_taker'] as const;
type NotifySource = (typeof NOTIFY_SOURCES)[number];

function sourceMeta(source?: string): { label: string; Icon: typeof Globe; color: string } {
  if (source === 'order_taker') return { label: 'Order Taker / Waiter', Icon: ClipboardList, color: 'text-status-warning' };
  if (source === 'qr') return { label: 'QR Table Order', Icon: QrCode, color: 'text-status-info' };
  return { label: 'Website Order', Icon: Globe, color: 'text-status-success' };
}

function getSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveSeen(s: Set<string>) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(s).slice(-200)));
}

function playBeep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beepOnce = (freq: number, when: number, dur = 0.18) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime + when);
      g.gain.linearRampToValueAtTime(0.35, ctx.currentTime + when + 0.02);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + when + dur);
      o.start(ctx.currentTime + when);
      o.stop(ctx.currentTime + when + dur + 0.02);
    };
    beepOnce(880, 0);
    beepOnce(1320, 0.22);
    beepOnce(880, 0.44);
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}

/** Decide if a fresh order should auto-print a KOT on THIS (cashier) device. */
function shouldAutoKot(o: Order): boolean {
  const s = getSettings();
  if (s.kotEnabled === false) return false;
  if (s.manualSendToKitchen) return false; // cashier will press "Send to Kitchen"
  if (o.source === 'order_taker') return s.autoKotOnOrderTakerSave !== false;
  // website / qr
  return s.autoKotOnOnlineOrder !== false;
}

export default function NewOrderNotifier() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Order[]>([]);
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem(MUTE_KEY) === '1');
  const initRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    DBG('mounted', { isElectron: isElectronEnv });

    const check = async (reason: string) => {
      // Pull latest orders from Firestore so remote orders surface here
      try {
        await refreshOrdersFromCloud();
      } catch (e) {
        DBG('refreshOrdersFromCloud FAILED', reason, e);
      }
      if (cancelled) return;
      const all = getOrders();
      const seen = getSeen();
      const remote = all.filter(o => NOTIFY_SOURCES.includes((o.source || '') as NotifySource));

      // First run: mark everything as seen, don't alert.
      if (!initRef.current) {
        remote.forEach(o => seen.add(o.id));
        saveSeen(seen);
        initRef.current = true;
        DBG('init', { remoteCount: remote.length });
        return;
      }

      const fresh = remote.filter(o => !seen.has(o.id));
      if (fresh.length) {
        DBG('NEW ORDERS', reason, fresh.map(o => ({ id: o.id, no: o.orderNumber, src: o.source, type: o.orderType })));
        fresh.forEach(o => seen.add(o.id));
        saveSeen(seen);
        setPending(p => [...fresh, ...p].slice(0, 5));
        if (!muted) playBeep();
        // Feed bell dropdown
        fresh.forEach(o => {
          try {
            window.dispatchEvent(new CustomEvent('dt-new-order', {
              detail: {
                orderId: o.id,
                orderNumber: o.orderNumber,
                orderType: (o.orderType as any) || 'dine-in',
                customerName: o.customer?.name,
                customerPhone: o.customer?.phone,
                table: (o as any).tableName,
                total: o.grandTotal || 0,
                source: o.source,
                at: new Date().toISOString(),
              },
            }));
          } catch {}
        });
        // ===== Blocklist gate (highest priority) =====
        const blocklistHeld: Set<string> = new Set();
        fresh.forEach(o => {
          if (o.status === 'pending_approval' || o.status === 'rejected') return;
          // Blocked customer → auto reject + admin alert
          const phone = o.customer?.phone || '';
          const bc = phone ? isCustomerBlocked(phone) : null;
          if (bc) {
            try {
              rejectOrder(o.id, `Blocked customer: ${bc.reason}`, { userId: 'system', userName: 'System (Blocklist)' });
              try { console.warn('%c[DT-Blocklist]', 'color:#dc2626;font-weight:700', 'Blocked customer attempted order', { phone, no: o.orderNumber }); } catch {}
              try { (window as any).sonner?.toast?.error?.(`Blocked customer ${bc.name} tried to order`); } catch {}
            } catch {}
            blocklistHeld.add(o.id);
            return;
          }
          // Blocked location → reject or send to review per setting
          const addr = o.customer?.address || (o as any).delivery?.customerCity || '';
          const lat = (o as any).delivery?.customerLat as number | undefined;
          const lng = (o as any).delivery?.customerLng as number | undefined;
          const bl = findBlockingLocation({ address: addr, lat, lng });
          if (bl) {
            if (bl.action === 'reject') {
              try { rejectOrder(o.id, `Blocked location (${bl.areaName}): ${bl.reason}`, { userId: 'system', userName: 'System (Blocklist)' }); } catch {}
            } else {
              try { holdForApproval(o, `Blocked location ${bl.areaName} — needs review`); } catch {}
            }
            blocklistHeld.add(o.id);
          }
        });

        // Approval gate — manual mode holds order, blocks KOT.
        fresh.forEach(o => {
          if (blocklistHeld.has(o.id)) return;
          if (o.status === 'pending_approval' || o.status === 'rejected') return;
          if (!shouldAutoApprove(o)) {
            try { holdForApproval(o); DBG('held for approval', { no: o.orderNumber, src: o.source }); } catch (e) { DBG('hold failed', e); }
          }
        });
        // Auto-KOT print on the cashier/kitchen device (which owns the printer)
        fresh.forEach(o => {
          if (blocklistHeld.has(o.id)) return;
          const should = shouldAutoKot(o) && shouldAutoApprove(o);
          DBG('auto-KOT decision', { no: o.orderNumber, should });
          if (should) {
            try {
              const job = enqueueKot(o);
              DBG('KOT enqueued', { no: o.orderNumber, jobId: (job as any)?.id });
            } catch (e) {
              DBG('enqueueKot FAILED', e);
            }
          }
        });
      }
    };

    // Instant: Firestore onSnapshot → store emits 'orders' data-change → react now.
    const offData = onDataChange((col) => {
      if (col === 'orders' || col === '*') {
        DBG('data-change event:', col);
        void check('data-change');
      }
    });

    void check('initial');
    // Safety polling (works even if realtime listener silently dies in EXE)
    const t = setInterval(() => void check('poll'), 6000);
    return () => { cancelled = true; clearInterval(t); offData(); DBG('unmounted'); };
  }, [muted]);

  const dismiss = (id: string) => setPending(p => p.filter(o => o.id !== id));
  const openOrder = (o: Order) => {
    dismiss(o.id);
    // Delivery / website goes to delivery board, dine-in / waiter to running bills
    if (o.orderType === 'delivery' || o.source === 'website') navigate('/delivery');
    else navigate('/bills');
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  };

  if (!pending.length) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[340px] max-w-[92vw]">
      {pending.map(o => {
        const meta = sourceMeta(o.source);
        return (
          <div
            key={o.id}
            className="bg-card border-2 border-status-success rounded-lg shadow-2xl p-4 animate-in slide-in-from-right"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="bg-status-success/15 p-2 rounded-full">
                  <Bell className="w-4 h-4 text-status-success animate-pulse" />
                </div>
                <div>
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <meta.Icon className={`w-3.5 h-3.5 ${meta.color}`} /> {meta.label}
                  </div>
                  <div className="text-xs text-muted-foreground">#{o.orderNumber}{o.tableName ? ` • ${o.tableName}` : ''}</div>
                </div>
              </div>
              <button onClick={() => dismiss(o.id)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-sm space-y-1 mb-3">
              <div><span className="text-muted-foreground">Customer:</span> <b>{o.customer?.name || o.tableName || '—'}</b></div>
              {o.customer?.phone && <div><span className="text-muted-foreground">Phone:</span> {o.customer.phone}</div>}
              <div><span className="text-muted-foreground">Items:</span> {o.items?.length || 0}</div>
              <div><span className="text-muted-foreground">Total:</span> <b>{money(o.grandTotal)}</b></div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => openOrder(o)}
                className="flex-1 bg-status-success text-white text-sm font-semibold py-2 rounded flex items-center justify-center gap-1 hover:opacity-90"
              >
                <Truck className="w-4 h-4" /> Open
              </button>
              <button
                onClick={toggleMute}
                className="px-3 text-xs border rounded hover:bg-muted"
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? '🔇' : '🔔'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
