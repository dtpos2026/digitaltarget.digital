// ============================================================
// Tests — PRA EIMS (v1.9.0)
//
// These lock the invoice model against the PRAL specification. A wrong
// number here is a compliance failure, not a UI bug, so the arithmetic
// is asserted exactly rather than approximately wherever possible.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  buildPraInvoice, validatePraInvoice, parsePraResponse,
  toPraPaymentMode, toPraInvoiceType, toPraDateTime, praVerifyUrl,
  praEndpoint, praConfigReady,
  PraPaymentMode, PraInvoiceType, PRA_CONFIG_DEFAULT,
  PCT_CODE_DEFAULT, PRA_CLOUD_PRODUCTION_URL, PRA_CLOUD_SANDBOX_URL,
  type PraConfig,
} from '@/lib/praEims';
import type { Order } from '@/lib/types';

const cfg: PraConfig = { ...PRA_CONFIG_DEFAULT, enabled: true, posId: '100000' };

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', orderNumber: 1897, orderType: 'dining', status: 'paid',
    items: [{
      id: 'l1', menuItemId: 'IT_1011', name: 'Chicken Karahi',
      pricingType: 'fixed', price: 1000, quantity: 1, lineTotal: 1000, note: '',
    }] as any,
    subtotal: 1000, discount: 0, tax: 0,
    serviceCharge: 0, serviceChargePercent: 0,
    grandTotal: 1000,
    createdAt: '2026-07-25T14:30:00.000Z',
    ...over,
  } as Order;
}

describe('invoice header — spec field mapping', () => {
  it('maps POSID, USIN and leaves InvoiceNumber blank for PRA to fill', () => {
    const inv = buildPraInvoice(order(), cfg);
    expect(inv.POSID).toBe(100000);
    expect(inv.USIN).toBe('1897');            // our own order number
    expect(inv.InvoiceNumber).toBe('');       // spec: blank on submit
  });

  it('formats DateTime exactly as "YYYY-MM-DD HH:mm:ss"', () => {
    expect(toPraDateTime('2020-01-01T12:00:00')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(toPraDateTime('2020-01-01T12:00:00')).toBe('2020-01-01 12:00:00');
  });

  it('defaults PCTCode to the spec placeholder for restaurant items', () => {
    const inv = buildPraInvoice(order(), cfg);
    expect(inv.Items[0].PCTCode).toBe(PCT_CODE_DEFAULT);
    expect(inv.Items[0].PCTCode).toHaveLength(8);
  });

  it('passes buyer details only when the customer gave them (all optional)', () => {
    const plain = buildPraInvoice(order(), cfg);
    expect(plain.BuyerName).toBeUndefined();
    expect(plain.BuyerPhoneNumber).toBeUndefined();

    const named = buildPraInvoice(
      order({ customer: { name: 'Shahzad Ahmed', phone: '03001234567' } as any }), cfg,
    );
    expect(named.BuyerName).toBe('Shahzad Ahmed');
    expect(named.BuyerPhoneNumber).toBe('03001234567');
  });
});

describe('totals reconcile — PRA rejects invoices whose parts do not add up', () => {
  it('TotalSaleValue equals the sum of item SaleValues', () => {
    const inv = buildPraInvoice(order({
      items: [
        { id: 'a', menuItemId: 'A', name: 'A', pricingType: 'fixed', price: 300, quantity: 1, lineTotal: 300, note: '' },
        { id: 'b', menuItemId: 'B', name: 'B', pricingType: 'fixed', price: 700, quantity: 2, lineTotal: 700, note: '' },
      ] as any,
      subtotal: 1000, grandTotal: 1000,
    }), cfg);
    const sum = inv.Items.reduce((s, i) => s + i.SaleValue, 0);
    expect(inv.TotalSaleValue).toBeCloseTo(sum, 2);
    expect(validatePraInvoice(inv).ok).toBe(true);
  });

  it('distributes order-level discount across items and still reconciles', () => {
    const inv = buildPraInvoice(order({
      items: [
        { id: 'a', menuItemId: 'A', name: 'A', pricingType: 'fixed', price: 600, quantity: 1, lineTotal: 600, note: '' },
        { id: 'b', menuItemId: 'B', name: 'B', pricingType: 'fixed', price: 400, quantity: 1, lineTotal: 400, note: '' },
      ] as any,
      subtotal: 1000, discount: 100, grandTotal: 900,
    }), cfg);
    expect(inv.Discount).toBe(100);
    const itemDiscounts = inv.Items.reduce((s, i) => s + i.Discount, 0);
    expect(itemDiscounts).toBeCloseTo(100, 2);           // nothing lost
    expect(inv.TotalSaleValue).toBeCloseTo(900, 2);       // excl. discount
    expect(validatePraInvoice(inv).ok).toBe(true);
  });

  it('distributes tax across items and matches TotalTaxCharged', () => {
    const inv = buildPraInvoice(order({
      items: [
        { id: 'a', menuItemId: 'A', name: 'A', pricingType: 'fixed', price: 500, quantity: 1, lineTotal: 500, note: '' },
        { id: 'b', menuItemId: 'B', name: 'B', pricingType: 'fixed', price: 500, quantity: 1, lineTotal: 500, note: '' },
      ] as any,
      subtotal: 1000, tax: 160, taxPercent: 16, grandTotal: 1160,
    } as any), cfg);
    expect(inv.TotalTaxCharged).toBeCloseTo(160, 2);
    expect(inv.Items.reduce((s, i) => s + i.TaxCharged, 0)).toBeCloseTo(160, 2);
    expect(inv.Items[0].TaxRate).toBe(16);
    expect(validatePraInvoice(inv).ok).toBe(true);
  });

  it('reports service charge as its own line so the totals still balance', () => {
    const inv = buildPraInvoice(order({
      subtotal: 1000, serviceCharge: 100, serviceChargePercent: 10, grandTotal: 1100,
    }), cfg);
    const sc = inv.Items.find(i => i.ItemCode === 'SRVCHG');
    expect(sc).toBeTruthy();
    expect(sc!.SaleValue).toBeCloseTo(100, 2);
    expect(inv.TotalSaleValue).toBeCloseTo(1100, 2);
    expect(validatePraInvoice(inv).ok).toBe(true);
  });

  it('awkward thirds still reconcile exactly (rounding lands on the last line)', () => {
    const inv = buildPraInvoice(order({
      items: [
        { id: 'a', menuItemId: 'A', name: 'A', pricingType: 'fixed', price: 100, quantity: 1, lineTotal: 100, note: '' },
        { id: 'b', menuItemId: 'B', name: 'B', pricingType: 'fixed', price: 100, quantity: 1, lineTotal: 100, note: '' },
        { id: 'c', menuItemId: 'C', name: 'C', pricingType: 'fixed', price: 100, quantity: 1, lineTotal: 100, note: '' },
      ] as any,
      subtotal: 300, discount: 10, tax: 10, grandTotal: 300,
    }), cfg);
    expect(inv.Items.reduce((s, i) => s + i.Discount, 0)).toBeCloseTo(10, 2);
    expect(inv.Items.reduce((s, i) => s + i.TaxCharged, 0)).toBeCloseTo(10, 2);
    expect(validatePraInvoice(inv).ok).toBe(true);
  });
});

describe('PaymentMode enum (spec values 1..6)', () => {
  it('cash → 1, card → 2', () => {
    expect(toPraPaymentMode(order({ paymentMethod: 'cash' } as any))).toBe(PraPaymentMode.Cash);
    expect(toPraPaymentMode(order({ paymentMethod: 'card' } as any))).toBe(PraPaymentMode.Card);
  });

  it('a split bill across two methods reports Mixed (5), as the spec requires', () => {
    const o = order({
      payments: [
        { id: 'p1', method: 'cash', amount: 500, at: '' },
        { id: 'p2', method: 'card', amount: 500, at: '' },
      ],
    } as any);
    expect(toPraPaymentMode(o)).toBe(PraPaymentMode.Mixed);
  });

  it('several payments on the SAME method is not Mixed', () => {
    const o = order({
      payments: [
        { id: 'p1', method: 'cash', amount: 500, at: '' },
        { id: 'p2', method: 'cash', amount: 500, at: '' },
      ],
    } as any);
    expect(toPraPaymentMode(o)).toBe(PraPaymentMode.Cash);
  });

  it('cheque → 6, gift voucher → 3, loyalty → 4', () => {
    expect(toPraPaymentMode(order({ paymentMethod: 'cheque' } as any))).toBe(PraPaymentMode.Cheque);
    expect(toPraPaymentMode(order({ paymentMethod: 'giftvoucher' } as any))).toBe(PraPaymentMode.GiftVoucher);
    expect(toPraPaymentMode(order({ paymentMethod: 'loyalty' } as any))).toBe(PraPaymentMode.LoyaltyCard);
  });

  it('a restaurant-defined custom type falls back to a valid enum value', () => {
    const mode = toPraPaymentMode(order({ paymentMethod: 'NETS' } as any));
    expect([1, 2, 3, 4, 5, 6]).toContain(mode);
  });
});

describe('InvoiceType — voids are Credit invoices (spec FAQ)', () => {
  it('a normal sale is New (1)', () => {
    expect(toPraInvoiceType(order({ status: 'paid' }))).toBe(PraInvoiceType.New);
  });
  it('void and cancelled are Credit (3)', () => {
    expect(toPraInvoiceType(order({ status: 'void' }))).toBe(PraInvoiceType.Credit);
    expect(toPraInvoiceType(order({ status: 'cancelled' }))).toBe(PraInvoiceType.Credit);
  });
  it('the type is stamped on every line too', () => {
    const inv = buildPraInvoice(order({ status: 'void' }), cfg);
    expect(inv.InvoiceType).toBe(PraInvoiceType.Credit);
    expect(inv.Items.every(i => i.InvoiceType === PraInvoiceType.Credit)).toBe(true);
  });
});

describe('validation catches what PRA would reject', () => {
  it('missing POSID fails', () => {
    const inv = buildPraInvoice(order(), { ...cfg, posId: '' });
    const v = validatePraInvoice(inv);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/POSID/);
  });

  it('an empty invoice fails', () => {
    const inv = buildPraInvoice(order({ items: [] as any, subtotal: 0, grandTotal: 0 }), cfg);
    expect(validatePraInvoice(inv).ok).toBe(false);
  });

  it('a tampered header total is caught before submission', () => {
    const inv = buildPraInvoice(order(), cfg);
    inv.TotalSaleValue = 99999;
    const v = validatePraInvoice(inv);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/TotalSaleValue/);
  });
});

describe('response parsing (spec: Code "100" = accepted)', () => {
  it('accepts the documented success shape', () => {
    const r = parsePraResponse({
      InvoiceNumber: '9000052011142444901',
      Code: '100',
      Response: 'Fiscal Invoice Number generated successfully.',
      Errors: null,
    });
    expect(r.success).toBe(true);
    expect(r.invoiceNumber).toBe('9000052011142444901');
  });

  it('handles a numeric InvoiceNumber (the spec shows both forms)', () => {
    const r = parsePraResponse({ InvoiceNumber: 90000520191112000369, Code: '100' });
    expect(r.success).toBe(true);
    expect(typeof r.invoiceNumber).toBe('string');
  });

  it('a non-100 code is a business rejection and must NOT be retried forever', () => {
    const r = parsePraResponse({ Code: '400', Response: 'Invalid POS ID' });
    expect(r.success).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.error).toContain('Invalid POS ID');
  });

  it('an unusable body is treated as retryable (probably transport)', () => {
    expect(parsePraResponse(null).retryable).toBe(true);
    expect(parsePraResponse('<html>502</html>').retryable).toBe(true);
  });

  it('success code without an invoice number is NOT treated as success', () => {
    expect(parsePraResponse({ Code: '100', InvoiceNumber: '' }).success).toBe(false);
  });
});

describe('endpoints and config gating', () => {
  it('cloud transport picks sandbox vs production correctly', () => {
    expect(praEndpoint({ ...cfg, transport: 'cloud', environment: 'sandbox' })).toBe(PRA_CLOUD_SANDBOX_URL);
    expect(praEndpoint({ ...cfg, transport: 'cloud', environment: 'production' })).toBe(PRA_CLOUD_PRODUCTION_URL);
  });

  it('local transport targets the documented fiscal-device path', () => {
    expect(praEndpoint({ ...cfg, transport: 'local' }))
      .toBe('http://localhost:8524/api/IMSFiscal/GetInvoiceNumberByModel');
  });

  it('a custom local port override is honoured', () => {
    expect(praEndpoint({ ...cfg, transport: 'local', localBaseUrl: 'http://localhost:9000/' }))
      .toBe('http://localhost:9000/api/IMSFiscal/GetInvoiceNumberByModel');
  });

  it('config is not ready while disabled, unregistered, or token-less', () => {
    expect(praConfigReady({ ...cfg, enabled: false }).ok).toBe(false);
    expect(praConfigReady({ ...cfg, posId: '' }).ok).toBe(false);
    expect(praConfigReady({ ...cfg, posId: 'ABC' }).ok).toBe(false);
    expect(praConfigReady({ ...cfg, transport: 'cloud' }).ok).toBe(false);
    expect(praConfigReady({ ...cfg, transport: 'cloud', cloudToken: 't' }).ok).toBe(true);
    expect(praConfigReady(cfg).ok).toBe(true);
  });

  it('the QR encodes PRA\'s own verification URL', () => {
    const url = praVerifyUrl('9000052011142444901');
    expect(url).toContain('e.pra.punjab.gov.pk');
    expect(url).toContain('PRAInvNo=9000052011142444901');
  });
});

describe('multi-tenant safety', () => {
  it('the module ships OFF by default', () => {
    expect(PRA_CONFIG_DEFAULT.enabled).toBe(false);
    expect(praConfigReady(PRA_CONFIG_DEFAULT).ok).toBe(false);
  });

  it('each restaurant supplies its own POS ID — nothing is hard-coded', () => {
    const a = buildPraInvoice(order(), { ...cfg, posId: '111111' });
    const b = buildPraInvoice(order(), { ...cfg, posId: '222222' });
    expect(a.POSID).toBe(111111);
    expect(b.POSID).toBe(222222);
  });
});
