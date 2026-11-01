// ============================================================
// PREMIUM RECEIPT RENDERER
//
// One component draws every premium layout. The template decides
// PRESENTATION (header shape, how the item table is ruled, how the totals
// are framed); the live order and the shop's settings supply every word and
// number on the paper. Nothing about a restaurant is baked into a template,
// so the same saved template prints correctly for any shop or branch.
//
// Sizing is tuned for a 203 DPI 80mm head: the body sits at 13px (~8pt),
// headings step up from there, and nothing drops below 10px — smaller than
// that a thermal head renders grey mush rather than text.
// ============================================================
import React, { useMemo } from 'react';
import { serviceChargeLabel } from '@/lib/serviceCharge';
import { discountLineTitle, variantNote } from '@/lib/billLabels';
import { ReceiptCodesSlot } from '@/components/ReceiptCodes';
import DtRetailReceipt from '@/components/DtRetailReceipt';
import { FONT_STACKS, ITEM_TABLE_CSS } from '@/components/premiumShared';
import type { Order, RestaurantSettings, CartItem } from '@/lib/types';
import {
  getPremiumTemplate,
  loadCustomization,
  amountInWords,
  type ItemColumn,
  type PremiumCustomization,
  type PremiumTemplate,
  type PremiumTemplateId,
} from '@/lib/premiumReceiptTemplates';

interface Props {
  order: Order;
  settings: RestaurantSettings;
  templateId: PremiumTemplateId;
  /** Preview override — when omitted the saved customization is used. */
  customization?: PremiumCustomization;
}

/** Money, using the shop's own currency symbol and decimal preference. */
function useMoney(settings: RestaurantSettings) {
  const symbol = (settings as any).currencySymbol ?? 'Rs ';
  const decimals = (settings as any).receiptHideDecimals === true ? 0 : 2;
  return (value: unknown, withSymbol = true) => {
    const n = Number(value) || 0;
    const text = n.toLocaleString('en-PK', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return withSymbol ? `${symbol}${text}` : text;
  };
}

function orderTypeLabel(order: Order): string {
  return String(order.orderType || '').replace(/_/g, ' ').toUpperCase() || 'ORDER';
}

/** Quantity as the kitchen/customer should read it — weight lines show kg. */
function qtyLabel(item: CartItem): string {
  if (item.pricingType === 'weight' && item.weightGrams && item.weightGrams > 0) {
    return `${(item.weightGrams / 1000).toFixed(3)}`;
  }
  const q = Number(item.quantity);
  return Number.isFinite(q) && q > 0 ? String(q) : '1';
}

const COLUMN_LABEL: Record<ItemColumn, string> = {
  sr: '#',
  name: 'Item',
  variant: 'Var.',
  qty: 'Qty',
  rate: 'Rate',
  amount: 'Amount',
};

/** Columns whose value is a number and must stay on one line. */
const NUMERIC_COLUMNS = new Set<ItemColumn>(['sr', 'qty', 'rate', 'amount']);

const COLUMN_ALIGN: Record<ItemColumn, 'left' | 'right' | 'center'> = {
  sr: 'center',
  name: 'left',
  variant: 'left',
  qty: 'center',
  rate: 'right',
  amount: 'right',
};

export default function PremiumReceipt({ order, settings, templateId, customization }: Props) {
  const template = getPremiumTemplate(templateId);
  const c = useMemo(
    () => customization ?? loadCustomization(templateId),
    [customization, templateId],
  );
  const money = useMoney(settings);

  // An unknown template id must never produce a blank slip — the print
  // pipeline treats an empty portal as a failure and refuses to print.
  if (!template) return null;

  // The DT Retail designs have their own renderer; everything else about the
  // slip (customization, order data, print pipeline) is shared.
  if (template.dtr) {
    return <DtRetailReceipt order={order} settings={settings} templateId={templateId} design={template.dtr} customization={c} />;
  }

  const L = template.layout;
  const s = settings as any;
  const base = c.fontSize;
  const font = FONT_STACKS[c.fontFamily];
  const created = new Date(order.createdAt || Date.now());
  const paidAt = order.paidAt ? new Date(order.paidAt) : null;
  const isPaid = !!order.paidAt || (order.amountPaid ?? 0) >= (order.grandTotal || 0);

  // ---- shared style fragments -------------------------------------------
  const rootStyle: React.CSSProperties = {
    fontFamily: font,
    fontSize: `${base}px`,
    lineHeight: 1.35,
    fontWeight: c.boldBody ? 700 : 400,
    color: '#000',
    background: '#fff',
    paddingTop: c.topSpacing ? `${c.topSpacing}px` : undefined,
    paddingBottom: c.bottomSpacing ? `${c.bottomSpacing}px` : undefined,
  };
  const section: React.CSSProperties = { marginTop: `${c.sectionSpacing}px` };
  const rule = (weight = 1, dashed = false): React.CSSProperties => ({
    borderTop: `${weight}px ${dashed ? 'dashed' : 'solid'} #000`,
    margin: `${Math.max(2, c.sectionSpacing / 2)}px 0`,
  });
  const radius = L.rounded ? 6 : 0;
  const cell: React.CSSProperties = {
    border: '1px solid #000',
    padding: `${1 + c.itemSpacing / 2}px 3px`,
    color: '#000',
    verticalAlign: 'top',
  };
  const bareCell: React.CSSProperties = {
    padding: `${1 + c.itemSpacing / 2}px 2px`,
    color: '#000',
    verticalAlign: 'top',
  };

  // ---- header ------------------------------------------------------------
  const logo = c.showLogo && s.logo
    ? <img src={s.logo} alt="" style={{ width: `${c.logoWidthPx}px`, maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
    : null;
  const shopName = c.showName && s.name
    ? <div style={{ fontSize: `${base + 7}px`, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.15 }}>{s.name}</div>
    : null;
  const shopLines = (
    <>
      {c.showAddress && s.address && <div style={{ fontSize: `${base - 1}px` }}>{s.address}</div>}
      {c.showPhone && (s.phone1 || s.phone2) && (
        <div style={{ fontSize: `${base - 1}px` }}>{[s.phone1, s.phone2].filter(Boolean).join(' · ')}</div>
      )}
      {c.headerNote && <div style={{ fontSize: `${base - 1}px` }}>{c.headerNote}</div>}
    </>
  );

  const renderHeader = () => {
    switch (L.header) {
      case 'logo-left':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {logo && <div style={{ flex: '0 0 auto', maxWidth: '38%' }}>{logo}</div>}
            <div style={{ flex: 1, textAlign: logo ? 'right' : 'center' }}>
              {shopName}
              {shopLines}
            </div>
          </div>
        );
      case 'banner':
        return (
          <div style={{ textAlign: 'center' }}>
            {logo && <div style={{ display: 'flex', justifyContent: 'center' }}>{logo}</div>}
            {c.showName && s.name && (
              <div className="dt-reverse" style={{
                background: '#000', color: '#fff', fontWeight: 900,
                fontSize: `${base + 6}px`, padding: '3px 0', margin: '2px 0',
                WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
              }}>{s.name}</div>
            )}
            {shopLines}
          </div>
        );
      case 'decorated':
        return (
          <div style={{ textAlign: 'center' }}>
            <div style={{ borderTop: '3px double #000', borderBottom: '1px solid #000', padding: '2px 0' }}>
              {logo && <div style={{ display: 'flex', justifyContent: 'center' }}>{logo}</div>}
              {shopName}
            </div>
            {shopLines}
          </div>
        );
      case 'stacked':
        return (
          <div style={{ textAlign: 'center' }}>
            {logo && <div style={{ display: 'flex', justifyContent: 'center' }}>{logo}</div>}
            {shopName}
            {shopLines}
          </div>
        );
      case 'centered':
      default:
        return (
          <div style={{ textAlign: 'center' }}>
            {logo && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}>{logo}</div>}
            {shopName}
            {shopLines}
          </div>
        );
    }
  };

  // The café pickup block prints the customer's name under the number the
  // counter calls out; the meta block then leaves it out.
  const pickup = L.hero === 'pickup' || L.hero === 'ticket';
  const pickupName = pickup && c.showOrderNumber && order.orderNumber != null && c.showCustomer
    ? String(order.customer?.name || '').trim()
    : '';

  // ---- meta rows ---------------------------------------------------------
  // Every entry is read from the live order. A row with no value is dropped
  // rather than printed empty, so short orders do not waste paper.
  const metaRows: Array<[string, string]> = [];
  if (c.showOrderNumber && order.orderNumber != null) metaRows.push(['Bill #', String(order.orderNumber)]);
  if (c.showOrderType) metaRows.push(['Type', orderTypeLabel(order)]);
  if (c.showDateTime) {
    metaRows.push(['Date', created.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })]);
    metaRows.push(['Time', created.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })]);
  }
  if (c.showTable && (order.tableName || order.tableLabel)) metaRows.push(['Table', String(order.tableName || order.tableLabel)]);
  if (c.showCashier && order.cashierName) metaRows.push(['Cashier', order.cashierName]);
  if (c.showCashier && order.waiterName) metaRows.push(['Waiter', order.waiterName]);
  if (c.showCustomer && order.customer?.name && !pickupName) metaRows.push(['Customer', order.customer.name]);
  if (c.showCustomer && order.customer?.phone) metaRows.push(['Phone', order.customer.phone]);
  if (c.showDelivery && order.orderType === 'delivery') {
    const addr = order.customer?.fullAddress || order.customer?.address;
    if (addr) metaRows.push(['Address', addr]);
    if (order.riderName) metaRows.push(['Rider', order.riderName]);
  }
  if (paidAt && c.showDateTime) {
    metaRows.push(['Paid', paidAt.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })]);
  }

  const renderMeta = () => {
    if (!metaRows.length) return null;
    const labelStyle: React.CSSProperties = { fontWeight: 700, whiteSpace: 'nowrap', paddingRight: 4 };
    if (L.meta === 'two-column' || L.meta === 'split') {
      // Pair the rows up: two label/value pairs per printed line. Long
      // values (an address) take a full line of their own so they never
      // collide with the column beside them.
      const out: React.ReactNode[] = [];
      for (let i = 0; i < metaRows.length; i += 2) {
        const a = metaRows[i];
        const b = metaRows[i + 1];
        // A 68mm slip in 13px mono holds about 34 characters. Pair two
        // label/value groups only when they genuinely fit; otherwise each
        // takes its own line. Forcing a pair is what split "Ahmed Khan"
        // across two lines and wrapped every phone number.
        const width = (r: [string, string]) => r[0].length + r[1].length + 2;
        const fits = !!b && width(a) + width(b) + 2 <= 34;
        if (!fits) {
          out.push(
            <div key={i} style={{ display: 'flex', gap: 4 }}>
              <span style={labelStyle}>{a[0]}:</span><span style={{ flex: 1 }}>{a[1]}</span>
            </div>,
          );
          if (b) {
            out.push(
              <div key={`${i}b`} style={{ display: 'flex', gap: 4 }}>
                <span style={labelStyle}>{b[0]}:</span><span style={{ flex: 1 }}>{b[1]}</span>
              </div>,
            );
          }
          continue;
        }
        out.push(
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0 }}><span style={labelStyle}>{a[0]}:</span>{a[1]}</span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'right' }}><span style={labelStyle}>{b[0]}:</span>{b[1]}</span>
          </div>,
        );
      }
      return <div style={section}>{out}</div>;
    }
    const rows = metaRows.map(([k, v]) => (
      <div key={k + v} style={{ display: 'flex', gap: 4 }}>
        <span style={labelStyle}>{k}:</span>
        <span style={{ flex: 1, wordBreak: 'break-word' }}>{v}</span>
      </div>
    ));
    if (L.meta === 'boxed') {
      return (
        <div style={{ ...section, border: '1px solid #000', borderRadius: radius, padding: '3px 4px' }}>{rows}</div>
      );
    }
    return <div style={section}>{rows}</div>;
  };

  // ---- hero number -------------------------------------------------------
  const renderHero = () => {
    if (L.hero === 'none') return null;
    if (pickup) {
      if (!c.showOrderNumber || order.orderNumber == null) return null;
      const ticket = L.hero === 'ticket';
      return (
        <div style={{
          ...section, textAlign: 'center', padding: '3px 4px',
          ...(ticket
            ? { borderTop: '2px dashed #000', borderBottom: '2px dashed #000' }
            : { border: '2px solid #000', borderRadius: radius }),
        }}>
          <div style={{ fontSize: `${base - 2}px`, fontWeight: 700, letterSpacing: 1 }}>ORDER NUMBER</div>
          <div style={{ fontSize: `${base + (ticket ? 26 : 18)}px`, fontWeight: 900, lineHeight: 1.05 }}>{order.orderNumber}</div>
          {pickupName && (
            <div style={{ fontSize: `${base + 3}px`, fontWeight: 800, lineHeight: 1.2, wordBreak: 'break-word' }}>{pickupName}</div>
          )}
        </div>
      );
    }
    let label = '';
    let value = '';
    if (L.hero === 'token' || L.hero === 'order') {
      if (!c.showOrderNumber || order.orderNumber == null) return null;
      label = L.hero === 'token' ? 'TOKEN #' : 'ORDER #';
      value = String(order.orderNumber);
    } else {
      if (!c.showTable) return null;
      const t = order.tableName || order.tableLabel;
      if (!t) return null;
      label = 'TABLE';
      value = String(t);
    }
    return (
      <div style={{
        ...section, textAlign: 'center', border: '2px solid #000', borderRadius: radius,
        padding: '2px 0',
      }}>
        <div style={{ fontSize: `${base - 2}px`, fontWeight: 700, letterSpacing: 1 }}>{label}</div>
        <div style={{ fontSize: `${base + 18}px`, fontWeight: 900, lineHeight: 1.05 }}>{value}</div>
      </div>
    );
  };

  const renderTitle = () => {
    if (!L.title) return null;
    return (
      <div style={{
        ...section, textAlign: 'center', fontWeight: 900, fontSize: `${base + 4}px`,
        letterSpacing: 2, borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '2px 0',
      }}>{L.title}</div>
    );
  };

  const renderStatus = () => {
    if (!L.statusLine) return null;
    return (
      <div style={{
        ...section, textAlign: 'center', fontWeight: 900, fontSize: `${base + 2}px`, letterSpacing: 1,
      }}>{isPaid ? '*** BILL PAID ***' : '*** UNPAID ***'}</div>
    );
  };

  // ---- items -------------------------------------------------------------
  const columns = L.columns.filter(col => {
    if (col === 'sr') return c.showSerial;
    if (col === 'variant') return c.showVariants;
    return true;
  });

  const itemValue = (item: CartItem, col: ItemColumn, index: number): string => {
    switch (col) {
      case 'sr': return String(index + 1);
      case 'name': return item.name;
      case 'variant': return item.variantName || '';
      case 'qty': return qtyLabel(item);
      case 'rate': return money(item.price, false);
      case 'amount': return money(item.lineTotal ?? item.quantity * item.price, false);
    }
  };

  const renderItemRow = (item: CartItem, index: number, styles: React.CSSProperties) => (
    <tr key={item.id || index} className="item-row">
      {columns.map(col => (
        <td
          key={col}
          className={NUMERIC_COLUMNS.has(col) ? 'premium-num' : undefined}
          style={{ ...styles, textAlign: COLUMN_ALIGN[col], fontWeight: col === 'name' ? 800 : undefined }}
        >
          {itemValue(item, col, index)}
          {col === 'name' && c.showItemNotes && item.note
            ? <div style={{ fontSize: `${base - 2}px`, fontWeight: 400 }}>» {item.note}</div>
            : null}
          {col === 'name' && !c.showVariants && variantNote(item)
            ? <span style={{ fontWeight: 400 }}> ({variantNote(item)})</span>
            : null}
        </td>
      ))}
    </tr>
  );

  const header = (
    <thead>
      <tr>
        {columns.map(col => (
          <th
            key={col}
            className={NUMERIC_COLUMNS.has(col) ? 'premium-num' : undefined}
            style={{
              ...(L.items === 'grid' ? cell : bareCell),
              textAlign: COLUMN_ALIGN[col],
              fontWeight: 900,
              borderBottom: L.items === 'grid' ? undefined : '1px solid #000',
            }}
          >{COLUMN_LABEL[col]}</th>
        ))}
      </tr>
    </thead>
  );

  const tableStyle: React.CSSProperties = {
    width: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'collapse',
    marginTop: `${c.sectionSpacing}px`,
  };

  // Café lines: "2 × Cappuccino" with the amount at the right, then the
  // unit price (only when more than one was ordered) and the note in smaller
  // type underneath. Each item is ONE cell holding a flex line, so the
  // amount sits on the item's first line (the print stylesheet centres
  // table cells vertically) and the lines underneath get the full width.
  const renderCafeItems = () => {
    const items = order.items || [];
    const showRate = columns.includes('rate');
    const showSr = columns.includes('sr');
    const sub: React.CSSProperties = { fontSize: `${base - 2}px`, fontWeight: 400 };
    const head: React.CSSProperties = { ...bareCell, fontWeight: 900, borderBottom: '1px solid #000' };
    return (
      <table className="premium-items" style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: 'left' }}>Item</th>
            <th className="premium-num" style={{ ...head, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const weighed = item.pricingType === 'weight' && !!item.weightGrams && item.weightGrams > 0;
            const qty = weighed ? `${qtyLabel(item)} kg` : qtyLabel(item);
            const each = showRate && !weighed && Number(item.quantity) > 1;
            return (
              <tr key={item.id || i} className="item-row">
                <td colSpan={2} style={{ ...bareCell, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontWeight: 800 }}>
                    <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                      {showSr ? `${i + 1}. ` : ''}{qty} × {item.name}
                      {variantNote(item) ? <span style={{ fontWeight: 400 }}> ({variantNote(item)})</span> : null}
                    </span>
                    <span className="premium-num" style={{ textAlign: 'right' }}>
                      {money(item.lineTotal ?? item.quantity * item.price, false)}
                    </span>
                  </div>
                  {each && <div style={sub}>@ {money(item.price, false)} each</div>}
                  {c.showItemNotes && item.note ? <div style={sub}>» {item.note}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const renderItems = () => {
    const items = order.items || [];
    if (L.items === 'cafe') return renderCafeItems();
    if (L.items === 'grouped') {
      // Group by the item's own station/category label when the order
      // carries one; otherwise fall back to a single ungrouped run so the
      // layout still works for shops that do not use stations.
      const groups = new Map<string, CartItem[]>();
      for (const it of items) {
        const key = (it as any).station || (it as any).categoryName || '';
        const list = groups.get(key) || [];
        list.push(it);
        groups.set(key, list);
      }
      let n = 0;
      return (
        <table className="premium-items" style={tableStyle}>
          {header}
          <tbody>
            {Array.from(groups.entries()).map(([group, list]) => (
              <React.Fragment key={`grp-${group}`}>
                {group && (
                  <tr key={`g-${group}`}>
                    <td colSpan={columns.length} style={{ ...bareCell, fontWeight: 900, paddingTop: 3 }}>{group}</td>
                  </tr>
                )}
                {list.map(item => renderItemRow(item, n++, bareCell))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      );
    }

    const rowStyle = L.items === 'grid'
      ? cell
      : L.items === 'dotted'
        ? { ...bareCell, borderBottom: '1px dotted #000' }
        : bareCell;

    return (
      <div style={L.items === 'ruled' ? { borderTop: '1px solid #000', borderBottom: '1px solid #000' } : undefined}>
        <table className="premium-items" style={{ ...tableStyle, marginTop: L.items === 'ruled' ? 0 : `${c.sectionSpacing}px` }}>
          {header}
          <tbody>{items.map((item, i) => renderItemRow(item, i, rowStyle))}</tbody>
        </table>
      </div>
    );
  };

  // ---- totals ------------------------------------------------------------
  const totalRows: Array<[string, string]> = [];
  if (c.showSubtotal) totalRows.push(['Subtotal', money(order.subtotal)]);
  if (c.showDiscount && order.discount) totalRows.push([discountLineTitle(order), `- ${money(order.discount)}`]);
  if (c.showTax && order.tax) totalRows.push(['Tax', money(order.tax)]);
  if (c.showServiceCharge && order.serviceCharge) totalRows.push([serviceChargeLabel(order), money(order.serviceCharge)]);
  if (order.deliveryChargeAmount) totalRows.push(['Delivery', money(order.deliveryChargeAmount)]);
  if (order.roundingAdjust) totalRows.push(['Rounding', money(order.roundingAdjust)]);

  const afterRows: Array<[string, string]> = [];
  if (c.showPaymentMethod && order.paymentMethod) afterRows.push(['Payment', String(order.paymentMethod).toUpperCase()]);
  if (c.showChange && order.cashReceived) afterRows.push(['Cash Received', money(order.cashReceived)]);
  if (c.showChange && order.changeReturned) afterRows.push(['Change', money(order.changeReturned)]);

  const pairLine = (k: string, v: string, key: string, bold = false) => (
    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: bold ? 900 : undefined }}>
      <span>{k}</span><span>{v}</span>
    </div>
  );

  const renderGrandTotal = () => {
    const value = money(order.grandTotal);
    if (L.grandTotal === 'bar') {
      return (
        <div className="grand-total dt-reverse" style={{
          display: 'flex', justifyContent: 'space-between', gap: 8,
          background: '#000', color: '#fff', fontWeight: 900,
          fontSize: `${base + 4}px`, padding: '3px 4px', marginTop: 3,
          WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
        }}>
          <span>TOTAL</span><span>{value}</span>
        </div>
      );
    }
    if (L.grandTotal === 'box') {
      return (
        <div className="grand-total" style={{
          display: 'flex', justifyContent: 'space-between', gap: 8,
          border: '2px solid #000', borderRadius: radius, fontWeight: 900,
          fontSize: `${base + 4}px`, padding: '2px 4px', marginTop: 3,
        }}>
          <span>TOTAL</span><span>{value}</span>
        </div>
      );
    }
    if (L.grandTotal === 'large') {
      return (
        <div className="grand-total" style={{
          display: 'flex', justifyContent: 'space-between', gap: 8,
          fontWeight: 900, fontSize: `${base + 8}px`, marginTop: 3, lineHeight: 1.2,
          borderTop: '2px solid #000', paddingTop: 2,
        }}>
          <span>TOTAL</span><span>{value}</span>
        </div>
      );
    }
    return (
      <div className="grand-total" style={{
        display: 'flex', justifyContent: 'space-between', gap: 8,
        fontWeight: 900, fontSize: `${base + 3}px`, marginTop: 3,
        borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '2px 0',
      }}>
        <span>TOTAL</span><span>{value}</span>
      </div>
    );
  };

  const renderTotals = () => {
    const body = (
      <>
        {totalRows.map(([k, v], i) => pairLine(k, v, `t${i}`))}
        {renderGrandTotal()}
        {afterRows.map(([k, v], i) => pairLine(k, v, `a${i}`))}
        {L.amountInWords && (
          <div style={{ fontSize: `${base - 2}px`, marginTop: 2, textAlign: 'center' }}>
            {amountInWords(order.grandTotal)}
          </div>
        )}
      </>
    );

    if (L.totals === 'grid') {
      return (
        <table className="premium-items" style={{ ...tableStyle, marginTop: 0 }}>
          <tbody>
            {totalRows.map(([k, v], i) => (
              <tr key={`t${i}`}>
                <td style={{ ...cell, textAlign: 'left' }}>{k}</td>
                <td style={{ ...cell, textAlign: 'right', width: '42%' }}>{v}</td>
              </tr>
            ))}
            <tr className="grand-total">
              <td style={{ ...cell, fontWeight: 900, fontSize: `${base + 2}px` }}>TOTAL</td>
              <td style={{ ...cell, fontWeight: 900, fontSize: `${base + 2}px`, textAlign: 'right' }}>{money(order.grandTotal)}</td>
            </tr>
            {afterRows.map(([k, v], i) => (
              <tr key={`a${i}`}>
                <td style={{ ...cell, textAlign: 'left' }}>{k}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{v}</td>
              </tr>
            ))}
            {L.amountInWords && (
              <tr>
                <td colSpan={2} style={{ ...cell, textAlign: 'center', fontSize: `${base - 2}px` }}>
                  {amountInWords(order.grandTotal)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      );
    }
    if (L.totals === 'panel' || L.totals === 'rounded') {
      return (
        <div style={{
          ...section, border: '1px solid #000',
          borderRadius: L.totals === 'rounded' ? 8 : radius, padding: '3px 5px',
        }}>{body}</div>
      );
    }
    return <div style={section}>{body}</div>;
  };

  // ---- footer ------------------------------------------------------------
  const thankYou = c.thankYouText || s.thankYouText || 'Thank You!';
  const footerText = c.footerText || s.receiptFooter || '';
  const qrOn = L.qr && c.showQr && s.receiptShowQr !== false;

  const renderFooter = () => (
    <div style={{ ...section, textAlign: 'center' }}>
      <div style={rule(1, true)} />
      {thankYou && <div style={{ fontWeight: 800, fontSize: `${base + 1}px` }}>{thankYou}</div>}
      {footerText && <div style={{ fontSize: `${base - 1}px` }}>{footerText}</div>}
      {s.marketingFooter && <div style={{ fontSize: `${base - 2}px` }}>{s.marketingFooter}</div>}
      {qrOn && (
        // The shop's configured QR image. No placeholder is drawn when one
        // is not set — a blank square wastes paper and confuses customers.
        s.receiptQrImage
          ? <img src={s.receiptQrImage} alt="" style={{ width: 96, height: 96, margin: '4px auto 0', display: 'block', objectFit: 'contain' }} />
          : null
      )}
      {/* Settings → Receipt → QR & Barcode, "Footer" position */}
      <ReceiptCodesSlot position="footer" />
      {c.showPoweredBy && <div style={{ fontSize: `${base - 3}px`, marginTop: 2 }}>Powered by DT POS</div>}
    </div>
  );

  return (
    <div className="premium-receipt receipt-root" data-template={templateId} style={rootStyle}>
      {/* Travels with the slip's outerHTML into the hidden print worker, so
          the printed table sizes its columns exactly as the preview does. */}
      <style dangerouslySetInnerHTML={{ __html: ITEM_TABLE_CSS }} />
      {renderHeader()}
      {renderStatus()}
      {renderTitle()}
      {renderHero()}
      {renderMeta()}
      {renderItems()}
      {renderTotals()}
      {renderFooter()}
    </div>
  );
}

export type { PremiumTemplate };
