import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { money } from '@/lib/currency';
import { releasedTable } from '@/lib/tableRelease';
import { sortOrdersNewestFirst, liveOrdersForTable } from '@/lib/orderOrder';
import { Search, Plus, Minus, Trash2, CreditCard, Pause, Weight, Edit3, ShoppingCart, RotateCcw, Delete, User, Phone, Ban, Gift, XCircle, ChefHat, MessageCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { normalizePhone, buildPaidMessage, buildDeliveryMessage, openWhatsApp } from '@/lib/whatsapp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Category, MenuItem, CartItem, OrderType, Order, PaymentMethod,
} from '@/lib/types';
import {
  getCategories, getMenuItems, getSettings, getOrders,
  saveOrder, genId, getNextOrderNumber, getNextOrderNumberAsync, peekNextOrderNumber, getTables, saveTable, getWaiters, getRiders, getUsers,
  getCurrentBranchId, getBranches, validatePromoCode, incrementPromoUsage
} from '@/lib/store';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import ManagerAuthDialog from '@/components/ManagerAuthDialog';
import TokenSlip from '@/components/TokenSlip';
import { featureActive } from '@/lib/optionalModules';
import ReceiptPreview from '@/components/ReceiptPreview';
import CachedImage from '@/components/CachedImage';
import KitchenReceipt from '@/components/KitchenReceipt';
import { useSearchParams } from '@/lib/hash-router';
import { getProvinces, getCitiesOf, getAreasOf } from '@/lib/pakistan-areas';
import { getDeals } from '@/lib/blink-modules';
import CustomerAutocomplete from '@/components/CustomerAutocomplete';
import LocationCapture from '@/components/LocationCapture';
// Phase-1: lazy-load PaymentDialog (heavy child — only mounted on checkout)
const PaymentDialog = lazy(() => import('@/components/PaymentDialog'));
import { enqueueKot, enqueueReceipt, enqueueKotUpdate, enqueueKotCancel, computeKotDiff, enqueueKotByPolicy } from '@/lib/printQueue';
import BillingStatusBar from '@/components/BillingStatusBar';
import { useRestrictedAction } from '@/components/RestrictedActionGate';
import { logStaffAction } from '@/lib/staffAudit';
import { computeBillTotals } from '@/lib/taxEngine';
import { primaryAddress } from '@/lib/customerAddress';

const DEALS_CATEGORY_ID = 'cat-deals';

function buildDealNote(dealId: string, allItems: MenuItem[]): string {
  const deal = getDeals().find(d => d.id === dealId);
  if (!deal) return '';
  return deal.items
    .map(di => `${di.quantity}× ${allItems.find(m => m.id === di.menuItemId)?.name || 'Item'}`)
    .join(', ');
}

export default function POSScreen() {
  const [categories, setCategories] = useState<Category[]>([]);
  const catRibbonRef = useRef<HTMLDivElement | null>(null);
  const scrollCatRibbon = (dir: 'left' | 'right') => {
    const el = catRibbonRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -el.clientWidth * 0.7 : el.clientWidth * 0.7, behavior: 'smooth' });
  };
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>('dining');
  const [discount, setDiscount] = useState(0);
  const [discountMode, setDiscountMode] = useState<'pkr' | 'percent'>('pkr');
  const [discountPercentInput, setDiscountPercentInput] = useState(0);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoApplied, setPromoApplied] = useState<{ code: string; discount: number } | null>(null);
  const [showCustomerReceipt, setShowCustomerReceipt] = useState(false);
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [showDiningDialog, setShowDiningDialog] = useState(false);
  const [selectedTable, setSelectedTable] = useState('');
  const [selectedWaiter, setSelectedWaiter] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [showKitchenReceipt, setShowKitchenReceipt] = useState(false);
  const [pendingKitchenReceipt, setPendingKitchenReceipt] = useState(false);
  const [showDeliveryDialog, setShowDeliveryDialog] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custLat, setCustLat] = useState<number | undefined>();
  const [custLng, setCustLng] = useState<number | undefined>();
  const [custLocAt, setCustLocAt] = useState<string | undefined>();
  const [custProvince, setCustProvince] = useState('Punjab');
  const [custCity, setCustCity] = useState('');
  const [custArea, setCustArea] = useState('');
  const [selectedRider, setSelectedRider] = useState('');
  // Special Note (Kitchen instructions, e.g. "no onion", "extra spicy") — prints on KOT.
  const [specialNote, setSpecialNote] = useState('');

  // ===== Advanced Menu Flow state =====
  /** When set, show that flavor/sub-category's items only. null = show flavor grid (advanced flow only). */
  const [selectedFlavor, setSelectedFlavor] = useState<string | null>(null);
  /** Item currently being configured in the Size/Inch picker. */
  const [variantPickerItem, setVariantPickerItem] = useState<MenuItem | null>(null);




  // Inline numpad state
  const [numpadValue, setNumpadValue] = useState('');
  const [numpadTarget, setNumpadTarget] = useState<'price' | 'weight' | null>(null);
  const [numpadItem, setNumpadItem] = useState<MenuItem | null>(null);
  const [weightUnit, setWeightUnit] = useState<'KG' | 'Gram' | 'Pao'>('KG');

  // Payment - integrated (no separate dialog)
  const [paymentReceived, setPaymentReceived] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentAccountId, setPaymentAccountId] = useState<string | undefined>();
  const [paymentAccountName, setPaymentAccountName] = useState<string | undefined>();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  // Retrieve/edit
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [showRunningBills, setShowRunningBills] = useState(false);
  const [runningBills, setRunningBills] = useState<Order[]>([]);
  // ===== Duplicate order guard =====
  // Prevents rapid double-click / network-lag double-submit from creating two
  // identical orders. Locked while processOrder is in flight. We also keep a
  // short-lived signature lock so identical retries within 4 s are rejected.
  const orderSubmitLockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [billSearch, setBillSearch] = useState('');

  // Selected cart item
  const [selectedCartItem, setSelectedCartItem] = useState<string | null>(null);

  // Void/Comp dialogs
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidType, setVoidType] = useState<'void' | 'complimentary' | 'cancel'>('void');
  const [compName, setCompName] = useState('');
  const [compPhone, setCompPhone] = useState('');

  // Credit dialog
  const [showCreditDialog, setShowCreditDialog] = useState(false);
  const [creditName, setCreditName] = useState('');
  const [creditPhone, setCreditPhone] = useState('');
  const [creditAddress, setCreditAddress] = useState('');

  const settings = useMemo(() => getSettings(), []);
  // Order Taker = create-only mode (no billing / payment / credit / void)
  const isOrderTaker = useMemo(() => (localStorage.getItem('pos-user-role') || '') === 'order_taker', []);
  // Manager-approval gate for money-touching actions (payment / void / discount…)
  const { guard: guardAction, dialog: managerGateDialog } = useRestrictedAction();
  /** Table label for the audit trail (empty for takeaway/delivery). */
  const tableObjName = () => {
    try { return tables.find(t => t.id === selectedTable)?.name; } catch { return undefined; }
  };
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    setCategories(getCategories());
    setMenuItems(getMenuItems());
  }, []);

  // Pick correct discount mode based on enabled flags (admin can disable Rs or %)
  useEffect(() => {
    const pkrOn = settings.pkrDiscountEnabled !== false;
    const pctOn = settings.percentDiscountEnabled !== false;
    if (!pkrOn && pctOn && discountMode === 'pkr') { setDiscountMode('percent'); setDiscount(0); }
    else if (!pctOn && pkrOn && discountMode === 'percent') { setDiscountMode('pkr'); setDiscountPercentInput(0); }
  }, [settings.pkrDiscountEnabled, settings.percentDiscountEnabled, discountMode]);

  useEffect(() => {
    const retrieveParam = searchParams.get('retrieve');

    // ===== v1.3.3 FIX — "Kitchen dobara table/waiter maangta hai" =====
    // Tables page free table par click karne par POS ko `/?table=<id>&guests=<n>`
    // bhejta hai, lekin POS is param ko parhta hi NAHI tha. Nateeja: cashier
    // table select kar ke items daalta, aur Kitchen dabate hi table + waiter
    // dobara maanga jata tha. Ab table pehle hi se select ho jata hai.
    const tableParam = searchParams.get('table');
    if (tableParam) {
      const t = getTables().find(x => x.id === tableParam);
      if (t) {
        setOrderType('dining');
        setSelectedTable(t.id);
        // If that table already has a live bill, continue it instead of
        // starting a second one on the same table.
        // v1.15.2 — newest live bill, deterministically. `.find()` on the
        // unsorted cache could return a different bill between renders, which
        // is what made one order look like two.
        const liveAll = liveOrdersForTable(getOrders(), t.id);
        const live = liveAll[0];
        if (liveAll.length > 1) {
          toast.warning(`${t.name} has ${liveAll.length} live bills — opened the newest. Settle the older one from Retrieve.`);
        }
        if (live) {
          setCart(live.items);
          setDiscount(live.discount || 0);
          setEditingOrderId(live.id);
          if (live.waiterId) setSelectedWaiter(live.waiterId);
          toast.info(`Opened the running bill for ${t.name}`);
        } else {
          toast.success(`${t.name} selected — add items`);
        }
      }
      setSearchParams({}, { replace: true });
      return;
    }

    if (retrieveParam === 'open') {
      setRunningBills(sortOrdersNewestFirst(getOrders().filter(o => o.status === 'running' || o.status === 'hold')));
      setBillSearch('');
      setShowRunningBills(true);
      setSearchParams({}, { replace: true });
      return;
    }

    if (retrieveParam) {
      const order = getOrders().find(
        o => o.id === retrieveParam && (o.status === 'running' || o.status === 'hold')
      );

      if (order) {
        setCart(order.items);
        setDiscount(order.discount);
        setOrderType(order.orderType);
        setEditingOrderId(order.id);
        if (order.tableId) setSelectedTable(order.tableId);
        if (order.waiterId) setSelectedWaiter(order.waiterId);
        if (order.customer) {
          setCustName(order.customer.name);
          setCustPhone(order.customer.phone);
          setCustAddress(order.customer.address);
        }
        setSpecialNote(order.notes || '');
        toast.info(`Editing Order #${order.orderNumber}`);
      }


      setSearchParams({}, { replace: true });
    }

    // Smart Customer DB: preload customer from URL (?customer=<phone>)
    const customerParam = searchParams.get('customer');
    if (customerParam) {
      import('@/lib/store').then(({ findCustomerByPhone }) => {
        const c = findCustomerByPhone(customerParam);
        if (c) {
          setCustName(c.name || '');
          setCustPhone(c.phone || '');
          setCustAddress(primaryAddress(c));
          setOrderType('delivery');
          toast.success(`Customer loaded: ${c.name}`);
        }
        setSearchParams({}, { replace: true });
      });
    }
  }, [searchParams, setSearchParams]);

  const refreshTables = () => getTables();
  const refreshWaiters = () => getWaiters();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('pos-search')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Items inside the currently selected category (used for both flavor grid and items grid)
  const categoryItems = useMemo(() => {
    return menuItems.filter(item => {
      if (!item.isActive) return false;
      if (selectedCat !== 'all' && item.categoryId !== selectedCat) return false;
      if (search) {
        // v1.9.1 — barcode-aware search. A USB barcode scanner behaves like a
        // keyboard: it types the code then presses Enter. Matching the code
        // here means scanning "just works" in the existing search box, with
        // no separate scanner mode to switch into.
        const q = search.toLowerCase().trim();
        const nameHit = item.name.toLowerCase().includes(q);
        const codeHit = !!item.barcode && item.barcode.toLowerCase() === q;
        if (!nameHit && !codeHit) return false;
      }
      return true;
    });
  }, [menuItems, selectedCat, search]);

  // ===== Advanced Menu Flow gating =====
  // Flavor layer is shown only when:
  //  - advancedMenuFlow + enableFlavorLayer both ON
  //  - a real category is selected (not "all")
  //  - that category contains at least one item with a non-empty subCategory
  //  - user hasn't already drilled into a flavor
  //  - user isn't searching (search bypasses the flavor layer for speed)
  const flavorList = useMemo(() => {
    if (!settings.advancedMenuFlow || !settings.enableFlavorLayer) return [];
    if (selectedCat === 'all' || search.trim()) return [];
    const set = new Set<string>();
    for (const it of categoryItems) {
      const f = (it.subCategory || it.flavorGroup || '').trim();
      if (f) set.add(f);
    }
    return Array.from(set);
  }, [categoryItems, settings.advancedMenuFlow, settings.enableFlavorLayer, selectedCat, search]);

  const showFlavorGrid = flavorList.length > 0 && selectedFlavor == null;

  const filteredItems = useMemo(() => {
    if (showFlavorGrid) return [];
    if (selectedFlavor) {
      return categoryItems.filter(it => (it.subCategory || it.flavorGroup || '').trim() === selectedFlavor);
    }
    return categoryItems;
  }, [categoryItems, showFlavorGrid, selectedFlavor]);

  // Hot-path indexes: cart changes should not make every product card scan the
  // entire cart/menu again. These maps keep rush-hour taps effectively O(1).
  const cartByMenuItem = useMemo(() => {
    const out = new Map<string, CartItem>();
    for (const line of cart) if (!line.variantName && !out.has(line.menuItemId)) out.set(line.menuItemId, line);
    return out;
  }, [cart]);
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const menuItemById = useMemo(() => new Map(menuItems.map(item => [item.id, item])), [menuItems]);
  const dealsById = useMemo(() => new Map(getDeals().map(deal => [deal.id, deal])), [menuItems]);

  // Reset drill-in when category changes
  useEffect(() => { setSelectedFlavor(null); }, [selectedCat]);

  /** Helper: does this item need a Size/Inch picker dialog? */
  const itemHasVariants = (item: MenuItem) =>
    (item.pricingType === 'size' || item.pricingType === 'inch' || item.pricingType === 'both') &&
    ((item.sizeVariants && item.sizeVariants.length > 0) || (item.inchVariants && item.inchVariants.length > 0));

  /** Add a configured variant to cart. */
  const addVariantToCart = useCallback((item: MenuItem, variant: { name: string; price: number; type: 'size' | 'inch' }) => {
    const displayName = `${item.name} - ${variant.name}`;
    setCart(prev => {
      // Treat same item+variant as same line (qty++)
      const existing = prev.find(c => c.menuItemId === item.id && c.variantName === variant.name && c.variantType === variant.type);
      if (existing) {
        return prev.map(c => c === existing
          ? { ...c, quantity: c.quantity + 1, lineTotal: (c.quantity + 1) * c.price }
          : c
        );
      }
      return [...prev, {
        id: genId(), menuItemId: item.id, name: displayName,
        pricingType: 'fixed' as any, price: variant.price,
        quantity: 1, lineTotal: variant.price,
        note: '',
        variantType: variant.type,
        variantName: variant.name,
      }];
    });
  }, []);

  const addToCart = useCallback((item: MenuItem) => {
    if (item.pricingType === 'weight') {
      setNumpadItem(item);
      setNumpadTarget('weight');
      setNumpadValue('');
      setWeightUnit('KG');
      return;
    }
    if (item.pricingType === 'manual') {
      setNumpadItem(item);
      setNumpadTarget('price');
      setNumpadValue('');
      return;
    }
    if (itemHasVariants(item)) {
      setVariantPickerItem(item);
      return;
    }
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id && !c.variantName);
      if (existing) {
        return prev.map(c => c.menuItemId === item.id && !c.variantName
          ? { ...c, quantity: c.quantity + 1, lineTotal: (c.quantity + 1) * c.price }
          : c
        );
      }
      return [...prev, {
        id: genId(), menuItemId: item.id, name: item.name,
        pricingType: item.pricingType, price: item.price,
        quantity: 1, lineTotal: item.price,
        note: item.categoryId === DEALS_CATEGORY_ID ? buildDealNote(item.id, menuItems) : ''
      }];
    });
  }, [menuItems]);

  // Numpad mode for selected cart item
  const [numpadCartMode, setNumpadCartMode] = useState<'qty' | 'price'>('qty');

  // Numpad key handler
  const handleNumpadKey = (key: string) => {
    if (key === 'CLR') { setNumpadValue(''); return; }
    if (key === '⌫') { setNumpadValue(v => v.slice(0, -1)); return; }
    if (key === '.' && numpadValue.includes('.')) return;
    setNumpadValue(v => v + key);
  };

  const applyNumpadValue = () => {
    const val = parseFloat(numpadValue);
    if (isNaN(val) || val <= 0) { toast.error('Enter a valid number'); return; }

    if (numpadTarget === 'weight' && numpadItem) {
      let kgValue = val;
      if (weightUnit === 'Gram') kgValue = val / 1000;
      if (weightUnit === 'Pao') kgValue = val * 0.25;
      const grams = Math.round(kgValue * 1000);
      const price = Math.round(kgValue * numpadItem.ratePerKg);
      setCart(prev => [...prev, {
        id: genId(), menuItemId: numpadItem.id, name: numpadItem.name,
        pricingType: 'weight', price, quantity: 1,
        weightGrams: grams, lineTotal: price, note: `${kgValue.toFixed(2)} KG`
      }]);
    } else if (numpadTarget === 'price' && numpadItem) {
      setCart(prev => [...prev, {
        id: genId(), menuItemId: numpadItem.id, name: numpadItem.name,
        pricingType: 'manual', price: val, quantity: 1,
        lineTotal: val, note: ''
      }]);
    } else if (!numpadTarget && selectedCartItem) {
      // Apply qty or price to selected cart item
      const cartItem = cart.find(c => c.id === selectedCartItem);
      if (cartItem) {
        if (numpadCartMode === 'qty') {
          const qty = Math.max(1, Math.round(val));
          setCart(prev => prev.map(c => c.id === selectedCartItem
            ? { ...c, quantity: qty, lineTotal: qty * c.price }
            : c
          ));
        } else {
          setCart(prev => prev.map(c => c.id === selectedCartItem
            ? { ...c, price: val, lineTotal: val * c.quantity }
            : c
          ));
        }
      }
      setSelectedCartItem(null);
    } else if (!numpadTarget && !numpadItem && !selectedCartItem && cart.length > 0) {
      // Free calculator → set as Cash Received
      setPaymentReceived(String(val));
      toast.success(`Cash Received: PKR ${val.toLocaleString()}`);
    }
    setNumpadValue('');
    setNumpadItem(null);
    setNumpadTarget(null);
  };

  const cancelNumpad = () => {
    setNumpadValue('');
    setNumpadItem(null);
    setNumpadTarget(null);
  };

  const addManualItem = () => {
    if (!manualName || !manualPrice) return;
    const price = parseFloat(manualPrice);
    if (isNaN(price)) return;
    setCart(prev => [...prev, {
      id: genId(), menuItemId: 'manual', name: manualName,
      pricingType: 'manual', price, quantity: 1,
      lineTotal: price, note: ''
    }]);
    setShowManualDialog(false);
    setManualName('');
    setManualPrice('');
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.map(c => {
      if (c.id !== id) return c;
      const newQty = Math.max(1, c.quantity + delta);
      return { ...c, quantity: newQty, lineTotal: newQty * c.price };
    }));
  };

  // ===== v1.3.0 TOKEN PRINTING =====
  // Token sale ek NORMAL sale hai — wahi order collection, wahi inventory,
  // wahi reports. Sirf token stamps extra hain. Ek click me: sale save +
  // inventory kam + token number + thermal slip. Koi doosri confirmation nahi.
  const [tokenOrder, setTokenOrder] = useState<Order | null>(null);
  const tokenModuleOn = featureActive(settings, 'tokenModuleEnabled');
  const tokenLines = useMemo(
    () => cart.filter((c: any) => {
      const mi = menuItems.find(m => m.id === c.menuItemId);
      return mi?.isTokenItem === true;
    }),
    [cart, menuItems],
  );
  const canPrintToken = tokenModuleOn && tokenLines.length > 0;

  const handlePrintToken = async () => {
    if (!canPrintToken) { toast.error('There are no Token items in the cart'); return; }
    if (tokenLines.length !== cart.length) {
      toast.error('A token sale can only contain Token items — bill the rest separately');
      return;
    }
    try {
      const { createTokenSale } = await import('@/lib/tokens');
      const order = await createTokenSale(
        tokenLines.map((c: any) => ({
          item: menuItems.find(m => m.id === c.menuItemId)!,
          quantity: c.quantity,
          unitPrice: c.price,
        })),
      );
      setTokenOrder(order);       // slip auto-prints
      setCart([]);                 // counter ready for the next customer
      setSelectedCartItem(null);
      toast.success(`Token ${order.tokenLabel} — sale complete ✓`);
    } catch (e: any) {
      console.error('[token] sale failed', e);
      toast.error(`Token sale fail: ${e?.message || e}`);
    }
  };

  // ===== v1.2.5: item remove par Manager password (optional) =====
  // Sirf un items par lagta hai jo kitchen ko ja chuke hain (printedQty > 0)
  // ya jab existing order edit ho raha ho — naya cart item bina rukawat
  // hatta rahega taake cashier ki speed par asar na pare.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const doRemoveItem = (id: string) => {
    setCart(prev => prev.filter(c => c.id !== id));
    if (selectedCartItem === id) setSelectedCartItem(null);
  };
  const removeItem = (id: string) => {
    try {
      if (getSettings()?.requirePasswordForItemRemove) {
        const line: any = cart.find(c => c.id === id);
        const alreadySent = (line?.printedQty || 0) > 0 || !!editingOrderId;
        if (alreadySent) { setPendingRemoveId(id); return; }
      }
    } catch {}
    doRemoveItem(id);
  };

  const subtotal = useMemo(() => cart.reduce((sum, c) => sum + c.lineTotal, 0), [cart]);

  // Discount excluded items (categories + items)
  const excludedCatIds = settings.discountExcludedCategoryIds || [];
  const excludedItemIds = settings.discountExcludedItemIds || [];
  const discountableSubtotal = useMemo(() => {
    return cart.reduce((sum, c) => {
      const mi = menuItems.find(m => m.id === c.menuItemId);
      const excluded = (mi && excludedCatIds.includes(mi.categoryId)) || excludedItemIds.includes(c.menuItemId);
      return sum + (excluded ? 0 : c.lineTotal);
    }, 0);
  }, [cart, menuItems, excludedCatIds, excludedItemIds]);

  // Event discount (auto) — supports both percent and flat PKR
  const evtType = (settings.eventDiscountType || 'percent') as 'percent' | 'pkr';
  const eventActive = !!settings.eventDiscountEnabled && (
    (evtType === 'percent' && (settings.eventDiscountPercent || 0) > 0) ||
    (evtType === 'pkr' && (settings.eventDiscountAmount || 0) > 0)
  );
  const eventPct = evtType === 'percent' ? (settings.eventDiscountPercent || 0) : 0;
  const eventDiscountAmt = !eventActive ? 0
    : evtType === 'percent'
      ? Math.round(discountableSubtotal * eventPct / 100)
      : Math.min(discountableSubtotal, settings.eventDiscountAmount || 0);

  // Manual discount resolution (only one of pkr OR percent active at a time)
  const manualPercentAmt = discountMode === 'percent'
    ? Math.round(discountableSubtotal * (discountPercentInput || 0) / 100)
    : 0;
  const manualPkrAmt = discountMode === 'pkr' ? (discount || 0) : 0;
  const manualDiscount = Math.min(manualPercentAmt + manualPkrAmt, discountableSubtotal);

  // Promo code discount (on top of manual + event)
  const promoDiscount = promoApplied?.discount || 0;

  const totalDiscount = Math.min(discountableSubtotal, eventDiscountAmt + manualDiscount + promoDiscount);

  // ===== v1.5.0 Service Charge + GST engine =====
  // Replaces the old flat `taxAmount` (which could never express a real GST
  // percentage, and never taxed the service charge). taxMode defaults to
  // 'none', which reproduces the exact old numbers via legacyFlatTax — so
  // a restaurant that hasn't configured tax settings sees no change at all.
  const billTotals = computeBillTotals(subtotal, totalDiscount, {
    taxMode: settings.taxMode || 'none',
    taxPercent: settings.taxPercent || 0,
    serviceChargePercent: settings.serviceChargePercent || 0,
    taxOnServiceCharge: settings.taxOnServiceCharge !== false,
    taxLabel: settings.taxLabel || 'GST',
    legacyFlatTax: settings.taxAmount || 0,
    roundTotal: settings.roundGrandTotal === true,
    roundToNearest: Number(settings.roundToNearest) || 0,   // v1.9.1 (SG 5c)
  });
  const taxAmount = billTotals.taxAmount;
  const scPercent = billTotals.serviceChargePercent;
  const serviceCharge = billTotals.serviceCharge;
  const grandTotal = billTotals.grandTotal;

  const paymentReceivedNum = parseFloat(paymentReceived) || 0;
  const changeAmount = paymentReceivedNum - grandTotal;

  const buildDiscountTitle = (): string | undefined => {
    const parts: string[] = [];
    if (eventActive && eventDiscountAmt > 0) {
      parts.push(evtType === 'percent'
        ? `${settings.eventDiscountTitle || 'Event Discount'} ${eventPct}%`
        : `${settings.eventDiscountTitle || 'Event Discount'} ${money(settings.eventDiscountAmount || 0)}`);
    }
    if (discountMode === 'percent' && discountPercentInput > 0) parts.push(`Manual ${discountPercentInput}%`);
    else if (discountMode === 'pkr' && (discount || 0) > 0) parts.push(`Manual PKR`);
    if (promoApplied) parts.push(`Promo ${promoApplied.code}`);
    return parts.length ? parts.join(' + ') : undefined;
  };

  // Re-validate promo whenever cart subtotal changes (in case cart shrinks below min)
  useEffect(() => {
    if (!promoApplied) return;
    const res = validatePromoCode(promoApplied.code, discountableSubtotal);
    if ('error' in res) {
      setPromoApplied(null);
      toast.info('Promo removed: ' + res.error);
    } else if (res.discount !== promoApplied.discount) {
      setPromoApplied({ code: res.promo.code, discount: res.discount });
    }
  }, [discountableSubtotal, promoApplied]);

  const applyPromo = () => {
    const res = validatePromoCode(promoCodeInput, discountableSubtotal);
    if ('error' in res) { toast.error(res.error); return; }
    setPromoApplied({ code: res.promo.code, discount: res.discount });
    toast.success(`Promo ${res.promo.code} applied: -${money(res.discount)}`);
  };
  const removePromo = () => { setPromoApplied(null); setPromoCodeInput(''); };

  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setDiscountPercentInput(0);
    setDiscountMode('pkr');
    setPromoApplied(null);
    setPromoCodeInput('');
    setSelectedTable('');
    setSelectedWaiter('');
    setCustName('');
    setCustPhone('');
    setCustAddress('');
    setSelectedRider('');
    setSpecialNote('');

    setEditingOrderId(null);
    setSelectedCartItem(null);
    setNumpadValue('');
    setNumpadItem(null);
    setNumpadTarget(null);
    setPaymentReceived('');
  };

  const processOrder = async (status: 'paid' | 'partial' | 'running' | 'hold' | 'void' | 'complimentary' | 'cancelled', extras?: Partial<Order>) => {
    if (cart.length === 0 && status !== 'void' && status !== 'cancelled') { toast.error('Cart is empty'); return; }

    // ===== Duplicate-submit guard =====
    // 1) In-flight lock: while a save is processing, ignore further clicks.
    if (orderSubmitLockRef.current) {
      try { console.warn('[POS] processOrder duplicate-click suppressed'); } catch {}
      return;
    }
    orderSubmitLockRef.current = true;
    setSubmitting(true);
    try {
      return await processOrderInner(status, extras);
    } finally {
      orderSubmitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const processOrderInner = async (status: 'paid' | 'partial' | 'running' | 'hold' | 'void' | 'complimentary' | 'cancelled', extras?: Partial<Order>) => {
    if (cart.length === 0 && status !== 'void' && status !== 'cancelled') { toast.error('Cart is empty'); return; }

    // Branch guard — order_taker users have branch auto-assigned at login, skip prompt
    const currentRole = (localStorage.getItem('pos-user-role') || '').toLowerCase();
    if (currentRole !== 'order_taker') {
      const activeBranches = getBranches().filter(b => b.isActive);
      const activeBranchId = getCurrentBranchId();
      if (activeBranches.length > 0 && !activeBranchId) {
        toast.error('Select an active Branch from the header first — otherwise which branch would this bill save to?');
        return;
      }
    }

    const tables = refreshTables();
    const waiters = refreshWaiters();

    if (orderType === 'dining' && status === 'running' && !selectedTable && !editingOrderId) {
      setShowDiningDialog(true);
      return;
    }
    if (orderType === 'delivery' && !custName && !editingOrderId) {
      setShowDeliveryDialog(true);
      return;
    }

    if (editingOrderId) {
      const existingOrders = getOrders();
      const existing = existingOrders.find(o => o.id === editingOrderId);
      if (existing) {
        const allWaitersE = getWaiters();
        const allRidersE = getRiders();
        const allUsersE = getUsers();
        const currentUserIdE = localStorage.getItem('pos-user-id') || '';
        const currentUserE = allUsersE.find(u => u.id === currentUserIdE);
        const waiterObjE = allWaitersE.find(w => w.id === (selectedWaiter || existing.waiterId));
        const riderObjE = allRidersE.find(r => r.id === (selectedRider || existing.riderId));
        const tableObjE = tables.find(t => t.id === (selectedTable || existing.tableId));

        const updated: Order = {
          ...existing,
          items: cart,
          subtotal,
          discount: totalDiscount,
          discountPercent: discountMode === 'percent' ? discountPercentInput : (eventActive && evtType === 'percent' ? eventPct : undefined),
          discountTitle: buildDiscountTitle(),
          promoCode: promoApplied?.code,
          promoCodeDiscount: promoApplied?.discount,
          tax: taxAmount,
          serviceCharge,
          serviceChargePercent: scPercent,
          taxMode: billTotals.taxMode,
          taxPercent: billTotals.taxPercent,
          taxLabel: billTotals.taxLabel,
          netOfTax: billTotals.netOfTax,
          grandTotal,
          status,
          paymentMethod: status === 'paid' ? paymentMethod : existing.paymentMethod,
          paymentAccountId: status === 'paid' ? paymentAccountId : existing.paymentAccountId,
          paymentAccountName: status === 'paid' ? paymentAccountName : existing.paymentAccountName,
          cashReceived: status === 'paid' && paymentReceivedNum > 0 ? paymentReceivedNum : existing.cashReceived,
          changeReturned: status === 'paid' && paymentReceivedNum > 0 ? Math.max(0, paymentReceivedNum - grandTotal) : existing.changeReturned,
          customer: (custName || custPhone) ? { id: existing.customer?.id || genId(), name: custName, phone: custPhone, address: custAddress, fullAddress: custAddress, province: custProvince, city: custCity, area: custArea, lat: custLat, lng: custLng, locationCapturedAt: custLocAt } : existing.customer,
          paidAt: status === 'paid' ? new Date().toISOString() : undefined,
          // Integrated flow: paid orders auto-clear from KDS
          kitchenStatus: status === 'paid' ? 'served' as const : existing.kitchenStatus,
          kitchenStatusAt: status === 'paid' ? new Date().toISOString() : existing.kitchenStatusAt,
          notes: specialNote.trim() || existing.notes || '',

          tableName: tableObjE?.name || existing.tableName,
          waiterName: waiterObjE?.name || existing.waiterName,
          riderName: riderObjE?.name || existing.riderName,
          riderPhone: riderObjE?.phone || existing.riderPhone,
          cashierName: currentUserE?.name || existing.cashierName || 'Unknown',
          ...extras,
        };
        saveOrder(updated);
        if (status === 'paid' && promoApplied?.code) {
          incrementPromoUsage(promoApplied.code);
        }

        // ===== UPDATE KOT — when an existing order is edited and new items
        //       were added, send ONLY the new items to the kitchen so the
        //       earlier items are not re-cooked.
        const masterAuto = settings.autoPrintKot ?? settings.autoKitchenPrint ?? false;
        const perTypeAuto = existing.orderType === 'dining'   ? (settings.autoKotDining   ?? masterAuto)
                          : existing.orderType === 'takeaway' ? (settings.autoKotTakeaway ?? masterAuto)
                          : existing.orderType === 'delivery' ? (settings.autoKotDelivery ?? masterAuto)
                          : masterAuto;
        const editAutoKot = settings.kotEnabled !== false
          && perTypeAuto
          && !settings.manualSendToKitchen;
        // Track if this handler already enqueued a KOT so the takeaway-pay
        // safety net below doesn't queue a SECOND duplicate slip.
        let kotEnqueuedThisCall = false;
        if (editAutoKot && (status === 'running' || status === 'paid' || status === 'hold' || status === 'partial')) {
          const diff = computeKotDiff(updated);
          if (diff.hasDiff) {
            if (existing.kotPrinted) {
              // Respect restaurant policy: only_changes | full | ask
              const mode = settings.kotUpdateMode || 'only_changes';
              let effective: 'only_changes' | 'full' = mode === 'full' ? 'full' : 'only_changes';
              if (mode === 'ask') {
                try {
                  const pick = window.confirm(
                    `KOT update:\n\nOK  = Print only new/changed items (${diff.diffItemIds.length})\nCancel = Reprint FULL updated KOT`
                  );
                  effective = pick ? 'only_changes' : 'full';
                } catch { effective = 'only_changes'; }
              }
              enqueueKotByPolicy(updated, effective);
              kotEnqueuedThisCall = true;
              toast.info(
                effective === 'full'
                  ? `Full updated KOT sent to kitchen`
                  : `KOT update sent — ${diff.diffItemIds.length} new items to the kitchen`
              );
            } else {
              // first KOT never went out — send a normal full KOT
              enqueueKot(updated);
              kotEnqueuedThisCall = true;
            }
          }
        }
        // Takeaway pay safety net — only fires if NO KOT was queued above and
        // the order's first KOT never went out. Prevents duplicate silent prints.
        if (!kotEnqueuedThisCall && status === 'paid' && settings.kotEnabled !== false && updated.orderType === 'takeaway' && !updated.kotPrinted && !existing.kotPrinted) {
          try { enqueueKot(updated, { force: true }); } catch {}
        }

        // ===== CANCEL KOT — agar order cancel/void ho aur KOT pehle kitchen ja chuka hai,
        //       to kitchen ko ek CANCELLED slip bhejen taa ke cooking ruk jaye.
        if ((status === 'cancelled' || status === 'void') && settings.kotEnabled !== false
            && (settings.printKotOnCancel !== false) && existing.kotPrinted) {
          try { enqueueKotCancel(updated); } catch {}
        }


        if (existing.tableId) {
          const t = tables.find(t => t.id === existing.tableId);
          if (t) {
            saveTable({
              ...t,
              status: (status === 'paid' || status === 'void' || status === 'complimentary' || status === 'cancelled') ? 'free' : 'running',
              currentOrderId: (status === 'paid' || status === 'void' || status === 'complimentary' || status === 'cancelled') ? undefined : existing.id
            });
          }
        }

        setLastOrder(updated);
        if (status === 'paid') {
          try { enqueueReceipt(updated, { force: true }); } catch {}
          setShowReceipt(true);
          toast.success(`Order #${updated.orderNumber} paid — receipt printing`);
        } else if (status === 'partial') {
          try { enqueueReceipt(updated, { force: true }); } catch {}
          const due = Math.max(0, (updated.grandTotal || 0) - (updated.amountPaid || 0));
          toast.success(`#${updated.orderNumber} Partial — Paid ${money((updated.amountPaid||0))} · Due ${money(due)}`);
        } else if (status === 'void') {
          toast.info(`Order #${updated.orderNumber} voided`);
        } else if (status === 'complimentary') {
          toast.info(`Order #${updated.orderNumber} marked complimentary`);
        } else if (status === 'cancelled') {
          toast.info(`Order #${updated.orderNumber} cancelled`);
        } else {
          toast.info(`Order #${updated.orderNumber} updated & held`);
        }
        clearCart();
        return;
      }
    }


    const allWaiters = getWaiters();
    const allRiders = getRiders();
    const allUsers = getUsers();
    const currentUserId = localStorage.getItem('pos-user-id') || '';
    const currentUser = allUsers.find(u => u.id === currentUserId);
    const cashierName = currentUser?.name || 'Unknown';
    const waiterObj = allWaiters.find(w => w.id === selectedWaiter);
    const riderObj = allRiders.find(r => r.id === selectedRider);
    const tableObj = tables.find(t => t.id === selectedTable);

    const order: Order = {
      id: genId(),
      orderNumber: await getNextOrderNumberAsync(),
      orderType,
      status,
      tableId: orderType === 'dining' ? selectedTable : undefined,
      tableName: orderType === 'dining' && tableObj ? tableObj.name : undefined,
      waiterId: orderType === 'dining' ? selectedWaiter : undefined,
      waiterName: orderType === 'dining' && waiterObj ? waiterObj.name : undefined,
      riderId: orderType === 'delivery' ? selectedRider : undefined,
      riderName: orderType === 'delivery' && riderObj ? riderObj.name : undefined,
      riderPhone: orderType === 'delivery' && riderObj ? riderObj.phone : undefined,
      cashierName,
      cashierId: currentUserId || undefined,
      customer: (custName || custPhone || orderType === 'delivery') ? { id: genId(), name: custName, phone: custPhone, address: custAddress, fullAddress: custAddress, province: custProvince, city: custCity, area: custArea, lat: custLat, lng: custLng, locationCapturedAt: custLocAt } : undefined,
      items: cart,
      subtotal,
      discount: totalDiscount,
      discountPercent: discountMode === 'percent' ? discountPercentInput : (eventActive && evtType === 'percent' ? eventPct : undefined),
      discountTitle: buildDiscountTitle(),
      promoCode: promoApplied?.code,
      promoCodeDiscount: promoApplied?.discount,
      tax: taxAmount,
      serviceCharge,
      serviceChargePercent: scPercent,
      taxMode: billTotals.taxMode,
      taxPercent: billTotals.taxPercent,
      taxLabel: billTotals.taxLabel,
      netOfTax: billTotals.netOfTax,
      grandTotal,
      paymentMethod: status === 'paid' ? paymentMethod : undefined,
      paymentAccountId: status === 'paid' ? paymentAccountId : undefined,
      paymentAccountName: status === 'paid' ? paymentAccountName : undefined,
      cashReceived: status === 'paid' && paymentReceivedNum > 0 ? paymentReceivedNum : undefined,
      changeReturned: status === 'paid' && paymentReceivedNum > 0 ? Math.max(0, paymentReceivedNum - grandTotal) : undefined,
      deliveryStatus: orderType === 'delivery' ? 'pending' : undefined,
      createdAt: new Date().toISOString(),
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      // Integrated flow: a brand-new order paid immediately doesn't need KDS
      kitchenStatus: status === 'paid' ? 'served' as const : undefined,
      kitchenStatusAt: status === 'paid' ? new Date().toISOString() : undefined,
      notes: specialNote.trim(),

      branchId: getCurrentBranchId() || undefined,
      source: (localStorage.getItem('pos-user-role') === 'order_taker') ? 'order_taker' : 'pos',
      ...extras,
    };

    saveOrder(order);
    // ---- Audit trail: who did what, on which order/table, from which device ----
    try {
      const auditCtx = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        tableLabel: order.tableName,
        amount: order.grandTotal,
      };
      logStaffAction(editingOrderId ? 'ORDER_EDIT' : 'ORDER_CREATE', auditCtx);
      if (status === 'running') logStaffAction('SEND_TO_KITCHEN', auditCtx);
      if ((order.discount || 0) > 0) {
        logStaffAction('DISCOUNT', { ...auditCtx, amount: order.discount, reason: order.discountTitle });
      }
      if (status === 'paid') logStaffAction('BILL_CLOSE', auditCtx);
    } catch { /* audit must never block a sale */ }
    if (status === 'paid' && promoApplied?.code) {
      incrementPromoUsage(promoApplied.code);
    }

    if (orderType === 'dining' && selectedTable) {
      const t = tables.find(t => t.id === selectedTable);
      if (t) {
        saveTable({
          ...t,
          status: (status === 'paid' || status === 'void' || status === 'complimentary' || status === 'cancelled') ? 'free' : 'running',
          currentOrderId: (status === 'paid' || status === 'void' || status === 'complimentary' || status === 'cancelled') ? undefined : order.id
        });
      }
    }

    setLastOrder(order);
    // ===== Centralized one-phase printing =====
    const role = localStorage.getItem('pos-user-role') || '';
    const isOrderTaker = role === 'order_taker';
    const isNewOrder = status === 'running' || status === 'paid' || status === 'partial';
    const kotAllowed = settings.kotEnabled !== false;
    const masterAutoNew = settings.autoPrintKot ?? settings.autoKitchenPrint ?? false;
    const perTypeAutoNew = order.orderType === 'dining'   ? (settings.autoKotDining   ?? masterAutoNew)
                         : order.orderType === 'takeaway' ? (settings.autoKotTakeaway ?? masterAutoNew)
                         : order.orderType === 'delivery' ? (settings.autoKotDelivery ?? masterAutoNew)
                         : masterAutoNew;
    const autoKot = isOrderTaker
      ? settings.autoKotOnOrderTakerSave !== false
      : perTypeAutoNew;
    if (isNewOrder && kotAllowed && autoKot && !settings.manualSendToKitchen && !isOrderTaker) {
      enqueueKot(order);
    } else if (status === 'paid' && kotAllowed && order.orderType === 'takeaway' && !isOrderTaker) {
      // Takeaway pay → always send KOT alongside receipt so kitchen aur receipt ek sath nikle
      // v1.15.2 — `force` bypasses the duplicate guard, so a takeaway that
      // ALREADY had its ticket (created as running, paid later) printed a
      // second full KOT on payment. Only force when nothing was sent yet.
      if (!order.kotPrinted) { try { enqueueKot(order, { force: true }); } catch { /* non-fatal */ } }
    }


    if (status === 'paid') {
      try { enqueueReceipt(order, { force: true }); } catch {}
      if (!settings.autoPrintCustomerReceipt) setShowReceipt(true);
      toast.success(`Order #${order.orderNumber} paid — receipt printing`);
    } else if (status === 'partial') {
      try { enqueueReceipt(order, { force: true }); } catch {}
      const due = Math.max(0, (order.grandTotal || 0) - (order.amountPaid || 0));
      toast.success(`Order #${order.orderNumber} — Partial paid ${money((order.amountPaid||0))} · Pending ${money(due)}`);
    } else if (status === 'hold') {
      toast.info(`Order #${order.orderNumber} on hold`);
    } else if (isOrderTaker) {
      toast.success(`Order #${order.orderNumber} sent to the kitchen ✅`);
    } else {
      toast.info(`Order #${order.orderNumber} saved as ${status}`);
    }
    clearCart();
  };


  // One-hand PAY: opens payment account picker dialog
  const handleDirectPay = () => {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    // Restricted for Order Takers / Riders — needs a Manager PIN.
    guardAction('payment', { orderId: editingOrderId || undefined, tableLabel: tableObjName(), amount: grandTotal },
      () => setShowPaymentDialog(true));
  };

  const handlePaymentConfirm = (r: {
    method: PaymentMethod;
    accountId?: string;
    accountName?: string;
    cashReceived?: number;
    payments: Array<{ method: 'cash' | 'online' | 'card'; accountId?: string; accountName?: string; amount: number }>;
    totalReceived: number;
    loyaltyPointsUsed?: number;
    loyaltyRedeemValue?: number;
  }) => {
    setShowPaymentDialog(false);
    setPaymentMethod(r.method);
    setPaymentAccountId(r.accountId);
    setPaymentAccountName(r.accountName);
    if (r.cashReceived != null) setPaymentReceived(String(r.cashReceived));
    setTimeout(() => {
      const loyValue = r.loyaltyRedeemValue || 0;
      const adjGrand = Math.max(0, grandTotal - loyValue);
      const totalRecv = Math.min(r.totalReceived, adjGrand);
      const isFullyPaid = totalRecv >= adjGrand - 0.5; // tolerance for rounding
      const stamp = new Date().toISOString();
      const by = localStorage.getItem('pos-user-name') || 'cashier';
      const paymentsFull = r.payments.map(p => ({ ...p, id: genId(), at: stamp, by }));
      const titleExtra = loyValue > 0 ? ` + Loyalty ${money(loyValue)}` : '';
      void processOrder(isFullyPaid ? 'paid' : 'partial', {
        paymentMethod: r.method,
        paymentAccountId: r.accountId,
        paymentAccountName: r.accountName,
        cashReceived: r.cashReceived,
        changeReturned: r.cashReceived && isFullyPaid ? Math.max(0, r.cashReceived - adjGrand) : undefined,
        amountPaid: totalRecv,
        payments: paymentsFull,
        ...(loyValue > 0 ? {
          grandTotal: adjGrand,
          discount: totalDiscount + loyValue,
          discountTitle: (buildDiscountTitle() || '') + titleExtra,
          loyaltyPointsUsed: r.loyaltyPointsUsed,
          loyaltyRedeemValue: loyValue,
        } : {}),
      } as any).catch((error) => {
        console.error('[POS] payment completion failed', error);
        toast.error(`Payment could not be completed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      });
    }, 0);
  };

  const confirmDining = async () => {
    setShowDiningDialog(false);
    // If cart already has items, send to running. Otherwise just remember the table selection
    // and let the cashier keep adding items — they'll process later.
    if (cart.length > 0) {
      await processOrder('running');
      if (pendingKitchenReceipt) { setShowKitchenReceipt(true); setPendingKitchenReceipt(false); }
    } else if (selectedTable) {
      setPendingKitchenReceipt(false);
      toast.success('Table selected — add items to start order');
    }
  };

  const confirmDelivery = async () => {
    setShowDeliveryDialog(false);
    if (cart.length > 0) {
      await processOrder('running');
      if (pendingKitchenReceipt) { setShowKitchenReceipt(true); setPendingKitchenReceipt(false); }
    } else if (custName) {
      setPendingKitchenReceipt(false);
      toast.success('Customer saved — add items to start order');
    }
  };


  const retrieveOrder = (order: Order) => {
    setCart(order.items);
    setDiscount(order.discount);
    setOrderType(order.orderType);
    setEditingOrderId(order.id);
    if (order.tableId) setSelectedTable(order.tableId);
    if (order.waiterId) setSelectedWaiter(order.waiterId);
    if (order.customer) {
      setCustName(order.customer.name);
      setCustPhone(order.customer.phone);
      setCustAddress(order.customer.address);
    }
    setSpecialNote(order.notes || '');
    setShowRunningBills(false);

    toast.info(`Editing Order #${order.orderNumber}`);
  };

  const openRunningBills = () => {
    setRunningBills(sortOrdersNewestFirst(getOrders().filter(o => o.status === 'running' || o.status === 'hold')));
    setBillSearch('');
    setShowRunningBills(true);
  };

  // Void/Comp/Cancel
  const handleVoidAction = () => {
    if (voidType === 'complimentary') {
      processOrder('complimentary', { voidReason: voidReason, voidBy: compName, creditCustomerName: compName, creditCustomerPhone: compPhone });
    } else if (voidType === 'void') {
      processOrder('void', { voidReason });
    } else {
      processOrder('cancelled', { voidReason });
    }
    setShowVoidDialog(false);
    setVoidReason('');
    setCompName('');
    setCompPhone('');
  };

  // Credit sale
  const handleCreditSale = () => {
    if (!creditName) { toast.error('Enter customer name'); return; }
    processOrder('paid', {
      paymentMethod: 'credit',
      creditCustomerName: creditName,
      creditCustomerPhone: creditPhone,
      creditCustomerAddress: creditAddress,
    });
    setShowCreditDialog(false);
    setCreditName('');
    setCreditPhone('');
    setCreditAddress('');
  };

  // Mark bill status from retrieve
  const markBillStatus = (order: Order, status: 'running' | 'hold' | 'void' | 'cancelled') => {
    const updated = { ...order, status };
    saveOrder(updated);
    if (order.tableId && (status === 'void' || status === 'cancelled')) {
      const tables = refreshTables();
      const t = tables.find(t => t.id === order.tableId);
      if (t) saveTable(releasedTable(t, updated));   // v1.15.1 — clears the dine timer too
    }
    if ((status === 'void' || status === 'cancelled')
        && settings.kotEnabled !== false
        && (settings.printKotOnCancel !== false)
        && order.kotPrinted) {
      try { enqueueKotCancel(updated); } catch {}
    }
    setRunningBills(prev => sortOrdersNewestFirst(prev.map(o => o.id === order.id ? updated : o).filter(o => o.status === 'running' || o.status === 'hold')));
    toast.success(`Bill #${order.orderNumber} marked as ${status}`);
  };


  const payBillFromRetrieve = (order: Order) => {
    // ===== v1.34.0 — a bill marked paid with no record of HOW =====
    //
    // FOUND IN THE BOOKS, not in the code: 13 website orders and 1 POS order,
    // Rs 5,690 in total, sitting as status 'paid' with amount_paid = 0, no
    // payment_method, and not one row in order_payments. Every one of them came
    // through here.
    //
    // This wrote only the status and the timestamp. The money was collected at
    // the counter and the books never learned of it, so the payment-method
    // breakdown under-counted, and the cash drawer count could never reconcile.
    //
    // It stays ONE CLICK — the operator is not made to re-pick something the
    // POS already knows — but it now records the same fields the ordinary
    // payment path records, and says which method it used so a wrong default is
    // visible immediately rather than discovered at closing time.
    const method = paymentMethod || 'cash';
    const updated = {
      ...order,
      status: 'paid' as const,
      paidAt: new Date().toISOString(),
      paymentMethod: method,
      paymentAccountId,
      paymentAccountName,
      amountPaid: order.grandTotal,
      kitchenStatus: order.kitchenStatus ?? ('served' as const),
      kitchenStatusAt: order.kitchenStatusAt ?? new Date().toISOString(),
    };
    saveOrder(updated);
    if (order.tableId) {
      const tables = refreshTables();
      const t = tables.find(t => t.id === order.tableId);
      if (t) saveTable(releasedTable(t, updated));   // v1.15.1 — clears the dine timer too
    }
    setRunningBills(prev => prev.filter(o => o.id !== order.id));
    setLastOrder(updated);
    setShowReceipt(true);
    toast.success(`Bill #${order.orderNumber} paid — ${method}`);
  };

  const orderTypes: { value: OrderType; label: string; color: string }[] = [
    { value: 'dining', label: 'Dining', color: 'bg-status-info text-status-info-foreground' },
    { value: 'takeaway', label: 'Takeaway', color: 'bg-status-warning text-status-warning-foreground' },
    { value: 'delivery', label: 'Delivery', color: 'bg-status-teal text-status-teal-foreground' },
    ...(settings.foodpandaEnabled ? [{ value: 'foodpanda' as OrderType, label: 'Foodpanda', color: 'bg-pink-600 text-white' }] : []),
  ];

  const handleOrderTypeChange = (newType: OrderType) => {
    if (editingOrderId) return;
    setOrderType(newType);
    if (newType === 'dining' && !selectedTable) {
      setShowDiningDialog(true);
    } else if (newType === 'delivery' && !custName) {
      setShowDeliveryDialog(true);
    }
  };

  const tables = refreshTables();
  const waiters = refreshWaiters();


  // Filtered running bills
  const filteredBills = useMemo(() => {
    if (!billSearch) return runningBills;
    const q = billSearch.toLowerCase();
    return runningBills.filter(o => {
      const table = o.tableId ? tables.find(t => t.id === o.tableId) : null;
      const waiter = o.waiterId ? waiters.find(w => w.id === o.waiterId) : null;
      return (
        o.orderNumber.toString().includes(q) ||
        (table?.name?.toLowerCase().includes(q)) ||
        (waiter?.name?.toLowerCase().includes(q))
      );
    });
  }, [runningBills, billSearch, tables, waiters]);

  // New numpad layout: 1-2-3 / 4-5-6 / 7-8-9 / CLR-0-DEL
  const numpadRows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['.', '0', '⌫'],
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden">


      {/* CENTER: Top header + Category ribbon + Items grid */}
      <div className="flex-1 bg-pos-grid flex flex-col min-w-0">
        {/* TOP BAR — compact: Search + Manual only.
            Order-type tabs (Dining/Takeaway/Delivery) live inside the Cart panel header. */}
        <div className="bg-card border-b shadow-sm px-3 py-1.5 flex items-center gap-2 shrink-0">
          {editingOrderId && (
            <Badge variant="secondary" className="text-[10px] bg-status-warning/20 text-status-warning border-status-warning/30 shrink-0">
              Editing Order
            </Badge>
          )}

          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="pos-search"
              placeholder="Search items... (Ctrl+K)"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-7 text-xs rounded-full bg-background"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] rounded-full px-3 shrink-0"
            onClick={() => setShowManualDialog(true)}
          >
            <Edit3 className="h-3 w-3 mr-1" /> Manual
          </Button>
        </div>

        {/* CATEGORY RIBBON — horizontal pills with scroll arrows (TOP layout only) */}
        {(settings.categoryLayout || 'top') !== 'side' && (
        <div className="relative border-b-2 border-border/60 bg-card/40 shrink-0">
          <button
            type="button"
            onClick={() => scrollCatRibbon('left')}
            aria-label="Scroll categories left"
            className="hidden md:flex absolute left-0 top-0 bottom-0 z-10 items-center justify-center w-8 bg-gradient-to-r from-card via-card/90 to-transparent hover:from-primary/15 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-foreground/80" />
          </button>
          <div
            ref={catRibbonRef}
            className="cat-ribbon flex gap-2 overflow-x-auto px-10 py-2.5 scroll-smooth"
            style={{ scrollbarWidth: 'thin' }}
          >
            <button
              onClick={() => setSelectedCat('all')}
              data-active={selectedCat === 'all'}
              className="cat-pill"
            >
              📋 All
            </button>
            {categories.map(cat => {
              const catFont = settings.categoryStyle;
              const catFontStyle: React.CSSProperties = catFont && catFont.font !== 'default' ? {
                fontFamily: `'${catFont.font}', serif`,
                fontSize: `${catFont.size}px`,
                fontWeight: catFont.bold ? 800 : 400,
                direction: ['Aseer Unicode', 'AA Sameer Armaa', 'Jameel Noori Nastaleeq', 'Jameel Noori Nastaleeq Regular'].includes(catFont.font) ? 'rtl' : 'ltr',
              } : {};
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCat(cat.id)}
                  data-active={selectedCat === cat.id}
                  className="cat-pill flex items-center gap-1.5 shrink-0"
                  style={catFontStyle}
                >
                  {cat.image ? (
                    <img src={cat.image} alt={cat.name} className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="text-sm">{cat.icon}</span>
                  )}
                  <span>{cat.name}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => scrollCatRibbon('right')}
            aria-label="Scroll categories right"
            className="hidden md:flex absolute right-0 top-0 bottom-0 z-10 items-center justify-center w-8 bg-gradient-to-l from-card via-card/90 to-transparent hover:from-primary/15 transition-colors"
          >
            <ChevronRight className="h-5 w-5 text-foreground/80" />
          </button>
        </div>
        )}

        {/* ITEMS AREA — optional left sidebar (SIDE layout) + grid */}
        <div className="flex-1 flex overflow-hidden">
          {(settings.categoryLayout === 'side') && (
            <aside className="w-36 md:w-44 shrink-0 border-r-2 border-border/60 bg-card/40 overflow-y-auto pos-scrollbar py-2">
              <button
                onClick={() => setSelectedCat('all')}
                data-active={selectedCat === 'all'}
                className="cat-pill w-[calc(100%-12px)] mx-1.5 mb-1.5 justify-start"
              >
                📋 All
              </button>
              {categories.map(cat => {
                const catFont = settings.categoryStyle;
                const catFontStyle: React.CSSProperties = catFont && catFont.font !== 'default' ? {
                  fontFamily: `'${catFont.font}', serif`,
                  fontSize: `${catFont.size}px`,
                  fontWeight: catFont.bold ? 800 : 400,
                  direction: ['Aseer Unicode', 'AA Sameer Armaa', 'Jameel Noori Nastaleeq', 'Jameel Noori Nastaleeq Regular'].includes(catFont.font) ? 'rtl' : 'ltr',
                } : {};
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCat(cat.id)}
                    data-active={selectedCat === cat.id}
                    className="cat-pill w-[calc(100%-12px)] mx-1.5 mb-1.5 flex items-center gap-1.5 justify-start"
                    style={catFontStyle}
                  >
                    {cat.image ? (
                      <img src={cat.image} alt={cat.name} className="h-5 w-5 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="text-sm shrink-0">{cat.icon}</span>
                    )}
                    <span className="truncate text-left">{cat.name}</span>
                  </button>
                );
              })}
            </aside>
          )}

        {/* ITEMS GRID */}
        <div className="flex-1 overflow-y-auto pos-scrollbar p-3">

        {/* Advanced-flow breadcrumb + Back button */}
        {(showFlavorGrid || selectedFlavor) && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            {selectedFlavor && (
              <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setSelectedFlavor(null)}>
                <ChevronLeft className="h-3 w-3 mr-1" /> Back to Flavors
              </Button>
            )}
            <span className="font-bold text-muted-foreground">
              {categoryById.get(selectedCat)?.name || 'Menu'}
              {selectedFlavor && <span className="text-primary"> · {selectedFlavor}</span>}
            </span>
          </div>
        )}

        {/* FLAVOR GRID (advanced flow only) */}
        {showFlavorGrid ? (
          <div className={{
            3: 'grid grid-cols-2 sm:grid-cols-3 gap-3',
            4: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3',
            5: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2',
            6: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2',
          }[settings.menuGridColumns || 6]}>
            {flavorList.map(fl => {
              // pick first item in this flavor for a representative image
              const sample = categoryItems.find(it => (it.subCategory || it.flavorGroup || '').trim() === fl);
              return (
                <button
                  key={fl}
                  onClick={() => setSelectedFlavor(fl)}
                  className="bg-card rounded-xl text-left hover:shadow-xl hover:ring-2 hover:ring-primary/40 hover:-translate-y-0.5 transition-all duration-200 group overflow-hidden border border-border/50 hover:border-primary/30"
                >
                  {sample?.image ? (
                    <div className="w-full h-24 overflow-hidden bg-muted">
                      <CachedImage src={sample.image} alt={fl} fallbackLabel={fl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                    </div>
                  ) : (
                    <div className="w-full h-20 bg-gradient-to-br from-primary/10 to-accent/30 flex items-center justify-center">
                      <span className="text-3xl opacity-50">🍕</span>
                    </div>
                  )}
                  <div className="p-2.5">
                    <p className="text-xs font-bold text-foreground truncate leading-tight">{fl}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Tap to view flavors</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
        /* Items grid - PREMIUM CARD DESIGN */
        <div className={{
          3: 'grid grid-cols-2 sm:grid-cols-3 gap-3',
          4: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3',
          5: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2',
          6: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2',
        }[settings.menuGridColumns || 6]}>
          {filteredItems.map(item => {
            const itemFont = settings.menuItemStyle;
            const itemFontStyle: React.CSSProperties = itemFont && itemFont.font !== 'default' ? {
              fontFamily: `'${itemFont.font}', serif`,
              fontSize: `${itemFont.size}px`,
              fontWeight: itemFont.bold ? 800 : 400,
              textAlign: itemFont.align,
              direction: ['Aseer Unicode', 'AA Sameer Armaa', 'Jameel Noori Nastaleeq', 'Jameel Noori Nastaleeq Regular'].includes(itemFont.font) ? 'rtl' : 'ltr',
            } : {};
            const inCart = cartByMenuItem.get(item.id);
            // Compute "from" price for variant items
            const hasVar = itemHasVariants(item);
            const minVarPrice = hasVar ? Math.min(
              ...(item.sizeVariants || []).map(v => v.price || Infinity),
              ...(item.inchVariants || []).map(v => v.price || Infinity),
              Infinity
            ) : 0;
            return (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              className={`bg-card rounded-xl text-left hover:shadow-xl hover:ring-2 hover:ring-primary/40 hover:-translate-y-0.5 transition-all duration-200 group overflow-hidden border border-border/50 hover:border-primary/30 relative ${
                inCart ? 'ring-2 ring-primary/30 shadow-md' : 'shadow-sm'
              }`}
            >
              {/* Quantity badge */}
              {inCart && (
                <div className="absolute top-1.5 right-1.5 z-10 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-5 w-5 flex items-center justify-center shadow-lg">
                  {inCart.quantity}
                </div>
              )}
              {/* Item Image */}
              {item.image ? (
                <div className="w-full h-24 overflow-hidden bg-muted">
                  <CachedImage src={item.image} alt={item.name} fallbackLabel={item.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                </div>
              ) : (
                <div className="w-full h-16 bg-gradient-to-br from-primary/8 to-accent/30 flex items-center justify-center">
                  <span className="text-2xl opacity-40 group-hover:scale-110 transition-transform duration-200">
                    {categoryById.get(item.categoryId)?.icon || '🍽️'}
                  </span>
                </div>
              )}
              <div className="p-2.5">
                <p className="text-xs font-bold text-foreground truncate leading-tight" style={itemFontStyle}>{item.name}</p>
                {item.categoryId === DEALS_CATEGORY_ID && (() => {
                  const deal = dealsById.get(item.id);
                  if (!deal || !deal.items?.length) return null;
                  return (
                    <p className="text-[9px] text-muted-foreground italic mt-0.5 line-clamp-2">
                      🎁 {deal.items.map(di => `${di.quantity}× ${menuItemById.get(di.menuItemId)?.name || 'Item'}`).join(', ')}
                    </p>
                  );
                })()}
                {/* v1.3.2 Priority 6 — price uses the ACTIVE THEME colour */}
                <div className="mt-1.5">
                  {hasVar && isFinite(minVarPrice) ? (
                    <span className="dt-menu-price text-xs">From {money(minVarPrice)}</span>
                  ) : item.pricingType === 'fixed' ? (
                    <span className="dt-menu-price text-sm">{money(item.price)}</span>
                  ) : item.pricingType === 'weight' ? (
                    <span className="text-xs font-bold text-status-teal flex items-center gap-0.5">
                      <Weight className="h-3 w-3" /> {item.ratePerKg.toLocaleString()}/kg
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-status-warning">Manual</span>
                  )}
                </div>
              </div>
              {/* Full-width themed Add button (visual — the whole card is the
                  actual click target, so touch behaviour is unchanged) */}
              <div className="dt-menu-add-btn h-7 flex items-center justify-center gap-1 text-[11px] font-extrabold">
                <Plus className="h-3.5 w-3.5" /> ADD
              </div>
            </button>
            );
          })}
          {filteredItems.length === 0 && (
            <div className="col-span-full text-center py-16 text-muted-foreground">
              <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No items found</p>
            </div>
          )}
        </div>
        )}
        </div>
        </div>
      </div>


      {/* Mobile floating Cart button */}
      <button
        onClick={() => setMobileCartOpen(true)}
        className="md:hidden fixed bottom-4 right-4 z-40 bg-primary text-primary-foreground rounded-full shadow-elegant px-4 py-3 flex items-center gap-2 font-bold text-sm"
      >
        <ShoppingCart className="h-4 w-4" />
        Cart
        {cart.length > 0 && (
          <span className="bg-accent text-primary rounded-full h-5 min-w-5 px-1.5 text-[11px] font-extrabold flex items-center justify-center">{cart.length}</span>
        )}
      </button>

      {/* Mobile cart backdrop */}
      {mobileCartOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMobileCartOpen(false)} />
      )}

      {/* RIGHT: Cart + Calculator + Payment Panel */}
      <div className={`${mobileCartOpen ? 'fixed inset-y-0 right-0 w-[88%] max-w-[380px] z-50 flex' : 'hidden'} md:relative md:flex md:w-[clamp(280px,26vw,460px)] bg-pos-cart border-l flex-col shrink-0 shadow-lg min-h-0 overflow-hidden`}>
        {/* Cart Header with order type + customer fields */}
        <div className="px-3 py-2 border-b space-y-1.5 shrink-0">
          <h2 className="text-sm font-extrabold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            CART
            <Badge variant="secondary" className="ml-auto text-[10px] font-bold">{cart.length} items</Badge>
            <button onClick={() => setMobileCartOpen(false)} className="md:hidden ml-1 text-muted-foreground hover:text-foreground" aria-label="Close">
              <XCircle className="h-5 w-5" />
            </button>
          </h2>
          {/* Order type quick switch inside cart — always visible */}
          <div className="grid grid-cols-3 gap-1">
            {orderTypes.map(ot => (
              <button
                key={ot.value}
                onClick={() => { if (!editingOrderId) setOrderType(ot.value); }}
                disabled={!!editingOrderId}
                className={`h-7 rounded-md text-[10px] font-extrabold uppercase tracking-wide transition-all ${
                  orderType === ot.value ? `${ot.color} shadow-sm` : 'bg-muted/60 text-muted-foreground hover:bg-accent'
                } ${editingOrderId ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {ot.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <User className="absolute left-1.5 top-1.5 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Customer Name"
                value={custName}
                onChange={e => setCustName(e.target.value)}
                className="h-6 text-[10px] pl-5 font-semibold"
              />
            </div>
            <div className="relative flex-1">
              <Phone className="absolute left-1.5 top-1.5 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Phone"
                value={custPhone}
                onChange={e => setCustPhone(e.target.value)}
                className="h-6 text-[10px] pl-5 font-semibold"
              />
            </div>
          </div>
        </div>


        {/* Cart items - fixed height so 3-4 items always stay visible */}
        <div className="flex-none h-[clamp(150px,20vh,220px)] overflow-y-auto pos-scrollbar bg-card/40 shrink-0">
          {/* Table header */}
          <div className="dt-cart-header sticky top-0 z-10 px-3 py-2 flex items-center text-[10px] font-extrabold uppercase tracking-wider">
            <span className="w-5 text-center">#</span>
            <span className="flex-1 pl-1">Item</span>
            <span className="w-12 text-center">Qty</span>
            <span className="w-14 text-right">Price</span>
            <span className="w-16 text-right">Total</span>
            <span className="w-5" />
          </div>
          {cart.map((item, idx) => (
            <div
              key={item.id}
              onClick={() => setSelectedCartItem(item.id)}
              className={`px-3 py-2 cursor-pointer border-b border-border/30 transition-all duration-150 hover:shadow-sm ${
                selectedCartItem === item.id
                  ? 'bg-primary/10 ring-1 ring-primary/40 shadow-sm'
                  : idx % 2 === 0 ? 'bg-card' : 'bg-accent/20'
              }`}
            >
              <div className="flex items-center">
                <span className="w-5 text-center text-[11px] text-muted-foreground/70 font-bold">{idx + 1}</span>
                <div className="flex-1 pl-1.5 min-w-0">
                  <p className="text-xs font-extrabold text-foreground truncate leading-tight">{item.name}</p>
                  {item.note && <p className="text-[8px] text-muted-foreground italic mt-0.5">📝 {item.note}</p>}
                </div>
                <div className="w-12 flex items-center justify-center gap-0.5">
                  <button onClick={(e) => { e.stopPropagation(); updateQty(item.id, -1); }} className="h-6 w-6 rounded-md bg-muted/80 flex items-center justify-center hover:bg-destructive/20 hover:text-destructive transition-colors">
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-xs font-extrabold w-5 text-center">{item.quantity}</span>
                  <button onClick={(e) => { e.stopPropagation(); updateQty(item.id, 1); }} className="h-6 w-6 rounded-md bg-muted/80 flex items-center justify-center hover:bg-primary/20 hover:text-primary transition-colors">
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <span className="w-14 text-right text-[11px] text-muted-foreground font-medium">{item.price.toLocaleString()}</span>
                <span className="w-16 text-right text-xs font-extrabold text-primary">{item.lineTotal.toLocaleString()}</span>
                <button onClick={(e) => { e.stopPropagation(); removeItem(item.id); }} className="w-5 text-destructive/60 hover:text-destructive ml-0.5 transition-colors">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
          {cart.length === 0 && (
            <div className="text-center py-10 text-muted-foreground/60">
              <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-[11px] font-medium">Add items to start an order</p>
            </div>
          )}
        </div>

        {/* Scrollable middle region: totals + numpad + note (action buttons stay pinned below) */}
        <div className="flex-1 min-h-0 overflow-y-auto pos-scrollbar">
        {/* Billing Summary - Luxury */}
        <div className="shrink-0 border-t-2 border-primary/20 bg-gradient-to-b from-card to-accent/10 px-3 py-2 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground font-medium">Subtotal</span>
            <span className="font-bold">PKR {subtotal.toLocaleString()}</span>
          </div>
          {eventActive && eventDiscountAmt > 0 && (
            <div className="flex justify-between text-xs text-green-700">
              <span className="font-medium">{settings.eventDiscountTitle || 'Event Discount'} {evtType === 'percent' ? `${eventPct}%` : ''}</span>
              <span>- PKR {eventDiscountAmt.toLocaleString()}</span>
            </div>
          )}
          {!isOrderTaker && (() => {
            const currentRole = (localStorage.getItem('pos-user-role') || '').toLowerCase();
            const isCashierRole = currentRole === 'cashier';
            const discountBlocked = isCashierRole && !!settings.cashierDiscountRequiresApproval;
            if (discountBlocked) {
              return (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-muted-foreground font-medium">Discount</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 border border-amber-500/30 font-bold">
                      🔒 Admin approval required — apply via Bill Editor
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-1 text-xs">
                <span className="text-muted-foreground font-medium">Discount</span>
                <div className="ml-auto flex items-center gap-1">
                  {settings.pkrDiscountEnabled !== false && settings.percentDiscountEnabled !== false && (
                    <div className="flex border rounded overflow-hidden">
                      <button
                        type="button"
                        onClick={() => { setDiscountMode('pkr'); setDiscountPercentInput(0); }}
                        className={`px-1.5 text-[10px] font-bold ${discountMode === 'pkr' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                      >Rs</button>
                      <button
                        type="button"
                        onClick={() => { setDiscountMode('percent'); setDiscount(0); }}
                        className={`px-1.5 text-[10px] font-bold ${discountMode === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
                      >%</button>
                    </div>
                  )}
                  {discountMode === 'pkr' ? (
                    <Input
                      type="number"
                      value={discount || ''}
                      onChange={e => setDiscount(Number(e.target.value) || 0)}
                      className="h-5 w-16 text-[10px] text-right border-primary/30"
                      placeholder="0"
                      disabled={settings.pkrDiscountEnabled === false}
                    />
                  ) : (
                    <Input
                      type="number"
                      value={discountPercentInput || ''}
                      onChange={e => setDiscountPercentInput(Math.min(100, Number(e.target.value) || 0))}
                      className="h-5 w-16 text-[10px] text-right border-primary/30"
                      placeholder="0"
                      disabled={settings.percentDiscountEnabled === false}
                    />
                  )}
                  {(manualDiscount > 0) && (
                    <span className="text-[10px] text-green-700 font-bold">-{money(manualDiscount)}</span>
                  )}
                </div>
              </div>

              {/* v1.12.0 — quick discount presets (feedback #1 item 11).
                  Previously the cashier had to type every discount, which is
                  slow at a busy counter and easy to fat-finger. Presets are
                  configured per restaurant in Settings; with none configured
                  this row does not render at all, so nothing changes for
                  restaurants that never set them up. */}
              {(() => {
                const pctPresets = (settings.discountPresets || []).filter(n => n > 0 && n <= 100);
                const amtPresets = (settings.discountPresetsAmount || []).filter(n => n > 0);
                if (pctPresets.length === 0 && amtPresets.length === 0) return null;
                const anyApplied = manualDiscount > 0;
                return (
                  <div className="flex flex-wrap items-center gap-1">
                    {settings.percentDiscountEnabled !== false && pctPresets.map(p => (
                      <button
                        key={`p${p}`}
                        type="button"
                        onClick={() => { setDiscountMode('percent'); setDiscount(0); setDiscountPercentInput(p); }}
                        className={`dt-keypad-btn h-6 px-2 rounded text-[10px] font-extrabold ${
                          discountMode === 'percent' && discountPercentInput === p ? 'ring-2 ring-primary' : ''
                        }`}
                      >{p}%</button>
                    ))}
                    {settings.pkrDiscountEnabled !== false && amtPresets.map(a => (
                      <button
                        key={`a${a}`}
                        type="button"
                        onClick={() => { setDiscountMode('pkr'); setDiscountPercentInput(0); setDiscount(a); }}
                        className={`dt-keypad-btn h-6 px-2 rounded text-[10px] font-extrabold ${
                          discountMode === 'pkr' && discount === a ? 'ring-2 ring-primary' : ''
                        }`}
                      >{money(a)}</button>
                    ))}
                    {anyApplied && (
                      <button
                        type="button"
                        onClick={() => { setDiscount(0); setDiscountPercentInput(0); }}
                        className="h-6 px-2 rounded text-[10px] font-extrabold bg-destructive/10 text-destructive border border-destructive/30"
                      >Clear</button>
                    )}
                  </div>
                );
              })()}
              </div>
            );
          })()}
          {/* Promo Code */}
          {!isOrderTaker && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground font-medium">Promo</span>
            <div className="ml-auto flex items-center gap-1">
              {promoApplied ? (
                <>
                  <span className="text-[10px] font-bold text-green-700">{promoApplied.code} -{money(promoApplied.discount)}</span>
                  <button type="button" onClick={removePromo} className="text-[10px] text-destructive font-bold px-1">×</button>
                </>
              ) : (
                <>
                  <Input
                    type="text"
                    value={promoCodeInput}
                    onChange={e => setPromoCodeInput(e.target.value.toUpperCase())}
                    className="h-5 w-20 text-[10px] text-right border-primary/30 uppercase font-mono"
                    placeholder="CODE"
                  />
                  <button
                    type="button"
                    onClick={applyPromo}
                    className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded"
                  >Apply</button>
                </>
              )}
            </div>
          </div>
          )}
          {taxAmount > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground font-medium">Tax</span>
              <span>PKR {taxAmount.toLocaleString()}</span>
            </div>
          )}
          {serviceCharge > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground font-medium">Service ({scPercent}%)</span>
              <span>PKR {serviceCharge.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t-2 border-primary/30">
            <span className="text-sm font-extrabold tracking-tight">GRAND TOTAL</span>
            <span className="text-primary text-xl font-black tracking-tight">PKR {grandTotal.toLocaleString()}</span>
          </div>

          {/* Payment area */}
          {cart.length > 0 && !isOrderTaker && (
            <div className="flex items-center gap-2 pt-1.5">
              <div className="flex-1">
                <label className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">Payment</label>
                <Input
                  type="number"
                  value={paymentReceived}
                  onChange={e => setPaymentReceived(e.target.value)}
                  placeholder={grandTotal.toLocaleString()}
                  className="h-8 text-sm font-extrabold text-right border-primary/30"
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-wider">Change</label>
                <div className={`h-8 rounded-md border px-2 flex items-center justify-end text-sm font-extrabold ${
                  changeAmount >= 0 ? 'text-status-success bg-status-success/10 border-status-success/30' : 'text-destructive bg-destructive/10 border-destructive/30'
                }`}>
                  {paymentReceivedNum > 0 ? `PKR ${Math.abs(changeAmount).toLocaleString()}` : '—'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Inline Calculator / Numpad */}
        <div className="shrink-0 border-t-2 border-primary/20 px-3 py-2 bg-gradient-to-b from-accent/30 to-transparent">
          {/* Numpad display bar */}
          <div className="bg-card rounded-lg px-3 py-1 mb-1.5 flex items-center justify-between border border-border/50 shadow-sm">
            <span className="text-[10px] text-muted-foreground font-semibold">
              {numpadItem ? (
                numpadTarget === 'weight'
                  ? `⚖️ ${numpadItem.name} (${numpadItem.ratePerKg}/KG)`
                  : `💰 ${numpadItem.name} — Enter Price`
              ) : selectedCartItem ? (
                <span className="flex items-center gap-1">
                  ✏️ {cart.find(c => c.id === selectedCartItem)?.name}
                  <button onClick={() => setNumpadCartMode('qty')} className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-colors ${numpadCartMode === 'qty' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted hover:bg-accent'}`}>QTY</button>
                  <button onClick={() => setNumpadCartMode('price')} className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-colors ${numpadCartMode === 'price' ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted hover:bg-accent'}`}>PRICE</button>
                </span>
              ) : '🔢 Calculator'}
            </span>
            <span className="text-base font-extrabold font-mono text-foreground tracking-wider">
              {numpadValue || '0'}
              {numpadTarget === 'weight' && <span className="text-[10px] text-muted-foreground ml-1">{weightUnit}</span>}
            </span>
          </div>

          {/* Weight unit buttons */}
          {numpadTarget === 'weight' && (
            <div className="flex gap-1.5 mb-2">
              {(['KG', 'Gram', 'Pao'] as const).map(u => (
                <button
                  key={u}
                  onClick={() => setWeightUnit(u)}
                  className={`flex-1 h-8 rounded-lg text-[11px] font-bold transition-all ${
                    weightUnit === u
                      ? 'bg-status-teal text-status-teal-foreground shadow-sm'
                      : 'bg-card border hover:bg-accent'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          )}

          {/* Numpad grid */}
          <div className="grid grid-cols-3 gap-1">
            {numpadRows.map((row) => row.map(key => (
              <button
                key={key}
                onClick={() => handleNumpadKey(key)}
                className="dt-keypad-btn h-9 rounded-lg text-base font-black flex items-center justify-center shadow-sm"
              >
                {key === '⌫' ? <Delete className="h-5 w-5" /> : key}
              </button>
            )))}

          </div>

          {/* Bottom row: CLR - Hold/Apply - PAY */}
          <div className="grid grid-cols-3 gap-1 mt-1">
            <button
              onClick={() => { setNumpadValue(''); cancelNumpad(); }}
              className="h-9 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm font-black hover:bg-destructive/20 transition-all duration-150 active:scale-95"
            >
              CLR
            </button>
            {(numpadItem || numpadValue) ? (
              <button
                onClick={applyNumpadValue}
                className="h-9 rounded-lg bg-status-info/10 border border-status-info/30 text-status-info text-sm font-black hover:bg-status-info/20 transition-all duration-150 active:scale-95"
                disabled={!numpadValue}
              >
                {!numpadItem && !selectedCartItem && cart.length > 0 ? '→ Cash' : '✓ Apply'}
              </button>
            ) : (
              <button
                onClick={() => processOrder('hold')}
                className="h-9 rounded-lg bg-status-warning/10 border border-status-warning/30 text-status-warning text-sm font-black hover:bg-status-warning/20 transition-all duration-150 active:scale-95"
              >
                ⏸ Hold
              </button>
            )}
            {isOrderTaker ? (
              <button
                onClick={() => { if (cart.length === 0) { toast.error('Cart is empty'); return; } processOrder('running'); }}
                className="h-9 rounded-lg bg-status-success text-status-success-foreground text-sm font-black hover:bg-status-success/90 transition-all duration-150 active:scale-95 shadow-lg hover:shadow-xl flex items-center justify-center gap-1"
              >
                <ChefHat className="h-4 w-4" /> Send
              </button>
            ) : (
              <button
                onClick={handleDirectPay}
                className="h-9 rounded-lg bg-status-success text-status-success-foreground text-sm font-black hover:bg-status-success/90 transition-all duration-150 active:scale-95 shadow-lg hover:shadow-xl"
              >
                💰 PAY
              </button>
            )}
          </div>

          {/* Print Token — pinned right under the numpad / PAY row.
              Visible whenever the Token module is ON so the cashier can always
              see it; it stays disabled until the cart holds token items. */}
          {tokenModuleOn && (
            <button
              onClick={handlePrintToken}
              disabled={!canPrintToken}
              title={canPrintToken
                ? `Print token slip for ${tokenLines.length} item(s)`
                : 'Add a Token item to the cart to print a token'}
              className={`w-full h-9 mt-1 rounded-lg text-sm font-black transition-all duration-150 flex items-center justify-center gap-1.5 ${
                canPrintToken
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 shadow-lg hover:shadow-xl'
                  : 'bg-muted text-muted-foreground border border-border/60 opacity-70 cursor-not-allowed'
              }`}
            >
              🎫 PRINT TOKEN{canPrintToken ? ` (${tokenLines.length})` : ''}
            </button>
          )}

          {/* Kitchen + Customer Receipt buttons */}
          <div className={`grid ${isOrderTaker ? 'grid-cols-1' : 'grid-cols-2'} gap-1 mt-1`}>
            <button
              onClick={async () => {
                // Auto-create a running order (no payment required) and show kitchen slip
                if (cart.length === 0 && !lastOrder) { toast.error('کوئی آرڈر نہیں ہے'); return; }
                if (cart.length > 0) {
                  // Dining/Delivery need their info dialog first — defer kitchen slip until confirm.
                  if (orderType === 'dining' && !selectedTable && !editingOrderId) {
                    setPendingKitchenReceipt(true);
                    setShowDiningDialog(true);
                    return;
                  }
                  if (orderType === 'delivery' && !custName && !editingOrderId) {
                    setPendingKitchenReceipt(true);
                    setShowDeliveryDialog(true);
                    return;
                  }
                  await processOrder('running');
                  setShowKitchenReceipt(true);
                } else if (lastOrder) {
                  setShowKitchenReceipt(true);
                }
              }}
              className="h-9 rounded-lg bg-accent/50 border border-border/50 text-xs font-black hover:bg-accent transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
            >
              <ChefHat className="h-4 w-4" /> 🍳 Kitchen
            </button>
            {!isOrderTaker && (
            <button
              onClick={() => {
                // Build a preview order if no real one exists yet — supports unpaid / credit
                if (cart.length === 0 && !lastOrder) { toast.error('کوئی آرڈر نہیں ہے'); return; }
                if (lastOrder) {
                  setShowReceipt(true);
                } else {
                  const tempOrder: Order = {
                    id: 'preview',
                    orderNumber: peekNextOrderNumber(),
                    orderType,
                    status: 'running',
                    items: cart,
                    subtotal,
                    discount: totalDiscount,
                    discountTitle: buildDiscountTitle(),
                    tax: taxAmount,
                    serviceCharge,
                    serviceChargePercent: scPercent,
                    taxMode: billTotals.taxMode,
                    taxPercent: billTotals.taxPercent,
                    taxLabel: billTotals.taxLabel,
                    netOfTax: billTotals.netOfTax,
                    grandTotal,
                    cashReceived: paymentReceivedNum > 0 ? paymentReceivedNum : undefined,
                    changeReturned: paymentReceivedNum > 0 ? Math.max(0, paymentReceivedNum - grandTotal) : undefined,
                    createdAt: new Date().toISOString(),
                    notes: '',
                    customer: (custName || custPhone) ? { id: 'tmp', name: custName, phone: custPhone, address: custAddress } : undefined,
                  };
                  setLastOrder(tempOrder);
                  setShowReceipt(true);
                }
              }}
              className="h-9 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-black hover:bg-primary/20 transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
            >
              🧾 Customer Receipt
            </button>
            )}
          </div>
        </div>

        {/* Special Kitchen Note — prints on KOT (e.g. "no onion", "extra spicy") */}
        <div className="px-2 pt-2">
          <label className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
            📝 Special Note <span className="text-[9px] font-normal normal-case text-muted-foreground/70">(KOT par print hoga)</span>
          </label>
          {(settings.kotNotePresets || []).length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {(settings.kotNotePresets || []).map((preset, i) => {
                const active = specialNote.split(/\s*,\s*/).some(p => p.toLowerCase() === preset.toLowerCase());
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const parts = specialNote.split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
                      const idx = parts.findIndex(p => p.toLowerCase() === preset.toLowerCase());
                      const next = idx >= 0
                        ? parts.filter((_, j) => j !== idx)
                        : [...parts, preset];
                      setSpecialNote(next.join(', ').slice(0, 200));
                    }}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all active:scale-95 ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20'
                    }`}
                  >
                    {active ? '✓ ' : '+ '}{preset}
                  </button>
                );
              })}
            </div>
          )}
          <textarea
            value={specialNote}
            onChange={e => setSpecialNote(e.target.value.slice(0, 200))}
            placeholder="e.g. No onion, extra spicy, less salt..."
            rows={2}
            className="w-full text-[12px] rounded-md border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
          />

        </div>
        </div>
        {/* end scrollable middle region */}

        {/* Action Buttons - always visible at bottom */}

        <div className="p-2 border-t flex gap-1.5 bg-card shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-10 text-xs font-black border-status-warning text-status-warning hover:bg-status-warning/10"
            onClick={() => processOrder('running')}
          >
            <Pause className="h-4 w-4 mr-1" /> {editingOrderId ? 'Update' : (isOrderTaker ? 'Send to Kitchen' : 'Running')}
          </Button>
          {!isOrderTaker && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-10 text-xs font-black border-status-purple text-status-purple hover:bg-status-purple/10"
              onClick={() => {
                if (cart.length === 0) { toast.error('Cart is empty'); return; }
                setShowCreditDialog(true);
              }}
            >
              Credit
            </Button>
          )}
          {!isOrderTaker && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-10 text-xs font-black border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (cart.length === 0 && !editingOrderId) { toast.error('No order to void'); return; }
                guardAction('void', { orderId: editingOrderId || undefined, tableLabel: tableObjName(), amount: grandTotal }, () => {
                  setVoidType('void');
                  setShowVoidDialog(true);
                });
              }}
            >
              <Ban className="h-4 w-4 mr-0.5" /> Void
            </Button>
          )}
          {editingOrderId && (
            <Button variant="ghost" size="sm" className="h-10 text-xs font-black text-muted-foreground" onClick={clearCart}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Manual Item Dialog */}
      <Dialog open={showManualDialog} onOpenChange={setShowManualDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Manual Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Item name" value={manualName} onChange={e => setManualName(e.target.value)} autoFocus />
            <Input type="number" placeholder="Price (PKR)" value={manualPrice} onChange={e => setManualPrice(e.target.value)} />
            <Button className="w-full" onClick={addManualItem}>Add to Cart</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dining Dialog */}
      <Dialog open={showDiningDialog} onOpenChange={setShowDiningDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Select Table & Waiter</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={selectedTable} onValueChange={setSelectedTable}>
              <SelectTrigger><SelectValue placeholder="Select Table" /></SelectTrigger>
              <SelectContent>
                {tables.filter(t => t.status === 'free').map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.seats} seats)</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedWaiter} onValueChange={setSelectedWaiter}>
              <SelectTrigger><SelectValue placeholder="Select Waiter" /></SelectTrigger>
              <SelectContent>
                {waiters.filter(w => w.isActive).map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={confirmDining} disabled={!selectedTable}>Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Dialog */}
      <Dialog open={showDeliveryDialog} onOpenChange={setShowDeliveryDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Customer & Delivery Details</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <CustomerAutocomplete
              mode="name" value={custName} onChange={setCustName}
              onSelect={(c) => {
                setCustName(c.name || ''); setCustPhone(c.phone || '');
                setCustAddress(primaryAddress(c));
                if (c.lat != null && c.lng != null) { setCustLat(c.lat); setCustLng(c.lng); setCustLocAt(c.locationCapturedAt); }
                if (c.province) setCustProvince(c.province);
                if (c.city) setCustCity(c.city);
                if (c.area) setCustArea(c.area);
                toast.success(`Loaded: ${c.name} (${c.totalOrders} orders)`);
              }}
              placeholder="Customer Name (auto-suggest)"
            />
            <CustomerAutocomplete
              mode="phone" value={custPhone} onChange={setCustPhone}
              onSelect={(c) => {
                setCustName(c.name || ''); setCustPhone(c.phone || '');
                setCustAddress(primaryAddress(c));
                if (c.lat != null && c.lng != null) { setCustLat(c.lat); setCustLng(c.lng); setCustLocAt(c.locationCapturedAt); }
                if (c.province) setCustProvince(c.province);
                if (c.city) setCustCity(c.city);
                if (c.area) setCustArea(c.area);
              }}
              placeholder="Phone (auto-suggest)"
            />
            <div className="grid grid-cols-3 gap-2">
              <Select value={custProvince} onValueChange={v => { setCustProvince(v); setCustCity(''); setCustArea(''); }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Province" /></SelectTrigger>
                <SelectContent>
                  {getProvinces().map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={custCity} onValueChange={v => { setCustCity(v); setCustArea(''); }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="City" /></SelectTrigger>
                <SelectContent>
                  {getCitiesOf(custProvince).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={custArea} onValueChange={v => {
                setCustArea(v);
                // Prepend area to address if empty/not already containing it
                if (v && !custAddress.toLowerCase().includes(v.toLowerCase())) {
                  setCustAddress(prev => prev ? `${v}, ${prev}` : `${v}, ${custCity}`);
                }
              }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Area" /></SelectTrigger>
                <SelectContent>
                  {getAreasOf(custProvince, custCity).map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Full Delivery Address (house #, street, landmark)" value={custAddress} onChange={e => setCustAddress(e.target.value)} />
            {custAddress && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(custAddress)}`}
                target="_blank" rel="noreferrer"
                className="text-[11px] text-primary underline inline-flex items-center gap-1"
              >📍 View on Google Maps</a>
            )}
            <Select value={selectedRider} onValueChange={setSelectedRider}>
              <SelectTrigger><SelectValue placeholder="Select Rider (optional)" /></SelectTrigger>
              <SelectContent>
                {getRiders().filter(r => r.isActive).map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LocationCapture lat={custLat} lng={custLng} capturedAt={custLocAt}
              onChange={({ lat, lng, capturedAt }) => { setCustLat(lat); setCustLng(lng); setCustLocAt(capturedAt); }} />
            <Button className="w-full" onClick={confirmDelivery} disabled={!custName}>Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Void / Complimentary / Cancel Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>
            {voidType === 'void' ? '🚫 Void Bill' : voidType === 'complimentary' ? '🎁 Complimentary' : '❌ Cancel Bill'}
          </DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {(['void', 'complimentary', 'cancel'] as const).map(t => (
                <button key={t} onClick={() => setVoidType(t)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors capitalize ${
                    voidType === t ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'
                  }`}>
                  {t === 'cancel' ? 'Cancel Bill' : t}
                </button>
              ))}
            </div>
            {voidType === 'complimentary' && (
              <>
                <Input placeholder="Guest Name" value={compName} onChange={e => setCompName(e.target.value)} />
                <Input placeholder="Phone (optional)" value={compPhone} onChange={e => setCompPhone(e.target.value)} />
              </>
            )}
            <Input placeholder="Reason / Note" value={voidReason} onChange={e => setVoidReason(e.target.value)} />
            <Button className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleVoidAction}>
              Confirm {voidType === 'cancel' ? 'Cancel' : voidType}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credit / Udhar Dialog */}
      <Dialog open={showCreditDialog} onOpenChange={setShowCreditDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>💳 Credit / Udhar Sale</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-primary/10 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">AMOUNT DUE</p>
              <p className="text-2xl font-bold text-primary">PKR {grandTotal.toLocaleString()}</p>
            </div>
            <Input placeholder="Customer Name *" value={creditName} onChange={e => setCreditName(e.target.value)} autoFocus />
            <Input placeholder="Phone Number" value={creditPhone} onChange={e => setCreditPhone(e.target.value)} />
            <Input placeholder="Address (optional)" value={creditAddress} onChange={e => setCreditAddress(e.target.value)} />
            <Button className="w-full bg-status-purple text-status-purple-foreground hover:bg-status-purple/90" onClick={handleCreditSale}>
              Confirm Credit Sale
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Receive Dialog (cash / online account) — lazy mounted */}
      {showPaymentDialog && (
        <Suspense fallback={null}>
          <PaymentDialog
            open={showPaymentDialog}
            grandTotal={grandTotal}
            items={cart}
            onClose={() => setShowPaymentDialog(false)}
            onConfirm={handlePaymentConfirm}
            customerPhone={custPhone}
          />
        </Suspense>
      )}

      {/* Receipt + Kitchen Print Dialog */}
      {tokenOrder && (
        <div style={{ position: 'absolute', left: '-99999px', top: 0, width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
          <TokenSlip
            key={tokenOrder.id}
            order={tokenOrder}
            settings={settings}
            autoPrint
            showPrintButton={false}
            onPrintComplete={() => setTokenOrder(null)}
          />
        </div>
      )}
      <ManagerAuthDialog
        open={!!pendingRemoveId}
        reason="This item has already gone to the kitchen — an Admin or Manager password is required to remove it."
        onAuthorized={(byName) => {
          const id = pendingRemoveId;
          setPendingRemoveId(null);
          if (id) { doRemoveItem(id); toast.success(`Item removed — authorized by ${byName}`); }
        }}
        onCancel={() => setPendingRemoveId(null)}
      />
      <Dialog open={showReceipt || showKitchenReceipt} onOpenChange={(v) => { if (!v) { setShowReceipt(false); setShowKitchenReceipt(false); } }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {showKitchenReceipt && !showReceipt ? '🍳 Kitchen Slip' : '🧾 Receipt'}
            </DialogTitle>
          </DialogHeader>
          {lastOrder && (
            <div className="flex gap-1.5 mb-2">
              <button
                onClick={() => { setShowReceipt(true); setShowKitchenReceipt(false); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${showReceipt && !showKitchenReceipt ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
              >
                🧾 Customer Receipt
              </button>
              <button
                onClick={() => { setShowKitchenReceipt(true); setShowReceipt(false); }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${showKitchenReceipt && !showReceipt ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
              >
                🍳 Kitchen Slip
              </button>
            </div>
          )}
          {lastOrder && showReceipt && !showKitchenReceipt && (
            // v1.2.4 DOUBLE-PRINT FIX: the print queue already printed this
            // receipt — the dialog is preview-only (manual Print button rahe ga).
            // Pehle yahan autoPrint dobara fire hota tha = 2 print dialogs +
            // do concurrent print sessions (white-screen crash ka sabab).
            <ReceiptPreview key={`rcpt-${lastOrder.id}`} order={lastOrder} settings={settings} />
          )}
          {lastOrder && showKitchenReceipt && !showReceipt && (
            // autoPrint ONLY when the queue didn't handle it (manual send-to-kitchen
            // mode) — kotPrinted is stamped at enqueue, so this can't double-print.
            <KitchenReceipt key={`kot-${lastOrder.id}`} order={lastOrder} settings={settings} autoPrint={!lastOrder.kotPrinted} />
          )}
          {/* Combined mode: receipt visible + KOT auto-prints as separate cut job (staggered) */}
          {lastOrder && showReceipt && showKitchenReceipt && (
            <>
              {/* v1.2.4: queue already prints paid receipts — no dialog autoPrint. */}
              <ReceiptPreview key={`rcpt-${lastOrder.id}`} order={lastOrder} settings={settings} />
              <div style={{ position: 'absolute', left: '-99999px', top: 0, width: 1, height: 1, overflow: 'hidden' }} aria-hidden="true">
                <KitchenReceipt key={`kot-${lastOrder.id}`} order={lastOrder} settings={settings} autoPrint={!lastOrder.kotPrinted} autoPrintDelayMs={1800} showPrintButton={false} />
              </div>
            </>
          )}
          {lastOrder && lastOrder.status === 'paid' && (
            <Button
              className="w-full mt-2 bg-[#25D366] hover:bg-[#1ebe57] text-white"
              disabled={!normalizePhone(lastOrder.customer?.phone)}
              onClick={() => {
                const phone = normalizePhone(lastOrder.customer?.phone);
                if (!phone) { toast.error('Customer number not available'); return; }
                const msg = lastOrder.orderType === 'delivery'
                  ? buildDeliveryMessage(lastOrder, settings)
                  : buildPaidMessage(lastOrder, settings);
                openWhatsApp(phone, msg);
              }}
            >
              <MessageCircle className="h-4 w-4 mr-1" /> Send WhatsApp Message
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Running Bills Retrieve Dialog */}
      <Dialog open={showRunningBills} onOpenChange={setShowRunningBills}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh]">
          <DialogHeader><DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-status-warning" /> Retrieve Bills
          </DialogTitle></DialogHeader>

          {/* Legend + Summary */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-status-success" /> Running</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-status-warning" /> Hold</span>
            </div>
            {(() => {
              const runCount = filteredBills.filter(o => o.status === 'running').length;
              const holdCount = filteredBills.filter(o => o.status === 'hold').length;
              const totalAmt = filteredBills.reduce((s, o) => s + (o.grandTotal || 0), 0);
              const dineCount = filteredBills.filter(o => o.orderType === 'dining').length;
              const dlvCount = filteredBills.filter(o => o.orderType === 'delivery').length;
              const taCount = filteredBills.filter(o => o.orderType === 'takeaway').length;
              return (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border-2 border-primary/30 bg-primary/5">
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Summary:</div>
                  <Badge className="bg-status-success/15 text-status-success border-status-success/30 text-[10px]">Running: {runCount}</Badge>
                  <Badge className="bg-status-warning/15 text-status-warning border-status-warning/30 text-[10px]">Hold: {holdCount}</Badge>
                  <Badge variant="secondary" className="text-[10px]">Dine: {dineCount}</Badge>
                  <Badge variant="secondary" className="text-[10px]">Dlv: {dlvCount}</Badge>
                  <Badge variant="secondary" className="text-[10px]">T/A: {taCount}</Badge>
                  <div className="text-[11px] font-bold text-primary border-l border-primary/30 pl-2 ml-1">
                    Total: PKR {totalAmt.toLocaleString()}
                  </div>
                </div>
              );
            })()}
          </div>


          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Table, Bill #, Waiter..."
              value={billSearch}
              onChange={e => setBillSearch(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>

          {/* Bill table */}
          <div className="overflow-y-auto pos-scrollbar max-h-[50vh]">
            {filteredBills.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No running/hold bills found</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground bg-muted/50">
                    <th className="text-left py-2 px-2 font-bold">Bill #</th>
                    <th className="text-left py-2 px-2 font-bold">Status</th>
                    <th className="text-left py-2 px-2 font-bold">Table</th>
                    <th className="text-left py-2 px-2 font-bold">Waiter / Rider</th>
                    <th className="text-left py-2 px-2 font-bold">Type</th>
                    <th className="text-left py-2 px-2 font-bold">Time</th>
                    <th className="text-right py-2 px-2 font-bold">Total</th>
                    <th className="text-center py-2 px-2 font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBills.map(order => {
                    const table = order.tableId ? tables.find(t => t.id === order.tableId) : null;
                    const waiter = order.waiterId ? waiters.find(w => w.id === order.waiterId) : null;
                    const isRunning = order.status === 'running';
                    const rowBg = isRunning ? 'bg-status-success/5' : 'bg-status-warning/5';
                    const assignedLabel = order.orderType === 'delivery'
                      ? (order.riderName
                          ? <span><span className="font-semibold">🛵 {order.riderName}</span>{order.riderPhone && <span className="text-muted-foreground"> · {order.riderPhone}</span>}</span>
                          : <span className="text-muted-foreground">No rider</span>)
                      : (waiter?.name
                          ? <span><span className="font-semibold">👤 {waiter.name}</span>{table?.name && <span className="text-muted-foreground"> · {table.name}</span>}</span>
                          : <span className="text-muted-foreground">—</span>);
                    return (
                      <tr key={order.id} className={`border-b hover:bg-accent/50 transition-colors ${rowBg}`}>
                        <td className="py-2 px-2 font-bold">#{order.orderNumber}</td>
                        <td className="py-2 px-2">
                          <Badge className={`text-[10px] ${isRunning ? 'bg-status-success/20 text-status-success border-status-success/30' : 'bg-status-warning/20 text-status-warning border-status-warning/30'}`}>
                            {order.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">{table?.name || (order.orderType === 'delivery' ? 'DLV' : order.orderType === 'takeaway' ? 'T/A' : '—')}</td>
                        <td className="py-2 px-2">{assignedLabel}</td>

                        <td className="py-2 px-2">
                          <Badge variant="secondary" className="capitalize text-[10px]">{order.orderType}</Badge>
                        </td>
                        <td className="py-2 px-2 text-muted-foreground">
                          {new Date(order.createdAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2 px-2 text-right font-bold text-primary">PKR {order.grandTotal.toLocaleString()}</td>
                        <td className="py-2 px-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button size="sm" className="h-8 text-[10px] px-3" onClick={() => retrieveOrder(order)}>
                              Retrieve
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-[10px] px-2 bg-status-success/10 text-status-success border-status-success/30 hover:bg-status-success/20"
                              onClick={() => payBillFromRetrieve(order)}>
                              Pay
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 text-[10px] px-2"
                              onClick={() => { setLastOrder(order); setShowReceipt(true); }}>
                              Print
                            </Button>
                            {isRunning ? (
                              <Button size="sm" variant="outline" className="h-8 text-[10px] px-2 text-status-warning border-status-warning/30 hover:bg-status-warning/10"
                                onClick={() => markBillStatus(order, 'hold')}>
                                Hold
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="h-8 text-[10px] px-2 text-status-success border-status-success/30 hover:bg-status-success/10"
                                onClick={() => markBillStatus(order, 'running')}>
                                Resume
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="h-8 text-[10px] px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                              onClick={() => markBillStatus(order, 'cancelled')}>
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="lg" className="text-sm px-6" onClick={() => setShowRunningBills(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== Size / Inch Variant Picker (Advanced Menu Flow) ===== */}
      <Dialog open={!!variantPickerItem} onOpenChange={(v) => { if (!v) setVariantPickerItem(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {variantPickerItem?.name}
              {variantPickerItem?.subCategory && (
                <span className="text-xs text-muted-foreground font-normal ml-2">· {variantPickerItem.subCategory}</span>
              )}
            </DialogTitle>
          </DialogHeader>
          {variantPickerItem && (() => {
            const showSize = (variantPickerItem.pricingType === 'size' || variantPickerItem.pricingType === 'both')
              && (variantPickerItem.sizeVariants?.length || 0) > 0;
            const showInch = (variantPickerItem.pricingType === 'inch' || variantPickerItem.pricingType === 'both')
              && (variantPickerItem.inchVariants?.length || 0) > 0;
            return (
              <div className="space-y-4">
                {showSize && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Size</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(variantPickerItem.sizeVariants || []).map(v => (
                        <button
                          key={v.name}
                          onClick={() => { addVariantToCart(variantPickerItem, { name: v.name, price: v.price, type: 'size' }); setVariantPickerItem(null); }}
                          className="border rounded-lg p-3 hover:border-primary hover:bg-primary/5 transition-all text-left"
                        >
                          <div className="text-sm font-bold">{v.name}</div>
                          <div className="text-xs text-primary font-extrabold mt-1">{money(v.price)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {showInch && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Inches</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(variantPickerItem.inchVariants || []).map(v => (
                        <button
                          key={v.name}
                          onClick={() => { addVariantToCart(variantPickerItem, { name: v.name, price: v.price, type: 'inch' }); setVariantPickerItem(null); }}
                          className="border rounded-lg p-3 hover:border-primary hover:bg-primary/5 transition-all text-left"
                        >
                          <div className="text-sm font-bold">{v.name}</div>
                          <div className="text-xs text-primary font-extrabold mt-1">{money(v.price)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!showSize && !showInch && (
                  <p className="text-xs text-muted-foreground italic">No variants configured. Go to Menu Manager to add Size or Inch variants.</p>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      {managerGateDialog}
    </div>
  );
}
