// ============================================================
// Standard Customer Receipt — 80mm Thermal, Compact + Professional
// Per spec: Logo (controlled) → Name → Address → Phone →
//          "CUSTOMER RECEIPT" → Date/Time/Order#/Type compact grid →
//          Items table (Item | Qty | Rate | Amt — headers never wrap) →
//          Totals (Subtotal, [Discount?], [Tax?], Total, Status, [Cash/Change]) →
//          Footer (thankYou + dynamic) → Powered by Digital Target POS
//
// All show/hide controlled by settings toggles:
//   receiptShowLogo, receiptShowAddress, receiptShowPhone,
//   receiptShowDiscount, receiptShowTax, receiptShowFooter,
//   receiptShowPoweredBy, receiptCompactMode
// ============================================================
import type { CSSProperties } from 'react';
import { serviceChargeLabel } from '@/lib/serviceCharge';
import { discountLineTitle } from '@/lib/billLabels';
import type { Order, RestaurantSettings } from '@/lib/types';
import { applyReceiptTemplate } from '@/lib/receiptTemplates';
import { ReceiptCodesSlot } from '@/components/ReceiptCodes';

const mono = "'Lucida Console','Consolas','Courier New',monospace";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Order details as plain lines, the way the screen shows them. They used to
// be a four-cell table, and the print stylesheet gives every table cell
// padding and a border: at 80mm the cells could not hold "24 Sep 2026" and
// "10:49 am", so the date ran into the Time label and the time off the paper.
// Labels are padded to one width (monospace), each "label : value" group
// stays whole, and on a narrow roll the right-hand group takes its own line.
const INFO_LABEL: CSSProperties = { display: 'inline-block', minWidth: '9ch' };
function infoPair(a: [string, string], b: [string, string]) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '8px', padding: '1px 0' }}>
      <span style={{ whiteSpace: 'nowrap' }}><span style={INFO_LABEL}>{a[0]}</span>: {a[1]}</span>
      <span style={{ whiteSpace: 'nowrap', marginLeft: 'auto' }}>{b[0]} : {b[1]}</span>
    </div>
  );
}
function infoLine(label: string, value: string) {
  return (
    <div style={{ display: 'flex', padding: '1px 0' }}>
      <span style={{ ...INFO_LABEL, flexShrink: 0 }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: 'break-word' }}>: {value}</span>
    </div>
  );
}

function fmt(n: number) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function orderTypeLabel(o: Order): string {
  const t = (o.orderType || '').toLowerCase();
  if (t === 'delivery') return 'Delivery';
  if (t === 'takeaway') return 'Takeaway';
  return 'Dine-In';
}

interface Props { order: Order; settings: RestaurantSettings }

export default function StandardReceipt({ order, settings: rawSettings }: Props) {
  // Chosen ready-made template (Standard / Compact / Detailed) is merged on
  // top of the shop's own settings — amounts never change, only the look.
  const settings = applyReceiptTemplate(rawSettings as any) as RestaurantSettings;
  const s = settings as any;
  const showLogo     = s.receiptShowLogo     !== false && !!settings.logo;
  const showAddress  = s.receiptShowAddress  !== false && !!settings.address;
  const showPhone    = s.receiptShowPhone    !== false && (!!settings.phone1 || !!settings.phone2);
  const showDiscount = (s.receiptShowDiscount !== false) && (order.discount > 0);
  const showTax      = (s.receiptShowTax !== false) && (order.tax || 0) > 0;
  const showFooter   = s.receiptShowFooter   !== false;
  const showPowered  = s.receiptShowPoweredBy !== false;
  const compact      = !!s.receiptCompactMode;

  const logoW = Math.min(70, settings.logoWidth || 60);
  const logoH = Math.min(70, settings.logoHeight || 60);

  const pad   = compact ? 1 : 2;
  const rowPad= compact ? '1px 2px' : '2px 3px';
  const fsBody= compact ? 10 : 11;
  const fsItem= compact ? 10 : 11;
  const fsHead= compact ? 10 : 11;
  const fsTitle = compact ? 13 : 14;

  const isCash = !order.paymentMethod || order.paymentMethod === 'cash';
  const hasCash = !!(order.cashReceived && order.cashReceived > 0);
  const change = Math.max(0, (order.cashReceived || 0) - order.grandTotal);
  const paid = order.status === 'paid' && order.paymentMethod !== 'credit';
  // A fixed three-letter month: newer Chromium/ICU writes "Sept", which made
  // the Date/Time line 6px wider than an 80mm slip.
  const created = new Date(order.createdAt);
  const dateStr = `${String(created.getDate()).padStart(2, '0')} ${MONTHS[created.getMonth()] || ''} ${created.getFullYear()}`;
  const timeStr = new Date(order.createdAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
  const supportNo = (s.supportPhone || '0345-1873354') as string;

  return (
    <div style={{ fontFamily: mono, color: '#000', fontSize: `${fsBody}px`, lineHeight: 1.25 }}>
      {/* HEADER — Logo, Name, Address, Phone */}
      <div style={{ textAlign: 'center', padding: `${pad}px 0` }}>
        {showLogo && (
          <img
            src={settings.logo}
            alt="Logo"
            style={{ width: `${logoW}px`, height: `${logoH}px`, objectFit: 'contain', margin: '0 auto 2px' }}
          />
        )}
        <div style={{ fontSize: `${compact ? 14 : 16}px`, fontWeight: 900, letterSpacing: '1px', textTransform: 'uppercase', lineHeight: 1.15 }}>
          {settings.name}
        </div>
        {showAddress && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 700, marginTop: '2px', lineHeight: 1.25 }}>{settings.address}</div>
        )}
        {showPhone && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 700, marginTop: '1px' }}>
            {settings.phone1}{settings.phone2 ? ` | ${settings.phone2}` : ''}
          </div>
        )}
      </div>

      {/* CUSTOMER RECEIPT TITLE */}
      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', textAlign: 'center', padding: `${pad}px 0`, margin: '3px 0' }}>
        <span style={{ fontSize: `${fsTitle}px`, fontWeight: 900, letterSpacing: '2px' }}>CUSTOMER RECEIPT</span>
      </div>

      {/* ORDER DETAILS — Date / Time / Order # / Type (see infoPair) */}
      <div style={{ fontSize: `${fsBody}px`, fontWeight: 700 }}>
        {infoPair(['Date', dateStr], ['Time', timeStr])}
        {infoPair(['Order No', `#${order.orderNumber}`], ['Type', orderTypeLabel(order)])}
        {order.tableName && infoLine('Table', String(order.tableName))}
        {order.customer?.name && infoLine('Cust.', `${order.customer.name}${order.customer.phone ? ` · ${order.customer.phone}` : ''}`)}
      </div>

      {/* ITEMS TABLE */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px', fontSize: `${fsItem}px`, tableLayout: 'fixed' }}>
        <colgroup>
          <col />
          <col style={{ width: '26px' }} />
          <col style={{ width: '48px' }} />
          <col style={{ width: '56px' }} />
        </colgroup>
        <thead>
          <tr style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000' }}>
            <th style={{ padding: rowPad, textAlign: 'left',   fontWeight: 900, fontSize: `${fsHead}px`, whiteSpace: 'nowrap' }}>Item</th>
            <th style={{ padding: rowPad, textAlign: 'center', fontWeight: 900, fontSize: `${fsHead}px`, whiteSpace: 'nowrap' }}>Qty</th>
            <th style={{ padding: rowPad, textAlign: 'right',  fontWeight: 900, fontSize: `${fsHead}px`, whiteSpace: 'nowrap' }}>Rate</th>
            <th style={{ padding: rowPad, textAlign: 'right',  fontWeight: 900, fontSize: `${fsHead}px`, whiteSpace: 'nowrap' }}>Amt</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it, idx) => (
            <tr key={it.id || idx}>
              <td style={{ padding: rowPad, textAlign: 'left',  wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                {it.name}
                {it.note && <div style={{ fontSize: '9px', fontWeight: 600, color: '#333' }}>↳ {it.note}</div>}
              </td>
              <td style={{ padding: rowPad, textAlign: 'center', whiteSpace: 'nowrap' }}>{it.quantity}</td>
              <td style={{ padding: rowPad, textAlign: 'right',  whiteSpace: 'nowrap' }}>{fmt(it.price)}</td>
              <td style={{ padding: rowPad, textAlign: 'right',  whiteSpace: 'nowrap' }}>{fmt(it.price * it.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* TOTALS */}
      <div style={{ borderTop: '1px dashed #000', marginTop: '4px', paddingTop: '3px', fontSize: `${fsBody}px`, fontWeight: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Subtotal</span><span>Rs. {fmt(order.subtotal)}</span>
        </div>
        {showDiscount && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{discountLineTitle(order)}</span>
            <span>- Rs. {fmt(order.discount)}</span>
          </div>
        )}
        {showTax && (order.tax || 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tax</span><span>Rs. {fmt(order.tax)}</span>
          </div>
        )}
        {/* A charge that is in the total is always on the slip, whatever the tax switch says. */}
        {(order.serviceCharge || 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{serviceChargeLabel(order)}</span>
            <span>Rs. {fmt(order.serviceCharge)}</span>
          </div>
        )}
        {(order.deliveryChargeAmount || 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Delivery</span><span>Rs. {fmt(order.deliveryChargeAmount || 0)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '3px 0', margin: '3px 0', fontSize: `${compact ? 12 : 14}px`, fontWeight: 900 }}>
          <span>TOTAL</span><span>Rs. {fmt(order.grandTotal)}</span>
        </div>

        {/* Paid / Unpaid status */}
        {/* Unpaid prints reversed; .dt-reverse keeps the print stylesheet
            from repainting the white text black on the black fill. */}
        <div className={paid ? undefined : 'dt-reverse'} style={{ textAlign: 'center', padding: '3px 0', fontWeight: 900, letterSpacing: '2px', fontSize: `${compact ? 11 : 12}px`, background: paid ? '#fff' : '#000', color: paid ? '#000' : '#fff', border: paid ? '1px solid #000' : '1px solid #000' }}>
          {paid ? '★ PAID ★' : '⚠ UNPAID ⚠'}
        </div>

        {/* Cash / Change only when cash + received */}
        {isCash && hasCash && (
          <div style={{ marginTop: '3px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Cash Received</span><span>Rs. {fmt(order.cashReceived!)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Change Returned</span><span>Rs. {fmt(change)}</span>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      {showFooter && (
        <div style={{ textAlign: 'center', borderTop: '1px dashed #000', marginTop: '4px', paddingTop: '4px', fontSize: `${fsBody}px`, fontWeight: 800 }}>
          <div>{settings.thankYouText || 'Thank You!'}</div>
          {settings.visitAgainText && <div style={{ fontWeight: 700, marginTop: '1px' }}>{settings.visitAgainText}</div>}
          {settings.receiptFooter && (
            <div style={{ fontWeight: 700, marginTop: '2px', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{settings.receiptFooter}</div>
          )}
        </div>
      )}

      {/* Settings → Receipt → QR & Barcode, "Footer" position */}
      <ReceiptCodesSlot position="footer" />

      {/* POWERED BY DIGITAL TARGET */}
      {showPowered && (
        <div style={{ textAlign: 'center', marginTop: '4px', paddingTop: '3px', borderTop: '1px dotted #000', fontSize: '9px', fontWeight: 700, color: '#000' }}>
          Powered by Digital Target POS | {supportNo}
        </div>
      )}
    </div>
  );
}
