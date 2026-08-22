import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/currency';
import { onDataChange, initStore, getCategories, getMenuItems, getSettings, getNextOrderNumber, getNextOrderNumberAsync, saveOrder, validatePromoCode, incrementPromoUsage, getOrders, getBranches, getTables, saveTable, getDeals, genId } from '@/lib/store';
import { getTenantId } from '@/lib/tenant';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Minus, Trash2, ShoppingBag, MapPin, Phone, User, Search, X, Tag, CheckCircle, LogIn, LogOut, ClipboardList, Clock, ArrowLeft, Store, ChevronDown, BellRing, Utensils } from 'lucide-react';
import { Order, CartItem, MenuItem, Branch } from '@/lib/types';
import { openWhatsApp, normalizePhone as normWaPhone } from '@/lib/whatsapp';
import { computeDistance } from '@/lib/delivery';
import { addServiceCall } from '@/lib/serviceCalls';
import WhatsAppFloat from '@/components/WhatsAppFloat';
import LeafletMap from '@/components/LeafletMap';
import { submitPublicOrder } from '@/lib/publicPortal.functions';

const ACCOUNT_KEY = 'dt-online-account-v1';
const ACCOUNTS_REGISTRY_KEY = 'dt-online-accounts-v2'; // phone-keyed registry
const BRANCH_KEY_PREFIX = 'dt-online-branch-v1:';
type OnlineAccount = {
  name: string;
  phone: string;
  address?: string;
  city?: string;
  pin?: string;              // hashed 4-digit PIN
  gender?: 'male' | 'female';
  lat?: number;
  lng?: number;
  locationCapturedAt?: string;
};
function loadAccount(): OnlineAccount | null {
  try { const raw = localStorage.getItem(ACCOUNT_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveAccountLS(a: OnlineAccount | null) {
  if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
  else localStorage.removeItem(ACCOUNT_KEY);
}
function loadRegistry(): Record<string, OnlineAccount> {
  try { const raw = localStorage.getItem(ACCOUNTS_REGISTRY_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function saveRegistry(reg: Record<string, OnlineAccount>) {
  try { localStorage.setItem(ACCOUNTS_REGISTRY_KEY, JSON.stringify(reg)); } catch {}
  try { void import('@/lib/cloudDocs').then(m => m.mirrorValue(ACCOUNTS_REGISTRY_KEY, reg)); } catch {}
}
function upsertRegistry(a: OnlineAccount) {
  const reg = loadRegistry();
  const key = normalizePhone(a.phone);
  reg[key] = { ...(reg[key] || {}), ...a };
  saveRegistry(reg);
}
function findRegistry(phone: string): OnlineAccount | null {
  const reg = loadRegistry();
  return reg[normalizePhone(phone)] || null;
}
// Simple SHA-256 hash (browser-native) for PIN
async function hashPin(pin: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dt-pos:' + pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return 'plain:' + pin; }
}
function branchKey() { return BRANCH_KEY_PREFIX + (getTenantId() || 'default'); }
function loadBranchId(): string | null { try { return localStorage.getItem(branchKey()); } catch { return null; } }
function saveBranchIdLS(id: string | null) {
  if (id) localStorage.setItem(branchKey(), id);
  else localStorage.removeItem(branchKey());
}
function normalizePhone(p: string) { return (p || '').replace(/\D/g, ''); }


/**
 * Public Online Ordering Portal (Phase 1)
 * Route: /order  — uses the active tenant's menu, writes orders to same store
 * Order arrives in Delivery Board automatically (orderType:'delivery', source:'website')
 */
export default function OnlineOrderPage() {
  const [ready, setReady] = useState(false);
  // Bumped whenever cloud data lands after boot. Without this the menu was
  // read once at ready-time — on a QR scan the heavy/menu collections arrive a
  // moment later, so the customer saw "No items found" forever.
  const [dataTick, setDataTick] = useState(0);
  useEffect(() => { initStore().then(() => setReady(true)).catch(() => setReady(true)); }, []);
  useEffect(() => {
    let t: any;
    const off = onDataChange(() => {
      clearTimeout(t);
      t = setTimeout(() => setDataTick(v => v + 1), 120);
    });
    return () => { clearTimeout(t); off(); };
  }, []);

  const settings = useMemo(() => ready ? getSettings() : ({} as any), [ready, dataTick]);
  const categories = useMemo(() => ready ? getCategories() : [], [ready, dataTick]);
  const menuItems = useMemo(() => ready ? getMenuItems().filter(m => m.isActive !== false) : [], [ready, dataTick]);


  const [activeCat, setActiveCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  // QR Dine-in mode (when scanned from a table QR — declared early so other effects can use it)
  const [dineIn] = useState<{ table: string; floor?: string; branch?: string } | null>(() => {
    try {
      const h = typeof window !== 'undefined' ? window.location.hash : '';
      const qIdx = h.indexOf('?');
      if (qIdx === -1) return null;
      const qs = new URLSearchParams(h.slice(qIdx + 1));
      const table = qs.get('table');
      if (!table) return null;
      // `branch` is optional and backwards compatible: older QR codes do not
      // carry it, and the table's own branch is used instead.
      return { table, floor: qs.get('floor') || undefined, branch: qs.get('branch') || undefined };
    } catch { return null; }
  });


  // Branches (multi-branch tenants)
  const branches = useMemo<Branch[]>(() => ready ? getBranches().filter(b => b.isActive !== false) : [], [ready]);
  const [branchId, setBranchId] = useState<string | null>(() => loadBranchId());
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const currentBranch = useMemo(() => branches.find(b => b.id === branchId) || null, [branches, branchId]);

  // Auto-open picker when multi-branch tenant has no choice yet (skip in dine-in mode)
  useEffect(() => {
    if (!ready) return;
    if (!dineIn && branches.length > 1 && !branchId) setBranchPickerOpen(true);
    if (branches.length === 1 && !branchId) {
      setBranchId(branches[0].id); saveBranchIdLS(branches[0].id);
    }
    if (dineIn && !branchId && branches.length > 1) {
      // Default to first branch for dine-in QR (no prompt)
      setBranchId(branches[0].id); saveBranchIdLS(branches[0].id);
    }
  }, [ready, branches.length, branchId, dineIn]);

  const filteredBranches = useMemo(() => {
    const q = branchSearch.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter(b =>
      b.name.toLowerCase().includes(q) ||
      (b.city || '').toLowerCase().includes(q) ||
      (b.address || '').toLowerCase().includes(q)
    );
  }, [branches, branchSearch]);

  const pickBranch = (id: string) => {
    setBranchId(id); saveBranchIdLS(id); setBranchPickerOpen(false); setBranchSearch('');
    toast.success('Branch selected');
  };

  // Account (local, phone-based)
  const [account, setAccount] = useState<OnlineAccount | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginGender, setLoginGender] = useState<'male' | 'female' | ''>('');
  const [loginMode, setLoginMode] = useState<'phone' | 'pin' | 'signup'>('phone');
  const [existingAccount, setExistingAccount] = useState<OnlineAccount | null>(null);

  // Customer form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  // Flavor picker (single-select). Set when user clicks Add on an item that has flavors.
  const [flavorPick, setFlavorPick] = useState<{ item: MenuItem; flavor: string } | null>(null);
  // Size/Inch variant picker — opens when item has sizeVariants or inchVariants.
  const [variantPick, setVariantPick] = useState<{ item: MenuItem; kind: 'size' | 'inch'; selected: { name: string; price: number } | null } | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [customerIp, setCustomerIp] = useState<string>('');

  // Service radius check (from selected branch). Falls back to settings.restaurantLat/Lng if branch has no coords.
  const serviceArea = useMemo(() => {
    const branchLat = currentBranch?.lat ?? (settings as any)?.restaurantLat;
    const branchLng = currentBranch?.lng ?? (settings as any)?.restaurantLng;
    const radiusKm = Number(currentBranch?.serviceRadiusKm) || 0;
    const branchHasGeo = typeof branchLat === 'number' && typeof branchLng === 'number';
    const customerHasGeo = typeof lat === 'number' && typeof lng === 'number';
    let distanceKm: number | null = null;
    if (branchHasGeo && customerHasGeo) {
      try { distanceKm = +computeDistance({ lat: branchLat, lng: branchLng }, { lat: lat!, lng: lng! }).toFixed(2); } catch {}
    }
    const hasRadius = radiusKm > 0;
    const inRadius = !hasRadius || (distanceKm != null && distanceKm <= radiusKm);
    return { branchLat, branchLng, radiusKm, branchHasGeo, customerHasGeo, distanceKm, hasRadius, inRadius };
  }, [currentBranch, lat, lng, settings]);
  // Self-Pickup vs Delivery (auto-init from URL ?mode=takeaway|delivery)
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>(() => {
    try {
      const h = typeof window !== 'undefined' ? window.location.hash : '';
      const qIdx = h.indexOf('?');
      if (qIdx === -1) return 'delivery';
      const qs = new URLSearchParams(h.slice(qIdx + 1));
      const m = (qs.get('mode') || '').toLowerCase();
      if (m === 'takeaway' || m === 'pickup') return 'pickup';
      return 'delivery';
    } catch { return 'delivery'; }
  });
  const [pickupSlot, setPickupSlot] = useState<number | null>(null);

  // (dineIn declared earlier above branches effect)
  const [callingWaiter, setCallingWaiter] = useState(false);
  const callWaiter = async (msg?: string) => {
    if (!dineIn) return;
    setCallingWaiter(true);
    try {
      const sc = await addServiceCall({
        tableLabel: dineIn.table,
        floorName: dineIn.floor,
        message: msg || 'Customer is calling waiter',
      });
      if (sc) toast.success('🛎 The waiter has been notified');
      else toast.error('Could not notify — please try again');
    } finally { setCallingWaiter(false); }
  };

  useEffect(() => {
    const a = loadAccount();
    if (a) {
      setAccount(a);
      setName(a.name); setPhone(a.phone);
      if (a.address) setAddress(a.address);
      if (a.city) setCity(a.city);
    }
    // Best-effort IP capture for retargeting / fraud signals
    fetch('https://api.ipify.org?format=json')
      .then(r => r.json()).then(j => setCustomerIp(j.ip || '')).catch(() => {});
  }, []);

  // Promo
  const [promoInput, setPromoInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<{ code: string; discount: number } | null>(null);

  const [placing, setPlacing] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);

  const myOrders = useMemo(() => {
    if (!ready || !account) return [] as Order[];
    const np = normalizePhone(account.phone);
    return getOrders()
      .filter(o => o.source === 'website' && normalizePhone(o.customer?.phone || '') === np)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [ready, account, placedOrder, ordersOpen]);

  const visibleItems = useMemo(() => {
    let list = menuItems;
    if (activeCat !== 'all') list = list.filter(m => m.categoryId === activeCat);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [menuItems, activeCat, search]);

  const subtotal = cart.reduce((s, c) => s + c.lineTotal, 0);
  const promoDiscount = promoApplied?.discount || 0;
  const freeDeliveryThreshold = Number(settings.freeDeliveryThreshold || 0);
  const baseDeliveryCharge = Number(settings.deliveryCharge || 0);
  const deliveryCharge = fulfillment === 'pickup'
    ? 0
    : (freeDeliveryThreshold > 0 && subtotal >= freeDeliveryThreshold) ? 0 : baseDeliveryCharge;
  const minOrder = Number(settings.minOnlineOrder || 0);
  const grandTotal = Math.max(0, subtotal - promoDiscount) + deliveryCharge;
  const pickupOn = settings.selfPickupEnabled === true;
  const slots: number[] = (settings.pickupTimeSlots && settings.pickupTimeSlots.length > 0) ? settings.pickupTimeSlots : [15, 30, 45, 60];

  // Compute minimum variant price for "From Rs. X" display
  const variantInfo = (m: MenuItem): { hasVariants: boolean; kind: 'size' | 'inch' | null; minPrice: number; list: { name: string; price: number }[] } => {
    const sizes = (m.sizeVariants || []).filter(v => v && v.name && Number(v.price) > 0);
    const inches = (m.inchVariants || []).filter(v => v && v.name && Number(v.price) > 0);
    if (sizes.length > 0) {
      return { hasVariants: true, kind: 'size', minPrice: Math.min(...sizes.map(v => v.price)), list: sizes.map(v => ({ name: v.name, price: v.price })) };
    }
    if (inches.length > 0) {
      return { hasVariants: true, kind: 'inch', minPrice: Math.min(...inches.map(v => v.price)), list: inches.map(v => ({ name: v.name, price: v.price })) };
    }
    return { hasVariants: false, kind: null, minPrice: m.price, list: [] };
  };

  const addItem = (m: MenuItem) => {
    if (m.pricingType !== 'fixed' && !((m.sizeVariants?.length || 0) > 0) && !((m.inchVariants?.length || 0) > 0)) {
      toast.error('Please order weight-based items at the POS counter.');
      return;
    }
    const vi = variantInfo(m);
    if (vi.hasVariants && vi.kind) {
      setVariantPick({ item: m, kind: vi.kind, selected: null });
      return;
    }
    // If the item has flavor choices, force the customer to pick exactly one first.
    if (m.flavors && m.flavors.length > 0) {
      setFlavorPick({ item: m, flavor: '' });
      return;
    }
    pushToCart(m);
  };

  const pushToCart = (m: MenuItem, flavor?: string, variant?: { kind: 'size' | 'inch'; name: string; price: number }) => {
    setCart(prev => {
      const variantKey = variant ? `|${variant.kind}:${variant.name}` : '';
      const flavorNote = flavor ? `Flavor: ${flavor}` : '';
      const ex = prev.find(c => c.menuItemId === m.id && (c.note || '') === flavorNote && (c.variantName || '') === (variant?.name || ''));
      if (ex) return prev.map(c => c.id === ex.id ? { ...c, quantity: c.quantity + 1, lineTotal: (c.quantity + 1) * c.price } : c);
      const price = variant ? variant.price : m.price;
      const displayName = variant ? `${m.name} (${variant.name})` : m.name;
      const item: CartItem = {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${variantKey}`,
        menuItemId: m.id, name: displayName, pricingType: 'fixed', price,
        quantity: 1, lineTotal: price, note: flavorNote,
        ...(variant ? { variantType: variant.kind, variantName: variant.name } : {}),
      };
      return [...prev, item];
    });
  };

  const confirmVariant = () => {
    if (!variantPick || !variantPick.selected) { toast.error('Select a size'); return; }
    pushToCart(variantPick.item, undefined, { kind: variantPick.kind, name: variantPick.selected.name, price: variantPick.selected.price });
    setVariantPick(null);
  };

  const confirmFlavor = () => {
    if (!flavorPick) return;
    if (!flavorPick.flavor) { toast.error('Select a flavour'); return; }
    pushToCart(flavorPick.item, flavorPick.flavor);
    setFlavorPick(null);
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.flatMap(c => {
      if (c.id !== id) return [c];
      const q = c.quantity + delta;
      if (q <= 0) return [];
      return [{ ...c, quantity: q, lineTotal: q * c.price }];
    }));
  };

  const removeItem = (id: string) => setCart(p => p.filter(c => c.id !== id));

  const captureLocation = () => {
    if (!('geolocation' in navigator)) { toast.error('GPS is not supported'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude); setLng(pos.coords.longitude);
        setLocating(false);
        toast.success('Location captured');
      },
      err => { setLocating(false); toast.error('Location permission denied: ' + err.message); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const applyPromo = () => {
    if (!promoInput.trim()) return;
    const r = validatePromoCode(promoInput.trim(), subtotal);
    if ('error' in r) { toast.error(r.error); return; }
    setPromoApplied({ code: r.promo.code, discount: r.discount });
    toast.success(`Promo applied: -${money(r.discount)}`);
  };

  const placeOrder = async () => {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!dineIn && branches.length > 1 && !branchId) { toast.error('Select a branch first'); setBranchPickerOpen(true); return; }
    if (!dineIn && !name.trim()) { toast.error('Naam likhein'); return; }
    if (!dineIn && (!phone.trim() || phone.replace(/\D/g, '').length < 10)) { toast.error('Valid phone likhein'); return; }
    if (!dineIn && fulfillment === 'delivery' && !address.trim()) { toast.error('Delivery address likhein'); return; }
    if (!dineIn && fulfillment === 'delivery' && (lat == null || lng == null)) {
      toast.error('📍 Sharing your live location is required for delivery');
      captureLocation();
      return;
    }
    if (!dineIn && fulfillment === 'delivery' && serviceArea.hasRadius && serviceArea.distanceKm != null && !serviceArea.inRadius) {
      toast.error(`Sorry — you are outside our service area (${serviceArea.distanceKm} km, max ${serviceArea.radiusKm} km).`);
      return;
    }
    if (!dineIn && fulfillment === 'pickup' && !pickupSlot) { toast.error('Choose a pickup time slot'); return; }
    if (!dineIn && minOrder > 0 && subtotal < minOrder) { toast.error(`Minimum order ${money(minOrder)}`); return; }

    // ===== Blocklist check (customer-facing) =====
    try {
      const { isCustomerBlocked, findBlockingLocation } = await import('@/lib/blocklist');
      const bc = phone ? isCustomerBlocked(phone) : null;
      if (bc) {
        toast.error('Your ordering access is currently restricted. Please contact the restaurant.', { duration: 8000 });
        return;
      }
      const bl = findBlockingLocation({ address, lat: lat ?? undefined, lng: lng ?? undefined });
      if (bl && bl.action === 'reject') {
        toast.error('Sorry — we are not accepting orders from this area. Please contact the restaurant.', { duration: 8000 });
        return;
      }
    } catch {}


    setPlacing(true);
    try {
      // Compute distance from restaurant if both points known
      let distanceFromRestaurantKm: number | undefined;
      try {
        if (lat != null && lng != null && settings.restaurantLat != null && settings.restaurantLng != null) {
          distanceFromRestaurantKm = +computeDistance(
            { lat: settings.restaurantLat, lng: settings.restaurantLng },
            { lat, lng }
          ).toFixed(2);
        }
      } catch {}

      // ===== v1.26.4 — a QR order used to be filed against the wrong branch =====
      //
      // A dine-in QR carries only ?table=…&floor=…, and the branch effect above
      // defaulted a multi-branch tenant to branches[0] "for dine-in QR (no
      // prompt)". So a customer scanning Table 5 in Branch 2 had their order
      // filed against Branch 1 — wrong kitchen, wrong floor map, wrong branch
      // sales. The table name lookup was unscoped too, so "Table 5" could match
      // a different branch's Table 5 outright.
      //
      // dining_tables.branch_id is the authority: a table belongs to exactly one
      // branch, and the customer is physically at that table. Resolve the table
      // first, then take the branch from it.
      let matchedTable: ReturnType<typeof getTables>[number] | undefined;
      if (dineIn) {
        const all = getTables();
        const key = dineIn.table.trim().toLowerCase();
        const inBranch = (t: { branchId?: string }) =>
          !dineIn.branch || t.branchId === dineIn.branch;
        const byName = (t: { name?: string }) => (t.name || '').trim().toLowerCase() === key;
        matchedTable =
          // An id is unambiguous across every branch.
          all.find(t => t.id === dineIn.table)
          // Otherwise prefer a name match inside the branch the QR names.
          || all.find(t => byName(t) && inBranch(t))
          || all.find(byName);
        if (!matchedTable) {
          console.warn('[order] QR table not found in this restaurant', dineIn.table);
        }
      }
      // The table decides the branch; the picker only decides it when there is
      // no table to ask.
      const effectiveBranchId =
        (dineIn ? (matchedTable?.branchId || dineIn.branch) : null) || branchId || null;

      // FIX: order.id is written to the Postgres `orders.id uuid` column on
      // sync — a local-only `ord-...` string is not a valid uuid and made
      // apply_sync_batch() throw on cast, silently dropping the whole batch
      // (see supabase apply_sync_batch: `(v_op->>'entity_id')::uuid`). Use the
      // same crypto.randomUUID()-based genId() the POS uses for its orders.
      const orderId = genId();
      const order: Order = {
        id: orderId,
        orderNumber: getNextOrderNumber(),
        orderType: dineIn ? 'dining' : (fulfillment === 'pickup' ? 'takeaway' : 'delivery'),
        status: 'running',
        source: dineIn ? 'qr' : 'website',
        tableLabel: dineIn ? `${dineIn.table}${dineIn.floor ? ' · ' + dineIn.floor : ''}` : undefined,
        tableId: matchedTable?.id,
        tableName: matchedTable?.name || (dineIn ? dineIn.table : undefined),
        pickupRequested: !dineIn && fulfillment === 'pickup',
        pickupTime: !dineIn && fulfillment === 'pickup' && pickupSlot ? `${pickupSlot} min` : undefined,
        items: cart,
        subtotal,
        discount: promoDiscount,
        tax: 0,
        serviceCharge: 0,
        serviceChargePercent: 0,
        grandTotal,
        deliveryStatus: dineIn ? undefined : (fulfillment === 'pickup' ? undefined : 'pending'),
        kitchenStatus: 'pending',
        kitchenStatusAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        notes: notes.trim(),
        promoCode: promoApplied?.code,
        promoCodeDiscount: promoDiscount,
        customer: {
          id: `cust-${Date.now()}`,
          name: (name.trim() || (dineIn ? `${dineIn.table} Guest` : '')),
          phone: phone.trim(),
          address: dineIn
            ? `Dine-In · ${dineIn.table}${dineIn.floor ? ' (' + dineIn.floor + ')' : ''}`
            : (fulfillment === 'pickup' ? `Self-Pickup (${pickupSlot} min)` : (address.trim() + (city ? `, ${city}` : ''))),
          city: city.trim(),
          ...(!dineIn && fulfillment === 'delivery' && lat != null && lng != null ? {
            lat, lng,
            locationLabel: 'Website Order Pin',
            locationCapturedAt: new Date().toISOString(),
          } : {}),
        } as any,
        delivery: !dineIn && fulfillment === 'delivery' ? {
          customerLat: lat ?? undefined,
          customerLng: lng ?? undefined,
          customerIp: customerIp || undefined,
          customerUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined,
          customerCity: city.trim() || undefined,
          distanceFromRestaurantKm,
        } : undefined,
        branchId: effectiveBranchId || undefined,
      };
      const tenantId = getTenantId();
      if (!tenantId) throw new Error('Restaurant link is missing');
      const submitted = await submitPublicOrder({ data: {
        tenantId,
        branchId: effectiveBranchId,
        order: order as unknown as Record<string, unknown>,
      } });
      order.id = submitted.id;
      order.orderNumber = submitted.order_number;
      saveOrder(order, { cloud: false });
      // Mark dine-in table as running so floor map turns red immediately
      if (dineIn && matchedTable && matchedTable.status === 'free') {
        try {
          saveTable({
            ...matchedTable,
            status: 'running',
            currentOrderId: orderId,
            seatedAt: matchedTable.seatedAt || new Date().toISOString(),
            seatedGuests: matchedTable.seatedGuests || matchedTable.seats || 1,
          });
        } catch {}
      }
      if (promoApplied?.code) incrementPromoUsage(promoApplied.code);
      // Auto-create / refresh local account so order history works (skip in dine-in QR mode)
      if (!dineIn && phone.trim()) {
        const prev: Partial<OnlineAccount> = findRegistry(phone.trim()) || account || {};
        const acc: OnlineAccount = {
          ...prev,
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim() || prev.address,
          city: city.trim() || prev.city,
          ...(fulfillment === 'delivery' && lat != null && lng != null ? (() => {
            const pLat = prev.lat, pLng = prev.lng;
            const shouldUpdate = pLat == null || pLng == null || (
              Math.hypot((pLat - lat) * 111, (pLng - lng) * 111 * Math.cos(lat * Math.PI / 180)) > 0.5
            );
            return shouldUpdate ? { lat, lng, locationCapturedAt: new Date().toISOString() } : {};
          })() : {}),
        };
        saveAccountLS(acc);
        upsertRegistry(acc);
        setAccount(acc);
      }
      setPlacedOrder(order);
      setCart([]);
      setPromoApplied(null);
      setPromoInput('');
      setCartOpen(false);
      toast.success(`Order #${order.orderNumber} placed!`);
      // Notify restaurant owner's WhatsApp (if configured)
      try {
        const ownerWa = normWaPhone(settings.ownerWhatsApp || settings.phone || '');
        if (ownerWa) {
          const msg = dineIn
            ? [
                `🍽 New Dine-In Order #${order.orderNumber}`,
                `Table: ${dineIn.table}${dineIn.floor ? ' · ' + dineIn.floor : ''}`,
                `Items: ${order.items.length}`,
                `Total: ${money(order.grandTotal)}`,
              ].join('\n')
            : [
                `🆕 New Website Order #${order.orderNumber}`,
                `Customer: ${name.trim()} (${phone.trim()})`,
                `Address: ${address.trim()}${city ? ', ' + city : ''}`,
                `Items: ${order.items.length}`,
                `Total: ${money(order.grandTotal)}`,
              ].join('\n');
          import('@/lib/whatsapp').then(({ addToPendingQueue }) => addToPendingQueue(ownerWa, msg, name.trim() || 'Customer'));
        }
      } catch {}
    } catch (e: any) {
      toast.error('Order fail: ' + e.message);
    } finally {
      setPlacing(false);
    }
  };

  // Success screen
  if (placedOrder) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl shadow-elegant border max-w-md w-full p-6 text-center space-y-4">
          <div className="h-16 w-16 mx-auto rounded-full bg-status-success/15 text-status-success flex items-center justify-center">
            <CheckCircle className="h-9 w-9" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">Order Confirmed!</h1>
            <p className="text-sm text-muted-foreground mt-1">Your order has been sent to the kitchen.</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-4 text-left space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Order #</span><span className="font-bold text-primary">#{placedOrder.orderNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="font-semibold">{placedOrder.items.length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-extrabold">{money(placedOrder.grandTotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-semibold">{placedOrder.customer?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="font-semibold">{placedOrder.customer?.phone}</span></div>
          </div>
          <p className="text-xs text-muted-foreground">Hum aap ko phone par confirmation ke liye contact karenge. Shukriya!</p>
          <a
            href={(() => {
              const last4 = (placedOrder.customer?.phone || '').replace(/\D/g, '').slice(-4);
              const t = (placedOrder as any).tableLabel ? `&t=${encodeURIComponent((placedOrder as any).tableLabel)}` : '';
              const tid = getTenantId();
              return `#/track${tid ? `/${encodeURIComponent(tid)}` : ''}?id=${encodeURIComponent(placedOrder.id)}&o=${placedOrder.orderNumber}${last4 ? `&p=${last4}` : ''}${t}`;
            })()}
            className="block w-full bg-gold text-foreground rounded-md py-2.5 text-sm font-extrabold"
          >
            📍 Track Live Order
          </a>
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white"
            onClick={() => {
              const wa = normWaPhone(placedOrder.customer?.phone || '');
              if (!wa) { toast.error('Phone missing'); return; }
              const last4 = (placedOrder.customer?.phone || '').replace(/\D/g, '').slice(-4);
              const t = (placedOrder as any).tableLabel ? `&t=${encodeURIComponent((placedOrder as any).tableLabel)}` : '';
              const tid = getTenantId();
              const trackUrl = `${window.location.origin}/#/track${tid ? `/${encodeURIComponent(tid)}` : ''}?id=${encodeURIComponent(placedOrder.id)}&o=${placedOrder.orderNumber}${last4 ? `&p=${last4}` : ''}${t}`;
              const msg = `Order #${placedOrder.orderNumber} confirmed!\nTotal: ${money(placedOrder.grandTotal)}\n\n📍 Live tracking:\n${trackUrl}`;
              openWhatsApp(wa, msg, placedOrder.customer?.name);
            }}
          >
            📱 Send Tracking Link on WhatsApp
          </Button>
          <Button className="w-full" variant="outline" onClick={() => setPlacedOrder(null)}>Place a new order</Button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-3">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-muted-foreground">Loading the menu…</p>
        </div>
      </div>
    );
  }

  if (settings.onlineOrderEnabled === false) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-6">
        <div className="max-w-md w-full bg-card border rounded-2xl p-6 text-center shadow-elegant">
          <div className="text-5xl mb-3">🔒</div>
          <h1 className="text-lg font-extrabold mb-1">{settings.name || 'Restaurant'}</h1>
          <p className="text-sm text-muted-foreground">Online ordering is temporarily closed. Please try again shortly or call us directly.</p>
          {settings.phone && <a href={`tel:${settings.phone}`} className="inline-block mt-3 text-sm font-bold text-primary">📞 {settings.phone}</a>}
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-background">
      <WhatsAppFloat />

      {/* Dine-in banner (QR scan) */}
      {dineIn && (
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white px-4 py-2.5 sticky top-0 z-50 shadow-md">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Utensils className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase opacity-90 leading-none">Dine-In Mode</div>
                <div className="font-extrabold text-sm truncate">{dineIn.table}{dineIn.floor ? ` · ${dineIn.floor}` : ''}</div>
              </div>
            </div>
            <button
              onClick={() => callWaiter()}
              disabled={callingWaiter}
              className="bg-white text-amber-700 px-3 py-1.5 rounded-full font-extrabold text-xs flex items-center gap-1.5 shadow-md hover:bg-white/90 disabled:opacity-60 animate-pulse"
            >
              <BellRing className="h-4 w-4" />
              {callingWaiter ? 'Calling…' : 'Call Waiter'}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 bg-gradient-hero text-primary-foreground shadow-elegant">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {(settings.webPortalLogo || settings.logo) && <img src={settings.webPortalLogo || settings.logo} alt="" className="h-9 w-9 rounded object-cover bg-white/10 p-0.5" />}
            <div className="min-w-0">
              <h1 className="text-base font-extrabold leading-tight truncate">{settings.name || 'Restaurant'}</h1>
              {branches.length > 1 ? (
                <button
                  onClick={() => setBranchPickerOpen(true)}
                  className="inline-flex items-center gap-1 text-[10px] opacity-90 hover:opacity-100 underline-offset-2 hover:underline truncate"
                >
                  <Store className="h-3 w-3" />
                  <span className="truncate">{currentBranch ? `${currentBranch.name}${currentBranch.city ? ' · ' + currentBranch.city : ''}` : 'Select branch'}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
              ) : (
                <p className="text-[10px] opacity-80 truncate">Online Ordering · Delivery</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {account ? (
              <Button variant="secondary" size="sm" onClick={() => setOrdersOpen(true)} className="h-8">
                <ClipboardList className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">My Orders</span>
                <span className="sm:hidden">Orders</span>
                {myOrders.length > 0 && (
                  <span className="ml-1 h-4 min-w-[16px] px-1 rounded-full bg-gold text-foreground text-[10px] font-extrabold flex items-center justify-center">{myOrders.length}</span>
                )}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setLoginOpen(true)} className="h-8">
                <LogIn className="h-4 w-4 mr-1" /> Login
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setCartOpen(true)} className="relative h-8">
              <ShoppingBag className="h-4 w-4 mr-1" />
              Cart
              {cart.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 h-5 min-w-[20px] px-1 rounded-full bg-gold text-foreground text-[10px] font-extrabold flex items-center justify-center">
                  {cart.reduce((s, c) => s + c.quantity, 0)}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Search + categories */}
        <div className="max-w-6xl mx-auto px-4 pb-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search menu…"
              className="h-8 pl-7 text-xs bg-background text-foreground"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pos-scrollbar -mx-1 px-1 pb-1">
            <CatChip active={activeCat === 'all'} onClick={() => setActiveCat('all')} label={`All (${menuItems.length})`} />
            {categories.map(c => {
              const n = menuItems.filter(m => m.categoryId === c.id).length;
              if (n === 0) return null;
              return <CatChip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)} label={`${c.name} (${n})`} />;
            })}
          </div>
        </div>
      </header>

      {/* Menu grid */}
      <main className="max-w-6xl mx-auto p-4">
        {visibleItems.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">No items found.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleItems.map(m => {
              const inCart = cart.find(c => c.menuItemId === m.id);
              const vi = variantInfo(m);
              return (
                <div key={m.id} className="bg-card rounded-xl border shadow-card overflow-hidden flex flex-col">
                  {m.image ? (
                    <img src={m.image} alt={m.name} className="w-full h-32 object-cover" />
                  ) : (
                    <div className="w-full h-32 bg-gradient-to-br from-primary/10 to-gold/10 flex items-center justify-center text-3xl">🍽️</div>
                  )}
                  <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                    <h3 className="text-xs font-bold leading-tight line-clamp-2">{m.name}</h3>
                    {vi.hasVariants && (
                      <p className="text-[9px] text-emerald-700 font-bold leading-tight">
                        📏 {vi.list.length} size{vi.list.length > 1 ? 's' : ''} — Select karein
                      </p>
                    )}
                    {m.flavors && m.flavors.length > 0 && (
                      <p className="text-[9px] text-primary/80 font-medium leading-tight">
                        {m.flavors.length} flavor{m.flavors.length > 1 ? 's' : ''} available
                      </p>
                    )}
                    {(() => {
                      const deal = getDeals().find(d => d.id === m.id);
                      if (!deal || !deal.items?.length) return null;
                      const allItems = getMenuItems();
                      return (
                        <p className="text-[9px] text-muted-foreground italic line-clamp-2 leading-tight">
                          🎁 {deal.items.map(di => `${di.quantity}× ${allItems.find(x => x.id === di.menuItemId)?.name || 'Item'}`).join(', ')}
                        </p>
                      );
                    })()}
                    <div className="mt-auto flex items-center justify-between">
                      <span className="text-sm font-extrabold text-primary">
                        {vi.hasVariants ? `From ${money(vi.minPrice)}` : `${money(m.price)}`}
                      </span>
                      {vi.hasVariants ? (
                        <Button size="sm" className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700" onClick={() => addItem(m)}>
                          <Plus className="h-3 w-3 mr-0.5" /> Select Size
                        </Button>
                      ) : inCart ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => updateQty(inCart.id, -1)}><Minus className="h-3 w-3" /></Button>
                          <span className="text-xs font-bold w-5 text-center">{inCart.quantity}</span>
                          <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => updateQty(inCart.id, 1)}><Plus className="h-3 w-3" /></Button>
                        </div>
                      ) : (
                        <Button size="sm" className="h-7 text-[11px]" onClick={() => addItem(m)}>
                          <Plus className="h-3 w-3 mr-0.5" /> Add
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating cart bar (mobile) */}
      {cart.length > 0 && !cartOpen && (
        <div className="fixed bottom-3 left-3 right-3 z-30 md:hidden">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full bg-primary text-primary-foreground rounded-xl px-4 py-3 flex items-center justify-between shadow-elegant"
          >
            <span className="flex items-center gap-2 text-sm font-bold">
              <ShoppingBag className="h-4 w-4" />
              {cart.reduce((s, c) => s + c.quantity, 0)} items
            </span>
            <span className="text-sm font-extrabold">{money(subtotal)} →</span>
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={() => setCartOpen(false)}>
          <div className="bg-background w-full max-w-md h-full overflow-y-auto pos-scrollbar shadow-elegant" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2"><ShoppingBag className="h-4 w-4" /> Your Cart</h2>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setCartOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            <div className="p-4 space-y-3">
              {cart.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-8">Cart is empty. Add items from the menu.</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {cart.map(c => {
                      const deal = getDeals().find(d => d.id === c.menuItemId);
                      return (
                      <div key={c.id} className="flex flex-col gap-1 bg-card border rounded-lg p-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold truncate">{c.name}</p>
                            {c.note && c.note.startsWith('Flavor: ') && (
                              <p className="text-[10px] text-primary font-medium truncate">{c.note}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground">{money(c.price)} × {c.quantity}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => updateQty(c.id, -1)}><Minus className="h-3 w-3" /></Button>
                            <span className="text-xs font-bold w-5 text-center">{c.quantity}</span>
                            <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => updateQty(c.id, 1)}><Plus className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => removeItem(c.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                          <span className="text-xs font-extrabold ml-1">{money(c.lineTotal)}</span>
                        </div>
                        {deal && deal.items?.length > 0 && (
                          <p className="text-[10px] text-muted-foreground italic pl-1 border-t pt-1">
                            🎁 Includes: {deal.items.map(di => `${di.quantity}× ${getMenuItems().find(m => m.id === di.menuItemId)?.name || 'Item'}`).join(', ')}
                          </p>
                        )}
                      </div>
                      );
                    })}
                  </div>

                  {/* Customer form */}
                  <div className="space-y-2 pt-2 border-t">
                    {dineIn ? (
                      <>
                        <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3 text-center">
                          <div className="text-xs font-bold uppercase text-amber-700">Dine-In Order</div>
                          <div className="text-base font-extrabold mt-0.5">{dineIn.table}{dineIn.floor ? ` · ${dineIn.floor}` : ''}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">The order goes straight to the kitchen and is served at the table</div>
                        </div>
                        <div className="relative">
                          <User className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input className="pl-7 h-9 text-xs" placeholder="Your Name (optional)" value={name} onChange={e => setName(e.target.value)} />
                        </div>
                      </>
                    ) : (
                      <>
                        {pickupOn && (
                          <>
                            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">How do you want it?</h3>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => setFulfillment('delivery')}
                                className={`p-3 rounded-xl border-2 text-left transition-all ${fulfillment === 'delivery' ? 'border-primary bg-primary/10 shadow-md' : 'border-border bg-card hover:border-primary/40'}`}
                              >
                                <div className="text-lg">🛵</div>
                                <div className="text-xs font-extrabold mt-0.5">Delivery</div>
                                <div className="text-[10px] text-muted-foreground">Ghar tak laayein</div>
                              </button>
                              <button
                                onClick={() => setFulfillment('pickup')}
                                className={`p-3 rounded-xl border-2 text-left transition-all ${fulfillment === 'pickup' ? 'border-primary bg-primary/10 shadow-md' : 'border-border bg-card hover:border-primary/40'}`}
                              >
                                <div className="text-lg">🏃</div>
                                <div className="text-xs font-extrabold mt-0.5">Self-Pickup</div>
                                <div className="text-[10px] text-muted-foreground">Collect it yourself</div>
                              </button>
                            </div>
                          </>
                        )}
                        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pt-1">
                          {fulfillment === 'pickup' ? 'Pickup Details' : 'Delivery Details'}
                        </h3>
                        <div className="relative">
                          <User className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input className="pl-7 h-9 text-xs" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} />
                        </div>
                        <div className="relative">
                          <Phone className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <Input className="pl-7 h-9 text-xs" placeholder="Mobile Number (03xx-xxxxxxx)" value={phone} onChange={e => setPhone(e.target.value)} />
                        </div>
                        {fulfillment === 'delivery' ? (
                          <>
                            <Input className="h-9 text-xs" placeholder="City" value={city} onChange={e => setCity(e.target.value)} />
                            <div className="relative">
                              <MapPin className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                              <Textarea className="pl-7 text-xs min-h-[60px]" placeholder="Full Address (street, area, landmark)" value={address} onChange={e => setAddress(e.target.value)} />
                            </div>
                            <Button
                              variant={lat ? 'default' : 'outline'}
                              size="sm"
                              className={`w-full text-xs ${!lat ? 'border-2 border-status-warning bg-status-warning/10 hover:bg-status-warning/20 text-status-warning font-bold' : 'bg-status-success hover:bg-status-success/90 text-white'}`}
                              onClick={captureLocation}
                              disabled={locating}
                            >
                              <MapPin className="h-3.5 w-3.5 mr-1" />
                              {locating ? 'Detecting…' : lat ? `✓ Location captured (${lat.toFixed(4)}, ${lng?.toFixed(4)})` : '📍 Share Live Location (REQUIRED)'}
                            </Button>
                            {!lat && (
                              <p className="text-[10px] text-status-warning text-center">
                                ⚠ Delivery ke liye location share karna zaroori hai
                              </p>
                            )}

                            {/* Live service-area map (customer + restaurant + radius) */}
                            {serviceArea.branchHasGeo && (
                              <div className="space-y-1">
                                <div className="rounded-md overflow-hidden border">
                                  <LeafletMap
                                    height={180}
                                    zoom={13}
                                    markers={[
                                      { id: 'br', lat: serviceArea.branchLat, lng: serviceArea.branchLng, title: currentBranch?.name || 'Restaurant', color: 'blue', popupHtml: `<b>🏪 ${currentBranch?.name || 'Restaurant'}</b>` },
                                      ...(serviceArea.customerHasGeo ? [{ id: 'cu', lat: lat!, lng: lng!, title: 'You', color: 'orange' as const, popupHtml: '<b>📍 Your location</b>' }] : []),
                                    ]}
                                    circles={serviceArea.hasRadius ? [{
                                      id: 'svc', lat: serviceArea.branchLat, lng: serviceArea.branchLng,
                                      radiusM: serviceArea.radiusKm * 1000,
                                      color: serviceArea.inRadius ? '#16a34a' : '#dc2626',
                                      fillColor: serviceArea.inRadius ? '#16a34a' : '#dc2626',
                                      fillOpacity: 0.1,
                                    }] : []}
                                    polylines={serviceArea.customerHasGeo ? [{
                                      id: 'line', points: [[serviceArea.branchLat, serviceArea.branchLng], [lat!, lng!]],
                                      color: serviceArea.inRadius ? '#16a34a' : '#dc2626', weight: 3, dashed: true, opacity: 0.8,
                                    }] : []}
                                  />
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                                  {serviceArea.hasRadius && (
                                    <span className="text-muted-foreground">Service radius: <b className="text-foreground">{serviceArea.radiusKm} km</b></span>
                                  )}
                                  {serviceArea.distanceKm != null && (
                                    <span className={serviceArea.inRadius ? 'text-status-success font-bold' : 'text-destructive font-bold'}>
                                      Distance: {serviceArea.distanceKm} km
                                    </span>
                                  )}
                                </div>
                                {serviceArea.hasRadius && serviceArea.customerHasGeo && !serviceArea.inRadius && (
                                  <div className="animate-pulse text-[11px] font-extrabold text-destructive bg-destructive/10 border-2 border-destructive/40 rounded-lg px-2 py-1.5 text-center">
                                    ⛔ Out of service radius — mazrat, aap humare delivery area se bahar hain
                                  </div>
                                )}
                                {serviceArea.hasRadius && serviceArea.customerHasGeo && serviceArea.inRadius && (
                                  <div className="text-[11px] font-bold text-status-success bg-status-success/10 border border-status-success/30 rounded-lg px-2 py-1 text-center">
                                    ✓ Aap humare service area ke andar hain
                                  </div>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-[11px] font-bold text-muted-foreground">Pickup in:</label>
                            <div className="grid grid-cols-4 gap-1.5">
                              {slots.map(min => (
                                <button
                                  key={min}
                                  onClick={() => setPickupSlot(min)}
                                  className={`py-2 rounded-lg border-2 text-xs font-extrabold transition-all ${pickupSlot === min ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/40'}`}
                                >
                                  {min}<span className="text-[9px] opacity-70 block leading-none mt-0.5">min</span>
                                </button>
                              ))}
                            </div>
                            {pickupSlot && (
                              <div className="text-[11px] text-status-success font-bold bg-status-success/10 rounded-lg p-2 text-center">
                                ✓ {pickupSlot} minute baad counter se collect karein
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    <Textarea className="text-xs min-h-[40px]" placeholder="Order notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
                  </div>


                  {/* Promo */}
                  <div className="space-y-1 pt-2 border-t">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Promo Code</h3>
                    {promoApplied ? (
                      <div className="flex items-center justify-between bg-status-success/10 border border-status-success/30 rounded-lg px-2 py-1.5">
                        <span className="text-xs font-bold text-status-success flex items-center gap-1"><Tag className="h-3 w-3" /> {promoApplied.code} — {money(promoApplied.discount)} off</span>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setPromoApplied(null); setPromoInput(''); }}><X className="h-3 w-3" /></Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Input className="h-8 text-xs" placeholder="Promo code" value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())} />
                        <Button size="sm" variant="outline" onClick={applyPromo}>Apply</Button>
                      </div>
                    )}
                  </div>

                  {/* Totals */}
                  <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-semibold">{money(subtotal)}</span></div>
                    {promoDiscount > 0 && <div className="flex justify-between text-status-success"><span>Promo Discount</span><span>-{money(promoDiscount)}</span></div>}
                    {deliveryCharge > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span className="font-semibold">{money(deliveryCharge)}</span></div>}
                    <div className="flex justify-between text-sm font-extrabold border-t pt-1.5 mt-1"><span>Total</span><span className="text-primary">{money(grandTotal)}</span></div>
                    {minOrder > 0 && subtotal < minOrder && (
                      <p className="text-[10px] text-status-warning mt-1">⚠ Minimum order {money(minOrder)} — {money((minOrder - subtotal))} more to go</p>
                    )}
                  </div>

                  <Button
                    className="w-full h-11 text-sm font-bold"
                    onClick={placeOrder}
                    disabled={
                      placing
                      || (!dineIn && minOrder > 0 && subtotal < minOrder)
                      || (!dineIn && fulfillment === 'delivery' && (lat == null || lng == null))
                      || (!dineIn && fulfillment === 'delivery' && serviceArea.hasRadius && serviceArea.customerHasGeo && !serviceArea.inRadius)
                    }
                  >
                    {placing
                      ? 'Placing…'
                      : dineIn
                        ? `🍽 Send to Kitchen · ${money(grandTotal)}`
                        : fulfillment === 'delivery' && lat == null
                          ? '📍 Share Location to Continue'
                          : fulfillment === 'delivery' && serviceArea.hasRadius && serviceArea.customerHasGeo && !serviceArea.inRadius
                            ? '⛔ Out of Service Area'
                            : `Place Order · ${money(grandTotal)}`}
                  </Button>
                  {dineIn ? (
                    <button
                      onClick={() => callWaiter('Need waiter at ' + dineIn.table)}
                      disabled={callingWaiter}
                      className="w-full mt-1 py-2 rounded-md bg-amber-500/10 text-amber-700 border-2 border-amber-500/40 text-xs font-bold flex items-center justify-center gap-1 hover:bg-amber-500/20 disabled:opacity-60"
                    >
                      <BellRing className="h-3.5 w-3.5" /> Call Waiter
                    </button>
                  ) : (
                    <p className="text-[10px] text-center text-muted-foreground">Cash on Delivery available</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Branch picker modal */}
      {branchPickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => currentBranch && setBranchPickerOpen(false)}>
          <div className="bg-card border rounded-2xl shadow-elegant w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold flex items-center gap-2"><Store className="h-4 w-4 text-primary" /> Select Your Branch</h2>
              {currentBranch && (
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setBranchPickerOpen(false)}><X className="h-4 w-4" /></Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Choose your nearest branch or area. The order goes to that branch.</p>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                autoFocus
                value={branchSearch}
                onChange={e => setBranchSearch(e.target.value)}
                placeholder="Search by area, city, or branch name…"
                className="h-9 pl-7 text-xs"
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto pos-scrollbar -mx-1 px-1 space-y-1.5">
              {filteredBranches.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-6">No branches found.</p>
              ) : filteredBranches.map(b => {
                const active = b.id === branchId;
                return (
                  <button
                    key={b.id}
                    onClick={() => pickBranch(b.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${active ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border hover:border-primary/50 hover:bg-muted/40'}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                        <Store className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold truncate">{b.name}</p>
                          {active && <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </div>
                        {b.city && <p className="text-[11px] text-muted-foreground truncate">📍 {b.city}</p>}
                        {b.address && <p className="text-[10px] text-muted-foreground truncate">{b.address}</p>}
                        {b.phone && <p className="text-[10px] text-muted-foreground truncate">📞 {b.phone}</p>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Login modal — 3-step: phone → PIN (existing) OR signup (new) */}
      {loginOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => { setLoginOpen(false); setLoginMode('phone'); }}>
          <div className="bg-card border-2 border-primary/30 rounded-3xl shadow-elegant w-full max-w-sm p-5 space-y-3 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold flex items-center gap-2">
                <LogIn className="h-4 w-4 text-primary" />
                {loginMode === 'phone' ? 'Login / Sign Up' : loginMode === 'pin' ? 'Enter PIN' : 'Create Account'}
              </h2>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setLoginOpen(false); setLoginMode('phone'); }}><X className="h-4 w-4" /></Button>
            </div>

            {loginMode === 'phone' && (
              <>
                <p className="text-[11px] text-muted-foreground">Enter your mobile number — for a new account or to log back in.</p>
                <Input placeholder="Mobile Number (03xx-xxxxxxx)" value={loginPhone} onChange={e => setLoginPhone(e.target.value)} className="h-10 text-sm" inputMode="numeric" />
                <Button
                  className="w-full h-10"
                  onClick={() => {
                    if (normalizePhone(loginPhone).length < 10) { toast.error('Valid number'); return; }
                    const found = findRegistry(loginPhone);
                    if (found && found.pin) {
                      setExistingAccount(found);
                      setLoginMode('pin');
                    } else {
                      setLoginMode('signup');
                      if (found?.name) setLoginName(found.name);
                    }
                  }}
                >
                  Continue →
                </Button>
              </>
            )}

            {loginMode === 'pin' && existingAccount && (
              <>
                <p className="text-[11px] text-muted-foreground">Welcome back, <b>{existingAccount.name}</b>! Enter your 4-digit PIN.</p>
                <Input
                  placeholder="••••"
                  value={loginPin}
                  onChange={e => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="h-12 text-center text-2xl tracking-[0.5em] font-bold"
                  inputMode="numeric"
                  type="password"
                  maxLength={4}
                  autoFocus
                />
                <Button
                  className="w-full h-10"
                  onClick={async () => {
                    if (loginPin.length !== 4) { toast.error('4-digit PIN'); return; }
                    const h = await hashPin(loginPin);
                    if (h !== existingAccount.pin) { toast.error('Galat PIN'); setLoginPin(''); return; }
                    saveAccountLS(existingAccount);
                    setAccount(existingAccount);
                    setName(existingAccount.name); setPhone(existingAccount.phone);
                    if (existingAccount.address) setAddress(existingAccount.address);
                    if (existingAccount.city) setCity(existingAccount.city);
                    if (existingAccount.lat != null) setLat(existingAccount.lat);
                    if (existingAccount.lng != null) setLng(existingAccount.lng);
                    setLoginOpen(false); setLoginMode('phone');
                    setLoginName(''); setLoginPhone(''); setLoginPin(''); setLoginGender('');
                    toast.success(`Welcome back, ${existingAccount.name}!`);
                  }}
                >
                  Login
                </Button>
                <button className="text-[11px] text-primary underline w-full text-center" onClick={() => setLoginMode('phone')}>← Change number</button>
              </>
            )}

            {loginMode === 'signup' && (
              <>
                <p className="text-[11px] text-muted-foreground">Create an account. Your details are saved for next time.</p>
                <Input placeholder="Full Name" value={loginName} onChange={e => setLoginName(e.target.value)} className="h-10 text-sm" />
                <Input placeholder="Mobile Number" value={loginPhone} onChange={e => setLoginPhone(e.target.value)} className="h-10 text-sm" inputMode="numeric" disabled />
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Gender</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {(['male', 'female'] as const).map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setLoginGender(g)}
                        className={`h-10 rounded-xl border-2 font-bold text-xs transition-all ${
                          loginGender === g ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:border-primary/50'
                        }`}
                      >
                        {g === 'male' ? '👨 Male' : '👩 Female'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-muted-foreground">Create 4-digit PIN</label>
                  <Input
                    placeholder="••••"
                    value={loginPin}
                    onChange={e => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="h-12 text-center text-2xl tracking-[0.5em] font-bold mt-1"
                    inputMode="numeric"
                    type="password"
                    maxLength={4}
                  />
                </div>
                <Button
                  className="w-full h-10"
                  onClick={async () => {
                    if (!loginName.trim()) { toast.error('Naam likhein'); return; }
                    if (!loginGender) { toast.error('Select a gender'); return; }
                    if (loginPin.length !== 4) { toast.error('Create a 4-digit PIN'); return; }
                    const pinHash = await hashPin(loginPin);
                    const acc: OnlineAccount = {
                      name: loginName.trim(),
                      phone: loginPhone.trim(),
                      pin: pinHash,
                      gender: loginGender,
                    };
                    upsertRegistry(acc);
                    saveAccountLS(acc);
                    setAccount(acc);
                    setName(acc.name); setPhone(acc.phone);
                    setLoginOpen(false); setLoginMode('phone');
                    setLoginName(''); setLoginPhone(''); setLoginPin(''); setLoginGender('');
                    toast.success('Account created! Welcome 🎉');
                  }}
                >
                  Create Account
                </Button>
                <button className="text-[11px] text-primary underline w-full text-center" onClick={() => setLoginMode('phone')}>← Back</button>
              </>
            )}
          </div>
        </div>
      )}


      {/* My Orders modal */}
      {ordersOpen && account && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={() => setOrdersOpen(false)}>
          <div className="bg-background w-full max-w-md h-full overflow-y-auto pos-scrollbar shadow-elegant" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOrdersOpen(false)}><ArrowLeft className="h-4 w-4" /></Button>
                <div className="min-w-0">
                  <h2 className="text-sm font-extrabold truncate">My Orders</h2>
                  <p className="text-[10px] text-muted-foreground truncate">{account.name} · {account.phone}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => { saveAccountLS(null); setAccount(null); setOrdersOpen(false); toast.success('Logged out'); }}>
                <LogOut className="h-3.5 w-3.5 mr-1" /> Logout
              </Button>
            </div>
            <div className="p-3 space-y-2">
              {myOrders.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground py-12">No orders yet. Place your first order!</p>
              ) : myOrders.map(o => {
                const st = o.deliveryStatus || 'pending';
                const stColor = st === 'delivered' ? 'bg-status-success/15 text-status-success'
                  : st === 'cancelled' ? 'bg-destructive/15 text-destructive'
                  : st === 'onway' || st === 'rider_picked' ? 'bg-blue-500/15 text-blue-600'
                  : st === 'ready' ? 'bg-gold/30 text-foreground'
                  : 'bg-muted text-muted-foreground';
                return (
                  <div key={o.id} className="bg-card border rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-extrabold text-primary">#{o.orderNumber}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${stColor}`}>{st.replace('_', ' ')}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {new Date(o.createdAt).toLocaleString()}
                    </div>
                    <div className="text-[11px]">
                      {o.items.slice(0, 3).map(i => `${i.name} ×${i.quantity}`).join(', ')}
                      {o.items.length > 3 && ` +${o.items.length - 3} more`}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t">
                      <span className="text-[10px] text-muted-foreground">{o.items.length} items</span>
                      <span className="text-sm font-extrabold">{money(o.grandTotal)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Flavor picker — single-select with checkbox-style cards */}
      <Dialog open={!!flavorPick} onOpenChange={(o) => { if (!o) setFlavorPick(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {flavorPick?.item.name} — Flavor select karein
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-[11px] text-muted-foreground">Only one flavour can be chosen.</p>
            <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto">
              {(flavorPick?.item.flavors || []).map(f => {
                const active = flavorPick?.flavor === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => flavorPick && setFlavorPick({ ...flavorPick, flavor: f })}
                    className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-left transition-smooth ${
                      active
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card hover:border-primary/40'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 ${
                        active ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
                      }`}
                    >
                      {active && <CheckCircle className="h-3 w-3" />}
                    </span>
                    <span className="text-xs font-medium">{f}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setFlavorPick(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmFlavor} disabled={!flavorPick?.flavor}>
              <Plus className="h-3 w-3 mr-1" /> Add to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Size / Inch variant picker — same UX as POS */}
      <Dialog open={!!variantPick} onOpenChange={(o) => { if (!o) setVariantPick(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {variantPick?.item.name} — {variantPick?.kind === 'inch' ? 'Inch' : 'Size'} select karein
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-[11px] text-muted-foreground">Choose your size — the price adjusts accordingly.</p>
            <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto">
              {(() => {
                if (!variantPick) return null;
                const list = variantPick.kind === 'size'
                  ? (variantPick.item.sizeVariants || [])
                  : (variantPick.item.inchVariants || []);
                return list.filter(v => v && v.name && Number(v.price) > 0).map(v => {
                  const active = variantPick.selected?.name === v.name;
                  return (
                    <button
                      key={v.name}
                      type="button"
                      onClick={() => setVariantPick({ ...variantPick, selected: { name: v.name, price: v.price } })}
                      className={`flex items-center justify-between gap-2 rounded-lg border-2 px-3 py-2.5 text-left transition-smooth ${
                        active ? 'border-emerald-600 bg-emerald-50' : 'border-border bg-card hover:border-emerald-400'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? 'border-emerald-600 bg-emerald-600' : 'border-muted-foreground/40'}`}>
                          {active && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                        <span className="text-sm font-bold">{v.name}</span>
                      </div>
                      <span className="text-sm font-extrabold text-emerald-700">{money(v.price)}</span>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setVariantPick(null)}>Cancel</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={confirmVariant} disabled={!variantPick?.selected}>
              <Plus className="h-3 w-3 mr-1" /> Add to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CatChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-smooth border ${
        active
          ? 'bg-white text-primary border-white shadow-card'
          : 'bg-white/10 text-primary-foreground border-white/20 hover:bg-white/20'
      }`}
    >
      {label}
    </button>
  );
}
