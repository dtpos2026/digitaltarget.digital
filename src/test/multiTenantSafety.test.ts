// ============================================================
// Tests — MULTI-TENANT SAFETY (v1.3.1)
//
// The contract these tests protect: one update ships to EVERY restaurant,
// therefore a restaurant that has not opted in must see NOTHING new —
// no sidebar page, no button, no changed printing behaviour.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { RestaurantSettings, User } from '@/lib/types';
import {
  OPTIONAL_FEATURES, featureValue, featureActive, disabledModulePageKeys,
} from '@/lib/optionalModules';
import { visiblePagesForUser } from '@/lib/permissions';

/** A restaurant that has never touched any new setting. */
const untouched = {} as RestaurantSettings;

const admin = { id: 'u1', name: 'Owner', username: 'admin', password: 'x', role: 'admin', isActive: true } as User;

describe('every optional feature is registered', () => {
  it('registry has no duplicate keys', () => {
    const keys = OPTIONAL_FEATURES.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every sub-option points at a real parent module', () => {
    const keys = new Set(OPTIONAL_FEATURES.map(f => f.key as string));
    for (const f of OPTIONAL_FEATURES) {
      if (f.requires) expect(keys.has(f.requires)).toBe(true);
    }
  });

  it('every top-level module defaults OFF', () => {
    for (const f of OPTIONAL_FEATURES.filter(x => !x.requires)) {
      expect(f.defaultValue).toBe(false);
    }
  });
});

describe('an untouched restaurant sees nothing new', () => {
  it('no top-level feature is active', () => {
    for (const f of OPTIONAL_FEATURES.filter(x => !x.requires)) {
      expect(featureActive(untouched, f.key)).toBe(false);
    }
  });

  it('sub-options stay inactive even where their stored default is true', () => {
    // tokenIncludeRevenueInReports / tokenCounterDailyReset default to true,
    // but MUST NOT be active while the parent module is off.
    for (const f of OPTIONAL_FEATURES.filter(x => x.requires)) {
      expect(featureActive(untouched, f.key)).toBe(false);
    }
  });

  it('module pages are hidden from the sidebar', () => {
    expect(disabledModulePageKeys(untouched)).toContain('tokens');
    const pages = visiblePagesForUser(admin, true, untouched);
    expect(pages.some(p => p.key === 'tokens')).toBe(false);
  });

  it('an admin still sees the normal pages (nothing else was broken)', () => {
    const pages = visiblePagesForUser(admin, true, untouched);
    expect(pages.some(p => p.key === 'pos')).toBe(true);
    expect(pages.some(p => p.key === 'settings')).toBe(true);
  });
});

describe('a restaurant that opts in gets the feature', () => {
  const withTokens = { tokenModuleEnabled: true } as RestaurantSettings;

  it('module page appears only for that restaurant', () => {
    expect(disabledModulePageKeys(withTokens)).not.toContain('tokens');
    expect(visiblePagesForUser(admin, true, withTokens).some(p => p.key === 'tokens')).toBe(true);
    // the other restaurant is unaffected
    expect(visiblePagesForUser(admin, true, untouched).some(p => p.key === 'tokens')).toBe(false);
  });

  it('sub-options become active with their own defaults', () => {
    expect(featureActive(withTokens, 'tokenIncludeRevenueInReports')).toBe(true); // default ON
    expect(featureActive(withTokens, 'tokenSlipQr')).toBe(false);                 // default OFF
  });

  it('sub-option can then be switched off individually', () => {
    const s = { tokenModuleEnabled: true, tokenIncludeRevenueInReports: false } as RestaurantSettings;
    expect(featureActive(s, 'tokenIncludeRevenueInReports')).toBe(false);
  });

  it('turning the parent back off deactivates everything under it', () => {
    const s = { tokenModuleEnabled: false, tokenSlipQr: true } as RestaurantSettings;
    expect(featureActive(s, 'tokenSlipQr')).toBe(false);
  });
});

describe('featureValue vs featureActive', () => {
  it('featureValue reports the stored/default value, ignoring the parent', () => {
    const s = { tokenSlipQr: true } as RestaurantSettings;
    expect(featureValue(s, 'tokenSlipQr')).toBe(true);
    expect(featureActive(s, 'tokenSlipQr')).toBe(false); // parent module off
  });

  it('unknown keys are treated as off rather than throwing', () => {
    expect(featureValue(untouched, 'someFutureFeature')).toBe(false);
    expect(featureActive(untouched, 'someFutureFeature')).toBe(false);
  });

  it('handles null settings safely (fresh install / offline boot)', () => {
    expect(featureActive(null, 'tokenModuleEnabled')).toBe(false);
    expect(disabledModulePageKeys(null)).toContain('tokens');
  });
});
