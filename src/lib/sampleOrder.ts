// ============================================================
// Preview order for template galleries.
//
// Template previews should show what the shop's own bills actually look
// like, so the most recent real order is used when there is one. A shop on
// its first day has no orders yet, so a representative sample stands in —
// it is never written anywhere and never printed on a customer's bill.
// ============================================================
import type { Order } from './types';

/** Stand-in used only until the shop has taken its first order. */
export function buildSampleOrder(): Order {
  const now = new Date().toISOString();
  return {
    id: 'preview',
    orderNumber: 1042,
    orderType: 'dining',
    status: 'paid',
    tableId: 't1',
    tableName: '5',
    waiterId: 'w1',
    waiterName: 'Ali Raza',
    cashierName: 'Cashier',
    customer: { id: 'c1', name: 'Ahmed Khan', phone: '0300-1234567', address: 'Main Boulevard' },
    items: [
      { id: 'i1', menuItemId: 'm1', name: 'Chicken Biryani', pricingType: 'fixed', price: 450, quantity: 2, lineTotal: 900, note: 'Less spicy' },
      { id: 'i2', menuItemId: 'm2', name: 'Zinger Burger', pricingType: 'fixed', price: 550, quantity: 1, lineTotal: 550, note: '', variantName: 'Large' },
      { id: 'i3', menuItemId: 'm3', name: 'Cold Drink 500ml', pricingType: 'fixed', price: 120, quantity: 2, lineTotal: 240, note: '' },
    ],
    subtotal: 1690,
    discount: 100,
    discountTitle: 'Eid Discount',
    tax: 152,
    serviceCharge: 85,
    serviceChargePercent: 5,
    grandTotal: 1827,
    paymentMethod: 'cash',
    cashReceived: 2000,
    changeReturned: 173,
    createdAt: now,
    paidAt: now,
    notes: 'No onion',
  };
}

/**
 * Pick the order a preview should show: the shop's most recent real bill
 * when it has one, otherwise the sample. Callers pass their own orders so
 * this module stays free of the store's dependency graph. A preview is
 * never worth an exception, so anything unusable falls back silently.
 */
export function pickPreviewOrder(orders?: Order[] | null): Order {
  try {
    const latest = (orders || [])
      .filter(o => (o?.items?.length || 0) > 0)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (latest) return latest;
  } catch { /* unusable history — use the sample */ }
  return buildSampleOrder();
}
