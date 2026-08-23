export type PricingType = 'fixed' | 'weight' | 'manual' | 'size' | 'inch' | 'both';

/** A single size / inch variant of a menu item (e.g. Small=450, Medium=850). */
export interface ItemVariant {
  name: string;          // "Small" | "Medium" | "12 Inch" | "9\""
  price: number;
  sku?: string;
  inches?: number;       // numeric inches (for inch variants only)
}
export type OrderType = 'dining' | 'takeaway' | 'delivery' | 'foodpanda';
export type FoodpandaStatus = 'new' | 'preparing' | 'ready' | 'picked' | 'cancelled';
export type OrderStatus = 'running' | 'hold' | 'paid' | 'partial' | 'void' | 'complimentary' | 'cancelled' | 'credit_pending' | 'credit_received' | 'pending_approval' | 'rejected';

/** Online order approval source key (also used for per-source mode setting). */
export type OnlineSourceKey = 'website' | 'qr' | 'order_taker' | 'delivery' | 'takeaway_qr';
/** Resolved approval mode for an incoming online order. */
export type ApprovalMode = 'auto' | 'manual';
export type ApprovalModeSetting = ApprovalMode | 'inherit';

export interface PaymentEntry {
  id: string;
  method: 'cash' | 'online' | 'card' | (string & {});   // custom types allowed (v1.6.1)
  accountId?: string;
  accountName?: string;
  amount: number;
  at: string;            // ISO timestamp
  by?: string;           // cashier name
  note?: string;
}
export type TableStatus = 'free' | 'running' | 'pending-payment' | 'closed';
export type DeliveryStatus = 'pending' | 'cooking' | 'ready' | 'onway' | 'delivered' | 'cancelled' | 'accepted' | 'rider_assigned' | 'rider_picked' | 'rider_reached';
export type UserRole = 'admin' | 'manager' | 'cashier' | 'rider' | 'order_taker';
// v1.6.1 (feedback #2 item 3): custom payment types. The union keeps
// autocomplete for the built-ins; `(string & {})` legally admits restaurant-
// defined names ("NETS", "PayNow", "JazzCash") without weakening to plain
// string everywhere in tooling.
export type PaymentMethod = 'cash' | 'card' | 'online' | 'credit' | (string & {});

export interface Category {
  id: string;
  name: string;
  icon: string;
  image?: string;
  sortOrder: number;
  /** Soft-delete flag — true means moved to Recycle Bin. */
  deleted?: boolean;
  /** Epoch ms when soft-deleted. */
  deletedAt?: number;
}

export interface MenuItem {
  id: string;
  name: string;
  categoryId: string;
  /** v1.9.1 — barcode / SKU for scanner lookup (minimart use). */
  barcode?: string;
  /**
   * v1.14.1 — RETAIL stock link.
   *
   * In a restaurant a dish consumes ingredients, so stock moves through a
   * recipe. In a minimart the product IS the stock item: selling one
   * bottle of Coke must decrement one bottle of Coke, and no recipe will
   * ever exist. Setting this links the menu item straight to an inventory
   * row so sales decrement it directly.
   */
  inventoryItemId?: string;
  /** v1.14.1 — base units consumed per sold unit. Defaults to 1. */
  stockPerUnit?: number;
  /** v1.9.1 — manual display order; lower sorts first. */
  sortOrder?: number;
  pricingType: PricingType;
  price: number; // for fixed
  ratePerKg: number; // for weight-based
  image?: string;
  isActive: boolean;
  kitchenId?: string;       // which kitchen prepares this item (Main / BBQ / Beverage / etc.)
  /** Optional flavor / variation choices. If non-empty, customer must pick one before adding to cart. */
  flavors?: string[];
  // ===== Advanced Menu (Pizza-style variants) =====
  /** Optional flavor / sub-category label e.g. "Pizza Flavors". Drives flavor-layer grouping. */
  subCategory?: string;
  /** Optional grouping label (synonym for subCategory, kept for clarity in imports). */
  flavorGroup?: string;
  /** Size-wise prices (Small/Medium/Large/XL …). Used when pricingType is 'size' or 'both'. */
  sizeVariants?: ItemVariant[];
  /** Inch-wise prices (7\"/9\"/12\" …). Used when pricingType is 'inch' or 'both'. */
  inchVariants?: ItemVariant[];
  /** Soft-delete flag — true means moved to Recycle Bin. */
  deleted?: boolean;
  /** Epoch ms when soft-deleted. */
  deletedAt?: number;
  // ===== v1.3.0 Token Printing =====
  /** Token item — can be sold instantly via the Print Token flow
   *  (counters, festivals, bakery, sweet shops). Default false. */
  isTokenItem?: boolean;
}

export interface Kitchen {
  id: string;
  name: string;             // e.g. "Main Kitchen", "BBQ", "Beverage", "Basement", "Outdoor"
  sortOrder: number;
  color?: string;           // optional accent color
}


export interface CartItem {
  id: string;
  menuItemId: string;
  name: string;
  pricingType: PricingType;
  price: number;
  quantity: number;
  weightGrams?: number;
  lineTotal: number;
  note: string;
  /** How many units of this line have already been sent to the kitchen (KOT printed).
   *  Used for the KOT diff system — only `quantity - printedQty` is printed on the next KOT. */
  printedQty?: number;
  /** Optional station/kitchen routing for this line (e.g. "BBQ", "Bakery"). */
  station?: string;
  // ===== Advanced Menu (Pizza-style variant tracking) =====
  /** Which variant kind was picked, if any. */
  variantType?: 'size' | 'inch';
  /** Display label of the picked variant (e.g. "Medium", "12 Inch"). */
  variantName?: string;
}

/** Kitchen Order Ticket activity log entry. */
export interface KotLogEntry {
  at: string;                      // ISO timestamp
  by?: string;                     // user name
  action: 'created' | 'updated' | 'reprinted';
  addedItems?: Array<{ name: string; quantity: number; note?: string }>;
  removedItems?: Array<{ name: string; quantity: number }>;
  note?: string;
}

/** Permanent KOT revision record — every send-to-kitchen produces one. */
export type KotRevisionType = 'NEW' | 'ADD_ITEMS' | 'QTY_UPDATE' | 'CANCEL_ITEM' | 'MIXED';
export interface KotRevisionLine {
  itemId: string;
  name: string;
  deltaQty: number;        // +n for add/increase, -n for cancel/decrease
  oldQty?: number;
  newQty?: number;
  note?: string;
  reason?: string;
}
export interface KotRevision {
  kotNo: number;                      // 1, 2, 3 …
  type: KotRevisionType;
  lines: KotRevisionLine[];
  createdAt: string;
  createdByUid?: string;
  createdByName?: string;
  createdByRole?: string;
  deviceName?: string;
  printedAt?: string;
  acceptedAt?: string;
  preparedAt?: string;
  servedAt?: string;
}

/** Permanent, append-only edit log entry for an order. */
export type OrderEditAction =
  | 'CREATE' | 'ADD' | 'QTY_UP' | 'QTY_DOWN' | 'QTY_INCREASE' | 'QTY_DECREASE'
  | 'CANCEL' | 'REPLACE'
  | 'DISCOUNT' | 'PAYMENT' | 'VOID' | 'COMPLIMENTARY' | 'CANCEL_ORDER'
  | 'STATUS' | 'REPRINT' | 'NOTE';
export interface OrderEditLog {
  at: string;
  action: OrderEditAction;
  itemId?: string;
  itemName?: string;
  oldValue?: string | number;
  newValue?: string | number;
  reason?: string;
  userUid?: string;
  userName?: string;
  userRole?: string;
  deviceName?: string;
}


export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  // --- Smart Customer DB additions (all optional, backward-compatible) ---
  altPhone?: string;
  email?: string;
  province?: string;
  district?: string;
  city?: string;
  area?: string;
  society?: string;
  street?: string;
  streetNumber?: string;
  houseNumber?: string;
  fullAddress?: string;
  lat?: number;
  lng?: number;
  locationLabel?: string;
  locationCapturedAt?: string;
  /** v1.27.0 — collected by the customer app; used for birthday campaigns. */
  dateOfBirth?: string;
  gender?: 'male' | 'female';
}

export type CustomerGrade = 'platinum' | 'gold' | 'silver' | 'regular';

// ============= CUSTOMER DATABASE (Phase 5 + Smart upgrade) =============
export interface CustomerProfile {
  id: string;               // = normalized phone number (canonical key)
  name: string;
  phone: string;
  addresses: string[];      // legacy: multiple known addresses (free text)
  totalOrders: number;
  totalSpent: number;
  firstOrderAt?: string;
  lastOrderAt?: string;
  tags?: string[];
  notes?: string;
  createdAt: string;

  // --- Smart upgrade fields (all optional) ---
  altPhone?: string;
  email?: string;

  // Structured PK address
  province?: string;
  district?: string;
  city?: string;
  area?: string;
  society?: string;
  street?: string;
  streetNumber?: string;
  houseNumber?: string;
  fullAddress?: string;

  // GPS
  lat?: number;
  lng?: number;
  locationLabel?: string;
  locationCapturedAt?: string;

  // Intelligence cache
  favoriteItemId?: string;
  favoriteItemName?: string;
  favoriteCategoryId?: string;
  favoriteCategoryName?: string;
  avgOrderValue?: number;
  orderFrequencyDays?: number;
  grade?: CustomerGrade;

  // Branch / rider hints
  preferredBranchId?: string;
  lastRiderId?: string;

  // Loyalty Program (Phase 1)
  loyaltyPoints?: number;        // current redeemable balance
  loyaltyLifetimePoints?: number; // total earned (never decreases)

  archivedAt?: string;
}

// ============ PAYMENT ACCOUNTS (Bank / JazzCash / Easypaisa / Cash) ============
export type PaymentAccountType = 'bank' | 'jazzcash' | 'easypaisa' | 'wallet' | 'cash' | 'other';
export interface PaymentAccount {
  id: string;
  name: string;            // e.g. "Meezan Bank", "JazzCash Main"
  accountNumber?: string;  // IBAN / account # / mobile #
  accountTitle?: string;   // account holder
  type: PaymentAccountType;
  isActive: boolean;
  openingBalance?: number; // optional opening
  notes?: string;
  sortOrder?: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  orderType: OrderType;
  status: OrderStatus;
  // ===== v1.3.0 Token Printing =====
  // A token sale is a NORMAL order (same collection, same reports, same
  // inventory) with these extra stamps — never a parallel sales system.
  /** True when this order was created through the Print Token flow. */
  isTokenSale?: boolean;
  /** Sequential token number shown on the slip (resets daily if configured). */
  tokenNumber?: number;
  /** Display string incl. prefix, e.g. "T-014". */
  tokenLabel?: string;
  /** Token workflow state — pending → completed, or cancelled. */
  tokenStatus?: 'pending' | 'completed' | 'cancelled';
  /** When the token was marked completed/collected. */
  tokenCompletedAt?: string;
  /** How many times the token slip was reprinted. */
  tokenReprintCount?: number;
  branchId?: string;            // Phase 6 — which branch this order belongs to
  source?: 'pos' | 'website' | 'whatsapp' | 'rider' | 'phone' | 'qr' | 'order_taker'; // order origin
  tableLabel?: string;          // QR table label (e.g. "Table 5") for QR orders
  tableId?: string;
  tableName?: string;
  waiterId?: string;
  waiterName?: string;
  riderId?: string;
  riderName?: string;
  riderPhone?: string;
  cashierName?: string;
  cashierId?: string;
  customer?: Customer;
  items: CartItem[];
  subtotal: number;
  discount: number;
  discountPercent?: number;     // when % discount used
  discountTitle?: string;       // e.g. "Eid Discount 10%"
  tax: number;
  serviceCharge: number;
  serviceChargePercent: number;
  grandTotal: number;
  /**
   * v1.12.1 — set when this bill was folded into another during a table
   * Merge. The order is voided so it stops being a sale, but a merge is
   * NOT a refund: no money left the drawer. Refund/cash-drawer logic uses
   * this stamp to tell the two cases apart.
   */
  mergedIntoOrderId?: string;
  /** v1.15.0 — cumulative money refunded on this order. */
  refundedAmount?: number;
  /** v1.15.0 — cumulative units refunded on this order. */
  refundedQty?: number;
  /** v1.12.1 — set on a bill created by splitting another table's bill. */
  splitFromOrderId?: string;

  // ===== v1.9.0 PRA EIMS (Punjab Revenue Authority) =====
  /** Submission state for the fiscal invoice. Absent = never attempted. */
  praStatus?: 'pending' | 'sent' | 'failed' | 'skipped';
  /** Fiscal Invoice Number returned by PRA — printed on the receipt. */
  praInvoiceNumber?: string;
  /** ISO timestamp of the accepted submission. */
  praSubmittedAt?: string;
  /** Last error, kept for the operator and the audit trail. */
  praError?: string;

  // ===== v1.5.0 tax breakdown stamps (for receipts / reports) =====
  taxMode?: 'none' | 'exclusive' | 'inclusive';
  taxPercent?: number;
  taxLabel?: string;
  /** For inclusive mode: portion of grandTotal that is not tax. */
  netOfTax?: number;
  // ===== v1.6.0 payment correction audit (feedback #2 item 5) =====
  /** History of payment-method corrections (never deleted). */
  paymentCorrections?: Array<{
    at: string;
    by: string;
    fromMethod?: string;
    fromAccountName?: string;
    toMethod: string;
    toAccountId?: string;
    toAccountName?: string;
  }>;
  paymentMethod?: PaymentMethod;
  paymentAccountId?: string;    // which payment account received the money (online/card)
  paymentAccountName?: string;  // denormalized for reports
  cashReceived?: number;        // takeaway / cash sales
  changeReturned?: number;      // cashReceived - grandTotal
  deliveryStatus?: DeliveryStatus;
  dispatchedAt?: string;        // when rider left
  deliveredAt?: string;         // when marked delivered
  riderPingedAt?: string;       // last live GPS ping timestamp from rider
  // Kitchen workflow: pending → accepted → preparing → ready → delivered (legacy: 'served' === 'delivered')
  kitchenStatus?: 'pending' | 'accepted' | 'preparing' | 'ready' | 'served' | 'delivered';
  kitchenStatusAt?: string;     // last status change
  createdAt: string;
  paidAt?: string;
  /** Sum of all received payments. For legacy fully-paid orders, equals grandTotal. */
  amountPaid?: number;
  /** History of split / partial payments. Empty/undefined for legacy single-method orders. */
  payments?: PaymentEntry[];
  notes: string;
  voidReason?: string;
  voidBy?: string;
  voidedAt?: string;
  complimentaryReason?: string;
  complimentaryBy?: string;
  complimentaryAt?: string;
  cancelReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  // Discount mode (Phase 6)
  discountType?: 'fixed' | 'percent';
  discountValue?: number;
  // Promo code applied (Phase 11)
  promoCode?: string;
  promoCodeDiscount?: number;
  creditCustomerName?: string;
  creditCustomerPhone?: string;
  creditCustomerAddress?: string;
  // Delivery tracking (rider foundation)
  delivery?: {
    customerLat?: number;
    customerLng?: number;
    customerIp?: string;          // captured at website checkout (best-effort)
    customerUserAgent?: string;   // browser UA at website checkout
    customerCity?: string;        // free-text city from form
    distanceFromRestaurantKm?: number; // restaurant → customer (computed at order time)
    riderLat?: number;
    riderLng?: number;
    distanceKm?: number;
    etaMinutes?: number;
    route?: Array<{ lat: number; lng: number; t: string }>;
    acceptedAt?: string;
    riderAssignedAt?: string;
    riderPickedAt?: string;
    onTheWayAt?: string;
    reachedAt?: string;
    startedAt?: string;
    completedAt?: string;
  };
  // Reprint tracking — every reprint logs who/when/which slip
  reprintLog?: Array<{ at: string; by?: string; type: 'receipt' | 'kot' | 'token' }>;
  reprintCount?: number;
  // ===== Centralized print tracking (one-phase printing) =====
  kotPrinted?: boolean;          // KOT slip already sent to kitchen — guards duplicate KOT
  kotFirstPrintedAt?: string;    // ISO — when the very first KOT was printed
  kotLastPrintedAt?: string;     // ISO — when the most recent KOT (incl. updates) was printed
  kotPrintCount?: number;        // total KOT prints (initial + updates + reprints)
  kotLog?: KotLogEntry[];        // full KOT activity history (created / updated / reprinted)
  /** Permanent KOT revision ledger (one entry per Send to Kitchen). */
  kotRevisions?: KotRevision[];
  /** Append-only edit history (cashier qty changes, cancellations, discounts, etc.). */
  editLogs?: OrderEditLog[];

  receiptPrinted?: boolean;      // customer receipt already printed (at payment)
  printStatus?: 'none' | 'pending' | 'printed' | 'failed';
  printCount?: number;           // total successful print jobs for this order
  lastPrintedAt?: string;        // ISO timestamp of last successful print
  // ===== Loyalty redemption =====
  loyaltyPointsUsed?: number;    // points deducted from customer balance at checkout
  loyaltyRedeemValue?: number;   // PKR value redeemed (= points * redeemRate)
  // ===== Self-Pickup (online) =====
  pickupRequested?: boolean;     // customer chose Self-Pickup instead of Delivery
  pickupTime?: string;           // ISO or label like "30 min"
  pickupCollectedAt?: string;    // ISO — when counter handed over the order
  // ===== Auto-cooking / auto-ready timer =====
  cookingStartedAt?: string;     // when KOT printed → auto cooking
  readyAt?: string;              // when auto/manual marked ready
  prepTimeMinutes?: number;      // per-order prep override; falls back to settings.defaultPrepTimeMinutes
  // ===== Online order approval workflow =====
  approvalRequired?: boolean;    // true when this order entered the approval queue
  approvedBy?: string;           // user id
  approvedByName?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectedReason?: string;
  // ===== Foodpanda integration (optional, gated by settings.foodpandaEnabled) =====
  foodpandaStatus?: FoodpandaStatus;        // status pipeline for Foodpanda orders
  foodpandaRef?: string;                    // external Foodpanda reference / order id
  foodpandaStatusAt?: string;               // last status change
  foodpandaPickedAt?: string;
  foodpandaCancelledAt?: string;
}

export type TableShape = 'round' | 'square' | 'rectangle';
export interface TableSession {
  seatedAt: string;
  freedAt: string;
  durationMinutes: number;
  orderId?: string;
  orderNumber?: number;
  guests?: number;
  total?: number;
}
export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  status: TableStatus;
  currentOrderId?: string;
  /**
   * Which branch this table physically stands in.
   *
   * ===== v1.26.4 — the column existed; the model did not =====
   * dining_tables.branch_id has always been a real column, is in
   * ALLOWED_COLUMNS, and is written on every sync — but it was absent from
   * this interface, so nothing in the app could read it. Tables were therefore
   * treated as restaurant-wide: a QR order could not tell which branch its
   * table belonged to, and two branches with a "Table 5" were indistinguishable.
   */
  branchId?: string;
  floorId?: string;     // optional — which floor this table belongs to
  x?: number;           // layout coords for floor map (px within container)
  y?: number;
  shape?: TableShape;   // visual shape: round / square / rectangle
  seatedAt?: string;    // when current guests sat down
  seatedGuests?: number; // how many guests currently seated (selected when seating)
  sessions?: TableSession[]; // history: each completed dine session
}

export interface Floor {
  id: string;
  name: string;         // e.g. "Ground", "First Floor", "Outdoor", "Car Dining"
  sortOrder: number;
  /** Branch this floor belongs to. floors.branch_id exists and is synced. */
  branchId?: string;
}


export interface Waiter {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
}

export interface Rider {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  /** 4-digit PIN for public rider portal login. Default '0000' if unset. */
  pin?: string;
  bikeNumber?: string;          // bike registration
  lastSeenAt?: string;          // ISO — last heartbeat from rider app
  loyaltyPoints?: number;       // earned per delivered order (configurable)
  totalDeliveries?: number;     // lifetime delivered count (denormalized)
}

export interface User {
  id: string;
  username: string;
  password: string; // hashed in production
  name: string;
  role: UserRole;
  /** Branch this user is locked to (Order Taker / Cashier). Admin/Manager can switch branches freely. */
  branchId?: string;
  isActive: boolean;
  /** Optional per-user page access overrides. If undefined or empty, role defaults are used. */
  permissions?: string[];
  /** Optional per-user feature/action permissions (discount, void, refund, price-edit, etc.). */
  featurePermissions?: string[];
  /** Phone number — used by Order Taker / Rider portal for phone+PIN login. */
  phone?: string;
  /** 4-digit numeric PIN for portal login (Order Taker, Rider). */
  pin?: string;
}

export type UrduFontOption = 'default' | 'Aseer Unicode' | 'AA Sameer Armaa' | 'Jameel Noori Nastaleeq' | 'Jameel Noori Nastaleeq Regular' | 'Montserrat' | 'Norvas Demo Expanded' | 'Regaltion Highter';
export type TextAlign = 'left' | 'center' | 'right';

export interface ReceiptTextStyle {
  font: UrduFontOption;
  size: number; // px
  align: TextAlign;
  bold: boolean;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  body: string;
}

export interface RestaurantSettings {
  name: string;
  address: string;
  // ===== v1.4.0 international =====
  /** ISO 4217 currency code (PKR, SGD, USD…). Default PKR so existing
   *  restaurants are unaffected by the upgrade. */
  currencyCode?: string;
  /** Country label shown in settings — informational, drives nothing. */
  countryName?: string;
  phone1: string;
  phone2: string;
  marketingFooter?: string;
  // ============ PREMIUM THEME (allotted by Super Admin) ============
  /** Super Admin ne is restaurant ko premium VINCE theme allot kiya hai */
  premiumThemeAllowed?: boolean;
  /** Restaurant owner ne premium theme khud enable kiya hai (Settings → Theme) */
  premiumThemeEnabled?: boolean;
  // ============ BUSINESS DAY TIMING (Shift) ============
  /** Business day start time, "HH:MM" 24h local. Default 08:00 */
  businessDayStart?: string;
  /** Business day close time, "HH:MM" 24h local. May wrap past midnight (e.g. 03:00). Default 03:00 */
  businessDayClose?: string;
  whatsappTemplates?: WhatsAppTemplate[];
  defaultPaidWhatsAppTemplateId?: string;
  defaultDeliveryWhatsAppTemplateId?: string;
  // ============ CUSTOMER-FACING WHATSAPP (floating button on website) ============
  supportWhatsappNumber?: string;       // E.g. "923001234567" — falls back to phone1
  whatsappFloatingEnabled?: boolean;    // show floating WA button on /order /track (default true)
  whatsappFloatingMessage?: string;     // pre-filled message (default greeting)
  // ============ KITCHEN AUTO-FLOW ============
  defaultPrepTimeMinutes?: number;      // auto-ready timer (default 20)
  autoReadyEnabled?: boolean;           // master toggle (default true)
  autoCookingOnKot?: boolean;           // KOT print → cooking (default true)
  // ============ RIDER LOYALTY ============
  riderLoyaltyEnabled?: boolean;        // (default true)
  riderLoyaltyPerDelivery?: number;     // points per delivered order (default 1)
  logo: string;
  logoWidth: number;
  logoHeight: number;
  // ============ PER-SURFACE LOGOS (each surface has its own logo) ============
  // If empty/null, falls back to `logo` (receipt logo) for backward compatibility.
  appLogo?: string;           // Admin/POS app sidebar + Login screen
  webPortalLogo?: string;     // Online ordering portal + Track Order page
  orderTakerLogo?: string;    // Order Taker portal (mobile/tablet app)
  // Restaurant physical location (admin sets once — shows on Super Admin map)
  restaurantLat?: number;
  restaurantLng?: number;
  restaurantLocationLabel?: string;
  receiptFooter: string;
  thankYouText?: string;       // Editable "Thank You!" line on customer receipts (default: "Thank You!")
  visitAgainText?: string;     // Editable "Please Visit Again" line on customer receipts
  kotThankYouText?: string;    // Editable footer text on KOT (default: "— Thank You —")
  kotFooterNote?: string;      // Editable secondary note on KOT (default: "Please check the order before preparing")
  taxAmount: number;
  serviceChargePercent: number;
  qrMode: 'auto' | 'custom';
  customQrImage: string;
  customQrWidth?: number; // px, default 80
  customQrHeight?: number; // px, default 80
  bankName: string;
  urduFont: 'none' | 'Aseer Unicode' | 'AA Sameer Armaa' | 'Jameel Noori Nastaleeq' | 'Jameel Noori Nastaleeq Regular';
  // Per-element receipt text styles
  receiptStyles?: {
    restaurantName?: ReceiptTextStyle;
    address?: ReceiptTextStyle;
    phone?: ReceiptTextStyle;
    orderId?: ReceiptTextStyle;
    items?: ReceiptTextStyle;
    totals?: ReceiptTextStyle;
    footer?: ReceiptTextStyle;
    status?: ReceiptTextStyle;
    customerDetails?: ReceiptTextStyle;
     visitAgain?: ReceiptTextStyle;
     marketingFooter?: ReceiptTextStyle;
  };
  // POS display styles
  categoryStyle?: ReceiptTextStyle;
  menuItemStyle?: ReceiptTextStyle;
  // Printer settings
  defaultPrinter?: string;     // Receipt printer (POS bills)
  kotPrinter?: string;         // Kitchen (KOT) printer — separate from receipt; falls back to defaultPrinter if empty
  tokenPrinter?: string;       // Token / customer-token printer — falls back to receipt printer if empty
  silentPrint?: boolean;
  paperSize?: '58mm' | '80mm' | '110mm'; // thermal paper width
  receiptMode?: 'continuous' | 'paged';
  printHeaderFooter?: boolean;
  printerDriverType?: 'windows' | 'escpos';
  receiptSizePreset?: 'compact-80' | 'standard-80' | 'bold-80';
  disableExtraFeed?: boolean;
  autoCut?: boolean;
  cutMode?: 'full' | 'partial';
  // Receipt scale & margins
  receiptScale?: number; // percentage 50-150, default 100
  receiptMarginTop?: number; // mm
  receiptMarginBottom?: number; // mm
  receiptMarginLeft?: number; // mm
  receiptMarginRight?: number; // mm
  receiptTrimMm?: number; // mm to trim from end of receipt to remove trailing blank paper (default 8)
  // Receipt design template
  receiptDesign?: 'standard' | 'pre-receipt' | 'compact-thermal' | 'classic' | 'modern' | 'compact' | 'luxury' | 'executive' | 'royal' | 'bistro' | 'heritage' | 'metro' | 'shahenshah' | 'taste-bistro' | 'food-palace' | 'spice-house' | 'taimoor' | 'design1-table' | 'design2-box' | 'design3-modern' | 'design4-compact' | 'design5-delivery' | 'sero' | 'bero' | 'kot-style' | 'kot-classic';
  // ===== Standard Receipt section toggles (default ON) =====
  receiptShowLogo?: boolean;
  receiptShowAddress?: boolean;
  receiptShowPhone?: boolean;
  receiptShowDiscount?: boolean;
  receiptShowTax?: boolean;
  receiptShowFooter?: boolean;
  receiptShowPoweredBy?: boolean;
  receiptCompactMode?: boolean;
  receiptCompactFontSize?: number;   // px, default 11 (used when Compact Mode ON)
  receiptCompactLineHeight?: number; // unitless, default 1.15
  receiptCompactPreserveLogo?: boolean; // default true — logo prints at its set size, ignore compact image cap
  supportPhone?: string;
  // Kitchen print
  autoKitchenPrint?: boolean; // auto print kitchen receipt on order
  kotDesign?: 'classic' | 'bold' | 'minimal' | 'elegant' | 'vip-chef' | 'station' | 'taimoor1' | 'taimoor2'; // KOT template
  kotShowLogo?: boolean;
  kotShowAddress?: boolean;
  kotShowPhone?: boolean;
  kotShowCustomer?: boolean;
  kotShowCustomerAddress?: boolean; // show delivery/customer address on KOT (default off)
  kotShowWaiter?: boolean;
  kotShowRider?: boolean;
  kotShowNotes?: boolean;
  // Preset special notes — quick-pick chips shown on POS / Order Taker cart. User can still type manually.
  kotNotePresets?: string[];

  kotShowDateTime?: boolean;
  kotCombinedPrint?: boolean; // also print KOT alongside receipt (separate auto-cut job)
  kotFallbackToReceipt?: boolean; // if kotPrinter is empty, use defaultPrinter for KOT (default true)
  kotMirrorToReceiptPrinter?: boolean; // ALSO print a duplicate KOT on the Cash/Receipt printer (verification copy)
  // KOT text styling — font / size / weight / align applied to KOT print text
  kotStyles?: {
    header?: ReceiptTextStyle;   // restaurant name + title at top of KOT
    items?: ReceiptTextStyle;    // item rows (main body text)
    footer?: ReceiptTextStyle;   // footer / notes / "kitchen copy"
  };
  // Auto-KOT trigger toggles (Phase 2 — Order Taker module)
  autoKotOnOrderTakerSave?: boolean;   // when Order Taker saves an order — default true
  autoKotOnOnlineOrder?: boolean;      // when new website order arrives — default true
  autoKotOnDeliveryRunning?: boolean;  // when delivery moves to cooking/onway — default true
  // ============ PROFESSIONAL PRINTING SETTINGS (Print Service) ============
  kotEnabled?: boolean;                 // master KOT printing ON/OFF (default true)
  autoPrintKot?: boolean;               // auto print KOT on new order (default true) — master switch
  // Per-orderType auto-KOT switches. Undefined = follow autoPrintKot. False = disabled for this type.
  autoKotDining?: boolean;              // dine-in orders auto KOT (default: follow autoPrintKot)
  autoKotTakeaway?: boolean;            // takeaway orders auto KOT (default: follow autoPrintKot)
  autoKotDelivery?: boolean;            // delivery orders auto KOT (default: follow autoPrintKot)
  // Print a CANCELLATION KOT to the kitchen when an order is cancelled/voided so cooking stops.
  printKotOnCancel?: boolean;           // default true
  manualSendToKitchen?: boolean;        // require cashier "Send to Kitchen" for online/QR (default false)
  kotSilentMode?: boolean;              // HOLD all auto KOT prints until user manually releases (default false)
  /** KOT update printing mode when an existing order is modified.
   *  'only_changes' (default) — print only newly-added / cancelled items
   *  'full' — reprint entire updated order
   *  'ask'  — cashier chooses each time */
  kotUpdateMode?: 'only_changes' | 'full' | 'ask';
  printerType?: 'browser' | 'network' | 'usb' | 'silent';  // how KOT/receipt is sent (default browser)
  kotCopies?: number;                   // 1 / 2 / 3 (default 1)
  autoPrintCustomerReceipt?: boolean;   // auto print customer receipt on payment (default false)

  // ===== v1.2.5 NEW OPTIONS =====
  /** Print customer receipts ONLY for paid bills. Running/hold/unpaid slips
   *  are skipped entirely. Default false = existing behaviour (unpaid slips
   *  still print), so restaurants relying on them are unaffected. */
  paidOnlyReceipts?: boolean;
  /** Hide the big UNPAID / RUNNING status band on printed receipts.
   *  Default false = band still shows (unchanged behaviour). */
  hideUnpaidBadgeOnReceipt?: boolean;
  /** Require an admin/manager password before an item can be removed or
   *  voided from a bill. Default false = no password (unchanged). */
  requirePasswordForItemRemove?: boolean;

  // ===== v1.3.0 Token Printing =====
  /** Master switch for the Token module. Default false — module hidden,
   *  zero impact on restaurants that don't need tokens. */
  tokenModuleEnabled?: boolean;
  /** Include token revenue in sales reports. OFF = count quantity only,
   *  hide prices in token reports. Default true. */
  tokenIncludeRevenueInReports?: boolean;
  /** Print a QR code on the token slip. Default false. */
  tokenSlipQr?: boolean;
  /** Daily reset of the token counter. Default true. */
  tokenCounterDailyReset?: boolean;
  /** Optional prefix on the token number, e.g. "T". */
  tokenPrefix?: string;
  /** Token slip design. 4 layouts — see TokenSlip.tsx. Default 'classic'. */
  tokenTemplate?: 'classic' | 'stars' | 'boxed' | 'compact';
  /** Heading printed on the token slip. Default "TANDOOR TOKEN". */
  tokenSlipTitle?: string;
  /** Footer line under the token number. */
  tokenSlipFooter?: string;
  /** Show restaurant logo on the token slip. Default true. */
  tokenSlipLogo?: boolean;

  // ===== v1.5.0 Service Charge + GST/Tax engine =====
  /** 'none' preserves old behaviour (flat legacy tax amount, unchanged for
   *  existing restaurants). 'exclusive' adds GST on top. 'inclusive' means
   *  menu prices already include GST. */
  taxMode?: 'none' | 'exclusive' | 'inclusive';
  /** GST/VAT percentage, e.g. 9 for 9%. */
  taxPercent?: number;
  /** Is the service charge itself part of the taxable base? Default true. */
  taxOnServiceCharge?: boolean;
  /** Receipt label, e.g. "GST", "VAT", "Sales Tax". Default "GST". */
  taxLabel?: string;
  /** Round the final grand total to a whole currency unit. Default false. */
  roundGrandTotal?: boolean;
  /** v1.9.1 — cash rounding increment (0.05 for Singapore 5c). 0 = off. */
  roundToNearest?: number;
  /** v1.9.1 — barcode / SKU on menu items (minimart & scanner support). */
  barcodeEnabled?: boolean;
  /** v1.11.0 — shift open/close + cash drawer tracking. Default OFF. */
  shiftsEnabled?: boolean;
  /**
   * v1.12.0 — quick-discount preset buttons (feedback #1 item 11).
   * Percent values, e.g. [5, 10, 15, 20]. Empty/undefined = no buttons,
   * which is exactly how the POS behaved before, so nothing changes for
   * a restaurant that never configures them.
   */
  discountPresets?: number[];
  /** v1.12.0 — one-tap Rs presets, e.g. [50, 100, 200]. */
  discountPresetsAmount?: number[];
  /** v1.14.0 — UI language for this restaurant (also stored per device). */
  appLanguage?: string;
  /** v1.10.0 — business type chosen at setup; drives default module presets. */
  businessType?: string;
  /** v1.10.0 — true once the Business Type screen has been completed (or skipped). */
  businessTypeSetupDone?: boolean;

  /** v1.9.0 — PRA EIMS master switch. Default OFF (multi-tenant rule):
   *  only restaurants that are PRA-registered ever see or use this. */
  praEimsEnabled?: boolean;
  /** v1.9.0 — per-restaurant PRA configuration (never shared across tenants). */
  praConfig?: {
    enabled: boolean;
    posId: string;
    environment: 'sandbox' | 'production';
    transport: 'local' | 'cloud';
    cloudToken?: string;
    localBaseUrl?: string;
    sellerPntn?: string;
    branchLabel?: string;
    printOnReceipt: boolean;
  };

  /** v1.6.1 (feedback #2 item 3): master switch for restaurant-defined
   *  payment types. Default OFF (multi-tenant safety rule). */
  customPaymentTypesEnabled?: boolean;
  /** v1.6.1: restaurant-defined payment type names, e.g. ["NETS", "PayNow",
   *  "GrabPay"]. Only used when customPaymentTypesEnabled is ON. */
  customPaymentTypes?: string[];

  // ===== v1.6.0 Item Sales Report module =====
  /** Sidebar page + report engine. Default OFF (multi-tenant safety). */
  /**
   * v1.18.0 — route cloud reads/writes to Supabase instead of Firebase.
   * Default OFF. Offline billing, printing and the deferred queue are
   * unchanged; only the write target moves.
   */
  supabaseBackendEnabled?: boolean;
  itemSalesReportEnabled?: boolean;
  autoPrintRiderSlip?: boolean;         // auto print rider slip when rider assigned (default true)
  // ===== Phase-3 Print Automation Polish =====
  backupPrinter?: string;               // fallback printer used if primary fails after retries
  autoReprintOnFailure?: boolean;       // when retries exhaust, auto-switch to backup printer (default true)
  offlinePrinterAlert?: boolean;        // show persistent banner when printer offline (default true)
  /** Per-station KOT printer assignment: kitchenId -> printer name. */
  stationPrinters?: Record<string, string>;
  // Display settings
  displayEnabled?: boolean;
  displayShowItems?: boolean;
  displayShowTotal?: boolean;
  displayFullscreen?: boolean;
  displayPromoImages?: string[]; // base64 images for slideshow
   kitchenPreparingMinutes?: number;
   kitchenWarningMinutes?: number;
  // Cost & profit tracking master switch — OFF by default; when OFF the
  // app hides all food-cost, margin, profitability and valuation features
  // and behaves as a simple billing + stock system.
  costTrackingEnabled?: boolean;
  // POS menu grid columns per row (3-6)
  menuGridColumns?: number;
  // POS category display: 'top' (horizontal ribbon) or 'side' (left vertical sidebar)
  categoryLayout?: 'top' | 'side';

  // ============ DISCOUNT MANAGEMENT ============
  pkrDiscountEnabled?: boolean;         // manual PKR discount allowed (default true)
  percentDiscountEnabled?: boolean;     // manual % discount allowed (default true)
  /** When TRUE, cashier cannot apply discount in POS — must request via Bill Editor → Admin approval. Admin/Manager always allowed. Default FALSE. */
  cashierDiscountRequiresApproval?: boolean;
  eventDiscountEnabled?: boolean;       // auto-apply event discount on every bill
  eventDiscountTitle?: string;          // e.g. "Eid Discount"
  eventDiscountType?: 'percent' | 'pkr'; // default 'percent'
  eventDiscountPercent?: number;        // 0-100 (used when type='percent')
  eventDiscountAmount?: number;         // flat PKR (used when type='pkr')

  // ============ LOYALTY PROGRAM ============
  loyaltyEnabled?: boolean;             // master switch (default false)
  loyaltyEarnPerRs100?: number;         // points earned per Rs. 100 spent (default 1)
  loyaltyRedeemRate?: number;           // Rs. value of 1 point (default 1)
  loyaltyMinRedeemPoints?: number;      // minimum points required to redeem (default 100)

  // Online ordering portal (Phase 1)
  onlineOrderEnabled?: boolean;
  onlineDeliveryEnabled?: boolean;
  onlinePickupEnabled?: boolean;
  allowGuestCheckout?: boolean;
  deliveryRadiusKm?: number;
  deliveryCharge?: number;       // flat PKR added on every delivery order
  freeDeliveryThreshold?: number; // subtotal above which delivery is free
  minOnlineOrder?: number;       // minimum subtotal for online order
  // Online website branding (shown on /order, /track, /rider-portal)
  onlineBanner?: string;          // base64 / URL hero banner image
  onlineTagline?: string;         // short tagline under restaurant name
  onlineAbout?: string;           // about / welcome paragraph
  onlineBrandColor?: string;      // hex e.g. "#7c3aed" — overrides primary on public pages
  discountExcludedCategoryIds?: string[]; // categories excluded from any discount
  discountExcludedItemIds?: string[];     // specific items excluded

  // ============ QR CODE ============
  qrEnabled?: boolean;                  // master QR ON/OFF (default true = legacy behavior)
  qrType?: 'auto' | 'bank' | 'jazzcash-easypaisa' | 'custom';

  // ============ LOCATION & PRIVACY ============
  /** Master toggle. When false, no location prompts or tracking anywhere. */
  locationTrackingEnabled?: boolean;
  trackRestaurantLocation?: boolean;
  trackDeviceLocation?: boolean;
  trackRiderLocation?: boolean;
  trackCustomerLocation?: boolean;

  // ============ SELF-PICKUP ============
  selfPickupEnabled?: boolean;            // show Self-Pickup option in customer cart
  pickupTimeSlots?: number[];             // minutes: [15, 30, 45, 60]
  pickupReadyMessage?: string;            // WhatsApp template when order ready

  // ============ CITY DIRECTORY ============
  /** Cities the owner has enabled — drives the BranchesPage city dropdown so users don't pick from a huge list each time. */
  enabledCities?: string[];

  // ============ DELIVERY SERVICE AREAS (manual entry) ============
  /** Manually-added service cities (free text, owner-configured). Used in delivery dropdowns. */
  serviceCities?: string[];
  /** Manually-added service areas / neighborhoods (free text). Used in delivery dropdowns. */
  serviceAreas?: string[];
  /** Optional GPS / map link per city or area, keyed by name (city OR `${city}::${area}`). */
  serviceLocations?: Record<string, { lat?: number; lng?: number; mapUrl?: string }>;

  // ============ ONLINE ORDER APPROVAL ============
  /** Global approval mode for all online orders. Default 'auto'. */
  onlineOrderApprovalMode?: ApprovalMode;
  /** Per-source override. 'inherit' = use global. */
  sourceApprovalMode?: Partial<Record<OnlineSourceKey, ApprovalModeSetting>>;

  // ============ EXTERNAL WEBSITE LINK ============
  // Optional URL of restaurant's own website (built externally) — used in receipts, online portal, etc.
  externalWebsiteUrl?: string;

  // ============ ADVANCED MENU FLOW (Flavors + Size/Inch Variants) ============
  /** Master toggle. OFF (default) = classic Category → Item → Cart. ON = enables flavor + size pickers. */
  advancedMenuFlow?: boolean;
  /** When ON, categories with items carrying subCategory show a flavor grid before the items grid. */
  enableFlavorLayer?: boolean;

  // ============ FOODPANDA INTEGRATION ============
  /** Master toggle. When true, POS shows a 4th order type "Foodpanda". Default OFF (only Dine-In/Takeaway/Delivery shown). */
  foodpandaEnabled?: boolean;
}

// ============ CREDIT / UDHAAR PAYMENTS ============
export interface CreditPayment {
  id: string;
  orderId: string;            // links to Order with paymentMethod === 'credit'
  customerName?: string;
  customerPhone?: string;
  amount: number;             // PKR received
  method: PaymentMethod;      // cash / card / online
  date: string;               // ISO
  receivedBy?: string;
  note?: string;
}

// ============= RECIPES (BOM) =============
export interface RecipeComponent {
  inventoryItemId: string;
  quantity: number;      // amount consumed per 1 unit of menu item (for fixed) OR per 1 kg (for weight items)
  unit: string;          // display unit (g, ml, pcs)
}

export interface Recipe {
  id: string;                // unique per (menuItemId, variantKey)
  menuItemId: string;
  /** Optional variant scope — e.g. "size:Medium" or "inch:12 Inch". Empty/undefined = default recipe for the item. */
  variantKey?: string;
  components: RecipeComponent[];
  notes?: string;
}

// ============= WASTAGE =============
export type WastageReason = 'expired' | 'damaged' | 'spilled' | 'returned' | 'staff-meal' | 'other';

export interface Wastage {
  id: string;
  date: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
  costValue: number;          // qty * costPrice at time of entry
  reason: WastageReason;
  note?: string;
  recordedBy?: string;
}

export interface UnitConversion {
  unit: string;     // purchase / recipe unit name, e.g. "Gatta", "Bag", "Carton"
  factor: number;   // how many BASE units = 1 of this `unit` (e.g. 1 Gatta = 20 kg → factor 20)
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  categoryId: string;
  costPrice: number;       // per BASE unit (manually set or last received)
  avgCostPrice?: number;   // moving-average per BASE unit (auto-maintained by Receiving)
  salePrice: number;
  quantity: number;        // stock in BASE unit
  unit: string;            // legacy display unit (kept for backward compat)
  baseUnit?: 'kg' | 'g' | 'l' | 'ml' | 'pcs'; // canonical stock unit
  conversions?: UnitConversion[];             // custom purchase-unit conversions
  lowStockThreshold: number;
  image?: string;
  isActive: boolean;
}

export interface StockLog {
  id: string;
  inventoryItemId: string;
  type: 'in' | 'out' | 'adjustment' | 'sale';
  quantity: number;
  note: string;
  date: string;
}

// ============= HR MODULE =============
export type EmployeeStatus = 'active' | 'inactive';
export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'half-day';
export type LeaveType = 'casual' | 'sick' | 'annual' | 'unpaid';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface Employee {
  id: string;
  empCode: string;
  name: string;
  fatherName?: string;
  cnic?: string;
  phone: string;
  address?: string;
  designation: string;
  department?: string;
  joiningDate: string;
  basicSalary: number;
  allowances?: number;
  status: EmployeeStatus;
  photo?: string;
  notes?: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  inTime?: string;
  outTime?: string;
  note?: string;
}

export interface Leave {
  id: string;
  employeeId: string;
  type: LeaveType;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  appliedAt: string;
  approvedBy?: string;
}

export interface Payslip {
  id: string;
  employeeId: string;
  month: string; // YYYY-MM
  workingDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  basicSalary: number;
  allowances: number;
  overtime: number;
  bonus: number;
  advance: number;
  loanDeduction: number;
  otherDeductions: number;
  netSalary: number;
  paidAt?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

export interface Advance {
  id: string;
  employeeId: string;
  amount: number;
  date: string;
  reason: string;
  recovered: boolean;
}

// ============= ACCOUNTS MODULE =============
export type TxnType = 'income' | 'expense';
export type LedgerType = 'supplier' | 'customer';

export interface AccountCategory {
  id: string;
  name: string;
  type: TxnType;
}

export interface Transaction {
  id: string;
  date: string;
  type: TxnType;
  categoryId: string;
  categoryName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  description: string;
  reference?: string;
  partyId?: string; // supplier or customer
  partyName?: string;
  createdBy?: string;
}

export interface Party {
  id: string;
  type: LedgerType;
  name: string;
  phone?: string;
  address?: string;
  openingBalance: number; // +ve = they owe us, -ve = we owe them
  isActive: boolean;
}

export interface LedgerEntry {
  id: string;
  partyId: string;
  date: string;
  description: string;
  debit: number;  // they owe us
  credit: number; // we owe them / payment received
  reference?: string;
}

export interface DailyCashClose {
  id: string;
  date: string;
  openingCash: number;
  totalSales: number;
  totalExpense: number;
  totalReceipts: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  closedBy: string;
  notes?: string;
}

export interface ReceivingEntry {
  id: string;
  supplierName: string;
  inventoryItemId?: string;   // link to inventory item (new entries)
  itemName: string;
  quantity: number;           // qty in purchase unit
  unit: string;               // purchase unit (Gatta, Bag, kg, ...)
  baseQty?: number;           // converted qty in item's base unit
  baseUnit?: string;          // base unit at time of receipt
  rate: number;               // rate per purchase unit
  surcharge?: number;         // extra charges (freight, loading, tax etc.) added to total
  baseUnitCost?: number;      // computed: (rate + surcharge share) / factor (cost per base unit)
  receivedBy: string;
  notes: string;
  date: string;
}

export interface MarketingContact {
  id: string;
  no: string;
  name: string;
  category: string;
}

export interface AppData {
  categories: Category[];
  menuItems: MenuItem[];
  orders: Order[];
  tables: DiningTable[];
  floors: Floor[];
  kitchens: Kitchen[];

  waiters: Waiter[];
  riders: Rider[];
  users: User[];
  settings: RestaurantSettings;
  orderCounter: number;
  inventory: InventoryItem[];
  stockLogs: StockLog[];
  // HR
  employees: Employee[];
  attendance: Attendance[];
  leaves: Leave[];
  payslips: Payslip[];
  advances: Advance[];
  // Accounts
  accountCategories: AccountCategory[];
  transactions: Transaction[];
  parties: Party[];
  ledger: LedgerEntry[];
  dailyCashCloses: DailyCashClose[];
  // Operations
  receivingEntries: ReceivingEntry[];
  marketingContacts: MarketingContact[];
  // Recipes & Wastage (Phase 4)
  recipes: Recipe[];
  wastages: Wastage[];
  // Customer database (Phase 5)
  customers: CustomerProfile[];
  // Multi-branch (Phase 6)
  branches: Branch[];
  // Credit / Udhaar payments ledger
  creditPayments: CreditPayment[];
  // Promo codes (Phase 11)
  promoCodes?: PromoCode[];
  // Payment accounts (Phase 12)
  paymentAccounts?: PaymentAccount[];
  // Deals / Combos (synced per-tenant)
  deals?: Deal[];
}

// ============= DEALS / COMBOS =============
export interface DealItem {
  menuItemId: string;
  quantity: number;
  /** Optional picked variant (e.g. "Medium", "12 Inch"). When set, this row
   *  refers to that specific size/inch of the menu item. */
  variantName?: string;
  variantType?: 'size' | 'inch';
}
export interface Deal {
  id: string;
  name: string;
  image?: string;
  items: DealItem[];
  price: number;               // combo price
  isActive: boolean;
  createdAt: string;
}

// ============= PROMO CODES =============
export interface PromoCode {
  id: string;
  code: string;              // uppercase, unique
  discountType: 'percent' | 'pkr';
  discountValue: number;     // % or PKR
  startDate?: string;        // ISO date (optional)
  endDate?: string;          // ISO date (optional)
  usageLimit?: number;       // total uses allowed (optional)
  usageCount: number;        // how many times redeemed
  minOrderAmount?: number;   // optional minimum cart
  isActive: boolean;
  createdAt: string;
  notes?: string;
}

// ============= MULTI-BRANCH (Phase 6) =============
export interface Branch {
  id: string;
  name: string;              // e.g. "Burewala Main", "Vehari Branch"
  address?: string;
  phone?: string;
  city?: string;
  email?: string;
  lat?: number;              // for branches map
  lng?: number;
  serviceRadiusKm?: number;  // delivery service area radius (km). 0 / undefined = no limit
  // Invoice identity — every field optional. Empty fields are never printed
  // (no dangling "Registration No:" label on the bill).
  branchCode?: string;
  registrationNumber?: string;
  taxNumber?: string;        // NTN / STRN / VAT — local registration field
  invoicePrefix?: string;    // e.g. "BWL-" -> BWL-1042
  invoiceFooter?: string;
  isActive: boolean;
  sortOrder: number;
}


