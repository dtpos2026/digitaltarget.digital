// ============================================================================
// The two white screens, named by PageBoundary once it shipped:
//
//   /customer-map   (e || "").replace is not a function
//   /customers      Minified React error #31   (object rendered as a child)
//
// One defect. customers.addresses is a jsonb array that used to hold strings;
// the customer app's My Addresses screen began writing objects into it. Live
// database: 1322 customers hold strings, 176 hold an empty list, and 2 hold
// objects — and those 2 rows took out both screens for the whole restaurant.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { addressText, primaryAddress } from '@/lib/customerAddress';

describe('an address entry may be a string or an object', () => {
  it('reads a plain string, as 1322 customers have', () => {
    expect(addressText('Habib Colony Street house')).toBe('Habib Colony Street house');
  });

  it('reads the object shape the customer app writes', () => {
    // Copied from the live row that caused the crash.
    expect(addressText({ id: 'x', label: 'Home', address: 'Habib Colony Street house' }))
      .toBe('Habib Colony Street house');
  });

  it('appends the city when it is not already in the line', () => {
    expect(addressText({ label: 'Home', address: 'Yes hvsbdbshbdbdbb', city: 'Burewala' }))
      .toBe('Yes hvsbdbshbdbdbb, Burewala');
    expect(addressText({ address: 'Shop 4, Burewala', city: 'Burewala' }))
      .toBe('Shop 4, Burewala');
  });

  it('never throws on anything that reaches it', () => {
    for (const junk of [null, undefined, {}, { label: 'Home' }, 42 as never, [] as never]) {
      expect(() => addressText(junk as never)).not.toThrow();
      expect(typeof addressText(junk as never)).toBe('string');
    }
  });

  it('always returns a string, so .replace and JSX are both safe', () => {
    const v = addressText({ id: 'x', label: 'Home', address: 'A street' });
    expect(typeof v).toBe('string');
    expect(() => v.replace(/a/g, 'b')).not.toThrow();   // the /customer-map crash
  });
});

describe('primaryAddress picks the one to show', () => {
  it('prefers an explicit fullAddress', () => {
    expect(primaryAddress({ fullAddress: 'Main Road', addresses: ['Other'] })).toBe('Main Road');
  });

  it('falls back to the first usable entry, string or object', () => {
    expect(primaryAddress({ addresses: ['First St'] })).toBe('First St');
    expect(primaryAddress({ addresses: [{ address: 'Object St' }] })).toBe('Object St');
  });

  it('skips empty entries rather than returning blank', () => {
    expect(primaryAddress({ addresses: [null, {}, '  ', 'Real St'] as never })).toBe('Real St');
  });

  it('handles a customer with no address at all — 176 rows do', () => {
    expect(primaryAddress({ addresses: [] })).toBe('');
    expect(primaryAddress(null)).toBe('');
  });
});

describe('no call site reads addresses[0] raw any more', () => {
  const files = [
    'src/pages/CustomersPage.tsx',
    'src/pages/CustomerMapPage.tsx',
    'src/pages/POSScreen.tsx',
    'src/components/CustomerAutocomplete.tsx',
    'src/components/CustomerIntelligenceCard.tsx',
    'src/lib/customers.ts',
  ];
  for (const f of files) {
    it(`${f} goes through the helper`, () => {
      const body = readFileSync(f, 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
      expect(body, `${f} still indexes addresses directly`).not.toMatch(/addresses\??\.?\[0\]/);
    });
  }
});
