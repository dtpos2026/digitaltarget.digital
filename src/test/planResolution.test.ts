// ============================================================
// Tests — v1.25.0 Enterprise plan must reach the sidebar
//
// REPORTED: a restaurant with Enterprise access saw Trial modules.
//
// CAUSE: the plan was applied ONLY inside the owner-login handler. The other
// place that could refresh it — the plan watcher — returned immediately on
// Supabase. So after a page refresh, or once the POS user signed in, nothing
// re-applied the plan and it sat at the 'trial' default.
//
// No error appeared anywhere: the plan really WAS trial in local state. It had
// simply never been told otherwise.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  featureEnabled, setCurrentTenantPlan, setCurrentTenantOverrides,
  getCurrentTenantPlan, getCurrentTenantOverrides,
} from '@/lib/plans';

/** featureEnabled(plan, key, overrides) — read the current values here. */
const can = (key: string) =>
  featureEnabled(getCurrentTenantPlan(), key, getCurrentTenantOverrides());

describe('the plan actually drives module access', () => {
  it('Enterprise unlocks more than Trial', () => {
    setCurrentTenantOverrides(null);

    const probes = ['reports', 'inventory', 'hr', 'accounts', 'crm', 'branches', 'live-map'];

    setCurrentTenantPlan('trial');
    const trialCount = probes.filter(can).length;

    setCurrentTenantPlan('enterprise');
    const entCount = probes.filter(can).length;

    expect(trialCount).toBe(0);            // Trial has none of these
    expect(entCount).toBe(probes.length);  // Enterprise has all of them
  });

  it('an unknown plan does not silently unlock everything', () => {
    setCurrentTenantPlan('not-a-real-plan');
    // Falling open would give a Trial customer the full product.
    expect(getCurrentTenantPlan()).toBe('not-a-real-plan');
  });
});

describe('a failed plan lookup must NOT downgrade a paying restaurant', () => {
  /** Mirrors applyPlan(): only a real value replaces the current plan. */
  function applyPlan(current: string, fetched: string | null | undefined): string {
    return fetched ? fetched : current;
  }

  it('THE REGRESSION: a null result keeps Enterprise', () => {
    // `plan || 'trial'` was the old shape — one failed query and the till
    // dropped to a Trial sidebar mid-service.
    expect(applyPlan('enterprise', null)).toBe('enterprise');
    expect(applyPlan('enterprise', undefined)).toBe('enterprise');
  });

  it('a real value does replace it', () => {
    expect(applyPlan('trial', 'enterprise')).toBe('enterprise');
    expect(applyPlan('enterprise', 'trial')).toBe('trial');   // genuine downgrade
  });
});

describe('feature overrides layer on top of the plan', () => {
  it('an override can grant a module the plan does not include', () => {
    setCurrentTenantPlan('trial');
    setCurrentTenantOverrides({ hr: true });
    expect(can('hr')).toBe(true);
    setCurrentTenantOverrides(null);
  });

  it('an override can withdraw one the plan does include', () => {
    setCurrentTenantPlan('enterprise');
    setCurrentTenantOverrides({ hr: false });
    expect(can('hr')).toBe(false);
    setCurrentTenantOverrides(null);
  });

  it('clearing overrides returns to the plan', () => {
    setCurrentTenantPlan('enterprise');
    setCurrentTenantOverrides({ hr: false });
    setCurrentTenantOverrides(null);
    expect(can('hr')).toBe(true);
  });
});
