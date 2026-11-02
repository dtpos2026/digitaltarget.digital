import { useState, useEffect, useMemo, useRef } from 'react';
import { getOrders, getSettings, getKitchens, getMenuItems, onDataChange, setOrderKitchenStatus } from '@/lib/store';
import { Order, RestaurantSettings, CartItem } from '@/lib/types';
import { warmUpVoices } from '@/lib/speech';
import { ENABLE_REDUNDANT_ORDER_POLL } from '@/lib/featureFlags';
import { scopeToBranch } from '@/lib/cashierScope';
import { Maximize2, Volume2, VolumeX, AlertTriangle, Clock, ChefHat, Bell, Bike, CheckCircle2 } from 'lucide-react';
import {
  loadKitchenDisplay, resolveKitchenTemplate, kitchenColumns, announceKitchenOrder,
  type KitchenDisplayConfig,
} from '@/lib/kitchenDisplay';
import { templateVars, scaledFont, DEVELOPER_CREDIT } from '@/lib/displayTemplates';

function playBeep(urgent = false) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = urgent ? 'square' : 'sine';
    o.frequency.value = urgent ? 880 : 660;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (urgent ? 0.8 : 0.35));
    o.start();
    o.stop(ctx.currentTime + (urgent ? 0.85 : 0.4));
    if (urgent) {
      setTimeout(() => playBeep(false), 300);
      setTimeout(() => playBeep(false), 600);
    }
  } catch {}
}

function getKitchenFromUrl(): string {
  try {
    const hash = window.location.hash || '';
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return 'all';
    const qs = new URLSearchParams(hash.slice(qIdx + 1));
    return qs.get('kitchen') || 'all';
  } catch { return 'all'; }
}

/**
 * The screen's own dimensions, kept current.
 *
 * The board is opened full-screen on whichever monitor the shop chose, and
 * that can be anything from a 4K TV to a 1024x768 panel. Automatic template
 * mode and the column count both need the real numbers.
 */
function useViewport() {
  const [size, setSize] = useState(() => ({
    w: typeof window === 'undefined' ? 1920 : window.innerWidth,
    h: typeof window === 'undefined' ? 1080 : window.innerHeight,
  }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

export default function KdsTvPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [recent, setRecent] = useState<Order[]>([]);
  // Orders that appeared on this screen within the last few seconds. They get
  // a NEW flag and an entry animation so a cook glancing up mid-task sees at
  // once that something arrived, rather than having to re-scan the board.
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0);
  const [settings, setSettings] = useState<RestaurantSettings>(() => getSettings());
  const kitchens = useMemo(() => getKitchens(), []);
  const menuItems = useMemo(() => getMenuItems(), []);
  const itemKitchen = useMemo(() => {
    const m = new Map<string, string | undefined>();
    menuItems.forEach(mi => m.set(mi.id, mi.kitchenId));
    return m;
  }, [menuItems]);

  const activeKitchen = useMemo(() => getKitchenFromUrl(), []);
  const [display, setDisplay] = useState<KitchenDisplayConfig>(() => loadKitchenDisplay());
  const [soundOn, setSoundOn] = useState(() => loadKitchenDisplay().sound);
  // Read inside the refresh loop, which does not re-subscribe on every change.
  const displayRef = useRef(display);
  displayRef.current = display;
  useEffect(() => { if (display.announce) warmUpVoices(); }, [display.announce]);
  const { w: vw, h: vh } = useViewport();
  const template = useMemo(
    () => resolveKitchenTemplate(display, vw, vh),
    [display.templateId, display.templateMode, vw, vh], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const columns = kitchenColumns(display, vw, template.density);
  const known = useRef<Set<string>>(new Set());
  const first = useRef(true);

  const kitchenName = useMemo(() => {
    if (activeKitchen === 'all') return 'ALL KITCHENS';
    if (activeKitchen === '__none__') return 'UNASSIGNED';
    return kitchens.find(k => k.id === activeKitchen)?.name?.toUpperCase() || 'KITCHEN';
  }, [activeKitchen, kitchens]);

  useEffect(() => {
    const refresh = () => {
      setSettings(getSettings());
      // v1.93.0 — a branch's board shows that branch's orders only (cashierScope), as it did before the templates.
      const scoped = scopeToBranch(getOrders());
      const all = scoped.filter(o => {
        if (o.status === 'void' || o.status === 'cancelled') return false;
        const ds = (o as any).deliveryStatus;
        if (ds === 'rider_picked' || ds === 'onway' || ds === 'rider_reached' || ds === 'delivered') return false;
        if (o.kitchenStatus === 'served' || o.kitchenStatus === 'delivered') return false;
        if (o.status === 'paid') return false;
        if (o.status === 'running' || o.status === 'hold' || o.status === 'partial') return true;
        return false;
      });
      const sorted = all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // ===== RECENTLY FINISHED =====
      // The kitchen needs a short memory, not a history. A cook who has just
      // marked an order ready wants to see it leave the active board AND
      // confirm it went, and a cancellation has to be noticed within seconds
      // or food keeps being made. Anything older than this window is no
      // longer news and would only crowd the screen.
      const RECENT_MS = 10 * 60 * 1000;
      const since = Date.now() - RECENT_MS;
      const stamp = (o: any) => new Date(o.updatedAt || o.paidAt || o.createdAt || 0).getTime();
      const finished = scoped
        .filter(o => stamp(o) >= since)
        .filter(o => {
          const cancelled = o.status === 'void' || o.status === 'cancelled';
          const done = o.kitchenStatus === 'served' || o.kitchenStatus === 'delivered'
            || o.kitchenStatus === 'ready' || o.status === 'paid';
          return cancelled || done;
        })
        .sort((a, b) => stamp(b) - stamp(a))
        .slice(0, 8);
      setRecent(finished);
      if (soundOn && !first.current) {
        const fresh = sorted.filter(o => !known.current.has(o.id));
        if (fresh.length > 0) {
          const urgent = fresh.some(o => {
            const m = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000);
            return m >= (getSettings().kitchenWarningMinutes || 10);
          });
          playBeep(urgent);
          // Then the number, when the kitchen asked for a voice. After the
          // beep, never instead of it; a missing voice is silent, not fatal.
          const d = displayRef.current;
          if (d.announce) {
            window.setTimeout(() => {
              for (const o of fresh) void announceKitchenOrder(o.orderNumber ?? '', d).catch(() => undefined);
            }, 700);
          }
        }
      }
      if (!first.current) {
        const arrived = sorted.filter(o => !known.current.has(o.id)).map(o => o.id);
        if (arrived.length) {
          setFreshIds(prev => new Set([...prev, ...arrived]));
          // The NEW flag is a nudge, not a state: it clears itself so the
          // board does not slowly fill with things that are no longer new.
          window.setTimeout(() => {
            setFreshIds(prev => {
              const next = new Set(prev);
              for (const id of arrived) next.delete(id);
              return next;
            });
          }, 20000);
        }
      }
      known.current = new Set(sorted.map(o => o.id));
      first.current = false;
      setOrders(sorted);
    };
    refresh();
    const unsub = onDataChange((col) => {
      if (col === 'orders' || col === 'settings') refresh();
    });
    // The 10 s poll is behind the egress flag (default off): onDataChange is the primary path on Supabase.
    const interval: ReturnType<typeof setInterval> | null = ENABLE_REDUNDANT_ORDER_POLL ? setInterval(refresh, 10000) : null;
    return () => { unsub(); if (interval) clearInterval(interval); };
  }, [soundOn]);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 20000);
    return () => clearInterval(t);
  }, []);

  // The board is usually a second window; a settings change in the POS window
  // has to reach it without the shop restarting the display.
  useEffect(() => {
    const onCfg = () => {
      const next = loadKitchenDisplay();
      setDisplay(next);
      setSoundOn(next.sound);
    };
    window.addEventListener('dtpos-kitchen-display-changed', onCfg);
    return () => window.removeEventListener('dtpos-kitchen-display-changed', onCfg);
  }, []);

  // Auto-fullscreen on user gesture (browsers block auto)
  const goFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const filterItems = (items: CartItem[]): CartItem[] => {
    if (activeKitchen === 'all') return items;
    if (activeKitchen === '__none__') return items.filter(i => !itemKitchen.get(i.menuItemId));
    return items.filter(i => itemKitchen.get(i.menuItemId) === activeKitchen);
  };

  const visible = orders
    .map(o => ({ order: o, items: filterItems(o.items) }))
    .filter(x => x.items.length > 0);

  const warn = settings.kitchenWarningMinutes || 10;
  const prep = settings.kitchenPreparingMinutes || 5;
  const laneLayout = (template.layout || 'grid') === 'status-lanes';

  // ===== STATUS LANES =====
  // A lane per stage, which is the layout on the mockups. A cook reads their
  // own lane instead of scanning the whole wall for the tickets that are
  // theirs, and an order visibly travels left to right as it is worked.
  //
  // COMPLETED is fed from the same short "recently finished" memory the strip
  // uses, so the board does not slowly fill with work that is done.
  const lanes = useMemo(() => {
    const stage = (o: Order) => {
      const ks = o.kitchenStatus || 'pending';
      const ds = (o as any).deliveryStatus;
      if (ds && ds !== 'pending' && ds !== 'accepted') return 'delivery';
      if (ks === 'ready') return 'ready';
      if (ks === 'preparing') return 'preparing';
      if (ks === 'accepted') return 'preparing';
      return 'new';
    };
    const by: Record<string, Array<{ order: Order; items: CartItem[] }>> = {
      new: [], preparing: [], ready: [], delivery: [], completed: [],
    };
    for (const row of visible) by[stage(row.order)].push(row);
    by.completed = recent.map(o => ({ order: o, items: filterItems(o.items || []) }));
    return by;
  }, [visible, recent]); // eslint-disable-line react-hooks/exhaustive-deps

  // The status palette is shared and fixed (see displayTemplates.ts): a cook
  // learns "red means nobody has started it" in their first shift and then
  // reads the board by colour alone from across the kitchen.
  const LANES: Array<{ id: keyof typeof lanes; label: string; colour: string; Icon: typeof ChefHat }> = [
    { id: 'new', label: 'NEW', colour: 'var(--dt-status-new)', Icon: Bell },
    { id: 'preparing', label: 'PREPARING', colour: 'var(--dt-status-preparing)', Icon: ChefHat },
    { id: 'ready', label: 'READY', colour: 'var(--dt-status-ready)', Icon: CheckCircle2 },
    { id: 'delivery', label: 'DELIVERY', colour: 'var(--dt-status-delivery)', Icon: Bike },
    { id: 'completed', label: 'COMPLETED', colour: 'var(--dt-status-completed)', Icon: CheckCircle2 },
  ];

  const advance = (orderId: string, current: string | undefined) => {
    const next = current === 'pending' || !current ? 'accepted'
      : current === 'accepted' ? 'preparing'
      : current === 'preparing' ? 'ready'
      : current === 'ready' ? 'delivered'
      : 'delivered';
    setOrderKitchenStatus(orderId, next as any);
    setTick(n => n + 1);
  };

  const labelFor = (s: string | undefined) => {
    if (!s || s === 'pending') return 'TAP TO ACCEPT';
    if (s === 'accepted') return 'TAP TO START';
    if (s === 'preparing') return 'TAP WHEN READY';
    if (s === 'ready') return 'TAP TO DELIVER';
    return s.toUpperCase();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-auto"
      style={{
        ...templateVars(template),
        background: 'var(--dt-bg)',
        color: 'var(--dt-text)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Animations are scoped to this screen and deliberately restrained:
          a kitchen display is watched for hours, so anything that moves
          constantly becomes noise the staff learn to ignore. A card animates
          once as it arrives, the NEW flag pulses while it is genuinely new,
          and a late order breathes — nothing else. `prefers-reduced-motion`
          is honoured because some people cannot work under movement. */}
      <style>{`
        @keyframes kdsIn {
          from { opacity: 0; transform: translateY(14px) scale(0.98); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes kdsNew {
          0%, 100% { box-shadow: 0 0 0 0 var(--dt-preparing); }
          50%      { box-shadow: 0 0 0 10px transparent; }
        }
        @keyframes kdsLate {
          0%, 100% { border-color: var(--dt-alert); opacity: 1; }
          50%      { border-color: var(--dt-alert); opacity: .72; }
        }
        .kds-card { animation: kdsIn .28s cubic-bezier(.2,.7,.3,1) both; }
        .kds-new  { animation: kdsIn .28s cubic-bezier(.2,.7,.3,1) both, kdsNew 1.6s ease-out 3; }
        .kds-late { animation: kdsLate 1.4s ease-in-out infinite; }
        .kds-strip-item { animation: kdsIn .22s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .kds-card, .kds-new, .kds-late, .kds-strip-item { animation: none !important; }
        }
      `}</style>
      {/* Header */}
      {/* ===== HEADER — the RESTAURANT's board =====
          Its logo and its name are the largest things here. Digital Target
          built the software and appears once, small, underneath. */}
      <div
        className="sticky top-0 z-10 border-b px-6 py-3 flex items-center gap-4"
        style={{ background: 'var(--dt-accent)', color: 'var(--dt-on-accent)', borderColor: 'var(--dt-border)' }}
      >
        {settings.logo && <img src={settings.logo} alt="" className="h-10 w-10 object-contain rounded shrink-0" />}
        <div className="min-w-0">
          <div className="font-black uppercase tracking-wide truncate"
               style={{ fontSize: scaledFont(1.25, template.typeScale, 0.6) }}>
            {settings.name || 'Restaurant'}
          </div>
          {display.showDeveloperCredit && (
            <div className="uppercase tracking-widest opacity-50" style={{ fontSize: '10px' }}>
              {DEVELOPER_CREDIT}
            </div>
          )}
        </div>
        <div className="ml-4 hidden lg:flex items-center gap-2 opacity-80 shrink-0"
             style={{ fontSize: scaledFont(0.9, template.typeScale, 0.3) }}>
          <ChefHat className="h-4 w-4" /> Kitchen Display System
        </div>
        <div
          className="ml-4 px-4 py-1.5 rounded-md border font-black uppercase tracking-wider shrink-0"
          style={{
            borderColor: 'currentColor',
            fontSize: scaledFont(0.875, template.typeScale, 0.3),
          }}
        >
          {kitchenName}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* Time AND date: a board that runs for days needs to say which day
              it is showing, or a stale window looks like a live one. */}
          <div className="text-right leading-tight">
            <div className="font-black tabular-nums" style={{ fontSize: scaledFont(1.5, template.typeScale, 0.7) }}>
              {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="opacity-70 tabular-nums" style={{ fontSize: scaledFont(0.7, template.typeScale, 0.2) }}>
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          </div>
          <button onClick={() => setSoundOn(s => !s)} className="p-2 rounded-md"
                  style={{ background: 'rgba(127,127,127,0.25)' }}>
            {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5 opacity-50" />}
          </button>
          <button onClick={goFullscreen} className="p-2 rounded-md" style={{ background: 'rgba(127,127,127,0.25)' }}>
            <Maximize2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="px-6 py-2 grid grid-cols-4 gap-3 border-b"
           style={{ background: 'var(--dt-surface)', borderColor: 'var(--dt-border)' }}>
        {[
          { label: 'ACTIVE', value: visible.length, color: 'var(--dt-text)' },
          { label: 'PENDING', value: visible.filter(v => !v.order.kitchenStatus || v.order.kitchenStatus === 'pending').length, color: 'var(--dt-preparing)' },
          { label: 'COOKING', value: visible.filter(v => v.order.kitchenStatus === 'preparing').length, color: 'var(--dt-preparing)' },
          { label: 'DELAYED', value: visible.filter(v => Math.floor((Date.now() - new Date(v.order.createdAt).getTime()) / 60000) >= warn).length, color: 'var(--dt-alert)' },
        ].map(s => (
          <div key={s.label} className="text-center">
            <div className="text-[10px] font-bold tracking-widest opacity-60">{s.label}</div>
            <div className="font-black tabular-nums"
                 style={{ color: s.color, fontSize: scaledFont(1.875, template.typeScale, 0.9) }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ===== THE BOARD =====
          Two shapes, one ticket. `status-lanes` is the layout on the mockups:
          a lane per stage, so a cook reads their own lane rather than
          scanning the whole wall, and an order visibly travels left to right
          as it is worked. `grid` is the older wall, kept because a small
          kitchen with four tickets on screen does not need five lanes.

          Lanes wrap on their own: five fit across a wide TV, and on a
          narrower screen they fall into two rows — which is the second
          mockup, reached without a second layout. */}
      {laneLayout ? (
        <div
          className="p-4 grid gap-3 items-start"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))' }}
        >
          {LANES.map(({ id, label, colour, Icon }) => {
            const rows = lanes[id] || [];
            const done = id === 'completed';
            return (
              <section key={id} className="min-w-0 flex flex-col gap-2">
                <div
                  className="flex items-center gap-2 px-3 py-2.5 font-black tracking-widest"
                  style={{
                    borderRadius: 'var(--dt-radius)',
                    background: colour,
                    color: '#FFFFFF',
                    fontSize: scaledFont(0.85, template.typeScale, 0.26),
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                  <span className="ml-auto tabular-nums">{rows.length}</span>
                </div>
                {rows.map(({ order, items }) => (
                  <KitchenTicket
                    key={order.id}
                    order={order}
                    items={items}
                    warn={warn}
                    prep={prep}
                    isNew={freshIds.has(order.id)}
                    template={template}
                    onAdvance={advance}
                    labelFor={labelFor}
                    muted={done}
                    statusColour={colour}
                  />
                ))}
                {rows.length === 0 && (
                  <div
                    className="text-center py-6 opacity-25 border border-dashed"
                    style={{ borderRadius: 'var(--dt-radius)', borderColor: 'var(--dt-border)',
                             fontSize: scaledFont(0.75, template.typeScale, 0.2) }}
                  >
                    Empty
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        /* Ticket columns come from the screen's real width, not from
           breakpoints: a 1366-wide monitor and a 3840-wide TV are both "xl"
           to Tailwind and are not remotely the same board. */
        <div
          className="p-4 grid gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {visible.map(({ order, items }) => (
            <KitchenTicket
              key={order.id}
              order={order}
              items={items}
              warn={warn}
              prep={prep}
              isNew={freshIds.has(order.id)}
              template={template}
              onAdvance={advance}
              labelFor={labelFor}
            />
          ))}
          {visible.length === 0 && (
            <div className="col-span-full text-center py-32 opacity-40">
              <ChefHat className="h-20 w-20 mx-auto mb-4" />
              <div className="font-black" style={{ fontSize: scaledFont(1.5, template.typeScale, 0.7) }}>
                NO ACTIVE ORDERS
              </div>
              <div className="mt-2" style={{ fontSize: scaledFont(0.875, template.typeScale, 0.3) }}>
                Waiting for new orders…
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== RECENTLY FINISHED =====
          A short memory, pinned to the bottom so it never competes with the
          active board. Completed orders confirm to a cook that what they
          marked ready actually left; a CANCELLED entry is the one thing on
          this screen that must be noticed within seconds, because food is
          still being made until someone sees it. Hence the red treatment and
          the strike-through on the number. */}
      {/* The shop's own bar along the bottom, as the compact design draws it. */}
      {laneLayout && (
        <div
          className="sticky bottom-0 flex items-center gap-3 px-6 py-2"
          style={{ background: 'var(--dt-accent)', color: 'var(--dt-on-accent)' }}
        >
          {settings.logo && <img src={settings.logo} alt="" className="h-6 w-6 object-contain rounded shrink-0" />}
          <span className="font-black uppercase tracking-wide truncate"
                style={{ fontSize: scaledFont(0.8, template.typeScale, 0.24) }}>
            {settings.name || 'Restaurant'}
          </span>
          {display.showDeveloperCredit && (
            <span className="ml-auto opacity-55 truncate" style={{ fontSize: '10px' }}>
              {DEVELOPER_CREDIT}
            </span>
          )}
        </div>
      )}

      {!laneLayout && recent.length > 0 && (
        <div className="sticky bottom-0 backdrop-blur border-t px-4 py-2"
             style={{ background: 'var(--dt-surface)', borderColor: 'var(--dt-border)' }}>
          <div className="flex items-center gap-3 overflow-x-auto">
            <span className="text-[10px] font-black tracking-widest opacity-50 shrink-0">
              RECENTLY FINISHED
            </span>
            {recent.map(o => {
              const cancelled = o.status === 'void' || o.status === 'cancelled';
              const clr = cancelled ? 'var(--dt-alert)' : 'var(--dt-ready)';
              return (
                <div
                  key={o.id}
                  className="kds-strip-item shrink-0 border px-3 py-1.5 flex items-center gap-2"
                  style={{ borderRadius: 'var(--dt-radius)', borderColor: clr }}
                >
                  <span className={`font-black tabular-nums ${cancelled ? 'line-through' : ''}`}
                        style={{ color: clr, fontSize: scaledFont(1.125, template.numberScale, 0.5) }}>
                    #{o.orderNumber}
                  </span>
                  <span className="text-[10px] font-black tracking-wider" style={{ color: clr }}>
                    {cancelled ? 'CANCELLED' : 'DONE'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One kitchen ticket, as the printed designs draw it.
 *
 * A light card with dark text, because a cook reads a ticket the way they
 * read a docket — and the colour that matters is the one framing it, which
 * says at a glance which stage the order is at.
 *
 * Extracted so the wall grid and the status lanes render the SAME ticket.
 * Two copies of this markup is how one layout ends up showing a quantity or
 * a note that the other does not.
 */
function KitchenTicket({
  order, items, warn, prep, isNew, template, onAdvance, labelFor, muted, statusColour,
}: {
  order: Order;
  items: CartItem[];
  warn: number;
  prep: number;
  isNew: boolean;
  template: { typeScale: number; numberScale: number };
  onAdvance: (id: string, current: string | undefined) => void;
  labelFor: (s: string | undefined) => string;
  /** Completed tickets are history: shown, but not actionable. */
  muted?: boolean;
  /** The lane's colour, when this ticket sits in one. */
  statusColour?: string;
}) {
  const mins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
  const isDelayed = mins >= warn;
  const isWarn = mins >= prep && mins < warn;
  const ks = order.kitchenStatus || 'pending';
  const customerName = (order as any).customerName || order.customer?.name || (order as any).creditCustomerName;
  const where = order.tableName || order.tableLabel || String(order.orderType || '').replace(/_/g, ' ');

  // In a lane the frame is the lane's colour; on the wall it carries the
  // ticket's own state, because there is no lane header to say it.
  const frame = statusColour
    || (isDelayed ? 'var(--dt-status-new)'
      : isWarn ? 'var(--dt-status-preparing)'
      : ks === 'ready' ? 'var(--dt-status-ready)'
      : ks === 'preparing' ? 'var(--dt-status-preparing)'
      : 'var(--dt-panel-border)');
  const timeClr = isDelayed ? 'var(--dt-status-new)'
    : isWarn ? 'var(--dt-status-preparing)'
    : 'var(--dt-status-ready)';
  const actionClr = ks === 'pending' ? 'var(--dt-accent)'
    : ks === 'accepted' ? 'var(--dt-status-preparing)'
    : ks === 'preparing' ? 'var(--dt-status-ready)'
    : 'var(--dt-status-completed)';

  return (
    <div
      className={`border-2 p-3 flex flex-col ${isNew ? 'kds-new' : 'kds-card'} ${isDelayed ? 'kds-late' : ''}`}
      style={{
        borderRadius: 'var(--dt-radius)',
        background: 'var(--dt-panel)',
        color: 'var(--dt-on-panel)',
        borderColor: frame,
        opacity: muted ? 0.75 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="font-black tabular-nums leading-none"
                 style={{ fontSize: scaledFont(1.75, template.numberScale, 0.9) }}>
              #{order.orderNumber}
            </div>
            {isNew && (
              <span className="text-[10px] font-black tracking-widest rounded px-1.5 py-0.5 shrink-0"
                    style={{ background: 'var(--dt-status-new)', color: '#fff' }}>
                NEW
              </span>
            )}
          </div>
          <div className="truncate font-semibold mt-0.5"
               style={{ fontSize: scaledFont(0.9, template.typeScale, 0.3) }}>
            {where}
            {customerName ? ` · ${customerName}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1 font-black tabular-nums shrink-0"
             style={{ color: timeClr, fontSize: scaledFont(0.85, template.typeScale, 0.25) }}>
          {isDelayed ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
          {mins} min
        </div>
      </div>

      {/* Item lines read "quantity, then what it is" — the order a cook works
          in, and the order the designs print them in. */}
      <div className="space-y-0.5 flex-1">
        {items.map(it => (
          <div key={it.id} className="flex items-baseline gap-2">
            <span className="font-black tabular-nums shrink-0 text-right"
                  style={{ minWidth: '1.4em', color: 'var(--dt-accent)', fontSize: scaledFont(0.95, template.typeScale, 0.32) }}>
              {it.quantity}
            </span>
            <span className="min-w-0">
              <span className="block truncate" style={{ fontSize: scaledFont(0.95, template.typeScale, 0.32) }}>
                {it.name}
              </span>
              {it.note && (
                <span className="block truncate italic"
                      style={{ color: 'var(--dt-status-preparing)', fontSize: scaledFont(0.78, template.typeScale, 0.22) }}>
                  {it.note}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {order.notes && (
        <div className="mt-1.5 italic truncate"
             style={{ color: 'var(--dt-status-preparing)', fontSize: scaledFont(0.78, template.typeScale, 0.22) }}>
          {order.notes}
        </div>
      )}

      {!muted && (
        <button
          onClick={() => onAdvance(order.id, ks)}
          className="mt-2.5 w-full py-2 font-black tracking-wide transition hover:opacity-85"
          style={{
            borderRadius: 'calc(var(--dt-radius) * 0.7)',
            background: actionClr,
            color: '#FFFFFF',
            fontSize: scaledFont(0.8, template.typeScale, 0.24),
          }}
        >
          {labelFor(ks)}
        </button>
      )}
    </div>
  );
}
