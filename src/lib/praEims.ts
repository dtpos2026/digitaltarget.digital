// ============================================================
// v1.9.0 — PRA EIMS (Electronic Invoice Monitoring System)
//
// SOURCE OF TRUTH
// "Technical Specification for Data Sharing through Software Fiscal
// Device with PRA", PRAL (Pakistan Revenue Automation Pvt Ltd),
// version 1.0/1.1, issued 08-Nov-2019. Every field name, data type,
// enum value and endpoint below is taken from that document. Nothing
// here is invented — where the spec is silent, the code says so
// explicitly rather than guessing.
//
// ARCHITECTURE (important — differs from a normal REST integration)
// PRA does NOT expose a cloud API that a POS submits sales to. PRA
// ships a **Software Fiscal Device** (the "IMS Component") which the
// taxpayer installs on the SAME Windows machine as the POS:
//
//   1. POS pushes invoice data to the LOCAL fiscal device, real time
//   2. Device returns a Fiscal Invoice Number for that invoice
//   3. POS prints that number + QR code on the customer receipt
//   4. The DEVICE itself periodically uploads invoices to PRA online
//
// Step 4 is not our responsibility. Our obligation ends at steps 1–3.
// A cloud endpoint also exists (ims.pral.com.pk .../Live/PostData with
// a Bearer token) for cloud-hosted POS; it is supported here as a
// fallback because our POS also runs as a web app.
//
// VENDOR / TAXPAYER SPLIT
// We are the software vendor. Every restaurant enters its OWN PRA
// credentials (POS ID issued per branch on the PRA portal). Nothing is
// shared between tenants; there is no vendor-level PRA account.
// ============================================================

import type { Order, CartItem, PaymentEntry } from './types';
import { round2 } from './taxEngine';

// ---------- endpoints (verbatim from the PRAL specification) ----------

/** Local fiscal-device health probe. Responds ["Service is responding"]. */
export const PRA_LOCAL_PROBE_URL = 'http://localhost:8524/api/IMSFiscal/get';
/** Local fiscal-device fiscalisation endpoint. */
export const PRA_LOCAL_INVOICE_URL = 'http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel';
/** Cloud endpoints for cloud-hosted POS (Bearer token required). */
export const PRA_CLOUD_SANDBOX_URL = 'https://ims.pral.com.pk/ims/sandbox/api/Live/PostData';
export const PRA_CLOUD_PRODUCTION_URL = 'https://ims.pral.com.pk/ims/production/api/Live/PostData';
/** Customer-facing verification page; the QR encodes this URL. */
export const PRA_VERIFY_URL_BASE =
  'https://e.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=';

/** Spec: success is signalled by Code "100". */
export const PRA_SUCCESS_CODE = '100';

/** Spec default when an item has no Pakistan Customs Tariff code. */
export const PCT_CODE_DEFAULT = '00000000';

// ---------- per-tenant configuration ----------

export type PraTransportMode = 'local' | 'cloud';
export type PraEnvironment = 'sandbox' | 'production';

export interface PraConfig {
  /** Master switch. Nothing is submitted while false. */
  enabled: boolean;
  /**
   * POS Registration Number issued by PRA when the branch registers its
   * POS at e.pra.punjab.gov.pk → Registration → POS Client Registration.
   * Spec type: bigint. One per POS counter, per branch.
   */
  posId: string;
  /** Sandbox until PRA confirms live; production submits real invoices. */
  environment: PraEnvironment;
  /**
   * 'local'  — talk to the fiscal device on this PC (the PRA-intended path)
   * 'cloud'  — POST straight to PRAL's cloud endpoint (needs a token)
   */
  transport: PraTransportMode;
  /** Bearer token — cloud transport only. PRA issues this on request. */
  cloudToken?: string;
  /** Optional override if PRA assigns a non-default local port. */
  localBaseUrl?: string;
  /**
   * Taxpayer's own PNTN — printed for reference. NOT part of the invoice
   * model (the POS ID already identifies the taxpayer to PRA).
   */
  sellerPntn?: string;
  /** Branch label for our own logs/filtering. Not sent to PRA. */
  branchLabel?: string;
  /** Print the PRA number + QR on customer receipts once returned. */
  printOnReceipt: boolean;
}

export const PRA_CONFIG_DEFAULT: PraConfig = {
  enabled: false,
  posId: '',
  environment: 'sandbox',
  transport: 'local',
  printOnReceipt: true,
};

// ---------- invoice model (verbatim field names — do not rename) ----------

/** Spec Table 2 — one line per sold item. */
export interface PraInvoiceItem {
  ItemCode: string;      // varchar(50)  compulsory
  ItemName: string;      // varchar(150) compulsory
  PCTCode: string;       // varchar(8)   compulsory ("00000000" default)
  Quantity: number;      // double       compulsory
  TaxRate: number;       // float        compulsory (percent, e.g. 16)
  SaleValue: number;     // double       compulsory — EXCLUSIVE of tax & discount
  TotalAmount: number;   // double       compulsory
  TaxCharged: number;    // double       compulsory
  Discount: number;      // double       optional
  FurtherTax: number;    // double       optional
  InvoiceType: number;   // int          compulsory (1 New / 2 Debit / 3 Credit)
  RefUSIN: string | null;
}

/** Spec Table 1 — invoice header. */
export interface PraInvoice {
  InvoiceNumber: string;      // blank on submit; PRA fills it
  POSID: number;              // bigint compulsory
  USIN: string;               // varchar(50) compulsory — our own invoice no
  DateTime: string;           // "YYYY-MM-DD HH:mm:ss"
  BuyerName?: string;
  BuyerPNTN?: string;
  BuyerCNIC?: string;
  BuyerPhoneNumber?: string;
  TotalBillAmount: number;
  TotalQuantity: number;
  TotalSaleValue: number;     // sum of item SaleValue, excl. tax & discount
  TotalTaxCharged: number;
  Discount: number;
  FurtherTax: number;
  PaymentMode: number;        // 1..6, see PraPaymentMode
  RefUSIN: string | null;
  InvoiceType: number;        // 1 New / 2 Debit / 3 Credit
  Items: PraInvoiceItem[];
}

/** Spec enum. Mixed (5) is required when a bill used >1 method. */
export enum PraPaymentMode {
  Cash = 1,
  Card = 2,
  GiftVoucher = 3,
  LoyaltyCard = 4,
  Mixed = 5,
  Cheque = 6,
}

/** Spec enum. Credit (3) is used for a return / cancelled invoice. */
export enum PraInvoiceType {
  New = 1,
  Debit = 2,
  Credit = 3,
}

// ---------- mapping helpers ----------

/**
 * Map our payment methods onto the PRA enum.
 *
 * ASSUMPTIONS THAT NEED PRA CONFIRMATION (documented, not hidden):
 *  • 'online' (bank transfer / wallet / QR payment) has no dedicated PRA
 *    code. Card (2) is the closest cashless category.
 *  • 'credit' (udhaar) has no PRA code either. The sale is still a sale;
 *    we report Cash (1) because settlement is expected in cash.
 * Both are flagged in the settings screen so the taxpayer can raise them
 * with PRA (rims@pra.punjab.gov.pk) before going live.
 */
export function toPraPaymentMode(order: Order): PraPaymentMode {
  const pays: PaymentEntry[] = (order.payments || []).filter(p => (p.amount || 0) > 0);
  const distinct = new Set(pays.map(p => String(p.method || '').toLowerCase()));
  if (distinct.size > 1) return PraPaymentMode.Mixed;

  const method = String(
    distinct.values().next().value || order.paymentMethod || 'cash',
  ).toLowerCase();

  switch (method) {
    case 'cash': return PraPaymentMode.Cash;
    case 'card': return PraPaymentMode.Card;
    case 'online': return PraPaymentMode.Card;      // assumption — see doc above
    case 'credit': return PraPaymentMode.Cash;      // assumption — see doc above
    case 'cheque':
    case 'check': return PraPaymentMode.Cheque;
    case 'voucher':
    case 'gift':
    case 'giftvoucher': return PraPaymentMode.GiftVoucher;
    case 'loyalty':
    case 'points': return PraPaymentMode.LoyaltyCard;
    case 'split':
    case 'mixed': return PraPaymentMode.Mixed;
    default: return PraPaymentMode.Cash;            // custom types → cash bucket
  }
}

/** Voided / cancelled bills are reported as Credit invoices per the spec FAQ. */
export function toPraInvoiceType(order: Order): PraInvoiceType {
  const s = String(order.status || '').toLowerCase();
  if (s === 'void' || s === 'cancelled') return PraInvoiceType.Credit;
  return PraInvoiceType.New;
}

/** Spec DateTime format: "2020-01-01 12:00:00" (local time, no timezone). */
export function toPraDateTime(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  const src = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${src.getFullYear()}-${p(src.getMonth() + 1)}-${p(src.getDate())} `
       + `${p(src.getHours())}:${p(src.getMinutes())}:${p(src.getSeconds())}`;
}

/**
 * The PRA model has no service-charge field, but a restaurant service
 * charge is real consideration that must appear in the taxable value.
 * We report it as its own line item so the invoice arithmetic reconciles
 * (TotalSaleValue stays the sum of item SaleValues, as the spec requires)
 * instead of silently inflating a food item's price.
 */
export const SERVICE_CHARGE_ITEM_CODE = 'SRVCHG';

export interface MapOptions {
  /** Tax rate to report when an order predates the tax engine. */
  fallbackTaxRate?: number;
}

/**
 * Build a spec-compliant PRA invoice from one of our orders.
 *
 * Our orders carry discount and tax at the ORDER level; PRA wants them
 * per item as well. We distribute both proportionally to each line's
 * share of the item subtotal, then push any rounding remainder onto the
 * last line so the item sums exactly equal the header totals. PRA
 * rejects invoices whose parts do not reconcile, so this matters.
 */
export function buildPraInvoice(
  order: Order,
  cfg: PraConfig,
  opts: MapOptions = {},
): PraInvoice {
  const invoiceType = toPraInvoiceType(order);
  const lines: CartItem[] = (order.items || []).filter(l => (l.quantity || 0) !== 0);

  const itemsSubtotal = round2(
    lines.reduce((s, l) => s + (Number(l.lineTotal) || 0), 0),
  );
  const serviceCharge = round2(Number(order.serviceCharge) || 0);
  const orderDiscount = round2(Number(order.discount) || 0);
  const orderTax = round2(Number(order.tax) || 0);
  const taxRate = Number(order.taxPercent) || opts.fallbackTaxRate || 0;

  // Base used to apportion discount/tax across lines (service charge included
  // so the charge carries its own share, matching our tax engine).
  const apportionBase = round2(itemsSubtotal + serviceCharge);

  type Draft = { src: CartItem | null; code: string; name: string; qty: number; gross: number };
  const drafts: Draft[] = lines.map(l => ({
    src: l,
    code: String(l.menuItemId || l.id || 'ITEM').slice(0, 50),
    name: String(l.name || 'Item').slice(0, 150),
    qty: Number(l.quantity) || 0,
    gross: round2(Number(l.lineTotal) || 0),
  }));
  if (serviceCharge > 0) {
    drafts.push({
      src: null,
      code: SERVICE_CHARGE_ITEM_CODE,
      name: `Service Charge (${Number(order.serviceChargePercent) || 0}%)`,
      qty: 1,
      gross: serviceCharge,
    });
  }

  const items: PraInvoiceItem[] = [];
  let allocDiscount = 0;
  let allocTax = 0;

  drafts.forEach((d, idx) => {
    const isLast = idx === drafts.length - 1;
    const share = apportionBase > 0 ? d.gross / apportionBase : 0;

    // Last line absorbs the rounding remainder so sums are exact.
    const lineDiscount = isLast
      ? round2(orderDiscount - allocDiscount)
      : round2(orderDiscount * share);
    const lineTax = isLast
      ? round2(orderTax - allocTax)
      : round2(orderTax * share);
    allocDiscount = round2(allocDiscount + lineDiscount);
    allocTax = round2(allocTax + lineTax);

    // Spec: SaleValue is the actual sale price tax was calculated on,
    // exclusive of tax AND discount.
    const saleValue = round2(d.gross - lineDiscount);

    items.push({
      ItemCode: d.code,
      ItemName: d.name,
      PCTCode: PCT_CODE_DEFAULT,
      Quantity: d.qty,
      TaxRate: taxRate,
      SaleValue: saleValue,
      TotalAmount: round2(saleValue + lineTax),
      TaxCharged: lineTax,
      Discount: lineDiscount,
      FurtherTax: 0,
      InvoiceType: invoiceType,
      RefUSIN: null,
    });
  });

  const totalSaleValue = round2(items.reduce((s, i) => s + i.SaleValue, 0));
  const totalTaxCharged = round2(items.reduce((s, i) => s + i.TaxCharged, 0));
  const totalQuantity = round2(items.reduce((s, i) => s + i.Quantity, 0));

  const customerPhone = order.customer?.phone ? String(order.customer.phone).slice(0, 20) : undefined;
  const customerName = order.customer?.name ? String(order.customer.name).slice(0, 150) : undefined;

  return {
    InvoiceNumber: '',
    POSID: Number(cfg.posId) || 0,
    USIN: String(order.orderNumber ?? order.id).slice(0, 50),
    DateTime: toPraDateTime(order.createdAt),
    ...(customerName ? { BuyerName: customerName } : {}),
    ...(customerPhone ? { BuyerPhoneNumber: customerPhone } : {}),
    TotalBillAmount: round2(Number(order.grandTotal) || 0),
    TotalQuantity: totalQuantity,
    TotalSaleValue: totalSaleValue,
    TotalTaxCharged: totalTaxCharged,
    Discount: orderDiscount,
    FurtherTax: 0,
    PaymentMode: toPraPaymentMode(order),
    RefUSIN: null,
    InvoiceType: invoiceType,
    Items: items,
  };
}

// ---------- validation ----------

export interface PraValidation { ok: boolean; errors: string[] }

/**
 * Catch the mistakes PRA would reject, BEFORE we queue an invoice —
 * a rejected invoice on a live day is a compliance gap, so failing
 * fast and loudly at the source is worth the few microseconds.
 */
export function validatePraInvoice(inv: PraInvoice): PraValidation {
  const errors: string[] = [];
  if (!inv.POSID || inv.POSID <= 0) errors.push('POSID missing — set the PRA POS Registration Number');
  if (!inv.USIN) errors.push('USIN missing (our own invoice number)');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(inv.DateTime)) errors.push('DateTime format galat');
  if (!Array.isArray(inv.Items) || inv.Items.length === 0) errors.push('No items on the invoice');

  for (const [i, it] of (inv.Items || []).entries()) {
    if (!it.ItemName) errors.push(`Item ${i + 1}: ItemName missing`);
    if (!it.ItemCode) errors.push(`Item ${i + 1}: ItemCode missing`);
    if (!/^\d{8}$/.test(it.PCTCode)) errors.push(`Item ${i + 1}: PCTCode must be 8 digits`);
  }

  // Header must reconcile with the lines, or PRA rejects the invoice.
  const sumSale = round2((inv.Items || []).reduce((s, i) => s + i.SaleValue, 0));
  const sumTax = round2((inv.Items || []).reduce((s, i) => s + i.TaxCharged, 0));
  if (Math.abs(sumSale - inv.TotalSaleValue) > 0.01) {
    errors.push(`TotalSaleValue (${inv.TotalSaleValue}) does not match the sum of items (${sumSale})`);
  }
  if (Math.abs(sumTax - inv.TotalTaxCharged) > 0.01) {
    errors.push(`TotalTaxCharged (${inv.TotalTaxCharged}) does not match the sum of items (${sumTax})`);
  }
  if (inv.TotalBillAmount < 0) errors.push('TotalBillAmount cannot be negative');

  return { ok: errors.length === 0, errors };
}

// ---------- response ----------

/** Shape returned by both the local device and the cloud endpoint. */
export interface PraApiResponse {
  InvoiceNumber?: string | number;
  Code?: string | number;
  Response?: string;
  Errors?: unknown;
}

export interface PraSubmitResult {
  success: boolean;
  invoiceNumber?: string;
  code?: string;
  message?: string;
  /** Raw body kept verbatim for the audit log. */
  raw?: unknown;
  error?: string;
  /** True when retrying later could plausibly succeed (network/5xx). */
  retryable?: boolean;
}

export function parsePraResponse(body: unknown): PraSubmitResult {
  if (!body || typeof body !== 'object') {
    return { success: false, error: 'PRA returned an empty or unparseable response', raw: body, retryable: true };
  }
  const r = body as PraApiResponse;
  const code = r.Code != null ? String(r.Code) : undefined;
  const invoiceNumber = r.InvoiceNumber != null && String(r.InvoiceNumber).trim() !== ''
    ? String(r.InvoiceNumber)
    : undefined;

  if (code === PRA_SUCCESS_CODE && invoiceNumber) {
    return { success: true, invoiceNumber, code, message: r.Response, raw: body };
  }
  return {
    success: false,
    code,
    message: r.Response,
    error: r.Response || `PRA did not accept the invoice (code ${code ?? 'unknown'})`,
    raw: body,
    // A business rejection will not fix itself; do not retry forever.
    retryable: false,
  };
}

/** URL a customer scans to verify the invoice on the PRA portal. */
export function praVerifyUrl(invoiceNumber: string): string {
  return `${PRA_VERIFY_URL_BASE}${encodeURIComponent(invoiceNumber)}`;
}

/** Endpoint for the configured transport + environment. */
export function praEndpoint(cfg: PraConfig): string {
  if (cfg.transport === 'cloud') {
    return cfg.environment === 'production' ? PRA_CLOUD_PRODUCTION_URL : PRA_CLOUD_SANDBOX_URL;
  }
  const base = (cfg.localBaseUrl || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/IMSFiscal/GetInvoiceNumberByModel` : PRA_LOCAL_INVOICE_URL;
}

export function praProbeUrl(cfg: PraConfig): string {
  const base = (cfg.localBaseUrl || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/IMSFiscal/get` : PRA_LOCAL_PROBE_URL;
}

/** Config completeness check used by the settings screen and the queue. */
export function praConfigReady(cfg: PraConfig | null | undefined): { ok: boolean; reason?: string } {
  if (!cfg?.enabled) return { ok: false, reason: 'PRA integration is OFF' };
  if (!cfg.posId || !/^\d+$/.test(cfg.posId.trim())) {
    return { ok: false, reason: 'POS ID is missing or must contain digits only' };
  }
  if (cfg.transport === 'cloud' && !cfg.cloudToken?.trim()) {
    return { ok: false, reason: 'A PRA bearer token is required for cloud transport' };
  }
  return { ok: true };
}
