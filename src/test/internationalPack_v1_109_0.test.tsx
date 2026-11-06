// v1.109.0 — International pack: locale-aware numbers and dates, a tax-registration rule per country, and the two privacy
// requests (export / erase) — the pure rules, then the real store and the real Settings card.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { Toaster } from 'sonner';
import { formatDate, formatNumber, isRtlLocale, localeFor } from '@/lib/locale';
import { TAX_RULES, checkTaxId, countryForCurrency, splitInclusive, taxRuleFor } from '@/lib/taxRegistration';
import {
  ERASED_NAME, buildCustomerExport, customerExportCsv, erasureConfirmed, erasurePlan, orderBelongsTo, phoneKey, redactOrderPii,
} from '@/lib/privacy';
import {
  deleteCustomer, deleteOrder, eraseCustomerPrivacyData, exportCustomerPrivacyData, findCustomerByPhone, getCustomers, getOrders, saveOrder,
} from '@/lib/store';
import { getArchivedOrders, archiveOrders, clearArchivedOrders } from '@/lib/orderArchive';
import PrivacyCard from '@/components/settings/PrivacyCard';
import { CURRENCIES } from '@/lib/currency';
import type { Order } from '@/lib/types';

const order = (o: Partial<Order>): Order => ({
  id: 'o1', orderNumber: 1, orderType: 'delivery', status: 'running',
  items: [{ id: 'i', name: 'Karahi', quantity: 2, lineTotal: 3000 } as any],
  subtotal: 3000, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 3000, createdAt: '2026-11-01T10:00:00.000Z',
  customer: { id: 'c', name: 'Ayesha Khan', phone: '0300 1234567', address: 'House 5, Gulberg', lat: 31.5, lng: 74.3 } as any,
  delivery: { customerLat: 31.5, customerLng: 74.3, customerIp: '1.2.3.4', customerUserAgent: 'UA', customerCity: 'Lahore', etaMinutes: 30 },
  ...o,
} as Order);

describe('locale — numbers and dates in the language of the screen', () => {
  it('maps every language to a locale and refines Arabic by the restaurant country', () => {
    expect(localeFor('en')).toBe('en');
    expect(localeFor('ur')).toBe('ur-PK');
    expect(localeFor('ur-roman')).toBe('en-PK');
    expect(localeFor('ar')).toBe('ar');
    expect(localeFor('ar', 'ae')).toBe('ar-AE');
    expect(localeFor('ar', 'EG')).toBe('ar-EG');
    expect(localeFor('ms')).toBe('ms-MY');
    expect(localeFor('zh')).toBe('zh-CN');
  });

  it('keeps Latin digits by default in every language, native digits only on request', () => {
    expect(formatNumber(1234567, { language: 'en' })).toBe('1,234,567');
    expect(formatNumber(1234567, { language: 'ar' })).toMatch(/^[0-9٬,.\s]+$/);
    expect(formatNumber(1234567, { language: 'ar' })).toMatch(/^1/);
    expect(formatNumber(1234567, { language: 'ar', digits: 'native' })).toMatch(/^[٠-٩]/);
    expect(formatNumber(12.5, { decimals: 2 })).toBe('12.50');
  });

  it('formats dates with the language’s own month names and never throws', () => {
    const d = new Date(Date.UTC(2026, 10, 6, 12, 0, 0));
    expect(formatDate(d, { language: 'en', timeZone: 'UTC' })).toBe('Nov 6, 2026');
    expect(formatDate(d, { language: 'ar', timeZone: 'UTC' })).not.toBe(formatDate(d, { language: 'en', timeZone: 'UTC' }));
    expect(formatDate(d, { language: 'en', style: 'long', timeZone: 'UTC' })).toMatch(/Friday/);
    expect(formatDate('not a date')).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatNumber(NaN)).toBe('—');
  });

  it('knows which locales read right-to-left', () => {
    expect(isRtlLocale('ar-AE')).toBe(true);
    expect(isRtlLocale('ur-PK')).toBe(true);
    expect(isRtlLocale('en-PK')).toBe(false);
    expect(isRtlLocale('zh-CN')).toBe(false);
  });
});

describe('tax registration — one rule per country', () => {
  it('gives every rule a label, a title, an example that passes its own check and a hint', () => {
    expect(TAX_RULES.length).toBeGreaterThanOrEqual(18);
    for (const r of TAX_RULES) {
      expect(r.country).toMatch(/^[A-Z]{2}$/);
      expect(r.idLabel.length).toBeGreaterThan(1);
      expect(r.invoiceTitle.length).toBeGreaterThan(2);
      expect(r.hint.length).toBeGreaterThan(5);
      if (r.pattern) expect(r.pattern.test(r.example), `${r.country} example "${r.example}"`).toBe(true);
    }
  });

  it('uses the right words for the markets we sell in', () => {
    expect(taxRuleFor('PK').idLabel).toBe('NTN / STRN');
    expect(taxRuleFor('ae').idLabel).toBe('TRN');
    expect(taxRuleFor('SA').invoiceTitle).toBe('Simplified Tax Invoice');
    expect(taxRuleFor('IN').idLabel).toBe('GSTIN');
    expect(taxRuleFor('GB').taxName).toBe('VAT');
    expect(taxRuleFor('XX').idLabel).toBe('Tax registration no.');
    expect(taxRuleFor(undefined).taxName).toBe('Tax');
  });

  it('checks the shape of a number, allows an empty field, and never claims an authority lookup', () => {
    expect(checkTaxId('AE', '')).toEqual({ ok: true, value: '' });
    expect(checkTaxId('AE', '100123456700003')).toEqual({ ok: true, value: '100123456700003' });
    const bad = checkTaxId('AE', '12345');
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.reason).toMatch(/TRN/);
    expect(checkTaxId('SA', '300123456700003').ok).toBe(true);
    expect(checkTaxId('SA', '100123456700003').ok).toBe(false);          // must start and end with 3
    expect(checkTaxId('IN', '27ABCDE1234F1Z5').ok).toBe(true);
    expect(checkTaxId('IN', '27abcde1234f1z5').ok).toBe(true);            // case is normalised
    expect(checkTaxId('PK', '1234567-8').ok).toBe(true);
    expect(checkTaxId('PK', 'abc').ok).toBe(false);
    expect(checkTaxId('ZZ', 'anything goes 123').ok).toBe(true);          // unknown country: free text
    expect(checkTaxId('ZZ', 'x'.repeat(41)).ok).toBe(false);
  });

  it('finds the country of a currency and covers each currency that has a rule', () => {
    expect(countryForCurrency('pkr')).toBe('PK');
    expect(countryForCurrency('AED')).toBe('AE');
    expect(countryForCurrency('???')).toBe('');
    const codes = new Set(CURRENCIES.map(c => c.code));
    for (const code of ['PKR', 'AED', 'SAR', 'INR', 'SGD', 'MYR', 'GBP']) expect(codes.has(code)).toBe(true);
  });

  it('splits tax-inclusive amounts at several rates so base + tax equals the amount exactly', () => {
    const parts = splitInclusive([{ amount: 105, ratePercent: 5 }, { amount: 115, ratePercent: 15 }, { amount: 99.99, ratePercent: 14 }]);
    expect(parts[0]).toEqual({ base: 100, tax: 5, ratePercent: 5 });
    expect(parts[1]).toEqual({ base: 100, tax: 15, ratePercent: 15 });
    expect(Math.round((parts[2].base + parts[2].tax) * 100)).toBe(9999);
  });
});

describe('privacy — rules', () => {
  it('finds a person by phone however it was typed', () => {
    expect(phoneKey('0300 1234567')).toBe(phoneKey('+92 300 1234567'));
    expect(phoneKey('')).toBe('');
    const key = phoneKey('03001234567');
    expect(orderBelongsTo(order({}), key)).toBe(true);
    expect(orderBelongsTo(order({ customer: undefined, creditCustomerPhone: '+923001234567' }), key)).toBe(true);
    expect(orderBelongsTo(order({ customer: { id: 'x', name: 'Other', phone: '03111111111', address: '' } as any }), key)).toBe(false);
    expect(orderBelongsTo(order({}), '')).toBe(false);
  });

  it('redacts the person but keeps the sale', () => {
    const r = redactOrderPii(order({ creditCustomerName: 'Ayesha', creditCustomerPhone: '0300 1234567', creditCustomerAddress: 'Gulberg' }));
    expect(r.customer).toEqual({ id: 'erased', name: ERASED_NAME, phone: '', address: '' });
    expect(r.creditCustomerName).toBe(ERASED_NAME);
    expect(r.creditCustomerPhone).toBe('');
    expect(r.creditCustomerAddress).toBe('');
    expect(r.delivery).toEqual({ etaMinutes: 30 });                    // map position, IP, browser and city are gone
    expect(r.grandTotal).toBe(3000);
    expect(r.items).toHaveLength(1);
    expect(r.orderNumber).toBe(1);
    expect(JSON.stringify(r)).not.toContain('Ayesha');
    expect(JSON.stringify(r)).not.toContain('1234567');
  });

  it('builds one export with the profile and only that person’s orders, once each', () => {
    const mine = order({ id: 'a' });
    const dupe = order({ id: 'a' });
    const other = order({ id: 'b', customer: { id: 'x', name: 'Other', phone: '03111111111', address: '' } as any });
    const exp = buildCustomerExport({ phone: '03001234567', profile: { id: '923001234567', name: 'Ayesha Khan', phone: '0300 1234567' } as any, orders: [mine, dupe, other], now: new Date('2026-11-06T00:00:00Z') });
    expect(exp.orders.map(o => o.id)).toEqual(['a']);
    expect(exp.profile?.name).toBe('Ayesha Khan');
    expect(exp.generatedAt).toBe('2026-11-06T00:00:00.000Z');
    expect(exp.note).toMatch(/No card number/);
    const csv = customerExportCsv(exp);
    expect(csv.split('\r\n')[0]).toBe('order_number,date,status,type,items,total');
    expect(csv).toContain('2 x Karahi');
  });

  it('quotes CSV cells and previews exactly what an erase touches', () => {
    const o = order({ id: 'q', items: [{ id: 'i', name: 'Tea, "special"', quantity: 1, lineTotal: 100 } as any] });
    const csv = customerExportCsv(buildCustomerExport({ phone: '03001234567', profile: null, orders: [o] }));
    expect(csv).toContain('"1 x Tea, ""special"""');
    const plan = erasurePlan({ phone: '03001234567', profile: undefined, orders: [o, order({ id: 'z', customer: undefined })] });
    expect(plan).toMatchObject({ hasProfile: false, orders: 1, orderIds: ['q'] });
  });

  it('only accepts an erase when the number is typed again', () => {
    expect(erasureConfirmed('0300-1234567', '0300 1234567')).toBe(true);
    expect(erasureConfirmed('0300', '0300 1234567')).toBe(false);
    expect(erasureConfirmed('', '')).toBe(false);
  });
});

describe('privacy — the real store', () => {
  beforeEach(() => {
    getOrders().forEach(o => deleteOrder(o.id));
    getCustomers().forEach(c => deleteCustomer(c.id));
    clearArchivedOrders();
  });
  afterEach(() => { cleanup(); clearArchivedOrders(); });

  it('exports then erases a person across live orders, the profile and the day-close archive', () => {
    saveOrder(order({ id: 'live1', orderNumber: 7 }));
    saveOrder(order({ id: 'other', orderNumber: 8, customer: { id: 'x', name: 'Bilal', phone: '03111111111', address: 'DHA' } as any }));
    archiveOrders([order({ id: 'old1', orderNumber: 3, status: 'paid', createdAt: new Date().toISOString() })]);
    expect(findCustomerByPhone('03001234567')?.name).toBe('Ayesha Khan');

    const exp = exportCustomerPrivacyData('03001234567');
    expect(exp.profile?.name).toBe('Ayesha Khan');
    expect(exp.orders.map(o => o.id).sort()).toEqual(['live1', 'old1']);

    const res = eraseCustomerPrivacyData('0300-1234567');
    expect(res).toEqual({ profileDeleted: true, liveOrders: 1, archivedOrders: 1 });
    expect(findCustomerByPhone('03001234567')).toBeUndefined();

    const live = getOrders().find(o => o.id === 'live1')!;
    expect(live.customer?.name).toBe(ERASED_NAME);
    expect(live.grandTotal).toBe(3000);                                   // the sale stays
    expect(getArchivedOrders().find(o => o.id === 'old1')?.customer?.name).toBe(ERASED_NAME);
    expect(getOrders().find(o => o.id === 'other')?.customer?.name).toBe('Bilal');   // someone else is untouched
    expect(findCustomerByPhone('03111111111')?.name).toBe('Bilal');

    // erased once, nothing left to find
    expect(eraseCustomerPrivacyData('03001234567')).toEqual({ profileDeleted: false, liveOrders: 0, archivedOrders: 0 });
    expect(exportCustomerPrivacyData('03001234567').orders).toHaveLength(0);
    expect(eraseCustomerPrivacyData('')).toEqual({ profileDeleted: false, liveOrders: 0, archivedOrders: 0 });
  });
});

describe('privacy — the Settings card', () => {
  beforeEach(() => {
    getOrders().forEach(o => deleteOrder(o.id));
    getCustomers().forEach(c => deleteCustomer(c.id));
  });
  afterEach(cleanup);

  it('finds a person, keeps Erase disabled until the number is retyped, then erases', () => {
    saveOrder(order({ id: 'card1', orderNumber: 21 }));
    render(<><Toaster /><PrivacyCard /></>);
    fireEvent.change(screen.getByLabelText('Customer phone'), { target: { value: '03001234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));

    const found = screen.getByTestId('privacy-found');
    expect(found.textContent).toMatch(/A profile exists/);
    expect(found.textContent).toMatch(/1 order/);
    const erase = within(found).getByRole('button', { name: /Erase this customer/ }) as HTMLButtonElement;
    expect(erase.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type the phone number again/), { target: { value: '0300' } });
    expect(erase.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type the phone number again/), { target: { value: '0300 1234567' } });
    expect(erase.disabled).toBe(false);

    fireEvent.click(erase);
    expect(findCustomerByPhone('03001234567')).toBeUndefined();
    expect(getOrders().find(o => o.id === 'card1')?.customer?.name).toBe(ERASED_NAME);
    expect(screen.queryByTestId('privacy-found')).toBeNull();
  });

  it('says there is nothing to erase for an unknown number', () => {
    render(<PrivacyCard />);
    fireEvent.change(screen.getByLabelText('Customer phone'), { target: { value: '03555555555' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(screen.getByTestId('privacy-found').textContent).toMatch(/Nothing to erase/);
    expect(screen.queryByRole('button', { name: /Erase this customer/ })).toBeNull();
  });
});
