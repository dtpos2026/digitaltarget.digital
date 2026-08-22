// ============================================================
// Tests — Currency engine (v1.4.0, international support)
//
// The two things that MUST hold:
//  1. An existing restaurant that never touches the setting keeps
//     seeing exactly what it saw before (PKR, "Rs.", 0 decimals).
//  2. A new market (e.g. Singapore) gets correct symbol, position
//     and decimals — a wrong decimal count means wrong prices.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CURRENCIES, DEFAULT_CURRENCY, getCurrencyDef, setActiveCurrency,
  getActiveCurrency, formatMoney, money, currencySymbol, currencyOptions,
} from '@/lib/currency';

beforeEach(() => {
  localStorage.clear();
  setActiveCurrency(DEFAULT_CURRENCY);
});

describe('registry integrity', () => {
  it('has no duplicate currency codes', () => {
    const codes = CURRENCIES.map(c => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every currency defines the fields the formatter relies on', () => {
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(['prefix', 'suffix']).toContain(c.position);
      expect(c.decimals).toBeGreaterThanOrEqual(0);
      expect(c.decimals).toBeLessThanOrEqual(3);
      expect(c.locale).toContain('-');
    }
  });

  it('includes the markets asked for', () => {
    const codes = CURRENCIES.map(c => c.code);
    for (const wanted of ['PKR', 'SGD', 'USD', 'AED', 'SAR', 'GBP', 'EUR', 'INR', 'MYR']) {
      expect(codes).toContain(wanted);
    }
  });

  it('the picker lists every currency, sorted by country', () => {
    const opts = currencyOptions();
    expect(opts).toHaveLength(CURRENCIES.length);
    const countries = opts.map(o => o.country);
    expect(countries).toEqual([...countries].sort((a, b) => a.localeCompare(b)));
  });
});

describe('backward compatibility — existing restaurants are untouched', () => {
  it('defaults to PKR', () => {
    expect(DEFAULT_CURRENCY).toBe('PKR');
    expect(getActiveCurrency().code).toBe('PKR');
  });

  it('renders exactly like the old hardcoded output', () => {
    expect(formatMoney(1200)).toBe('Rs.1,200');
    expect(formatMoney(0)).toBe('Rs.0');
    expect(formatMoney(999999)).toBe('Rs.999,999');
  });

  it('an unknown or missing code falls back to PKR instead of breaking a bill', () => {
    expect(getCurrencyDef(undefined).code).toBe('PKR');
    expect(getCurrencyDef('XYZ').code).toBe('PKR');
    expect(getCurrencyDef('').code).toBe('PKR');
  });
});

describe('Singapore Dollar (the requested market)', () => {
  beforeEach(() => setActiveCurrency('SGD'));

  it('uses S$ as a prefix with 2 decimals', () => {
    expect(formatMoney(1200)).toBe('S$1,200.00');
    expect(formatMoney(4.5)).toBe('S$4.50');
    expect(formatMoney(0)).toBe('S$0.00');
  });

  it('currencySymbol() reports S$', () => {
    expect(currencySymbol()).toBe('S$');
  });
});

describe('formatting rules per currency', () => {
  it('0-decimal currencies do not show cents', () => {
    expect(formatMoney(1500, { code: 'PKR' })).toBe('Rs.1,500');
    expect(formatMoney(1500, { code: 'JPY' })).toBe('¥1,500');
  });

  it('3-decimal Gulf currencies keep all three places', () => {
    expect(formatMoney(12.345, { code: 'KWD' })).toContain('12.345');
    expect(formatMoney(12.345, { code: 'BHD' })).toContain('12.345');
  });

  it('spaced symbols render with a gap', () => {
    expect(formatMoney(100, { code: 'AED' })).toBe('AED 100.00');
    expect(formatMoney(100, { code: 'SAR' })).toBe('SAR 100.00');
  });

  it('rounds to the currency precision rather than truncating', () => {
    expect(formatMoney(10.999, { code: 'SGD' })).toBe('S$11.00');
    expect(formatMoney(10.4, { code: 'PKR' })).toBe('Rs.10');
  });

  it('noSymbol renders the number alone (for inputs and columns)', () => {
    expect(formatMoney(1200, { code: 'SGD', noSymbol: true })).toBe('1,200.00');
  });

  it('a historical bill can be rendered in its own currency', () => {
    setActiveCurrency('SGD');
    expect(formatMoney(500, { code: 'PKR' })).toBe('Rs.500');
    expect(formatMoney(500)).toBe('S$500.00');
  });
});

describe('robustness — a bill must never print NaN', () => {
  it('handles null, undefined and non-numeric input', () => {
    expect(formatMoney(null)).toBe('Rs.0');
    expect(formatMoney(undefined)).toBe('Rs.0');
    expect(formatMoney(NaN)).toBe('Rs.0');
    expect(formatMoney(Infinity)).toBe('Rs.0');
  });

  it('accepts numeric strings, including toFixed() output', () => {
    expect(formatMoney('1200')).toBe('Rs.1,200');
    expect(formatMoney((12.5).toFixed(2))).toBe('Rs.13');
    expect(formatMoney('garbage')).toBe('Rs.0');
  });

  it('strips grouping from a pre-formatted string', () => {
    expect(formatMoney('1,200')).toBe('Rs.1,200');
  });

  it('handles negative amounts (refunds / adjustments)', () => {
    expect(formatMoney(-250)).toContain('250');
    expect(formatMoney(-250)).toContain('-');
  });

  it('money is an alias of formatMoney', () => {
    expect(money(1200)).toBe(formatMoney(1200));
  });
});

describe('switching currency persists for the restaurant', () => {
  it('setActiveCurrency updates what everything renders', () => {
    expect(formatMoney(100)).toBe('Rs.100');
    setActiveCurrency('USD');
    expect(formatMoney(100)).toBe('$100.00');
    setActiveCurrency('GBP');
    expect(formatMoney(100)).toBe('£100.00');
  });

  it('normalises lowercase codes', () => {
    setActiveCurrency('sgd');
    expect(getActiveCurrency().code).toBe('SGD');
  });
});
