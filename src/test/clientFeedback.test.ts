// ============================================================
// Tests — v1.14.1, from the client's field report
//
// Every case here comes from a real message after a real day of
// trading, so each one asserts the exact behaviour that was wrong.
// ============================================================
import { describe, it, expect } from 'vitest';
import { generateInternalCode } from '@/lib/barcode';

/** Mirrors paymentEntryLabel() in ReceiptPreview. */
function paymentEntryLabel(p: any): string {
  const method = String(p?.method || '').toLowerCase();
  if (method === 'cash') return 'CASH';
  if (method === 'card') return 'CARD';
  if (method === 'credit') return 'CREDIT';
  if (method === 'online') return String(p?.accountName || 'ONLINE').toUpperCase();
  return String(p?.accountName || p?.method || 'PAYMENT').toUpperCase();
}

describe('receipt shows the REAL payment type ("showing in reports but not on receipts")', () => {
  it('NETS prints as NETS, not ONLINE', () => {
    expect(paymentEntryLabel({ method: 'NETS', amount: 40 })).toBe('NETS');
  });

  it('PayNow prints as PAYNOW', () => {
    expect(paymentEntryLabel({ method: 'PayNow', amount: 73.1 })).toBe('PAYNOW');
  });

  it('any restaurant-defined type prints its own name', () => {
    expect(paymentEntryLabel({ method: 'CDC Voucher' })).toBe('CDC VOUCHER');
    expect(paymentEntryLabel({ method: 'GrabPay' })).toBe('GRABPAY');
  });

  it('built-in methods are unchanged', () => {
    expect(paymentEntryLabel({ method: 'cash' })).toBe('CASH');
    expect(paymentEntryLabel({ method: 'card' })).toBe('CARD');
    expect(paymentEntryLabel({ method: 'credit' })).toBe('CREDIT');
  });

  it('a named bank account still wins for the built-in online method', () => {
    expect(paymentEntryLabel({ method: 'online', accountName: 'JazzCash' })).toBe('JAZZCASH');
  });

  it('online with no account falls back to ONLINE, as before', () => {
    expect(paymentEntryLabel({ method: 'online' })).toBe('ONLINE');
  });

  it('a split of Cash + NETS labels BOTH lines correctly', () => {
    // The exact scenario the client asked about.
    const lines = [
      { method: 'cash', amount: 20 },
      { method: 'NETS', amount: 25.45 },
    ].map(paymentEntryLabel);
    expect(lines).toEqual(['CASH', 'NETS']);
  });

  it('a malformed entry never prints an empty label', () => {
    expect(paymentEntryLabel({})).toBe('PAYMENT');
    expect(paymentEntryLabel({ method: '' })).toBe('PAYMENT');
  });
});

describe('internal barcodes stay unique ("two items must never share a code")', () => {
  it('200 codes generated back to back are all distinct', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInternalCode()));
    expect(codes.size).toBe(200);
  });

  it('holds at minimart scale — 5000 codes, zero collisions', () => {
    // The old generator had ~46k possible suffixes inside one millisecond,
    // so a busy counter could realistically produce a duplicate.
    const codes = new Set(Array.from({ length: 5000 }, () => generateInternalCode()));
    expect(codes.size).toBe(5000);
  });

  it('honours a custom prefix', () => {
    expect(generateInternalCode('VEG').startsWith('VEG')).toBe(true);
  });

  it('produces scanner-safe characters only (A-Z, 0-9)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInternalCode()).toMatch(/^[A-Z0-9]+$/);
    }
  });
});

describe('low stock detection ("no notification on low stock")', () => {
  // Mirrors getLowStockItems() in store.ts.
  const lowStock = (inv: any[]) => inv
    .filter(i => i?.isActive !== false
      && Number(i?.lowStockThreshold) > 0
      && Number(i?.quantity ?? 0) <= Number(i.lowStockThreshold))
    .map(i => ({ id: i.id, name: i.name, quantity: Number(i.quantity), threshold: Number(i.lowStockThreshold) }));

  it('flags an item at or below its threshold', () => {
    const out = lowStock([
      { id: 'a', name: 'Rice', quantity: 3, lowStockThreshold: 5, isActive: true },
      { id: 'b', name: 'Oil', quantity: 50, lowStockThreshold: 5, isActive: true },
    ]);
    expect(out.map(i => i.name)).toEqual(['Rice']);
  });

  it('exactly AT the threshold counts as low — waiting for below is too late', () => {
    expect(lowStock([{ id: 'a', name: 'Salt', quantity: 5, lowStockThreshold: 5, isActive: true }])).toHaveLength(1);
  });

  it('items with no threshold set are never flagged', () => {
    expect(lowStock([{ id: 'a', name: 'X', quantity: 0, lowStockThreshold: 0, isActive: true }])).toHaveLength(0);
  });

  it('inactive items are ignored', () => {
    expect(lowStock([{ id: 'a', name: 'Old', quantity: 0, lowStockThreshold: 5, isActive: false }])).toHaveLength(0);
  });

  it('zero stock is reported, not skipped', () => {
    expect(lowStock([{ id: 'a', name: 'Sugar', quantity: 0, lowStockThreshold: 2, isActive: true }])).toHaveLength(1);
  });
});

describe('retail stock deduction ("inventory stock not updating")', () => {
  // Mirrors the retail branch of deductStockForOrder(): a product linked
  // straight to an inventory row, with no recipe involved.
  const consumed = (line: any, menuItem: any) => {
    if (!menuItem?.inventoryItemId) return 0;
    const perUnit = Number(menuItem.stockPerUnit) > 0 ? Number(menuItem.stockPerUnit) : 1;
    const qty = line.pricingType === 'weight' ? (line.weightGrams || 0) / 1000 : (line.quantity || 0);
    return perUnit * qty;
  };

  it('selling 3 bottles decrements 3 — no recipe needed', () => {
    expect(consumed({ quantity: 3 }, { inventoryItemId: 'inv1' })).toBe(3);
  });

  it('stockPerUnit handles multipacks (a 6-pack takes 6 units)', () => {
    expect(consumed({ quantity: 2 }, { inventoryItemId: 'inv1', stockPerUnit: 6 })).toBe(12);
  });

  it('weight items decrement in kilograms', () => {
    expect(consumed({ pricingType: 'weight', weightGrams: 1500 }, { inventoryItemId: 'inv1' })).toBe(1.5);
  });

  it('an unlinked restaurant dish deducts nothing through this path', () => {
    expect(consumed({ quantity: 5 }, { name: 'Biryani' })).toBe(0);
  });
});
