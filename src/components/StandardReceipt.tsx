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
import type { Order, RestaurantSettings, Branch } from '@/lib/types';
import { money } from '@/lib/currency';
import { getBranches, getCurrentBranchId } from '@/lib/store';

/** Branch that produced this bill (falls back to the active branch). */
function branchOf(order: Order): Branch | undefined {
  const id = (order as any).branchId || getCurrentBranchId();
  if (!id) return undefined;
  return (getBranches() || []).find(b => b.id === id);
}


const mono = "'Lucida Console','Consolas','Courier New',monospace";

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

export default function StandardReceipt({ order, settings }: Props) {
  const s = settings as any;
  const branch = branchOf(order);
  // Branch overrides the restaurant-level address/phone when it has its own.
  const addressLine = branch?.address || settings.address;
  const phoneLine = branch?.phone || [settings.phone1, settings.phone2].filter(Boolean).join(' | ');
  const showLogo     = s.receiptShowLogo     !== false && !!settings.logo;
  const showAddress  = s.receiptShowAddress  !== false && !!addressLine;
  const showPhone    = s.receiptShowPhone    !== false && !!phoneLine;

  const showDiscount = (s.receiptShowDiscount !== false) && (order.discount > 0);
  const showTax      = (s.receiptShowTax !== false) && ((order.tax || 0) > 0 || (order.serviceCharge || 0) > 0);
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
  const dateStr = new Date(order.createdAt).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
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
        {!!branch?.name && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '1px' }}>
            {branch.name} BRANCH
          </div>
        )}
        {showAddress && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 700, marginTop: '2px', lineHeight: 1.25 }}>{addressLine}</div>
        )}
        {showPhone && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 700, marginTop: '1px' }}>
            {phoneLine}
          </div>
        )}
        {/* Optional identity lines — the label is printed only when a value exists. */}
        {!!branch?.registrationNumber && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 700 }}>Registration No: {branch.registrationNumber}</div>
        )}
        {!!branch?.taxNumber && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 700 }}>Tax No: {branch.taxNumber}</div>
        )}
        {!!branch?.email && (
          <div style={{ fontSize: `${fsBody}px`, fontWeight: 700 }}>{branch.email}</div>
        )}
      </div>


      {/* CUSTOMER RECEIPT TITLE */}
      <div style={{ borderTop: '1px dashed #000', borderBottom: '1px dashed #000', textAlign: 'center', padding: `${pad}px 0`, margin: '3px 0' }}>
        <span style={{ fontSize: `${fsTitle}px`, fontWeight: 900, letterSpacing: '2px' }}>CUSTOMER RECEIPT</span>
      </div>

      {/* INFO GRID — Date / Time / Order # / Type */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: `${fsBody}px`, fontWeight: 700 }}>
        <tbody>
          <tr>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap' }}>Date</td>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap' }}>: {dateStr}</td>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>Time</td>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>: {timeStr}</td>
          </tr>
          <tr>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap' }}>Order No</td>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap' }}>: {branch?.invoicePrefix || '#'}{order.orderNumber}</td>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>Type</td>
            <td style={{ padding: '1px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>: {orderTypeLabel(order)}</td>
          </tr>
          {order.tableName && (
            <tr>
              <td style={{ padding: '1px 0', whiteSpace: 'nowrap' }}>Table</td>
              <td colSpan={3} style={{ padding: '1px 0' }}>: {order.tableName}</td>
            </tr>
          )}
          {order.customer?.name && (
            <tr>
              <td style={{ padding: '1px 0', whiteSpace: 'nowrap' }}>Cust.</td>
              <td colSpan={3} style={{ padding: '1px 0' }}>: {order.customer.name}{order.customer.phone ? ` · ${order.customer.phone}` : ''}</td>
            </tr>
          )}
        </tbody>
      </table>

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
          <span>Subtotal</span><span>{money(fmt(order.subtotal))}</span>
        </div>
        {showDiscount && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Discount{order.discountTitle ? ` (${order.discountTitle})` : ''}</span>
            <span>- {money(fmt(order.discount))}</span>
          </div>
        )}
        {showTax && (order.tax || 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tax</span><span>{money(fmt(order.tax))}</span>
          </div>
        )}
        {showTax && (order.serviceCharge || 0) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Service Charge{order.serviceChargePercent ? ` (${order.serviceChargePercent}%)` : ''}</span>
            <span>{money(fmt(order.serviceCharge))}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '3px 0', margin: '3px 0', fontSize: `${compact ? 12 : 14}px`, fontWeight: 900 }}>
          <span>TOTAL</span><span>{money(fmt(order.grandTotal))}</span>
        </div>

        {/* Paid / Unpaid status */}
        <div style={{ textAlign: 'center', padding: '3px 0', fontWeight: 900, letterSpacing: '2px', fontSize: `${compact ? 11 : 12}px`, background: paid ? '#fff' : '#000', color: paid ? '#000' : '#fff', border: paid ? '1px solid #000' : '1px solid #000' }}>
          {paid ? '★ PAID ★' : '⚠ UNPAID ⚠'}
        </div>

        {/* Cash / Change only when cash + received */}
        {isCash && hasCash && (
          <div style={{ marginTop: '3px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Cash Received</span><span>{money(fmt(order.cashReceived!))}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Change Returned</span><span>{money(fmt(change))}</span>
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
          {!!branch?.invoiceFooter && (
            <div style={{ fontWeight: 700, marginTop: '2px', whiteSpace: 'pre-line', lineHeight: 1.3 }}>{branch.invoiceFooter}</div>
          )}
        </div>
      )}

      {/* POWERED BY DIGITAL TARGET */}
      {showPowered && (
        <div style={{ textAlign: 'center', marginTop: '4px', paddingTop: '3px', borderTop: '1px dotted #000', fontSize: '9px', fontWeight: 700, color: '#000' }}>
          Powered by Digital Target POS | {supportNo}
        </div>
      )}
    </div>
  );
}
