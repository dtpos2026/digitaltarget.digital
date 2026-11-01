// ============================================================
// RECEIPT QR & BARCODE — settings and what each code carries.
//
// Settings → Receipt → QR & Barcode. Two independent codes, each with its own
// switch, position and size:
//
//   QR code, one of three modes
//     auto    a QR unique to every bill. On a phone it opens the digital
//             receipt page (scan.html) — or, in "text" view, shows the bill as
//             plain text, which needs no internet anywhere.
//     multi   one QR holding several links (Google review, Facebook, WhatsApp,
//             ...). It opens a page listing them; the customer taps one.
//     single  one link; the QR opens it directly.
//
//   Barcode (Code 128, or Code 39 for older scanners)
//     info    the bill in words — "Bill 1042 Rs 1827" — so any scanner or
//             phone shows the bill number and amount; scanning it at the
//             POS still opens that bill (default).
//     receipt a compact reference, R + date + bill number (R2609241042).
//     custom  the same text on every bill.
//
// Everything is generated on the POS, offline, at print time from the saved
// settings. Nothing is uploaded anywhere: the receipt page reads the bill from
// the link itself (after the #, which a browser never sends to a server).
// No customer name, phone or address ever goes into a code.
// ============================================================
import type { Order, RestaurantSettings } from '@/lib/types';
import { sanitizeForFormat, type BarcodeFormat } from '@/lib/linearBarcode';
import { BAR_DOTS, qrByteBudget } from '@/lib/codeGeometry';
import { serviceChargeSuffix } from '@/lib/serviceCharge';
import { discountPercentShown, variantNote } from '@/lib/billLabels';

export type CodePosition = 'above' | 'footer' | 'below';
export type QrMode = 'auto' | 'multi' | 'single';
export type QrLinkType = 'google' | 'facebook' | 'instagram' | 'whatsapp' | 'website' | 'youtube' | 'tiktok' | 'custom';
export type BarcodeSize = 'small' | 'medium' | 'large';

export interface QrLink {
  id: string;
  type: QrLinkType;
  /** Button text on the links page ('' = the type's name). */
  label: string;
  url: string;
}

export interface ReceiptQrConfig {
  enabled: boolean;
  mode: QrMode;
  /** Auto mode: open the receipt page, or show the bill as plain text. */
  autoView: 'page' | 'text';
  /** Multi-link mode: list the links as text (any phone), or open the links page (scan.html published). */
  multiView: 'page' | 'text';
  links: QrLink[];
  singleUrl: string;
  /** Line printed under the code ('' = a sensible default for the mode). */
  caption: string;
  position: CodePosition;
  /** Printed width in mm. */
  sizeMm: number;
}

export interface ReceiptBarcodeConfig {
  enabled: boolean;
  format: BarcodeFormat;
  content: 'info' | 'receipt' | 'custom';
  customText: string;
  /** Optional branch/counter code in front of the reference, e.g. LHR1. */
  prefix: string;
  /** Print the encoded text under the bars. */
  showText: boolean;
  caption: string;
  position: CodePosition;
  size: BarcodeSize;
}

export interface ReceiptCodesConfig {
  /** 2 = saved by 1.14.1+ (older saves get the new defaults, see readReceiptCodes). */
  v?: number;
  qr: ReceiptQrConfig;
  barcode: ReceiptBarcodeConfig;
  /** The public page receipt and link QR codes open (superadmin/public/scan.html). */
  scanPageUrl: string;
}

/** Where scan.html is published: it ships in this app's public/ folder, so it lives on the same domain as the POS. */
export const DEFAULT_SCAN_PAGE = 'https://digitaltarget.digital/scan.html';

// At 40mm the text QR of a typical bill (3-4 items) keeps every module at
// 5 printer dots (0.625mm): what a phone reads off thermal paper even when
// the printer runs dark or light.
export const QR_SIZE_MM = { min: 20, max: 50, default: 40 };

export const LINK_TYPES: Record<QrLinkType, { label: string; placeholder: string; caption: string }> = {
  google: { label: 'Google Reviews', placeholder: 'https://g.page/r/…/review', caption: 'Scan to review us on Google' },
  facebook: { label: 'Facebook', placeholder: 'https://facebook.com/yourpage', caption: 'Scan to follow us on Facebook' },
  instagram: { label: 'Instagram', placeholder: 'https://instagram.com/yourpage', caption: 'Scan to follow us on Instagram' },
  whatsapp: { label: 'WhatsApp', placeholder: '0300 1234567 or https://wa.me/923001234567', caption: 'Scan to chat with us on WhatsApp' },
  website: { label: 'Website', placeholder: 'https://yourrestaurant.com', caption: 'Scan to visit our website' },
  youtube: { label: 'YouTube', placeholder: 'https://youtube.com/@yourchannel', caption: 'Scan to watch us on YouTube' },
  tiktok: { label: 'TikTok', placeholder: 'https://tiktok.com/@yourpage', caption: 'Scan to follow us on TikTok' },
  custom: { label: 'Link', placeholder: 'https://…', caption: 'Scan to visit our page' },
};
export const LINK_TYPE_ORDER: QrLinkType[] = ['google', 'facebook', 'instagram', 'whatsapp', 'website', 'youtube', 'tiktok', 'custom'];

export const DEFAULT_RECEIPT_CODES: ReceiptCodesConfig = {
  qr: {
    enabled: false,
    mode: 'auto',
    autoView: 'text',
    multiView: 'text',
    links: [],
    singleUrl: '',
    caption: '',
    position: 'footer',
    sizeMm: QR_SIZE_MM.default,
  },
  barcode: {
    enabled: false,
    format: 'code128',
    content: 'info',
    customText: '',
    prefix: '',
    showText: true,
    caption: '',
    position: 'footer',
    size: 'medium',
  },
  scanPageUrl: DEFAULT_SCAN_PAGE,
};

const POSITIONS: CodePosition[] = ['above', 'footer', 'below'];
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;
const text = (v: unknown, max: number) => String(v ?? '').slice(0, max);

/** The shop's QR & barcode settings, complete and bounded. Never throws. */
export function readReceiptCodes(settings: unknown): ReceiptCodesConfig {
  const raw = ((settings as any)?.receiptCodes || {}) as Partial<ReceiptCodesConfig>;
  let q = (raw.qr || {}) as Partial<ReceiptQrConfig>;
  let b = (raw.barcode || {}) as Partial<ReceiptBarcodeConfig>;
  // Saved by 1.14.0, which wrote its defaults out in full: those defaults
  // (receipt page, 32mm, compact reference) showed a customer nothing useful
  // until the scan page was published. They become the new defaults.
  if (raw.v !== 2) {
    q = { ...q, ...(q.autoView === 'page' ? { autoView: 'text' as const } : {}), ...(Number(q.sizeMm) === 32 ? { sizeMm: QR_SIZE_MM.default } : {}) };
    b = { ...b, ...(b.content === 'receipt' ? { content: 'info' as const } : {}) };
  }
  const d = DEFAULT_RECEIPT_CODES;
  const size = Number(q.sizeMm);
  const links = Array.isArray(q.links) ? q.links : [];
  const format = pick(b.format, ['code128', 'code39'] as const, d.barcode.format);
  return {
    v: 2,
    qr: {
      enabled: q.enabled === true,
      mode: pick(q.mode, ['auto', 'multi', 'single'] as const, d.qr.mode),
      autoView: pick(q.autoView, ['page', 'text'] as const, d.qr.autoView),
      multiView: pick(q.multiView, ['page', 'text'] as const, d.qr.multiView),
      links: links.slice(0, 10).map((l, i) => ({
        id: text(l?.id, 40) || `link-${i}`,
        type: pick(l?.type, LINK_TYPE_ORDER, 'custom'),
        label: text(l?.label, 40),
        url: text(l?.url, 500),
      })),
      singleUrl: text(q.singleUrl, 500),
      caption: text(q.caption, 60),
      position: pick(q.position, POSITIONS, d.qr.position),
      sizeMm: Number.isFinite(size) ? Math.max(QR_SIZE_MM.min, Math.min(QR_SIZE_MM.max, Math.round(size))) : d.qr.sizeMm,
    },
    barcode: {
      enabled: b.enabled === true,
      format,
      content: pick(b.content, ['info', 'receipt', 'custom'] as const, d.barcode.content),
      // What fits 80mm paper at a scannable bar width (see ReceiptCodes).
      customText: sanitizeForFormat(format, text(b.customText, 60), format === 'code39' ? 12 : 20),
      prefix: sanitizeForFormat('code39', text(b.prefix, 12), 6).replace(/[^A-Z0-9]/g, ''),
      showText: b.showText !== false,
      caption: text(b.caption, 60),
      position: pick(b.position, POSITIONS, d.barcode.position),
      size: pick(b.size, ['small', 'medium', 'large'] as const, d.barcode.size),
    },
    scanPageUrl: safeHttpUrl(raw.scanPageUrl) || DEFAULT_SCAN_PAGE,
  };
}

// ------------------------------------------------------------ links
/** An http(s) URL, or null. Anything else (javascript:, data:, ...) is refused. */
export function safeHttpUrl(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    // "https://03001234567" parses as the IP 0.183.103.51: a phone number
    // typed into a link box is not a link.
    if (/^[\d.]+$/.test(u.hostname) && !s.includes(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * What the shop typed, as a link a phone can open. A WhatsApp number becomes
 * a wa.me link (a Pakistani 03xx number gets the 92 country code).
 */
export function normalizeLink(type: QrLinkType, raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (type === 'whatsapp' && /^\+?[\d\s()-]{7,}$/.test(s)) {
    let digits = s.replace(/\D/g, '');
    if (/^0\d{10}$/.test(digits)) digits = `92${digits.slice(1)}`;
    return `https://wa.me/${digits}`;
  }
  return safeHttpUrl(s);
}

/** A phone number means WhatsApp; otherwise the kind of site the URL is. */
export function detectLinkType(raw: string): QrLinkType {
  return /^\+?[\d\s()-]{7,}$/.test(String(raw || '').trim()) ? 'whatsapp' : linkTypeOf(raw);
}

/** The shop's valid links, in their order, ready to encode. */
export function validLinks(cfg: ReceiptCodesConfig): { type: QrLinkType; label: string; url: string }[] {
  const out: { type: QrLinkType; label: string; url: string }[] = [];
  for (const l of cfg.qr.links) {
    const url = normalizeLink(l.type, l.url);
    if (url) out.push({ type: l.type, label: l.label.trim(), url });
  }
  return out;
}

// ------------------------------------------------------------ receipt reference
const two = (n: number) => String(n).padStart(2, '0');

/** R + yymmdd + bill number, e.g. R2609241042; with a prefix, LHR1-R2609241042. */
export function receiptRef(order: Pick<Order, 'createdAt' | 'orderNumber'>, prefix = ''): string {
  const d = new Date(order.createdAt || Date.now());
  const ymd = Number.isNaN(d.getTime()) ? '000000' : `${two(d.getFullYear() % 100)}${two(d.getMonth() + 1)}${two(d.getDate())}`;
  const ref = `R${ymd}${Math.max(0, Math.floor(Number(order.orderNumber) || 0))}`;
  const p = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return p ? `${p}-${ref}` : ref;
}

const REF_RE = /^(?:([A-Z0-9]{1,6})-)?R(\d{2})(\d{2})(\d{2})(\d{1,9})$/;

/** "Bill 1042 Rs 1827" or "#1042 Rs1827", optionally after a branch code — the bill-info barcode. */
const INFO_RE = /^(?:([A-Z0-9]{1,6})\s+)?(?:BILL\s*#?\s*|#)(\d{1,9})(?:\s+RS\.?\s*([\d.,]+))?$/;

export interface ScannedBill {
  prefix: string;
  orderNumber: number;
  /** Compact reference only: the bill's date. */
  yy?: number; mm?: number; dd?: number;
  /** Bill-info barcode only: the amount printed in it. */
  amount?: number;
}

/** Read a scanned bill barcode back (either format), or null if it is not one. */
export function parseReceiptRef(code: string): ScannedBill | null {
  const text = String(code || '').trim().toUpperCase();
  const m = REF_RE.exec(text);
  if (m) {
    const mm = Number(m[3]);
    const dd = Number(m[4]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return { prefix: m[1] || '', yy: Number(m[2]), mm, dd, orderNumber: Number(m[5]) };
  }
  const i = INFO_RE.exec(text.replace(/\s+/g, ' '));
  if (i) {
    const amount = i[3] ? Number(i[3].replace(/,/g, '')) : undefined;
    return { prefix: i[1] || '', orderNumber: Number(i[2]), ...(Number.isFinite(amount) ? { amount } : {}) };
  }
  return null;
}

/**
 * The order a scanned barcode points to. The compact reference carries the
 * date; the bill-info one the amount. Bill numbers never repeat on a POS, so
 * either settles it — the date or amount only guards against old data.
 */
export function findOrderByRef<T extends Pick<Order, 'createdAt' | 'orderNumber'> & { grandTotal?: number }>(orders: T[], code: string): T | null {
  const r = parseReceiptRef(code);
  if (!r) return null;
  const hits = orders.filter(o => Number(o.orderNumber) === r.orderNumber);
  if (r.yy != null) {
    return hits.find(o => {
      const d = new Date(o.createdAt);
      return d.getFullYear() % 100 === r.yy && d.getMonth() + 1 === r.mm && d.getDate() === r.dd;
    }) || null;
  }
  if (!hits.length) return null;
  const newest = (list: T[]) => [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (r.amount != null) {
    const same = hits.filter(o => Math.abs((Number(o.grandTotal) || 0) - r.amount!) < 0.01);
    if (same.length) return newest(same);
  }
  return newest(hits);
}

// ------------------------------------------------------------ what the QR carries
/** base64url of UTF-8 — survives any URL and any phone browser. */
export function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Receipt data bytes kept small enough that, at the default 32mm, every QR
 * module gets at least 3 printer dots (0.375mm) — what a phone reads off
 * thermal paper without hunting. Bigger bills list their first items and a
 * count of the rest; the paper receipt has them all.
 */
export const RECEIPT_PAYLOAD_BUDGET = 300;
/**
 * Most plain-text receipt bytes (UTF-8) ever put in a QR. The QR's size
 * sets the real budget (qrByteBudget): 213 bytes at the default 40mm keeps
 * every module 5 dots wide; a bigger QR lists more items.
 */
export const RECEIPT_TEXT_BUDGET = 260;

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

function paymentStatus(order: Order): string {
  const s = String(order.status || '');
  if (s === 'paid') return order.paymentMethod === 'credit' ? 'credit' : 'paid';
  if (s === 'partial') return 'partial';
  if (s === 'void' || s === 'cancelled' || s === 'complimentary') return s;
  return 'unpaid';
}

function typeLabel(order: Order): string {
  const t = String(order.orderType || '');
  if (t === 'dining' || t === 'dine_in' || t === 'dine-in') return 'Dine-In';
  if (!t) return '';
  return t.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function localStamp(iso: string | undefined): string {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * The bill as the receipt page reads it: short keys, amounts as numbers,
 * items until the budget is spent (the rest counted, never silently lost).
 */
export function receiptPayload(order: Order, settings: RestaurantSettings, opts: { branch?: string; ref?: string } = {}): Record<string, unknown> {
  const s = settings as any;
  const base: Record<string, unknown> = {
    v: 1,
    s: String(s.name || '').slice(0, 60),
    ...(opts.branch ? { b: String(opts.branch).slice(0, 40) } : {}),
    ...(s.phone1 ? { h: String(s.phone1).slice(0, 20) } : {}),
    n: String(order.orderNumber ?? ''),
    t: localStamp(order.createdAt),
    o: typeLabel(order),
    p: paymentStatus(order),
    ...(order.paymentMethod ? { m: String(order.paymentMethod).slice(0, 20) } : {}),
    c: String(s.currencySymbol ?? 'Rs').trim() || 'Rs',
    T: num(order.grandTotal),
    S: num(order.subtotal),
    ...(num(order.discount) ? { D: num(order.discount) } : {}),
    ...(num(order.tax) ? { X: num(order.tax) } : {}),
    ...(num(order.serviceCharge) ? { V: num(order.serviceCharge) } : {}),
    ...(num((order as any).deliveryChargeAmount) ? { L: num((order as any).deliveryChargeAmount) } : {}),
    ...(opts.ref ? { r: opts.ref } : {}),
    i: [] as unknown[],
  };
  const items = (order.items || []).map(it => {
    const size = variantNote(it as any);
    const name = `${String(it.name || '').slice(0, 40)}${size ? ` (${size.slice(0, 20)})` : ''}`;
    const qty = it.pricingType === 'weight' && it.weightGrams ? Math.round(it.weightGrams) / 1000 : Number(it.quantity) || 1;
    return [name, qty, num(it.lineTotal ?? (Number(it.quantity) || 0) * (Number(it.price) || 0))];
  });
  const size = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;
  const kept: unknown[] = [];
  for (const it of items) {
    const trial = { ...base, i: [...kept, it] };
    if (size(trial) > RECEIPT_PAYLOAD_BUDGET) break;
    kept.push(it);
  }
  const more = items.length - kept.length;
  return { ...base, i: kept, ...(more ? { '+': more } : {}) };
}

const money = (v: number) => v.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Amounts in the text QR: "1,827", "1,827.50" — every byte is a module less. */
const cash = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-PK') : money(v));

/** Whole numbers without decimals, others with two: "1827", "1827.50". */
const amt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

function dmyStamp(iso: string | undefined): string {
  const d = new Date(iso || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * The bill as plain text — what any phone shows on scanning, with no
 * internet and no page to publish. Items until the budget, the rest counted.
 */
export function receiptText(order: Order, settings: RestaurantSettings, _ref?: string, budget = RECEIPT_TEXT_BUDGET): string {
  const limit = Math.min(RECEIPT_TEXT_BUDGET, budget);
  const s = settings as any;
  const cur = String(s.currencySymbol ?? 'Rs').trim() || 'Rs';
  const status = paymentStatus(order).toUpperCase();
  const bytes = (t: string) => new TextEncoder().encode(t).length;
  const head = [String(s.name || '').slice(0, 40), `Bill #${order.orderNumber} | ${dmyStamp(order.paidAt || order.createdAt)}`].filter(Boolean);
  const sums: string[] = [];
  if (num(order.discount)) { const pct = discountPercentShown(order); sums.push(`Discount${pct ? ` (${pct}%)` : ''} -${cash(num(order.discount))}`); }
  if (num(order.tax)) sums.push(`Tax ${cash(num(order.tax))}`);
  if (num(order.serviceCharge)) sums.push(`Service${serviceChargeSuffix(order)} ${cash(num(order.serviceCharge))}`);
  if (num((order as any).deliveryChargeAmount)) sums.push(`Delivery ${cash(num((order as any).deliveryChargeAmount))}`);
  const tail = [
    ...(sums.length ? [sums.join(' | ')] : []),
    `TOTAL ${cur} ${cash(num(order.grandTotal))}`,
    `${status}${order.paymentMethod ? ` (${String(order.paymentMethod).toUpperCase()})` : ''}`,
  ];
  const items = order.items || [];
  const lines: string[] = [];
  let used = bytes([...head, ...tail].join('\n'));
  for (const it of items) {
    const qty = it.pricingType === 'weight' && it.weightGrams ? `${(it.weightGrams / 1000).toFixed(3)}kg` : `${Number(it.quantity) || 1} x`;
    const line = `${qty} ${String(it.name || '').slice(0, 28)} = ${cash(num(it.lineTotal))}`;
    const more = items.length - lines.length - 1;
    const reserve = more > 0 ? 20 : 0; // room for the "+ n more item(s)" line
    if (used + bytes(line) + 1 + reserve > limit) break;
    lines.push(line);
    used += bytes(line) + 1;
  }
  if (lines.length < items.length) lines.push(`+ ${items.length - lines.length} more item(s)`);
  return [...head, ...lines, ...tail].join('\n');
}

function withHash(page: string, key: 'r' | 'l', data: string): string {
  const base = page.split('#')[0];
  return `${base}#${key}=${data}`;
}

/**
 * The shop's links as plain text, one per line under its name: any phone
 * shows them on scanning, with no page to publish. Null when none is valid.
 */
export function linksText(cfg: ReceiptCodesConfig, settings: RestaurantSettings): string | null {
  const links = validLinks(cfg);
  if (!links.length) return null;
  const name = String((settings as any).name || '').trim().slice(0, 40);
  return [...(name ? [name] : []), ...links.map(l => `${l.label || LINK_TYPES[l.type].label}: ${l.url}`)].join('\n');
}

/** A multi-link QR: the page lists the shop's links. Null when none is valid. */
export function linksQrValue(cfg: ReceiptCodesConfig, settings: RestaurantSettings): string | null {
  const links = validLinks(cfg);
  if (!links.length) return null;
  const payload = { v: 1, s: String((settings as any).name || '').slice(0, 60), k: links.map(l => [l.type, l.url, ...(l.label ? [l.label] : [])]) };
  return withHash(cfg.scanPageUrl, 'l', toBase64Url(JSON.stringify(payload)));
}

/** What the QR on this bill encodes, or null when there is nothing to print. */
export function qrValueFor(order: Order, settings: RestaurantSettings, cfg: ReceiptCodesConfig, branch?: string): string | null {
  if (!cfg.qr.enabled) return null;
  if (cfg.qr.mode === 'single') {
    const link = normalizeLink(detectLinkType(cfg.qr.singleUrl), cfg.qr.singleUrl);
    // Not a link: the QR carries the text itself (Wi-Fi password, a note…).
    return link || cfg.qr.singleUrl.trim().slice(0, 300) || null;
  }
  if (cfg.qr.mode === 'multi') return cfg.qr.multiView === 'page' ? linksQrValue(cfg, settings) : linksText(cfg, settings);
  const ref = receiptRef(order, cfg.barcode.prefix);
  if (cfg.qr.autoView === 'text') return receiptText(order, settings, ref, qrByteBudget(cfg.qr.sizeMm, maxCodeWidthMm(settings)));
  return withHash(cfg.scanPageUrl, 'r', toBase64Url(JSON.stringify(receiptPayload(order, settings, { branch, ref }))));
}

/** Which kind of link a URL is — used for the single-link caption. */
export function linkTypeOf(url: string): QrLinkType {
  const u = String(url || '').toLowerCase();
  if (/(^|\.|\/)(g\.page|goo\.gl\/maps|maps\.app\.goo\.gl|search\.google|google\.[a-z.]+\/maps|g\.co\/kgs)/.test(u) || u.includes('writereview')) return 'google';
  if (/(facebook\.com|fb\.com|fb\.me)/.test(u)) return 'facebook';
  if (/instagram\.com|instagr\.am/.test(u)) return 'instagram';
  if (/wa\.me|whatsapp\.com/.test(u)) return 'whatsapp';
  if (/youtube\.com|youtu\.be/.test(u)) return 'youtube';
  if (/tiktok\.com/.test(u)) return 'tiktok';
  return 'website';
}

/** The line printed under the QR. */
export function qrCaption(cfg: ReceiptCodesConfig): string {
  if (cfg.qr.caption.trim()) return cfg.qr.caption.trim();
  if (cfg.qr.mode === 'multi') return 'Scan to review & follow us';
  if (cfg.qr.mode === 'single') {
    return normalizeLink(detectLinkType(cfg.qr.singleUrl), cfg.qr.singleUrl)
      ? LINK_TYPES[detectLinkType(cfg.qr.singleUrl)].caption
      : 'Scan for details';
  }
  return cfg.qr.autoView === 'text' ? 'Scan for your receipt details' : 'Scan for your digital receipt';
}

/** Widest code that still sits inside the slip's margins (mm). */
export function maxCodeWidthMm(settings: unknown): number {
  return (settings as any)?.paperSize === '58mm' ? 44 : 64;
}

/**
 * Characters of plain text a Code 128 barcode carries across the slip with
 * bars `dots` wide: 20 on 80mm at 2 dots, 12 at 3; 12 and 7 on 58mm.
 */
export function barcodeMaxChars(settings: unknown, dots = 2): number {
  const modules = Math.floor((maxCodeWidthMm(settings) * 8) / Math.max(2, dots));
  return Math.max(4, Math.floor((modules - 35) / 11));
}

/**
 * The most readable bill text that fits `maxChars`: "Bill 1042 Rs 1827",
 * "#1042 Rs 1827", "#1042 Rs1827", "Bill 1042", "#1042". Code 39 has no "#".
 */
export function billInfoText(order: Pick<Order, 'orderNumber'> & { grandTotal?: number }, prefix: string, maxChars: number, format: BarcodeFormat = 'code128'): string {
  const p = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const pre = p ? `${p} ` : '';
  const n = Math.max(0, Math.floor(Number(order.orderNumber) || 0));
  const a = amt(num(order.grandTotal));
  const hash = format !== 'code39';
  const options = [
    `${pre}Bill ${n} Rs ${a}`,
    ...(hash ? [`${pre}#${n} Rs ${a}`, `${pre}#${n} Rs${a}`] : []),
    `${pre}Bill ${n}`,
    ...(hash ? [`${pre}#${n}`] : []),
  ];
  return options.find(t => t.length <= maxChars) || options[options.length - 1];
}

/** What the barcode on this bill encodes, or null when there is nothing to print. */
export function barcodeValueFor(order: Pick<Order, 'createdAt' | 'orderNumber'> & { grandTotal?: number }, cfg: ReceiptCodesConfig, settings?: unknown): string | null {
  if (!cfg.barcode.enabled) return null;
  if (cfg.barcode.content === 'custom') return cfg.barcode.customText.trim() || null;
  if (cfg.barcode.content === 'receipt') return receiptRef(order, cfg.barcode.prefix);
  // What fits at the chosen bar width (wider bars survive a dark printer);
  // only when even the shortest text is too long, the narrowest bars.
  const at = (dots: number) => billInfoText(order, cfg.barcode.prefix, barcodeMaxChars(settings, dots), cfg.barcode.format);
  const chosen = at(BAR_DOTS[cfg.barcode.size]);
  return chosen.length <= barcodeMaxChars(settings, BAR_DOTS[cfg.barcode.size]) ? chosen : at(2);
}
