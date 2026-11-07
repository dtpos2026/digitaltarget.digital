import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { setLocationConsent, startLocationTracking, stopLocationTracking } from '@/lib/staffLocation';
import { money } from '@/lib/currency';
import { getOrders, saveOrder, getUsers, getRiders, saveRider, getSettings, getBranches, refreshOrdersFromCloud, onDataChange } from '@/lib/store';
import { Order, DeliveryStatus, Rider } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { AlertTriangle, Bike, ChevronRight, LifeBuoy, LogOut, MapPin, Moon, Radio, User as UserIcon, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { normalizePhone, openWhatsApp } from '@/lib/whatsapp';
import { shouldSendPing, appendRoutePoint, type PingPoint } from '@/lib/riderPing';
import { buildTrackingWhatsAppText, setDeliveryStage, DELIVERY_STAGE_LABEL, computeDistance, estimateEta, notifyCustomerStage } from '@/lib/delivery';
import ReadyNotificationBus from '@/components/ReadyNotificationBus';
import ReadyOrderPoller from '@/components/ReadyOrderPoller';
import { portalClaimOrder, portalSetDeliveryStage, hasPortalSession as portalSessionOnThisPhone } from '@/lib/portalData';
import { startVisiblePoll } from '@/lib/visiblePoll';
import PortalRestaurantBadge from '@/components/PortalRestaurantBadge';
import StaffProfileCard from '@/components/StaffProfileCard';
import { useRestaurantIdentity } from '@/hooks/useRestaurantIdentity';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import AppLanguageSwitch from '@/components/AppLanguageSwitch';
import {
  cashToCollect, historyRows, initials, localHistory, nextAction, periodSummary, problemMessage, type DeliveryRecord,
} from '@/lib/riderApp';
import { Banner, RButton, RCard, RLabel, Toggle } from '@/components/rider/riderUi';
import {
  AvailableRow, ClaimSheet, OrderCard, OrdersTab, ReadyAlert, RecordSheet, RecordTab, RefreshButton, TabBar,
  type OrdersSeg, type RiderTab,
} from '@/components/rider/RiderTabs';
import {
  CallSheet, DeliverScreen, DoneScreen, HelpScreen, OrderScreen, PickupScreen, StageSheet,
} from '@/components/rider/RiderDelivery';

// ===== v1.88.0 — the rider screens of the design package (design-project/05-rider-app) =====
//
// The page keeps every piece of logic it had — sign-in, the 15-second poll, the heartbeat, the GPS ration, the
// claim and stage changes that go to the server first — and only what is drawn changed: four tabs (Home, Orders,
// Record, Profile), one screen per delivery with the next step as the one big button, a bag checklist at pickup
// and the money to collect at the door. The screens live in src/components/rider; their rules in lib/riderApp.ts.

/** A screen that covers the tabs: one delivery, its steps, or help. */
type RiderView =
  | { kind: 'order'; id: string }
  | { kind: 'pickup'; id: string }
  | { kind: 'deliver'; id: string }
  | { kind: 'done'; orderNumber: number }
  | { kind: 'help'; id?: string };

const RIDER_THEME_KEY = 'rider-theme';

const RIDER_PORTAL_KEY = 'rider-portal-id';

function isPublicRiderRoute(): boolean {
  return typeof window !== 'undefined' && window.location.hash.startsWith('#/rider-portal');
}

function getCurrentRider(): Rider | null {
  // Public portal: only trust saved rider id from PIN login
  if (isPublicRiderRoute()) {
    const rid = localStorage.getItem(RIDER_PORTAL_KEY) || '';
    if (rid) return getRiders().find(r => r.id === rid) || null;
    return null;
  }
  // Staff route: derive from logged-in user
  const uid = localStorage.getItem('pos-user-id') || '';
  const user = getUsers().find(u => u.id === uid);
  if (!user) return null;
  const riders = getRiders();
  let r = riders.find(rd => (rd.phone || '').replace(/\D/g, '') === ((user as any).phone || '').replace(/\D/g, ''));
  if (!r) r = riders.find(rd => rd.name.toLowerCase() === user.name.toLowerCase());
  if (!r && user.role === 'rider') {
    r = { id: 'rider_' + user.id, name: user.name, phone: (user as any).phone || '', isActive: true };
    saveRider(r);
  }
  return r || null;
}

export default function RiderAppPage() {
  const [rider, setRider] = useState<Rider | null>(() => getCurrentRider());
  const [allRiders] = useState(() => getRiders().filter(r => r.isActive));
  const [orders, setOrders] = useState<Order[]>(() => getOrders());
  const [tick, setTick] = useState(0);
  const [tracking, setTracking] = useState<boolean>(() => localStorage.getItem('rider-tracking') === '1');
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  // Last position written to the database, per order (see riderPing.ts).
  const lastPingRef = useRef<Map<string, PingPoint>>(new Map());

  // Public-portal login state
  const publicMode = isPublicRiderRoute();
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [workspaceCode, setWorkspaceCode] = useState(() => {
    try { return localStorage.getItem('pos-workspace-code') || ''; } catch { return ''; }
  });
  const [loginError, setLoginError] = useState('');

  // v1.88.0 — where the rider is in the app.
  const [tab, setTab] = useState<RiderTab>('home');
  const [seg, setSeg] = useState<OrdersSeg>('mine');
  const [view, setView] = useState<RiderView | null>(null);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [stagesId, setStagesId] = useState<string | null>(null);
  const [record, setRecord] = useState<DeliveryRecord | null>(null);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem(RIDER_THEME_KEY) === 'dark'; } catch { return false; } });
  const identity = useRestaurantIdentity();

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  /**
   * Fetch this rider's orders from the server.
   *
   * A rider has no Supabase session — POS staff are user_profiles rows, not
   * auth.users — so reading `orders` directly goes as `anon`, which the policy
   * refuses. portal_orders resolves this device's token to the rider and
   * returns their own deliveries plus anything still unassigned. (v1.29.0)
   *
   * Throws on failure so the caller can decide whether to say so: the 15-second
   * poll stays quiet, the Refresh button reports.
   */
  const pullFromServer = useCallback(async () => {
    const { hasPortalSession, portalOrders } = await import('@/lib/portalData');
    if (!hasPortalSession()) { await refreshOrdersFromCloud(); return; }

    const res = await portalOrders();
    if (!res.ok) throw new Error(res.message || 'Could not load your orders.');

    const { adoptPortalRows } = await import('@/lib/store');
    await adoptPortalRows({ orders: res.data });
  }, []);

  // ===== v1.49.0 — REPORTED: "Refresh button kaam nahi karta" =====
  //
  // It did nothing of the sort. The button was
  //
  //     onClick={() => setOrders(getOrders())}
  //
  // which re-reads the LOCAL store and never contacts the server, so a rider
  // waiting for a new delivery could press it all day and see the same empty
  // list. The 15-second poll was the only thing that ever fetched, and there
  // was no way to ask for one.
  //
  // The fetch is now a named function both the poll and the button call, with
  // a visible state, so pressing Refresh does what it says and the rider can
  // see that it did.
  const [refreshing, setRefreshing] = useState(false);
  const refreshBusy = useRef(false);

  const pullOrders = useCallback(async (opts?: { announce?: boolean }) => {
    // A second press while the first is still in flight would double every
    // request for no benefit.
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    if (opts?.announce) setRefreshing(true);
    const before = getOrders().length;
    try {
      await pullFromServer();
      setOrders(getOrders());
      setTick(x => x + 1);
      if (opts?.announce) {
        const after = getOrders().length;
        toast.success(after > before
          ? `${after - before} new order${after - before === 1 ? '' : 's'}`
          : 'Up to date');
      }
    } catch (e: any) {
      // Never silent: a refresh that failed must say so, or the rider assumes
      // there is genuinely no work.
      if (opts?.announce) {
        toast.error(e?.message || 'Could not reach the server. Check your signal.');
      }
    } finally {
      refreshBusy.current = false;
      if (opts?.announce) setRefreshing(false);
    }
  }, []);

  // Refresh every 15s — P4 fix: pull from cloud + subscribe to live changes.
  useEffect(() => {
    let cancel = false;
    const pull = async () => {
      try { await pullFromServer(); } catch { /* offline — cached orders stay */ }
      if (!cancel) { setOrders(getOrders()); setTick(x => x + 1); }
    };
    pull();
    const stopPoll = startVisiblePoll(pull, 15000);
    const unsub = onDataChange((col) => {
      if (col === 'orders' && !cancel) { setOrders(getOrders()); setTick(x => x + 1); }
    });
    return () => { cancel = true; stopPoll(); unsub(); };
  }, []);

  // Rider heartbeat: every 60s stamp lastSeenAt so admin sees online/offline.
  // v1.2.4: was 30s = 2,880 Firestore writes/day/rider (and every write fans
  // out to all listening devices). 60s halves it; online threshold raised to 3 min.
  useEffect(() => {
    if (!rider) return;
    const ping = () => {
      try {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

        // ===== v1.49.0 — the toast that would not stop =====
        //
        // REPORTED: "Cloud sync issue — data is saved locally and will retry",
        // over and over, and "1 change could not be uploaded (riders)".
        //
        // This is where it came from. saveRider() queues a cloud write, and a
        // portal app has no Supabase session, so that write can never succeed —
        // and this ran EVERY SIXTY SECONDS. One impossible write per minute,
        // each one queued, each one reported. The error was telling the truth;
        // the mistake was asking.
        //
        // The server already knows the rider is alive: portal_me() stamps
        // last_seen_at on the session row every time it is called. So on a
        // portal device the heartbeat goes there, and nothing is queued.
        void (async () => {
          const { hasPortalSession, portalMe } = await import('@/lib/portalData');
          if (hasPortalSession()) { await portalMe(); return; }
          const fresh = getRiders().find(r => r.id === rider.id);
          if (!fresh) return;
          saveRider({ ...fresh, lastSeenAt: new Date().toISOString() });
        })();
      } catch {}
    };
    ping();
    const onVis = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(ping, 60_000);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [rider?.id]);

  // Ready for pickup (the rider hears "Order #N ready, pickup karo") — RID-06 banner
  useEffect(() => {
    if (!rider) return;
    const seen = new Set<string>();
    const tick = () => {
      const list = getOrders().filter(o =>
        o.orderType === 'delivery' &&
        o.deliveryStatus === 'ready' &&
        (!o.riderId || o.riderId === rider.id) &&
        !seen.has(o.id)
      );
      for (const o of list) seen.add(o.id);
      // v1.88.0 — RID-06: a banner with Claim / Open and Later, instead of a toast that disappears in ten seconds.
      if (list.length) {
        setAlertId(list[list.length - 1].id);
        try { navigator.vibrate?.(200); } catch { /* no vibration on this device */ }
      }
    };
    const t = setInterval(tick, 10000);
    tick();
    return () => clearInterval(t);
  }, [rider?.id]);

  // Rider's own tracking switch is the consent signal for Location History.
  useEffect(() => {
    setLocationConsent(!!tracking && !!rider);
    if (tracking && rider) startLocationTracking(); else stopLocationTracking();
    return () => stopLocationTracking();
  }, [tracking, rider]);

  // Live tracking: watch position, push to assigned orders
  useEffect(() => {
    if (!tracking || !rider) {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      return;
    }
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); setTracking(false); return; }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        // The rider's own screen follows every fix...
        setMyPos({ lat, lng });
        setGpsError(null);
        // ...but the database is written on a ration (see src/lib/riderPing.ts): a phone in a vehicle reports about once
        // a second, and each write re-sends the whole order and rebuilds its item rows.
        const point = { lat, lng, at: Date.now() };
        const active = getOrders().filter(o =>
          o.orderType === 'delivery' &&
          o.riderId === rider.id &&
          o.deliveryStatus &&
          !['delivered', 'cancelled'].includes(o.deliveryStatus)
        );
        let wrote = false;
        for (const o of active) {
          // Per order, so an order claimed a moment ago gets its first position at once.
          if (!shouldSendPing(lastPingRef.current.get(o.id) || null, point)) continue;
          lastPingRef.current.set(o.id, point);
          const delivery = { ...(o.delivery || {}) };
          delivery.riderLat = lat;
          delivery.riderLng = lng;
          delivery.route = appendRoutePoint(delivery.route, point);
          if (delivery.customerLat && delivery.customerLng) {
            delivery.distanceKm = computeDistance({ lat, lng }, { lat: delivery.customerLat, lng: delivery.customerLng });
            delivery.etaMinutes = estimateEta(delivery.distanceKm);
          }
          saveOrder({ ...o, delivery, riderPingedAt: new Date(point.at).toISOString() } as any);
          wrote = true;
        }
        if (wrote) setOrders(getOrders());
      },
      (err) => { console.warn(err); setGpsError(err.message || 'Location unavailable'); toast.error('GPS error: ' + err.message); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    };
  }, [tracking, rider]);

  const toggleTracking = () => {
    const next = !tracking;
    setTracking(next);
    localStorage.setItem('rider-tracking', next ? '1' : '0');
    if (next) toast.success('Live tracking ON'); else toast('Live tracking OFF');
  };

  const myOrders = useMemo(() => {
    if (!rider) return [];
    return orders
      .filter(o => o.orderType === 'delivery' && o.deliveryStatus && o.riderId === rider.id)
      .filter(o => !['delivered', 'cancelled'].includes(o.deliveryStatus!))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, rider, tick]);

  // v1.112.0 — what is still to be taken from customers on the orders in hand
  const cashDue = useMemo(() => cashToCollect(myOrders), [myOrders]);

  const unassigned = useMemo(() =>
    orders.filter(o => o.orderType === 'delivery' && o.deliveryStatus && !o.riderId &&
      ['ready', 'cooking', 'pending', 'accepted'].includes(o.deliveryStatus!))
    , [orders, tick]);

  const completedToday = useMemo(() => {
    if (!rider) return [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return orders.filter(o => o.riderId === rider.id && o.deliveredAt && new Date(o.deliveredAt).getTime() >= start.getTime());
  }, [orders, rider]);

  // ===== v1.43.0 — the rider's own record =====
  //
  // REPORTED: "Rider App mein ek rider ke completed orders ka proper
  // record/history nazar nahi aata. Rider ko wazeh dikhna chahiye ke usne
  // kitne orders complete kiye aur history mehfooz rahe."
  //
  // The tiles above count LOCAL orders, so they reset with the device and show
  // nothing on a fresh install. This is the server's copy, scoped to this rider
  // by their token, so the record survives a reinstall and a new phone.
  const [history, setHistory] = useState<{
    orders: Array<Record<string, unknown>>;
    totals: { delivered?: number; today?: number; earnings?: number };
  } | null>(null);
  // A phone with no portal session (the staff route) keeps its own record: known at once, no loading rows.
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'failed' | 'local'>(
    () => (portalSessionOnThisPhone() ? 'loading' : 'local'));

  const loadHistory = useCallback(async () => {
    try {
      const { hasPortalSession, portalMyHistory } = await import('@/lib/portalData');
      if (!hasPortalSession()) { setHistoryState('local'); return; }
      const res = await portalMyHistory(100);
      if (res.ok) { setHistory(res.data); setHistoryState('ready'); }
      else setHistoryState(s => (s === 'ready' ? s : 'failed'));
    } catch {
      // the local tiles still show today; an earlier good load stays on screen
      setHistoryState(s => (s === 'ready' ? s : 'failed'));
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory, tick]);

  const claimOrder = async (o: Order): Promise<boolean> => {
    if (!rider) return false;

    // ===== v1.41.0 — the claim has to reach the SERVER =====
    //
    // saveOrder() alone writes straight at the table, and a portal app has no
    // Supabase session, so RLS matched zero rows and returned success: the
    // order stayed in AVAILABLE ORDERS, MY ACTIVE ORDERS stayed 0, and the
    // toast said "claimed". Reported exactly that way.
    //
    // The server owns this decision now — it checks the restaurant and refuses
    // an order another rider already took, which two phones racing for the
    // same delivery could not be trusted to do between themselves.
    const res = await portalClaimOrder(o.id);
    if (!res.ok) {
      toast.error(res.message || 'Could not claim this order.');
      return false;
    }
    if (res.data?.ok === false) {
      toast.error(res.data.reason === 'already_claimed'
        ? 'Another rider just took this order.'
        : 'Could not claim this order.');
      setOrders(getOrders());
      return false;
    }

    const next = setDeliveryStage({ ...o, riderId: rider.id, riderName: rider.name, riderPhone: rider.phone }, 'rider_assigned');
    saveOrder(next);
    setOrders(getOrders());
    toast.success(`Order #${o.orderNumber} claimed`);
    // v1.75.0 — the customer's tracking page shows the rider only while the rider is Live. A rider who has never
    // chosen either way is switched on when they take an order; one who switched it OFF on purpose stays off
    // (and is reminded by the banner below).
    if (localStorage.getItem('rider-tracking') === null) { localStorage.setItem('rider-tracking', '1'); setTracking(true); }
    return true;
  };

  const advance = async (o: Order, stage: DeliveryStatus): Promise<boolean> => {
    // Same reason as claimOrder: without this the stage change never leaves
    // the phone. The server also refuses a stage change on an order that is
    // not this rider's, which the local write could not check.
    const res = await portalSetDeliveryStage(o.id, stage);
    if (!res.ok) { toast.error(res.message || 'Could not update this delivery.'); return false; }
    if (res.data?.ok === false) { toast.error('Could not update this delivery.'); return false; }

    let next = setDeliveryStage(o, stage);
    if (stage === 'delivered') {
      next = { ...next, status: 'paid', paidAt: new Date().toISOString() } as Order;
      // Rider loyalty + lifetime delivered count
      try {
        const s = getSettings();
        // v1.49.0 — on a portal device this counter is the SERVER'S to keep.
        //
        // portal_my_history derives delivered counts and earnings from the
        // orders themselves, which is both authoritative and survives a
        // reinstall. Writing a second copy here queued a cloud write the phone
        // could never make, so every completed delivery produced another
        // "1 change could not be uploaded (riders)".
        const { hasPortalSession } = await import('@/lib/portalData');
        if (rider && s?.riderLoyaltyEnabled !== false && !hasPortalSession()) {
          const fresh = getRiders().find(r => r.id === rider.id) || rider;
          const inc = Math.max(0, s?.riderLoyaltyPerDelivery ?? 1);
          saveRider({
            ...fresh,
            loyaltyPoints: (fresh.loyaltyPoints || 0) + inc,
            totalDeliveries: (fresh.totalDeliveries || 0) + 1,
          });
        }
      } catch {}
    }
    saveOrder(next);
    notifyCustomerStage(next, stage);
    setOrders(getOrders());
    toast.success(DELIVERY_STAGE_LABEL[stage]);
    if (stage === 'delivered') void loadHistory();
    return true;
  };

  const sendTracking = (o: Order) => {
    const phone = normalizePhone(o.customer?.phone);
    if (!phone) { toast.error('No customer phone'); return; }
    openWhatsApp(phone, buildTrackingWhatsAppText(o));
  };

  // ---------------------------------------------------------------- v1.88.0 — what the screens need
  // Read on every render: the poll re-renders every 15 seconds, so "today" moves on at midnight by itself.
  const now = new Date();
  const records: DeliveryRecord[] = useMemo(() => {
    if (historyState === 'local') return rider ? localHistory(orders, rider.id) : [];
    return historyRows(history?.orders);
  }, [historyState, history, orders, rider]);
  const recordState: 'loading' | 'ready' | 'failed' = historyState === 'local' ? 'ready' : historyState;
  const today = periodSummary(records, 'today', now);
  const doneToday = history?.totals?.today ?? (historyState === 'local' ? today.count : completedToday.length);
  const valueToday = records.length || historyState !== 'loading'
    ? today.total
    : completedToday.reduce((s, o) => s + (o.grandTotal || 0), 0);

  const byId = (id: string | null | undefined) => (id ? orders.find(o => o.id === id) || null : null);

  /** The restaurant on the map and on the phone: the order's branch first, then the restaurant's settings. */
  const restaurantFor = (o: Order | null) => {
    const s = getSettings();
    const b = o?.branchId ? getBranches().find(x => x.id === o.branchId) : undefined;
    const point = b?.lat != null && b?.lng != null
      ? { lat: b.lat, lng: b.lng }
      : s?.restaurantLat != null && s?.restaurantLng != null ? { lat: s.restaurantLat, lng: s.restaurantLng } : null;
    const phone = normalizePhone(b?.phone) || normalizePhone(s?.supportWhatsappNumber) || normalizePhone(s?.phone1) || normalizePhone(s?.phone2);
    const name = [identity.name || s?.name, b?.name || identity.branchName].filter(Boolean).join(' · ');
    return { point, phone, name };
  };

  const sendProblem = (problem: string, o: Order | null) => {
    const text = problemMessage(problem, o, rider?.name);
    const phone = restaurantFor(o).phone;
    if (phone) { openWhatsApp(phone, text); return; }
    // No number on this phone: WhatsApp opens with the message written and the rider picks the restaurant's chat.
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const setTheme = (next: boolean) => {
    setDark(next);
    try { localStorage.setItem(RIDER_THEME_KEY, next ? 'dark' : 'light'); } catch { /* the choice lasts this session */ }
  };

  const openOrder = (o: Order) => { setView({ kind: 'order', id: o.id }); window.scrollTo?.(0, 0); };

  /** Shell: the rider's own look, light or night (RID-22), with the tab bar at the thumb. */
  const shell = (children: React.ReactNode, opts?: { tabs?: boolean }) => (
    <div
      className={cn('dt-rider flex flex-col', publicMode ? 'min-h-[100dvh]' : 'min-h-[calc(100dvh-4rem)] rounded-none')}
      data-theme={dark ? 'dark' : 'light'}
      data-rider-app
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-4 pt-[calc(8px+env(safe-area-inset-top,0px))]">
        {children}
      </div>
      {opts?.tabs && (
        <div className="sticky bottom-0 z-30 mx-auto w-full max-w-md">
          <TabBar tab={tab} onTab={t => { setTab(t); window.scrollTo?.(0, 0); }} badge={myOrders.length} />
        </div>
      )}
    </div>
  );

  if (!rider) {
    // Public portal: phone + PIN login (RID-02)
    if (publicMode) {
      const doLogin = async () => {
        const typed = loginPhone.trim();
        if (!typed || !loginPin) { setLoginError('Enter your username / phone and PIN'); return; }
        setLoginError('');
        setLoggingIn(true);
        try {
          // Cloud first — ONE DT Rider app for ALL restaurants. The server
          // resolves tenant + branch + role; the app never picks a restaurant.
          const { portalSignIn } = await import('@/lib/staffPortalAuth');
          const digits = typed.replace(/\D/g, '');
          const candidates = Array.from(new Set([typed, digits].filter(Boolean)));
          let message = '';
          for (const username of candidates) {
            const res = await portalSignIn({ username, password: loginPin, workspaceCode, expectedRole: 'rider' });
            if (res.ok) {
              const id = res.identity.userId;
              const existing = getRiders().find(r =>
                r.id === id || (r.phone || '').replace(/\D/g, '').slice(-10) === digits.slice(-10));
              const r: Rider = existing
                ? { ...existing, name: res.identity.name || existing.name, isActive: true }
                : { id, name: res.identity.name, phone: digits, isActive: true };
              saveRider(r);
              localStorage.setItem(RIDER_PORTAL_KEY, r.id);
              setRider(r);
              // Pull this rider's deliveries with the token that was just
              // minted, so the app opens on their work rather than on nothing.
              try {
                const { portalBootstrap } = await import('@/lib/portalData');
                const boot = await portalBootstrap();
                if (boot.ok) {
                  const { adoptPortalRows } = await import('@/lib/store');
                  await adoptPortalRows({ orders: boot.data.orders, tables: boot.data.tables });
                  setOrders(getOrders());
                }
              } catch { /* signed in; the 15s poll will bring them */ }
              toast.success(`Welcome ${r.name}!`);
              return;
            }
            message = res.message;
            if (res.needWorkspaceCode) setNeedCode(true);
          }

          // Offline fallback — device already holds this restaurant's riders.
          const match = getRiders().find(r =>
            r.isActive && (r.phone || '').replace(/\D/g, '').slice(-10) === digits.slice(-10));
          if (match && loginPin === (match.pin || '0000')) {
            localStorage.setItem(RIDER_PORTAL_KEY, match.id);
            setRider(match);
            toast.success(`Welcome ${match.name}!`);
            return;
          }
          // Lockout and rate-limit messages come from the server unchanged.
          setLoginError(message || 'Wrong username/phone or PIN');
        } finally { setLoggingIn(false); }
      };
      const field = 'h-12 w-full rounded-xl border bg-card px-3 text-[16px] outline-none focus:border-primary';
      return shell(
        <div className="flex flex-1 flex-col gap-5 pt-6" data-rider-screen="login">
          <div className="flex flex-col items-center gap-3 text-center">
            <div data-rd-hero className="grid h-20 w-20 place-items-center rounded-[22px]"><Bike className="relative z-10 h-10 w-10" /></div>
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight">DT Rider</h1>
              <p className="text-[14px] text-muted-foreground">Sign in with the account your restaurant created</p>
            </div>
            <AppLanguageSwitch />
          </div>
          {loginError && <Banner tone="bad" icon={AlertTriangle}>{loginError}</Banner>}
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); void doLogin(); }}>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">Username / Phone</span>
              <input type="text" value={loginPhone} onChange={e => setLoginPhone(e.target.value)} placeholder="username or 03xxxxxxxxx"
                className={field} autoFocus autoComplete="username" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">PIN / Password</span>
              <input type="password" maxLength={64} value={loginPin} onChange={e => setLoginPin(e.target.value)} placeholder="••••"
                className={cn(field, 'text-center font-mono tracking-widest')} autoComplete="current-password" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">Workspace code {needCode ? '(required)' : '(optional)'}</span>
              <input type="text" maxLength={12} value={workspaceCode} onChange={e => setWorkspaceCode(e.target.value.toUpperCase())} placeholder="ABC123"
                className={cn(field, 'text-center font-mono tracking-widest', needCode && 'border-[hsl(var(--rd-warn))] ring-2 ring-[hsl(var(--rd-warn)/.35)]')} />
            </label>
            <RButton type="submit" variant="primary" size="lg" className="w-full" busy={loggingIn}>
              {loggingIn ? 'Signing in…' : 'Sign in'}
            </RButton>
          </form>
          <p className="mt-auto text-center text-[12.5px] text-muted-foreground">
            One DT Rider app works for every restaurant — your account decides which one you see.
          </p>
        </div>,
      );
    }
    // Staff route: quick picker
    return shell(
      <div className="space-y-3 pt-4">
        <div className="text-center">
          <Bike className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-2 text-[20px] font-extrabold">Select your rider profile</h2>
          <p className="text-[14px] text-muted-foreground">Your login isn't linked to a rider. Pick yourself:</p>
        </div>
        {allRiders.length === 0 && <Banner tone="bad" icon={AlertTriangle}>No riders configured. Ask admin to add riders in Settings.</Banner>}
        {allRiders.map(r => (
          <button key={r.id} type="button" className="block w-full text-left" onClick={() => { localStorage.setItem('rider-profile-id', r.id); setRider(r); }}>
            <RCard className="flex items-center gap-3 py-3">
              <UserIcon className="h-5 w-5 text-primary" />
              <span className="flex-1 text-[15px] font-bold">{r.name}</span>
              <span className="text-[13px] text-muted-foreground">{r.phone}</span>
            </RCard>
          </button>
        ))}
      </div>,
    );
  }

  const background = (
    <>
      <ReadyNotificationBus />
      <ReadyOrderPoller types={['delivery']} />
    </>
  );

  // ---------------------------------------------------------------- one delivery (covers the tabs)
  if (view) {
    const o = view.kind === 'done' ? null : byId(view.id);
    const back = () => setView(null);
    let body: React.ReactNode = null;
    if (view.kind === 'done') {
      body = <DoneScreen orderNumber={view.orderNumber} riderName={rider.name} today={doneToday} todayValue={valueToday}
        onBack={() => { setView(null); setTab('home'); }} />;
    } else if (view.kind === 'help') {
      body = <HelpScreen order={o} restaurantPhone={restaurantFor(o).phone} onBack={() => setView(o ? { kind: 'order', id: o.id } : null)}
        onProblem={p => sendProblem(p, o)} />;
    } else if (!o) {
      body = (
        <div className="space-y-3 pt-6">
          <Banner tone="warn" icon={AlertTriangle}>This order is no longer on this phone. It may have been reassigned or cancelled.</Banner>
          <RButton className="w-full" onClick={back}>Back to orders</RButton>
        </div>
      );
    } else if (view.kind === 'pickup') {
      body = <PickupScreen order={o} onBack={() => setView({ kind: 'order', id: o.id })}
        onConfirm={async () => { if (await advance(o, 'rider_picked')) setView({ kind: 'order', id: o.id }); }} />;
    } else if (view.kind === 'deliver') {
      body = <DeliverScreen order={o} onBack={() => setView({ kind: 'order', id: o.id })}
        onConfirm={async () => { if (await advance(o, 'delivered')) setView({ kind: 'done', orderNumber: o.orderNumber }); }} />;
    } else {
      const r = restaurantFor(o);
      body = (
        <OrderScreen
          order={o} riderPos={myPos} restaurant={r.point} restaurantName={r.name} restaurantPhone={r.phone} online={online}
          gpsOff={!!gpsError || (!tracking && o.riderId === rider.id)}
          onBack={back}
          onCall={() => setCallId(o.id)}
          onHelp={() => setView({ kind: 'help', id: o.id })}
          onStages={() => setStagesId(o.id)}
          onNext={async () => {
            const next = nextAction(o);
            if (!next) return;
            if (next.confirm === 'pickup') { setView({ kind: 'pickup', id: o.id }); return; }
            if (next.confirm === 'deliver') { setView({ kind: 'deliver', id: o.id }); return; }
            await advance(o, next.stage);
          }}
        />
      );
    }
    const callOrder = byId(callId);
    return shell(
      <>
        {background}
        {body}
        <CallSheet order={callOrder} phone={normalizePhone(callOrder?.customer?.phone)} onClose={() => setCallId(null)} onTracking={sendTracking} />
        <StageSheet order={byId(stagesId)} onClose={() => setStagesId(null)}
          onPick={(ord, stage) => {
            setStagesId(null);
            if (stage === 'delivered') { setView({ kind: 'deliver', id: ord.id }); return; }
            void advance(ord, stage);
          }} />
      </>,
    );
  }

  // ---------------------------------------------------------------- the four tabs
  const alertOrder = byId(alertId);
  const refresh = <RefreshButton refreshing={refreshing} onRefresh={() => void pullOrders({ announce: true })} />;
  const claimOrderSheet = byId(claimId);

  let body: React.ReactNode;
  if (tab === 'home') {
    body = (
      <div className="space-y-3" data-rider-screen="home">
        {/* Header (RID-04): who, which restaurant, and the Live switch the restaurant's rider map depends on. */}
        <div data-rd-hero className="flex items-center gap-3 p-3.5">
          <span className="relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/20 text-[16px] font-extrabold">{initials(rider.name)}</span>
          <div className="relative z-10 min-w-0 flex-1">
            <div className="truncate text-[16px] font-extrabold">{rider.name}</div>
            {/* v1.43.0 — whose app this is. One build serves every restaurant. */}
            <div className="opacity-90"><PortalRestaurantBadge compact showCode /></div>
          </div>
          <button type="button" onClick={toggleTracking} aria-pressed={tracking}
            className={cn('relative z-10 inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-extrabold', tracking ? 'bg-[#16a34a] text-white' : 'bg-white/20 text-white')}>
            <Radio className={cn('h-4 w-4', tracking && 'animate-pulse')} />{tracking ? 'LIVE' : 'Go Live'}
          </button>
        </div>

        {!online && <Banner tone="bad" icon={AlertTriangle}>You are offline. Orders shown are the last ones loaded.</Banner>}

        {/* v1.75.0 — the customer (and the restaurant's tracking view) can only see a rider who is Live. */}
        {myOrders.length > 0 && !tracking && (
          <Card data-rider-live-reminder className="flex items-center gap-3 rounded-xl border-transparent bg-[hsl(var(--rd-warn-bg))] p-3 text-[hsl(var(--rd-warn))] shadow-none">
            <Radio className="h-5 w-5 shrink-0" />
            <div className="flex-1 text-[13px]">
              <p className="font-extrabold">Your location is OFF</p>
              <p>The customer cannot see where you are. Turn on Live so they can follow their order.</p>
            </div>
            <RButton size="sm" variant="primary" onClick={toggleTracking}>Go Live</RButton>
          </Card>
        )}
        {tracking && gpsError && <Banner tone="warn" icon={MapPin}>Location is off or blocked ({gpsError}). Turn it on so the restaurant can see you on the map.</Banner>}

        {/* Stats — the server's count when it has one, so a reinstall does not reset the rider's record. */}
        <div className="grid grid-cols-3 gap-2">
          <RCard className="px-2 py-2.5 text-center"><div className="text-[12px] text-muted-foreground">Active</div><b className="text-[18px] text-primary">{myOrders.length}</b></RCard>
          <RCard className="px-2 py-2.5 text-center"><div className="text-[12px] text-muted-foreground">Done today</div><b className="text-[18px] text-[hsl(var(--rd-ok))]">{doneToday}</b></RCard>
          <RCard className="px-2 py-2.5 text-center" title="The value of the bills you delivered today">
            <div className="text-[12px] text-muted-foreground">Bills today</div><b className="block truncate text-[16px]">{money(valueToday)}</b>
          </RCard>
        </div>

        {/* v1.112.0 — the money still to be taken from customers on the orders in hand */}
        {cashDue.amount > 0 && (
          <RCard data-rider-cash-due className="flex items-center gap-3 border-transparent bg-[hsl(var(--rd-warn-bg))] text-[hsl(var(--rd-warn))] shadow-none">
            <Wallet className="h-5 w-5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold">To collect from customers</div>
              <div className="text-[12px] opacity-90">{`${cashDue.count} order${cashDue.count === 1 ? '' : 's'}`}</div>
            </div>
            <b className="shrink-0 text-[18px]">{money(cashDue.amount)}</b>
          </RCard>
        )}

        <RLabel>My active orders ({myOrders.length})</RLabel>
        {myOrders.length === 0
          ? <RCard className="py-6 text-center text-[14px] text-muted-foreground">No active orders. New ones appear here automatically.</RCard>
          : <div className="space-y-2">{myOrders.map((o, i) => <OrderCard key={o.id} order={o} active={i === 0} onOpen={() => openOrder(o)} />)}</div>}

        {unassigned.length > 0 && (
          <>
            <RLabel right={unassigned.length > 3 ? <button type="button" className="inline-flex items-center text-[13px] font-bold text-primary" onClick={() => { setTab('orders'); setSeg('available'); }}>See all<ChevronRight className="h-4 w-4" /></button> : undefined}>
              Available orders ({unassigned.length})
            </RLabel>
            <div className="space-y-2">{unassigned.slice(0, 3).map(o => <AvailableRow key={o.id} order={o} onClaim={() => setClaimId(o.id)} />)}</div>
          </>
        )}

        {myPos && tracking && (
          <div className="text-center text-[11.5px] text-muted-foreground">
            📍 {myPos.lat.toFixed(5)}, {myPos.lng.toFixed(5)} · pings save automatically
          </div>
        )}
        {refresh}
      </div>
    );
  } else if (tab === 'orders') {
    body = (
      <div data-rider-screen="orders">
        <h1 className="py-3 text-[22px] font-extrabold tracking-tight">Orders</h1>
        <OrdersTab
          seg={seg} onSeg={setSeg} mine={myOrders} available={unassigned}
          history={records} historyState={recordState}
          onOpen={openOrder} onClaim={o => setClaimId(o.id)} onRecord={setRecord} onRetryHistory={() => void loadHistory()}
          refresh={refresh} now={now}
        />
      </div>
    );
  } else if (tab === 'record') {
    body = (
      <div data-rider-screen="record">
        <h1 className="py-3 text-[22px] font-extrabold tracking-tight">My record</h1>
        <RecordTab rows={records} lifetime={history?.totals?.delivered} state={recordState}
          onRetry={() => void loadHistory()} onRecord={setRecord} now={now} />
      </div>
    );
  } else {
    body = (
      <div className="space-y-3" data-rider-screen="profile">
        <h1 className="py-3 text-[22px] font-extrabold tracking-tight">Profile</h1>
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[hsl(var(--rd-tint))] text-[20px] font-extrabold text-primary">{initials(rider.name)}</span>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-bold">{rider.name}</div>
            <div className="text-[13px] text-muted-foreground">{rider.phone}</div>
            <div className="text-muted-foreground"><PortalRestaurantBadge compact showCode /></div>
          </div>
        </div>
        <RCard className="divide-y py-1">
          <div className="flex items-center gap-3 py-3">
            <Radio className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-[15px]">Live location while on duty</span>
            <Toggle checked={tracking} onChange={() => toggleTracking()} label="Live location while on duty" />
          </div>
          <div className="flex items-center gap-3 py-3">
            <Moon className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-[15px]">Dark theme (night shift)</span>
            <Toggle checked={dark} onChange={setTheme} label="Dark theme" />
          </div>
          <AppLanguageSwitch row />
          <button type="button" className="flex w-full items-center gap-3 py-3 text-left" onClick={() => setView({ kind: 'help' })}>
            <LifeBuoy className="h-5 w-5 text-muted-foreground" />
            <span className="flex-1 text-[15px]">Help and support</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </RCard>

        {/* v1.46.0 — the rider's own picture, name and phone. */}
        <StaffProfileCard onSaved={() => setTick(t => t + 1)} />

        {/* ===== v1.49.0 — REPORTED: "profile icon dabao to logout ho jata hai" =====
            It did, and the icon was a PERSON with title="Logout". Every rider
            who tapped it expecting their profile was signed out instead. The
            profile is this tab; this is a logout button, it looks like one,
            and it asks first. */}
        {publicMode && (
          <RButton className="w-full" icon={LogOut} aria-label="Log out"
            onClick={() => {
              if (!window.confirm('Log out of DT Rider? You will need your username and PIN to sign back in.')) return;
              // v1.47.0 — same as the Order Taker: clearing the local rider
              // left a thirty-day portal token on the phone, so a "logged out"
              // device could still read this restaurant's orders.
              localStorage.removeItem(RIDER_PORTAL_KEY);
              void (async () => {
                try {
                  const { portalLogout } = await import('@/lib/portalData');
                  await portalLogout();
                } catch { /* the local token is gone either way */ }
              })();
              setRider(null); setLoginPhone(''); setLoginPin(''); setTab('home'); setView(null);
            }}>
            Log out
          </RButton>
        )}
        <p className="pt-1 text-center text-[12px] text-muted-foreground">DT Rider v{APP_VERSION} · Powered by Digital Target</p>
      </div>
    );
  }

  return shell(
    <>
      {background}
      {alertOrder && alertOrder.deliveryStatus === 'ready' && (!alertOrder.riderId || alertOrder.riderId === rider.id) && (
        <ReadyAlert order={alertOrder} mine={alertOrder.riderId === rider.id}
          onLater={() => setAlertId(null)}
          onAct={() => { setAlertId(null); if (alertOrder.riderId === rider.id) openOrder(alertOrder); else setClaimId(alertOrder.id); }} />
      )}
      {body}
      <ClaimSheet order={claimOrderSheet} onClose={() => setClaimId(null)}
        onClaim={async o => {
          const ok = await claimOrder(o);
          setClaimId(null);
          if (ok) openOrder(o);
          return ok;
        }} />
      <RecordSheet r={record} onClose={() => setRecord(null)} />
    </>,
    { tabs: true },
  );
}
