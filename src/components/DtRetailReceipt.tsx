// ============================================================
// DT RETAIL RECEIPT RENDERER
//
// The eleven receipt designs of the DT Retail design guide: Classic, Modern,
// Minimal, Restaurant, Retail Invoice, Compact, Boxed Grid, Bold Restaurant,
// Tax Invoice + QR, Luxury and Ticket.
//
// Like every premium template these are CONFIGURATION, never content: the
// words and numbers on the paper come from the live order and the shop's own
// settings at print time, so one design works for every restaurant and
// branch. PremiumReceipt hands over to this component when a template has a
// `dtr` design; the customization the shop saved (what to show, type size,
// spacing, typeface, weight) applies to these exactly as it does to the rest.
//
// Drawn for a 203 DPI 80mm head (58mm is the same design narrower):
//   • system typefaces only, so the print worker rasterises what the preview
//     showed;
//   • solid blacks and 1–3px rules — no greys, no hairlines a thermal head
//     would drop;
//   • money and quantity cells never wrap mid-number;
//   • white-on-black blocks are plain dark fills, which the print window
//     already turns into readable reversed text.
// ============================================================
import React from 'react';
import { serviceChargeLabel } from '@/lib/serviceCharge';
import { discountLineTitle, variantNote } from '@/lib/billLabels';
import { ReceiptCodesSlot } from '@/components/ReceiptCodes';
import { FONT_STACKS, ITEM_TABLE_CSS } from '@/components/premiumShared';
import type { CartItem, Order, RestaurantSettings } from '@/lib/types';
import {
  amountInWords,
  getPremiumTemplate,
  type DtrDesign,
  type PremiumCustomization,
  type PremiumTemplateId,
} from '@/lib/premiumReceiptTemplates';

interface Props {
  order: Order;
  settings: RestaurantSettings;
  templateId: PremiumTemplateId;
  design: DtrDesign;
  customization: PremiumCustomization;
}

// ---------------------------------------------------------------- data
interface Line {
  name: string;
  variant: string;
  note: string;
  qty: string;
  qtyNum: number;
  rate: string;
  amount: string;
  weighed: boolean;
}

interface Data {
  order: Order;
  s: any;
  c: PremiumCustomization;
  base: number;
  sp: number;
  isp: number;
  name: string;
  address: string;
  phones: string;
  note: string;
  logo: React.ReactNode;
  meta: Array<[string, string]>;
  typeText: string;
  tableText: string;
  tokenText: string;
  orderText: string;
  customerName: string;
  lines: Line[];
  itemCount: number;
  totalQty: number;
  adjust: Array<[string, string]>;
  grand: string;
  grandNum: number;
  payRows: Array<[string, string]>;
  thanks: string;
  footer: string;
  marketing: string;
  powered: boolean;
  isPaid: boolean;
  saved: number;
  savedText: string;
  words: string;
  qr: React.ReactNode;
  num: (n: unknown) => string;
  cur: (n: unknown) => string;
  /** 58mm paper: the same design, narrower — fewer columns, smaller display type. */
  narrow: boolean;
  /** A display-size step, scaled down on narrow paper. */
  bump: (n: number) => number;
}

const pad = (n: unknown, w: number) => String(n ?? '').padStart(w, '0');

function typeLabel(order: Order): string {
  switch (order.orderType) {
    case 'dining': return 'Dine-In';
    case 'takeaway': return 'Takeaway';
    case 'delivery': return 'Delivery';
    case 'foodpanda': return 'Foodpanda';
    default: return String(order.orderType || 'Order').replace(/_/g, ' ');
  }
}

function tableText(order: Order): string {
  const t = String(order.tableName || order.tableLabel || '').trim();
  if (!t) return '';
  return /^\d+$/.test(t) ? `Table ${t}` : t;
}

function dateTime(d: Date): string {
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date} ${time}`;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function prepare(order: Order, settings: RestaurantSettings, c: PremiumCustomization, qrOn: boolean): Data {
  const s = settings as any;
  const narrow = String(s.paperSize || '') === '58mm';
  const decimals = s.receiptHideDecimals === true ? 0 : 2;
  const num = (n: unknown) => (Number(n) || 0).toLocaleString('en-PK', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
  const symbol = String(s.currencySymbol ?? 'Rs.').trim() || 'Rs.';
  const cur = (n: unknown) => `${symbol}${/[A-Za-z.]$/.test(symbol) ? ' ' : ''}${num(n)}`;

  const created = new Date(order.createdAt || Date.now());
  const isPaid = !!order.paidAt || (order.amountPaid ?? 0) >= (order.grandTotal || 0);
  const type = typeLabel(order);
  const table = tableText(order);
  const orderText = order.orderNumber != null ? `ORD-${pad(order.orderNumber, 6)}` : '';
  const tokenText = order.orderNumber != null ? pad(order.orderNumber, 3) : '';
  const customerName = c.showCustomer ? String(order.customer?.name || '').trim() : '';

  // ---- meta rows: a row with no value is dropped, not printed empty -----
  const meta: Array<[string, string]> = [];
  if (c.showOrderNumber && orderText) meta.push(['Order #', orderText]);
  if (c.showDateTime) meta.push(['Date', dateTime(created)]);
  if (c.showOrderType) meta.push(['Type', type]);
  if (c.showTable && table) meta.push(['Table', table]);
  if (c.showOrderNumber && tokenText) meta.push(['Token', tokenText]);
  if (c.showCashier && order.cashierName) meta.push(['Cashier', order.cashierName]);
  if (c.showCashier && order.waiterName) meta.push(['Waiter', order.waiterName]);
  if (customerName) meta.push(['Customer', customerName]);
  if (c.showCustomer && order.customer?.phone) meta.push(['Mobile', order.customer.phone]);
  if (c.showDelivery && order.orderType === 'delivery') {
    const addr = order.customer?.fullAddress || order.customer?.address;
    if (addr) meta.push(['Address', addr]);
    if (order.riderName) meta.push(['Rider', order.riderName]);
  }

  // ---- lines ---------------------------------------------------------------
  const items: CartItem[] = order.items || [];
  const lines: Line[] = items.map(it => {
    const weighed = it.pricingType === 'weight' && !!it.weightGrams && it.weightGrams > 0;
    const qtyNum = Number(it.quantity);
    const qty = weighed
      ? (it.weightGrams! / 1000).toFixed(3)
      : (Number.isFinite(qtyNum) && qtyNum > 0 ? String(qtyNum) : '1');
    return {
      name: it.name,
      variant: c.showVariants ? variantNote(it) : '',
      note: c.showItemNotes ? (it.note || '') : '',
      qty,
      qtyNum: weighed ? 1 : (Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 1),
      rate: num(it.price),
      amount: num(it.lineTotal ?? it.quantity * it.price),
      weighed,
    };
  });
  const totalQty = lines.reduce((t, l) => t + l.qtyNum, 0);

  // ---- totals --------------------------------------------------------------
  const adjust: Array<[string, string]> = [];
  if (c.showSubtotal) adjust.push(['Subtotal', num(order.subtotal)]);
  if (c.showDiscount && order.discount) adjust.push([discountLineTitle(order), `-${num(order.discount)}`]);
  if (c.showTax && order.tax) adjust.push([s.countryTaxLabel || 'Tax', num(order.tax)]);
  if (c.showServiceCharge && order.serviceCharge) adjust.push([serviceChargeLabel(order), num(order.serviceCharge)]);
  if (order.deliveryChargeAmount) adjust.push(['Delivery', num(order.deliveryChargeAmount)]);
  if (order.roundingAdjust) adjust.push(['Rounding', num(order.roundingAdjust)]);

  const payRows: Array<[string, string]> = [];
  if (c.showPaymentMethod && order.paymentMethod) payRows.push(['Payment', cap(String(order.paymentMethod).replace(/_/g, ' '))]);
  if (c.showChange && order.cashReceived) payRows.push(['Paid', num(order.cashReceived)]);
  if (c.showChange && order.changeReturned) payRows.push(['Change', num(order.changeReturned)]);

  const saved = c.showDiscount ? Number(order.discount) || 0 : 0;
  const words = /^rs/i.test(symbol) ? `Rupees ${amountInWords(order.grandTotal)}` : amountInWords(order.grandTotal);

  const logo = c.showLogo && s.logo
    ? <img src={s.logo} alt="" style={{ width: `${c.logoWidthPx}px`, maxWidth: '100%', objectFit: 'contain', display: 'block', margin: '0 auto 2px' }} />
    : null;
  const qr = qrOn && s.receiptQrImage
    ? <img src={s.receiptQrImage} alt="" style={{ width: 96, height: 96, margin: '4px auto 0', display: 'block', objectFit: 'contain' }} />
    : null;

  return {
    order, s, c, base: c.fontSize, sp: c.sectionSpacing, isp: c.itemSpacing,
    name: c.showName ? String(s.name || '') : '',
    address: c.showAddress ? String(s.address || '') : '',
    phones: c.showPhone ? [s.phone1, s.phone2].filter(Boolean).join(' · ') : '',
    note: c.headerNote,
    logo, meta, typeText: type, tableText: table, tokenText, orderText, customerName,
    lines, itemCount: lines.length, totalQty, adjust,
    grand: cur(order.grandTotal), grandNum: Number(order.grandTotal) || 0,
    payRows,
    thanks: c.thankYouText || s.thankYouText || 'Thank you for your visit! Please come again.',
    footer: c.footerText || s.receiptFooter || '',
    marketing: s.marketingFooter || '',
    powered: c.showPoweredBy,
    isPaid, saved, savedText: cur(saved), words, qr, num, cur,
    narrow, bump: (n: number) => (narrow ? Math.max(1, Math.round(n * 0.55)) : n),
  };
}

// ---------------------------------------------------------- primitives
const INK = '#000';

const Dash: React.FC<{ w?: number; m?: number }> = ({ w = 1, m = 4 }) => (
  <div style={{ borderTop: `${w}px dashed ${INK}`, margin: `${m}px 0` }} />
);
const Solid: React.FC<{ w?: number; m?: number }> = ({ w = 1, m = 4 }) => (
  <div style={{ borderTop: `${w}px solid ${INK}`, margin: `${m}px 0` }} />
);
const Double: React.FC<{ m?: number }> = ({ m = 3 }) => (
  <div style={{ borderTop: `3px double ${INK}`, margin: `${m}px 0` }} />
);

/** label left, value right. */
const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode; size?: number; kBold?: boolean; vBold?: boolean; gap?: number; nowrap?: boolean }> =
  ({ k, v, size, kBold, vBold, gap = 6, nowrap }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap, fontSize: size }}>
      <span style={{ fontWeight: kBold ? 800 : undefined, whiteSpace: nowrap ? 'nowrap' : undefined }}>{k}</span>
      <span style={{ fontWeight: vBold ? 800 : undefined, textAlign: 'right', wordBreak: 'break-word', whiteSpace: nowrap ? 'nowrap' : undefined }}>{v}</span>
    </div>
  );

const Note: React.FC<{ d: Data; text: string; indent?: number; lead?: string }> = ({ d, text, indent = 0, lead = '- ' }) => (
  <div style={{ fontSize: d.base - 1, fontStyle: 'italic', fontWeight: 400, paddingLeft: indent }}>{lead}{text}</div>
);

const ReverseBar: React.FC<{ children: React.ReactNode; size: number; space?: number; radius?: number; pad?: string }> =
  ({ children, size, space = 1, radius = 0, pad = '4px 6px' }) => (
    <div className="dt-reverse" style={{
      background: INK, color: '#fff', textAlign: 'center', fontWeight: 900, fontSize: size,
      letterSpacing: space, padding: pad, borderRadius: radius,
      WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
    }}>{children}</div>
  );

/** Shop name, address, phones and the free header line. */
const ShopHeader: React.FC<{ d: Data; nameSize?: number; noteBold?: boolean; noteLead?: string; letter?: number; phoneLead?: string }> =
  ({ d, nameSize, noteBold, noteLead = '', letter, phoneLead = 'Ph: ' }) => (
    <div style={{ textAlign: 'center' }}>
      {d.logo}
      {d.name && <div style={{ fontSize: nameSize ?? d.base + d.bump(6), fontWeight: 800, lineHeight: 1.15, letterSpacing: letter }}>{d.name}</div>}
      {d.address && <div>{d.address}</div>}
      {d.phones && <div>{phoneLead}{d.phones}</div>}
      {d.note && <div style={{ fontWeight: noteBold ? 800 : undefined }}>{noteLead}{d.note}</div>}
    </div>
  );

/** thank-you, footer text, marketing line, QR, scan codes, "powered by". */
const Footer: React.FC<{ d: Data; align?: 'center' | 'left'; italic?: boolean; divider?: boolean }> =
  ({ d, align = 'center', italic, divider }) => (
    <div style={{ textAlign: align, marginTop: d.sp }}>
      {divider && <Dash />}
      {d.thanks && <div style={{ fontStyle: italic ? 'italic' : undefined }}>{d.thanks}</div>}
      {d.footer && <div style={{ fontSize: d.base - 1 }}>{d.footer}</div>}
      {d.marketing && <div style={{ fontSize: d.base - 2 }}>{d.marketing}</div>}
      {d.qr}
      <ReceiptCodesSlot position="footer" />
      {d.powered && <div style={{ fontSize: d.base - 2, marginTop: 2, fontStyle: italic ? 'italic' : undefined }}>Powered by Digital Target · DT POS</div>}
    </div>
  );

// Grid helpers ---------------------------------------------------------------
// The thermal print stylesheet restyles every <table> (forced 1px borders, bold
// first column, middle alignment), which would turn the borderless designs into
// grids and bold every item name. So nothing here is a <table>: rows and
// columns are CSS grid, which that stylesheet leaves alone, and the columns
// still line up because the whole block is ONE grid.

/** One grid, columns sized by content except the name column. */
const Grid: React.FC<{ template: string; children: React.ReactNode; mt?: number; frame?: number; gap?: number }> =
  ({ template, children, mt = 0, frame = 0, gap = 0 }) => (
    <div style={{
      display: 'grid', gridTemplateColumns: template, columnGap: gap, marginTop: mt,
      ...(frame ? { borderTop: `${frame}px solid ${INK}`, borderLeft: `${frame}px solid ${INK}` } : {}),
    }}>{children}</div>
  );

/** A cell of a bordered Grid (right and bottom rule; the Grid draws top and left). */
const Box: React.FC<{
  d: Data; children?: React.ReactNode; align?: 'left' | 'right' | 'center'; bold?: boolean; black?: boolean;
  nowrap?: boolean; size?: number; span?: number; frame?: number; cls?: string;
}> = ({ d, children, align = 'left', bold, black, nowrap, size, span, frame = 1, cls }) => (
  <div
    className={[black ? 'dt-reverse' : '', cls || ''].filter(Boolean).join(' ') || undefined}
    style={{
      borderRight: `${frame}px solid ${INK}`, borderBottom: `${frame}px solid ${INK}`,
      padding: `${2 + d.isp / 2}px 4px`, textAlign: align, minWidth: 0, wordBreak: 'break-word',
      fontWeight: bold ? 800 : undefined, whiteSpace: nowrap ? 'nowrap' : undefined, fontSize: size,
      gridColumn: span ? `span ${span}` : undefined,
      ...(black ? { background: INK, color: '#fff', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } : {}),
    }}
  >{children}</div>
);

/** Two-column bordered block: bold label | value. */
const MetaGrid: React.FC<{ d: Data; rows: Array<[string, string]>; labelW?: string }> = ({ d, rows, labelW = '34%' }) => (
  <Grid template={`${d.narrow ? 'auto' : labelW} minmax(0,1fr)`} mt={d.sp} frame={1}>
    {rows.map(([k, v]) => (
      <React.Fragment key={k + v}>
        <Box d={d} bold nowrap={d.narrow}>{k}</Box>
        <Box d={d}>{v}</Box>
      </React.Fragment>
    ))}
  </Grid>
);

type GridCol = 'sr' | 'name' | 'qty' | 'rate' | 'amount';
const COL_LABEL: Record<GridCol, string> = { sr: '#', name: 'Description', qty: 'Qty', rate: 'Rate', amount: 'Amount' };
const COL_ALIGN: Record<GridCol, 'left' | 'right' | 'center'> = { sr: 'center', name: 'left', qty: 'center', rate: 'right', amount: 'right' };

/** The bordered item table used by the invoice-style designs. */
const ItemGrid: React.FC<{
  d: Data; cols: GridCol[]; blackHead?: boolean; boldCells?: boolean; nameLabel?: string; srLabel?: string;
}> = ({ d, cols, blackHead, boldCells, nameLabel = 'Description', srLabel = '#' }) => {
  // Narrow paper has no room for the serial and rate columns; the rate moves under the name.
  const use = cols.filter(col => (col !== 'sr' || d.c.showSerial) && !(d.narrow && (col === 'sr' || col === 'rate')));
  const label = (col: GridCol) => (col === 'name' ? nameLabel : col === 'sr' ? srLabel : COL_LABEL[col]);
  const template = use.map(col => (col === 'name' ? 'minmax(0,1fr)' : 'auto')).join(' ');
  return (
    <Grid template={template} mt={d.sp} frame={1}>
      {use.map(col => (
        <Box key={`h-${col}`} d={d} align={COL_ALIGN[col]} bold black={blackHead} nowrap={col !== 'name'}>{label(col)}</Box>
      ))}
      {d.lines.map((l, i) => (
        <React.Fragment key={i}>
          {use.map(col => (
            <Box
              key={col} d={d} align={COL_ALIGN[col]} nowrap={col !== 'name'}
              bold={!!boldCells && (col === 'name' || col === 'qty' || col === 'amount')}
            >
              {col === 'sr' ? i + 1 : col === 'name' ? (
                <>
                  {l.name}{l.variant ? <span style={{ fontWeight: 400 }}> ({l.variant})</span> : null}
                  {d.narrow && cols.includes('rate') && <div style={{ fontSize: d.base - 1, fontWeight: 400 }}>@ {l.rate}</div>}
                  {l.note && <Note d={d} text={l.note} />}
                </>
              ) : col === 'qty' ? l.qty : col === 'rate' ? l.rate : l.amount}
            </Box>
          ))}
        </React.Fragment>
      ))}
    </Grid>
  );
};

/** "Items: 4 … Total Qty: 7". */
const CountLine: React.FC<{ d: Data; qtyLabel?: string }> = ({ d, qtyLabel = 'Total Qty' }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: d.base - 1, marginTop: 3 }}>
    <span>Items: <span style={{ fontWeight: 800 }}>{d.itemCount}</span></span>
    <span>{qtyLabel}: <span style={{ fontWeight: 800 }}>{Number.isInteger(d.totalQty) ? d.totalQty : d.totalQty.toFixed(3)}</span></span>
  </div>
);

/** Bordered label | value rows, the net row emphasised (or reversed). */
const TotalsGrid: React.FC<{
  d: Data; rows: Array<[string, string]>; net: [string, string]; after: Array<[string, string]>;
  boldLabels?: boolean; boldAfter?: boolean; netBlack?: boolean;
}> = ({ d, rows, net, after, boldLabels, boldAfter, netBlack }) => (
  <Grid template={d.narrow ? 'minmax(0,1fr) auto' : '1.55fr 1fr'} mt={4} frame={1}>
    {rows.map(([k, v]) => (
      <React.Fragment key={k}>
        <Box d={d} bold={boldLabels}>{k}</Box>
        <Box d={d} align="right" nowrap>{v}</Box>
      </React.Fragment>
    ))}
    <Box d={d} bold black={netBlack} size={d.base + d.bump(4)} cls="grand-total">{net[0]}</Box>
    <Box d={d} bold black={netBlack} align="right" nowrap size={d.base + d.bump(3)} cls="grand-total">{net[1]}</Box>
    {after.map(([k, v]) => (
      <React.Fragment key={k}>
        <Box d={d}>{k}</Box>
        <Box d={d} align="right" nowrap bold={boldAfter}>{v}</Box>
      </React.Fragment>
    ))}
  </Grid>
);

// ---------------------------------------------------------------- designs
function classic(d: Data) {
  const { base } = d;
  return (
    <>
      <ShopHeader d={d} />
      <Dash m={d.sp} />
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: base + 1, letterSpacing: 0.5 }}>SALES RECEIPT</div>
      <Dash m={d.sp} />
      {d.meta.map(([k, v]) => <KV key={k + v} k={k} v={v} />)}
      <Dash m={d.sp} />
      <Grid template="minmax(0,1fr) auto auto auto" gap={10}>
        {(['Item', 'Qty', 'Rate', 'Amount'] as const).map((h, i) => (
          <div key={h} style={{ fontWeight: 800, padding: '2px 0', textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right' }}>{h}</div>
        ))}
        <div style={{ gridColumn: '1 / -1', borderTop: `1px dashed ${INK}`, marginBottom: 2 }} />
        {d.lines.map((l, i) => (
          <React.Fragment key={i}>
            <div style={{ padding: `${1 + d.isp / 2}px 0`, minWidth: 0, wordBreak: 'break-word' }}>
              {l.name}{l.variant ? ` (${l.variant})` : ''}
              {l.note && <Note d={d} text={l.note} indent={8} />}
            </div>
            <div style={{ padding: `${1 + d.isp / 2}px 0`, textAlign: 'center', whiteSpace: 'nowrap' }}>{l.qty}</div>
            <div style={{ padding: `${1 + d.isp / 2}px 0`, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.rate}</div>
            <div style={{ padding: `${1 + d.isp / 2}px 0`, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.amount}</div>
          </React.Fragment>
        ))}
      </Grid>
      <Dash m={d.sp} />
      {d.adjust.map(([k, v]) => <KV key={k} k={k} v={v} />)}
      <Dash m={d.sp} />
      <div className="grand-total"><KV k="TOTAL" v={d.grand} size={base + d.bump(5)} kBold vBold nowrap /></div>
      <Dash m={d.sp} />
      {d.payRows.map(([k, v]) => <KV key={k} k={k} v={v} />)}
      {d.payRows.length > 0 && <Dash m={d.sp} />}
      <Footer d={d} />
    </>
  );
}

function modern(d: Data) {
  const { base } = d;
  return (
    <>
      <div style={{ textAlign: 'center' }}>
        {d.logo}
        {d.name && <ReverseBar size={base + d.bump(6)} space={0} radius={9} pad="4px 8px">{d.name}</ReverseBar>}
        <div style={{ marginTop: 4 }}>
          {d.address && <div>{d.address}</div>}
          {d.phones && <div>{d.phones}</div>}
          {d.note && <div>{d.note}</div>}
        </div>
      </div>
      <Solid w={3} m={d.sp} />
      {d.meta.map(([k, v]) => <KV key={k + v} k={k} v={v} vBold />)}
      <Solid w={3} m={d.sp} />
      {d.lines.map((l, i) => (
        <div key={i} className="item-row" style={{ borderBottom: `1px solid ${INK}`, padding: `${2 + d.isp}px 0` }}>
          <div style={{ fontWeight: 800, fontSize: base + 1 }}>{l.name}{l.variant ? <span style={{ fontWeight: 400 }}> ({l.variant})</span> : null}</div>
          <KV k={<>{l.qty} × {l.rate}</>} v={l.amount} vBold />
          {l.note && <Note d={d} text={l.note} />}
        </div>
      ))}
      <div style={{ marginTop: d.sp }}>{d.adjust.map(([k, v]) => <KV key={k} k={k} v={v} />)}</div>
      <div className="grand-total" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        border: `3px solid ${INK}`, borderRadius: 12, padding: '5px 10px', margin: `${d.sp + 2}px 0`,
      }}>
        <span style={{ fontWeight: 800, fontSize: base + 1 }}>TOTAL</span>
        <span style={{ fontWeight: 900, fontSize: base + d.bump(7), whiteSpace: 'nowrap' }}>{d.grand}</span>
      </div>
      {d.payRows.map(([k, v]) => <KV key={k} k={k} v={v} vBold />)}
      <Footer d={d} />
    </>
  );
}

function minimal(d: Data) {
  const { base } = d;
  return (
    <>
      <ShopHeader d={d} nameSize={base + d.bump(5)} />
      <div style={{ marginTop: d.sp + 4 }}>
        {d.meta.map(([k, v]) => <div key={k + v}>{k}: {v}</div>)}
      </div>
      <div style={{ marginTop: d.sp + 6 }}>
        {d.lines.map((l, i) => (
          <div key={i} className="item-row" style={{ marginBottom: 6 + d.isp }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: base + 1 }}>
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{l.name}{l.variant ? ` (${l.variant})` : ''}</span>
              <span className="premium-num">{l.amount}</span>
            </div>
            <div style={{ fontSize: base - 1 }}>{l.weighed ? `${l.qty} kg` : l.qty} @ {l.rate}</div>
            {l.note && <Note d={d} text={l.note} />}
          </div>
        ))}
      </div>
      <div style={{ marginTop: d.sp }}>{d.adjust.map(([k, v]) => <KV key={k} k={k} v={v} />)}</div>
      <div className="grand-total" style={{ marginTop: 4 }}><KV k="Total" v={d.grand} size={base + d.bump(7)} kBold vBold nowrap /></div>
      <div style={{ marginTop: 4 }}>{d.payRows.map(([k, v]) => <KV key={k} k={k} v={v} />)}</div>
      <Footer d={d} align="left" />
    </>
  );
}

function restaurant(d: Data) {
  const { base } = d;
  const hasHero = !!(d.typeText || d.tableText || d.tokenText);
  return (
    <>
      <ShopHeader d={d} />
      <Double m={d.sp} />
      {hasHero && (
        <div style={{ border: `3px solid ${INK}`, textAlign: 'center', padding: '5px 4px', margin: `${d.sp}px 0` }}>
          {d.c.showOrderType && <div style={{ fontWeight: 800, fontSize: base + d.bump(5) }}>{d.typeText.toUpperCase()}</div>}
          {d.c.showTable && d.tableText && <div style={{ fontWeight: 800, fontSize: base + d.bump(3) }}>{d.tableText}</div>}
          {d.c.showOrderNumber && d.tokenText && (
            <div style={{ fontSize: base + 2 }}>Token <span style={{ fontSize: base + d.bump(10), fontWeight: 900 }}>#{d.tokenText}</span></div>
          )}
        </div>
      )}
      {d.meta.filter(([k]) => !['Type', 'Table', 'Token'].includes(k)).map(([k, v]) => <KV key={k + v} k={k} v={v} />)}
      <Double m={d.sp} />
      {d.lines.map((l, i) => (
        <div key={i} className="item-row" style={{ display: 'flex', gap: 8, padding: `${1 + d.isp / 2}px 0` }}>
          <span style={{ width: '2.4em', flex: 'none', fontWeight: 800 }}>{l.qty}x</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: base + 1 }}>
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{l.name}{l.variant ? ` (${l.variant})` : ''}</span>
              <span className="premium-num">{l.amount}</span>
            </span>
            {l.note && <Note d={d} text={l.note} indent={8} />}
          </span>
        </div>
      ))}
      <Solid m={d.sp} />
      {d.adjust.map(([k, v]) => <KV key={k} k={k} v={v} />)}
      <Double m={d.sp} />
      <div className="grand-total"><KV k="GRAND TOTAL" v={d.grand} size={base + d.bump(5)} kBold vBold nowrap /></div>
      <Double m={d.sp} />
      {d.payRows.map(([k, v]) => <KV key={k} k={k} v={v} />)}
      {d.payRows.length > 0 && <Solid m={d.sp} />}
      <Footer d={d} />
    </>
  );
}

function retailInvoice(d: Data) {
  const { base } = d;
  return (
    <>
      <ShopHeader d={d} />
      <div style={{ marginTop: d.sp + 2 }}><ReverseBar size={base + 2} space={1} pad="5px 6px">SALES INVOICE</ReverseBar></div>
      <MetaGrid d={d} rows={d.meta} />
      <ItemGrid d={d} cols={['sr', 'name', 'qty', 'rate', 'amount']} />
      <CountLine d={d} />
      <TotalsGrid d={d} rows={d.adjust} net={['NET PAYABLE', d.grand]} after={d.payRows} />
      <div style={{ textAlign: 'center', marginTop: d.sp + 2 }}>
        {d.saved > 0 && <div style={{ fontWeight: 800, fontSize: base + 1, marginBottom: 4 }}>You saved {d.savedText} today!</div>}
      </div>
      <Footer d={d} />
    </>
  );
}

function compact(d: Data) {
  const { base } = d;
  const meta1 = [d.c.showOrderNumber ? d.orderText : '', d.c.showDateTime ? dateTime(new Date(d.order.createdAt || Date.now())) : ''].filter(Boolean).join(' | ');
  const meta2 = [
    d.c.showOrderType ? d.typeText : '',
    d.c.showTable ? d.tableText : '',
    d.c.showOrderNumber && d.tokenText ? `Tkn ${d.tokenText}` : '',
    d.c.showCashier ? d.order.cashierName || '' : '',
  ].filter(Boolean).join(' | ');
  const meta3 = [d.customerName, d.c.showCustomer ? d.order.customer?.phone || '' : ''].filter(Boolean).join(' ');
  return (
    <div style={{ lineHeight: 1.22 }}>
      <div style={{ textAlign: 'center' }}>
        {d.logo}
        {d.name && <div style={{ fontSize: base + 5, fontWeight: 800, lineHeight: 1.1 }}>{d.name}</div>}
        {d.phones && <div>{d.phones}</div>}
        {d.note && <div>{d.note}</div>}
      </div>
      <Dash m={3} />
      {meta1 && <div>{meta1}</div>}
      {meta2 && <div>{meta2}</div>}
      {meta3 && <div>{meta3}</div>}
      <Dash m={3} />
      <Grid template="minmax(0,1fr) auto auto" gap={8}>
        {d.lines.map((l, i) => (
          <React.Fragment key={i}>
            <div style={{ minWidth: 0, wordBreak: 'break-word', padding: `${d.isp / 2}px 0` }}>
              {l.name}{l.variant ? ` (${l.variant})` : ''}{l.note ? <i style={{ fontWeight: 400 }}> ({l.note})</i> : null}
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: `${d.isp / 2}px 0` }}>{l.qty}</div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap', padding: `${d.isp / 2}px 0` }}>{l.amount}</div>
          </React.Fragment>
        ))}
      </Grid>
      <Dash m={3} />
      {d.adjust.map(([k, v]) => <KV key={k} k={k} v={v} />)}
      <div className="grand-total"><KV k="TOTAL" v={d.grand} size={base + 5} kBold vBold /></div>
      {d.payRows.map(([k, v]) => <KV key={k} k={k} v={v} />)}
      <Dash m={3} />
      <Footer d={d} />
    </div>
  );
}

function boxedGrid(d: Data) {
  const { base } = d;
  return (
    <>
      <div style={{ border: `3px solid ${INK}` }}>
        <div style={{ padding: '4px 4px 6px' }}><ShopHeader d={d} /></div>
        <div style={{ borderTop: `3px solid ${INK}`, textAlign: 'center', fontWeight: 800, letterSpacing: d.narrow ? 0.5 : 2, fontSize: base + 1, padding: '4px 0' }}>CASH MEMO / RECEIPT</div>
      </div>
      <MetaGrid d={d} rows={d.meta} labelW="36%" />
      <ItemGrid d={d} cols={['name', 'qty', 'rate', 'amount']} blackHead boldCells nameLabel="Item" />
      <CountLine d={d} qtyLabel="Qty" />
      <TotalsGrid d={d} rows={d.adjust} net={['GRAND TOTAL', d.grand]} after={d.payRows} boldLabels boldAfter netBlack />
      <div style={{ border: `3px solid ${INK}`, marginTop: d.sp + 2, padding: '4px 2px' }}>
        <Footer d={{ ...d, sp: 0 }} />
      </div>
    </>
  );
}

function boldRestaurant(d: Data) {
  const { base } = d;
  const cell = (extra: React.CSSProperties = {}): React.CSSProperties => ({ textAlign: 'center', padding: '4px 2px', ...extra });
  const tag: React.CSSProperties = { fontSize: base - 2, letterSpacing: 0.5 };
  return (
    <>
      <ShopHeader d={d} />
      <div style={{ display: 'flex', flexDirection: d.narrow ? 'column' : 'row', border: `3px solid ${INK}`, margin: `${d.sp + 2}px 0` }}>
        {d.c.showOrderType && (
          <div style={cell({ flex: 1.15 })}><div style={tag}>TYPE</div><div style={{ fontWeight: 800, fontSize: base + d.bump(6) }}>{d.typeText.toUpperCase()}</div></div>
        )}
        {d.c.showTable && d.tableText && (
          <div style={cell({ flex: 1, ...(d.narrow ? { borderTop: `3px solid ${INK}` } : { borderLeft: `3px solid ${INK}` }) })}><div style={tag}>TABLE</div><div style={{ fontWeight: 800, fontSize: base + d.bump(6) }}>{d.tableText}</div></div>
        )}
        {d.c.showOrderNumber && d.tokenText && (
          <div style={cell({ flex: 0.9, ...(d.narrow ? { borderTop: `3px solid ${INK}` } : { borderLeft: `3px solid ${INK}` }) })}><div style={tag}>TOKEN</div><div style={{ fontWeight: 900, fontSize: base + d.bump(9) }}>#{d.tokenText}</div></div>
        )}
      </div>
      {d.meta.filter(([k]) => !['Type', 'Table', 'Token'].includes(k)).map(([k, v]) => <KV key={k + v} k={k} v={v} vBold />)}
      <div style={{ marginTop: d.sp + 2 }}>
        {d.lines.map((l, i) => (
          <div key={i} className="item-row" style={{
            display: 'flex', gap: 8, padding: `${3 + d.isp}px 0`,
            borderBottom: i < d.lines.length - 1 ? `1px solid ${INK}` : undefined,
          }}>
            <span style={{ width: '2.4em', flex: 'none', fontWeight: 900, fontSize: base + 3 }}>{l.qty}×</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 800, fontSize: base + 2 }}>
                <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{l.name}{l.variant ? ` (${l.variant})` : ''}</span>
                <span className="premium-num">{l.amount}</span>
              </span>
              {l.note && <Note d={d} text={l.note} indent={6} />}
              {l.qtyNum > 1 && !l.weighed && <div style={{ fontSize: base + 1 }}>@ {l.rate}</div>}
            </span>
          </div>
        ))}
      </div>
      <Solid m={d.sp} />
      {d.adjust.map(([k, v]) => <KV key={k} k={k} v={v} vBold />)}
      <div className="grand-total dt-reverse" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: INK, color: '#fff',
        padding: '8px 8px', margin: `${d.sp + 2}px 0`, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
      }}>
        <span style={{ fontWeight: 800, fontSize: base + 1 }}>TOTAL</span>
        <span style={{ fontWeight: 900, fontSize: base + d.bump(7), whiteSpace: 'nowrap' }}>{d.grand}</span>
      </div>
      {d.payRows.map(([k, v]) => <KV key={k} k={k} v={v} kBold vBold />)}
      <Solid w={4} m={d.sp + 2} />
      <Footer d={d} />
    </>
  );
}

function taxInvoice(d: Data) {
  const { base } = d;
  const gross = d.order.subtotal;
  const net = Math.max(0, (Number(gross) || 0) - (Number(d.order.discount) || 0));
  const rows: Array<[string, string]> = [];
  if (d.c.showSubtotal) rows.push(['Gross Amount', d.num(gross)]);
  if (d.c.showDiscount && d.order.discount) rows.push([discountLineTitle(d.order), `-${d.num(d.order.discount)}`]);
  if (d.c.showSubtotal) rows.push(['Value excl. tax', d.num(net)]);
  d.adjust.filter(([k]) => k !== 'Subtotal' && !(d.c.showDiscount && k === discountLineTitle(d.order) && d.order.discount)).forEach(r => rows.push(r));
  return (
    <>
      <ShopHeader d={d} noteBold noteLead="NTN / STRN: " />
      <div style={{ border: `3px solid ${INK}`, textAlign: 'center', fontWeight: 800, letterSpacing: d.narrow ? 0.5 : 1, fontSize: base + 2, padding: '4px 0', marginTop: d.sp + 2 }}>INVOICE</div>
      <MetaGrid d={d} rows={d.meta} labelW="34%" />
      <ItemGrid d={d} cols={['sr', 'name', 'qty', 'rate', 'amount']} blackHead srLabel="Sr" />
      <CountLine d={d} />
      <TotalsGrid d={d} rows={rows} net={['NET PAYABLE', d.grand]} after={d.payRows} />
      <div style={{ textAlign: 'center', fontWeight: 800, marginTop: d.sp + 2 }}>{d.words}</div>
      <Footer d={d} />
    </>
  );
}

const Diamond: React.FC<{ m?: number }> = ({ m = 6 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: `${m}px 0` }}>
    <span style={{ flex: 1, borderTop: `1px solid ${INK}` }} />
    <span style={{ width: 9, height: 9, background: INK, transform: 'rotate(45deg)', flex: 'none' }} />
    <span style={{ flex: 1, borderTop: `1px solid ${INK}` }} />
  </div>
);

const Leader: React.FC<{ k: React.ReactNode; v: React.ReactNode; caps?: boolean; size?: number; bold?: boolean; wrapValue?: boolean }> = ({ k, v, caps, size, bold, wrapValue }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: size, fontWeight: bold ? 800 : undefined }}>
    <span style={{ fontVariant: caps ? 'small-caps' : undefined, letterSpacing: caps ? 0.4 : undefined, flex: wrapValue ? 'none' : '0 1 auto', minWidth: 0, wordBreak: 'break-word' }}>{k}</span>
    <span style={{ flex: 1, minWidth: 6, borderBottom: `1px dotted ${INK}`, alignSelf: 'flex-end', marginBottom: 4 }} />
    {/* An amount never wraps; a long text value (a date) may. */}
    <span style={wrapValue ? { textAlign: 'right', minWidth: 0, wordBreak: 'break-word' } : { textAlign: 'right', flex: 'none', whiteSpace: 'nowrap' }}>{v}</span>
  </div>
);

function luxury(d: Data) {
  const { base } = d;
  return (
    <div style={{ border: `4px double ${INK}`, padding: '8px 10px' }}>
      <div style={{ textAlign: 'center' }}>
        {d.logo}
        {d.name && <div style={{ fontSize: base + d.bump(7), letterSpacing: d.narrow ? 1 : 2, lineHeight: 1.15 }}>{d.name}</div>}
        {d.address && <div>{d.address}</div>}
        {d.phones && <div>{d.phones}</div>}
        {d.note && <div>{d.note}</div>}
      </div>
      <Diamond m={d.sp + 3} />
      <div style={{ textAlign: 'center', letterSpacing: d.narrow ? 3 : 7, fontSize: base }}>I N V O I C E</div>
      <Diamond m={d.sp + 3} />
      {d.meta.map(([k, v]) => <Leader key={k + v} caps wrapValue k={k} v={v} />)}
      <Diamond m={d.sp + 3} />
      {d.lines.map((l, i) => (
        <div key={i} className="item-row" style={{ marginBottom: 1 + d.isp / 2 }}>
          <Leader k={<>{l.qty} × {l.name}{l.variant ? ` (${l.variant})` : ''}</>} v={l.amount} size={base + 1} />
          {l.note && <Note d={d} text={l.note} indent={8} lead="- " />}
        </div>
      ))}
      <Diamond m={d.sp + 3} />
      {d.adjust.map(([k, v]) => <Leader key={k} k={k} v={v} />)}
      <div style={{ borderTop: `1px solid ${INK}`, borderBottom: `1px solid ${INK}`, padding: '4px 0', margin: `${d.sp + 2}px 0` }} className="grand-total">
        <Leader caps bold k="TOTAL" v={<span style={{ fontWeight: 800, fontSize: base + d.bump(7), whiteSpace: 'nowrap' }}>{d.grand}</span>} />
      </div>
      {d.payRows.map(([k, v]) => <Leader key={k} k={k} v={v} />)}
      <Diamond m={d.sp + 3} />
      <Footer d={{ ...d, sp: 0 }} italic />
    </div>
  );
}

const ZigZag: React.FC<{ up?: boolean }> = ({ up }) => {
  const teeth = 18;
  const pts: string[] = [];
  const w = 100 / teeth;
  for (let i = 0; i < teeth; i++) {
    const x0 = i * w;
    pts.push(up ? `${x0},12 ${x0 + w / 2},0 ${x0 + w},12` : `${x0},0 ${x0 + w / 2},12 ${x0 + w},0`);
  }
  return (
    <svg width="100%" height="12" viewBox="0 0 100 12" preserveAspectRatio="none" style={{ display: 'block' }} aria-hidden>
      {pts.map((p, i) => <polygon key={i} points={p} fill={INK} />)}
    </svg>
  );
};

function ticket(d: Data) {
  const { base } = d;
  const showStub = d.c.showOrderNumber && (d.orderText || d.tokenText);
  return (
    <div>
      <ZigZag up />
      <div style={{ borderLeft: `3px solid ${INK}`, borderRight: `3px solid ${INK}`, padding: '4px 10px 2px' }}>
        <ShopHeader d={d} />
        {showStub && (
          <div style={{ display: 'flex', flexDirection: d.narrow ? 'column' : 'row', border: `3px dashed ${INK}`, margin: `${d.sp + 2}px 0`, textAlign: 'center' }}>
            <div style={{ flex: 1.7, padding: '4px 2px' }}>
              <div style={{ fontSize: base - 2 }}>ORDER</div>
              <div style={{ fontWeight: 900, fontSize: base + d.bump(8), whiteSpace: 'nowrap' }}>{d.orderText}</div>
            </div>
            <div style={{ flex: 1, padding: '4px 2px', ...(d.narrow ? { borderTop: `3px dashed ${INK}` } : { borderLeft: `3px dashed ${INK}` }) }}>
              <div style={{ fontSize: base - 2 }}>TOKEN</div>
              <div style={{ fontWeight: 900, fontSize: base + d.bump(13) }}>{d.tokenText}</div>
            </div>
          </div>
        )}
        {d.meta.filter(([k]) => k !== 'Order #').map(([k, v]) => <KV key={k + v} k={k} v={v} />)}
        <Dash w={3} m={d.sp + 2} />
        {d.lines.map((l, i) => (
          <div key={i} className="item-row" style={{ display: 'flex', gap: 8, padding: `${2 + d.isp / 2}px 0` }}>
            <span style={{ width: '1.6em', flex: 'none', fontWeight: 800 }}>{l.qty}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: base + 1 }}>
                <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{l.name}{l.variant ? ` (${l.variant})` : ''}</span>
                <span className="premium-num">{l.amount}</span>
              </span>
              {l.note && <Note d={d} text={l.note} indent={8} />}
            </span>
          </div>
        ))}
        <Dash w={3} m={d.sp + 2} />
        {d.adjust.map(([k, v]) => <KV key={k} k={k} v={v} />)}
        <div className="grand-total"><KV k="TOTAL" v={d.grand} size={base + d.bump(7)} kBold vBold nowrap /></div>
        {d.payRows.map(([k, v]) => <KV key={k} k={k} v={v} />)}
        {d.isPaid && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: `${d.sp + 6}px 0 ${d.sp}px` }}>
            <div style={{
              border: `4px solid ${INK}`, borderRadius: 10, padding: '1px 22px', transform: 'rotate(-3deg)',
              fontWeight: 900, fontStyle: 'italic', letterSpacing: d.narrow ? 3 : 5, fontSize: base + d.bump(8),
            }}>PAID</div>
          </div>
        )}
        <Dash w={3} m={d.sp + 2} />
        <Footer d={{ ...d, sp: 0 }} />
      </div>
      <ZigZag />
    </div>
  );
}

const DESIGNS: Record<DtrDesign, (d: Data) => React.ReactNode> = {
  classic,
  modern,
  minimal,
  restaurant,
  'retail-invoice': retailInvoice,
  compact,
  'boxed-grid': boxedGrid,
  'bold-restaurant': boldRestaurant,
  'tax-invoice': taxInvoice,
  luxury,
  ticket,
};

// Arial first: the guide's receipts are Arial, and Windows always has it.
const DTR_SANS = "Arial, 'Segoe UI', Helvetica, sans-serif";
const DTR_SERIF = "'Times New Roman', Georgia, Times, serif";

export default function DtRetailReceipt({ order, settings, templateId, design, customization: c }: Props) {
  const template = getPremiumTemplate(templateId);
  const s = settings as any;
  const qrOn = !!template?.layout.qr && c.showQr && s.receiptShowQr !== false;
  const d = prepare(order, settings, c, qrOn);
  const font = design === 'luxury' && c.fontFamily === 'serif'
    ? DTR_SERIF
    : c.fontFamily === 'sans' ? DTR_SANS : FONT_STACKS[c.fontFamily];

  return (
    <div
      className="premium-receipt receipt-root"
      data-template={templateId}
      data-dtr={design}
      style={{
        fontFamily: font,
        fontSize: `${c.fontSize}px`,
        lineHeight: 1.35,
        fontWeight: c.boldBody ? 700 : 400,
        color: INK,
        background: '#fff',
        paddingTop: c.topSpacing ? `${c.topSpacing}px` : undefined,
        paddingBottom: c.bottomSpacing ? `${c.bottomSpacing}px` : undefined,
      }}
    >
      {/* Travels with the slip's outerHTML into the hidden print worker, so
          the printed table sizes its columns exactly as the preview does. */}
      <style dangerouslySetInnerHTML={{ __html: ITEM_TABLE_CSS }} />
      {DESIGNS[design](d)}
    </div>
  );
}
