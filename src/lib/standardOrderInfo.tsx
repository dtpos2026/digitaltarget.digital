import { Order } from '@/lib/types';

/**
 * Standardized order header info per business spec.
 * Only these fields are allowed on KOT/Receipt prints.
 * Empty/irrelevant fields are NEVER printed (dynamic by order type).
 */
export interface StandardField {
  label: string;
  value: string;
}

export function getOrderTypeLabel(order: Order): string {
  switch (order.orderType) {
    case 'dining': return 'Dine-In';
    case 'takeaway': return 'Takeaway';
    case 'delivery': return 'Delivery';
    default: return String(order.orderType || '').toUpperCase();
  }
}

export interface StandardFieldsOpts {
  includeCustomer?: boolean; // show Customer Name/Phone if present (receipts: true, KOT: optional)
  includeInvoice?: boolean;  // show Invoice No if order has one
  includeCustomerAddress?: boolean; // show customer address (KOT toggle)
}

export function getStandardOrderFields(order: Order, opts: StandardFieldsOpts = {}): StandardField[] {
  const { includeCustomer = true, includeInvoice = false, includeCustomerAddress = false } = opts;
  const now = new Date(order.createdAt);
  const date = now.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

  const fields: StandardField[] = [];
  fields.push({ label: 'Date', value: date });
  fields.push({ label: 'Time', value: time });
  fields.push({ label: 'Order No', value: `#${order.orderNumber}` });

  const inv = (order as any).invoiceNo || (order as any).invoiceNumber;
  if (includeInvoice && inv) fields.push({ label: 'Invoice No', value: String(inv) });

  fields.push({ label: 'Order Type', value: getOrderTypeLabel(order) });

  if (order.orderType === 'dining' && order.tableName) {
    fields.push({ label: 'Table', value: order.tableName });
  }
  if (order.waiterName) {
    fields.push({ label: 'Waiter', value: order.waiterName });
  }
  if (order.orderType === 'delivery') {
    if (order.riderName) fields.push({ label: 'Rider', value: order.riderName });
    if (order.riderPhone) fields.push({ label: 'Rider Phone', value: order.riderPhone });
  }
  if (includeCustomer) {
    if (order.customer?.name) fields.push({ label: 'Customer', value: order.customer.name });
    if (order.customer?.phone) fields.push({ label: 'Phone', value: order.customer.phone });
  }
  if (includeCustomerAddress) {
    const addr = order.customer?.fullAddress || order.customer?.address;
    if (addr) fields.push({ label: 'Address', value: String(addr) });
  }
  return fields;
}

/** Renders fields as a two-column grid (label : value). */
export function StandardInfoGrid({
  order, opts, labelWidth = 75, fontSize = 11, columns = 2,
}: {
  order: Order;
  opts?: StandardFieldsOpts;
  labelWidth?: number;
  fontSize?: number;
  columns?: 1 | 2;
}) {
  const fields = getStandardOrderFields(order, opts);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: columns === 2 ? '1fr 1fr' : '1fr',
      columnGap: '8px',
      rowGap: '1px',
      fontSize: `${fontSize}px`,
      color: '#000',
    }}>
      {fields.map((f) => (
        <div key={f.label} style={{ display: 'flex', padding: '1px 0' }}>
          <span style={{ width: `${labelWidth}px`, fontWeight: 600 }}>{f.label}</span>
          <span style={{ width: '6px' }}>:</span>
          <span style={{ flex: 1, fontWeight: 700 }}>{f.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Renders fields stacked single-column. */
export function StandardInfoRows({
  order, opts, labelWidth = 75, fontSize = 11,
}: {
  order: Order;
  opts?: StandardFieldsOpts;
  labelWidth?: number;
  fontSize?: number;
}) {
  return <StandardInfoGrid order={order} opts={opts} labelWidth={labelWidth} fontSize={fontSize} columns={1} />;
}
