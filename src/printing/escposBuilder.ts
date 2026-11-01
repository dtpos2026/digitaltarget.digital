// ============================================================
// ESC/POS BUILDER — receipts, KOT and tokens are composed as raw
// printer bytes straight from the order data. No HTML, no browser
// layout, no page size: the printer gets exactly these bytes and
// starts immediately, then cuts. One builder for every slip type.
// ============================================================
import type { Order, RestaurantSettings } from '@/lib/types';
import { serviceChargeLabel } from '@/lib/serviceCharge';
import { discountLineTitle, variantNote } from '@/lib/billLabels';
import { resolveReceiptLayout, type ReceiptLayout } from './receiptLayout';
import { columnsOf } from './paperProfile';
import { DEVELOPER_CREDIT } from '@/lib/displayTemplates';
import { rawCodeBlocks } from './codeRaster';
import type { CodePosition } from '@/lib/receiptCodes';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type Paper = '58mm' | '80mm' | '110mm';

/**
 * Characters per line in Font A.
 *
 * Reads the shared paper profile rather than a local table. The old local
 * copy claimed 64 columns on 110mm paper where the profile says 69; the
 * ruler in the alignment test is exactly this many characters wide, so a
 * wrong constant here wraps the ruler and misreports the margins.
 */
export function columnsFor(paper: Paper): number {
  return columnsOf(paper, 'A');
}

export interface EscposDocOptions {
  /** Left margin (mm) — becomes `GS L`. */
  leftMm?: number;
  /** Right margin (mm) — narrows `GS W`. */
  rightMm?: number;
  /** Calibrated content width (mm). */
  contentWidthMm?: number;
  /** Font A (default) or the narrower Font B. */
  font?: 'A' | 'B';
}

/**
 * Minimum line feeds between the last printed line and the cut.
 *
 * Six 24-dot lines is 144 dots, about 18mm, which clears the cutter on the
 * models in the field. This is a floor, not a default: a caller asking for
 * fewer is asking for the blade to cut through its own last line.
 */
const MIN_CUT_FEED_LINES = 6;

const encoder = new TextEncoder();

/** Fold characters the thermal codepage cannot show into safe ASCII. */
function asciify(s: string): string {
  return String(s ?? '')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u00A0/g, ' ');
}

export class EscposDoc {
  private buf: number[] = [];
  readonly cols: number;
  /** The resolved geometry this document is positioned by. */
  readonly layout: ReceiptLayout;

  /**
   * @param paper  paper profile
   * @param opts   margins (mm) from Printer Settings. Left/right are applied
   *               ONCE here, as `GS L` and `GS W`.
   */
  constructor(readonly paper: Paper = '80mm', opts: EscposDocOptions = {}) {
    this.layout = resolveReceiptLayout({
      paper,
      leftMm: opts.leftMm,
      rightMm: opts.rightMm,
      contentWidthMm: opts.contentWidthMm,
    });
    this.cols = opts.font === 'B' ? this.layout.columnsFontB : this.layout.columnsFontA;

    this.raw(ESC, 0x40);        // ESC @  — initialize
    this.raw(ESC, 0x74, 0x00);  // ESC t  — codepage CP437

    // ===== STICKY GEOMETRY (the lopsided-slip trap) =====
    // `GS L` (left margin) and `GS W` (print area width) live in the
    // printer's NVRAM and SURVIVE between jobs and power cycles. A printer
    // that was ever left with a non-zero left margin, or a print-area width
    // below the head's full dot count, prints every later job shifted and
    // short — content tight to the left with a wide blank band on the right,
    // no matter what the POS sends. ESC @ does NOT reset them on many
    // models, so they must be stated explicitly on EVERY job. That is the
    // whole reason this is unconditional rather than "only when non-zero".
    this.setLeftMargin(this.layout.leftDots);
    this.setPrintAreaWidth(this.layout.contentDots);

    if (opts.font === 'B') this.fontB(true);
    this.left();
  }

  raw(...b: number[]) { this.buf.push(...b); return this; }

  /** `GS L nL nH` — left margin, in dots from the printable area's edge. */
  setLeftMargin(dots: number) {
    const n = Math.max(0, Math.min(65535, Math.round(dots) || 0));
    return this.raw(GS, 0x4c, n & 0xff, (n >> 8) & 0xff);
  }

  /** `GS W nL nH` — print area width, in dots. */
  setPrintAreaWidth(dots: number) {
    const n = Math.max(1, Math.min(65535, Math.round(dots) || 1));
    return this.raw(GS, 0x57, n & 0xff, (n >> 8) & 0xff);
  }

  /** `ESC M` — Font A (12x24) or Font B (9x17). Font B fits more columns. */
  fontB(on: boolean) { return this.raw(ESC, 0x4d, on ? 1 : 0); }

  /** `ESC 3 n` — line spacing in dots. Compact mode's real paper saving. */
  lineSpacing(dots: number) {
    return this.raw(ESC, 0x33, Math.max(0, Math.min(255, Math.round(dots))));
  }

  /** `ESC 2` — restore the printer's default line spacing. */
  defaultLineSpacing() { return this.raw(ESC, 0x32); }

  /** `ESC p` — cash-drawer kick on the given pin. */
  drawerKick(pin: 0 | 1 = 0) { return this.raw(ESC, 0x70, pin, 0x19, 0xfa); }

  left() { return this.raw(ESC, 0x61, 0x00); }
  center() { return this.raw(ESC, 0x61, 0x01); }
  right() { return this.raw(ESC, 0x61, 0x02); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  /** width/height multipliers 1..4 */
  size(w = 1, h = 1) {
    const width = Math.min(4, Math.max(1, w));
    const n = ((width - 1) << 4) | (Math.min(4, Math.max(1, h)) - 1);
    this.widthMul = width;
    return this.raw(GS, 0x21, n);
  }
  underline(on: boolean) { return this.raw(ESC, 0x2d, on ? 1 : 0); }

  text(s: string) {
    const bytes = encoder.encode(asciify(s));
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    return this;
  }

  line(s = '') { return this.text(s).raw(LF); }

  /**
   * Current width multiplier, tracked so wrapping knows the real column count.
   *
   * `GS !` doubles the glyph width, which halves how many characters fit. The
   * builder did not track this, so a 25-character shop name printed at double
   * width ran past the 24 columns an 80mm roll actually has and the printer
   * hard-wrapped it mid-word: "FIRST CHEF PIZZA & BUR / GER".
   */
  private widthMul = 1;

  /** Columns available at the CURRENT size. */
  get effectiveCols(): number {
    return Math.max(1, Math.floor(this.cols / this.widthMul));
  }

  /**
   * A line that wraps on word boundaries at the current size.
   *
   * Use this for anything the shop types in — names, addresses, footers —
   * because their length is not under our control and a hard wrap mid-word
   * looks like a broken receipt.
   */
  fit(s: string) { return this.wrap(s, this.effectiveCols); }

  /** Word-wrapped paragraph at the current column width. */
  wrap(s: string, width = this.cols) {
    const words = asciify(s).split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      if (!cur.length) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
      else { this.line(cur); cur = w; }
    }
    if (cur.length) this.line(cur);
    return this;
  }

  /**
   * Left text + right text on one line.
   *
   * A label too long to sit beside the value wraps on word boundaries; the
   * value stays on the LAST line, flush right. Nothing is cut off — a report
   * that silently drops the end of a product name is not a report.
   */
  lr(left: string, right: string, width = this.cols) {
    const l = asciify(left);
    const r = asciify(right).slice(0, width);
    if (l.length + r.length + 1 <= width) return this.line(l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r);
    const lines: string[] = [];
    let cur = '';
    for (let w of l.split(/\s+/).filter(Boolean)) {
      // A single word wider than the paper is split, never cut off.
      while (w.length > width) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, width)); w = w.slice(width); }
      if (!w) continue;
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    // The value shares the last line when it fits there, else gets its own.
    let last = cur;
    if (last.length + 1 + r.length > width) { lines.push(last); last = ''; }
    for (const ln of lines) this.line(ln);
    return this.line(last + ' '.repeat(Math.max(1, width - last.length - r.length)) + r);
  }

  /**
   * One item row: name on the left, amount hard against the right edge.
   *
   * The name wraps onto continuation lines instead of being truncated, and
   * the amount always stays on the FIRST line beside the start of the name,
   * which is where a customer looks for it.
   */
  itemLine(name: string, amount: string, amountW = 10, sizeH: 1 | 2 = 1) {
    if (sizeH > 1) this.size(1, sizeH);
    const cols = this.effectiveCols;
    const nameW = Math.max(8, cols - amountW);
    const words = asciify(name).split(/\s+/).filter(Boolean);

    const rows: string[] = [];
    let cur = '';
    for (const w of words) {
      if (!cur.length) cur = w;
      else if (cur.length + 1 + w.length <= nameW) cur += ' ' + w;
      else { rows.push(cur); cur = w; }
    }
    if (cur.length) rows.push(cur);
    if (!rows.length) rows.push('');

    // First row carries the amount, flush right.
    const head = rows[0];
    this.line(head + ' '.repeat(Math.max(1, cols - head.length - amount.length)) + amount);
    // Continuation rows are indented so they read as part of the same item.
    for (let i = 1; i < rows.length; i++) this.line('    ' + rows[i]);
    if (sizeH > 1) this.size(1, 1);
    return this;
  }

  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }

  feed(n = 1) { for (let i = 0; i < n; i++) this.buf.push(LF); return this; }

  /**
   * Feed clear of the cutter, then full cut.
   *
   * ===== WHY THIS IS NOT JUST A FEW LINE FEEDS =====
   * The cutter sits 15-25mm PAST the print head on most thermal printers, so
   * the paper has to advance at least that far or the blade comes down on
   * text that has only just been printed. Two things made that worse here:
   *
   *   1. The feed was counted in LINE FEEDS, whose height depends on the
   *      CURRENT line spacing. Paper Save sets `ESC 3 20`, so each feed line
   *      shrank from 24 dots to 20 — and compact also asked for fewer lines.
   *      Three lines at 20 dots is 7.5mm of clearance against a cutter 20mm
   *      away, which is exactly the "it cuts before the last text" report.
   *   2. Nothing restored the default spacing first, so the distance varied
   *      with whatever the slip happened to leave set.
   *
   * So: restore the default spacing, then feed an EXACT number of lines with
   * `ESC d`, then cut. The distance is physical and does not shrink because
   * the user wants to save paper — compact mode saves paper in the body, not
   * in the clearance the blade needs.
   */
  cut(feedLines = MIN_CUT_FEED_LINES) {
    this.left().size(1, 1).bold(false);
    // Back to 24-dot lines so the feed below is a known physical distance.
    this.defaultLineSpacing();
    const lines = Math.max(MIN_CUT_FEED_LINES, Math.min(12, Math.round(feedLines) || MIN_CUT_FEED_LINES));
    // ESC d n — feed exactly n lines, independent of buffered content.
    this.raw(ESC, 0x64, lines);
    return this.raw(GS, 0x56, 0x00);
  }

  beep() { return this.raw(ESC, 0x42, 0x02, 0x02); }

  bytes(): number[] { return this.buf.slice(); }
}

function money(n: number, sym: string): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `${sym}${s}`;
}

function when(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Where a raw slip sits on the paper, resolved by the CALLER.
 *
 * This is the half of the margin story the raw path was missing. It read the
 * shop-level `receiptMarginLeft` and nothing else, so a printer calibrated to
 * 3mm in Printer Center, or a KOT given its own right margin, printed exactly
 * where it always had — and the shop, quite reasonably, reported that the
 * margin settings did nothing. The rendered path had been resolving printer
 * and per-slip margins correctly the whole time, which is why the same bill
 * moved through the driver and refused to move raw.
 *
 * The caller resolves it because only the caller knows WHICH printer and
 * WHICH kind of slip this is; see `slipGeometryFor` in directPrint.ts.
 */
export interface SlipGeometry {
  paper?: Paper;
  /** Left margin (mm). Undefined means "not configured" — not zero. */
  leftMm?: number;
  /** Right margin (mm). Undefined means "not configured". */
  rightMm?: number;
  /** Calibrated content width (mm). */
  contentWidthMm?: number;
  /** Cut the paper at the end of the slip. */
  autoCut?: boolean;
  /** Sound the printer's buzzer when the slip finishes. */
  beep?: boolean;
}

export function paperOf(settings: any, geom?: SlipGeometry): Paper {
  const p = geom?.paper ?? settings?.paperSize;
  return p === '58mm' || p === '110mm' ? p : '80mm';
}

/** A number the caller actually supplied, or undefined. */
function mm(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Margin/geometry options for a slip.
 *
 * The raw path gets its margins from the SAME numbers as the HTML path, so a
 * receipt printed raw and the same receipt printed through the driver land in
 * the same place on the paper. Resolved geometry from the caller wins; the
 * shop-level values are the fallback for callers that have none.
 *
 * Note the deliberate absence of `|| 0`. An unset margin must stay UNDEFINED
 * so `resolveReceiptLayout` can apply the paper profile's safe inset — `|| 0`
 * turned every unconfigured slip into an explicit zero and printed the first
 * column on the head's very first dot, which is what shaved the left edge.
 */
export function docOptionsOf(settings: any, font?: 'A' | 'B', geom?: SlipGeometry): EscposDocOptions {
  return {
    leftMm: geom?.leftMm ?? mm(settings?.receiptMarginLeft),
    rightMm: geom?.rightMm ?? mm(settings?.receiptMarginRight),
    contentWidthMm: geom?.contentWidthMm ?? mm(settings?.receiptPrintWidthMm) ?? undefined,
    font,
  };
}

/**
 * Finish a slip: cut unless the printer is configured not to, and beep if it
 * is configured to.
 *
 * Both were settings a shop could switch in Printer Center that the raw path
 * never read. The beep goes BEFORE the cut so it sounds as the slip is
 * finished rather than after the paper has already been handed over.
 */
export function finishSlip(d: EscposDoc, geom?: SlipGeometry): void {
  if (geom?.beep) d.beep();
  if (geom?.autoCut === false) { d.feed(3); return; }
  d.cut();
}

// ------------------------------------------------------------
// CUSTOMER RECEIPT
// ------------------------------------------------------------
export function buildReceiptBytes(order: Order, settings: RestaurantSettings, geom?: SlipGeometry): number[] {
  const s: any = settings || {};
  const compact = !!s.receiptCompactMode;
  const sym = s.currencySymbol || 'Rs ';
  const d = new EscposDoc(paperOf(s, geom), docOptionsOf(s, undefined, geom));
  // Settings → Receipt → QR & Barcode: printed as images at their position
  // (see codeRaster.ts). Nothing at all when both are off.
  const codes = (position: CodePosition) => {
    let blocks: ReturnType<typeof rawCodeBlocks> = [];
    try { blocks = rawCodeBlocks(order, settings, position, d.layout.contentDots); } catch { /* a code must never stop a bill */ }
    for (const b of blocks) {
      d.bold(false).size(1, 1).center();
      d.raw(...b.raster);
      if (b.text) d.line(b.text);
      if (b.caption) d.line(b.caption);
      d.feed(1);
    }
    if (blocks.length) d.left();
    return blocks.length > 0;
  };
  codes('above');
  // ===== RAW TEXT SIZE =====
  // 'large' prints the item rows and the total at double HEIGHT (GS ! keeps
  // the width, so the line still fits the same number of characters). The
  // plain slip reads much closer to the rendered template's weight, which is
  // what shops mean when they say the raw bill looks smaller than before.
  const large = s.receiptRawTextSize !== 'normal';
  const itemSize: 1 | 2 = large ? 2 : 1;
  // Bold body text. A thermal head fades with age and a compact slip fades
  // first, because its strokes are thinner. On by default.
  const bodyBold = s.receiptRawBold !== false;
  // Paper Save on the raw path: tighter line spacing is where the paper is
  // actually saved. 24 dots is the printer default. 20 measured cramped on a
  // 203 DPI head, so 22 is the floor — still a visible saving over a long
  // bill without the lines closing up on each other.
  if (compact) d.lineSpacing(22);

  d.center();
  if (s.name) { d.size(2, 2).bold(true).fit(s.name).size(1, 1).bold(false); }
  if (bodyBold) d.bold(true);
  if (!compact && s.address) d.wrap(s.address);
  const phones = [s.phone1, s.phone2].filter(Boolean).join(' / ');
  if (phones) d.line(phones);
  d.left().rule();

  const typeLabel = String(order.orderType || '').replace(/_/g, ' ').toUpperCase();
  d.bold(true).lr(`BILL #${order.orderNumber ?? ''}`, typeLabel).bold(false);
  d.line(when(order.paidAt || order.createdAt));
  if (order.tableName || order.tableLabel) d.line(`Table: ${order.tableName || order.tableLabel}`);
  if (order.cashierName) d.line(`Cashier: ${order.cashierName}`);
  const cust = order.customer as any;
  if (cust?.name) d.line(`Customer: ${cust.name}`);
  if (cust?.phone) d.line(`Phone: ${cust.phone}`);
  if (order.orderType === 'delivery' && cust?.address) d.wrap(`Address: ${cust.address}`);
  if (order.riderName) d.line(`Rider: ${order.riderName}`);
  d.rule();

  // Items — name (qty x price) ......... amount
  //
  // A long name WRAPS onto a continuation line rather than being cut. It used
  // to be hard-truncated to the column width, so the client's bill printed
  // "1 x Chicken Achari  - Large (Larg" with the rest of the name simply gone.
  // A customer cannot check a bill whose item names are chopped mid-word.
  const amountW = 10;
  for (const it of order.items || []) {
    const qty = it.quantity || 0;
    const size = variantNote(it as any);
    const label = `${qty} x ${it.name}${size ? ` (${size})` : ''}`;
    d.itemLine(label, money(it.lineTotal ?? qty * (it.price || 0), sym), amountW, itemSize);
    if (!compact && it.note) d.line(`   * ${it.note}`);
  }
  d.rule();

  d.lr('Subtotal', money(order.subtotal || 0, sym));
  if (order.discount) d.lr(discountLineTitle(order), '-' + money(order.discount, sym));
  if (order.tax) d.lr('Tax', money(order.tax, sym));
  if (order.serviceCharge) d.lr(serviceChargeLabel(order), money(order.serviceCharge, sym));
  if ((order as any).deliveryChargeAmount) d.lr('Delivery', money((order as any).deliveryChargeAmount, sym));
  if ((order as any).roundingAdjust) d.lr('Rounding', money((order as any).roundingAdjust, sym));
  d.rule('=');
  d.bold(true).size(large ? 2 : 1, 2);
  d.lr('TOTAL', money(order.grandTotal || 0, sym), d.effectiveCols);
  d.size(1, 1).bold(false);
  if (order.paymentMethod) d.lr('Paid by', String(order.paymentMethod).toUpperCase());
  if (order.cashReceived) d.lr('Cash', money(order.cashReceived, sym));
  if (order.changeReturned) d.lr('Change', money(order.changeReturned, sym));
  d.rule();

  d.bold(false).center();
  if (bodyBold) d.bold(true);
  if (s.thankYouText !== '') d.line(s.thankYouText || 'Thank You!');
  if (!compact && (s.visitAgainText || '') !== '') d.line(s.visitAgainText || 'Please Visit Again');
  if (!compact && s.receiptFooter) d.wrap(s.receiptFooter);
  // With no codes nothing is added here: the bill is byte-for-byte as before.
  if (codes('footer')) { d.center(); if (bodyBold) d.bold(true); }
  if (!compact && s.marketingFooter) d.wrap(s.marketingFooter);
  d.bold(false);
  codes('below');
  // Compact saves paper in the BODY. The clearance the blade needs is
  // physical and identical in both modes, so it is not reduced here.
  finishSlip(d, geom);
  return d.bytes();
}

// ------------------------------------------------------------
// KITCHEN ORDER TICKET
// ------------------------------------------------------------
export interface KotOpts {
  updateMode?: boolean;
  diffDeltas?: Record<string, number>;
  cancelDeltas?: Record<string, number>;
  cancelNames?: Record<string, string>;
  kotNo?: number;
  station?: string;
}

export function buildKotBytes(
  order: Order,
  settings: RestaurantSettings,
  opts: KotOpts = {},
  geom?: SlipGeometry,
): number[] {
  const s: any = settings || {};
  const d = new EscposDoc(paperOf(s, geom), docOptionsOf(s, undefined, geom));

  d.center();
  // ===== THE TICKET BELONGS TO THE RESTAURANT =====
  // The rendered KOT has always carried the shop's name. The raw one did not,
  // so switching a kitchen printer to raw quietly stripped it off every
  // ticket — the same slip, the same shop, one of them anonymous.
  if (s.kotShowShopName !== false && s.name) d.bold(true).fit(String(s.name)).bold(false);
  d.bold(true).size(2, 2);
  d.line(opts.updateMode ? 'KOT UPDATE' : 'KITCHEN ORDER');
  d.size(1, 1);
  if (opts.station) d.line(opts.station.toUpperCase());
  d.size(2, 2).line(`#${order.orderNumber ?? ''}`).size(1, 1).bold(false);
  d.left().line(when(order.createdAt));
  const typeLabel = String(order.orderType || '').replace(/_/g, ' ').toUpperCase();
  d.lr(typeLabel, order.tableName || order.tableLabel || '');
  if (opts.kotNo) d.line(`KOT #${opts.kotNo}`);
  d.rule('=');

  const lines: Array<{ qty: number; name: string; note?: string; cancelled?: boolean }> = [];
  for (const it of order.items || []) {
    const qty = opts.updateMode ? (opts.diffDeltas?.[it.id] || 0) : (it.quantity || 0);
    if (qty > 0) lines.push({ qty, name: it.name, note: it.note });
  }
  for (const [id, qty] of Object.entries(opts.cancelDeltas || {})) {
    if (qty > 0) lines.push({ qty, name: opts.cancelNames?.[id] || id, cancelled: true });
  }

  // The kitchen reads this across a counter, so it prints at double height by
  // default. Names WRAP rather than being cut: a chef cannot cook
  // "Chicken Achari - Large (Larg".
  const kotLarge = (s.kotRawTextSize ?? s.receiptRawTextSize) !== 'normal';
  d.size(1, kotLarge ? 2 : 1).bold(true);
  for (const l of lines) {
    d.fit(`${l.cancelled ? 'CANCEL ' : ''}${l.qty} x ${l.name}`);
    if (l.note) { d.size(1, 1).line(`    >> ${l.note}`).size(1, kotLarge ? 2 : 1); }
  }
  d.size(1, 1).bold(false);

  if (order.notes) { d.rule(); d.wrap(`Note: ${order.notes}`); }
  d.rule();
  d.center();
  if (s.kotFooterNote !== '') d.line(s.kotFooterNote || 'Please check the order before preparing');
  if (s.kotThankYouText !== '') d.line(s.kotThankYouText || '- Thank You -');
  // One small developer credit under the shop's own footer, the same line the
  // display screens carry. A shop can turn it off.
  if (s.kotShowDeveloperCredit !== false) d.line(DEVELOPER_CREDIT);
  finishSlip(d, geom);
  return d.bytes();
}

// ------------------------------------------------------------
// TANDOOR / COUNTER TOKEN
// ------------------------------------------------------------
export interface TokenData {
  orderNumber: number | string;
  items: { name: string; qty: number }[];
  restaurantName?: string;
  when?: Date;
}

export function buildTokenBytes(data: TokenData, settings: RestaurantSettings, geom?: SlipGeometry): number[] {
  const s: any = settings || {};
  const d = new EscposDoc(paperOf(s, geom), docOptionsOf(s, undefined, geom));
  const total = (data.items || []).reduce((a, i) => a + (i.qty || 0), 0);

  d.center();
  const rname = data.restaurantName || s.name;
  if (rname) d.bold(true).line(rname).bold(false);
  d.bold(true).line('*** TANDOOR TOKEN ***').bold(false);
  d.line(`Order #${data.orderNumber} · ${(data.when || new Date()).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`);
  d.left().rule();

  d.size(1, 2).bold(true);
  for (const it of data.items || []) d.itemLine(String(it.name), String(it.qty), 6);
  d.size(1, 1).bold(false);
  d.rule();
  if (s.tokenShowTotal !== false) d.bold(true).lr('Total pieces', String(total)).bold(false);

  d.center().feed(1);
  d.size(3, 3).bold(true).line(String(data.orderNumber)).size(1, 1).bold(false);
  d.line('TOKEN NUMBER');
  d.line('Hand over to the tandoor counter');
  finishSlip(d, geom);
  return d.bytes();
}

// ------------------------------------------------------------
// SHIFT REPORT
// ------------------------------------------------------------
/**
 * The shift report as raw ESC/POS.
 *
 * The report was the one slip with no raw builder at all, so turning on Fast
 * Billing printed a raw receipt, a raw KOT and a raw token — and then a
 * rendered report. Every slip type now has both renderers.
 *
 * Typed loosely on purpose: this consumes `buildShiftReportData`'s return
 * value, which is inferred rather than declared, and duplicating that shape
 * here would be a second source of truth that could drift.
 */
export function buildShiftReportBytes(data: any, settings: RestaurantSettings, geom?: SlipGeometry): number[] {
  const s: any = settings || data?.settings || {};
  const sym = s.currencySymbol || 'Rs ';
  const d = new EscposDoc(paperOf(s, geom), docOptionsOf(s, undefined, geom));
  const m = (n: number) => money(n, sym);

  d.center().bold(true).size(2, 2).fit(s.name || 'SHIFT REPORT').size(1, 1);
  d.line('SHIFT REPORT').bold(false);
  const r = data?.range || {};
  if (r.from) d.line(`From: ${when(new Date(r.from).toISOString())}`);
  if (r.to) d.line(`To:   ${when(new Date(r.to).toISOString())}`);
  d.left().rule('=');

  const sum = data?.summary || {};
  d.bold(true).line('SUMMARY').bold(false);
  d.lr('Product amount', m(sum.productAmount));
  if (sum.discount) d.lr('Discount', '-' + m(sum.discount));
  if (sum.serviceCharge) d.lr('Service charge', m(sum.serviceCharge));
  if (sum.rounding) d.lr('Rounding', m(sum.rounding));
  d.lr('Sub total', m(sum.subTotal));
  if (sum.refundAmount) d.lr('Refund', '-' + m(sum.refundAmount));
  d.bold(true).lr('Actual sales', m(sum.actualSales)).bold(false);
  d.rule();

  const tax = data?.tax || {};
  if (tax.taxAmount) {
    d.bold(true).line('TAX').bold(false);
    d.lr(`Taxable (${tax.taxPct || 0}%)`, m(tax.taxable));
    d.lr('Tax amount', m(tax.taxAmount));
    d.rule();
  }

  const tr = data?.transactions || {};
  d.bold(true).line('TRANSACTIONS').bold(false);
  d.lr('Checked out', String(tr.checkedOut ?? 0));
  d.lr('Average income', m(tr.avgIncome));
  d.lr('Sold products', String(tr.soldProducts ?? 0));
  if (tr.refunded) d.lr('Refunded', String(tr.refunded));
  d.rule();

  const dr = data?.drawer || {};
  d.bold(true).line('CASH DRAWER').bold(false);
  d.lr('Starting cash', m(dr.startingCash));
  d.lr('Order income', m(dr.orderIncome));
  if (dr.refund) d.lr('Refund', '-' + m(dr.refund));
  d.lr('Expected cash', m(dr.expectedCash));
  d.lr('Actual ending cash', m(dr.actualEndingCash));
  d.rule();

  const payments: any[] = Array.isArray(data?.payments) ? data.payments : [];
  if (payments.length) {
    d.bold(true).line('PAYMENT REPORT').bold(false);
    for (const p of payments) {
      d.lr(String(p.method || '').toUpperCase(), `${m(p.amount)}  ${Number(p.percent || 0).toFixed(0)}%`);
    }
    d.rule();
  }

  const types: any[] = Array.isArray(data?.types) ? data.types : [];
  if (types.length) {
    d.bold(true).line('ORDER TYPES').bold(false);
    for (const t of types) d.lr(String(t.type || ''), `${t.orders || 0}  ${m(t.amount)}`);
    d.rule();
  }

  const cats: any[] = Array.isArray(data?.categories) ? data.categories : [];
  if (cats.length) {
    d.bold(true).line('SOLD CATEGORIES').bold(false);
    for (const c of cats) d.lr(String(c.name || '').slice(0, d.cols - 16), `${c.qty || 0}  ${m(c.amount)}`);
    d.rule();
  }

  const prods: any[] = Array.isArray(data?.products) ? data.products : [];
  if (prods.length) {
    d.bold(true).line('SOLD PRODUCTS').bold(false);
    for (const p of prods) d.lr(String(p.name || '').slice(0, d.cols - 16), `${p.qty || 0}  ${m(p.amount)}`);
    d.rule('=');
  }

  const tot = data?.totals || {};
  d.bold(true).lr('TOTAL', `${tot.catQty || 0}  ${m(tot.catAmt)}`).bold(false);
  d.center().line(`Printed ${when()}`);
  finishSlip(d, geom);
  return d.bytes();
}
