// ============================================================
// THE SECOND SCREEN — the read-only windows stay read-only (v1.93.0, from the offline POS).
//
// The Kitchen Display and the Customer Display are separate windows that only read. In the offline POS they share one
// localStorage database, so that app pins how a storage event refreshes the cache. THIS app keeps its data in Supabase:
// every window loads it itself and hears changes through realtime (onDataChange), so those cache tests do not apply
// here and are not ported. What carries over is the rule that a display never becomes a second till.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('the read-only screens are genuinely read-only', () => {
  it('the customer display never writes an order', () => {
    // It is a display. Every status on it comes from the kitchen; a screen
    // that could change an order would be a second, unaudited till.
    const page = read('pages/CustomerDisplayPage.tsx');
    expect(/setOrderKitchenStatus|saveOrder|updateOrder|addOrder/.test(page)).toBe(false);
  });

  it('the kitchen board changes only the kitchen status', () => {
    const page = read('pages/KdsTvPage.tsx');
    expect(page).toContain('setOrderKitchenStatus');
    expect(/saveOrder|deleteOrder|voidOrder/.test(page)).toBe(false);
  });
});
