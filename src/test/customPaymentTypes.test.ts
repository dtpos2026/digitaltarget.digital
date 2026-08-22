// ============================================================
// Tests — Custom Payment Types (v1.6.1, feedback #2 item 3)
// Multi-tenant rule: default OFF, zero effect until the restaurant
// enables the module AND adds type names.
// ============================================================
import { describe, it, expect } from 'vitest';
import { featureActive, OPTIONAL_FEATURES } from '@/lib/optionalModules';
import { settlementLabel } from '@/lib/salesReport';
import type { RestaurantSettings, Order } from '@/lib/types';

describe('registry compliance (house rule)', () => {
  const def = OPTIONAL_FEATURES.find(f => f.key === 'customPaymentTypesEnabled');

  it('is registered in optionalModules', () => {
    expect(def).toBeTruthy();
  });

  it('defaults OFF — existing restaurants see nothing new', () => {
    expect(def!.defaultValue).toBe(false);
    expect(featureActive({} as RestaurantSettings, 'customPaymentTypesEnabled')).toBe(false);
  });

  it('turns on only when the restaurant enables it', () => {
    expect(featureActive({ customPaymentTypesEnabled: true } as RestaurantSettings, 'customPaymentTypesEnabled')).toBe(true);
  });
});

describe('custom method names flow through the money pipeline', () => {
  const o = (paymentMethod: string, paymentAccountName?: string) =>
    ({ paymentMethod, paymentAccountName } as unknown as Order);

  it('report settlement shows the custom type name (uppercased, like the sample)', () => {
    expect(settlementLabel(o('NETS'))).toBe('NETS');
    expect(settlementLabel(o('PayNow'))).toBe('PAYNOW');
  });

  it('a named account still wins over the raw method', () => {
    expect(settlementLabel(o('online', 'JazzCash'))).toBe('JAZZCASH');
  });

  it('built-in labels stay stable', () => {
    expect(settlementLabel(o('cash'))).toBe('CASH');
    expect(settlementLabel(o('card'))).toBe('CARD');
  });
});
